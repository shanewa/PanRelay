/**
 * 分享页：拦截「保存到网盘」，在需要时走 PanRelay 分批转存。
 */
(function () {
  'use strict';

  const SAVE_SELECTOR = '[node-type="bottomShareSave"], [node-type="shareSave"]';
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

  function shouldUseRelay(selected) {
    if (settings.alwaysRelay) return true;
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

  async function runRelay(selected) {
    const meta = await callBridge('getShareMeta');
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
    await engine.runSelection(selected, destination);
  }

  function blockEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  async function onSaveClick(event) {
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

    let selected;
    try {
      selected = await callBridge('getSelectedFiles');
    } catch (error) {
      ensurePanel();
      appendLog(error.message);
      return;
    }

    const useRelay = shouldUseRelay(selected);
    console.info('[PanRelay] 选中项', {
      count: selected.length,
      dirs: selected.filter((f) => Number(f.isdir) === 1).length,
      useRelay,
    });
    if (!useRelay) {
      try {
        await callBridge('invokeNativeSave');
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
    appendLog('已接管「保存到网盘」');

    try {
      await runRelay(selected);
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
      const direct = node.closest(SAVE_SELECTOR);
      if (direct) return direct;
      const menuItem = node.closest('.g-button-menu');
      if (menuItem && menuItem.textContent.trim() === '保存到网盘') return menuItem;
      const box = node.closest('.x-button-box');
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
      const target = findSaveTarget(event);
      if (!target) return;
      console.info('[PanRelay] 捕获保存点击', {
        nodeType: target.getAttribute('node-type'),
        enabled: settings.enabled,
        unlocked: settings.unlocked,
        running,
      });
      onSaveClick(event);
    },
    true,
  );

  // 百度按钮组件可能在 mousedown/mouseup 上触发保存，早于 click
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
    window.addEventListener(
      type,
      (event) => {
        if (!settings.enabled || !settings.unlocked) return;
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
