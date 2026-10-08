/**
 * 页面主世界：应用倍速（与网盘播放器同一 JS 环境）。
 * 配置经 localStorage + postMessage / CustomEvent 同步（含同源 iframe）。
 */
(function () {
  'use strict';

  if (window.__panRelaySpeedMain) return;
  window.__panRelaySpeedMain = true;

  const STORAGE_KEY = '__panrelay_speed__';
  const SPEED_MSG = 'panrelay-speed-config';
  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;

  let cfg = { enabled: true, speed: 1, preservePitch: true };

  const nativeRate = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'playbackRate',
  );
  const nativeDefaultRate = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'defaultPlaybackRate',
  );

  function conformSpeed(speed) {
    const n = Number(speed);
    if (!Number.isFinite(n)) return 1;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(n * 100) / 100));
  }

  function walkShadow(root, visit) {
    if (!root || !root.querySelectorAll) return;
    visit(root);
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) walkShadow(el.shadowRoot, visit);
    });
  }

  function collectMedia() {
    const list = [];
    walkShadow(document, (root) => {
      root.querySelectorAll('video, audio').forEach((el) => {
        if (el instanceof HTMLMediaElement) list.push(el);
      });
    });
    return list;
  }

  function setNativeRate(media, value) {
    try {
      if (nativeRate?.set) nativeRate.set.call(media, value);
      else media.playbackRate = value;
    } catch (_) {
      /* ignore */
    }
    try {
      if (nativeDefaultRate?.set) nativeDefaultRate.set.call(media, value);
      else media.defaultPlaybackRate = value;
    } catch (_) {
      /* ignore */
    }
  }

  function applyToMedia(media, speed, preservesPitch) {
    const value = conformSpeed(speed);
    const cur = nativeRate?.get ? nativeRate.get.call(media) : media.playbackRate;
    if (Math.abs(cur - value) > 0.001) {
      setNativeRate(media, value);
    }
    const keepPitch = preservesPitch !== false;
    try {
      media.preservesPitch = keepPitch;
      media.mozPreservesPitch = keepPitch;
      media.webkitPreservesPitch = keepPitch;
    } catch (_) {
      /* ignore */
    }
  }

  function mergeConfig(detail) {
    if (!detail || typeof detail !== 'object') return;
    if (typeof detail.enabled === 'boolean') cfg.enabled = detail.enabled;
    if (detail.speed != null) cfg.speed = detail.speed;
    if (typeof detail.preservePitch === 'boolean') cfg.preservePitch = detail.preservePitch;
  }

  function readConfigFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      mergeConfig(JSON.parse(raw));
    } catch (_) {
      /* ignore */
    }
  }

  function applyAll() {
    readConfigFromStorage();
    if (!cfg.enabled) return;
    const speed = conformSpeed(cfg.speed);
    collectMedia().forEach((m) => applyToMedia(m, speed, cfg.preservePitch));
  }

  let realizeTimer = 0;
  function scheduleApply() {
    if (realizeTimer) return;
    realizeTimer = window.setTimeout(() => {
      realizeTimer = 0;
      applyAll();
    }, 80);
  }

  document.addEventListener(
    'panrelay-speed-config',
    (event) => {
      mergeConfig(event.detail || {});
      applyAll();
    },
    false,
  );

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== SPEED_MSG || data.source !== 'panrelay-speed-isolated') return;
    mergeConfig(data.detail || {});
    applyAll();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) scheduleApply();
  });

  const mediaEvents = ['play', 'playing', 'loadedmetadata', 'ratechange', 'emptied', 'canplay'];
  mediaEvents.forEach((type) => {
    document.addEventListener(
      type,
      (e) => {
        if (e.target instanceof HTMLMediaElement) scheduleApply();
      },
      true,
    );
  });

  readConfigFromStorage();
  applyAll();
  setInterval(applyAll, 800);
})();
