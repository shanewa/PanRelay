/**
 * 百度网盘分享页转存核心（在 content script 中运行，携带页面 Cookie）。
 * 参考公开网页端接口：POST /share/transfer
 */
(function (root) {
  'use strict';

  const ROOT_URL = 'https://pan.baidu.com';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class PanRelayError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'PanRelayError';
      this.errno = options.errno;
      this.response = options.response;
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

  function isRetriableShareError(error) {
    if (!error) return false;
    const errno = Number(error.errno);
    // errno 2 等多为「链接出错/参数错误」，重试无效
    if (errno === 2 || errno === -7 || errno === 105 || errno === 116) return false;
    const msg = String(error.message || '');
    if (/超时|timeout|繁忙|稍后再试|系统|网络/i.test(msg)) return true;
    return errno === 111 || errno === 1504 || errno === -1;
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
      this.listPageSize = options.listPageSize || 60;
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
    }

    progress(message) {
      this.onProgress(String(message));
    }

    async request(path, options = {}) {
      const method = options.method || 'GET';
      const query = options.query ? `?${options.query}` : '';
      const response = await this.fetch(`${ROOT_URL}${path}${query}`, {
        method,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: options.body || undefined,
        credentials: 'include',
      });
      const text = await response.text();
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
        if (this.transferCooldownMs > 0) await sleep(this.transferCooldownMs);
        return data;
      }
      const retriable =
        errno === 111 ||
        errno === 1504 ||
        /超时|繁忙|稍后再试|系统|网络/i.test(String(errMsg));
      if (retriable && retry < this.maxRetries) {
        const delay =
          errno === 111
            ? Math.min(30000, 5000 * (retry + 1))
            : Math.min(30000, 3000 * (retry + 1));
        this.progress(
          `转存受限或超时，${Math.ceil(delay / 1000)} 秒后重试（${retry + 1}/${this.maxRetries}）…`,
        );
        await sleep(delay);
        return this.transferIds(ids, destination, retry + 1);
      }
      if (errno === 12) {
        const limit = data.target_file_nums_limit;
        const count = data.target_file_nums;
        throw new PanRelayError(
          `超过单次转存限制${limit && count ? `（${count}/${limit}）` : ''}`,
          { errno, response: data },
        );
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

    async transferDirectoriesSafe(directories, destination) {
      if (!directories.length) return;
      try {
        await this.transferDirectories(directories, destination);
      } catch (error) {
        if (directories.length === 1) {
          this.recordFailure(directories[0].name, error);
          return;
        }
        throw error;
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
        'order=time',
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

      for (let attempt = 0; attempt < this.listMaxRetries; attempt += 1) {
        const pageSize = attempt >= 2 ? Math.min(25, this.listPageSize) : this.listPageSize;
        const plan = tryPlans[Math.min(attempt, tryPlans.length - 1)] || tryPlans[0];
        try {
          const data = await this.request('/share/list', {
            query: this.shareListQuery(page, plan.dirValue, pageSize, {
              fid: plan.fid,
              dirEncoding: plan.encoding,
            }),
            checkErrno: true,
          });
          const list = Array.isArray(data.list) ? data.list : [];
          return { items: list.map(mapShareListItem), pageSize };
        } catch (error) {
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
          await sleep(delay);
        }
      }
      throw lastError;
    }

    /**
     * 分页列举并立刻转存，避免超大目录单次 list 拖垮接口。
     */
    async processShareDirectoryIncrementally(sourcePath, childDestination, shareDirRaw, fid) {
      await this.createDirectory(childDestination);
      await sleep(Math.max(800, Math.min(2000, this.transferCooldownMs)));
      for (let page = 1; ; page += 1) {
        this.progress(`读取分享目录第 ${page} 页：${sourcePath}`);
        const { items: batch, pageSize } = await this.fetchShareListPage(
          sourcePath,
          page,
          shareDirRaw,
          fid,
        );
        if (!batch.length) break;

        const childDirs = batch.filter((c) => c.isDirectory);
        const childFiles = batch.filter((c) => !c.isDirectory);
        for (const dir of childDirs) {
          await this.transferDirectoriesSafe([dir], childDestination);
        }
        if (childFiles.length) {
          await this.transferFiles(childFiles, childDestination);
        }

        if (batch.length < pageSize) break;
        await sleep(600);
      }
    }

    async transferFiles(files, destination) {
      if (!files.length) return;
      await this.createDirectory(destination);
      for (let index = 0; index < files.length; index += this.batchSize) {
        const batch = files.slice(index, index + this.batchSize);
        await this.transferIds(batch.map((f) => f.id), destination);
        this.progress(
          `已转存文件 ${Math.min(index + batch.length, files.length)}/${files.length} → ${destination || '/'}`,
        );
      }
    }

    async transferDirectories(directories, destination) {
      if (!directories.length) return;
      await this.createDirectory(destination);
      try {
        await this.transferIds(directories.map((d) => d.id), destination);
        for (const item of directories) {
          this.progress(`已转存目录 ${destination || ''}/${item.name}`);
        }
      } catch (error) {
        if (error.errno !== 12) throw error;
        this.progress(`目录过大，正在拆分：${directories.map((d) => d.name).join('、')}`);
        if (directories.length > 1) {
          const middle = Math.floor(directories.length / 2);
          await this.transferDirectories(directories.slice(0, middle), destination);
          await this.transferDirectories(directories.slice(middle), destination);
          return;
        }
        const directory = directories[0];
        const sourcePath = normalizeShareListPath(
          directory.sharePath,
          directory.shareDirRaw,
          this.shareRoot,
        );
        this.progress(`列出分享目录：${sourcePath}`);
        const childDestination = joinPath(destination, directory.name);
        await this.processShareDirectoryIncrementally(
          sourcePath,
          childDestination,
          directory.shareDirRaw,
          directory.id,
        );
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
      if (directories.length) await this.transferDirectories(directories, dest);
      if (files.length) await this.transferFiles(files, dest);
      if (this.failedTasks.length) {
        const names = this.failedTasks.map((t) => t.name).join('、');
        throw new PanRelayError(
          `部分目录转存失败（${this.failedTasks.length} 项）：${names}。已成功项已在网盘中，可对未完成的子文件夹单独勾选后再点保存。`,
        );
      }
      this.progress('全部转存完成');
    }
  }

  root.PanRelay = {
    PanRelayError,
    ShareTransferEngine,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
