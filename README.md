<p align="center">
  <img src="assets/PanRelay-256.png" alt="PanRelay logo" width="160">
</p>

# PanRelay · 度盘接力存

Baidu Pan relay save：在百度网盘**分享页**，在你点击「保存到网盘」后，按与网页相同的接口**分批**转存到自己的网盘（默认每批最多 **500** 个文件），并可在弹窗调节转存间隔。

纯前端 Edge / Chromium 扩展，无后端。插件完全免费，首次使用需关注公众号并填写解锁码。请先在浏览器中**自行登录**百度网盘；扩展不保存百度账号密码，转存请求仅使用浏览器已有登录状态。

- 实现细节：[docs/architecture.md](docs/architecture.md)
- 隐私说明（商店提审）：[docs/PRIVACY.md](docs/PRIVACY.md)
- 商店文案草稿：[docs/store-listing.md](docs/store-listing.md)
- 上架审核清单：[docs/store-review.md](docs/store-review.md)

## 功能（当前）

**接力转存**

- 在 `pan.baidu.com/s/...` 分享页注入脚本
- 读取你在页面底部设置的「保存到」路径（与官方 UI 一致）
- **仅在你点击**「保存到网盘」时：若选中项含文件夹或顶层文件数超过每批上限，扩展会接管并调用网页端 `/share/transfer` 分批转存（不会在后台静默跑任务）
- **群分享**：在 `pan.baidu.com/disk/main#/im/...` 的群「文件库」里勾选文件点「转存」、选好目录确定后，若百度提示超出转存上限，扩展沿用这次请求的群、消息与目标路径，改为分批接力转存；没超限的转存不受影响
- 右下角浮层显示进度条与日志，可收起
- 弹窗可调 **转存间隔**（毫秒），降低百度限流/超时概率

**视频倍速**（对页面内 `video`/`audio` 设置倍速并周期性同步 `playbackRate`）

- 在 `pan.baidu.com` / `yun.baidu.com` 播放页对 `video`/`audio` 生效（含 iframe）
- 弹窗倍速 0.07–16×（步进 0.01）、12 个快捷预设与 ±0.01/±0.1 细调；主世界注入 `speed-main.js` 对抗播放器改回 1×；当前倍速嵌在播放器底栏「流畅」与声音图标之间，样式与「字幕 / 倍速 / 流畅」一致

**AI 视频笔记下载 MD**

- 在播放页的「图文笔记」工具栏「分享」后面增加「下载MD」按钮
- 点击后把「以下为AI生成的图文笔记的内容」起的笔记（标题、段落、列表、表格、图片链接）导出为 Markdown 文件，在本地生成，不上传
- 文件名以当前播放的视频名开头，格式为 `<视频名>_<笔记标题>.md`
- 弹窗可关闭该按钮（默认开启）

## 打包（提交商店前）

zip **根目录**直接是 `manifest.json`（不要多包一层 `extension/` 文件夹）。所有脚本与资源均在包内，**不远程加载 JS**（MV3）。

```bash
make pack
# 或：node scripts/pack-extension.mjs
```

输出：`dist/PanRelay-<version>.zip`（Node 生成的标准 ZIP，`PK` 头，可用 `unzip -t` 校验）。仅包含下列路径（与 `scripts/pack-extension.mjs` 白名单一致）：

- 根：`manifest.json`、`background.js`
- 目录：`assets/`、`content/`、`icons/`、`injected/`、`lib/`、`popup/`、`styles/`

发版前可执行 `make check`（或 `--check-only`）做文件与远程脚本检查。本地验证：`edge://extensions` → 开发者模式 → **加载已解压的** `extension` 目录，确认功能与权限无报错。

## 安装（Edge 开发者模式）

1. 打开 `edge://extensions/`
2. 开启「开发人员模式」
3. 选择「加载解压缩的扩展」
4. 选中本仓库下的 `extension` 目录
5. 工具栏图标未解锁时带蓝色「关注」角标；点图标或在分享页点「保存到网盘」才会出现扫码解锁卡片。

