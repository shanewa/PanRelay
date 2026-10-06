<p align="center">
  <img src="assets/PanRelay-256.png" alt="PanRelay logo" width="160">
</p>

# PanRelay · 度盘接力存

Baidu Pan relay save：在百度网盘**分享页**自动分批次转存到自己的网盘（默认每批最多 **500** 个文件），绕过网页端一次性转存数量限制。

纯前端 Edge / Chromium 扩展，无后端。插件完全免费，首次使用需关注公众号并填写解锁码。

## 功能（当前）

**接力转存**

- 在 `pan.baidu.com/s/...` 分享页注入脚本
- 读取你在页面底部设置的「保存到」路径（与官方 UI 一致）
- 点击「保存到网盘」时，若选中项**含文件夹**或**顶层文件数超过每批上限**，扩展会接管并调用网页端 `/share/transfer` 分批转存
- 右下角浮层显示进度与日志
- 弹窗可调 **转存间隔**（毫秒），降低百度限流/超时概率

**视频倍速**（对页面内 `video`/`audio` 设置倍速并周期性同步 `playbackRate`）

- 在 `pan.baidu.com` / `yun.baidu.com` 播放页对 `video`/`audio` 生效（含 iframe）
- 弹窗倍速 0.07–16×（步进 0.01）、12 个快捷预设与 ±0.01/±0.1 细调；主世界注入 `speed-main.js` 对抗播放器改回 1×；当前倍速嵌在播放器底栏「流畅」与声音图标之间，样式与「字幕 / 倍速 / 流畅」一致

## 安装（Edge 开发者模式）

1. 打开 `edge://extensions/`
2. 开启「开发人员模式」
3. 选择「加载解压缩的扩展」
4. 选中本仓库下的 `extension` 目录
5. 点击扩展图标，扫码关注公众号并填写解锁码

请先登录 [百度网盘](https://pan.baidu.com)，再打开别人的分享链接（可带提取码，例如 `?pwd=1234`）。

## 使用

1. 打开分享链接，勾选要转存的文件/文件夹（或全选）
2. 在底部设置「保存到」目标目录
3. 点击「保存到网盘」
4. 需要接力时，右下角会出现 PanRelay 面板并自动分批完成

扩展图标弹窗：未解锁时显示公众号二维码；解锁后可调整接力开关/批次/始终接力/转存间隔，以及视频倍速与预设。

## Logo / 图标

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

1. 点击扩展图标，用微信扫描弹窗中的二维码
2. 关注后发送关键词 **`百度网盘插件`**
3. 把公众号回复中的 **6 位数字** 填入弹窗

未解锁时：网页原生长保存仍可用；接力转存与倍速不生效。

**公众号后台配置（关键词回复）**

- 关键词：`百度网盘插件`（建议完全匹配）
- 回复内容需包含解锁码：`827461`  
  例如：`解锁码：827461（插件免费。关注后遇到问题可直接给作者发消息改进。把解锁码填到浏览器扩展弹窗即可）`

## 目录结构

```
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
- 转存接口与 Cookie 均在浏览器内完成，扩展不上传账号数据。
- 视频倍速若被页面强行改回 1×，可再在页面主世界 hook `playbackRate` 属性。

## 参考

- 分享页 UI 行为可参考本地保存的页面样本（`保存到网盘` → `node-type="bottomShareSave"`）
- 扩展工程布局参考同目录下的 `ai-content-factory/apps/extension`

## 许可

本项目以 [MIT License](LICENSE) 开源。

使用本扩展访问、转存网盘内容时，请遵守百度网盘用户协议与相关法律法规。
