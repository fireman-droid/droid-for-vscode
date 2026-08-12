# 切片③开工预研：对话内图片显示 + Composer 拖拽/粘贴（rich-content §1、§1.5）

> 状态：**对应切片已实现，仅存档**（切片③两段均于 2026-08-12 落地，
> 见 `implementation-status.md`）。文中探针数据与验收会话 ID 保留作
> 回归参考。
>
> 预研日期：2026-08-12。由只读预研代理产出，服务
> [`rich-content-design.md`](./rich-content-design.md) §1 / §1.5 的实现开工。
> 所有结论基于本地文件实证（标注文件与行号）与两个只读探针的实测输出：
> `artifacts/slice-prep-image-block-probe.mjs`（磁盘会话文件结构普查）与
> `artifacts/slice-prep-loadsession-image-probe.mjs`（真实 `loadSession()` RPC
> 往返，输出存于 `artifacts/slice-prep-loadsession-image-probe.out.json`）。
> 探针只打印结构/计数/布尔，不打印任何内容明文。
>
> SDK 版本复核：`@factory/droid-sdk@0.7.0`
> （`node_modules/@factory/droid-sdk/package.json` L3），类型文件
> `dist/index-D_SzTnFR.d.ts`（下称 d.ts）与设计文档所引一致。

## 1. 设计假设 → 实证结果

### 1.1 SDK 类型（设计 §1.1）——全部核实，行号与设计文档一致

| 设计假设 | 实证结果 | 证据 |
| --- | --- | --- |
| `MessageContentBlockType` 枚举含 `Image = "image"` | ✅ 完全一致 | d.ts L1086–1094 |
| `Base64ImageSourceSchema = { type:'base64', data: string, mediaType: 4 种枚举 }` | ✅ 完全一致（jpeg/png/gif/webp） | d.ts L1185–1197 |
| `ImageBlock` 只有 base64 一种 source；`generated?` 区分模型生成 vs 用户附加 | ✅ 完全一致；`generated` 官方注释在 L1215–1220，`id?` 也是可选 | d.ts L1198–1239、L105431–105434 |
| `ToolResultBlock.content?: string \| Array<TextBlock \| ImageBlock \| DocumentBlock>` | ✅ 完全一致 | d.ts L105455–105458 |
| `ContentBlock` 联合含 ImageBlock | ✅ | d.ts L105459 |
| 实时流 `ToolResult` 事件 content 弱类型 `string \| JsonValue[]` | ✅（必须形状守卫） | d.ts L105952–105958 |
| 实时流 `CreateMessage` 事件 content 强类型 `FactoryDroidMessage['content']` | ✅，且带 `messageId` / `role` / `parentId?` | d.ts L105973–105979 |
| `MessageOptions.images?: Base64ImageSource[]` | ✅ | d.ts L106171–106177 |
| `UserPromptSubmitHookInput.has_images?: boolean` | ✅ | d.ts L105860–105863 |
| `path` 字段只在 PDF source 上 | ✅（`Base64PDFSourceSchema` L1296，image source 无 path） | d.ts L1296 |

### 1.2 磁盘格式 vs RPC 格式（新证据，设计文档未覆盖）

**磁盘上的会话 jsonl 用 snake_case `media_type`；`loadSession()` RPC 响应
用 camelCase `mediaType`。** 两个探针交叉证实：

- 磁盘普查（387 个会话文件、24,481 行、129 个 image 块、156 个
  tool_result 内嵌 image）：所有 image source 的键是
  `media_type`（`slice-prep-image-block-probe.out.json` 的
  `mediaTypes: {}` 空 + samples 中 `media_type: string(len=9)`）。
- 真实 `loadSession()` 往返（本工作区会话
  `4e6de24c-7347-4700-984d-985c36cec43c`，29 条消息，14 个 image 块）：
  **14/14 全部是 `mediaType`，`media_type` 计数为 0**
  （`slice-prep-loadsession-image-probe.out.json` 的 `keyCensus`）。

