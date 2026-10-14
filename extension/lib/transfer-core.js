/**
 * 百度网盘分享页转存核心（在 content script 中运行，携带页面 Cookie）。
 * 参考公开网页端接口：POST /share/transfer
 */
(function (root) {
  'use strict';

  const ROOT_URL = 'https://pan.baidu.com';
  class PanRelayError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'PanRelayError';
      this.errno = options.errno;
      this.response = options.response;
      this.cancelled = !!options.cancelled;
    }
  }

  function encodePath(path) {
    return encodeURIComponent(path).replace(/%2F/gi, '/');
  }

  function decodePath(encoded) {
    if (!encoded) return '';
    try {
      return decodeURIComponent(String(encoded));
    } catch (_) {
      return String(encoded);
    }
  }

  /** share/list 的 dir=：优先用接口返回的原始 path，避免 + 号等被误解码 */
  function dirQueryValue(rawPath, decodedPath) {
    const raw = rawPath != null ? String(rawPath) : '';
    if (raw && /%[0-9A-Fa-f]{2}/.test(raw)) {
      if (raw.startsWith('%2F') || raw.startsWith('%2f')) return raw;
      if (raw.startsWith('/')) return encodePath(raw);
      return raw;
    }
    const decoded = decodedPath != null ? String(decodedPath) : raw;
    return encodePath(decoded || '/');
  }

  function joinPath(...parts) {
    return parts
      .filter((p) => p != null && p !== '')
      .join('/')
      .replace(/\/+/g, '/');
  }

  function isTransferLimitError(errno, errMsg) {
    if (Number(errno) === 12) return true;
    return /超出|超过|上限|无法保存|单次/.test(String(errMsg || ''));
  }

  function isRetriableShareError(error) {
    if (!error) return false;
    const errno = Number(error.errno);
    // 2 参数错误；12 单次数量超限，重试不会变少
    if (errno === 2 || errno === 12 || errno === -7 || errno === 105 || errno === 116) return false;
    if (isTransferLimitError(errno, error.message)) return false;
    const msg = String(error.message || '');
    if (/超时|timeout|繁忙|稍后再试|系统繁忙|网络/i.test(msg)) return true;
    return errno === 4 || errno === 111 || errno === 1504 || errno === -1;
  }

  /** 分享侧列举用的目录路径（勿与用户网盘保存路径混淆） */
  function normalizeShareListPath(sharePath, shareDirRaw, shareRoot) {
    let decoded =
      sharePath != null && sharePath !== ''
        ? String(sharePath)
        : decodePath(shareDirRaw);
    decoded = decoded.trim();
    if (decoded && !decoded.startsWith('/') && /^sharelink/i.test(decoded)) {
      decoded = `/${decoded}`;
    }
    const root = shareRoot != null ? String(shareRoot).replace(/\/$/, '') : '';
    if (decoded && root && !decoded.includes('sharelink') && !decoded.startsWith(root)) {
      decoded = joinPath(root, decoded.replace(/^\//, ''));
    }
    if (!decoded && root) decoded = root;
    return decoded || '/';
  }

  function mapShareListItem(item) {
    return {
      id: item.fs_id,
      name: item.server_filename,
      isDirectory: Number(item.isdir) === 1,
      sharePath: decodePath(item.path),
      shareDirRaw: item.path,
    };
  }

  class ShareTransferEngine {
    constructor(options = {}) {
      this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
      this.onProgress = options.onProgress || (() => {});
      this.batchSize = options.batchSize || 500;
      /** 纯文件批次遇到 errno 12 后自动减半，后续批次沿用 */
      this.fileBatchSize = this.batchSize;
      this.listPageSize = options.listPageSize || 100;
      /** 已成功转存、或已开始拆分处理的 fs_id；批量失败退回逐个转存时据此跳过，避免 newcopy 产生重复副本 */
      this.handledIds = new Set();
      this.maxRetries = options.maxRetries ?? 12;
      this.listMaxRetries = options.listMaxRetries ?? 10;
      this.transferCooldownMs = options.transferCooldownMs ?? 1500;
      this.shareId = options.shareId;
      this.failedTasks = [];
      this.userId = options.userId;
      this.bdstoken = options.bdstoken;
      this.shareRoot = options.shareRoot || '/';
      this.sekey = options.sekey || '';
      /** @type {string} 用户选择的转存根目录（网盘路径） */
      this.destinationRoot = options.destinationRoot || '/';
      this.cancelled = false;
      this.abortController = new AbortController();
    }

    progress(message) {
      this.onProgress(String(message));
    }

    /** 已发出的转存请求可能仍会在服务端完成，取消只保证不再发新请求 */
    cancel() {
      if (this.cancelled) return;
      this.cancelled = true;
      this.abortController.abort();
    }

    throwIfCancelled() {
      if (this.cancelled) {
        throw new PanRelayError('已取消转存', { cancelled: true });
      }
    }

    wait(ms) {
      this.throwIfCancelled();
      const signal = this.abortController.signal;
      return new Promise((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        }
        signal.addEventListener('abort', done);
      }).then(() => this.throwIfCancelled());
    }

    async request(path, options = {}) {
      this.throwIfCancelled();
      const method = options.method || 'GET';
      const query = options.query ? `?${options.query}` : '';
      let response;
      let text;
      try {
        response = await this.fetch(`${ROOT_URL}${path}${query}`, {
          method,
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body: options.body || undefined,
          credentials: 'include',
          signal: this.abortController.signal,
        });
        text = await response.text();
      } catch (error) {
        this.throwIfCancelled();
        throw error;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = text;
      }
      if (!response.ok) {
        throw new PanRelayError(`网络请求失败：HTTP ${response.status}`, { response: data });
      }
      if (options.checkErrno && data && typeof data === 'object' && Number(data.errno || 0) !== 0) {
        throw new PanRelayError(data.show_msg || data.errmsg || `百度网盘错误 ${data.errno}`, {
          errno: Number(data.errno),
          response: data,
        });
      }
      return data;
    }

    async ensureBdstoken() {
      if (this.bdstoken) return this.bdstoken;
      const data = await this.request('/api/gettemplatevariable', {
        query: `fields=${encodeURIComponent('["bdstoken"]')}`,
        checkErrno: true,
      });
      this.bdstoken = data?.result?.bdstoken;
      if (!this.bdstoken) {
        throw new PanRelayError('未检测到百度网盘登录状态，请先登录 pan.baidu.com');
      }
      return this.bdstoken;
    }

    async listDestination(path) {
      await this.ensureBdstoken();
      return this.request('/api/list', {
        query: [
          'order=time',
          'desc=1',
          'showempty=0',
          'page=1',
          'num=1000',
          `dir=${encodePath(path)}`,
          `bdstoken=${encodeURIComponent(this.bdstoken)}`,
        ].join('&'),
        checkErrno: true,
      });
    }

    async createDirectory(path) {
      if (!path || path === '/') return;
      await this.ensureBdstoken();
      try {
        await this.listDestination(path);
        return;
      } catch (error) {
        if (error.errno !== -9) throw error;
      }
      await this.request('/api/create', {
        method: 'POST',
        query: `a=commit&bdstoken=${encodeURIComponent(this.bdstoken)}`,
        body: `path=${encodeURIComponent(path)}&isdir=1&block_list=[]`,
        checkErrno: true,
      });
    }

    async transferIds(ids, destination, retry = 0) {
      await this.ensureBdstoken();
      const data = await this.request('/share/transfer', {
        method: 'POST',
        query: [
          `shareid=${encodeURIComponent(this.shareId)}`,
          `from=${encodeURIComponent(this.userId)}`,
          'ondup=newcopy',
          'channel=chunlei',
          `bdstoken=${encodeURIComponent(this.bdstoken)}`,
        ].join('&'),
        body: `fsidlist=${encodeURIComponent(JSON.stringify(ids))}&path=${encodeURIComponent(destination || '/')}`,
      });
      const errno = Number(data?.errno || 0);
      const errMsg = data?.show_msg || data?.errmsg || '';
      if (errno === 0) {
        if (this.transferCooldownMs > 0) await this.wait(this.transferCooldownMs);
        return data;
      }
      if (isTransferLimitError(errno, errMsg)) {
        const limit = data.target_file_nums_limit;
        const count = data.target_file_nums;
        throw new PanRelayError(
          `超过单次转存限制${limit && count ? `（${count}/${limit}）` : ''}`,
          { errno: 12, response: data },
        );
      }
      const retriable =
        errno === 4 ||
        errno === 111 ||
        errno === 1504 ||
        /超时|timeout|繁忙|稍后再试|系统繁忙|网络/i.test(String(errMsg));
      if (retriable && retry < this.maxRetries) {
        const delay =
          errno === 111
            ? Math.min(30000, 5000 * (retry + 1))
            : Math.min(30000, 3000 * (retry + 1));
        this.progress(
          `转存受限或超时（errno=${errno}），${Math.ceil(delay / 1000)} 秒后重试（${retry + 1}/${this.maxRetries}）…`,
        );
        await this.wait(delay);
        return this.transferIds(ids, destination, retry + 1);
      }
      throw new PanRelayError(errMsg || `转存失败 errno=${errno}`, {
        errno,
        response: data,
      });
    }

    recordFailure(name, error) {
      const message = error?.message || String(error);
      this.failedTasks.push({ name, message });
      this.progress(`失败（已跳过，可稍后单独重试）：${name} — ${message}`);
    }

    async transferDirectoriesSafe(directories, destination, ancestry) {
      if (!directories.length) return;
      try {
        await this.transferDirectories(directories, destination, ancestry);
      } catch (error) {
        if (error.cancelled) throw error;
        if (directories.length === 1) {
          this.recordFailure(directories[0].name, error);
          return;
        }
        const rest = directories.filter((d) => !this.handledIds.has(String(d.id)));
        this.progress(
          `批量转存 ${directories.length} 个目录失败（${error.message || error}），剩余 ${rest.length} 个改为逐个转存…`,
        );
        for (const dir of rest) {
          await this.transferDirectoriesSafe([dir], destination, ancestry);
        }
      }
    }

    shareListQuery(page, dirValue, pageSize, listOptions = {}) {
      const num = pageSize || this.listPageSize;
      const { fid, dirEncoding = 'segment' } = listOptions;
      const parts = [
        `uk=${encodeURIComponent(this.userId)}`,
        `shareid=${encodeURIComponent(this.shareId)}`,
        'web=1',
        'app_id=250528',
        'channel=chunlei',
        'clienttype=0',
        // 按名称排序分页顺序确定；按时间排序遇到同一时刻的文件，翻页时可能重复或漏项
        'order=name',
        'desc=0',
        'showempty=0',
        `page=${page}`,
        `num=${num}`,
        `bdstoken=${encodeURIComponent(this.bdstoken)}`,
      ];
      if (this.sekey) {
        parts.push(`sekey=${encodeURIComponent(this.sekey)}`);
      }
      if (fid) {
        parts.push(`fid=${encodeURIComponent(String(fid))}`);
        parts.push('root=0');
        if (dirValue) parts.push(`dir=${dirValue}`);
      } else {
        const hasSubDir =
          dirValue &&
          dirValue !== '/' &&
          String(dirValue).length > 0;
        parts.push(`root=${hasSubDir ? 0 : 1}`);
        if (hasSubDir) {
          parts.push(`dir=${dirValue}`);
        }
      }
      return parts.join('&');
    }

    buildShareListDirVariants(sharePath, shareDirRaw) {
      const normalized = normalizeShareListPath(sharePath, shareDirRaw, this.shareRoot);
      const fromRaw = dirQueryValue(shareDirRaw, normalized);
      const fullEncoded = encodeURIComponent(normalized);
      const segmentEncoded = encodePath(normalized);
      const variants = [];
      const push = (value, encoding) => {
        if (!value || value === '/') return;
        const key = `${encoding}:${value}`;
        if (variants.some((v) => v.key === key)) return;
        variants.push({ key, value, encoding });
      };
      push(fromRaw, 'raw');
      push(segmentEncoded, 'segment');
      push(fullEncoded, 'full');
      if (normalized !== sharePath) {
        push(dirQueryValue(shareDirRaw, sharePath), 'raw-alt');
      }
      return { normalized, variants };
    }

    formatShareListError(error) {
      const errno = error?.errno;
      const base = error?.message || String(error);
      if (errno != null && errno !== '') {
        return `${base}（errno=${errno}）`;
      }
      return base;
    }

    async fetchShareListPage(sharePath, page, shareDirRaw, fid) {
      await this.ensureBdstoken();
      const { normalized, variants } = this.buildShareListDirVariants(sharePath, shareDirRaw);
      let lastError;
      const tryPlans = [];
      if (fid) {
        for (const v of variants) {
          tryPlans.push({ fid, dirValue: v.value, encoding: `fid+${v.encoding}` });
        }
        tryPlans.push({ fid, dirValue: '', encoding: 'fid-only' });
      }
      for (const v of variants) {
        tryPlans.push({ fid: null, dirValue: v.value, encoding: v.encoding });
      }

      let planIndex = 0;
      for (let attempt = 0; attempt < this.listMaxRetries && planIndex < tryPlans.length; ) {
        const pageSize = attempt >= 2 ? Math.min(25, this.listPageSize) : this.listPageSize;
        const plan = tryPlans[planIndex];
        try {
          const data = await this.request('/share/list', {
            query: this.shareListQuery(page, plan.dirValue, pageSize, {
              fid: plan.fid,
              dirEncoding: plan.encoding,
            }),
            checkErrno: true,
          });
          const list = Array.isArray(data.list) ? data.list : [];
          const items = list.map(mapShareListItem);
          const onlySelf =
            page === 1 &&
            fid &&
            items.length > 0 &&
            items.every((item) => String(item.id) === String(fid));
          if (onlySelf) {
            this.progress('列举结果仍是当前文件夹，换一种方式读取…');
            planIndex += 1;
            continue;
          }
          return { items, pageSize };
        } catch (error) {
          if (error.cancelled) throw error;
          lastError = error;
          if (!isRetriableShareError(error)) {
            throw new PanRelayError(
              `列举分享目录失败：${this.formatShareListError(error)}（路径：${normalized}）`,
              { errno: error.errno, response: error.response },
            );
          }
          if (attempt >= this.listMaxRetries - 1) {
            throw new PanRelayError(
              `列举分享目录失败：${this.formatShareListError(error)}（路径：${normalized}）`,
              { errno: error.errno, response: error.response },
            );
          }
          const delay = Math.min(30000, 3000 * (attempt + 1));
          this.progress(
            `列举分享目录超时或繁忙，${Math.ceil(delay / 1000)} 秒后重试（${attempt + 1}/${this.listMaxRetries}，${plan.encoding}）…`,
          );
          await this.wait(delay);
          attempt += 1;
        }
      }
      if (planIndex >= tryPlans.length) {
        throw new PanRelayError(
          `列举「${normalized}」只返回了文件夹本身，已停止，避免反复转存同一目录`,
        );
      }
      throw lastError;
    }

    /**
     * 分页列举并立刻转存，避免超大目录单次 list 拖垮接口。
     */
    async processShareDirectoryIncrementally(
      sourcePath,
      childDestination,
      shareDirRaw,
      fid,
      ancestry,
    ) {
      await this.createDirectory(childDestination);
      await this.wait(Math.max(800, Math.min(2000, this.transferCooldownMs)));
      for (let page = 1; ; page += 1) {
        this.progress(`读取分享目录第 ${page} 页：${sourcePath}`);
        const { items: batch, pageSize } = await this.fetchShareListPage(
          sourcePath,
          page,
          shareDirRaw,
          fid,
        );
        if (!batch.length) break;

        const childDirs = batch.filter(
          (c) => c.isDirectory && !ancestry.has(String(c.id)),
        );
        const childFiles = batch.filter((c) => !c.isDirectory);
        if (childDirs.length < batch.filter((c) => c.isDirectory).length) {
          this.progress('跳过与当前目录相同的结果，避免反复转存同一文件夹');
        }
        if (childDirs.length) {
          await this.transferDirectoriesSafe(childDirs, childDestination, ancestry);
        }
        if (childFiles.length) {
          await this.transferFiles(childFiles, childDestination);
        }

        if (batch.length < pageSize) break;
        await this.wait(600);
      }
    }

    async transferFiles(files, destination) {
      if (!files.length) return;
      await this.createDirectory(destination);
      let index = 0;
      while (index < files.length) {
        const batch = files.slice(index, index + this.fileBatchSize);
        try {
          await this.transferIds(batch.map((f) => f.id), destination);
        } catch (error) {
          if (error.cancelled || error.errno !== 12 || batch.length === 1) throw error;
          this.fileBatchSize = Math.max(1, Math.floor(batch.length / 2));
          this.progress(
            `每批 ${batch.length} 个文件超过转存限制，改为每批 ${this.fileBatchSize} 个继续…`,
          );
          continue;
        }
        for (const f of batch) this.handledIds.add(String(f.id));
        index += batch.length;
        this.progress(`已转存文件 ${index}/${files.length} → ${destination || '/'}`);
      }
    }

    async transferDirectories(directories, destination, ancestry = new Set()) {
      if (!directories.length) return;
      const seen = directories.filter((d) => ancestry.has(String(d.id)));
      const pending = directories.filter(
        (d) => !ancestry.has(String(d.id)) && !this.handledIds.has(String(d.id)),
      );
      if (seen.length) {
        this.progress(
          `跳过重复目录：${seen.map((d) => d.name).join('、')}`,
        );
      }
      if (!pending.length) return;
      await this.createDirectory(destination);
      try {
        await this.transferIds(pending.map((d) => d.id), destination);
        for (const item of pending) {
          this.handledIds.add(String(item.id));
          this.progress(`已转存目录 ${destination || ''}/${item.name}`);
        }
      } catch (error) {
        if (error.cancelled) throw error;
        if (error.errno !== 12) throw error;
        this.progress(`目录过大，正在拆分：${pending.map((d) => d.name).join('、')}`);
        if (pending.length > 1) {
          const middle = Math.floor(pending.length / 2);
          await this.transferDirectories(pending.slice(0, middle), destination, ancestry);
          await this.transferDirectories(pending.slice(middle), destination, ancestry);
          return;
        }
        const directory = pending[0];
        this.handledIds.add(String(directory.id));
        const next = new Set(ancestry);
        next.add(String(directory.id));
        const sourcePath = normalizeShareListPath(
          directory.sharePath,
          directory.shareDirRaw,
          this.shareRoot,
        );
        this.progress(`列出分享目录：${sourcePath}`);
        const childDestination = joinPath(destination, directory.name);
        try {
          await this.processShareDirectoryIncrementally(
            sourcePath,
            childDestination,
            directory.shareDirRaw,
            directory.id,
            next,
          );
        } catch (splitError) {
          // 拆分过程中已有部分内容转存成功，不能再整体重试，只记失败
          if (splitError.cancelled) throw splitError;
          this.recordFailure(directory.name, splitError);
        }
      }
    }

    normalizeSelection(selected) {
      const directories = [];
      const files = [];
      for (const item of selected) {
        const raw = item.path_raw != null ? item.path_raw : item.path;
        const entry = {
          id: item.fs_id,
          name: item.server_filename,
          isDirectory: Number(item.isdir) === 1,
          sharePath: raw ? decodePath(raw) : undefined,
          shareDirRaw: raw,
        };
        if (entry.isDirectory) directories.push(entry);
        else files.push(entry);
      }
      return { directories, files };
    }

    async runSelection(selected, destination) {
      if (!this.shareId || !this.userId) {
        throw new PanRelayError('分享页信息不完整，请刷新页面后重试');
      }
      const dest = destination || '/';
      this.destinationRoot = dest;
      this.failedTasks = [];
      const { directories, files } = this.normalizeSelection(selected);
      if (!directories.length && !files.length) {
        throw new PanRelayError('请至少选择一个文件或文件夹');
      }
      this.progress(`开始接力转存到 ${dest}（每批最多 ${this.batchSize} 个文件）…`);
      if (directories.length) await this.transferDirectoriesSafe(directories, dest, new Set());
      if (files.length) await this.transferFiles(files, dest);
      this.finish();
    }

    /** 在分享子目录里全选时：把该目录的全部内容（不含目录本身）转存到 destination */
    async runDirectoryContents(sharePath, destination) {
      if (!this.shareId || !this.userId) {
        throw new PanRelayError('分享页信息不完整，请刷新页面后重试');
      }
      const dest = destination || '/';
      this.destinationRoot = dest;
      this.failedTasks = [];
      const source = normalizeShareListPath(sharePath, sharePath, this.shareRoot);
      this.progress(`开始接力转存「${source}」里的全部内容到 ${dest}（每批最多 ${this.batchSize} 个文件）…`);
      await this.processShareDirectoryIncrementally(source, dest, sharePath, null, new Set());
      this.finish();
    }

    finish() {
      if (this.failedTasks.length) {
        const names = this.failedTasks.map((t) => t.name).join('、');
        throw new PanRelayError(
          `部分目录转存失败（${this.failedTasks.length} 项）：${names}。已成功项已在网盘中，可对未完成的子文件夹单独勾选后再点保存。`,
        );
      }
      this.progress('全部转存完成');
    }
  }

  function readBalancedJson(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i += 1;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return '';
  }

  /**
   * 从分享页 HTML 解析分享信息，不依赖页面全局变量：
   * 新版 `<script id="locals-data" type="application/json">`，旧版 `locals.mset({...})`。
   */
  function parseShareHtml(html) {
    const text = String(html || '');
    let data = null;
    const v2 = text.match(/<script[^>]*id="locals-data"[^>]*>([\s\S]*?)<\/script>/i);
    if (v2) {
      try {
        data = JSON.parse(v2[1].trim());
      } catch (_) {
        data = null;
      }
    }
    if (!data) {
      const at = text.indexOf('locals.mset(');
      const start = at >= 0 ? text.indexOf('{', at) : -1;
      const json = start >= 0 ? readBalancedJson(text, start) : '';
      try {
        data = json ? JSON.parse(json) : null;
      } catch (_) {
        data = null;
      }
    }
    if (!data || data.shareid == null) return null;
    const fileList = Array.isArray(data.file_list) ? data.file_list : [];
    return {
      shareId: String(data.shareid || ''),
      userId: String(data.share_uk || ''),
      bdstoken: String(data.bdstoken || ''),
      shareRoot: decodePath(fileList[0]?.parent_path || '/') || '/',
      loginstate: String(data.loginstate ?? '0'),
      fileList,
    };
  }

  root.PanRelay = {
    PanRelayError,
    ShareTransferEngine,
    parseShareHtml,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
