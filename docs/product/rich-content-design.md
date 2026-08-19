# 富内容渲染设计：对话内图片 与 Canvas/原型预览

> 状态（2026-08-12 更新）：**分节状态**——§1 / §1.5（对话内图片 +
> Composer 拖拽/粘贴）已实现（V1 切片③，见 `implementation-status.md`，
> 预研存档 [`slice-prep-rich-content.md`](./slice-prep-rich-content.md)）；
> §2 的安全 HTML 预览已实现，并在 2026-08-17 演进为 Canvas 交互成果
> 面板（Preview / Code / Diff、响应式视口、文件自动刷新、元素反馈回
> Composer）。本文 §2 保留最初方案决策记录；当前生产范围以
> [`feature-overview.md`](./feature-overview.md) §12.6 与
> [`implementation-status.md`](./implementation-status.md) §12 为准。
>
> 原始状态：设计文档（未实现）。本文基于 2026-08-11 对
> `node_modules/@factory/droid-sdk@0.7.0`（`FACTORY_PROTOCOL_VERSION: "1.151.0"`）
> 类型定义与当前工作区源码的只读调研。所有类型名与行号证据来自
> `dist/index-D_SzTnFR.d.ts`（下称"SDK 类型文件"）。
> 本文不改变任何既有契约；实现时按文末清单另行开切片。

---

## 1. 对话内图片显示

### 1.1 SDK 能力证据

#### 1.1.1 消息内容块类型全集

SDK 的持久化消息 `FactoryDroidMessage.content` 是 `ContentBlock[]`，
块类型枚举（SDK 类型文件 L1086）：

```ts
declare enum MessageContentBlockType {
  Text = "text",
  Image = "image",
  Thinking = "thinking",
  RedactedThinking = "redacted_thinking",
  ToolUse = "tool_use",
  ToolResult = "tool_result",
  Document = "document"
}
```

公开联合类型（L105459）：

```ts
type ContentBlock = TextBlock | ImageBlock | ThinkingBlock
  | RedactedThinkingBlock | ToolUseBlock | ToolResultBlock | DocumentBlock;
```

#### 1.1.2 Image 块：只有 base64，没有 URL、没有文件路径

`ImageBlock`（L105431）与 `Base64ImageSourceSchema`（L1185）：

```ts
type ImageBlock = {
  type: 'image';
  source: Base64ImageSource;   // 唯一的 source 形态
  id?: string;
  generated?: boolean;         // true = 模型生成的图片（区分用户附件）
};

// Base64ImageSourceSchema:
{ type: 'base64';
  data: string;                // base64 载荷
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
```

结论：**协议层图片只有 base64 一种来源**。没有 URL image source、
没有文件路径 image source（`path` 字段只存在于 PDF 的
`Base64PDFSourceSchema` 上，L1296）。`generated` 是官方注释明确的
"模型生成 vs 用户附加" 判别位（L1215-1220），UI 可以据此打
"Generated" 徽标。

#### 1.1.3 工具结果可以携带图片

`ToolResultBlock`（L105455）：

```ts
type ToolResultBlock = {
  type: 'tool_result';
  content?: string | Array<TextBlock | ImageBlock | DocumentBlock>;
  ...
};
```

即：**持久化的 tool_result 块合法地内嵌 ImageBlock**（例如截图类
工具、浏览器工具的返回）。注意区分两条通道：

- 实时流的 `ToolResult` 事件（L105952）`content: string | JsonValue[]`
  ——弱类型，图片以 JsonValue 形态出现，投影前必须用
  ImageBlock 形状守卫校验；
- 实时流的 `CreateMessage` 事件（L105973）
  `content: FactoryDroidMessage['content']` = `ContentBlock[]`
  ——强类型，是实时拿到用户/助手消息图片块的通道。

#### 1.1.4 发送用户消息时可带图片附件

`MessageOptions`（L106171）：

```ts
interface MessageOptions {
  images?: Base64ImageSource[];
  files?: DocumentSource[];
  ...
}
```

