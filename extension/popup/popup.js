const DEFAULTS = { enabled: true, batchSize: 500, alwaysRelay: false };

const enabledEl = document.getElementById('enabled');
const batchSizeEl = document.getElementById('batchSize');
const alwaysRelayEl = document.getElementById('alwaysRelay');

chrome.storage.sync.get(DEFAULTS, (stored) => {
  enabledEl.checked = stored.enabled !== false;
  batchSizeEl.value = stored.batchSize || 500;
  alwaysRelayEl.checked = !!stored.alwaysRelay;
});

function save() {
  const batchSize = Math.min(500, Math.max(50, Number(batchSizeEl.value) || 500));
  batchSizeEl.value = batchSize;
  chrome.storage.sync.set({
    enabled: enabledEl.checked,
    batchSize,
    alwaysRelay: alwaysRelayEl.checked,
  });
}

enabledEl.addEventListener('change', save);
alwaysRelayEl.addEventListener('change', save);
batchSizeEl.addEventListener('change', save);
