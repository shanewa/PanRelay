# PanRelay — Agent 指南

度盘接力存：百度网盘分享页 Edge 扩展（分批转存）。

## Git

- **未明确要求时，不要 `git push`**
- 不执行破坏性 git 命令（`reset --hard`、`push --force` 等）
- **提交者**：Author 必须是 `Shane Wang <shanewa@qq.com>`；commit 信息中**禁止** `Co-authored-by`（含 Cursor 自动追加行）。
- **强制遵守**：
  - 克隆或拉取后执行 `node scripts/install-git-hooks.mjs`（Windows 也可用 `powershell -File scripts/install-git-hooks.ps1`）。安装脚本会写入本仓库**本地** `user.name` / `user.email`；`commit-msg` 会删掉 `Co-authored-by`；`pre-commit` 会拒绝暂存区中的 CRLF。
  - **换行符**：文本文件一律 **LF**（见 `.gitattributes`、`.editorconfig`）。若 `git add` 报 CRLF，执行 `node scripts/normalize-worktree-lf.mjs` 后重试。
  - Cursor：**Settings → Git & PRs → Attribution → Commit Attribution** 建议关闭，避免署名行触发 hook 失败。
- **自动提交**：`.cursor/hooks.json` 在 `afterFileEdit` 后防抖提交（默认 8s，`PANRELAY_COMMIT_DEBOUNCE_MS` 可改）；Agent 结束 `stop` 时会 `--force` 提交剩余改动。不提交 `.env` 等敏感路径。Windows 下 hook 经 `wscript` + `run-node-hidden.vbs` 启动 node，避免 CMD 一闪而过；Agent 在本机勿用 `wsl` 跑仓库脚本。
- **提交信息**：首行说明「为什么」；空一行后 bullet 列「做了什么」（自动提交脚本会生成 `自动保存工作区改动` 模板）。

## Workflow（Agent 收尾，强制）

有代码改动就必须提交，不留给用户自行 commit（除非用户明确说「先不要 commit」）。

1. 判断本会话是否改动了仓库内代码、测试、脚本或项目配置。
2. 若有，在结束回复前完成 `git add` + `git commit`；无相关改动时不做空提交。
3. 回复末尾附上 `git log -1 --oneline`。
4. 只纳入与任务相关的文件；排除密钥与无关产物。

细则见 `.cursor/rules/git-commit-workflow.mdc`。