SDK 文档（`docs/typescript-sdk-reference.md` L379-393）与
`examples/node/image-attachment.ts` 确认 `run()` / `session.stream()`
同样接受 `images`，支持 JPEG/PNG/GIF/WebP。**该通道我们已生产接通**：
`src/runtime/FactoryDroidRuntime.ts` L1610-1659 已把暂存附件投影为
`{ images, files }`。缺的只是"发送后在转录中回显"（见 1.4）。

另证：Hook 输入 `UserPromptSubmitHookInput.has_images?: boolean`
（L105863）说明 CLI 侧对带图 prompt 有一等感知。

#### 1.1.5 历史 loadSession 返回里图片块的形态

`loadSession` 响应中的消息即 `FactoryDroidMessage`
（`role: 'user'|'assistant'|'tool'|'system'`，`content: ContentBlock[]`，
L105461）。用户带图消息在历史里是
`{ type:'image', source:{ type:'base64', data, mediaType } }` 块，与实时
`CreateMessage` 同构；工具截图在 `tool_result` 块的 `content` 数组里。

当前实现（`src/runtime/history/projectSessionHistory.ts` L268-273）把
`image` / `document` 块**直接丢弃并标记 `partial`**——这正是
implementation-status 里"历史 Image、Document 和未知 Block 会被省略并
标记为 partial"的来源。也就是说：数据一直都在，只是我们没投影。

### 1.2 Host / Webview 侧约束与安全方案

现状（均为证据，不是推测）：

- CSP（`src/extension/webviewHtml.ts` L39）：
  `default-src 'none'; img-src ${cspSource}; style-src ${cspSource};
  script-src 'nonce-…'; font-src ${cspSource}; connect-src 'none'`
- `localResourceRoots`（`src/extension/DroidViewProvider.ts` L44-48）：
  仅 `dist/webview` 与 `resources`。

#### 方案对比：workspace 文件放行 vs data URI

| 维度 | A. `asWebviewUri` + localResourceRoots 加工作区根 | B. CSP `img-src` 加 `data:`（推荐） |
| --- | --- | --- |
| 与 SDK 数据形态的匹配 | 差：SDK 图片全是 base64，没有路径可 as-uri | 好：base64 → data URI 零转换 |
| 暴露面 | **把整个工作区读权限交给 webview**。webview 一旦被注入（哪怕是渲染缺陷），任意工作区文件可被 img 探测/读取 | 只暴露 Host 逐字节校验过的那份数据 |
| CSP 弱化程度 | 无 CSP 变化，但资源根扩大 | 仅 `img-src` 增加 `data:`；`data:` 图片仅走解码器，不执行脚本，且我们在 Bridge 层控制了唯一的构造点 |
| 失效模式 | 文件被移动/删除后历史图片裂图 | 自包含，历史/恢复后仍可渲染 |
| 消息体积 | 小（只传 URI） | 大（base64 进 Bridge），需上限与合批注意 |

**决定：采用 B**。CSP 改为
`img-src ${cspSource} data:`，不动 `localResourceRoots`。理由：SDK 端
根本不存在"图片文件路径"，方案 A 解决的是一个不存在的输入形态，却付出
最大的暴露面。若未来出现"预览工作区图片文件"需求（如 changes 里的
`.png`），届时由 Host 读文件、校验、转成同一 data URI 通道，仍不需要
扩大 localResourceRoots。

#### 校验规则（Host 出口 + Webview 入口双侧执行）

- `mediaType` 白名单：恰好等于 SDK 枚举
  `image/jpeg | image/png | image/gif | image/webp`；
- `data`：base64 字符集正则（`[A-Za-z0-9+/=]`），长度上限
  `MAX_IMAGE_DATA_LENGTH = 2_800_000` UTF-16 单元（≈2MB 二进制；低于
  现有附件 4MB 上限，因为这是渲染通道不是模型通道，超限图片降级为
  "Image (too large to display)" 占位行，不进 Bridge）；
