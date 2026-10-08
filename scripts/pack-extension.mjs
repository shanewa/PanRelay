#!/usr/bin/env node
/**
 * 将 extension/ 打成商店可提交的 zip：压缩包根目录即为 manifest.json（无嵌套 extension/ 文件夹）。
 * 使用 Node 写入标准 ZIP（PK 头），兼容 Linux unzip / Chrome 商店。
 * 用法：node scripts/pack-extension.mjs [--check-only] [--list-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/** @param {{ name: string, data: Buffer }[]} entries */
function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const compressed = deflateRawSync(data);
    const method = 8;
    const comp = compressed.length < data.length ? compressed : data;
    const useStore = comp === data;
    const payload = useStore ? data : compressed;
    const compMethod = useStore ? 0 : method;

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(compMethod),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    locals.push(localHeader, payload);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(compMethod),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    central.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

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

function writeZip(outZip, relFiles) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const entries = relFiles.map((name) => ({
    name,
    data: fs.readFileSync(path.join(EXT_DIR, name)),
  }));
  const buf = buildZip(entries);
  fs.writeFileSync(outZip, buf);
}

function verifyZipFile(outZip, relFiles) {
  const buf = fs.readFileSync(outZip);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(
      '生成的文件不是有效 ZIP（缺少 PK\\x03\\x04 头）。请删除 dist 下旧包后重新 make pack。',
    );
  }
  const names = new Set(relFiles);
  if (!names.has('manifest.json')) {
    throw new Error('白名单缺少 manifest.json');
  }
  const text = buf.toString('binary');
  if (!text.includes('manifest.json')) {
    throw new Error('zip 内未找到 manifest.json 条目');
  }
  if (/\bextension\/manifest\.json/.test(text)) {
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
  writeZip(outZip, files);
  verifyZipFile(outZip, files);
  const sizeKb = Math.round(fs.statSync(outZip).size / 1024);
  console.log(`已生成 ${path.relative(ROOT, outZip)}（约 ${sizeKb} KiB，标准 ZIP）`);
  console.log('校验：文件头 PK\\x03\\x04；可用 unzip -t 测试。');
  console.log('本地测试：edge://extensions → 开发者模式 → 加载已解压的 extension 目录。');
}

main();
