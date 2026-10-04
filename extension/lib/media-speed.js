/**
 * 媒体倍速工具：限速区间与 playbackRate 同步。
 */
(function (root) {
  'use strict';

  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;

  function conformSpeed(speed) {
    const n = Number(speed);
    if (!Number.isFinite(n)) return 1;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(n * 100) / 100));
  }

  function formatSpeed(speed) {
    const s = conformSpeed(speed).toFixed(2);
    return s.endsWith('0') ? s.slice(0, -1) : s;
  }

  function applyPlaybackRate(media, speed, preservesPitch) {
    if (!media || !(media instanceof HTMLMediaElement)) return;
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

  function walkShadow(root, visit) {
    if (!root || !root.querySelectorAll) return;
    visit(root);
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) walkShadow(el.shadowRoot, visit);
    });
  }

  function collectMediaElements(doc) {
    const list = [];
    walkShadow(doc, (root) => {
      root.querySelectorAll('video, audio').forEach((el) => {
        if (el instanceof HTMLMediaElement) list.push(el);
      });
    });
    return list;
  }

  root.PanRelayMediaSpeed = {
    MIN_SPEED,
    MAX_SPEED,
    conformSpeed,
    formatSpeed,
    applyPlaybackRate,
    collectMediaElements,
    /** 与 Global Speed 默认 speedPresets 一致（12 个，弹窗 3×4 网格） */
    SPEED_PRESETS: [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 16],
    SPEED_SMALL_STEP: 0.01,
    SPEED_BIG_STEP: 0.1,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
