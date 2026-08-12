# Add to Chat / 选中即加入对话 设计

> 状态：**设计待实现**（2026-08-12 调研 + 设计，未实现，排期待用户
> 拍板）。参考 Cursor 的 Add to Chat（Ctrl+L 悬浮条）交互，用户于
> 2026-08-12 提出三个入口：a) 编辑器选中代码/文字加入聊天；
> b) 文件（资源管理器/编辑器标签右键）加入聊天；c) GUI 转录里选中
> 文字就地引用进 Composer。证据标注文件与行号（行号会漂移，定位以
> 符号为准）。

---

## 1. 需求与入口拆解

| 入口 | 触发 | 送达形态 |
| --- | --- | --- |
| a. 编辑器选中 → Add to Chat | 快捷键 / 编辑器右键（浮动条见 §2.3 评估） | 选中文本（带文件名+行号）进 Composer 附件暂存 chips |
| b. 文件 → Add to Chat | 资源管理器右键 / 编辑器标签右键 | 整文件进附件暂存 chips |
| c. 转录选中 → Quote in reply | GUI 转录正文选中后浮动按钮 | 引用文本（blockquote）插入 Composer 草稿 |

## 2. 调研结论

### 2.1 已有能力盘点（GUI 附件链路 = 现成的注入机制）

- **Bridge**：七种 `attachment.*` W→H 消息已生产接通
  （`src/shared/bridgeMessages.ts`：pick / addEditor /
  addSelection / addProblems / addGitChanges / addPath / remove，
  另有 addImage / addUris / addTextFile），全部"Host 拉取"模式；
  附件字节不过桥，Webview 只收 `session.attachments` 元数据广播。
- **Host**：`AttachmentSources.readActiveSelection()`
  （`src/extension/vscodeAttachmentSources.ts` L102–118）已经产出
  **带文件名与行号**的命名（`<file>:<startLine>-<endLine>`）；
  `lastTextEditor` 机制（L25–41）解决了"焦点进 webview 后
  `activeTextEditor` 丢失"的问题。暂存区
  `ChatController.pendingAttachments`（上限
  `MAX_PENDING_ATTACHMENTS = 8`、单文本 256K 字符、图片/PDF
  4MB/6MB，`src/extension/attachmentSources.ts` L3–8），
  `attachmentOperationInProgress` 互斥。越界文件拒绝语义已有先例
  （`handleAttachmentAddUris`，`ChatController.ts` L3447 起：
  工作区外 URI 记一次诊断，其余走 `readWorkspaceFile`）。
- **入口差距**：以上全部由 **Webview 的 `+` 菜单**触发
  （`ComposerControls.tsx` Attach files… / Attach selection 等）。
  缺"从编辑器侧主动触发"的入口——`package.json` contributes 现状只有
  4 个命令（focusView / openLogs / exportDiagnostics /
  shutdownDaemon），**无 menus、无 keybindings 贡献点**。
  `extension.ts` 有模块级 `activeController` 引用（L50）与
  `droidvisx.focusView` 命令（L348，可编程 reveal 视图），Host 侧
  命令接线的地基齐全。

### 2.2 "droid cli 好像支持"核实：没有被漏掉的原生通道

- Factory 官方确有 IDE 选区共享：官方 VS Code 扩展
  `factory.factory-vscode-extension`（Marketplace 实查）配合
  docs.factory.ai/ide-integrations——"Shares active file, selection,
  open files, diagnostics"。**但该通道服务的是 CLI TUI 会话**
  （在集成终端跑 `droid` 时自动连接；本机
  `~/.factory/ide/*.lock` 即其握手产物，2026-08-12 实测存在）。
  它不是公开 SDK API，我们的 GUI 会话无法消费。
- 公开 SDK（`@factory/droid-sdk` 0.7.0 d.ts 全文检索）**没有**
  "注入编辑器选区/外部上下文"的专用 RPC；向会话注入上下文的公开
  通道就是消息本身：`sendTurn` → SDK `MessageOptions` 的
  `{ images, files }`（即我们已接通的附件链路）。
- **结论**：GUI 的附件链路就是正确且唯一的注入机制，没有更原生的
  通道被漏掉；本设计只补"入口"，不动送达机制。

### 2.3 Cursor 式选中浮动条：VS Code 扩展 API 做不了，判放弃

Cursor 的选中悬浮条（附图 2）是其闭源 fork 的私有 UI，不是扩展 API。
标准 API 内的近似方案评估：

