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
  };

  let settings = { ...DEFAULTS };

  function buildDetail() {
    return {
      enabled: settings.videoSpeedEnabled,
      speed: conformSpeed(settings.videoSpeed),
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

  function updateHud() {
    const speed = conformSpeed(settings.videoSpeed);
    let hud = document.getElementById('panrelay-speed-hud');
    if (!settings.videoSpeedEnabled || Math.abs(speed - 1) < 0.001) {
      if (hud) hud.remove();
      return;
    }
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'panrelay-speed-hud';
      hud.title = 'PanRelay 视频倍速';
      document.documentElement.appendChild(hud);
    }
    hud.textContent = `${formatSpeed(speed)}×`;
  }

  function realize() {
    pushConfig();
    updateHud();
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    realize();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.videoSpeedEnabled) settings.videoSpeedEnabled = changes.videoSpeedEnabled.newValue;
    if (changes.videoSpeed) settings.videoSpeed = changes.videoSpeed.newValue;
    if (changes.preservePitch) settings.preservePitch = changes.preservePitch.newValue;
    realize();
  });
})();