结论：CLI 在 serve `loadSession` 时做了 snake→camel 归一化，
**`projectSessionHistory.ts` 收到的就是 camelCase**，投影代码按
`source.mediaType` 写即可，不需要兼容 snake_case（边界校验按交付形状收
窄；SDK 编译产物中无 `media_type` 字符串，归一化在 CLI 侧）。

### 1.3 真实数据画像（来自探针，为上限常量提供依据）

- image 块 base64 长度：min 2,848 / p50 111,304 / p95 201,464 /
  max 255,372（磁盘普查）；live 探针中 tool_result 内嵌 jpeg 最大
  271,244。**设计的 `MAX_IMAGE_DATA_LENGTH = 2_800_000` 上限有 10 倍
  余量，合理**。
- `generated: true` 在 387 个文件中出现 **0 次**（模型生图在本机语料中
  未出现）；徽标逻辑保留但不要在验收里依赖真实样本，测试用构造数据。
- `id` 字段在 live 探针的 14 个块中也全部缺席——`ImageTranscriptItem`
  的稳定 ID 必须走 `stableTranscriptId`（message identity + block
  index），不能依赖 SDK 的块级 `id`。
- 本工作区就有可验收的历史会话：`~/.factory/sessions/-D-E-…-droidvisx/`
  下 `4e6de24c…`（5 图 + 9 tool 图）、`3d2ac816…`（75 图 + 222 tool 图，
  可作性能上限用例）。见 `slice-prep-find-image-session.mjs` 输出。

### 1.4 现有代码锚点核对（行号按当前工作区源码修正）

| 设计所引 | 实证 | 备注 |
| --- | --- | --- |
| `projectSessionHistory.ts` L268–273 image/document 丢弃并标 partial | ✅ 行号精确一致：`case 'image': case 'document': … projection.partial = true` | `src/runtime/history/projectSessionHistory.ts` L268–273 |
| `webviewHtml.ts` L39 CSP | ✅ 行号精确一致：`default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-…'; font-src ${cspSource}; connect-src 'none'`——**今日无 `data:`** | `src/extension/webviewHtml.ts` L39 |
| `DroidViewProvider.ts` L44–48 localResourceRoots | ⚠️ 行号漂移：现在在 **L56–62**（`dist/webview` + `resources`），内容一致 | `src/extension/DroidViewProvider.ts` L56–62 |
| `bridgeMessages.ts` L861 SessionTranscriptItem | ⚠️ 行号漂移：联合类型现在在 **L878–884**（6 种 kind：user/assistant/thinking/tool/changes/diagnostic） | `src/shared/bridgeMessages.ts` L878–884 |
| `FactoryDroidRuntime.ts` L1610–1659 附件投影 | ⚠️ 行号漂移：`projectStreamAttachments` 现在在 **L1646–1690**，逻辑一致（image→`images[]`、pdf→`files[]`，各带长度上限） | `src/runtime/FactoryDroidRuntime.ts` L1646 起 |
| 附件上限 4MB | ✅ `MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024` | `src/extension/attachmentSources.ts` L4 |
| 附件 chip 只传元数据 | ✅ `AttachmentSummary { id, kind, name, sizeBytes, truncated }`，字节不过桥 | `src/shared/bridgeMessages.ts` L735–741 |
| `MAX_PENDING_ATTACHMENTS = 8` | ✅ | `src/shared/bridgeMessages.ts` L719 |

### 1.5 设计与现实不符 / 需修正的点

1. **实时通道的投影位置**：设计 §3.2 表格把 create_message/tool_result
   图片投影写在 `FactoryDroidRuntime.ts`；实际唯一翻译点是
   `src/runtime/normalizeSdkEvent.ts`——当前 **没有 `create_message`
   分支（落 default 被丢弃，L129–131）**，`tool_result` 分支
   （L90–102）只投影生命周期、把 content 整个丢掉。两条实时图片通道
   都要在 normalizeSdkEvent 加分支，而不是 FactoryDroidRuntime。
