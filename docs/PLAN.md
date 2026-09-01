# DroidVisX 0.8.0 Conversation Recovery 实施计划

计划状态：**待用户确认，尚未开始实现**

## 1. 目标

本计划修复 DroidVisX 当前把 backend Session history、本地恢复 checkpoint 和
实时 Host transcript 同时当作显示权威的问题。

`0.8.0` 的恢复契约是：

> 重新打开窗口时，先恢复关闭前最后一次持久化的 canonical Conversation 显示状态。
> 后续 daemon history 只能追加缺失内容或补充已有内容，不能删除、替换、重排已经
> 展示并持久化的内容。

必须精确恢复的状态：

- 消息、Thinking、Tool、AskUser、Diagnostic、Image 和 Changes 的顺序、内容与稳定 ID；
- 当前 Conversation、当前 backend Session node 和 Conversation lineage；
- logical Turn 身份、Turn 状态和每个 Turn 的 settled Changes；
- `historyStatus`、`truncated`、排队文本和最后可信的 active-turn 显示状态；
- DroidVisX 管理的图片内容，而不只恢复空占位行。

重新连接后允许重新计算的状态：

- Runtime 连接状态、daemon working state、Session catalog 的即时状态；
- Settings、Context、token usage 和 Mission 的 Runtime 投影；
- hover、临时菜单、Tooltip 等非持久 UI 状态。

## 2. 已批准的产品决策

采用 **B+：Canonical Conversation Store + Explicit Session Lineage +
Stable Logical Turns + Independent Changes Ledger + Bounded Operation Log**。

Conversation 边界固定为：

| 操作 | Conversation | backend Session node |
| --- | --- | --- |
| New | 新建 | root |
| Fork | 新建 | fork |
| Edit-Resend / Rewind | 新建 | rewind |
| Compact | 保持当前 | compact successor |
| Spec Handoff | 保持当前 | handoff successor |

附加约束：

- backend `sessionId` 不再等于产品 Conversation 身份；
- daemon history 是上下文和补齐输入，不是显示快照权威；
- 不实施完整 Event Sourcing，不重放每个 token 或进度 fragment；
- operation log 只记录有产品意义的有界操作；
- 不重写 Runtime、Review 或整个 `ChatController`。

## 3. 当前失败模型

### 3.1 Flat Session ownership

`SessionRecoveryStore` V1 以 backend `sessionId` 作为唯一记录键。Compact 和
Spec Handoff 创建 successor Session 后，产品 Conversation 被错误拆成多条记录；
Fork 和 Rewind 又没有显式记录新旧 Conversation 关系。

### 3.2 Competing display authorities

`prepareActivationTranscript()` 先读取 checkpoint，再把
`loadHistory()` 的投影通过 `reconcileSessionHistory()` 设为 authoritative。
daemon history 因此可以替换已经显示的 canonical transcript。

### 3.3 Unstable recovered turns

Runtime history 投影会合成 Turn 和 Changes 身份；Reload 后的 daemon working turn
还会使用 `recovery-${generation}`。这些身份不能稳定关联关闭前的 logical Turn、
Review scope 和 commit context。

### 3.4 Transcript-coupled Changes

Review、Git status、commit 和 Webview commit draft 通过扫描 transcript 中最后一条
`changes` row 获取 canonical turn files。只要 history 投影替换、隐藏或重新合成该 row，
这些消费者就可能读取错误 Turn。

### 3.5 Image checkpoint is not exact

V1 持久化会清空 Image item 的 base64 数据，仅保留占位信息。Reload 首屏因此无法
精确恢复关闭前可见图片。

## 4. 目标数据模型

持久化 key 保持 `droidvisx.sessionRecovery`，格式升级为 Version 2。

```ts
interface StoredConversationStateV2 {
  version: 2;
  selectedConversationId: string | null;
  conversations: StoredConversation[];
}

interface StoredConversation {
  conversationId: string;
  activeSessionId: string;
  lastAccess: number;
  display: ConversationDisplaySnapshot;
  nodes: SessionLineageNode[];
  turns: LogicalTurnRecord[];
  operations: ConversationOperation[];
  queuedTexts: string[];
}
```

### 4.1 ConversationDisplaySnapshot

Display Snapshot 是恢复时的唯一显示权威，包含：

