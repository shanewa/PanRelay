# PanRelay 实现原理与详细设计

本文说明扩展如何在**无自建后端**的前提下，在百度网盘网页内完成两件事：

1. **接力转存**：在分享页接管「保存到网盘」，按批次调用网盘自己的 `/share/transfer`。
2. **视频倍速**：在播放页对 `video`/`audio` 写入 `playbackRate`，并把当前倍率嵌进播放器底栏。

插件完全免费；首次使用需关注公众号并填写六位解锁码。所有请求都带着用户浏览器里已有的 Cookie，数据不经过我们的服务器。

---

## 1. 约束与总体思路

| 约束 | 设计选择 |
|------|----------|
| Manifest V3 内容脚本默认跑在 **isolated world**，读不到页面的 `require` / `yunData` | 转存用 `web_accessible_resources` 注入 `page-bridge.js` 到 **MAIN**；倍速用 `world: "MAIN"` 注入 `speed-main.js` |
| Isolated 与 MAIN 之间 `CustomEvent` **不能**直接互通 | 倍速配置走 `localStorage` + `window.postMessage`（页面 CSP 禁止内联 script） |
| 网页端单次转存有数量上限（errno `12`） | 先整目录转存，失败再二分拆分，再分页 `share/list` 后逐页转存 |
| 全页 `MutationObserver` + `all_frames` 会拖死网盘 SPA | 倍速用定时器 + 媒体事件；HUD 只插播放器底栏，不扫整棵 DOM |
| 关注引导不能一打开网盘就挡页面 | 只在 **点扩展图标** 或 **点「保存到网盘」** 时出卡片 |

逻辑分层：

```
popup / chrome.storage.sync
        │
        ├─ unlock（解锁码）
        ├─ share-relay（isolated）──CustomEvent──► page-bridge（MAIN）
        │                                    └── fetch /share/transfer（Cookie）
        └─ video-speed（isolated）──localStorage + 注入脚本──► speed-main（MAIN）
```

---

## 2. 扩展入口：`extension/manifest.json`

`permissions` 只有 `storage`。`host_permissions` 仅 `pan.baidu.com` / `yun.baidu.com`，倍速不会作用到其它网站。

内容脚本分四路（顺序即注入顺序）：

| 匹配 | 脚本 | 世界 | 时机 | 作用 |
|------|------|------|------|------|
| `/s/*`、`/share/init*` | `transfer-core.js` → `unlock.js` → `unlock-guide.js` → `share-relay.js` | isolated | `document_start` | 拦截保存、接力转存 |
| `pan/yun` 全站 | `unlock-guide` **不**在这里自动跑 | — | — | 打开网盘不出卡片 |
| `pan/yun` 全站 | `injected/speed-main.js` | **MAIN**，`all_frames: true` | `document_start` | 写 `playbackRate` |
| `pan/yun` 全站 | `media-speed.js` → `video-speed.js` | isolated，顶层帧 | `document_idle` | 读设置、推配置、嵌 HUD |

`background.js` 是 MV3 service worker，只维护工具栏「关注」角标，不参与转存。

`web_accessible_resources` 暴露：

- `injected/page-bridge.js`：isolated 用 `<script src=chrome.runtime.getURL(...)>` 注入 MAIN
- `assets/wechat-oa-qr.jpg`：页面引导卡片用 `chrome.runtime.getURL` 显示二维码

---

## 3. 关注公众号解锁

### 3.1 校验：`extension/lib/unlock.js`

- 关键词常量 `KEYWORD`：`百度网盘插件`（给公众号关键词回复用）。
- 解锁码拆成 `CODE_PARTS = [8, 2, 7, 4, 6, 1]`，`expectedCode()` 拼成 `827461`。
- `extractCode(input)`：从用户粘贴的文字里抽出连续 6 位数字（允许带「解锁码：」前缀）。
- `verifyUnlockInput(input)`：抽出的数字是否等于期望码。
- `isUnlocked(stored)`：看 `chrome.storage.sync` 的 `unlocked === true`。
- 导出全局 `PanRelayUnlock`。

解锁成功后只存布尔值 `unlocked: true`，不把明文码再写进 storage。

### 3.2 弹窗：`extension/popup/popup.js`

- `renderUnlockState(unlocked)`：未解锁隐藏 `#settingsRoot`，显示 `#unlockGate`（二维码 + 输入框）。
- `submitUnlock()`：调用 `verifyUnlockInput`，通过则 `chrome.storage.sync.set({ unlocked: true })`。
- 设置项（批次、转存间隔、倍速）只在解锁后由 `save()` 写入 sync。

