# Turn 运行中排队消息设计（V1 主线 #7+，发版前最后一步）

> 状态：设计文档（未实现）。调研与技术路线来自
> [`daemon-feature-opportunities.md`](./daemon-feature-opportunities.md)
> §A1（2026-08-12，用户已定方案甲：Host 层排队）；CLI 侧行为基准见
> [`cli-coverage-assessment.md`](./cli-coverage-assessment.md) §3 #8。
> 本文只新建文档、不改任何生产代码。文中源码行号为 2026-08-12
> 工作区快照，会漂移；定位以文件路径 + 符号名为准。
> Bridge 改动受
> [`architecture-overview.md`](../engineering/architecture-overview.md)
> 第 3 节不变式约束（双向校验对称、上限共享常量、closed enum、
> 序列号单调）。
>
> SDK 能力断言的证据链：本文引用的 SDK 事实全部出自
> `daemon-feature-opportunities.md` §0/§A1 已核实的条目，底层证据文件为
> `node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`（类型面）与
> `node_modules/@factory/droid-sdk/dist/chunk-5UXINOXG.mjs`（实现，
> 0.7.0）。本文不引入任何新的 SDK 能力断言。

---

## 1. 需求与决策记录

1. **用户已定**：Turn 排队是 V1 主线发版前的最后一步，动手前先补设计
   文档（即本文）。技术路线已在 `daemon-feature-opportunities.md` §A1
   拍板为**方案甲（Host 层排队）**，不用 daemon 原生队列。
2. **为什么不用 daemon 原生队列**（证据见 §3.2）：SDK 公开门面没有
   入队 API；排队 turn 被 daemon 自动执行时其增量流不可观测（门面
   `stream()` 单流限制，活跃流期间抛 `ConcurrentStreamError`）。
3. **Host 层方案的关键收益**：每条排队消息派发后就是一个普通回合，
   走现有 `handleSend` → `consumeTurn` 流消费循环；**Runtime 层零
   改动，process 与 daemon 两种模式同样工作**——主线发版不被 daemon
   模式转正卡住。
4. **切片顺序已定**：排队+自动发送 → 队列 UI 展示 → 队列编辑/删除
   （三步，见 §7）。

## 2. 现状与差距（源码实证）

| # | 维度 | 现状 | 目标 |
| --- | --- | --- | --- |
| 1 | Webview 发送门 | `App.tsx` `canSendMessage` 在 turn 活跃时返回 false，发送按钮禁用；Composer hint 显示 "Droid is active · Stop before sending another message"（`src/webview/assistant/Thread.tsx` Composer 组件） | Turn 活跃时 Enter/发送 = 入队；hint 改为 "Will send after the current turn finishes" |
| 2 | Host 接收门 | `ChatController.handleSend`（`src/extension/ChatController.ts` L896–977）在 `isTurnActive(this.turn)` 时**静默丢弃** | 新增 `queue.add` 独立消息承载入队语义；`turn.send` 语义不变（活跃时仍拒绝，保持显式契约） |
| 3 | Turn 终态 | `handleTurnComplete`（L1238）/`failTurn`（L4657）产生 completed / interrupted / failed；`emitTurnState`（L4746）终态分支收口（flushTurnIo、endTurnScope） | 终态收口后挂队列派发钩子 `maybeDispatchQueue()` |
| 4 | 队列状态 | 不存在 | Host 内存 FIFO（上限 10 条），经新 H→W 消息 `queue.state` 与 `host.snapshot` 新字段同步到 Webview |
| 5 | 队列 UI | 不存在 | 转录尾部、Composer 上方的"待发送"卡片列（弱化样式），可删除、可内联编辑 |

## 3. SDK / 代码证据

### 3.1 复用的既有链路（全部生产已接通）

- **发送路径**：Webview `App.tsx` `handleSend` 生成 `turnId`
  （`crypto.randomUUID`）→ `turn.send` → Host `handleSend` 守卫
  （connected、sessionId 匹配、非空文本、`!isTurnActive`、
  `!sessionOperationInProgress`、`settingsUpdate === null`）→
  `takePendingAttachments()` 消费 Composer 暂存 →
  `appendAcceptedUserPrompt` → `emitTurnState('submitting')` →
  `consumeTurn` 流消费。
