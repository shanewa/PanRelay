/**
 * 分享页：拦截「保存到网盘」，在需要时走 PanRelay 分批转存。
 */
(function () {
  'use strict';

  const SAVE_SELECTOR = [
    '[node-type="bottomShareSave"]',
    '[node-type="shareSave"]',
    // 新版分享页（disk-share-v2）
    'button.bottom_save_btn',
    'button.save_btn',
    'button[title="保存到网盘"]',
  ].join(', ');
  const SAVE_TEXT = '保存到网盘';
  const DEFAULTS = {
    enabled: true,
    batchSize: 500,
    alwaysRelay: false,
    transferCooldownMs: 1500,
    unlocked: false,
  };

  let settings = { ...DEFAULTS };
  let running = false;
  let panelEl = null;
  let currentEngine = null;
  /** 小批量交还给百度原生保存时，放行下一次程序触发的点击 */
  let passThroughTarget = null;

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.batchSize) settings.batchSize = changes.batchSize.newValue;
    if (changes.alwaysRelay) settings.alwaysRelay = changes.alwaysRelay.newValue;
    if (changes.transferCooldownMs) settings.transferCooldownMs = changes.transferCooldownMs.newValue;
    if (changes.unlocked) settings.unlocked = changes.unlocked.newValue;
  });

  function injectBridge() {
    if (document.getElementById('panrelay-bridge-script')) return;
    const script = document.createElement('script');
    script.id = 'panrelay-bridge-script';
    script.src = chrome.runtime.getURL('injected/page-bridge.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function callBridge(method) {
    return new Promise((resolve, reject) => {
      const id = `pr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const onResponse = (event) => {
        const detail = event.detail || {};
        if (detail.id !== id) return;
        document.removeEventListener('panrelay-response', onResponse);
        if (detail.ok) resolve(detail.result);
        else reject(new Error(detail.error || '页面桥接失败'));
      };
      document.addEventListener('panrelay-response', onResponse);
      document.dispatchEvent(
        new CustomEvent('panrelay-request', { detail: { id, method } }),
      );
      setTimeout(() => {
        document.removeEventListener('panrelay-response', onResponse);
        reject(new Error('页面桥接超时，请刷新分享页'));
      }, 8000);
    });
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'panrelay-panel';
    panelEl.innerHTML =
      '<div class="panrelay-panel-inner">' +
      '<div class="panrelay-header">' +
      '<div class="panrelay-title">PanRelay 接力转存</div>' +
      '<button type="button" class="panrelay-cancel" hidden>取消</button>' +
      '</div>' +
      '<div class="panrelay-status">就绪</div>' +
      '<div class="panrelay-log"></div>' +
      '</div>';
    panelEl.querySelector('.panrelay-cancel').addEventListener('click', onCancelClick);
    document.documentElement.appendChild(panelEl);
    return panelEl;
  }

  function setCancelVisible(visible) {
    const btn = ensurePanel().querySelector('.panrelay-cancel');
    btn.hidden = !visible;
    btn.disabled = false;
    btn.textContent = '取消';
  }

  function onCancelClick() {
    if (!currentEngine) return;
    currentEngine.cancel();
    const btn = ensurePanel().querySelector('.panrelay-cancel');
    btn.disabled = true;
    btn.textContent = '正在取消…';
    setPanelStatus('正在取消…');
  }

  function setPanelStatus(text) {
    const panel = ensurePanel();
    panel.querySelector('.panrelay-status').textContent = text;
  }

  function clearLog() {
    const log = ensurePanel().querySelector('.panrelay-log');
    log.replaceChildren();
  }

  function appendLog(text) {
    const panel = ensurePanel();
    const log = panel.querySelector('.panrelay-log');
    const line = document.createElement('div');
    line.className = 'panrelay-log-line';
    line.textContent = text;
    log.appendChild(line);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function shouldUseRelay(selection) {
    if (selection.selectAllDir) return true;
    const selected = selection.files;
    if (settings.alwaysRelay) return selected.length > 0;
    if (!selected.length) return false;
    if (selected.length > settings.batchSize) return true;
    if (selected.some((f) => Number(f.isdir) === 1)) return true;
    return false;
  }

  function readBdclndSekey() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)BDCLND=([^;]*)/);
      if (!match) return '';
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (_) {
      return '';
    }
  }

  /** 页面全局变量读不到时（百度又改版），重新拉一次当前分享页 HTML 解析 */
  async function getShareMetaWithFallback() {
    const meta = await callBridge('getShareMeta');
    if (meta.shareId && meta.userId) return meta;
    try {
      const res = await fetch(location.href, { credentials: 'include' });
      const parsed = PanRelay.parseShareHtml(await res.text());
      if (parsed?.shareId && parsed.userId) {
        console.info('[PanRelay] 分享信息改从页面 HTML 解析');
        return {
          ...meta,
          shareId: parsed.shareId,
          userId: parsed.userId,
          bdstoken: meta.bdstoken || parsed.bdstoken,
          shareRoot: meta.shareRoot && meta.shareRoot !== '/' ? meta.shareRoot : parsed.shareRoot,
          loginstate: meta.loginstate === '1' ? meta.loginstate : parsed.loginstate,
        };
      }
    } catch (_) {
      /* 保持原 meta，由引擎报「分享页信息不完整」 */
    }
    return meta;
  }

  async function runRelay(selection) {
    const meta = await getShareMetaWithFallback();
    if (meta.loginstate !== '1' && meta.loginstate !== 1) {
      throw new Error('请先登录百度网盘账号');
    }
    const destination = await callBridge('getDestinationPath');
    const engine = (currentEngine = new PanRelay.ShareTransferEngine({
      shareId: meta.shareId,
      userId: meta.userId,
      bdstoken: meta.bdstoken,
      shareRoot: meta.shareRoot,
      sekey: meta.sekey || readBdclndSekey(),
      batchSize: settings.batchSize,
      transferCooldownMs: settings.transferCooldownMs,
      onProgress: (msg) => {
        setPanelStatus(msg);
        appendLog(msg);
      },
    }));
    if (selection.selectAllDir) {
      await engine.runDirectoryContents(selection.selectAllDir, destination);
    } else {
      await engine.runSelection(selection.files, destination);
    }
  }

  function normalizeSelection(result) {
    if (Array.isArray(result)) return { files: result, unresolved: [] };
    return {
      files: Array.isArray(result?.files) ? result.files : [],
      unresolved: Array.isArray(result?.unresolved) ? result.unresolved : [],
      selectAllDir: result?.selectAllDir || '',
    };
  }

  function nativeSaveClick(target) {
    passThroughTarget = target;
    try {
      target.click();
    } finally {
      passThroughTarget = null;
    }
  }

  /** 百度超限弹窗关闭后，付费引导遮罩偶尔不随之消失，会把整页挡住 */
  function clearStrayPaymentMask() {
    const visibleDialog = [...document.querySelectorAll('.dialog')].some((d) => {
      const style = getComputedStyle(d);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (visibleDialog) return;
    document.querySelectorAll('.module-canvas').forEach((mask) => {
      if (getComputedStyle(mask).display !== 'none') mask.style.display = 'none';
    });
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  async function onSaveClick(event, target) {
    if (!settings.enabled) return;
    if (!settings.unlocked) {
      PanRelayUnlockGuide.showGuide({ force: true });
      return;
    }

    blockEvent(event);

    if (running) {
      ensurePanel();
      appendLog('接力转存进行中，请等待完成后再点保存');
      return;
    }

    let selection;
    try {
      selection = normalizeSelection(await callBridge('getSelectedFiles'));
    } catch (error) {
      ensurePanel();
      appendLog(error.message);
      return;
    }

    if (selection.unresolved.length) {
      ensurePanel();
      setPanelStatus('无法识别选中项');
      appendLog(
        `有 ${selection.unresolved.length} 个选中项读不到文件信息，已停止，没有转存任何内容。请刷新分享页、重新勾选后再点保存。`,
      );
      return;
    }

    const useRelay = shouldUseRelay(selection);
    console.info('[PanRelay] 选中项', {
      count: selection.files.length,
      dirs: selection.files.filter((f) => Number(f.isdir) === 1).length,
      selectAllDir: selection.selectAllDir || undefined,
      useRelay,
    });
    if (!useRelay) {
      try {
        const result = await callBridge('invokeNativeSave');
        if (result?.reason === 'unsupported' && target) nativeSaveClick(target);
      } catch (error) {
        ensurePanel();
        appendLog(error.message);
      }
      return;
    }

    running = true;
    ensurePanel();
    setCancelVisible(true);
    setPanelStatus('正在准备接力转存…');
    clearLog();
    appendLog('已接管「保存到网盘」');

    try {
      await runRelay(selection);
      setPanelStatus('完成');
    } catch (error) {
      if (error.cancelled) {
        setPanelStatus('已取消');
        appendLog('已取消。已转存的部分会保留在你的网盘里。');
      } else {
        setPanelStatus('失败');
        appendLog(error.message || String(error));
      }
    } finally {
      running = false;
      currentEngine = null;
      setCancelVisible(false);
    }
  }

  function hitsRect(el, x, y) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /** 按钮上可能盖着百度的透明层，target 不一定是按钮本身，故再按坐标匹配 */
  function findSaveTarget(event) {
    const node = event.target;
    if (node?.closest) {
      // 只认分享页里的保存按钮，不碰百度弹窗里同名的按钮
      if (node.closest('.dialog, [role="dialog"], .module-canvas')) return null;
      const direct = node.closest(SAVE_SELECTOR);
      if (direct) return direct;
      const menuItem = node.closest('.g-button-menu');
      if (menuItem && menuItem.textContent.trim() === SAVE_TEXT) return menuItem;
      const button = node.closest('button, [role="button"]');
      if (button && button.textContent.trim() === SAVE_TEXT) return button;
      const box = node.closest('.x-button-box, .bottom-save-btn-wrap');
      const inBox = box?.querySelector(SAVE_SELECTOR);
      if (inBox) return inBox;
    }
    if (typeof event.clientX !== 'number') return null;
    for (const el of document.querySelectorAll(SAVE_SELECTOR)) {
      if (hitsRect(el, event.clientX, event.clientY)) return el;
    }
    return null;
  }

  window.addEventListener(
    'click',
    (event) => {
      if (passThroughTarget && event.target === passThroughTarget) return;
      if (event.target?.closest?.('.dialog-close')) {
        setTimeout(clearStrayPaymentMask, 400);
        return;
      }
      const target = findSaveTarget(event);
      if (!target) return;
      console.info('[PanRelay] 捕获保存点击', {
        nodeType: target.getAttribute('node-type'),
        className: target.className,
        enabled: settings.enabled,
        unlocked: settings.unlocked,
        running,
      });
      onSaveClick(event, target);
    },
    true,
  );

  // 百度按钮组件可能在 mousedown/mouseup 上触发保存，早于 click
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
    window.addEventListener(
      type,
      (event) => {
        if (!settings.enabled || !settings.unlocked) return;
        if (passThroughTarget) return;
        if (!findSaveTarget(event)) return;
        event.stopPropagation();
        event.stopImmediatePropagation();
      },
      true,
    );
  });

  console.info('[PanRelay] 分享页脚本已加载');

  injectBridge();
})();