点工具栏图标就会打开这个弹窗，这是用户**主动使用扩展**时的第一条路径。

### 3.3 页面卡片：`extension/content/unlock-guide.js`

导出 `PanRelayUnlockGuide.showGuide({ force })` / `removeGuide()`。

- **不会**在页面加载时自动调用。
- 分享页点保存时由 `share-relay.js` 的 `onSaveClick()` 以 `{ force: true }` 弹出（即使用户点过 × 收起也会再出）。
- 卡片内同样可填六位码并 `storage.sync.set({ unlocked: true })`。
- `chrome.storage.onChanged` 看到 `unlocked === true` 时 `removeGuide()`。

### 3.4 角标：`extension/background.js`

- `syncBadge(unlocked)`：未解锁 `setBadgeText('关注')` 与蓝色底；已解锁清空。
- 监听 `onInstalled`、`onStartup`、`storage.onChanged`。

打开网盘**不会**因此弹出二维码，只是图标上有提示。

---

## 4. 接力转存

### 4.1 为何要「桥」

分享页文件列表、勾选状态、底部「保存到」路径，都活在页面 MAIN 里的百度模块系统中（`require('system-core:context/context.js')`、`window.locals`、`window.yunData`）。Isolated 的 content script 拿不到这些对象。

`share-relay.js` 的 `injectBridge()` 在 `document_start` 把 `page-bridge.js` 插进页面：

```js
// extension/content/share-relay.js — injectBridge()
script.src = chrome.runtime.getURL('injected/page-bridge.js');
(document.head || document.documentElement).appendChild(script);
```

### 4.2 桥协议：`callBridge(method)` ↔ `page-bridge.js`

Isolated 发 `panrelay-request`，MAIN 回 `panrelay-response`，用 `id` 配对，8 秒超时。

MAIN 侧 `handlers`（`extension/injected/page-bridge.js`）：

| method | 函数 | 数据来源 |
|--------|------|----------|
| `getSelectedFiles` | `getSelectedFiles()` | `getContext().list.getSelected()`，带 `fs_id`、`isdir`、`path`、**`path_raw`** |
| `getShareMeta` | `getShareMeta()` | `yunData` / `locals`：`shareid`、`share_uk`、`bdstoken`、`loginstate`、分享根路径 |
| `getDestinationPath` | `getDestinationPath()` | `localStorage`：`${username}_cur_transfer_save_path`（与官方底部路径一致）；协作空间再看 collab key |
| `invokeNativeSave` | `invokeNativeSave()` | `ctx.message.callPlugin('保存到网盘@com.baidu.pan.share', { filesList })` |

`path_raw` 必须保留接口原始 path：文件夹名里的 `+` 若被 `decodeURIComponent` 成空格，后续 `/share/list?dir=` 会列错目录。

`decodePath()` 只用于展示用的 `path`；列举分享目录时优先 `path_raw`。

### 4.3 拦截保存：`share-relay.js` — `onSaveClick(event)`

捕获阶段监听点击，选择器：

```js
const SAVE_SELECTOR = '[node-type="bottomShareSave"], [node-type="shareSave"]';
```

流程：

1. `settings.enabled === false` 或正在跑 → 直接 return（不拦截）。
2. 未解锁 → `PanRelayUnlockGuide.showGuide({ force: true })` 后 **return，不 `preventDefault`**，官方保存继续。
3. 已解锁 → `preventDefault` + `stopImmediatePropagation`，阻断官方一次性转存。
4. `callBridge('getSelectedFiles')`。
5. `shouldUseRelay(selected)`：
   - `alwaysRelay` 为真；或
   - 选中数量 `> batchSize`；或
   - 任一项 `isdir === 1`  
   否则 `callBridge('invokeNativeSave')`，把小批量文件交回官方。
6. 需要接力 → `runRelay(selected)`：取 meta、目标路径，构造 `PanRelay.ShareTransferEngine`，`runSelection(selected, destination)`。右下角 `#panrelay-panel` 由 `ensurePanel` / `setPanelStatus` / `appendLog` 更新。

### 4.4 引擎：`extension/lib/transfer-core.js` — `ShareTransferEngine`

运行在 **isolated content script**，`fetch(..., { credentials: 'include' })`，与页面同源，带登录 Cookie。基址 `https://pan.baidu.com`。

#### HTTP：`request(path, options)`

统一加 `X-Requested-With: XMLHttpRequest` 和表单 `Content-Type`。`checkErrno: true` 时把百度 JSON 的非 0 `errno` 打成 `PanRelayError`。

#### Token：`ensureBdstoken()`