- 数量上限：每回合 `MAX_IMAGES_PER_TURN = 8`（与
  `MAX_PENDING_ATTACHMENTS` 对齐），每会话渲染上限 64 张，更早的替换
  为占位行（转录项仍在，字节丢弃）；
- **Webview 绝不接受完整 `data:...` 字符串字段**：Bridge 只传
  `{ mediaType, data }` 两个已校验字段，`data:${mediaType};base64,${data}`
  由 Webview 用白名单值自行拼接——杜绝 `data:text/html` 一类的走私；
- 可选加固（实现时决定）：Host 侧魔数嗅探（PNG `89 50 4E 47` 等）与
  声明的 mediaType 一致才放行。

#### 恢复存储策略

图片字节**不进** `SessionRecoveryStore` 检查点（体积与 512KB 日志/
存储纪律不匹配）。检查点只存图片占位（id、mediaType、byteLength、
generated）；Webview 刷新后由既有 loadSession 重载路径重新投影出
完整图片块。重载失败时占位行照常显示，historyStatus 走既有
partial 语义。

### 1.3 Bridge 设计

新增转录项种类（沿用 `SessionTranscriptItem` 判别联合的既有模式，
`src/shared/bridgeMessages.ts` L861）：

```ts
export interface ImageTranscriptItem {
  readonly id: string;
  readonly kind: 'image';
  readonly turnId: string;
  /** 来源角色，决定气泡归属与徽标 */
  readonly origin: 'user' | 'assistant' | 'tool-result';
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** 纯 base64 载荷；为空字符串时表示"超限/被驱逐"占位 */
  readonly data: string;
  /** SDK ImageBlock.generated 直通 */
  readonly generated: boolean;
  /** 占位行时的原始字节数，用于 "Image · 3.2 MB" 文案 */
  readonly byteLength: number;
}
```

选择独立 item 而不是给 User/AssistantTranscriptItem 加字段的原因：
现有投影是按块（block）追加转录项的（text 块与 thinking 块本来就
各成一项，保持真实事件顺序），图片块按同一规则成项，reconcile、
窗口化渲染、恢复合并逻辑都不需要特判；`origin: 'tool-result'` 让
工具截图可渲染在对应 Tool 行下方而不伪装成助手正文。

配套改动：`strictValidation.ts` / `validateMessage.ts` /
`validateHostMessage.ts` 增加该 item 的双向校验（枚举、长度、数量
上限如 1.2 节）；`turn.send` 消息本身不变（附件已走 Host 暂存通道）。

### 1.4 交互设计

- 用户发送带图片附件时，Host 在乐观回显用户文本项后**追加对应
  image 项**（字节已在 Host 暂存区，直接投影），补上
  implementation-status 已知边界"已发送消息在转录中暂不回显附件"；
- 实时流：`create_message` 中 user/assistant 消息的 image 块 →
  image 项；`tool_result` 弱类型 content 数组中通过形状守卫的
  image 块 → `origin: 'tool-result'` 的 image 项；
- 历史：`projectSessionHistory.ts` 的 `case 'image'` 从"丢弃 +
  partial"改为投影（document 保持现状不变）；
- 渲染：约束最大高度（如 240px）的缩略图，点击开面板内 lightbox
  （复用现有内联交互块的视觉语言，Esc/点击遮罩关闭）；`generated`
  为 true 显示 "Generated" 徽标；占位行显示 mediaType 与体积；
- `prefers-reduced-motion` 与键盘可达性遵循现有 Thread 规范。

### 1.5 Composer 拖拽 / 粘贴图片进输入框

**用户结果**：像 Cursor 一样，把图片文件拖进 Composer 或从剪贴板
粘贴截图，即成为待发附件（chip），与 `+` 面板「Attach files…」选图
等价，不必每次打开文件对话框。