- `HostTranscriptState`；
- active Turn 的 `turnId`、terminal/working 状态和可见错误；
- latest Changes context；
- snapshot revision；
- Image item 对应的 managed artifact 引用。

连接、Session catalog、Settings、Context、Mission 和 token usage 不进入此快照；
它们在 Runtime 激活后重新投影，不能改变 canonical transcript。

### 4.2 SessionLineageNode

每个 backend Session 是一个 lineage node：

- `sessionId`；
- `relation`: `root | fork | rewind | compact | handoff`；
- `parentConversationId`；
- `parentSessionId`；
- 可选 `anchorTurnId`；
- node 创建时的 canonical checkpoint revision。

同一个 `sessionId` 只能属于一个 Conversation。解析时发现重复归属，隔离冲突记录，
不把两个 Conversation 合并。

### 4.3 LogicalTurnRecord

Host 已有的 live `turnId` 是 logical Turn 主键。记录包含：

- `turnId`；
- 发起 Turn 的 `sessionId`；
- prompt 和可选 user `messageId`；
- Turn 状态；
- settled `ChangedFileSummary[]`；
- Turn 首次和最后一次 canonical snapshot revision。

daemon history 中的 projected turn 只在确认属于 canonical 尾部新增 Turn 时创建映射；
它不能重命名已经存在的 logical Turn。

### 4.4 ConversationOperation

只记录：

- `turn-settled`；
- `fork`；
- `rewind`；
- `compact`；
- `handoff`。

Operation 使用单调 sequence 并有固定上限。它用于诊断、lineage 恢复和迁移验证，
不用于重建整段 transcript。

### 4.5 Managed image artifacts

Image bytes 写入 Extension `globalStorage` 下的 Conversation artifact 目录：

- 文件名由 Host 生成的 opaque ID 决定，不使用用户路径；
- Display Snapshot 只持久化 artifact ID、媒体类型、byteLength 和 transcript identity；
- `load()` 在发布 early snapshot 前读取并恢复 base64；
- Conversation 淘汰时只删除该 Conversation 明确拥有的 artifact；
- 单条 Image item 继续受 `MAX_IMAGE_DATA_LENGTH` 约束；
- 每个 Conversation 最多保留 `MAX_RENDERED_SESSION_IMAGES` 个 artifact，恢复出的
  base64 总量继续受 `MAX_SESSION_IMAGE_DATA_UNITS` 约束；
- artifact 写入先完成临时文件再原子 rename，随后才提交引用它的 Store revision；
- snapshot 写失败时删除本次未引用的新 artifact；进程崩溃留下的孤立 artifact 在下次
  Store load 后按已引用 ID 做一次有界清理；
- 不计算额外 digest，不增加新依赖。

如果 artifact 缺失或损坏，保留原 Image row 和 metadata，标记 recovery partial 并记录
不含图片内容的诊断；不能删除该 row 或让 daemon history 重排周围消息。

## 5. Store API 与兼容策略

`SessionRecoveryStore` 保留现有类名，内部 owner 改为 Conversation。先稳定 Store
接口，再修改 Controller 调用点。

### 5.1 新 API

- `getSelectedConversationId()`
- `resolveConversationBySession(sessionId)`
- `readConversation(conversationId)`
- `readActiveDisplay(conversationId)`
- `writeActiveDisplay(conversationId, sessionId, display)`
- `selectConversation(conversationId)`
- `createRootConversation(sessionId, display)`
- `forkConversation(sourceConversationId, sourceSessionId, successorSessionId, relation, display, anchorTurnId?)`
- `adoptSuccessor(conversationId, sourceSessionId, successorSessionId, relation, display, anchorTurnId?)`
- `recordSettledTurn(conversationId, sessionId, turn)`
- `readTurn(conversationId, turnId)`
- `readLatestChanges(conversationId)`

### 5.2 临时兼容 API

现有 `readSession()`、`writeSession()`、`selectSession()` 和 queue API 在第一批保留，
但只作为内部迁移适配：

- `readSession(sessionId)` 先解析 node，再返回其 Conversation 的 canonical display；
- `writeSession(sessionId, cache)` 只允许写该 node 所属 Conversation 的 active display；
- 未登记 session 首次写入时创建 singleton root Conversation；
- 所有生命周期调用点迁移完成后删除兼容 API，不能长期保留两个写入口。

### 5.3 V1 → V2

V1 每个 StoredSession 迁移成一个 root Conversation：