优先用桥传来的 `bdstoken`；缺失则 `GET /api/gettemplatevariable?fields=["bdstoken"]`。

#### 转存：`transferIds(ids, destination, retry)`

`POST /share/transfer?shareid=&from=&ondup=newcopy&bdstoken=`

Body：`fsidlist=<JSON 数组>&path=<用户网盘目标路径>`

成功后 `sleep(transferCooldownMs)`（弹窗默认 1500ms），减轻「请求过快」。

可重试：errno `111`、`1504`，或文案含超时/繁忙；退避最长 30s，最多 `maxRetries`（默认 12）。

errno **`12`**：单次数量超限，向上抛给拆分逻辑。

#### 拆分目录：`transferDirectories(directories, destination)`

1. 先尝试把当前这一批目录的 `fs_id` 一次 `transferIds`。
2. 若 errno 12：
   - 多个目录 → 对半切成两份递归（`transferDirectories`）。
   - 单个目录 → 在**分享侧**列出子项，而不是把用户网盘路径拼进 `share/list` 的 `dir`。

子目录目标路径：`joinPath(destination, directory.name)`。  
分享侧列举路径：`directory.sharePath` / `shareDirRaw`，根是 `this.shareRoot`。  
`this.destinationRoot` 在 `runSelection` 里设为用户选择的保存根，**不要**把 `/教育/英语` 这类用户路径当成分享 `dir=`。

单目录失败走 `transferDirectoriesSafe` → `recordFailure`，其它目录继续；最后 `runSelection` 若有 `failedTasks` 会抛部分失败，提示对未完成子文件夹再勾选保存。

#### 分页列举：`fetchShareListPage` / `processShareDirectoryIncrementally`

`GET /share/list`，query 由 `shareListQuery(page, dirValue, pageSize, { fid })` 组装。子目录列举带 `root=0`（根层为 `root=1`）；有 `fs_id` 时优先 `fid=`，并附带 `sekey`（`BDCLND` / 页面 `sign`）。`errno 2`（链接出错）不重试。

`dirQueryValue(shareDirRaw, sharePath)`：

- 原始 path 已是百分号编码（含 `%2F`）→ 尽量原样使用，避免二次解码把 `+` 变成空格。
- 否则 `encodePath`（`encodeURIComponent` 但保留 `/`）。

默认每页 60；重试两次后降到 25。超时类错误最多 `listMaxRetries`（10）次。

`processShareDirectoryIncrementally`：先 `createDirectory(childDestination)`（`/api/list` 不存在 errno `-9` 再 `POST /api/create`），再逐页：子目录 `transferDirectoriesSafe`，子文件 `transferFiles`。这样超大目录不会一次 list 全量。

#### 文件批次：`transferFiles(files, destination)`

按 `batchSize`（默认 500）切片调用 `transferIds`。

#### 入口：`runSelection(selected, destination)`

`normalizeSelection` 把桥返回的选中项分成 directories / files，然后先目录后文件。

---

## 5. 视频倍速

### 5.1 两个世界、两条通道

Isolated 的 `video-speed.js` 能读 `chrome.storage.sync`，但改不了播放器真正看到的 `HTMLMediaElement`（播放器在 MAIN）。MAIN 的 `speed-main.js` 改得到元素，但读不到 `chrome.storage`。

`video-speed.js` — `pushConfig()`：

1. `buildDetail()`：未解锁则 `enabled: false`、`speed: 1`。
2. `localStorage.setItem('__panrelay_speed__', JSON)`，同源 iframe 可通过 `storage` 事件收到。
3. `pushConfigToPage(detail)`：向页面插入 `<script>`，在 MAIN 里 `dispatchEvent(new CustomEvent('panrelay-speed-config', { detail }))`。  
   Isolated 自己 `document.dispatchEvent` **到不了** MAIN，所以必须注入脚本。

`speed-main.js`：

- 监听 `panrelay-speed-config` → `mergeConfig` → `applyAll`。
- `storage` 事件（其它帧写入）→ `scheduleApply`。
- `play` / `playing` / `loadedmetadata` / `ratechange` / `emptied` / `canplay`（捕获）→ 防抖 80ms 再应用。
- `setInterval(applyAll, 800)`：播放器把速率打回 1× 时再写回去。
- `collectMedia()`：`querySelectorAll('video, audio')` 并递归 **open** shadow root（不做全页 `*` 扫描的 MutationObserver）。
- `setNativeRate`：用 `document_start` 时拿到的原生 `playbackRate` / `defaultPlaybackRate` descriptor 的 `set`，避免被页面包过的 setter 吞掉。
- `applyToMedia`：差值大于 0.001 才写；同步 `preservesPitch`。