**现状**：Module 2 已接通 Host 侧图片暂存与 `sendTurn` 投影（jpg/png/
gif/webp ≤4MB）；Composer 仅支持 `+` 选文件、编辑器/选区文本、
`@` 路径与 Problems/Git changes。**缺** Webview 的 drop/paste 入口。

**设计**（复用既有附件管道，不新增 Runtime 能力）：

- **Webview**：Composer 根或 textarea 监听 `onDrop` / `onPaste`。
  - Drop：仅接受 `dataTransfer.files` 中的图片 MIME（与 Host
    `AttachmentSources` 白名单一致）；多文件按现有上限 8 个暂存槽
    截断；非图片文件静默忽略或 toast 提示。
  - Paste：`clipboardData.items` 中 `kind === 'file'` 且 type 为图片，
    或 `clipboardData.files`；截图粘贴走同一路径。
  - 拖入时 Composer 显示浅边框高亮（`dvx-composer-dragover`）；
    处理中禁用重复 drop。
- **Bridge**：优先**不新增消息类型**——Webview 读 File 为
  `ArrayBuffer`/`base64` 后发现有 `attachment.addBlob`（若实现时需
  新消息则：`attachment.addImage { mediaType, dataBase64 }`，Host 双向
  校验长度与 MIME，投影为与 pick 相同的暂存项）。实现前在 Bridge
  层二选一并在三个校验文件对称落地。
- **Host**：复用 `ChatController.handleAttachmentCapture` 与
  `vscodeAttachmentSources` 的体积/类型守卫；拒绝二进制伪装、超限截断
  策略与 pick 一致。
- **与 §1 转录显示的关系**：本小节只负责**进输入框**；发送后在
  对话流中回显图片属 §1.4，同一 V1 切片一并验收。
- **验收**：harness 模拟 drop/paste 后 chips 出现且 `turn.send` 携带
  images；真实 Cursor 中拖入 png、Win+Shift+S 粘贴截图均可发送。

---

## 2. Canvas / 原型预览

### 2.1 现实约束

- 我们的聊天 Webview CSP 是 `default-src 'none'` 且无
  `frame-src`、无 `connect-src`——**在聊天 Webview 内直接渲染生成
  HTML 与该安全基线冲突**；
- `srcdoc` iframe 会继承宿主文档的 CSP：生成原型里的脚本/样式在
  我们的 CSP 下根本跑不起来；要跑就得弱化聊天 Webview 自身的 CSP，
  不可接受。Trail of Bits 对 VS Code 扩展逃逸的分析也把
  `srcdoc` iframe 列为已知攻击面之一；
- 参照实现：VS Code 内置 **Simple Browser**
  （`extensions/simple-browser/simpleBrowserView.ts`）是"独立
  WebviewPanel + 内嵌 `<iframe src="http(s)…">`"，官方定位就是预览
  本地服务器，已知局限：焦点陷阱、无法感知加载失败/内部 URL 变化；
  **Live Preview**（ms-vscode.live-server）是"本地 HTTP 服务器伺服
  工作区 + WebviewPanel 内 iframe 指向它"，其历史漏洞（任意文件
  读取、DNS rebinding）说明本地服务器方案的安全成本是真实的，
  官方修复思路是随机端口 + Webview `portMapping`。

### 2.2 三方案评估

#### a) 对话内 sandbox iframe 缩略预览 + 点击放大

- 做法：转录中直接内嵌 `<iframe sandbox srcdoc={html}>` 缩略图。
- 成本：UI 改动小，但要弱化聊天 Webview CSP（加 `frame-src`），且
  `srcdoc` 继承 CSP 导致原型脚本被禁——"能看不能跑"；若为了能跑而
  开 `allow-scripts` + 放宽 CSP，等于把任意生成代码引入与 Bridge
  同文档的框架树。长会话里多个 iframe 还会加剧我们刚修完的滚动/
  渲染性能问题。
- 结论：**否决**。对话内只放"预览入口"，不放渲染器。

#### b) 独立 WebviewPanel + asWebviewUri 资源映射（推荐）