- `conversationId = sessionId`；
- `activeSessionId = sessionId`；
- transcript 原样成为 Display Snapshot；
- 从 transcript 派生 logical Turns 和 settled Changes；
- `selectedSessionId` 转为 `selectedConversationId`；
- queued texts 迁入 Conversation。

迁移只发生在内存中。首次成功 V2 flush 后覆盖同一个 storage key。
V1 transcript 继续经过现有 `hydrateHostTranscriptState()` restart normalization；
V2 Display Snapshot 在 early paint 前不把 active Thinking、Tool 或 Turn 预先改成 stopped。
Runtime working-state 对账完成后，daemon idle、process restart 或 resume failure 再通过正常
canonical reducer 把这些状态更新为 completed、interrupted 或 failed。

V1 没有可靠 lineage 字段，因此迁移不按标题、时间、相似文本或 projected ID 猜测
Compact/Handoff 关系。每条 V1 Session 先成为 singleton Conversation；如果其 checkpoint
已经包含关闭前的完整可见状态，该状态原样保留。无法从 V1 数据证明的跨 Session 关系
不自动合并，避免把两个真实独立对话错误拼接。

不提供 V2 → V1 downgrade 写回。旧版本遇到 Version 2 会按现有 fail-closed 行为忽略；
因此 `0.8.0` 发布说明必须明确降级后本地恢复 checkpoint 不可用，但 Droid 原始
Session history 不受影响。

### 5.4 Bounds 与损坏隔离

- 最多 8 个 Conversation；
- 每个 Conversation 最多 32 个 lineage nodes、256 个 Turns、64 个 operations；
- transcript 和总 text units 继续使用现有上限；
- LRU 按 Conversation 淘汰，不按 node 淘汰；
- 单个 Conversation 损坏时只丢弃该记录；顶层 version/shape 损坏时整份状态不可用；
- selected Conversation 不存在时清空 selection，不猜测替代项。

## 6. Canonical live reducer

所有可见 transcript 变化先进入 Host canonical state，再写 Display Snapshot：

1. 用户发送、Thinking、Tool、Assistant、AskUser、Diagnostic、Image、Changes 更新
   现有 `ctl.transcript`；
2. Host 使用当前 `conversationId + sessionId + turnId` 更新 Store；
3. snapshot revision 单调递增；
4. Webview Snapshot 和增量仍从同一个 Host state 发出；
5. settle 后 durable flush 成功，才发布依赖 settled truth 的 Review/commit 状态。

不新增第二个实时 reducer。`hostTranscriptState` 继续负责 transcript item 更新，
Conversation Store 负责身份、持久化和恢复。

## 7. Exact-first activation 与 history ingest

### 7.1 首屏

`emitEarlyRecoverySnapshot()`：

1. 读取 `selectedConversationId`；
2. 恢复完整 Display Snapshot 和 managed images；
3. 设置 `ctl.conversationId`、active `ctl.sessionId`、transcript 和 saved Turn；
4. 立即发布 connecting snapshot。

首屏内容不得等待 catalog、history 或 Runtime resume。

### 7.2 Runtime resume

Runtime 使用 Conversation 的 `activeSessionId` resume。Catalog 只用于验证 backend
Session 是否仍可访问，不再决定显示快照内容。

### 7.3 Append/enrich-only ingest

新增独立的 `ingestSessionHistory()`，替代 activation 和 recovered-turn 路径中的
wholesale authoritative reconciliation。

规则：

- canonical items 的顺序和 ID 不变；
- history 可补充已有 Assistant/Thinking/Tool 的缺失字段或更完整文本；
- history 可在 canonical 尾部追加确认的新 Turn；
- history 不能删除 canonical item；
- history 不能把 projected Changes 覆盖到已有 Turn ledger；
- history 与 canonical 无可信 anchor 时保持 canonical 不变并标记 partial；
- Compact successor 的摘要 history 只用于模型上下文和 metadata，不替换可见 transcript；
- Handoff successor 的 implementation history 只追加 planning Conversation 之后的新 Turn。

现有 `reconcileSessionHistory()` 保留给 child viewer 或其他仍需要 projection merge 的
调用点；主 Conversation activation 不再使用 `authoritativeLoaded: true`。

### 7.4 Recovered daemon turn

- 优先恢复 Display Snapshot 中的 active logical `turnId`；
- 只有 V1 migration 或无 active Turn metadata 时才创建一次稳定 fallback Turn ID，
  并立即写入 Store；
