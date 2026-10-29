/**
 * 群文件库：百度原生转存提示超出上限时，接手分批接力转存。
 * 请求参数由 injected/group-bridge.js（主世界）从页面自己的转存请求里截取。
 */
(function () {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    batchSize: 500,
    transferCooldownMs: 1500,
    unlocked: false,
  };
  const LIMIT_DIALOG_TEXT = /超出|上限|超过|开通.*会员/;

  const Panel = globalThis.PanRelayPanel;
  let settings = { ...DEFAULTS };
  let currentEngine = null;
  let running = false;
  const queue = [];
  let lastStats = { done: 0, total: 0, estimating: true };

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
  });

  function isShown(el) {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /** 百度超限后会弹付费引导；接手后把这类弹窗和遮罩收掉，免得挡住页面 */
  function dismissLimitDialogs() {
    let hidden = false;
    for (const dialog of document.querySelectorAll('.u-dialog__wrapper, .dialog, [role="dialog"]')) {
      if (Panel.contains(dialog) || !isShown(dialog)) continue;
      if (!LIMIT_DIALOG_TEXT.test(dialog.textContent || '')) continue;
      const wrapper = dialog.closest('.u-dialog__wrapper') || dialog;
      wrapper.style.setProperty('display', 'none', 'important');
      hidden = true;
    }
    if (!hidden) return;
    document.querySelectorAll('.v-modal, .module-canvas').forEach((mask) => {
      if (isShown(mask)) mask.style.setProperty('display', 'none', 'important');
    });
    if (document.body && document.body.style.overflow === 'hidden') document.body.style.overflow = '';
  }

  function watchDialogsFor(ms) {
    const observer = new MutationObserver(() => setTimeout(dismissLimitDialogs, 50));
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    dismissLimitDialogs();
    setTimeout(() => observer.disconnect(), ms);
  }

  function toSelected(detail) {
    return detail.ids.map((id, i) => {
      const item = detail.items[i] || {};
      return {
        fs_id: id,
        // 读不到类型时按目录处理：目录会被列出子项再转，文件则会在列举时报错，不会误转
        isdir: item.unknown ? 1 : Number(item.isdir) === 1 ? 1 : 0,
        server_filename: item.server_filename || `文件 ${id}`,
        path: item.path || `/${item.server_filename || id}`,
      };
    });
  }

  function buildEngine(detail) {
    const url = new URL(detail.url);
    const body = { ...detail.body };
    delete body[detail.idsKey];
    delete body.path;
    const gid = body.gid || body.group_id || '';
    return new PanRelay.GroupTransferEngine({
      fromUk: body.from_uk,
      msgId: body.msg_id,
      transferPath: url.pathname,
      transferQuery: url.search.replace(/^\?/, ''),
      transferBody: body,
      idsKey: detail.idsKey,
      // 群文件超限的 errno 与分享页的 12 不同（实测 130），以页面这次拿到的为准
      limitErrnos: [Number(detail.response?.errno || detail.response?.task_errno || 0)].filter(Boolean),
      listPath: detail.listPath || '/mbox/msg/shareinfo',
      listParams: { from_uk: body.from_uk, msg_id: body.msg_id, gid, type: '2' },
      bdstoken: url.searchParams.get('bdstoken') || body.bdstoken || '',
      batchSize: settings.batchSize,
      transferCooldownMs: settings.transferCooldownMs,
      onProgress: (msg) => {
        Panel.setStatus(msg);
        Panel.appendLog(msg);
      },
      onStats: (stats) => {
        lastStats = stats;
        if (!stats.finished) Panel.renderProgress(stats);
      },
    });
  }

  async function runOne(detail) {
    const destination = detail.body.path || '/';
    const engine = (currentEngine = buildEngine(detail));
    Panel.ensure();
    Panel.setCancel(() => engine.cancel());
    Panel.clearLog();
    Panel.appendLog('百度提示群文件超出转存上限，改由 PanRelay 分批转存');
    Panel.resetProgress();
    lastStats = { done: 0, total: 0, estimating: true };
    Panel.renderProgress(lastStats);
    try {
      await engine.runSelection(toSelected(detail), destination);
      Panel.setStatus('完成');
      Panel.renderProgress(lastStats, 'done');
    } catch (error) {
      if (error.cancelled) {
        Panel.setStatus('已取消');
        Panel.appendLog('已取消。已转存的部分会保留在你的网盘里。');
        Panel.renderProgress(lastStats, 'cancelled');
      } else {
        Panel.setStatus('失败');
        Panel.appendLog(error.message || String(error));
        Panel.renderProgress(lastStats, 'partial');
      }
    } finally {
      currentEngine = null;
      Panel.setCancel(null);
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) await runOne(queue.shift());
    } finally {
      running = false;
    }
  }

  document.addEventListener('panrelay-group-limit', (event) => {
    let detail;
    try {
      detail = JSON.parse(event.detail);
    } catch (_) {
      return;
    }
    if (!detail?.ids?.length || !settings.enabled) return;
    console.info(`[PanRelay] 接手群文件转存 ${JSON.stringify(detail)}`);
    if (!settings.unlocked) {
      PanRelayUnlockGuide.showGuide({ force: true });
      return;
    }
    watchDialogsFor(8000);
    if (running) {
      Panel.appendLog(`又一批群文件超出上限（${detail.ids.length} 项），排在当前任务之后`);
    }
    queue.push(detail);
    drain();
  });
})();
