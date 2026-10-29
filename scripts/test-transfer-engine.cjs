#!/usr/bin/env node
/**
 * 用假的百度接口跑 ShareTransferEngine：拆分、去重、列目录方式、进度统计。
 * 用法：node scripts/test-transfer-engine.cjs
 */
const path = require('path');

require(path.join(__dirname, '..', 'extension', 'lib', 'transfer-core.js'));
const { ShareTransferEngine, parseShareHtml } = globalThis.PanRelay;

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// ---------- 分享页 HTML 解析 ----------
{
  const v2 = `<script id="locals-data" type="application/json">${JSON.stringify({
    shareid: 111,
    share_uk: '222',
    bdstoken: 'tok',
    loginstate: 1,
    file_list: [{ fs_id: 3, isdir: 1, server_filename: 'A', parent_path: '%2Fsharelink222-3' }],
  })}</script>`;
  const old = `<script>locals.mset(${JSON.stringify({
    shareid: 444,
    share_uk: '555',
    bdstoken: 'tok2',
    file_list: [{ fs_id: 6, isdir: 0, server_filename: 'b.txt', parent_path: '/sharelink555-6' }],
  })});</script>`;
  for (const [label, html] of [['新版 locals-data', v2], ['旧版 locals.mset', old]]) {
    const meta = parseShareHtml(html);
    check(
      `parseShareHtml(${label})`,
      !!(meta && meta.shareId && meta.userId && meta.shareRoot.startsWith('/sharelink')),
      meta ? `shareId=${meta.shareId} root=${meta.shareRoot}` : 'null',
    );
  }
}

// ---------- 模拟百度接口 ----------
function buildTree() {
  let nextId = 1000;
  const root = { id: 1, name: 'ROOT', isdir: 1, path: '/sharelink9-1', children: [] };
  const byId = new Map([[1, root]]);
  const add = (parent, name, isdir) => {
    const node = { id: nextId++, name, isdir, path: `${parent.path}/${name}`, children: [] };
    parent.children.push(node);
    byId.set(node.id, node);
    return node;
  };
  return { root, byId, add };
}

const countFiles = (node) => (node.isdir ? node.children.reduce((s, c) => s + countFiles(c), 0) : 1);

