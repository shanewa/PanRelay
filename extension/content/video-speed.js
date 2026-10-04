/**
 * 百度网盘在线视频/音频倍速：读设置、HUD，并同步到页面主世界 speed-main.js。
 */
(function () {
  'use strict';

  const { conformSpeed, formatSpeed } = PanRelayMediaSpeed;

  const DEFAULTS = {
    videoSpeedEnabled: true,
    videoSpeed: 1,
    preservePitch: true,
  };

  let settings = { ...DEFAULTS };

  function pushConfig() {
    document.dispatchEvent(
      new CustomEvent('panrelay-speed-config', {
        detail: {
          enabled: settings.videoSpeedEnabled,
          speed: conformSpeed(settings.videoSpeed),
          preservePitch: settings.preservePitch,
        },
      }),
    );
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
