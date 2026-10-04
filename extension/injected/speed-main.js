/**
 * 页面主世界：应用倍速（与网盘播放器同一 JS 环境，避免 isolated world 无效）。
 */
(function () {
  'use strict';

  if (window.__panRelaySpeedMain) return;
  window.__panRelaySpeedMain = true;

  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;

  let cfg = { enabled: true, speed: 1, preservePitch: true };
  let ghostActive = false;

  const ogDesc = {
    playbackRate: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate'),
    defaultPlaybackRate: Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'defaultPlaybackRate',
    ),
  };
  const coherence = {
    playbackRate: new WeakMap(),
    defaultPlaybackRate: new WeakMap(),
  };
  const dummyAudio = new Audio();

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

  function applyToMedia(media, speed, preservesPitch) {
    const value = conformSpeed(speed);
    try {
      if (Math.abs(media.playbackRate - value) > 0.001) {
        media.playbackRate = value;
      }
    } catch (_) {
      /* ignore */
    }
    try {
      if (Math.abs(media.defaultPlaybackRate - value) > 0.001) {
        media.defaultPlaybackRate = value;
      }
    } catch (_) {
      /* ignore */
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

  function installGhostHook() {
    if (!ogDesc.playbackRate || !ogDesc.defaultPlaybackRate) return;
    for (const key of ['playbackRate', 'defaultPlaybackRate']) {
      const desc = ogDesc[key];
      const map = coherence[key];
      try {
        Object.defineProperty(HTMLMediaElement.prototype, key, {
          configurable: true,
          enumerable: true,
          get() {
            if (ghostActive && map.has(this)) {
              return map.get(this);
            }
            return desc.get.call(this);
          },
          set(newValue) {
            if (ghostActive) {
              try {
                desc.set.call(dummyAudio, newValue);
                const rate = desc.get.call(dummyAudio);
                map.set(this, rate);
              } catch (err) {
                throw err;
              }
              return;
            }
            return desc.set.call(this, newValue);
          },
        });
      } catch (_) {
        /* ignore */
      }
    }
  }

  function setGhostActive(active) {
    if (active === ghostActive) return;
    ghostActive = active;
    if (active) {
      collectMedia().forEach((m) => {
        coherence.playbackRate.set(m, ogDesc.playbackRate.get.call(m));
        coherence.defaultPlaybackRate.set(m, ogDesc.defaultPlaybackRate.get.call(m));
      });
    }
  }

  function shouldUseGhost() {
    return cfg.enabled && Math.abs(conformSpeed(cfg.speed) - 1) > 0.001;
  }

  function applyAll() {
    if (!cfg.enabled) {
      setGhostActive(false);
      return;
    }
    const speed = conformSpeed(cfg.speed);
    setGhostActive(shouldUseGhost());
    collectMedia().forEach((m) => applyToMedia(m, speed, cfg.preservePitch));
  }

  let realizeTimer = 0;
  function scheduleApply() {
    if (realizeTimer) return;
    realizeTimer = window.setTimeout(() => {
      realizeTimer = 0;
      applyAll();
    }, 120);
  }

  document.addEventListener(
    'panrelay-speed-config',
    (event) => {
      const detail = event.detail || {};
      if (typeof detail.enabled === 'boolean') cfg.enabled = detail.enabled;
      if (detail.speed != null) cfg.speed = detail.speed;
      if (typeof detail.preservePitch === 'boolean') cfg.preservePitch = detail.preservePitch;
      applyAll();
    },
    false,
  );

  const mediaEvents = ['play', 'playing', 'loadedmetadata', 'ratechange', 'emptied'];
  mediaEvents.forEach((type) => {
    document.addEventListener(type, (e) => {
      if (e.target instanceof HTMLMediaElement) scheduleApply();
    }, true);
  });

  installGhostHook();
  setInterval(applyAll, 1000);
})();
