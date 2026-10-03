# PanRelay · 度盘接力存

Baidu Pan relay save：在百度网盘**分享页**自动分批次转存到自己的网盘（默认每批最多 **500** 个文件），绕过网页端一次性转存数量限制。

Phase 1 为纯前端 Edge / Chromium 扩展，无后端。

## 功能（当前）

- 在 `pan.baidu.com/s/...` 分享页注入脚本
- 读取你在页面底部设置的「保存到」路径（与官方 UI 一致）
- 点击「保存到网盘」时，若选中项**含文件夹**或**顶层文件数超过每批上限**，扩展会接管并调用网页端 `/share/transfer` 分批转存
- 右下角浮层显示进度与日志

## 安装（Edge 开发者模式）

1. 打开 `edge://extensions/`
2. 开启「开发人员模式」
3. 选择「加载解压缩的扩展」
4. 选中本仓库下的 `extension` 目录

请先登录 [百度网盘](https://pan.baidu.com)，再打开别人的分享链接（可带提取码，例如 `?pwd=1234`）。

## 使用

1. 打开分享链接，勾选要转存的文件/文件夹（或全选）
2. 在底部设置「保存到」目标目录
3. 点击「保存到网盘」
4. 需要接力时，右下角会出现 PanRelay 面板并自动分批完成

扩展图标弹窗可调整：是否启用、每批数量（50–500）、是否始终走接力。

## 目录结构

```
extension/
  manifest.json
  content/share-relay.js    # 拦截保存按钮、进度 UI
  injected/page-bridge.js   # 读取页面 context / 保存路径
  lib/transfer-core.js      # 转存与拆分逻辑
  popup/                    # 设置
```

## Git hooks（与 staff-star 相同方式）

克隆或拉取后在本仓库根目录执行一次：

```bash
node scripts/install-git-hooks.mjs
```

Windows PowerShell：

```powershell
powershell -File scripts/install-git-hooks.ps1
```

会安装 `pre-commit`（禁止 CRLF 进库）、`commit-msg`（去掉 `Co-authored-by`），并设置本仓库本地 `user.name` / `user.email`。

**自动提交（Cursor）**：`.cursor/hooks.json` 在编辑文件后约 8 秒防抖提交；Agent 会话结束时会立刻提交剩余改动。环境变量 `PANRELAY_COMMIT_DEBOUNCE_MS` 可改等待时间。详见 `AGENTS.md`。

## 开发说明

- 页面桥接依赖百度网盘页面内的 `require('system-core:context/context.js')` 与 `locals`；若百度改版导致失效，需更新 `injected/page-bridge.js` 选择器或 API。
- 转存接口与 Cookie 均在浏览器内完成，扩展不上传账号数据。
- 后续 Phase：分享页视频倍速控制。

## 参考

- 分享页 UI 行为可参考本地保存的页面样本（`保存到网盘` → `node-type="bottomShareSave"`）
- 扩展工程布局参考同目录下的 `ai-content-factory/apps/extension`

## 许可

个人学习与整理资源用途；请遵守百度网盘用户协议与相关法律法规。
