#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/parse-baidu-share-html.mjs <saved.html>');
  process.exit(1);
}
const t = fs.readFileSync(file, 'utf8');

const yunMatch = t.match(/yunData\s*=\s*(\{[^;]+\});/);
if (yunMatch) {
  console.log('--- yunData (raw) ---');
  console.log(yunMatch[1]);
}

const localsIdx = t.indexOf('locals.mset(');
if (localsIdx >= 0) {
  const chunk = t.slice(localsIdx, localsIdx + 12000);
  const shareid = chunk.match(/"shareid"\s*:\s*(\d+)/);
  const shareUk = chunk.match(/"share_uk"\s*:\s*"([^"]+)"/);
  const fileListIdx = chunk.indexOf('"file_list"');
  console.log('\n--- locals (partial) ---');
  console.log('shareid', shareid?.[1], 'share_uk', shareUk?.[1]);
  if (fileListIdx >= 0) {
    console.log(chunk.slice(fileListIdx, fileListIdx + 2500));
  }
}

const paths = [];
const re = /"path"\s*:\s*"([^"]+)"/g;
let m;
while ((m = re.exec(t)) && paths.length < 8) {
  paths.push(m[1]);
}
console.log('\n--- sample path fields ---');
paths.forEach((p) => console.log(p));

const parent = t.match(/"parent_path"\s*:\s*"([^"]+)"/);
console.log('\n--- first parent_path ---');
console.log(parent?.[1] || 'n/a');
