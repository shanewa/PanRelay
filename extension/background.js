/**
 * 工具栏角标：未解锁时提示「关注」，避免装完扩展却不知道要扫码。
 */
function syncBadge(unlocked) {
  if (unlocked) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'PanRelay 度盘接力存' });
    return;
  }
  chrome.action.setBadgeText({ text: '关注' });
  chrome.action.setBadgeBackgroundColor({ color: '#0284c7' });
  chrome.action.setTitle({
    title: 'PanRelay：请先点图标，扫码关注公众号解锁（免费）',
  });
}

function refreshFromStorage() {
  chrome.storage.sync.get({ unlocked: false }, (stored) => {
    syncBadge(stored.unlocked === true);
  });
}

chrome.runtime.onInstalled.addListener(refreshFromStorage);
chrome.runtime.onStartup.addListener(refreshFromStorage);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.unlocked) return;
  syncBadge(changes.unlocked.newValue === true);
});
refreshFromStorage();
