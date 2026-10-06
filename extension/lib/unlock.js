/**
 * 关注公众号解锁（插件免费）。
 *
 * 公众号自动回复请配置：
 *   关键词：百度网盘插件
 *   回复：827461
 */
(function (root) {
  'use strict';

  const KEYWORD = '百度网盘插件';
  const STORAGE_KEY = 'unlocked';
  const CODE_PARTS = [8, 2, 7, 4, 6, 1];

  function expectedCode() {
    return CODE_PARTS.join('');
  }

  function extractCode(input) {
    const digits = String(input || '').replace(/\D/g, '');
    const match = digits.match(/\d{6}/);
    return match ? match[0] : '';
  }

  function verifyUnlockInput(input) {
    return extractCode(input) === expectedCode();
  }

  function isUnlocked(stored) {
    return stored && stored[STORAGE_KEY] === true;
  }

  root.PanRelayUnlock = {
    KEYWORD,
    STORAGE_KEY,
    extractCode,
    verifyUnlockInput,
    isUnlocked,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
