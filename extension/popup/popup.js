const {
  conformSpeed,
  MIN_SPEED,
  MAX_SPEED,
  SPEED_PRESETS,
  SPEED_SMALL_STEP,
  SPEED_BIG_STEP,
} = PanRelayMediaSpeed;
const { KEYWORD, STORAGE_KEY, verifyUnlockInput, isUnlocked } = PanRelayUnlock;

const DEFAULTS = {
  enabled: true,
  batchSize: 500,
  alwaysRelay: false,
  transferCooldownMs: 1500,
  videoSpeedEnabled: true,
  videoSpeed: 1,
  preservePitch: true,
  noteMdExportEnabled: true,
  [STORAGE_KEY]: false,
};

const enabledEl = document.getElementById('enabled');
const batchSizeEl = document.getElementById('batchSize');
const alwaysRelayEl = document.getElementById('alwaysRelay');
const transferCooldownMsEl = document.getElementById('transferCooldownMs');
const cooldownLabelEl = document.getElementById('cooldownLabel');
const videoSpeedEnabledEl = document.getElementById('videoSpeedEnabled');
const videoSpeedEl = document.getElementById('videoSpeed');
const speedLabelEl = document.getElementById('speedLabel');
const preservePitchEl = document.getElementById('preservePitch');
const noteMdExportEnabledEl = document.getElementById('noteMdExportEnabled');
const speedPresetsEl = document.getElementById('speedPresets');
const speedStepRowEl = document.getElementById('speedStepRow');
const unlockGateEl = document.getElementById('unlockGate');
const settingsRootEl = document.getElementById('settingsRoot');
const unlockKeywordEl = document.getElementById('unlockKeyword');
const unlockCodeEl = document.getElementById('unlockCode');
const unlockBtnEl = document.getElementById('unlockBtn');
const unlockMsgEl = document.getElementById('unlockMsg');
const oaQrEl = document.getElementById('oaQr');

unlockKeywordEl.textContent = KEYWORD;

function setUnlockMessage(text, kind) {
  if (!text) {
    unlockMsgEl.hidden = true;
    unlockMsgEl.textContent = '';
    return;
  }
  unlockMsgEl.hidden = false;
  unlockMsgEl.className = `unlock-msg ${kind || ''}`;
  unlockMsgEl.textContent = text;
}

function renderUnlockState(unlocked) {
  unlockGateEl.hidden = unlocked;
  settingsRootEl.hidden = !unlocked;
}

function submitUnlock() {
  const value = unlockCodeEl.value;
  if (!verifyUnlockInput(value)) {
    setUnlockMessage('解锁码不正确。请确认已关注公众号并发送了关键词。', 'error');
    return;
  }
  chrome.storage.sync.set({ [STORAGE_KEY]: true }, () => {
    setUnlockMessage('已解锁，插件完全免费。', 'ok');
    renderUnlockState(true);
  });
}

function clampSpeed(v) {
  return conformSpeed(v);
}

// 滑杆位置 0～1000 到倍速的映射：500 对准 1x，两侧各走一段指数，
// 常用区间占一半行程，16x 那头再大也只占一半。
function posToSpeed(pos) {
  const p = Math.min(1000, Math.max(0, Math.round(Number(pos) || 0)));
  const speed =
    p >= 500
      ? Math.pow(MAX_SPEED, (p - 500) / 500)
      : MIN_SPEED * Math.pow(1 / MIN_SPEED, p / 500);
  return conformSpeed(speed);
}

function speedToPos(speed) {
  const s = conformSpeed(speed);
  if (s >= 1) return Math.round(500 + (500 * Math.log(s)) / Math.log(MAX_SPEED));
  return Math.round(500 * (1 - Math.log(s) / Math.log(MIN_SPEED)));
}

function formatSpeedLabel(speed) {
  return Number(speed).toFixed(2);
}

function updateLabels() {
  cooldownLabelEl.textContent = String(transferCooldownMsEl.value);
  const speed = posToSpeed(videoSpeedEl.value);
  speedLabelEl.textContent = formatSpeedLabel(speed);
  speedPresetsEl.querySelectorAll('button[data-speed]').forEach((btn) => {
    const preset = Number(btn.dataset.speed);
    btn.classList.toggle('active', Math.abs(speed - preset) < 0.005);
  });
}

SPEED_PRESETS.forEach((p) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.speed = String(p);
  btn.textContent = p.toFixed(2);
  btn.addEventListener('click', () => {
    videoSpeedEl.value = String(speedToPos(p));
    updateLabels();
    save();
  });
  speedPresetsEl.appendChild(btn);
});

