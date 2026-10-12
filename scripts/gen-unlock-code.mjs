#!/usr/bin/env node
// 生成公众号自动回复用的月度解锁码。
// 算法单源引用 extension/lib/unlock.js（直接 require 执行，读全局 PanRelayUnlock），
// 两边不可能写出两份不一致的实现。每月跑一次，把当月码填到公众号关键词回复即可。
//
//   node scripts/gen-unlock-code.mjs
//   make unlock-code
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../extension/lib/unlock.js');

const { codeForMonthKey } = globalThis.PanRelayUnlock;

const now = new Date();
const center = now.getUTCFullYear() * 12 + now.getUTCMonth();

for (let delta = -1; delta <= 1; delta++) {
  const key = center + delta;
  const label = `${Math.floor(key / 12)}-${String((key % 12) + 1).padStart(2, '0')}`;
  const tag =
    delta === 0 ? '当月（填到公众号自动回复）' : delta < 0 ? '上月（容差内仍有效）' : '下月（可提前准备）';
  console.log(`${label}  ${codeForMonthKey(key)}  ${tag}`);
}
console.log('永久码 827461 一直有效，兼容已发出的自动回复。');