`speed-main.js` 在 **所有 frame** 注入，以便 iframe 内播放器也能加速。HUD 只在顶层 `video-speed.js` 里插，避免每个 iframe 再插一条。

### 5.2 弹窗倍率：`popup.js` + `media-speed.js`

`extension/lib/media-speed.js`：

- `conformSpeed`：夹到 `[0.07, 16]`，保留两位小数（与 Chromium 媒体范围一致）。
- `SPEED_PRESETS`：12 档（0.25 … 2.5、16）。
- `SPEED_SMALL_STEP` / `SPEED_BIG_STEP`：0.01 / 0.1。

弹窗滑块 `min=0.07 max=16 step=0.01`，预设网格与四键细调。`save()` 写 `videoSpeed`、`videoSpeedEnabled`、`preservePitch`。

### 5.3 底栏 HUD：`video-speed.js` — `updateHud` / `ensureHudHost`

网盘播放器底栏结构（个人盘视频页）：

```
.vp-video__control-bar--button-group
  .vp-video__control-bar--button.is-text   ← 字幕 / 倍速 / 流畅
.vp-video__control-bar--button-group
  .vp-video__control-bar--button.is-icon
    i.u-icon-volume                        ← 声音
.vp-video__control-bar--button-group
  … title="全屏"
```

`findVolumeGroup()` 找到 `.u-icon-volume` 所在的 `button-group`。  
`ensureHudHost()` 在其**前方**插入 `#panrelay-speed-hud-wrap`，内部按钮复用 `vp-video__control-bar--button is-text`，字体与「流畅」一致。  
`setInterval(updateHud, 1000)`：控制条被 Vue 重绘后重新插入。  
未解锁、关闭倍速、或倍率≈1 时移除 HUD。速率只在扩展弹窗改，HUD `pointer-events: none`。

---

## 6. 设置存储一览

`chrome.storage.sync`（弹窗与 content script 共用）：

| 键 | 默认 | 用途 |
|----|------|------|
| `unlocked` | `false` | 关注解锁 |
| `enabled` | `true` | 是否拦截保存 |
| `batchSize` | `500` | 每批 fs_id 数 |
| `alwaysRelay` | `false` | 小批量也走接力 |
| `transferCooldownMs` | `1500` | 转存成功后冷却 |
| `videoSpeedEnabled` | `true` | 倍速总开关 |
| `videoSpeed` | `1` | 目标倍率 |
| `preservePitch` | `true` | `preservesPitch` |

页面 `localStorage['__panrelay_speed__']`：仅倍速 MAIN 同步，含 `enabled/speed/preservePitch/ts`。

---

## 7. 源码地图

| 路径 | 关键符号 | 职责 |
|------|----------|------|
| `extension/manifest.json` | `content_scripts` | 注入范围与世界 |
| `extension/background.js` | `syncBadge` | 工具栏角标 |
| `extension/lib/unlock.js` | `verifyUnlockInput` | 解锁码 |
| `extension/content/unlock-guide.js` | `showGuide` | 转存时的扫码卡片 |
| `extension/popup/popup.js` | `submitUnlock`, `save` | 解锁 + 设置 |
| `extension/content/share-relay.js` | `onSaveClick`, `runRelay`, `callBridge` | 拦截与编排 |
| `extension/injected/page-bridge.js` | `getSelectedFiles`, `getDestinationPath`, … | MAIN 读网盘状态 |
| `extension/lib/transfer-core.js` | `ShareTransferEngine` | `/share/transfer` 拆分与重试 |
| `extension/content/video-speed.js` | `pushConfig`, `updateHud` | 设置同步与 HUD |
| `extension/injected/speed-main.js` | `applyAll`, `setNativeRate` | MAIN 写播放速率 |
| `extension/lib/media-speed.js` | `conformSpeed`, `SPEED_PRESETS` | 倍率工具 |

---

## 8. 已知脆弱点（改版时优先看）

1. 保存按钮 `node-type="bottomShareSave"` / `shareSave` 若改名，`SAVE_SELECTOR` 失效。
2. `require('system-core:context/context.js')` 或 `callPlugin` 名变更，桥会超时或 `invokeNativeSave` 失败。
3. 底部路径不再写 `${username}_cur_transfer_save_path`，会转存到 `/`。
4. 播放器底栏 class（`u-icon-volume`、`vp-video__control-bar--button`）变更，HUD 插不进去（倍速本身仍可由 `speed-main.js` 生效）。
5. `/share/transfer` errno 语义变化时，拆分与重试条件要改。
