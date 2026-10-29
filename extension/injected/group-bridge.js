/**
 * 群文件库（/disk/main#/im/...）主世界钩子：盯页面自己发出的群文件转存请求。
 * 百度回「超出转存上限」时，把这次请求的接口、参数和选中文件交给 group-relay.js 接力转存；
 * 没超限的转存不做任何事。
 */
(function () {
  if (window.__panRelayGroupBridge) return;
  window.__panRelayGroupBridge = true;

  const TRANSFER_RE = /\/mbox\/[^?#]*transfer/i;
  const LIST_RE = /\/mbox\/[^?#]*(shareinfo|listshare)/i;
  const TASK_RE = /\/share\/taskquery/i;
  const LIMIT_TEXT = /超出|超过|上限|单次|会员/;

  /** fs_id -> 文件信息，来自页面的群文件列表响应 */
  const knownFiles = new Map();
  /** 异步转存的 taskid -> 当初那次转存请求 */
  const pendingTasks = new Map();
  let listPath = '';

  function toAbsolute(url) {
    try {
      return new URL(String(url), location.href).href;
    } catch (_) {
      return String(url || '');
    }
  }

  function bodyToString(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return new URLSearchParams([...body.entries()].map(([k, v]) => [k, String(v)])).toString();
    }
    return '';
  }

  function addFile(file, ctx = {}) {
    if (!file || file.fs_id == null) return;
    knownFiles.set(String(file.fs_id), {
      fs_id: file.fs_id,
      isdir: Number(file.isdir) === 1 ? 1 : 0,
      server_filename: file.server_filename,
      path: file.path,
      ...ctx,
    });
  }

  function rememberList(url, data) {
    const records = data && data.records;
    if (Array.isArray(records)) {
      records.forEach((f) => addFile(f));
    } else if (records && Array.isArray(records.msg_list)) {
      for (const msg of records.msg_list) {
        const files = msg.file_list || (msg.filelist && msg.filelist.list) || [];
        files.forEach((f) => addFile(f, { msg_id: msg.msg_id }));
      }
    } else if (records && Array.isArray(records.list)) {
      for (const msg of records.list) {
        const files = msg.file_list || (msg.filelist && msg.filelist.list) || [msg];
        files.forEach((f) => addFile(f, { msg_id: msg.msg_id }));
      }
    }
    if (/shareinfo/i.test(url)) {
      try {
        listPath = new URL(url).pathname;
      } catch (_) {
        /* ignore */
      }
    }
  }

  /** 列表响应里没有的（比如页面先于钩子加载），再从文件库组件的 Vue 实例里找 */
  function lookupInVue(id) {
    for (const el of document.querySelectorAll('.im-doclib')) {
      const list = (el.__vue__ && el.__vue__.innerList) || [];
      for (const row of list) {
        if (String(row.fs_id) === id && !row.isPolymer) {
          return { fs_id: row.fs_id, isdir: row.isdir ? 1 : 0, server_filename: row.server_filename, path: row.path };
        }
        const meta = (row.fs_metas || []).find((m) => String(m.fs_id) === id);
        if (meta) addFile(meta);
      }
    }
    return knownFiles.get(id) || null;
  }

  function describe(ids) {
    return ids.map((id) => knownFiles.get(String(id)) || lookupInVue(String(id)) || { fs_id: id, unknown: true });
  }

  function isLimitResponse(data) {
    if (!data || typeof data !== 'object') return false;
    const errno = Number(data.errno || data.task_errno || 0);
    if (!errno) return false;
    if (errno === 12 || data.target_file_nums) return true;
    return LIMIT_TEXT.test(String(data.show_msg || data.errmsg || data.error_msg || ''));
  }

  function findIdsKey(params) {
    for (const [key, value] of params) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length && parsed.every((v) => /^\d+$/.test(String(v)))) return key;
      } catch (_) {
        /* 不是 JSON */
      }
    }
    return '';
  }

  function handOver(request, response) {
    const params = new URLSearchParams(request.body);
    const idsKey = findIdsKey(params);
    if (!idsKey) {
      console.warn('[PanRelay] 群文件转存超限，但请求里找不到文件 id，无法接手', request);
      return;
    }
    const ids = JSON.parse(params.get(idsKey)).map(String);
    const detail = {
      url: request.url,
      body: Object.fromEntries(params),
      idsKey,
      ids,
      items: describe(ids),
      listPath,
      response,
    };
    document.dispatchEvent(new CustomEvent('panrelay-group-limit', { detail: JSON.stringify(detail) }));
  }

  function onResponse(request, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return;
    }
    const url = request.url;
    if (LIST_RE.test(url)) {
      rememberList(url, data);
      return;
    }
    if (TRANSFER_RE.test(url)) {
      console.info(`[PanRelay] 群文件转存 ${JSON.stringify({ url, body: request.body, response: data })}`);
      const taskId = data && (data.task_id || data.taskid);
      if (taskId && !Number(data.errno || 0)) {
        pendingTasks.set(String(taskId), request);
        return;
      }
      if (isLimitResponse(data)) handOver(request, data);
      return;
    }
    if (TASK_RE.test(url)) {
      const taskId = new URL(url).searchParams.get('taskid');
      const original = taskId && pendingTasks.get(taskId);
      if (!original || !data || data.status === 'running' || data.status === 'pending') return;
      pendingTasks.delete(taskId);
      if (data.status === 'failed' && isLimitResponse({ ...data, errno: data.task_errno || data.errno })) {
        handOver(original, data);
      }
    }
  }

  // 脚本挂在整个 /disk/main 上，但只接管群聊（#/im/...）里的转存；SPA 切路由不刷新页面，须每次请求时判断
  const onImRoute = () => /#\/im(\/|$|\?)/.test(String(location.href));
  const watched = (url) =>
    onImRoute() && (TRANSFER_RE.test(url) || LIST_RE.test(url) || TASK_RE.test(url));

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__panRelayUrl = toAbsolute(url);
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__panRelayUrl || '';
    if (watched(url)) {
      const request = { url, body: bodyToString(body) };
      this.addEventListener('load', () => {
        try {
          // responseType 为 json 时读 responseText 会抛 InvalidStateError
          const text =
            this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
          onResponse(request, text);
        } catch (error) {
          console.warn('[PanRelay] 群文件响应处理失败', error);
        }
      });
    }
    return origSend.call(this, body);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = toAbsolute(typeof input === 'string' ? input : input && input.url);
      const result = origFetch.call(this, input, init);
      if (watched(url)) {
        const request = { url, body: bodyToString(init && init.body) };
        result
          .then((res) => res.clone().text())
          .then((text) => onResponse(request, text))
          .catch(() => {});
      }
      return result;
    };
  }
})();
