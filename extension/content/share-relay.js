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
      '<div class="panrelay-title">PanRelay 接力转存</div>' +
      '<div class="panrelay-status">就绪</div>' +
      '<div class="panrelay-log"></div>' +
      '</div>';
    document.documentElement.appendChild(panelEl);
    return panelEl;
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
    const engine = new PanRelay.ShareTransferEngine({
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
    });
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

    if (!shouldUseRelay(selected)) {
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
    setPanelStatus('正在准备接力转存…');
    appendLog('已接管「保存到网盘」');

    try {
      await runRelay(selected);
      setPanelStatus('完成');
    } catch (error) {
      setPanelStatus('失败');
      appendLog(error.message || String(error));
    } finally {
      running = false;
    }
  }

  function findSaveTarget(node) {
    if (!node?.closest) return null;
    const direct = node.closest(SAVE_SELECTOR);
    if (direct) return direct;
    const menuItem = node.closest('.g-button-menu');
    if (menuItem && menuItem.textContent.trim() === '保存到网盘') return menuItem;
    return null;
  }

  window.addEventListener(
    'click',
    (event) => {
      if (!findSaveTarget(event.target)) return;
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
        if (!findSaveTarget(event.target)) return;
        event.stopPropagation();
        event.stopImmediatePropagation();
      },
      true,
    );
  });

  injectBridge();
})();