function makeFetch(tree, { limit = 500, failMultiDirOnce = null } = {}) {
  const transferred = new Map();
  const listQueries = [];
  let failedOnce = false;
  const respond = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
  const fetch = async (url, opts) => {
    const u = new URL(url);
    if (u.pathname === '/api/list' || u.pathname === '/api/create') return respond({ errno: 0, list: [] });
    if (u.pathname === '/share/list') {
      listQueries.push(u.search);
      const fid = u.searchParams.get('fid');
      const page = Number(u.searchParams.get('page'));
      const num = Number(u.searchParams.get('num'));
      // 新版分享页的行为：带 fid 只返回文件夹本身；按 dir 才能列出内容，路径不存在 errno 2
      if (fid) {
        const self = tree.byId.get(Number(fid));
        return respond({ errno: 0, list: [{ fs_id: self.id, server_filename: self.name, isdir: 1, path: self.path }] });
      }
      const node = [...tree.byId.values()].find((n) => n.path === u.searchParams.get('dir'));
      if (!node) return respond({ errno: 2, show_msg: '啊哦，链接出错了' });
      const sorted = [...node.children].sort((a, b) => a.name.localeCompare(b.name));
      const list = sorted.slice((page - 1) * num, page * num).map((c) => ({
        fs_id: c.id,
        server_filename: c.name,
        isdir: c.isdir,
        path: c.path,
      }));
      return respond({ errno: 0, list });
    }
    if (u.pathname === '/share/transfer') {
      const body = new URLSearchParams(opts.body);
      const ids = JSON.parse(body.get('fsidlist'));
      const nodes = ids.map((id) => tree.byId.get(id));
      if (failMultiDirOnce && !failedOnce && ids.length > 1 && ids.includes(failMultiDirOnce)) {
        failedOnce = true;
        return respond({ errno: -7, show_msg: '模拟：分享文件不存在' });
      }
      const total = nodes.reduce((s, n) => s + countFiles(n), 0);
      if (total > limit) {
        return respond({ errno: 12, target_file_nums: total, target_file_nums_limit: limit });
      }
      for (const id of ids) transferred.set(id, (transferred.get(id) || 0) + 1);
      return respond({ errno: 0 });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, transferred, listQueries };
}

function engine(fetchImpl, extra = {}) {
  return new ShareTransferEngine({
    fetch: fetchImpl,
    shareId: '9',
    userId: '9',
    bdstoken: 'tok',
    shareRoot: '/sharelink9-1',
    batchSize: 500,
    transferCooldownMs: 0,
    onProgress: () => {},
    ...extra,
  });
}

ShareTransferEngine.prototype.wait = async function () {
  this.throwIfCancelled();
};

const sel = (n) => ({ fs_id: n.id, isdir: n.isdir, server_filename: n.name, path: n.path, path_raw: n.path });

(async () => {
  // 纯文件，账号限额 300：批量自动减半
  {
    const t = buildTree();
    const files = Array.from({ length: 1200 }, (_, i) => t.add(t.root, `f${String(i).padStart(4, '0')}`, 0));
    const m = makeFetch(t, { limit: 300 });
    const e = engine(m.fetch);
    let error = null;
    try {
      await e.runSelection(files.map(sel), '/dest');
    } catch (err) {
      error = err;
    }
    const once = files.every((f) => m.transferred.get(f.id) === 1);
    check('纯文件遇限额自动减半', !error && once, `error=${error && error.message} batch=${e.fileBatchSize}`);
  }

  // 大目录：150 个子目录 × 10 文件 + 50 个散文件
  {
    const t = buildTree();
    const big = t.add(t.root, '大目录', 1);
    const subs = [];
    for (let i = 0; i < 150; i++) {
      const s = t.add(big, `子${String(i).padStart(3, '0')}`, 1);
      subs.push(s);
      for (let j = 0; j < 10; j++) t.add(s, `f${j}`, 0);
    }
    const loose = Array.from({ length: 50 }, (_, i) => t.add(big, `散${i}`, 0));
    const m = makeFetch(t, { limit: 500 });
    const snaps = [];
    const e = engine(m.fetch, { onStats: (s) => snaps.push(s) });
    let error = null;
    try {
      await e.runSelection([sel(big)], '/dest');
    } catch (err) {
      error = err;
    }
    const subsOnce = subs.every((s) => m.transferred.get(s.id) === 1);
    const looseOnce = loose.every((f) => m.transferred.get(f.id) === 1);
    check('大目录拆分：子目录与散文件各转一次', !error && subsOnce && looseOnce, `error=${error && error.message}`);
    check(
      '列目录按名称排序、每页 100',
      m.listQueries.every((q) => /order=name/.test(q) && /num=100/.test(q)),
      m.listQueries[0],
    );
    check('按路径列举一次成功，不白试 fid', !m.listQueries.some((q) => /fid=/.test(q)), `queries=${m.listQueries.length}`);

    const known = snaps.filter((s) => !s.estimating && s.total && !s.finished);
    const pcts = known.map((s) => Math.floor((s.done / s.total) * 100));
    const doneMono = snaps.every((s, i) => i === 0 || s.done >= snaps[i - 1].done);
    const drops = pcts.filter((p, i) => i > 0 && p < pcts[i - 1] - 1).length;
    const last = snaps[snaps.length - 1];
    check(
      '进度：总数取自 errno 12，过程不倒退，结束 100%',
      known[0]?.total === 1550 && last.finished && last.total === 1550 && last.done === last.total && doneMono && drops === 0,
      `firstTotal=${known[0]?.total} last=${last.done}/${last.total} updates=${snaps.length} sample=${pcts
        .filter((_, i) => i % Math.max(1, Math.floor(pcts.length / 8)) === 0)
        .join(',')}`,
    );
  }

  // 批量失败退回逐个，不重复转存
  {
    const t = buildTree();
    const big = t.add(t.root, '大目录', 1);
    const subs = [];
    for (let i = 0; i < 80; i++) {
      const s = t.add(big, `子${String(i).padStart(3, '0')}`, 1);
      subs.push(s);
      for (let j = 0; j < 10; j++) t.add(s, `f${j}`, 0);
    }
    const m = makeFetch(t, { limit: 500, failMultiDirOnce: subs[60].id });
    const e = engine(m.fetch);
    let error = null;
    try {
      await e.runSelection([sel(big)], '/dest');
    } catch (err) {
      error = err;
    }
    const dup = subs.filter((s) => (m.transferred.get(s.id) || 0) > 1).length;
    const missing = subs.filter((s) => !m.transferred.get(s.id)).length;
    check('批量失败退回逐个：无重复、无遗漏', !error && dup === 0 && missing === 0, `error=${error && error.message} dup=${dup} missing=${missing}`);
  }

  // 群文件库：/mbox/msg/transfer + /mbox/msg/shareinfo（按目录 fs_id 翻页，has_more 决定是否还有下一页）
  {
    const { GroupTransferEngine } = globalThis.PanRelay;
    const t = buildTree();
    const big = t.add(t.root, '课程', 1);
    const subs = [];
    for (let i = 0; i < 30; i++) {
      const s = t.add(big, `第${i}讲`, 1);
      subs.push(s);
      for (let j = 0; j < 40; j++) t.add(s, `v${j}.mp4`, 0);
    }
    const transferred = new Map();
    const bodies = [];
    const respond = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
    const fetch = async (url, opts) => {
      const u = new URL(url);
      if (u.pathname === '/api/list' || u.pathname === '/api/create') return respond({ errno: 0, list: [] });
      if (u.pathname === '/mbox/msg/shareinfo') {
        const node = t.byId.get(Number(u.searchParams.get('fs_id')));
        if (!node || u.searchParams.get('msg_id') !== 'm1' || u.searchParams.get('gid') !== 'g1') {
          return respond({ errno: 2131 });
        }
        // 每页只给 7 条，但 has_more 表示还有：引擎不能因为一页不满就停
        const page = Number(u.searchParams.get('page'));
        const slice = node.children.slice((page - 1) * 7, page * 7);
        return respond({
          errno: 0,
          has_more: page * 7 < node.children.length ? 1 : 0,
          records: slice.map((c) => ({ fs_id: c.id, isdir: c.isdir, server_filename: c.name, path: c.path })),
        });
      }
      if (u.pathname === '/mbox/msg/transfer') {
        const body = new URLSearchParams(opts.body);
        bodies.push(body);
        const ids = JSON.parse(body.get('fs_ids'));
        const total = ids.reduce((s, id) => s + countFiles(t.byId.get(id)), 0);
        // 群文件超限实测回 errno 130，不是分享页的 12
        if (total > 500) return respond({ errno: 130 });
        for (const id of ids) transferred.set(id, (transferred.get(id) || 0) + 1);
        return respond({ errno: 0 });
      }
      throw new Error(`unexpected ${url}`);
    };
    const e = new GroupTransferEngine({
      limitErrnos: [130],
      fetch,
      fromUk: 'u1',
      msgId: 'm1',
      bdstoken: 'tok',
      transferPath: '/mbox/msg/transfer',
      transferQuery: 'bdstoken=tok&channel=chunlei',
      transferBody: { from_uk: 'u1', msg_id: 'm1', gid: 'g1', type: '2', ondup: 'newcopy' },
      idsKey: 'fs_ids',
      listParams: { from_uk: 'u1', msg_id: 'm1', gid: 'g1', type: '2' },
      batchSize: 500,
      transferCooldownMs: 0,
      onProgress: () => {},
    });
    let error = null;
    try {
      await e.runSelection([{ fs_id: big.id, isdir: 1, server_filename: '课程', path: '/课程' }], '/我的/学习');
    } catch (err) {
      error = err;
    }
    const once = subs.every((s) => transferred.get(s.id) === 1);
    const keptParams = bodies.every((b) => b.get('gid') === 'g1' && b.get('msg_id') === 'm1' && b.get('type') === '2');
    const dest = bodies.filter((b) => b.get('path').startsWith('/我的/学习/课程')).length;
    check(
      '群文件：沿用原请求参数、按 has_more 翻页、子目录各转一次',
      !error && once && keptParams && dest > 0,
      `error=${error && error.message} subsOnce=${once} params=${keptParams} requests=${bodies.length}`,
    );
  }

  // 群文件钩子：百度回超限时把原请求交给内容脚本
  {
    const events = [];
    const listeners = {};
    class FakeXHR {
      constructor() {
        this.listeners = {};
      }
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      }
      respond(text) {
        this.responseText = text;
        (this.listeners.load || []).forEach((fn) => fn());
      }
    }
    FakeXHR.prototype.responseType = '';
    FakeXHR.prototype.open = function () {};
    FakeXHR.prototype.send = function () {};
    const saved = {};
    for (const k of ['window', 'document', 'location', 'XMLHttpRequest', 'CustomEvent', 'fetch']) saved[k] = globalThis[k];
    globalThis.window = globalThis;
    globalThis.location = { href: 'https://pan.baidu.com/disk/main#/im/session' };
    globalThis.XMLHttpRequest = FakeXHR;
    globalThis.CustomEvent = class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    globalThis.document = {
      querySelectorAll: () => [],
      dispatchEvent: (ev) => events.push(ev),
      addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn)),
    };
    delete globalThis.fetch;
    delete require.cache[require.resolve('../extension/injected/group-bridge.js')];
    require('../extension/injected/group-bridge.js');

    const list = new FakeXHR();
    list.open('GET', '/mbox/group/listshare?gid=g1&type=2');
    list.send();
    list.respond(JSON.stringify({
      errno: 0,
      records: { msg_list: [{ msg_id: 'm1', file_list: [{ fs_id: 815453071125924, isdir: 1, server_filename: '26年课程', path: '/x/26年课程' }] }] },
    }));
    const tr = new FakeXHR();
    tr.open('POST', '/mbox/msg/transfer?bdstoken=tok&channel=chunlei');
    tr.send('from_uk=u1&msg_id=m1&gid=g1&type=2&path=%2F%E5%AD%A6%E4%B9%A0&fs_ids=%5B815453071125924%5D');
    // 页面用 responseType=json，读 responseText 会抛错，只能读 response
    tr.responseType = 'json';
    Object.defineProperty(tr, 'responseText', {
      get() {
        throw new Error("InvalidStateError: responseType is 'json'");
      },
      set() {},
    });
    tr.response = { errno: 130, show_msg: '转存文件数超过上限' };
    (tr.listeners.load || []).forEach((fn) => fn());
    const eventsOnIm = events.length;

    // 同一页面 SPA 切到「我的文件」后，不应再接管
    globalThis.location.href = 'https://pan.baidu.com/disk/main#/index?category=all';
    const other = new FakeXHR();
    other.open('POST', '/mbox/msg/transfer?bdstoken=tok');
    other.send('from_uk=u1&msg_id=m1&gid=g1&type=2&path=%2F&fs_ids=%5B815453071125924%5D');
    other.respond(JSON.stringify({ errno: 130, show_msg: '转存文件数超过上限' }));
    check('群文件钩子：非 #/im 路由不接管', events.length === eventsOnIm, `events=${events.length}`);

    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
    const detail = events[0] && JSON.parse(events[0].detail);
    check(
      '群文件钩子：超限时交出原请求与文件信息',
      eventsOnIm === 1 &&
        detail.idsKey === 'fs_ids' &&
        detail.ids[0] === '815453071125924' &&
        detail.body.path === '/学习' &&
        detail.items[0].server_filename === '26年课程' &&
        detail.items[0].isdir === 1,
      detail ? `idsKey=${detail.idsKey} path=${detail.body.path} item=${detail.items[0]?.server_filename}` : 'no event',
    );
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
