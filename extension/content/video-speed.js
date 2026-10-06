/**
 * 读扩展设置、HUD；经 localStorage + 主世界脚本事件同步到 speed-main.js。
 */
(function () {
  'use strict';

  const { conformSpeed, formatSpeed } = PanRelayMediaSpeed;

  const STORAGE_KEY = '__panrelay_speed__';

  const DEFAULTS = {
    videoSpeedEnabled: true,
    videoSpeed: 1,
    preservePitch: true,
    unlocked: false,
  };

  let settings = { ...DEFAULTS };

  function buildDetail() {
    const unlocked = !!settings.unlocked;
    return {
      enabled: unlocked && settings.videoSpeedEnabled,
      speed: unlocked ? conformSpeed(settings.videoSpeed) : 1,
      preservePitch: settings.preservePitch,
      ts: Date.now(),
    };
  }

  /** isolated world 的 CustomEvent 主世界收不到，须注入脚本派发 */
  function pushConfigToPage(detail) {
    const payload = JSON.stringify(detail).replace(/</g, '\\u003c');
    const el = document.createElement('script');
    el.textContent = `document.dispatchEvent(new CustomEvent('panrelay-speed-config',{detail:${payload}}));`;
    (document.documentElement || document.head || document.body).appendChild(el);
    el.remove();
  }

  function pushConfig() {
    const detail = buildDetail();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(detail));
    } catch (_) {
      /* ignore */
    }
    pushConfigToPage(detail);
  }

  function findVolumeGroup(root) {
    const icon = root.querySelector(
      '.vp-video__control-bar--button.is-icon .u-icon-volume',
    );
    if (icon) {
      return icon.closest('.vp-video__control-bar--button-group');
    }
    const mute = root.querySelector('.vp-video-volume-panel, .vjs-volume-panel');
    return mute || null;
  }

  function ensureHudHost() {
    const volumeGroup = findVolumeGroup(document);
    if (!volumeGroup || !volumeGroup.parentNode) return null;

    let wrap = document.getElementById('panrelay-speed-hud-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'panrelay-speed-hud-wrap';
      wrap.className = 'vp-video__control-bar--button-group';
    }
    if (wrap.nextElementSibling !== volumeGroup || wrap.parentNode !== volumeGroup.parentNode) {
      volumeGroup.parentNode.insertBefore(wrap, volumeGroup);
    }
    wrap.classList.toggle(
      'vp-video__control-bar--button-group',
      volumeGroup.classList.contains('vp-video__control-bar--button-group'),
    );
    return wrap;
  }

  function updateHud() {
    const speed = conformSpeed(settings.videoSpeed);
    const hide =
      !settings.unlocked || !settings.videoSpeedEnabled || Math.abs(speed - 1) < 0.001;
    const existing = document.getElementById('panrelay-speed-hud');
    const wrapExisting = document.getElementById('panrelay-speed-hud-wrap');
    if (hide) {
      if (existing) existing.remove();
      if (wrapExisting) wrapExisting.remove();
      return;
    }

    const host = ensureHudHost();
    if (!host) return;

    let hud = document.getElementById('panrelay-speed-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'panrelay-speed-hud';
      hud.title = 'PanRelay 倍速（在扩展弹窗调节）';
    }
    const inPlayerBar = host.classList.contains('vp-video__control-bar--button-group');
    hud.className = inPlayerBar
      ? 'vp-video__control-bar--button is-text'
      : 'panrelay-speed-hud--fallback';
    hud.textContent = `${formatSpeed(speed)}x`;
    if (hud.parentNode !== host) host.appendChild(hud);
  }

  function realize() {
    pushConfig();
    updateHud();
  }

  setInterval(updateHud, 1000);

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    realize();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.videoSpeedEnabled) settings.videoSpeedEnabled = changes.videoSpeedEnabled.newValue;
    if (changes.videoSpeed) settings.videoSpeed = changes.videoSpeed.newValue;
    if (changes.preservePitch) settings.preservePitch = changes.preservePitch.newValue;
    if (changes.unlocked) settings.unlocked = changes.unlocked.newValue;
    realize();
  });
})();