| 方案 | 评估 | 判定 |
| --- | --- | --- |
| CodeLens | 挂在行上而非选区上，选中后不会跟随出现，语义错位 | 弃 |
| Hover provider | 需要鼠标悬停触发，与"选中即出现"不符，且 hover 内按钮交互受限（command link 可行但入口埋没） | 弃 |
| TextEditorDecoration | 只能做视觉装饰，不能承载可点击按钮 | 弃 |
| 命令 + 快捷键 + 右键菜单 | 标准贡献点，稳定可靠 | **采用** |

快捷键选择：Cursor 本体已占用 `Ctrl+L`（自家 Add to Chat）与
`Ctrl+Shift+S`（Add to Side Chat），扩展抢注会冲突。建议
**`Ctrl+Alt+L`**（mac `Cmd+Alt+L`），`when: editorHasSelection`；
最终键位实现时在真实 Cursor 里验证无冲突后定稿。

### 2.4 入口 c 的可行性（GUI 内选中引用）

- 转录正文可选中：user-select 治理已落地
  （`src/webview/assistant/styles.css` L4730 `user-select: text`，
  周边交互件为 `none`）。
- Composer 程序化写入有生产先例：`aui.thread.composer().setText(...)`
  已用于 slash 命令与 `@` 提及（`App.tsx` L1121、`Thread.tsx`
  L1710/L1761），draft 同步机制（`onDraftChange` / `draftRef`）现成。
- Webview 内做浮动按钮不受 VS Code API 限制（自家 DOM），可行。

## 3. 三个入口的设计

### 3.1 入口 a：编辑器选中 → Add selection to chat

- **contributes**（package.json）：
  - command `droidvisx.addSelectionToChat`
    （title "DroidVisX: Add Selection to Chat"）；
  - keybinding `ctrl+alt+l` / mac `cmd+alt+l`，
    `when: "editorHasSelection"`；
  - menu `editor/context`，`when: "editorHasSelection"`，group
    尾部（避免挤占 Cursor 自带项）。
- **Host**：ChatController 新增公开方法
  `addEditorSelectionToChat()`：内部用当前活动会话 id 走既有
  `handleAttachmentCapture(sessionId, 'selection')` 同一管线（含
  互斥、上限、diagnostic 语义），随后执行 `droidvisx.focusView`
  reveal 视图让 chips 可见。`extension.ts` 注册命令调用
  `activeController`。无活动会话/工作区不可用时沿用既有
  diagnostic 提示路径，不新造错误面。
- **Bridge / Webview：零改动**（chips 渲染与 `session.attachments`
  广播现成）。
- 注意：命令从编辑器触发时 `activeTextEditor` 必然存在，
  `lastTextEditor` 兜底照常生效。

### 3.2 入口 b：文件右键 → Add file to chat

- **contributes**：
  - command `droidvisx.addFileToChat`
    （title "DroidVisX: Add File to Chat"）；
  - menus：`explorer/context` 与 `editor/title/context`，group 尾部。
- **Host**：命令签名
  `(uri?: vscode.Uri, uris?: vscode.Uri[])`（VS Code 对
  explorer 多选传第二参）。ChatController 新增
  `addFilesToChat(uris)`：workspace 相对化 + 越界一次性诊断 +
  逐个走 `readWorkspaceFile` 管线——即 `handleAttachmentAddUris`
  的既有语义直接复用（把 `vscode.Uri` 序列化为 `file://` 字符串
  喂同一实现即可），4MB/类型守卫、8 条上限自动生效。之后
  focusView reveal。
- **Bridge / Webview：零改动**。
- 编辑器标签右键时 uri = 该 tab 文档；未保存 untitled 文档无
  fs 路径，按既有"读取失败"诊断处理（不发明特殊通道）。

### 3.3 入口 c：转录选中 → Quote in reply

- **纯 Webview 切片**（Bridge / Host / Runtime 零改动）：
  - `Thread.tsx`（或独立小组件）监听 `selectionchange` +
    `mouseup`/`keyup`；当选区非空且 anchor/focus 都落在转录容器
    （`.dvx-thread` 消息正文）内时，在选区尾部坐标浮出
    "Quote in reply" 小按钮（`position: fixed`，复用
    `dvx-popover` 视觉，`prefers-reduced-motion` 兜底）；滚动/
    点击别处/选区清空即隐藏。
  - 点击 → 取 `window.getSelection().toString()`，规范化为
    blockquote 追加到 Composer 草稿：

    ```text
    > 第一行
    > 第二行
    >
    （光标停在此，来源标注按角色附在引文首行前，如 "> Droid:"）
    ```

    来源标注建议轻量：引用 assistant 消息时首行前缀 `Droid:`，
    引用自己消息时前缀 `Me:`（消息角色从选区所在消息节点的
    data 属性读取）；不带行号/会话 id（转录内引用，来源即本会话，
    重标注价值低——实现时可按用户反馈调整格式）。
  - 写入用既有 `aui.thread.composer().setText(draft + quoted)` +
    `onDraftChange` 同步 + focus `#dvx-prompt`（`DraftSynchronizer`
    同款 focus 手法，`App.tsx` L1122–1126）。
  - 引用长度上限对齐 `MAX_TURN_TEXT_LENGTH` 相关校验：超长截断并
    提示（草稿最终发送时本来就有长度约束，就地截断避免发送期才
    报错）。
