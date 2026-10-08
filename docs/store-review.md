# Chrome / Edge 上架审核核对清单

网盘分享页分批转存 + 百度网页倍速扩展的**发版前自检**。与 [商店文案](store-listing.md)、[隐私说明](PRIVACY.md)、[架构说明](architecture.md) 配套使用。

**图例**：`[x]` 已满足 · `[~]` 部分满足 / 需在问卷中如实说明 · `[ ]` 待改进（见备注）

**最后对照版本**：`extension/manifest.json` → `0.3.0`（发版时改此行）

---

## 发版前 5 分钟

- [ ] `manifest.json` 的 `version` 已递增
- [ ] 已执行 `make pack` 或 `node scripts/pack-extension.mjs`，zip 根目录为 `manifest.json`（见 README「打包」）
- [ ] 商店「隐私政策 URL」指向公开的 [PRIVACY.md](PRIVACY.md)
- [ ] 商店描述复制自 [store-listing.md](store-listing.md)，未含禁用用语
- [ ] 本地在分享页走一遍：未登录提示、解锁、点击保存、分批日志、小批量走官方保存
- [ ] 本地在播放页：弹窗关/开倍速、HUD 仅非 1× 时显示

---

## 一、代码与功能层

### 1. 账号与鉴权

| 项 | 状态 | 说明 / 代码位置 |
|----|------|-----------------|
| 不模拟登录、不填表、不存百度密码 | [x] | 无登录相关逻辑；[PRIVACY.md](PRIVACY.md) 已写明 |
| 使用浏览器已有 Cookie 同源请求 | [x] | `lib/transfer-core.js` → `fetch(..., credentials: 'include')` |
| 转存由用户点击触发，非后台静默 | [x] | `content/share-relay.js` → 监听「保存到网盘」`click`，`onSaveClick` |
| 未解锁不拦截官方保存 | [x] | 未解锁时 `onSaveClick` 仅 `showGuide`，不 `preventDefault` |
| 分批前有二次确认（摘要 + 开始/取消） | [ ] | **P1**：接管后直接 `runRelay`；可加确认框 |
| 请求间隔可配置，默认非零 | [x] | 默认 `transferCooldownMs: 1500`，弹窗 800–6000 ms |

### 2. API 与请求行为

| 项 | 状态 | 说明 / 代码位置 |
|----|------|-----------------|
| 无高频无延迟硬刷 | [x] | 批间 `transferCooldownMs`；失败指数退避重试 |
| 重试有上限，失败可停止 | [x] | `maxRetries` / `listMaxRetries`（`transfer-core.js`） |
| 仅当前分享页选中项，不扫全盘 | [x] | `page-bridge.js` 选中列表 + 分享目录列举 |
| 无硬编码网盘密钥 | [x] | 使用页面 `bdstoken` / `shareid` 等上下文 |
| 无自有后端中转 | [x] | 纯前端；隐私与商店文案已强调 |
| 连续多批失败熔断 | [ ] | **P2**：可加强为中止任务并提示 |

### 3. 网页视频倍速

| 项 | 状态 | 说明 / 代码位置 |
|----|------|-----------------|
| 仅百度域名 | [x] | `host_permissions` + `content_scripts.matches` |
| 主要改 `playbackRate`，非全站劫持 | [~] | `injected/speed-main.js`；问卷答「仅设置媒体播放速率」 |
| 可关闭倍速 | [x] | 弹窗「启用倍速」；`cfg.enabled === false` 时不应用 |
| 默认 1×，不强制全开网页视频 | [~] | 未解锁强制 1×；解锁后默认 `videoSpeedEnabled: true`（**P1** 可改为默认关） |
| 审核口径「点插件/面板后生效」 | [~] | 需在弹窗开启并设速；开启后会周期同步（`setInterval`） |
| MAIN 世界 hook 原型 | [~] | 对抗播放器改回 1×；如实说明范围与目的，避免写「修改网站核心 JS」 |

