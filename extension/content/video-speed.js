/**
 * 百度网盘在线视频/音频倍速（参考 Global Speed 的 SpeedSync.realize + MediaTower.applySpeedToAll）
 */
(function () {
  'use strict';

  const { conformSpeed, formatSpeed, applyPlaybackRate, collectMediaElements } =
    PanRelayMediaSpeed;

  const DEFAULTS = {
    videoSpeedEnabled: true,
    videoSpeed: 1,
    preservePitch: true,
  };

  let settings = { ...DEFAULTS };
  const bound = new WeakSet();

  function realize() {
    if (!settings.videoSpeedEnabled) return;
    const speed = conformSpeed(settings.videoSpeed);
    collectMediaElements(document).forEach((media) => {
      bindMedia(media);
      applyPlaybackRate(media, speed, settings.preservePitch);
    });
    updateHud(speed);
  }

  function bindMedia(media) {
    if (bound.has(media)) return;
    bound.add(media);
    const events = ['play', 'playing', 'loadedmetadata', 'ratechange', 'emptied'];
    events.forEach((type) => {
      media.addEventListener(type, () => realize(), { passive: true });
    });
  }

  function updateHud(speed) {
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

  const observer = new MutationObserver(() => realize());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(realize, 1000);

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
