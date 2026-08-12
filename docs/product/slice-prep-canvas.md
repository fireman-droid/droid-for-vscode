# 切片⑤开工预研：Canvas / 原型预览（rich-content §2）

> 状态：**现行预研，对应切片未实现**。2026-08-12 用户调整排期后
> Canvas 为 **V1 #7**（发版前倒数第二，见 `HANDOVER.md` §3）；标题
> "切片⑤"为预研时旧序号。开工时与 rich-content-design §2 同读。
>
> 预研日期：2026-08-12。由只读预研代理产出，服务
> [`rich-content-design.md`](./rich-content-design.md) §2（方案 b：独立
> WebviewPanel + asWebviewUri sandbox iframe）的实现开工。结论基于本地
> 源码、`@types/vscode@1.108.0`（`node_modules/@types/vscode/package.json`）
> 与 VS Code 官方 webview 指南 / 内置 Simple Browser 源码
> （microsoft/vscode main 分支在线核对）。

## 结论速览

| 项 | 结论 |
| --- | --- |
| 方案 a（聊天 Webview 内 srcdoc iframe） | **做不了 / 维持否决**——当前 CSP 无 frame-src，`default-src 'none'` 兜底直接禁 iframe；srcdoc 继承宿主 CSP 导致原型脚本必死 |
| 方案 b（独立 Panel + asWebviewUri iframe） | **可行**——所需 API 全部在本地 @types/vscode 实证存在，Simple Browser 是同构先例 |
| 方案 c（本地 HTTP 服务器） | 维持后置（本预研未发现推翻理由） |
| 设计的"无网络"假设 | **需调整**——不成立的可能性高，见风险 R1，必须在切片内实测并补防线 |

## 1. 设计假设 → 实证结果

### 1.1 聊天 Webview 的 CSP 现状（方案 a 的否决依据）

`src/extension/webviewHtml.ts` L39 实测：

```39:39:src/extension/webviewHtml.ts
    content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src 'none';"
```

- **无 `frame-src` / `child-src`** → 按 CSP 回退规则落到
  `default-src 'none'`，聊天 Webview 内任何 iframe（含 srcdoc）都
  无法创建加载。设计的现状描述准确。
- srcdoc / about:blank 文档按 HTML 规范继承父文档 CSP——即便加了
  frame-src，原型的内联脚本也会被 `script-src 'nonce-…'` 杀死。
  "能看不能跑"的设计判断成立。
- `localResourceRoots` 仅 `dist/webview` + `resources`
  （`src/extension/DroidViewProvider.ts` L56–62），聊天面资源根不动的
  前提可保持。

### 1.2 方案 b 所需 API（逐条在本地 @types/vscode@1.108.0 实证）

| 能力 | 证据（`node_modules/@types/vscode/index.d.ts`） |
| --- | --- |
| `window.createWebviewPanel(viewType, title, showOptions, options)` | L11523 |
| `WebviewPanelOptions.retainContextWhenHidden`（隐藏保活，官方注明高内存开销、慎用） | L10043–10067 |
| `WebviewOptions.localResourceRoots`（面板独立资源根；空数组 = 禁全部本地资源） | L9913–9919 |
| `Webview.asWebviewUri(localResource)`（file: → webview 可加载 URI） | L10015–10026 |
| `Webview.cspSource`（面板壳 CSP 用） | L10028–10037 |
| `WebviewOptions.enableScripts` 默认 false（壳需显式开） | L9888–9893 |
| `WebviewOptions.portMapping`（方案 c 才需要，公开存在） | L9921–9934 |
| `WebviewOptions.enableForms` / `enableCommandUris`（默认后者 false，壳保持默认即可） | L9895–9910 |

