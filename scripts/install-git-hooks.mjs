#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const src = join(scriptDir, "git-hooks");
const dst = join(root, ".git", "hooks");
const authorName = "Shane Wang";
const authorEmail = "shanewa@qq.com";

execSync(`git config user.name "${authorName}"`, { cwd: root });
execSync(`git config user.email "${authorEmail}"`, { cwd: root });
console.log(`Set local git user.name=${authorName}, user.email=${authorEmail}`);

for (const name of readdirSync(src)) {
  const from = join(src, name);
  if (!statSync(from).isFile()) continue;
  const content = readFileSync(from, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const dest = join(dst, name);
  writeFileSync(dest, content, "utf8");
  try {
    execSync(`chmod +x "${dest}"`);
  } catch {
    // Windows
  }
  console.log(`Installed ${name}`);
}

console.log(`Git hooks installed to ${dst}`);
