#!/usr/bin/env node
/**
 * Cursor hook 入口：读取 stdin 后调度 scripts/auto-commit.mjs（防抖）。
 */
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hookDir = dirname(fileURLToPath(import.meta.url));
const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const script = join(root, "scripts", "auto-commit.mjs");

async function drainStdin() {
  const rl = createInterface({ input: process.stdin });
  for await (const _line of rl) {
    /* consume hook JSON */
  }
}

await drainStdin();

const child = spawn(process.execPath, [script], {
  cwd: root,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref();