**iframe-in-webview 的官方先例**：VS Code 内置 Simple Browser
（`extensions/simple-browser/src/simpleBrowserView.ts`，microsoft/vscode
main 在线核对）就是 `createWebviewPanel` + `retainContextWhenHidden:
true` + `enableScripts` + 壳 HTML 内 `<iframe>`，其
`localResourceRoots` 只放扩展自己的 `media/`。官方 webview 指南开篇
也定义 webview 本身"就是扩展控制的 iframe"。**"WebviewPanel 壳内嵌
iframe"不是未验证的路径**。

**sandbox 语义（HTML 规范保证，不依赖 VS Code）**：
`<iframe sandbox="allow-scripts">` 不含 `allow-same-origin` 时，子文档
获得 opaque origin——无法访问壳 DOM、无 storage、CORS 请求以 null
origin 发出。壳不注册 `onDidReceiveMessage`、不给内层任何消息面的
设计（rich-content §2.2-b）与此叠加成立。

### 1.3 与设计不符 / 需调整的点

**R1（必须调整）：“无网络（连不上外网是 webview 环境自带属性）”
这一句不成立的可能性高。**
证据链：Simple Browser 的 iframe 直接 `src` 任意外部 http(s) URL 且
正常工作——说明 VS Code webview 环境内的 iframe 文档**可以**发起
网络加载；壳的 CSP 只约束壳文档本身，**不会级联进非 srcdoc 的子
文档**（CSP 按 document 生效，经 asWebviewUri 加载的原型 HTML 是
独立 document，自带响应头里没有我们能控制的 CSP）。因此原型里的
CDN `<script src="https://…">` 很可能**能加载**，随之而来的是任意
生成代码的网络外联面（数据外传、拉取二阶段脚本）。
处置（实现切片内必做）：
1. 打包后实测一次：原型引用 CDN 资源是否真的加载（这决定文案与
   防线，不允许按设计原文照抄"CDN 会失败"的提示）；
2. 若能联网，评估两条防线再定案：iframe `csp` 属性（Chromium CSP
   Embedded Enforcement，Electron 支持性需同批实测）或 Host 读原型
   文件后注入 `<meta http-equiv="Content-Security-Policy">` 的包装
   文档（保持原文件不动，包装文档走内存/临时目录）；
3. 无论结果如何，面板顶栏文案如实描述网络行为。

**R2：`retainContextWhenHidden` 与单实例复用。**
官方注释明确其高内存开销（@types/vscode L10057–10067）。原型预览是
"打开-看-关"场景，建议首版**不开** retainContextWhenHidden，改为
onDidDispose 后重建（面板状态只有 src URL + 标题，重建成本≈0）；
与设计"复用单个面板"不冲突——复用指同一时刻至多一个实例。

**R3：`localResourceRoots = [目标文件所在目录]` 的粒度。**
目录内所有文件对 iframe 可读（@types/vscode L9913–9919 语义）。若
原型写在工作区根（Droid 常见行为），资源根就是整个工作区——回到
设计在 §1.2 方案对比里自己否决过的暴露面。实现时收窄：入口按
`ChangesTranscriptItem.files` 的相对路径取**其父目录**为根，并在
面板打开前对路径做与 `file.openDiff` 相同的包含关系复验
（`src/extension/vscodeFileDiff.ts` L17–27 的 containment 模式）；
若父目录 == 工作区根，弹确认或在文案中明示暴露范围。

### 1.4 入口数据与 Bridge 锚点（设计 §2.3 核实）

| 设计引用 | 实证 |
| --- | --- |
| `ChangesTranscriptItem.files[]` 存在且生产接通 | ✅ `src/shared/bridgeMessages.ts` L871–876（`ChangedFileSummary.path` L864–868） |
| `ToolTranscriptItem.filePath`（工作区相对、越界丢弃） | ✅ `src/shared/bridgeMessages.ts` L836–841 |
| `file.openDiff` 的路径复验可复用 | ✅ `FileOpenDiffMessage`（bridgeMessages.ts L347–348）；Host 侧 containment 检查 `src/extension/vscodeFileDiff.ts` L17–27 |
| 壳 HTML 生成模式可照抄 | ✅ `src/extension/webviewHtml.ts`：nonce 生成 L106–108、attribute 转义 L110–123、CSP meta 模板 L33–50 |