- **原子快照模式**（队列派发直接复用）：`handleEditResend`
  （L1379–1485）在 rewind 成功后 `handleSend(...)` + `emitSnapshot()`
  ——单个快照原子携带新转录、submitting turn；Webview 对 host 发起的
  回合无需专门增量协议。
- **终态收口点**：`emitTurnState` 在 status ∈
  {completed, interrupted, failed} 时执行终态副作用（L4762–4769）；
  三个终态生产者是 `handleTurnComplete` 的 success/interrupted 分支与
  `failTurn`。`interactions.endTurn` 在终态前已调用（L1243、L1332、
  L4666），所以终态时该回合无 pending 交互。
- **附件暂存**：`pendingAttachments` 单一暂存区（上限
  `MAX_PENDING_ATTACHMENTS = 8`），`handleSend` 在接受时机消费；
  `SentAttachmentSummary` 是既有的有界元数据投影
  （`src/shared/bridgeMessages.ts`）。
- **双向校验**：W→H 在 `src/shared/validateMessage.ts`
  （`parseWebviewMessage`，hasExactKeys + isId + 长度上限模式，
  参照 `parseTurnSend` L238–256）；H→W 在
  `src/webview/bridge/validateHostMessage.ts`。测试分别在
  `validateMessage.test.ts` / `validateHostMessage.test.ts`。

### 3.2 为什么不走 daemon 原生队列（fail-closed 证据）

以下均已在 `daemon-feature-opportunities.md` §A1 逐条核实（底层文件
`index-D_SzTnFR.d.ts` / `chunk-5UXINOXG.mjs`）：

1. daemon 侧确有原生队列（`daemon.add_user_message` 带
   `queuePlacement`；队列进 `load_session` 持久状态；
   `resolveQueuedMessage` 可改删）——**但公开门面
   `ConnectedDroidSession` 没有入队入口**：只有 `stream(prompt)`，
   活跃流期间抛 `ConcurrentStreamError`（d.ts L107768–107777）；
   `createSessionOperationsResource` 只暴露 `resolveQueuedMessage`
   （改/删），不暴露 add（mjs L22810–22872 全表核对）。
2. **排队消息被 daemon 自动执行时没人能收到它的流**：当前 turn 完成
   后 `stream()` 生成器结束，下一条的增量事件只以 session
   notifications 广播，门面层无 observe-only 流（d.ts
   L113840–113916）。接住它需要绕过门面自管
   `DaemonSessionController`（= A4 完整档），量级 5–8 天起。
3. 结论：daemon 原生队列登记为 A4 完整档之后的顺势增强（§8），
   本切片走 Host 层。

### 3.3 CLI 行为基准与已知语义分叉

CLI TUI 支持运行中排队且排队消息可参与 **steering**（当前回合中途
注入，`QueuedUserMessageDisplayGroup.Steering`，d.ts L112061–112064）。
Host 层排队做不到中途注入，只能"下一回合执行"——UI 文案如实表述为
"will send after the current turn"，不模仿 steering（§8 明确不做）。

## 4. 行为规格

### 4.1 队列生命周期状态机

Host 侧队列是活跃会话的附属状态：

```
字段（ChatController 私有）：
  queuedPrompts: QueuedPrompt[]     // FIFO，上限 MAX_QUEUED_MESSAGES = 10
  queuePaused: QueuePausedReason | null

QueuedPrompt = {
  queueId: string                    // Webview 生成的 UUID
  text: string                       // ≤ MAX_TURN_TEXT_LENGTH
  attachments: PendingAttachment[]   // 入队时消费的暂存，≤ 8 条
}

QueuePausedReason = 'stopped' | 'turn-failed' | 'dispatch-blocked'
```

事件与迁移：

