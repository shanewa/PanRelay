#!/usr/bin/env node
/**
 * 将 extension/ 打成商店可提交的 zip：压缩包根目录即为 manifest.json（无嵌套 extension/ 文件夹）。
 * 用法：node scripts/pack-extension.mjs [--check-only] [--list-only]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const DIST_DIR = path.join(ROOT, 'dist');

/** 打进 zip 的白名单（与 manifest 引用一致，勿含开发杂物） */
const PACK_ROOT_FILES = ['manifest.json', 'background.js'];
const PACK_DIRS = ['assets', 'content', 'icons', 'injected', 'lib', 'popup', 'styles'];

const REMOTE_SCRIPT_RE =
  /<script[^>]+src\s*=\s*["']https?:\/\/[^"']+["']/gi;
const REMOTE_IMPORT_RE = /\bimport\s*\(\s*["']https?:\/\//;
const JS_REMOTE_RE = /(?:import\s+[\s\S]*?from\s+|require\s*\(\s*)["']https?:\/\//;

function readVersion() {
  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.version || '0.0.0';
}

function collectPackFiles() {
  const files = [];
  for (const name of PACK_ROOT_FILES) {
    const abs = path.join(EXT_DIR, name);
    if (!fs.existsSync(abs)) {
      throw new Error(`缺少打包文件：extension/${name}`);
    }
    files.push(name);
  }
  for (const dir of PACK_DIRS) {
    const absDir = path.join(EXT_DIR, dir);
    if (!fs.existsSync(absDir)) {
      throw new Error(`缺少打包目录：extension/${dir}`);
    }
    walkDir(absDir, (relFromExt) => files.push(relFromExt));
  }
  return files.sort();
}

function walkDir(absDir, onFile) {
  const base = EXT_DIR;
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (ent.name === '.DS_Store' || ent.name === 'Thumbs.db') continue;
    const abs = path.join(absDir, ent.name);
    const rel = path.relative(base, abs).replace(/\\/g, '/');
    if (ent.isDirectory()) walkDir(abs, onFile);
    else onFile(rel);
  }
}

function listExtensionExtras(packedSet) {
  const extras = [];
  function walk(abs, prefix) {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === '.DS_Store' || ent.name === 'Thumbs.db') continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const absPath = path.join(abs, ent.name);
      if (ent.isDirectory()) walk(absPath, rel);
      else if (!packedSet.has(rel.replace(/\\/g, '/'))) extras.push(rel);
    }
  }
  walk(EXT_DIR, '');
  return extras;
}

function checkNoRemoteJs() {
  const errors = [];
  const packed = new Set(collectPackFiles());
  for (const rel of packed) {
    if (!/\.(js|html)$/i.test(rel)) continue;
    const text = fs.readFileSync(path.join(EXT_DIR, rel), 'utf8');
    if (REMOTE_SCRIPT_RE.test(text)) {
      errors.push(`${rel}：含远程 <script src="http(s)://...">`);
    }
    REMOTE_SCRIPT_RE.lastIndex = 0;
    if (REMOTE_IMPORT_RE.test(text) || JS_REMOTE_RE.test(text)) {
      errors.push(`${rel}：含远程 import/require URL（MV3 须全部本地）`);
    }
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'),
  );
  if (manifest.content_security_policy?.extension_pages?.includes('http:')) {
    errors.push('manifest：extension_pages CSP 不应允许远程 http 脚本');
  }
  return errors;
}

function runTarZip(outZip) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
  const relOut = path.relative(ROOT, outZip).replace(/\\/g, '/');
  const result = spawnSync('tar', ['-a', '-c', '-f', relOut, '-C', 'extension', '.'], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `tar 打包失败（${result.status}）${msg ? `：${msg}` : ''}\n` +
        'Windows 10+ / macOS / Linux 一般自带 tar；也可在 Git Bash 中执行 make pack。',
    );
  }
}

function verifyZipRoot(outZip) {
  const list = spawnSync('tar', ['-tf', path.relative(ROOT, outZip).replace(/\\/g, '/')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (list.status !== 0) {
    throw new Error('无法列出 zip 内容以校验结构');
  }
  const lines = list.stdout.split(/\r?\n/).filter(Boolean);
  const hasRootManifest = lines.some(
    (line) => line === './manifest.json' || line === 'manifest.json',
  );
  const nested = lines.some((line) => /^\.\/extension\//.test(line) || /^extension\//.test(line));
  if (!hasRootManifest) {
    throw new Error('zip 根目录未找到 manifest.json（可能多包了一层文件夹）');
  }
  if (nested) {
    throw new Error('zip 内含有 extension/ 前缀，商店要求根目录直接为 manifest.json');
  }
}

function main() {
  const checkOnly = process.argv.includes('--check-only');
  const listOnly = process.argv.includes('--list-only');
  const version = readVersion();
  const files = collectPackFiles();
  if (listOnly) {
    files.forEach((f) => console.log(f));
    return;
  }
  const packedSet = new Set(files);
  const extras = listExtensionExtras(packedSet);
  if (extras.length) {
    console.warn('提示：extension/ 下未纳入 zip 的文件（若为新功能请加入 scripts/pack-extension.mjs 白名单）：');
    extras.forEach((f) => console.warn(`  - ${f}`));
  }

  const remoteErrors = checkNoRemoteJs();
  if (remoteErrors.length) {
    console.error('远程 JS 检查未通过：');
    remoteErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`打包白名单：${files.length} 个文件`);
  if (checkOnly) {
    console.log('--check-only：结构与环境检查通过，未生成 zip。');
    return;
  }

  const outZip = path.join(DIST_DIR, `PanRelay-${version}.zip`);
  runTarZip(outZip);
  verifyZipRoot(outZip);
  const sizeKb = Math.round(fs.statSync(outZip).size / 1024);
  console.log(`已生成 ${path.relative(ROOT, outZip)}（约 ${sizeKb} KiB）`);
  console.log('本地测试：edge://extensions → 开发者模式 → 加载已解压的 extension 目录，或拖入本 zip（部分浏览器仅支持解压加载）。');
}

main();
