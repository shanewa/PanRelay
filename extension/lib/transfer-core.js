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

  class ShareTransferEngine {
    constructor(options = {}) {
      this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
      this.onProgress = options.onProgress || (() => {});
      this.batchSize = options.batchSize || 500;
      this.maxRetries = options.maxRetries ?? 12;
      this.shareId = options.shareId;
      this.userId = options.userId;
      this.bdstoken = options.bdstoken;
      this.shareRoot = options.shareRoot || '/';
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
      if (errno === 0) return data;
      if ((errno === 111 || errno === 1504) && retry < this.maxRetries) {
        const delay = errno === 111 ? Math.min(30000, 5000 * (retry + 1)) : 1500;
        this.progress(`请求过快，${Math.ceil(delay / 1000)} 秒后重试…`);
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
      throw new PanRelayError(data?.show_msg || data?.errmsg || `转存失败 errno=${errno}`, {
        errno,
        response: data,
      });
    }

    async listShareDirectory(path) {
      await this.ensureBdstoken();
      const result = [];
      for (let page = 1; ; page += 1) {
        const data = await this.request('/share/list', {
          query: [
            `uk=${encodeURIComponent(this.userId)}`,
            `shareid=${encodeURIComponent(this.shareId)}`,
            'order=name',
            'desc=0',
            'showempty=0',
            `page=${page}`,
            'num=100',
            `dir=${encodePath(path)}`,
          ].join('&'),
          checkErrno: true,
        });
        const list = Array.isArray(data.list) ? data.list : [];
        for (const item of list) {
          result.push({
            id: item.fs_id,
            name: item.server_filename,
            isDirectory: Number(item.isdir) === 1,
            path: item.path,
          });
        }
        if (list.length < 100) return result;
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
        const relative = destination === '/' ? '' : destination;
        const sourcePath = `${this.shareRoot}${relative}/${directory.name}`.replace(/\/+/g, '/');
        const children = await this.listShareDirectory(sourcePath);
        const childDestination = `${destination}/${directory.name}`.replace(/\/+/g, '/');
        const childDirs = children.filter((c) => c.isDirectory);
        const childFiles = children.filter((c) => !c.isDirectory);
        await this.createDirectory(childDestination);
        if (childDirs.length) await this.transferDirectories(childDirs, childDestination);
        if (childFiles.length) await this.transferFiles(childFiles, childDestination);
      }
    }

    normalizeSelection(selected) {
      const directories = [];
      const files = [];
      for (const item of selected) {
        const entry = {
          id: item.fs_id,
          name: item.server_filename,
          isDirectory: Number(item.isdir) === 1,
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
      const { directories, files } = this.normalizeSelection(selected);
      if (!directories.length && !files.length) {
        throw new PanRelayError('请至少选择一个文件或文件夹');
      }
      this.progress(`开始接力转存到 ${dest}（每批最多 ${this.batchSize} 个文件）…`);
      if (directories.length) await this.transferDirectories(directories, dest);
      if (files.length) await this.transferFiles(files, dest);
      this.progress('全部转存完成');
    }
  }

  root.PanRelay = {
    PanRelayError,
    ShareTransferEngine,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
