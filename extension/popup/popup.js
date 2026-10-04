const { conformSpeed, formatSpeed, SPEED_PRESETS, SPEED_SMALL_STEP, SPEED_BIG_STEP } =
  PanRelayMediaSpeed;

const DEFAULTS = {
  enabled: true,
  batchSize: 500,
  alwaysRelay: false,
  transferCooldownMs: 1500,
  videoSpeedEnabled: true,
  videoSpeed: 1,
  preservePitch: true,
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
const speedPresetsEl = document.getElementById('speedPresets');
const speedStepRowEl = document.getElementById('speedStepRow');

function clampSpeed(v) {
  return conformSpeed(v);
}

function formatSpeedLabel(speed) {
  const fixed = formatSpeed(speed);
  if (fixed.includes('.')) return fixed;
  return `${fixed}.0`;
}

function updateLabels() {
  cooldownLabelEl.textContent = String(transferCooldownMsEl.value);
  const speed = clampSpeed(videoSpeedEl.value);
  speedLabelEl.textContent = formatSpeedLabel(speed);
  speedPresetsEl.querySelectorAll('button[data-speed]').forEach((btn) => {
    const preset = Number(btn.dataset.speed);
    btn.classList.toggle('active', Math.abs(speed - preset) < 0.001);
  });
}

SPEED_PRESETS.forEach((p) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.speed = String(p);
  btn.textContent = p.toFixed(2);
  btn.addEventListener('click', () => {
    videoSpeedEl.value = String(p);
    updateLabels();
    save();
  });
  speedPresetsEl.appendChild(btn);
});

function addSpeedDelta(delta) {
  videoSpeedEl.value = String(clampSpeed(Number(videoSpeedEl.value) + delta));
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
  videoSpeedEl.value = stored.videoSpeed ?? 1;
  preservePitchEl.checked = stored.preservePitch !== false;
  updateLabels();
});

function save() {
  const batchSize = Math.min(500, Math.max(50, Number(batchSizeEl.value) || 500));
  batchSizeEl.value = batchSize;
  const transferCooldownMs = Math.min(
    6000,
    Math.max(800, Number(transferCooldownMsEl.value) || 1500),
  );
  transferCooldownMsEl.value = transferCooldownMs;
  const videoSpeed = clampSpeed(videoSpeedEl.value);
  videoSpeedEl.value = videoSpeed;
  updateLabels();
  chrome.storage.sync.set({
    enabled: enabledEl.checked,
    batchSize,
    alwaysRelay: alwaysRelayEl.checked,
    transferCooldownMs,
    videoSpeedEnabled: videoSpeedEnabledEl.checked,
    videoSpeed,
    preservePitch: preservePitchEl.checked,
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