- 与正在进行的 `src/webview/assistant/` 编辑批次（滚动/吸顶/可选中
  治理等）存在同文件冲突面，**排期上必须等该批次落地后开工**。

## 4. 改动面汇总与切片

| 入口 | contributes | Bridge | Host | Webview |
| --- | --- | --- | --- | --- |
| a 选中 | command + keybinding + editor/context | 无 | ChatController 公开入口（复用 capture 管线）+ extension.ts 注册 | 无 |
| b 文件 | command + explorer/context + editor/title/context | 无 | 公开入口（复用 addUris 管线） | 无 |
| c 引用 | 无 | 无 | 无 | 选区监听 + 浮动按钮 + setText 注入 |

**切片划分与优先级建议**：

1. **切片 ①（a + b 合并，建议先做）**：同一批 contributes + 两个
   ChatController 公开入口 + 聚焦测试 + 打包验收。理由：改动面最小
   （Bridge/Webview 零改动）、复用度最高、编辑器侧高频动作、与
   webview 并行编辑批次零冲突（只动 package.json / extension.ts /
   ChatController.ts，需与并行代理确认后者当前无人编辑）。
2. **切片 ②（c）**：独立 Webview 切片，待当前 webview 修复批次
   落地后开工。
3. 浮动选中条（编辑器内）判不做（§2.3），不列切片。

## 5. 边界与失败路径

| 项 | 处理 |
| --- | --- |
| 编辑器无选中 / 选中全空白 | 既有 `readActiveSelection` 返回 `empty`，沿用现有 diagnostic 文案；keybinding 有 `editorHasSelection` 前置，多数情况不触达 |
| 暂存区满（8 条） | 沿用既有上限 diagnostic，不静默丢弃 |
| 工作区外文件（入口 b） | 沿用 `handleAttachmentAddUris` 语义：一次性诊断 + 其余继续 |
| 视图未打开时触发 | 命令先 `focusView` reveal（activationEvents 需补 `onCommand:droidvisx.addSelectionToChat` / `addFileToChat`，或依赖 VS Code 隐式命令激活），Controller 未就绪时的竞态按"reveal 后重试一次/丢弃并提示"择一，实现时定 |
| turn 进行中 | 附件暂存本就允许 turn 中添加（消费在下次 send），无需新守卫 |
| 快捷键冲突 | `ctrl+alt+l` 在真实 Cursor 验证；冲突则换 `ctrl+alt+i` 等，键位不写死进设计 |
| 入口 c 选区跨多条消息 | 允许（纯文本拼接）；来源前缀取选区起点所在消息的角色 |
| 入口 c 选中交互件文本（按钮标签等） | 交互件已 `user-select: none`（styles.css 多处），选区天然不含 |

## 6. 可观察验收标准

真实 Cursor 安装 VSIX（Reload Window）后：

1. 编辑器选中若干行按 `Ctrl+Alt+L`（或右键菜单项）→ DroidVisX 侧栏
   被 reveal，Composer 上方出现 `<文件名>:<起>-<迄>` 命名的 chip；
   发送后 Droid 回复可见引用内容生效。
2. 资源管理器右键一个文件（含多选两个文件）→ chips 逐个出现；右键
   一个工作区外文件 → 出现一次越界诊断、无 chip。
3. 编辑器标签右键 → 当前文件成 chip。
4. 转录里选中一段 assistant 回复 → 浮出 "Quote in reply" → 点击后
   Composer 草稿追加 blockquote 引文、光标聚焦；Esc/点击别处浮钮
   消失。
5. 门禁：`pnpm run typecheck`、`pnpm run test`、`pnpm run build`
   全绿；日志无新增 `host.bridge.rejected`。

## 7. 排期建议

切片 ①（入口 a+b）**建议排在近期空档优先做**：用户可感价值大、
风险低、一天内可交付；切片 ②（入口 c）跟在 webview 当前修复批次
之后。相对功能"BYOK Add model"
（[`byok-add-model-design.md`](./byok-add-model-design.md)）：
切片 ① 改动面更小、更快见效，建议先于 BYOK；最终排期位置待用户
拍板。