| 事件 | 迁移 |
| --- | --- |
| `queue.add` 通过守卫 | 追加到队尾 → 立即 `maybeDispatchQueue()`（消除"webview 认为 turn 活跃、host 已终态"的竞态窗口：若此刻可派发就直接发出） |
| turn 到达 `completed` | `maybeDispatchQueue()`：守卫全过 → 出队首条自动派发 |
| turn 到达 `interrupted`（本 GUI 中仅 Stop 可达） | 队列保留，`queuePaused = 'stopped'`，不自动派发 |
| turn 到达 `failed` | 队列保留，`queuePaused = 'turn-failed'`，不自动派发 |
| 派发时守卫被占（`settingsUpdate`、`sessionOperationInProgress` 等瞬态） | `queuePaused = 'dispatch-blocked'` + `runtime.diagnostic` |
| `queue.resume` | 清除 paused → `maybeDispatchQueue()` |
| `queue.remove` / `queue.update` / `queue.clear` | 改队列内容；对已派发（不在队列中）的 queueId 静默忽略 + debug 日志 |
| 会话切换 / 新会话 / fork / compact / edit-resend 采纳新会话 / runtime 重建 | **丢弃整个队列** + `runtime.diagnostic`（info：'queued messages discarded'，含条数）——队列语义严格绑定当前会话线 |
| Reload Window | 丢失（Host 内存，§4.6） |

> 对任务描述"终态（completed/interrupted/failed）后自动逐条发出"的
> 细化：**只有 completed 自动派发**。interrupted 在本 GUI 只能由用户
> Stop 产生——用户主动叫停后立刻自动灌下一条违背其意图（任务描述
> 自身也建议"Stop 保留队列不自动发"）；failed 自动重发会向已失败的
> 运行时连续灌消息造成级联失败。两者都转为暂停态，队列区 banner 给
> "立即发送 / 清空"一键操作，用户成本是一次点击，换来确定性。

### 4.2 入队

- **触发**：turn 活跃（submitting / streaming / stopping）时，Composer
  Enter / 发送按钮 → Webview 发 `queue.add`（Webview 侧生成
  `queueId = crypto.randomUUID()`，与 turnId 同源做法）。turn 不活跃
  且队列为空时行为不变（`turn.send`）。turn 不活跃但队列非空（暂停
  态）时也走 `queue.add`——保序，不允许插队。
- **Host 守卫**（不满足即静默丢弃 + debug 日志，与 `handleSend` 的
  防御风格一致）：connected、sessionId 匹配、文本 trim 非空、
  队列未满（< 10）。**不要求 turn 活跃**——见 4.1 的竞态说明：turn
  刚结束时到达的 `queue.add` 被接受并立即派发，行为等价于直接发送。
- **附件**：入队时即调用 `takePendingAttachments()` 消费 Composer
  暂存（与 `handleSend` 相同时机），附件负载存入 `QueuedPrompt`，
  Bridge 上只回发 `SentAttachmentSummary` 元数据。这避免两条排队
  消息争用同一个暂存区（`daemon-feature-opportunities.md` §A1 的
  设计要点）。
- **多条保序**：严格 FIFO。队列满时 Webview 禁用发送并提示
  "Queue is full (10)"；Host 侧同样拒绝（双侧一致）。

### 4.3 自动派发

`maybeDispatchQueue()` 的守卫（全过才派发，镜像 `handleSend` 守卫）：

```
queuedPrompts.length > 0
&& queuePaused === null
&& !isTurnActive(this.turn)
&& !this.interactions.hasPending()
&& !this.sessionOperationInProgress
&& this.settingsUpdate === null
&& this.connection.status === 'connected'
&& this.runtime !== null
```

派发动作：出队首条 → `handleSend(sessionId, turnId = queueId, text,
'queued', attachments)` → `emitQueueState()` → `emitSnapshot()`。

- **turnId 复用 queueId**：queueId 是 Webview 生成、经 `isId` 校验的
  UUID，直接作为派发回合的 turnId，Webview 可将排队卡片与被接受的
  回合天然关联；`handleSend` 既有的 `this.turn?.turnId === turnId`
  守卫顺带防重复派发。
- **`handleSend` 扩展**：`kind` 联合类型从 `'send' | 'edit-resend'`
  扩到 `'send' | 'edit-resend' | 'queued'`（进 `host.turn.accepted`
  诊断属性）；附件经既有 `attachmentsOverride` 参数传入，不再碰
  Composer 暂存。