- daemon working poll 只更新该 Turn；
- final history 经 append/enrich ingest 后 settle 同一个 logical Turn；
- history 失败时保留 canonical 内容并把 Turn 标记 failed，不删除已显示内容。

## 8. Lineage 操作接线

### 8.1 New

Runtime 返回 root `sessionId` 后创建新 Conversation。选中项改为 Conversation，
active node 是 root Session。

### 8.2 Fork

Fork 成功后：

- 从当前 Display Snapshot 克隆新 Conversation；
- successor Session 作为 `fork` node；
- 原 Conversation 不变；
- 不使用 fork history 替换克隆后的显示状态；
- fork history 只做 append/enrich 校验。

### 8.3 Edit-Resend / Rewind

Rewind 成功后：

- 以截断到 anchor user message 的 canonical prefix 创建新 Conversation；
- successor Session 作为 `rewind` node；
- 记录 `anchorTurnId`；
- edited prompt 和新 Turn 只写入新 Conversation；
- 原 Conversation、Review 和 queue 状态保持不变。

### 8.4 Compact

Compact 成功后：

- 保持 `conversationId`；
- successor Session 作为 `compact` node 并成为 active node；
- Display Snapshot 原样保留；
- Conversation-scoped Webview state 和未发送附件不因 backend node 切换而清空；
- daemon 返回的 summarized history 不进入可见 transcript；
- Context、token usage 和 active backend Session 切换到 successor。
- 继续追加安静的 compaction divider，但新记录不再提供跳转 predecessor Session 的
  `View full history`；完整 canonical history 已经留在当前 Conversation。

### 8.5 Spec Handoff

Handoff 检测成功并完成 planning Turn 后：

- planning Conversation 保持不变；
- implementation Session 作为 `handoff` node；
- planning Display Snapshot 先 durable；
- resume implementation Session；
- Conversation-scoped Webview state 不因 backend node 切换而清空；
- implementation history 只向 canonical 尾部追加新 Turn，不替换 planning 内容。

### 8.6 Session drawer

首个 `0.8.0` 切片不重做 drawer 视觉组件，但 Host 投影必须按 Conversation 去重：

- singleton、Fork 和 Rewind 对应独立可选行；
- Compact/Handoff predecessor 与 successor 只显示一个 Conversation 行；
- 行的操作目标是该 Conversation 当前 active backend Session；
- catalog 中尚未进入 V2 Store 的 backend Session 按 singleton Conversation 展示；
- archive、favorite 和 rename 继续调用当前 active backend Session 的现有 Runtime 能力；
- Session 搜索命中 predecessor node 时，Host 解析并选择所属 Conversation，而不是新建
  重复显示记录。

这一步只改变 Host catalog projection 和身份映射，不改变 drawer 布局、样式或操作集合。

## 9. Independent Changes ledger

### 9.1 Canonical owner

`LogicalTurnRecord.files` 成为 settled Changed Files 的 durable owner。
Transcript `changes` item 继续作为显示投影，但不再是 Review/commit 的读取来源。

### 9.2 Settlement

`publishTurnChanges()` 顺序改为：

1. 计算 settled files；
2. 更新 logical Turn ledger；
3. 更新 canonical transcript display row；
4. 同一次 Store revision 持久化；
5. durable flush 成功；
6. 发布 Review settlement 和 `changes.update`。

任一步失败都不能出现“Review 已 settled，但 Conversation ledger 未 durable”。

### 9.3 Host consumers

以下读取 Store ledger：

- `createReviewFeature.readCanonicalTurnFiles`；
- `reviewActions`；
- `workspaceActions.latestTurnChanges`、Git status 和 commit；
- Restore 与 historical Changes scope。

### 9.4 Webview consumers

Bridge 同时公开产品 Conversation 身份和当前 Runtime Session 身份：

- `HostSnapshotMessage` 增加 `conversationId: string | null`；
- `HostConnectionMessage` 增加 `conversationId: string | null`；
- `sessionId` 继续用于 Runtime 命令和迟到事件校验；
- Webview 用 `conversationId` 判断是否保留 Conversation-scoped state，用 `sessionId`
  判断当前 backend operation target；
- Fork/Rewind 的 `conversationId` 改变并清空 Conversation-scoped state；
- Compact/Handoff 只改变 `sessionId`，不能清空当前 Conversation state。

