#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const py = join(dirname(fileURLToPath(import.meta.url)), 'generate_icons.py');
const isWin = process.platform === 'win32';
const candidates = isWin
  ? [['python'], ['py', '-3'], ['python3']]
  : [['python3'], ['python']];

for (const cmd of candidates) {
  const r = spawnSync(cmd[0], [...cmd.slice(1), py], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (r.status === 0) process.exit(0);
}

console.error('未找到可用的 Python，请安装后执行：');
console.error(`  python "${py}"`);
process.exit(1);
