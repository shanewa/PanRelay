#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const py = join(dirname(fileURLToPath(import.meta.url)), 'generate_icons.py');
const wslPy = py.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);

try {
  execSync(`wsl python3 "${wslPy}"`, { stdio: 'inherit' });
} catch {
  execSync(`python3 "${py}"`, { stdio: 'inherit' });
}