`HostSnapshotMessage` 另增加可选 `latestChanges`：

```ts
{
  turnId: string;
  prompt: string | null;
  files: readonly ChangedFileSummary[];
}
```

Webview：

- ReviewDock、commit draft 和 tool changes context 优先读取该 canonical DTO；
- transcript Changes row 只负责在消息流中显示；
- Bridge version 增加并更新两个方向的严格 parser；
- `AssistantWebviewState` 同时保存 `conversationId` 和 `sessionId`；
- 不把整个 Turn ledger 暴露给 Webview。

## 10. 实施批次

### 批次 1：Store V2、parser、migration、artifact

主要文件：

- `src/extension/SessionRecoveryStore.ts`
- 新增一个聚焦的 Conversation model/parser 模块
- 新增一个 managed image artifact 模块
- `src/extension/extension.ts`
- `src/extension/sessionRecoveryItems.ts`
- `src/extension/SessionRecoveryStore.test.ts`

退出条件：

- V1 原样迁移；
- V2 严格 round-trip；
- node/session 唯一归属；
- LRU、text、node、turn、operation bounds；
- 图片首屏可恢复；
- durable failure 语义保持；
- V1 公共兼容 API 行为不回退。

### 批次 2：Controller identity 与 exact-first activation

主要文件：

- `src/extension/ChatController.ts`
- `src/extension/chat/internals.ts`
- `src/extension/chat/hostSnapshot.ts`
- `src/extension/chat/runtimeLifecycle.ts`
- `src/extension/chat/recovery.ts`
- 新增 append/enrich history ingest 模块

退出条件：

- `ctl.conversationId` 与 `ctl.sessionId` 分离；
- early snapshot 只来自 canonical Display Snapshot；
- history 不再 wholesale replace；
- recovered daemon turn 复用 stable logical Turn；
- history unavailable 仍保留 canonical display。

### 批次 3：Fork、Rewind、Compact、Handoff lineage

主要文件：

- `src/extension/chat/sessionDirectory.ts`
- `src/extension/chat/editResend.ts`
- `src/extension/chat/turnFlow.ts`
- `src/extension/chat/mission/controller.ts`
- `src/extension/chat/subagentWatch.ts`

退出条件：

- Fork/Rewind 创建新 Conversation；
- Compact/Handoff 保持 Conversation；
- 操作中断或 durable flush 失败不提交半个 lineage transition；
- Session 切换和 workspace 切换恢复正确 Conversation/node。

### 批次 4：Turn settlement 与 Changes consumers

主要文件：

- `src/extension/chat/publishTurnChanges.ts`
- `src/extension/createReviewFeature.ts`
- `src/extension/chat/reviewActions.ts`
- `src/extension/chat/workspaceActions.ts`
- `src/shared/bridgeMessages.ts`
- `src/webview/bridge/validateHostMessage.ts`
- `src/webview/assistant/store.ts`
- `src/webview/assistant/App.tsx`
- `src/webview/assistant/gitCommitDraft.ts`
- `src/webview/assistant/reviewDockSlot.tsx`
- `src/webview/assistant/thread/transcriptRows.tsx`

退出条件：

- Review、Restore、Git status、commit 和 draft 不扫描 transcript 获取 canonical files；
- 空 settled Changes 也在 ledger 中明确记录；
- transcript row 缺失不影响 Review/commit；
- Compact/Handoff 切换 backend Session 时 Webview 保留同一 Conversation 的状态；
- Bridge parser 保持 exact-key 和 discriminant coverage。

### 批次 5：兼容入口收口

主要工作：

- 迁移剩余 `readSession/writeSession/selectSession` 调用点；
- 删除 Store 内临时兼容写 API；
- 主 Conversation 路径删除 `authoritativeLoaded` 使用；
- 保留非主 Conversation viewer 所需的旧 reconcile 行为；
- 检查 Mission、queue、subagent checkpoint 不跨 Conversation 写错 owner。

退出条件：

- 一个 canonical display 只有一个写入口；
- backend history 只有 ingest 入口；
- settled files 只有 Turn ledger 一个 durable owner。

### 批次 6：版本、文档、验证和发布准备

只在前五批通过后执行：

- `package.json` 升级到 `0.8.0`；
- 更新 `CHANGELOG.md`；
- 更新 `docs/ARCHITECTURE.md`；
- 更新 `docs/STATUS.md`；
- 保持 `docs/DESIGN.md` 仅在 UI 产品事实变化时修改。