- 做法：新建 "DroidVisX Preview" `WebviewPanel`（复用单个面板，
  `retainContextWhenHidden`）。面板 HTML 是我们自己的薄壳（带严格
  CSP + nonce，模式同 `webviewHtml.ts`），壳内放
  `<iframe sandbox="allow-scripts" src="${asWebviewUri(目标.html)}">`，
  面板 `localResourceRoots = [目标文件所在目录]`（不是聊天 Webview，
  聊天 Webview 的资源根不动）。
- 安全模型：三层隔离——原型代码跑在 iframe 里；iframe 的
  `vscode-webview-resource` 源与壳不同源，且**不给
  `allow-same-origin`**，脚本能执行但拿不到壳的 DOM/API；壳本身
  没有注册任何 `onDidReceiveMessage` 处理器，`acquireVsCodeApi`
  即便被内层想方设法调用也无消息面可用；能读的文件被
  localResourceRoots 限制在原型所在目录。无网络（连不上外网是
  webview 环境自带属性，原型里的 CDN 引用会失败，需在文案里明示）。
- 能力边界：`.html` 及其同目录相对引用的 css/js/图片可直接跑；
  `.tsx`/需要构建或 dev server 的原型**不在本方案能力内**（诚实
  降级：入口只对 .html/.htm 出现）。
- 成本：中低。一个 PanelController + 一个壳 HTML 生成器 + 一条
  Bridge 消息 + 入口 UI；无端口、无服务器生命周期、离线可用。

#### c) 本地静态服务器 + Simple Browser（Live Preview 式）

- 做法：Host 起 `127.0.0.1` 随机端口静态服务器伺服目标目录，调用
  `simpleBrowser.show` 或自建面板打开。
- 收益:真 http 源，ES modules、fetch、history API 全可用，最接近
  真浏览器；是 `.tsx`/dev-server 场景唯一出路。
- 成本与风险：服务器生命周期管理（起停、端口冲突、面板关闭回收）；
  必须做的安全件——仅绑定 loopback、随机端口 + 不可猜的路径 token、
  Host header 校验（防 DNS rebinding）、目录穿越防护、无目录列表。
  这正是 Live Preview 被打出漏洞的整套面。对当前"预览 Droid 生成的
  HTML 原型"诉求属于超配。
- 结论：**后置**。等出现真实的 tsx/构建型原型需求再作为 b 的升级档。

**推荐：b 为交付方案，a 否决，c 后置。**

### 2.3 交互设计："检测到原型产物 → 提供预览入口"

Droid 侧不需要任何新能力（写文件本来就支持），入口完全由既有
Bridge 数据驱动：

- **触发信号**（两处，均为已生产接通的数据）：
  1. `ChangesTranscriptItem.files[]`（回合级 Changes 摘要行）中出现
     扩展名 `.html`/`.htm` 的路径；
  2. `ToolTranscriptItem.filePath`（Edit/Create/Write/ApplyPatch 行的
     路径 chip）以 `.html`/`.htm` 结尾且状态为 completed。
- **入口位置**：不新增独立转录项。在上述两处的文件 chip 右侧渲染一个
  "Preview" 小按钮（Changes 行是主入口，Tool 行是即时入口）；与现有
  `file.openDiff` chip 并列，视觉上同一 chip 家族。`.tsx`/`.jsx`/
  `.vue` 等不出现按钮（能力外，避免许诺跑不起来的东西）。
- **Bridge**：新增 Webview→Host 消息
  `{ type: 'file.preview'; sessionId; path }`，Host 复用
  `file.openDiff` 的路径包含关系复验（工作区相对、越界拒绝），然后
  打开/复用 Preview 面板并刷新 iframe src（加时间戳 query 破缓存）。
- **面板行为**：单实例复用；标题 "Preview · <文件名>"；顶栏提供
  "Reload" 与 "Open in editor"；文件被删除时面板内显示纯文本提示
  而不是裂空白。首版不做自动刷新（文件再次被改动时由用户点
  Reload），避免引入 watcher 生命周期。