- **快照原子性**：复用 edit-resend 的模式（§3.1）——派发后立即
  `emitSnapshot()`，Webview 一次拿到新用户消息、submitting turn 与
  缩短后的队列，无中间态。
- **逐条**：一次只派发一条；下一条等这一条到达 completed 再派发。
- **调用点**：`emitTurnState` 终态分支之后（微任务调度，避免在终态
  发射的同步栈内重入 `handleSend`）、`queue.add` 接受后、
  `queue.resume` 后。不需要挂交互结算点——`interactions.endTurn`
  在终态前已清空本回合交互（§3.1）。

### 4.4 派发失败与暂停态

- **瞬态守卫失败**（`settingsUpdate` 在途、`sessionOperationInProgress`
  等）：`queuePaused = 'dispatch-blocked'` + `runtime.diagnostic`
  （warning），消息**留在队列**；banner 给"立即发送"重试。
- **派发出去的回合失败**（turn failed）：该消息已进转录，走既有
  `turn.error` / Regenerate 恢复路径；**剩余队列**转
  `queuePaused = 'turn-failed'`，不级联。
- 与任务描述"失败转普通 Composer 草稿"的取舍：**不转草稿，留在
  暂停队列**。理由：(a) 转草稿会覆盖用户可能正在输入的内容；
  (b) 队列本身可编辑可删除（切片 3），"落地为可编辑状态"的需求已被
  覆盖；(c) 保留队列让"立即发送"重试无需用户重新组织消息。

### 4.5 Stop 语义

Stop 中断当前回合（既有 `handleStop` → interrupted 终态）→ 队列
保留、`queuePaused = 'stopped'`。队列区 banner：
"N queued — paused after stop"，动作 **Send now**（`queue.resume`）/
**Clear**（`queue.clear`）。比"Stop 即清空"或"Stop 后照发"都安全：
用户 Stop 往往意味着计划变了，排队消息可能要改。

### 4.6 Reload 边界（与 daemon 收尾 A4 的关系）

- **第一版：Host 内存，Reload 丢失。**队列区常显一行弱化小字
  "Queue is kept in this window only"作为丢失预告（Reload 后无法
  事后提示，只能事前）。
- **为什么不先做持久化**：跨 Reload 队列要有意义，前提是 in-flight
  回合本身跨 Reload 存活并可对账（A4 基础档，
  `daemon-feature-opportunities.md` §A4）——否则恢复出来的队列挂在
  一个状态未知的会话上。A4 先行是既定顺序。
- **A4 之后的增强（登记不实现）**：队列持久化到 `workspaceState`
  （仅文本 + 附件元数据，与恢复检查点同级），Reload 后恢复为
  **暂停队列**（`dispatch-blocked` 展示形态），绝不自动派发；附件
  负载不持久化，恢复后的条目附件降级为"仅元数据、不随发"并在卡片
  上标注。

### 4.7 队列 UI（参照 Cursor 排队体验，保留 DroidVisX 暖色体系）

- **位置**：转录尾部之后、Composer 上方，随对话滚动（Cursor 的排队
  消息同位）。视觉上是"即将成为对话一部分"的延伸区。
- **卡片样式**：弱化的用户气泡（降低不透明度/虚线边框，具体 token
  沿用 `--dvx-*` 体系，`src/webview/assistant/styles.css`），左上角
  "Queued" 徽标，正文文本 + 附件 chips（元数据渲染，同已发送消息的
  chip 组件），右上角删除按钮（切片 3）。
- **编辑**（切片 3）：点击卡片原地展开为多行 textarea（Enter 保存 →
  `queue.update`，Escape 取消）；第一版编辑只改文本，不改附件
  （附件负载在 Host，改附件需要另一套暂存语义，登记为后续增强）。
- **暂停 banner**：队列区顶部，文案按 `QueuePausedReason` 区分，
  动作 Send now / Clear。
- **Composer**：turn 活跃时不再禁用输入；hint 从"Stop before
  sending"改为"Will send after the current turn finishes"；发送按钮
  保持可用（图标可加排队暗示）。Stop 按钮行为不变。
- **可访问性**：队列区 `role="list"` + 卡片 `role="listitem"`；
  入队/派发/暂停经 `aria-live="polite"` 播报；删除/编辑可键盘触达。