function addSpeedDelta(delta) {
  const next = clampSpeed(posToSpeed(videoSpeedEl.value) + delta);
  videoSpeedEl.value = String(speedToPos(next));
  updateLabels();
  save();
}

[
  { delta: -SPEED_BIG_STEP, label: '−0.1' },
  { delta: -SPEED_SMALL_STEP, label: '−0.01' },
  { delta: SPEED_SMALL_STEP, label: '+0.01' },
  { delta: SPEED_BIG_STEP, label: '+0.1' },
].forEach(({ delta, label }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', () => addSpeedDelta(delta));
  speedStepRowEl.appendChild(btn);
});

chrome.storage.sync.get(DEFAULTS, (stored) => {
  enabledEl.checked = stored.enabled !== false;
  batchSizeEl.value = stored.batchSize || 500;
  alwaysRelayEl.checked = !!stored.alwaysRelay;
  transferCooldownMsEl.value = stored.transferCooldownMs || 1500;
  videoSpeedEnabledEl.checked = stored.videoSpeedEnabled !== false;
  videoSpeedEl.value = String(speedToPos(stored.videoSpeed ?? 1));
  preservePitchEl.checked = stored.preservePitch !== false;
  noteMdExportEnabledEl.checked = stored.noteMdExportEnabled !== false;
  updateLabels();
  renderUnlockState(isUnlocked(stored));
});

function save() {
  const batchSize = Math.min(500, Math.max(50, Number(batchSizeEl.value) || 500));
  batchSizeEl.value = batchSize;
  const transferCooldownMs = Math.min(
    6000,
    Math.max(800, Number(transferCooldownMsEl.value) || 1500),
  );
  transferCooldownMsEl.value = transferCooldownMs;
  const videoSpeed = posToSpeed(videoSpeedEl.value);
  videoSpeedEl.value = String(speedToPos(videoSpeed));
  updateLabels();
  chrome.storage.sync.set({
    enabled: enabledEl.checked,
    batchSize,
    alwaysRelay: alwaysRelayEl.checked,
    transferCooldownMs,
    videoSpeedEnabled: videoSpeedEnabledEl.checked,
    videoSpeed,
    preservePitch: preservePitchEl.checked,
    noteMdExportEnabled: noteMdExportEnabledEl.checked,
  });
}

enabledEl.addEventListener('change', save);
alwaysRelayEl.addEventListener('change', save);
batchSizeEl.addEventListener('change', save);
transferCooldownMsEl.addEventListener('input', () => {
  updateLabels();
  save();
});
videoSpeedEnabledEl.addEventListener('change', save);
videoSpeedEl.addEventListener('input', () => {
  updateLabels();
  save();
});
preservePitchEl.addEventListener('change', save);
noteMdExportEnabledEl.addEventListener('change', save);
unlockBtnEl.addEventListener('click', submitUnlock);
unlockCodeEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submitUnlock();
});
oaQrEl.addEventListener('click', () => {
  window.open(oaQrEl.src, '_blank');
});

document.getElementById('appVersion').textContent = `v${chrome.runtime.getManifest().version}`;

const contactLinkEl = document.getElementById('contactLink');
const contactOverlayEl = document.getElementById('contactOverlay');
const contactCloseEl = document.getElementById('contactClose');

function setContactOpen(open) {
  contactOverlayEl.hidden = !open;
  (open ? contactCloseEl : contactLinkEl).focus();
}

contactLinkEl.addEventListener('click', () => setContactOpen(true));
contactCloseEl.addEventListener('click', () => setContactOpen(false));
contactOverlayEl.addEventListener('click', (event) => {
  if (event.target === contactOverlayEl) setContactOpen(false);
});

const helpLinkEl = document.getElementById('helpLink');
const helpOverlayEl = document.getElementById('helpOverlay');
const helpCloseEl = document.getElementById('helpClose');

function setHelpOpen(open) {
  helpOverlayEl.hidden = !open;
  document.body.classList.toggle('help-open', open);
  (open ? helpCloseEl : helpLinkEl).focus();
}

helpLinkEl.addEventListener('click', () => setHelpOpen(true));
helpCloseEl.addEventListener('click', () => setHelpOpen(false));
helpOverlayEl.addEventListener('click', (event) => {
  if (event.target === helpOverlayEl) setHelpOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!contactOverlayEl.hidden) setContactOpen(false);
  if (!helpOverlayEl.hidden) setHelpOpen(false);
});