### 4. 权限最小化

当前 manifest（对照用）：

```json
"permissions": ["storage"],
"host_permissions": [
  "https://pan.baidu.com/*",
  "https://yun.baidu.com/*"
]
```

| 项 | 状态 | 说明 |
|----|------|------|
| 无 `tabs` / `cookies` / `webRequest` / `<all_urls>` | [x] | 见 `extension/manifest.json` |
| `web_accessible_resources` 限定百度域名 | [x] | `page-bridge.js`、`wechat-oa-qr.jpg` |
| 分享脚本 match 收窄到分享路径 | [x] | `/s/*`、`share/init*` |
| 倍速脚本为全站百度 match | [~] | 播放页路径不固定；**P2** 可尝试收窄 match（维护成本高） |

---

## 二、文案描述层

| 项 | 状态 | 说明 |
|----|------|------|
| README 无「绕过 / 自动静默」等用语 | [x] | 见根目录 `README.md` |
| 商店专用描述草稿 | [x] | [store-listing.md](store-listing.md) |
| `manifest.description` 中性表述 | [x] | 用户点击、自行登录、无后端 |
| 截图与宣传不含「突破 500 / 破解」 | [ ] | 提审时人工检查 |
| 公众号解锁表述（非卖百度服务） | [x] | 商店文案与弹窗说明 |

**禁用词**（描述、截图字幕、视频）：绕过、破解、无限、自动批量、静默转存、爬取、劫持登录 → 见 [store-listing.md#文案避免用语](store-listing.md)。

---

## 三、隐私合规层

| 项 | 状态 | 说明 |
|----|------|------|
| 公开隐私政策页 | [x] | [PRIVACY.md](PRIVACY.md) |
| 说明 storage、Cookie、无后端、无追踪 | [x] | 同上 |
| 单一用途与 manifest 一致 | [x] | [store-listing.md#单一用途](store-listing.md) |
| 远程代码 / 外部脚本 | [x] | MV3 包内脚本，无远程加载 JS |
| 数据安全问卷与正文一致 | [ ] | 按 [PRIVACY.md](PRIVACY.md) 逐项勾选 |

---

## 四、提交打包层

| 项 | 状态 | 说明 |
|----|------|------|
| 上传 zip 仅含 `extension/` 白名单文件 | [x] | `make pack` → `dist/PanRelay-<version>.zip` |
| 图标 128 / 48 等齐全 | [x] | `extension/icons/` |
| 权限声明与 manifest 一致 | [ ] | 商店后台与 json 人工对照 |
| 测试账号说明（若审核要求） | [ ] | 准备：已登录百度、公开分享链接 + 提取码 |

---

## 五、风险兜底

| 项 | 状态 | 说明 |
|----|------|------|
| 用户协议 / 合规提示 | [x] | README 末尾遵守百度协议与法律 |
| 风控免责（间隔仍可能限流） | [x] | 弹窗 hint + [PRIVACY.md](PRIVACY.md) |
| 百度改版导致功能失效 | [ ] | 审核备注：依赖页面结构，非恶意行为 |
| 账号封禁 | [ ] | 商店 FAQ：合理间隔，不保证百度侧结果 |

---

## 待办路线图（非 P0）

| 优先级 | 项 | 关联章节 |
|--------|-----|----------|
| P1 | 接力开始前确认对话框 | §1.1 |
| P1 | 倍速默认关闭或首次启用提示 | §1.3 |
| P2 | 转存任务「停止」+ 连续失败熔断 | §1.2 |
| P2 | 倍速 `content_scripts` match 收窄 | §1.4 |

完成某项后，把上表 `[ ]` 改为 `[x]`，并更新文首「最后对照版本」。

---

## 相关文档

- [商店上架文案](store-listing.md)
- [隐私说明](PRIVACY.md)
- [实现原理与详细设计](architecture.md)
