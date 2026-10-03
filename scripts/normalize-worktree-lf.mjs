#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".wav", ".m4a", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".gz", ".zip", ".jar", ".pdf",
]);

function targetsFromGitEol() {
  const out = execSync("git ls-files --eol", { encoding: "utf8" });
  const files = [];
  for (const line of out.split("\n")) {
    if (!line.includes("w/crlf")) continue;
    const tab = line.lastIndexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1).trim();
    if (!path) continue;
    const lower = path.toLowerCase();
    const dot = lower.lastIndexOf(".");
    const ext = dot >= 0 ? lower.slice(dot) : "";
    if (BINARY_EXT.has(ext)) continue;
    files.push(path);
  }
  return files;
}

let fixed = 0;
for (const file of targetsFromGitEol()) {
  try {
    const raw = readFileSync(file);
    if (!raw.includes(0x0d)) continue;
    const text = raw.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    writeFileSync(file, text, "utf8");
    fixed += 1;
  } catch {
    /* skip */
  }
}

console.log(`Normalized ${fixed} tracked file(s) to LF in the working tree.`);