### 4.8 与编辑重发（edit-resend）的互斥

- **turn 活跃时**：`handleEditResend` 现状即拒绝（busy），不变。
- **队列非空时（含暂停态）**：`handleEditResend` 新增守卫
  `queuedPrompts.length > 0` → 拒绝 busy + 既有
  `edit-resend-blocked` 诊断（文案补充"clear the queue first"）。
  理由：edit-resend 会 rewind-fork 采纳新会话，队列语义绑定旧会话
  线；自动带队列进 fork 的语义太隐晦，丢弃又太激进——让用户显式
  清空或发完队列最诚实。
- **编辑态（editStage）打开时入队**：允许。editStage 是独立暂存区
  （`stage: 'edit'`），与 Composer 暂存互不影响；入队只消费 Composer
  暂存。
- 反向：队列派发不检查 editStage——派发启动新回合后，用户在编辑卡
  上点重发会被 busy 拒绝，这与现状"turn 活跃时编辑重发被拒"一致。

## 5. 分层改动面

### 5.1 Bridge（`src/shared/` + `src/webview/bridge/`）

新消息（命名沿用仓库"域前缀 + camelCase 动词"风格，如
`turn.editResend` / `attachment.remove`）：

**W→H（5 条）**

```ts
// 共享常量
export const MAX_QUEUED_MESSAGES = 10;
export const QUEUE_PAUSED_REASONS =
  ['stopped', 'turn-failed', 'dispatch-blocked'] as const;

interface QueueAddMessage {
  type: 'queue.add';
  sessionId: string;
  queueId: string;        // isId；派发时复用为 turnId
  text: string;           // 1 ≤ len ≤ MAX_TURN_TEXT_LENGTH
}
interface QueueUpdateMessage {
  type: 'queue.update';
  sessionId: string; queueId: string; text: string;  // 同上界
}
interface QueueRemoveMessage {
  type: 'queue.remove'; sessionId: string; queueId: string;
}
interface QueueResumeMessage {
  type: 'queue.resume'; sessionId: string;
}
interface QueueClearMessage {
  type: 'queue.clear'; sessionId: string;
}
```

**H→W（1 条状态推送 + snapshot 新字段）**

```ts
interface QueuedMessageSummary {
  queueId: string;
  text: string;                                    // 全文，编辑需要
  attachments: readonly SentAttachmentSummary[];   // 既有有界投影
}
interface QueueStateMessage {
  type: 'queue.state';
  sequence: number;
  sessionId: string;
  items: readonly QueuedMessageSummary[];          // ≤ 10
  paused: QueuePausedReason | null;                // closed enum
}
// HostSnapshotMessage 增加：
//   queue: { items: readonly QueuedMessageSummary[];
//            paused: QueuePausedReason | null }
```

校验（双侧对称）：

- `src/shared/validateMessage.ts`：5 个 parse 函数，照 `parseTurnSend`
  模式（`hasExactKeys` + `isId` + 文本长度界）。
- `src/webview/bridge/validateHostMessage.ts`：`queue.state` 与
  snapshot `queue` 字段校验——items 数组 ≤ `MAX_QUEUED_MESSAGES`、
  每条文本 ≤ `MAX_TURN_TEXT_LENGTH`、attachments 沿用既有
  `SentAttachmentSummary` 校验、`paused` closed enum。
- 测试：`validateMessage.test.ts` / `validateHostMessage.test.ts`
  各加正反用例（超长文本、超量 items、未知 paused 值、多余键）。

触点与规模：`bridgeMessages.ts` ≈ +100 行；`validateMessage.ts`
≈ +130 行；`validateHostMessage.ts` ≈ +90 行；两测试 ≈ +200 行。

### 5.2 Extension Host（`src/extension/ChatController.ts`）