## 2. 开工实现清单（Bridge → Host → Webview；无 Runtime 改动）

### Bridge

- `src/shared/bridgeMessages.ts`：新增 Webview→Host
  `{ type: 'file.preview'; sessionId; path }`（path 上限沿用
  openDiff 同款约束），进 `WebviewToHostMessage` 联合（L515）。
- `src/shared/validateMessage.ts`：exact-keys 解析器 + 敌对输入测试
  （绝对路径、`..` 穿越、超长、非 .html/.htm 后缀在 Host 再验一道）。
- Host→Webview 无新消息（面板是 VS Code 原生 UI，不经 Bridge 回传）。

### Host

- 新 `src/extension/previewHtml.ts`：壳 HTML 生成器——严格 CSP
  （`default-src 'none'; frame-src ${cspSource}; style-src 'nonce-…';
  script-src 'nonce-…'`）+
  `<iframe sandbox="allow-scripts" src="${asWebviewUri(html)}?v=${ts}">`；
  **不给 `allow-same-origin`**；壳脚本只做 Reload 按钮。复用
  webviewHtml.ts 的 nonce/escape 函数模式（提为共享或复制，实现定）。
- 新 `src/extension/PreviewPanelController.ts`：单实例
  `createWebviewPanel`；`localResourceRoots = [原型父目录]`（R3 收窄）；
  标题 "Preview · <文件名>"；Reload / Open in editor；文件不存在时
  纯文本提示；onDidDispose 清引用（R2：首版不开
  retainContextWhenHidden）。
- `src/extension/ChatController.ts`：路由 `file.preview` →
  containment 复验（照 vscodeFileDiff.ts L23–27）→ 后缀白名单
  `.html/.htm` → PanelController.show()；诊断事件 `host.preview.*`。
- `src/extension/extension.ts`：注入 PanelController（持 extensionUri）。

### Webview

- `src/webview/assistant/Thread.tsx`：Changes 行与已完成的
  Edit/Create/Write/ApplyPatch Tool 行的文件 chip 右侧，对
  `.html/.htm` 路径渲染 "Preview" chip（与 `file.openDiff` chip 同
  家族视觉）；`.tsx/.jsx/.vue` 不出现按钮（能力外，与设计一致）。
- `src/webview/assistant/styles.css`：chip 样式。

### 打包与验收

- `.vscodeignore` / `pnpm run verify:vsix` 核对壳资源随包（壳 HTML 为
  运行时字符串生成则无新文件需打包）。
- 可见验收：真实 Cursor 中让 Droid 写一个含内联 JS 的
  `prototype.html` → Changes 行出现 Preview → 面板内脚本真的在跑
  （如按钮计数器）→ Reload 生效 → 删除文件后提示不裂屏。
- **R1 实测项**：原型内引用一个 CDN 脚本，记录加载成败，按结果
  定文案与防线，写入 implementation-status。

## 3. 风险提示汇总

1. **R1 网络外联**（上文）——安全结论未定，是本切片唯一的
   "实现前无法在本地闭环证明"的点，必须留在切片内首个验证项。
2. **iframe 焦点陷阱**：Simple Browser 已知局限（设计 §2.1 引用）；
   本切片接受，不做焦点魔法。
3. **面板与聊天 Webview 的 service worker 缓存**：iframe src 加时间戳
   query（设计已含）；验收时同样遵守 HANDOVER §4 的完整重启纪律。
4. **与切片③的顺序**：本切片无 SDK/Runtime 面，与图片切片解耦；
   但两者共享"文件 chip 家族"的视觉语言，图片切片先行可复用其
   测试骨架（设计 §3.1 的排序理由仍然成立）。
