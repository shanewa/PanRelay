/**
 * 关注公众号解锁（插件免费）。
 *
 * 双轨制（更新解锁码不用发版）：
 * 1. 永久码 827461：兼容已经发出去的公众号自动回复，一直有效。
 * 2. 月度码：由 ROTATE_SECRET + 年月算出的 6 位数字，每月初自动轮换。
 *    每月跑一次 `node scripts/gen-unlock-code.mjs`，把当月码填到公众号
 *    关键词「百度网盘插件」的自动回复里即可，插件用用户本机时间验证。
 *    校验允许前后 1 个月容差（跨月、时钟偏差不断）。
 *
 * 注意：ROTATE_SECRET 随插件包发布，懂行者解包可算出月度码。
 * 这道门是关注漏斗，不是版权保护，不要靠它做强安全。
 */
(function (root) {
  'use strict';

  const KEYWORD = '百度网盘插件';
  const STORAGE_KEY = 'unlocked';
  const LEGACY_CODE = '827461';
  const ROTATE_SECRET = 'PanRelay-oa-2026-rotate-7d2k';
  const GRACE_MONTHS = 1;

  function fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function monthKey(date) {
    return date.getUTCFullYear() * 12 + date.getUTCMonth();
  }

  function codeForMonthKey(key) {
    return String(fnv1a32(`${ROTATE_SECRET}:${key}`) % 1000000).padStart(6, '0');
  }

  function monthlyCodes(now) {
    const center = monthKey(now instanceof Date ? now : new Date());
    const codes = [];
    for (let delta = -GRACE_MONTHS; delta <= GRACE_MONTHS; delta++) {
      codes.push(codeForMonthKey(center + delta));
    }
    return codes;
  }

  function extractCode(input) {
    const digits = String(input || '').replace(/\D/g, '');
    const match = digits.match(/\d{6}/);
    return match ? match[0] : '';
  }

  function verifyUnlockInput(input, now) {
    const code = extractCode(input);
    if (!code) return false;
    if (code === LEGACY_CODE) return true;
    return monthlyCodes(now).includes(code);
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
    monthlyCodes,
    codeForMonthKey,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