| 触点 | 内容 |
| --- | --- |
| 状态字段 | `queuedPrompts` / `queuePaused`（§4.1） |
| 消息分发 | `handleMessage` switch 新增 5 个 case → `handleQueueAdd` / `handleQueueUpdate` / `handleQueueRemove` / `handleQueueResume` / `handleQueueClear` |
| 派发器 | `maybeDispatchQueue()`（守卫见 §4.3）+ `emitQueueState()` |
| 终态钩子 | `emitTurnState` 终态分支后微任务调度派发；interrupted / failed 分支置 paused |
| `handleSend` | `kind` 联合类型加 `'queued'`（仅诊断属性，控制流不变） |
| 丢弃点接线 | 会话切换 / 新会话 / fork / compact / edit-resend 采纳 / runtime 重建的既有收口处调用 `discardQueue(reason)`（清队列 + 诊断 + `emitQueueState`） |
| edit-resend 互斥 | `handleEditResend` 守卫加 `queuedPrompts.length > 0`（§4.8） |
| 诊断码 | `queued-messages-discarded`（info）、`queue-dispatch-blocked`（warning） |

规模：`ChatController.ts` ≈ +280 行；`ChatController.test.ts`
≈ +250 行（入队保序、completed 自动派发、Stop/failed 暂停、竞态
入队即派发、会话切换丢弃、edit-resend 互斥、容量上限）。

### 5.3 Webview（`src/webview/assistant/`）

| 触点 | 内容 | 规模 |
| --- | --- | --- |
| `store.ts` | queue 状态切片：消费 `queue.state` 与 snapshot `queue` 字段（快照权威覆盖） | ≈ +70 行 |
| `App.tsx` | `canSendMessage` 放开 turn 活跃态；`handleSend` 按 turn 状态路由 `turn.send` / `queue.add`（乐观入队 + 权威回填）；`queue.*` 操作回调 | ≈ +60 行 |
| `Thread.tsx` | 队列卡片列（转录尾部/Composer 上方）、Queued 徽标、附件 chips、删除按钮、内联编辑（切片 3）、暂停 banner、Composer hint 改文案 | ≈ +180 行 |
| `styles.css` | 弱化气泡、徽标、banner、编辑态样式（沿用 `--dvx-*` token） | ≈ +80 行 |
| `App.test.tsx` | 路由与渲染用例 | ≈ +120 行 |

> 物理互斥提醒：`src/webview/assistant/` 当前有并行代理在编辑
> `Thread.tsx` / `App.tsx` / `styles.css`，实现时按 AGENTS.md 错峰，
> 不与其并发改同一文件。

### 5.4 Runtime（`src/runtime/`）

**零改动**（方案甲的核心收益，§1）。

总量级估计：≈ 1.5–2.5k 行含测试，2.5–3.5 人天（与
`daemon-feature-opportunities.md` §A1 的 1.5–3 天估计一致，UI 编辑
切片略增）。

## 6. 边界与失败路径汇总

| 边界 | 处理 |
| --- | --- |
| 排队文本超长 / 空 | 双侧校验拒绝（`MAX_TURN_TEXT_LENGTH`，同 `turn.send`） |
| 队列容量 | `MAX_QUEUED_MESSAGES = 10`，双侧一致：Webview 禁入队并提示，Host 拒绝兜底 |
| 附件 | 入队即消费暂存（每条 ≤ `MAX_PENDING_ATTACHMENTS = 8`）；Bridge 只传元数据 |
| 附件内存上界 | 最坏 10 条 × 8 附件 × 4 MB 图片 ≈ 320 MB Host 内存——登记为已知边界；实际图片经既有暂存上限约束，且排队场景附件通常少。若实测成问题，后续给队列加总字节预算（同 session 图片预算模式） |
| 竞态：入队时 turn 恰好终态 | Host 接受并立即派发（§4.2） |
| 竞态：编辑/删除时该条恰好被派发 | Host 权威：queueId 不在队列即静默忽略 + debug 日志；Webview 以 `queue.state` 回填纠正 |
| 派发被瞬态守卫阻塞 | paused('dispatch-blocked') + 诊断 + 手动恢复（§4.4） |
| 派发出去的回合失败 | 该条走既有 turn.error 恢复；剩余队列 paused('turn-failed')（§4.4） |
| Stop | 队列保留 + paused('stopped') + banner（§4.5） |
| 会话切换 / fork / compact / edit-resend / runtime 重建 | 丢弃队列 + 诊断（§4.1） |
| edit-resend 与队列互斥 | 队列非空时 edit-resend 拒绝 busy（§4.8） |
| Reload Window | 丢失；队列区事前提示；持久化列为 A4 后增强（§4.6） |
| 断连（connection ≠ connected） | 不派发（守卫）；队列保留，重连后下一个触发点恢复 |