验证：

```powershell
pnpm run typecheck
pnpm run lint:budgets
```

定向测试只覆盖本次可达行为：

- `SessionRecoveryStore.test.ts`
- `reconcileSessionHistory.test.ts` 或新的 ingest test
- `ChatController.recovery.test.ts`
- `ChatController.sessions.test.ts`
- `ChatController.turnEvents.test.ts`
- `ChatController.workspaceSwitch.test.ts`
- `ChatController.workspaceActions.test.ts`
- `store.changes.test.ts`
- `gitCommitDraft.test.ts`
- Review Coordinator 相关定向测试

然后运行：

```powershell
pnpm run build
```

只有用户要求发布安装时，再依次执行：

```powershell
pnpm run package:vsix
pnpm run verify:vsix
cursor --install-extension <0.8.0-vsix>
```

## 11. 必须保护的回归场景

1. Window A 显示完整 planning 对话，关闭后 daemon history 只含 implementation
   Session；重新打开仍先显示原 planning 对话，再追加 implementation 内容。
2. Compact 后关闭并重新打开，显示内容、顺序和 ID 不变，active backend Session 是
   compact successor。
3. Fork 后原 Conversation 和 fork Conversation 独立恢复，任何一边的新 Turn 不污染另一边。
4. Edit-Resend 后新 Conversation 只含 canonical prefix 和 edited Turn，原 Conversation
   保持完整。
5. daemon history 缺失、截断、乱序或重新生成 ID 时，canonical items 不被删除或重排。
6. daemon turn 跨 Reload 继续运行时，恢复同一个 logical Turn，最终结果只出现一次。
7. settled Changes transcript row 被 history 省略时，Review、Restore、commit 和 draft
   仍读取正确 ledger。
8. settled files 为空时，ledger 明确记录空集合，不回退到旧 Turn 的 Changes。
9. 图片在 Reload 首屏仍可显示；artifact 缺失时保留 row 和相邻顺序。
10. V1 checkpoint 升级后可恢复；损坏的单个 V2 Conversation 不影响其他安全记录。
11. persistence update 失败时不发布成功 lineage transition、settled Review 或 commit context。
12. workspace 切换、stale runtime generation 和 session operation 竞态不能写入错误 Conversation。

## 12. 提交策略

实现阶段按可运行纵向结果提交，预定顺序：

1. `feat: add canonical conversation recovery store`
2. `fix: preserve canonical display across session recovery`
3. `feat: persist conversation session lineage`
4. `refactor: decouple turn changes from transcript projection`
5. `docs: release conversation recovery 0.8.0`

每个提交只暂存本批明确文件。任一批 typecheck、预算或定向测试失败时不提交该批。
不 push，不生成或安装 VSIX，除非用户另行要求。

## 13. 明确非目标

- 不实施完整 Event Sourcing；
- 不记录或重放每个 token、Thinking fragment、Tool progress fragment；
- 不重写 Droid SDK history 格式或 daemon Session 文件；
- 不把 Session drawer 在本次重做成新的 Conversation UI；
- 不改变 Mission、Review、Composer 或 Diff 的视觉设计；
- 不新增通用数据库、schema/codegen 或状态管理依赖；
- 不承诺跨设备同步；
- 不把 Runtime 连接状态或临时菜单当作 durable Conversation 内容；
- 不处理与 exact recovery 无关的邻近重构。

## 14. 全计划退出条件

只有同时满足以下条件，`0.8.0` Conversation Recovery 才算完成：

1. canonical Display Snapshot 是恢复显示的唯一权威；
2. backend Session lineage 与 visible Conversation 明确分离；
3. Fork/Rewind 和 Compact/Handoff 满足批准的 Conversation 边界；
4. live 和 recovered Turn 使用稳定 logical identity；
5. Changes ledger 独立于 transcript projection；
6. V1 migration、bounds、corruption isolation 和 image recovery 可验证；
7. Runtime、Host、Bridge 和 Webview 所需消费者全部接通；
8. `typecheck`、`lint:budgets`、定向测试和 production build 通过；
9. `ARCHITECTURE`、`STATUS`、`CHANGELOG` 和版本同步；
10. 用户在真实 Cursor Reload 中验收关闭前内容、Compact、Handoff、Fork 和 Rewind。