2. **§1.5 必须新增 Bridge 消息**：设计写"优先不新增消息类型……发现有
   `attachment.addBlob`"——实证 **不存在任何 blob 推送消息**。
   `WebviewToHostMessage` 全集（`bridgeMessages.ts` L515–550）中附件类
   只有 pick/addEditor/addSelection/addProblems/addGitChanges/remove/
   addPath，全部是"Host 拉取"模式。拖拽/粘贴的字节在 Webview 手里，
   **`attachment.addImage { mediaType, dataBase64 }` 新消息是必选项**，
   三个校验文件同步落地。
3. **assistant-ui 的内建粘贴已被显式关闭**：`ComposerPrimitive.Input`
   传了 `addAttachmentOnPaste={false}`（`src/webview/assistant/Thread.tsx`
   L1087）。不要翻开它——assistant-ui 的附件管道走它自己的
   attachment adapter，与我们的 Host 暂存模型不兼容；用自定义
   onPaste/onDrop（挂在 `ComposerPrimitive.Root`/Input 上，Thread.tsx
   L976/L1080）读 `clipboardData`/`dataTransfer` 后发新 Bridge 消息。
4. **Composer 实体在 `Thread.tsx`**（`function Composer` L798，
   ComposerPrimitive.Root L976），不在 ComposerControls.tsx；
   dragover 高亮与 chips 联动都改 Thread.tsx。
5. **`user` 实时事件不带图片投影**：normalizeSdkEvent `case 'user'`
   （L104–105）只提取 `messageId`（normalizeUserMessage L134–148）。
   用户带图消息的乐观回显走 Host 暂存区直接投影（设计 §1.4 第一条），
   与该事件无关，不要改它。

## 2. 开工实现清单（Bridge → Runtime → Host → Webview）

依赖顺序与 Bridge 不变式（architecture-overview §3：双向校验对称、
上限共享常量、内容白名单）逐条对应。

### Bridge（先冻结契约）

- `src/shared/bridgeMessages.ts`
  - 新增 `ImageTranscriptItem`（按设计 §1.3 形状：id/kind:'image'/
    turnId/origin/mediaType 4 枚举/data/generated/byteLength），加进
    `SessionTranscriptItem` 联合（L878）。
  - 新常量：`MAX_IMAGE_DATA_LENGTH = 2_800_000`、
    `MAX_IMAGES_PER_TURN = 8`、会话级渲染上限 64、
    `IMAGE_MEDIA_TYPES` 4 值枚举数组。
  - 新消息 `attachment.addImage { sessionId, mediaType, dataBase64 }`
    进 `WebviewToHostMessage`（L515 联合）。
- `src/shared/validateMessage.ts`：`attachment.addImage` 解析器
  （exact-keys、mediaType 白名单、base64 字符集正则、长度 ≤
  attachment 4MB 对应的 base64 长度上限）。
- `src/webview/bridge/validateHostMessage.ts`：transcript item 解析
  的 kind 分派处（现有 'thinking'/'changes' 分支在 L1941–1945 附近）
  新增 `case 'image'`；枚举/长度/data 为空串（占位）合法。
- `src/shared/transcriptLimits.ts`：`transcriptItemTextUnits` 给
  image 项计入合理权重（建议按 data.length 计，防止 64 张大图击穿
  1M text units 预算；或单列 image 字节预算）。
- 双向敌对输入测试（`data:text/html` 走私、超长 base64、非白名单
  mediaType、多余字段）与消息同一变更落地。

### Runtime

- `src/runtime/normalizeSdkEvent.ts`
  - 新增 `case 'create_message'`：role user/assistant 的 content 里
    image 块 → 新 RuntimeEvent（`image-block`，含 origin、mediaType、
    data、generated、byteLength；messageId 用于稳定 ID）。
  - `case 'tool_result'`（L90–102）：content 为数组时对每项做
    ImageBlock 形状守卫（type/source.type/source.data/
    source.mediaType 白名单），通过的投影为 `origin:'tool-result'`
    事件；守卫失败静默跳过。
  - `src/runtime/runtimeEvents.ts` 加对应事件类型。