## 7. 验收标准与三步切片

**整体验收**（全部切片完成后）：

1. Turn 运行中连续发送 3 条消息 → 依次显示为排队卡片，当前回合
   completed 后按序自动逐条发出，每条都是完整回合（流式、工具、
   权限交互正常）。
2. Stop 后队列保留且不自动发，banner 可一键继续或清空。
3. 排队卡片可删除、可编辑文本。
4. 双侧校验测试覆盖新消息的正反用例；`pnpm` 类型检查、测试、build
   通过；打包装入 Cursor 后肉眼验证上述行为（AGENTS 交付环 7）。
5. `implementation-status.md` 同批更新。

**切片 1：排队 + 自动发送**（Bridge `queue.add`/`queue.state` +
snapshot 字段 + Host 队列与派发器 + Composer 路由 + 最小可见队列
计数/只读列表）

- 完成判据：turn 运行中 Enter 不再被丢弃，`host.turn.accepted` 出现
  `kind: 'queued'`；两条排队消息在 completed 后保序自动发出；Stop 后
  不自动发（暂停态先以 hint 文案呈现）；会话切换丢弃队列且有诊断；
  Bridge 双侧校验测试通过。Bridge 消息形状（含切片 3 要用的
  update/remove）在本切片一次定稿（AGENTS：先稳定共享契约）。

**切片 2：队列 UI 展示**（排队卡片列 + 附件 chips + 暂停 banner +
"仅本窗口"提示 + 可访问性）

- 完成判据：排队卡片按设计样式出现在转录尾部/Composer 上方并随派发
  逐条消失；Stop 后 banner 出现且 Send now / Clear（`queue.resume` /
  `queue.clear`）行为正确；Reload 后队列消失且无残留 UI；键盘与
  aria-live 播报可用。

**切片 3：队列编辑 / 删除**（`queue.update` / `queue.remove` 接线 +
卡片内联编辑）

- 完成判据：单条删除即时生效；内联编辑保存后 `queue.state` 回填新
  文本、派发使用新文本；对已派发条目的编辑/删除被静默忽略且 UI 被
  权威状态纠正；edit-resend 在队列非空时拒绝并有诊断提示。

## 8. 明确不做（第一版）

| 项 | 判定 | 依据 |
| --- | --- | --- |
| daemon 原生队列对接（方案乙） | 不做，登记为 A4 完整档后的顺势增强 | 门面无入队 API、排队回合无流可观察（§3.2） |
| 跨 Reload 持久化 | 不做，A4 基础档落地后按 §4.6 增强 | 依赖 in-flight 回合跨 Reload 对账 |
| Steering（当前回合中途注入） | 不做，文案如实"下一回合执行" | Host 层排队的结构性限制（§3.3） |
| 排队消息的 Mode/Model 覆写 | 不做，每条按派发时会话设置执行 | 会话级语义，与 message-card-design §1.4 同口径 |
| 排队卡片编辑附件 | 不做（编辑只改文本） | 附件负载在 Host，需另一套编辑暂存语义 |
| **排队消息的附件支持** | **建议纳入第一版** | 入队即消费暂存是最简一致的语义；若不纳入，反而要加"暂存非空时禁止入队"的更差交互，且复用面全部现成（`takePendingAttachments` / `SentAttachmentSummary`） |

## 9. 风险登记

1. **`Thread.tsx`/`App.tsx` 并行编辑冲突**：实现窗口内另一代理正在
   改同一文件，必须错峰（AGENTS 物理互斥）。
2. **快照体积**：queue 字段最坏 10 × 200k 字符文本进 snapshot——与
   转录同量级，既有 `host.perf.snapshot` 字节记账会暴露实际影响；
   排队文本是用户手打的，实际远小于上界。
3. **暂停态的可发现性**：Stop/failed 后队列静默暂停，若 banner 不够
   醒目用户会以为消息丢了——切片 2 验收显式覆盖。
4. **附件内存上界**（§6）：登记为已知边界，超标再加预算。