---

## 3. 优先级、改动清单与 tier 合并建议

### 3.1 优先级

**P1：对话内图片（先做）**

- SDK 证据完备且强类型，历史/实时/发送三条通道都已有数据在流动，
  当前是"白白丢弃并标 partial"；
- 直接消除两个已登记的产品缺口（历史 Image 省略、已发附件不回显）；
- 改动全部落在已有模式内（新增一种转录项），无新进程、无新面板、
  CSP 只加一个 `data:` 源，风险可控、验收可见性强。

**P2：Canvas 预览（方案 b，随后）**

- 价值高但依赖新面板与新安全壳，切片更大；
- 与图片切片共享"从 changes/tool 行长出入口"的交互语言，图片先行
  可复用其校验与测试骨架。

### 3.2 预计改动文件

图片切片：

| 层 | 文件 | 改动 |
| --- | --- | --- |
| Bridge | `src/shared/bridgeMessages.ts` | `ImageTranscriptItem`、上限常量 |
| Bridge | `src/shared/strictValidation.ts`、`src/shared/validateMessage.ts`、`src/webview/bridge/validateHostMessage.ts` | 双向校验 |
| Runtime | `src/runtime/FactoryDroidRuntime.ts` | `create_message`/`tool_result` 图片块投影（含形状守卫） |
| Runtime | `src/runtime/history/projectSessionHistory.ts` | `case 'image'` 从丢弃改投影 |
| Host | `src/extension/ChatController.ts` | 转录追加、发送后附件回显 |
| Host | `src/extension/SessionRecoveryStore.ts` | 占位化持久策略 |
| Host | `src/extension/webviewHtml.ts` | CSP `img-src` 加 `data:` |
| Webview | `src/webview/assistant/Thread.tsx`、`runtimeAdapter.ts`、store、`styles.css` | image 项渲染、lightbox、徽标 |
| Webview | `ComposerControls.tsx` 或 Composer 根组件、`styles.css` | §1.5 drop/paste、dragover 态、chip 联动 |
| 测试 | 各层既有测试文件 + 新聚焦测试 | 校验/投影/渲染/恢复/drop-paste |

Canvas 切片：

| 层 | 文件 | 改动 |
| --- | --- | --- |
| Bridge | `src/shared/bridgeMessages.ts` + 三个校验文件 | `file.preview` 消息 |
| Host | 新 `src/extension/PreviewPanelController.ts`、新 `src/extension/previewHtml.ts` | 面板生命周期、sandbox 壳 |
| Host | `src/extension/ChatController.ts`、`src/extension/extension.ts` | 消息路由、面板注入 |
| Webview | `src/webview/assistant/Thread.tsx`、`styles.css` | Changes/Tool 行 Preview chip |
| 测试/打包 | 聚焦测试、`.vscodeignore`/`verify:vsix` 核对 | 壳 HTML 与路径复验 |

### 3.3 与 V1 路线合并（2026-08-11 用户定序；序号按 2026-08-12 调整更新）

路线索引见 [`HANDOVER.md`](../HANDOVER.md) 第 3 节；本设计对应 **V1 #3**
（对话内图片 + Composer 拖拽/粘贴，已实现）与 **V1 #7**（Canvas，
2026-08-12 用户调整为发版前倒数第二）：

- **§1 + §1.5（图片）→ V1 #3**：转录显示、发送后回显、拖拽/粘贴进
  Composer——已实现；
- **§2 Canvas（方案 b）→ V1 #7**：独立 Preview 面板，与 Spec/Mission
  无耦合；方案 c（本地 HTTP 服务器）不进当前路线，有真实 tsx 需求时
  单独立项；
- 两项都遵守既有完成标准：Runtime、Host、Bridge、UI、测试、打包、
  可见验收齐全才算完成，并在同一变更中更新
  `implementation-status.md`。