- `src/runtime/history/projectSessionHistory.ts`
  - `projectBlock` 的 `case 'image'`（L268）从丢弃改投影：
    role user/assistant 直接成项；`document` 保持现状（继续 partial）。
  - `completeTool`（L509）之外，tool 消息里 `tool_result` 块的数组
    content 也要扫 image（当前 `case 'tool_result'` 只调 completeTool，
    L265–267）。
  - 超限图片（> MAX_IMAGE_DATA_LENGTH）投占位（data:''、byteLength
    真值）而非丢弃，不再标 partial。

### Host

- `src/extension/ChatController.ts`
  - `handleRuntimeEvent` 新增 image 事件 → hostTranscriptState 追加
    image 项 + `transcript` 增量消息（带 sequence）。
  - 发送成功后（appendAcceptedUserPrompt 处）把 Host 暂存区的 image
    附件投影为 image 项回显（消除"已发送附件不回显"已知边界）。
  - 处理 `attachment.addImage`：复用 pick 的暂存槽/上限/去重逻辑
    （与 `vscodeAttachmentSources.readFilePayload` 的 4MB/类型守卫
    对齐，`src/extension/vscodeAttachmentSources.ts` L300–320）。
- `src/extension/SessionRecoveryStore.ts`：检查点只存占位
  （id/mediaType/byteLength/generated，data 置空），刷新后由
  loadSession 路径重建完整图。
- `src/extension/hostTranscriptState.ts` / `src/shared/hostTranscriptState.ts`、
  `src/extension/reconcileSessionHistory.ts`：image 项作为块级项按
  现有规则参与合并（stableTranscriptId 保证两侧同 ID），确认无需特判
  后补聚焦测试。
- `src/extension/webviewHtml.ts` L39：CSP `img-src ${cspSource}` →
  `img-src ${cspSource} data:`。**这是唯一的 CSP 改动**。

### Webview

- `src/webview/assistant/store.ts`：image 项进 reducer（快照 + 增量）。
- `src/webview/assistant/runtimeAdapter.ts`：image 项 → assistant-ui
  消息（`data:${mediaType};base64,${data}` 由白名单值拼接，绝不接受
  整串 data URI 字段）。
- `src/webview/assistant/Thread.tsx`：缩略图（max-height 240px）+
  lightbox + Generated 徽标 + 占位行（"Image · 3.2 MB"）；
  Composer（L798–1225）加 onDrop/onPaste + `dvx-composer-dragover`。
- `src/webview/assistant/styles.css`：缩略图/lightbox/dragover 样式，
  遵循 `prefers-reduced-motion`。

### 验收锚点

- 历史：加载 `4e6de24c…` 会话应显示 5 张用户图 + 9 张工具图，
  historyStatus 不再因 image 而 partial。
- 性能上限：`3d2ac816…`（297 图）验证渲染上限 64 + 占位降级不卡顿。
- 实时：真实 Cursor 拖入 png / Win+Shift+S 粘贴 → chip → 发送 →
  转录回显；截图类工具回图显示在 Tool 行下。

## 3. 风险与注意

1. **Bridge 体积**：单条 image 增量消息可达 ~280KB（p95 实测 200KB），
   App.tsx 的 rAF 合批一帧可能聚多张图。建议 Host 端对 image 增量
   逐条发送（不与文本 delta 合并），Webview 端合批已有隐藏兜底。
2. **恢复对账**：image 项 ID 必须在 history 投影与实时投影间稳定
   （messageId + blockIndex 或 toolUseId + index），否则 reconcile 会
   重复显示图片——写测试覆盖"恢复后同图不双份"。
3. **transcriptLimits 预算**：129 张历史图 × p50 111KB ≈ 14MB 字符，
   远超 1M text units。不给 image 计 units 会击穿内存预算，全额计
   units 会把长会话文本挤掉——建议 image 单列字节预算（会话 64 张 ×
   2.8M 封顶），实现时定案并写入 status。
