/**
 * 运行在页面主世界，可访问百度网盘的 require / locals / context。
 */
(function () {
  if (window.__panRelayBridgeInstalled) return;
  window.__panRelayBridgeInstalled = true;

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
      return decodeURIComponent(String(encoded).replace(/\+/g, '%20'));
    } catch (_) {
      return String(encoded);
    }
  }

  function getDestinationPath() {
    const locals = window.locals;
    if (!locals || typeof locals.get !== 'function') return '/';

    const username = String(locals.get('username') || '').replace(/@/gi, '');
    const raw = localStorage.getItem(`${username}_cur_transfer_save_path`);
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
    const get = locals && typeof locals.get === 'function' ? locals.get.bind(locals) : () => undefined;

    const fileList = get('file_list') || [];
    const first = fileList[0] || {};
    const parentPath = decodePath(first.parent_path || '/');

    return {
      shareId: String(y.shareid || get('shareid') || ''),
      userId: String(y.share_uk || get('share_uk') || ''),
      bdstoken: String(y.bdstoken || get('bdstoken') || ''),
      shareRoot: parentPath || '/',
      loginstate: String(y.loginstate || get('loginstate') || '0'),
    };
  }

  function getSelectedFiles() {
    const ctx = getContext();
    if (!ctx?.list?.getSelected) return [];
    const list = ctx.list.getSelected() || [];
    return list.map((item) => ({
      fs_id: item.fs_id,
      isdir: Number(item.isdir) === 1 ? 1 : 0,
      server_filename: item.server_filename,
      path: decodePath(item.path),
      parent_path: decodePath(item.parent_path),
    }));
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
      throw new Error('无法调用网盘原生保存');
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
