#!/usr/bin/env node
/**
 * 工作区有改动时自动 git add + commit（供 Cursor hooks 调用，带防抖）。
 * 手动：node scripts/auto-commit.mjs --force
 */
import { execSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const debounceMs = Number(process.env.PANRELAY_COMMIT_DEBOUNCE_MS || 8000);
const debounceFile = join(root, ".git", "panrelay-auto-commit-until");
const force = process.argv.includes("--force");
const flush = process.argv.includes("--flush");

const SKIP_PREFIXES = [".env", ".env.", "node_modules/"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function porcelainPaths() {
  const out = run("git status --porcelain").trim();
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.slice(3).trim().replace(/^"(.+)"$/, "$1"))
    .filter((path) => path && !SKIP_PREFIXES.some((p) => path === p || path.startsWith(p)));
}

function buildMessage(paths) {
  const unique = [...new Set(paths)].slice(0, 12);
  const bullets = unique.map((p) => `- 更新 \`${p}\``);
  if (paths.length > unique.length) {
    bullets.push(`- 另有 ${paths.length - unique.length} 个路径`);
  }
  return `自动保存工作区改动\n\n${bullets.join("\n")}\n`;
}

async function commitNow() {
  const paths = porcelainPaths();
  if (!paths.length) return false;

  const add = spawnSync("git", ["add", "--", ...paths], { cwd: root, encoding: "utf8" });
  if (add.status !== 0) {
    throw new Error(add.stderr || add.stdout || "git add failed");
  }

  const staged = run("git diff --cached --name-only").trim();
  if (!staged) return false;

  const msg = buildMessage(staged.split("\n").filter(Boolean));
  const msgFile = join(root, ".git", "PANRELAY_COMMIT_MSG.txt");
  writeFileSync(msgFile, msg, "utf8");
  execSync(`git commit -F "${msgFile}"`, { cwd: root, stdio: "inherit" });
  try {
    unlinkSync(msgFile);
  } catch {
    /* ignore */
  }
  return true;
}

function scheduleFlush() {
  const until = Date.now() + debounceMs;
  writeFileSync(debounceFile, String(until), "utf8");
  const child = spawn(process.execPath, [scriptPath, "--flush"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function flushDebounced() {
  await sleep(debounceMs);
  if (!existsSync(debounceFile)) return;
  const until = parseInt(readFileSync(debounceFile, "utf8"), 10) || 0;
  if (Date.now() < until) return;
  try {
    unlinkSync(debounceFile);
  } catch {
    /* ignore */
  }
  await commitNow();
}

if (flush) {
  flushDebounced().catch((err) => {
    console.error("auto-commit flush:", err.message || err);
    process.exit(1);
  });
} else if (force) {
  commitNow()
    .then((ok) => process.exit(ok ? 0 : 0))
    .catch((err) => {
      console.error("auto-commit:", err.message || err);
      process.exit(1);
    });
} else {
  if (!porcelainPaths().length) process.exit(0);
  scheduleFlush();
}
