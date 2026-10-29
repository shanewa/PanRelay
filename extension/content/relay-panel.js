/**
 * 右下角的接力转存面板：分享页和群文件库共用。
 */
(function () {
  'use strict';

  const COLLAPSED_KEY = 'panrelay-panel-collapsed';
  const formatCount = (n) => n.toLocaleString('zh-CN');

  let panelEl = null;
  let cancelHandler = null;

  function ensure() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'panrelay-panel';
    panelEl.innerHTML =
      '<div class="panrelay-panel-inner">' +
      '<div class="panrelay-header">' +
      '<div class="panrelay-title">PanRelay 接力转存</div>' +
      '<div class="panrelay-actions">' +
      '<button type="button" class="panrelay-cancel" hidden>取消</button>' +
      '<button type="button" class="panrelay-toggle" aria-expanded="true"></button>' +
      '</div>' +
      '</div>' +
      '<div class="panrelay-progress" hidden>' +
      '<div class="panrelay-progress-meta">' +
      '<span class="panrelay-progress-pct"></span>' +
      '<span class="panrelay-progress-count"></span>' +
      '</div>' +
      '<div class="panrelay-progress-track" role="progressbar" aria-label="转存进度" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="panrelay-progress-fill"></div>' +
      '</div>' +
      '</div>' +
      '<div class="panrelay-status">就绪</div>' +
      '<div class="panrelay-log"></div>' +
      '</div>';
    panelEl.querySelector('.panrelay-cancel').addEventListener('click', () => {
      if (!cancelHandler) return;
      const btn = panelEl.querySelector('.panrelay-cancel');
      btn.disabled = true;
      btn.textContent = '正在取消…';
      setStatus('正在取消…');
      cancelHandler();
    });
    panelEl.querySelector('.panrelay-toggle').addEventListener('click', () => {
      setCollapsed(!panelEl.classList.contains('is-collapsed'));
    });
    document.documentElement.appendChild(panelEl);
    setCollapsed(readCollapsedPref());
    return panelEl;
  }

  function readCollapsedPref() {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  /** 收起后只留标题和进度条，不挡页面 */
  function setCollapsed(collapsed) {
    panelEl.classList.toggle('is-collapsed', collapsed);
    const btn = panelEl.querySelector('.panrelay-toggle');
    btn.textContent = collapsed ? '展开' : '收起';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开转存详情' : '收起到角落，进度仍可见';
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_) {
      /* 存不了就只在本页生效 */
    }
  }

  /** 传入取消时要执行的函数则显示「取消」按钮，传 null 隐藏 */
  function setCancel(handler) {
    cancelHandler = handler;
    const btn = ensure().querySelector('.panrelay-cancel');
    btn.hidden = !handler;
    btn.disabled = false;
    btn.textContent = '取消';
  }

  function setStatus(text) {
    ensure().querySelector('.panrelay-status').textContent = text;
  }

  /** state: running | done | partial | cancelled */
  function renderProgress(stats, state = 'running') {
    const box = ensure().querySelector('.panrelay-progress');
    const pctEl = box.querySelector('.panrelay-progress-pct');
    const countEl = box.querySelector('.panrelay-progress-count');
    const track = box.querySelector('.panrelay-progress-track');
    const fill = box.querySelector('.panrelay-progress-fill');
    box.hidden = false;
    const measuring = state === 'running' && (stats.estimating || !stats.total);
    box.dataset.state = measuring ? 'measuring' : state;
    if (measuring) {
      pctEl.textContent = '统计中';
      countEl.textContent = stats.done ? `已转存 ${formatCount(stats.done)} 个文件` : '正在计算文件总数…';
      fill.style.width = '';
      track.removeAttribute('aria-valuenow');
      return;
    }
    if (!stats.total && state !== 'done') {
      pctEl.textContent = '—';
      countEl.textContent = '';
      fill.style.width = '0%';
      return;
    }
    const ratio = stats.total ? stats.done / stats.total : 1;
    // 估算值不到最后不显示 100%
    const pct = state === 'running' ? Math.min(99, Math.floor(ratio * 100)) : Math.round(ratio * 100);
    pctEl.textContent = `${pct}%`;
    countEl.textContent =
      state === 'done'
        ? `共 ${formatCount(stats.total)} 个文件`
        : `约 ${formatCount(stats.done)} / ${formatCount(stats.total)} 个文件`;
    fill.style.width = `${Math.max(2, pct)}%`;
    track.setAttribute('aria-valuenow', String(pct));
  }

  function resetProgress() {
    const box = ensure().querySelector('.panrelay-progress');
    box.hidden = true;
    box.querySelector('.panrelay-progress-fill').style.width = '';
  }

  function clearLog() {
    ensure().querySelector('.panrelay-log').replaceChildren();
  }

  function appendLog(text) {
    const log = ensure().querySelector('.panrelay-log');
    const line = document.createElement('div');
    line.className = 'panrelay-log-line';
    line.textContent = text;
    log.appendChild(line);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function contains(node) {
    return !!panelEl && panelEl.contains(node);
  }

  globalThis.PanRelayPanel = {
    ensure,
    setCancel,
    setStatus,
    renderProgress,
    resetProgress,
    clearLog,
    appendLog,
    contains,
  };
})();