请先登录 [百度网盘](https://pan.baidu.com)，再打开别人的分享链接（可带提取码，例如 `?pwd=1234`）。

## 使用

1. 打开分享链接，勾选要转存的文件/文件夹（或全选）
2. 在底部设置「保存到」目标目录
3. 点击「保存到网盘」
4. 未解锁时点「保存到网盘」会弹出关注公众号卡片（网页原生长保存仍继续）；解锁后需要接力时右下角出现进度面板

扩展图标弹窗：未解锁时显示公众号二维码；解锁后可调整接力开关/批次/始终接力/转存间隔，视频倍速与预设，以及「下载MD」按钮开关。

## Logo / 图标

Logo 把百度网盘做成章鱼的身体与触手：盘是躯干，触手是接力转存与倍速等能力，寓意插件可以强化百度网盘。

- 主 Logo：`assets/PanRelay.png`（设计稿）
- README 展示：`assets/PanRelay-256.png`（256×256 导出）
- 扩展工具栏图标：`extension/icons/icon16.png` … `icon128.png`（由脚本从主 Logo 生成）

更新 Logo 后执行：

```bash
node scripts/generate-icons.mjs
# 或：python scripts/generate_icons.py
```

然后在 `edge://extensions/` 中 **重新加载** 扩展。

## 关注公众号解锁

插件免费，但需要先关注公众号（方便你遇到问题时直接联系作者改进）：

1. 点扩展图标，或在分享页点「保存到网盘」时出现扫码卡片（打开网盘本身不会弹）
2. 微信扫描二维码关注公众号（为了遇到问题时能直接联系作者改进）
3. 发送关键词 **`百度网盘插件`**
4. 把公众号回复中的 **6 位数字** 填入卡片或扩展弹窗

未解锁时：网页原生长保存仍可用；接力转存与倍速不生效。

**公众号后台配置（关键词回复）**

- 关键词：`百度网盘插件`（建议完全匹配）
- 回复内容需包含解锁码：`827461`  
  例如：`解锁码：827461（插件免费。关注后遇到问题可直接给作者发消息改进。把解锁码填到浏览器扩展弹窗即可）`

## 目录结构

```
docs/
  architecture.md           # 实现原理与详细设计
  PRIVACY.md                # 隐私说明（商店隐私政策链接）
  store-listing.md          # Chrome / Edge 上架文案草稿
  store-review.md           # 发版前审核自检清单
extension/
  manifest.json
  content/share-relay.js    # 拦截保存按钮、进度 UI
  injected/page-bridge.js   # 读取页面 context / 保存路径
  lib/transfer-core.js      # 转存与拆分逻辑
  lib/unlock.js             # 公众号解锁码校验
  assets/wechat-oa-qr.jpg   # 公众号二维码（与识谱帮 about 页同源）
  popup/                    # 解锁 + 设置
```

## 开发说明

- 页面桥接依赖百度网盘页面内的 `require('system-core:context/context.js')` 与 `locals`；若百度改版导致失效，需更新 `injected/page-bridge.js` 选择器或 API。
- 转存接口与 Cookie 均在浏览器内完成，扩展不上传百度账号密码；详见 [docs/PRIVACY.md](docs/PRIVACY.md)。
- 视频倍速若被页面强行改回 1×，可再在页面主世界 hook `playbackRate` 属性。

## 参考

- 分享页 UI 行为可参考本地保存的页面样本（`保存到网盘`：旧版 `node-type="bottomShareSave"`，新版 `button.bottom_save_btn`）
- 扩展工程布局参考同目录下的 `ai-content-factory/apps/extension`

## 许可

本项目以 [MIT License](LICENSE) 开源。

使用本扩展访问、转存网盘内容时，请遵守百度网盘用户协议与相关法律法规。
