/**
 * 网盘页引导：未解锁时展示二维码与解锁码输入，避免用户不知道要关注公众号。
 */
(function () {
  'use strict';

  const { KEYWORD, STORAGE_KEY, verifyUnlockInput } = PanRelayUnlock;
  const DISMISS_KEY = 'panrelay-unlock-guide-dismissed';
  const QR_URL = chrome.runtime.getURL('assets/wechat-oa-qr.jpg');

  function removeGuide() {
    const el = document.getElementById('panrelay-unlock-guide');
    if (el) el.remove();
  }

  function showGuide() {
    if (document.getElementById('panrelay-unlock-guide')) return;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

    const root = document.createElement('div');
    root.id = 'panrelay-unlock-guide';
    root.innerHTML =
      '<div class="panrelay-unlock-guide-inner">' +
      '<button type="button" class="panrelay-unlock-guide-close" aria-label="稍后">×</button>' +
      '<div class="panrelay-unlock-guide-title">PanRelay 需要先关注公众号</div>' +
      '<p class="panrelay-unlock-guide-desc">插件完全免费。关注后遇到问题可直接给作者发消息，方便我们改进。</p>' +
      '<ol class="panrelay-unlock-guide-steps">' +
      '<li>微信扫描下方二维码关注</li>' +
      '<li>发送「' +
      KEYWORD +
      '」</li>' +
      '<li>把回复的 6 位数字填入</li>' +
      '</ol>' +
      '<img class="panrelay-unlock-guide-qr" alt="公众号二维码" />' +
      '<input class="panrelay-unlock-guide-input" type="text" inputmode="numeric" maxlength="12" placeholder="6 位解锁码" autocomplete="off" />' +
      '<button type="button" class="panrelay-unlock-guide-btn">解锁</button>' +
      '<p class="panrelay-unlock-guide-msg" hidden></p>' +
      '<p class="panrelay-unlock-guide-foot">也可点击浏览器工具栏的 PanRelay 图标填写</p>' +
      '</div>';

    const img = root.querySelector('.panrelay-unlock-guide-qr');
    img.src = QR_URL;
    const input = root.querySelector('.panrelay-unlock-guide-input');
    const btn = root.querySelector('.panrelay-unlock-guide-btn');
    const msg = root.querySelector('.panrelay-unlock-guide-msg');
    const close = root.querySelector('.panrelay-unlock-guide-close');

    function setMsg(text, ok) {
      if (!text) {
        msg.hidden = true;
        return;
      }
      msg.hidden = false;
      msg.classList.toggle('is-ok', !!ok);
      msg.textContent = text;
    }

    function submit() {
      if (!verifyUnlockInput(input.value)) {
        setMsg('解锁码不正确。请确认已关注并发送了关键词。', false);
        return;
      }
      chrome.storage.sync.set({ [STORAGE_KEY]: true }, () => {
        setMsg('已解锁，可以使用接力转存和倍速。', true);
        window.setTimeout(removeGuide, 800);
      });
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    close.addEventListener('click', () => {
      sessionStorage.setItem(DISMISS_KEY, '1');
      removeGuide();
    });

    document.documentElement.appendChild(root);
  }

  chrome.storage.sync.get({ [STORAGE_KEY]: false }, (stored) => {
    if (stored[STORAGE_KEY] === true) return;
    const mount = () => showGuide();
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    if (changes[STORAGE_KEY].newValue === true) removeGuide();
  });
})();
