/**
 * 运行在页面主世界，可访问百度网盘的 require / locals / context。
 * 新版分享页（disk-share-v2，Vue）没有 require / locals，改读
 * window.__DISK_SHARE_V2_LOCALS__、列表 DOM，以及页面自己的列表接口响应。
 */
(function () {
  if (window.__panRelayBridgeInstalled) return;
  window.__panRelayBridgeInstalled = true;

  /** fs_id -> 文件信息；新版页面进入子目录后只能从列表接口响应里拿到 path / isdir */
  const knownFiles = new Map();
  let lastListDir = '';

  function rememberList(url, data) {
    const list = data && Array.isArray(data.list) ? data.list : null;
    if (!list) return;
    for (const item of list) {
      if (item && item.fs_id != null) knownFiles.set(String(item.fs_id), item);
    }
    if (!/share/.test(String(url))) return;
    try {
      const params = new URL(url, location.href).searchParams;
      const dir = params.get('dir');
      lastListDir = dir && params.get('root') !== '1' ? decodePath(dir) : '';
    } catch (_) {
      /* ignore */
    }
  }

  function isListUrl(url) {
    return /\/share\/list|\/list\b|list\?/.test(String(url || ''));
  }

  function hookListResponses() {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (isListUrl(url)) {
        this.addEventListener('load', () => {
          try {
            rememberList(url, JSON.parse(this.responseText));
          } catch (_) {
            /* ignore */
          }
        });
      }
      return origOpen.call(this, method, url, ...rest);
    };

    const origFetch = window.fetch;
    if (typeof origFetch !== 'function') return;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url;
      const result = origFetch.call(this, input, init);
      if (isListUrl(url)) {
        result
          .then((res) => res.clone().json())
          .then((data) => rememberList(url, data))
          .catch(() => {});
      }
      return result;
    };
  }

  hookListResponses();

  function getV2Locals() {
    const data = window.__DISK_SHARE_V2_LOCALS__;
    return data && typeof data === 'object' ? data : null;
  }

  function getContext() {
    try {
      return require('system-core:context/context.js').instanceForSystem;
    } catch (_) {
      return null;
    }
  }

  function decodePath(encoded) {
    if (!encoded) return '';
    try {
      return decodeURIComponent(String(encoded));
    } catch (_) {
      return String(encoded);
    }
  }

  function readSavedTransferPath(username) {
    const direct = username ? localStorage.getItem(`${username}_cur_transfer_save_path`) : null;
    if (direct) return direct;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith('_cur_transfer_save_path')) return localStorage.getItem(key);
    }
    return null;
  }

  function getDestinationPath() {
    const locals = window.locals;
    const v2 = getV2Locals();
    const rawName =
      locals && typeof locals.get === 'function' ? locals.get('username') : v2?.username;
    const username = String(rawName || '').replace(/@/gi, '');
    const raw = readSavedTransferPath(username);
    if (!raw) return '/';

    const [pathPart, tsPart] = raw.split('?');
    const path = pathPart || '/';

    const collabRaw = localStorage.getItem(`${username}_collab_transfer_save_path`);
    if (collabRaw && tsPart) {
      try {
        const collab = JSON.parse(collabRaw);
        const curTs = parseInt(tsPart, 10) || 0;
        if (Math.abs(curTs - (collab.timestamp || 0)) < 5000) {
          const spaceName = collab.spaceName || '团队共享空间';
          return path === '/' ? `/${spaceName}`.replace(/\/+/g, '/') : `/${spaceName}${path}`.replace(/\/+/g, '/');
        }
      } catch (_) {
        /* ignore */
      }
    }

    return path.startsWith('/') ? path : `/${path}`;
  }

  function getShareMeta() {
    const y = window.yunData || {};
    const locals = window.locals;
    const v2 = getV2Locals() || {};
    const get =
      locals && typeof locals.get === 'function'
        ? locals.get.bind(locals)
        : (key) => v2[key];

    const fileList = get('file_list') || [];
    const first = fileList[0] || {};
    const parentPath = decodePath(first.parent_path || '/');

    const sekey =
      y.sign ||
      y.data?.sign ||
      get('sign') ||
      get('sekey') ||
      window.currentSekey ||
      v2.currentSekey ||
      '';
    return {
      shareId: String(y.shareid || get('shareid') || ''),
      userId: String(y.share_uk || get('share_uk') || ''),
      bdstoken: String(y.bdstoken || get('bdstoken') || ''),
      shareRoot: parentPath || '/',
      sekey: String(sekey || ''),
      loginstate: String(y.loginstate || get('loginstate') || '0'),
    };
  }

  function getRootFileList() {
    const locals = window.locals;
    if (locals && typeof locals.get === 'function') {
      const list = locals.get('file_list');
      if (Array.isArray(list)) return list;
    }
    const v2 = getV2Locals();
    return Array.isArray(v2?.file_list) ? v2.file_list : [];
  }

  /**
   * share/list 的 dir= 只认 /sharelink{uk}-{fsid}/… 形式；新版页面的列表接口有时返回
   * 分享者网盘里的真实路径（如 /我的资源/xxx），要按分享根层的文件名换回 sharelink 前缀。
   */
  function toSharePath(rawPath) {
    const decoded = decodePath(rawPath);
    if (!decoded || /^\/?sharelink/i.test(decoded)) return decoded;
    const rootList = getRootFileList();
    const shareRoot = decodePath(rootList[0]?.parent_path || '');
    if (!/sharelink/i.test(shareRoot)) return decoded;
    const rootNames = new Set(rootList.map((item) => item.server_filename));
    const segments = decoded.split('/').filter(Boolean);
    const index = segments.findIndex((seg) => rootNames.has(seg));
    if (index < 0) return decoded;
    return `${shareRoot.replace(/\/$/, '')}/${segments.slice(index).join('/')}`;
  }

  function toSelected(item) {
    const rawPath = item.path;
    const sharePath = toSharePath(rawPath);
    const remapped = sharePath !== decodePath(rawPath);
    return {
      fs_id: item.fs_id,
      isdir: Number(item.isdir) === 1 ? 1 : 0,
      server_filename: item.server_filename,
      path: sharePath,
      path_raw: remapped ? sharePath : rawPath,
      parent_path: decodePath(item.parent_path),
    };
  }

  function isRowChecked(row) {
    const box = row.querySelector('[role="checkbox"]');
    if (box) return box.getAttribute('aria-checked') === 'true';
    return row.classList.contains('JS-item-active');
  }

  function isAllChecked() {
    const box = document.querySelector('.share-list-header__check [role="checkbox"]');
    return !!box && box.getAttribute('aria-checked') === 'true';
  }

  /** 新版分享页：勾选状态在 DOM 上，文件信息来自启动数据和列表接口响应 */
  function getSelectedFilesV2() {
    const v2 = getV2Locals() || {};
    const rootList = Array.isArray(v2.file_list) ? v2.file_list : [];
    for (const item of rootList) {
      if (item && item.fs_id != null && !knownFiles.has(String(item.fs_id))) {
        knownFiles.set(String(item.fs_id), item);
      }
    }

    const rows = [...document.querySelectorAll('[data-file-key]')];
    const checked = rows.filter(isRowChecked);
    const rootPath = decodePath(rootList[0]?.parent_path || '');
    const listDir = toSharePath(lastListDir);
    const inSubDir = !!listDir && listDir !== '/' && listDir !== rootPath;

    // 列表可能是虚拟滚动，全选时 DOM 里只有可见的几行；子目录全选直接转存整个目录的内容
    if (isAllChecked() && inSubDir) {
      return { selectAllDir: listDir, count: checked.length };
    }
    const ids = isAllChecked() && !inSubDir && rootList.length
      ? rootList.map((item) => String(item.fs_id))
      : checked.map((row) => String(row.getAttribute('data-file-key')));

    const files = [];
    const unresolved = [];
    for (const id of ids) {
      const item = knownFiles.get(id);
      if (item) files.push(toSelected(item));
      else unresolved.push(id);
    }
    return { files, unresolved };
  }

  function getSelectedFiles() {
    const ctx = getContext();
    if (ctx?.list?.getSelected) {
      return { files: (ctx.list.getSelected() || []).map(toSelected), unresolved: [] };
    }
    if (getV2Locals()) return getSelectedFilesV2();
    return { files: [], unresolved: [] };
  }

  function serializeFile(item) {
    return {
      fs_id: item.fs_id,
      isdir: Number(item.isdir) === 1 ? 1 : 0,
      server_filename: item.server_filename,
      path: decodePath(item.path),
      parent_path: decodePath(item.parent_path),
    };
  }

  function invokeNativeSave() {
    const ctx = getContext();
    const locals = window.locals;
    if (!ctx?.message?.callPlugin || !locals) {
      return { ok: false, reason: 'unsupported' };
    }
    if (locals.get('self')) {
      throw new Error('无法转存自己分享的文件');
    }
    const selectedFiles = ctx.list.getSelected() || [];
    if (!selectedFiles.length) {
      ctx.ui?.tip?.({ msg: '请至少选择一个文件', mode: 'caution' });
      return { ok: false, reason: 'empty' };
    }
    ctx.message.callPlugin('保存到网盘@com.baidu.pan.share', {
      filesList: selectedFiles,
    });
    return { ok: true };
  }

  const handlers = {
    getDestinationPath,
    getShareMeta,
    getSelectedFiles,
    invokeNativeSave,
    ping: () => ({ ok: true }),
  };

  document.addEventListener('panrelay-request', (event) => {
    const detail = event.detail || {};
    const { id, method } = detail;
    const fn = handlers[method];
    let payload = { id, ok: false, error: 'unknown method' };
    if (!fn) {
      document.dispatchEvent(new CustomEvent('panrelay-response', { detail: payload }));
      return;
    }
    try {
      const result = fn(detail.args);
      payload = { id, ok: true, result };
    } catch (error) {
      payload = { id, ok: false, error: error?.message || String(error) };
    }
    document.dispatchEvent(new CustomEvent('panrelay-response', { detail: payload }));
  });

  window.dispatchEvent(new CustomEvent('panrelay-bridge-ready'));
})();
