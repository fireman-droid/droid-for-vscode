# Daemon 架构落地后的功能机会盘点

> 状态：现行调研结论。排期指针已合入 `HANDOVER.md` §3；§B3 的
> fail-closed 判定已被 `mcp-permission-persistence-research.md` 推翻
> （见 §B3 勘误注与 §3 表第 10 行）。
>
> 调研日期：2026-08-12。只读调研产物，未改动任何生产代码。
>
> 证据基线：
>
> - **daemon 落地状态**：`docs/product/implementation-status.md`（2026-08-12 核对版，
>   daemon Phase 1/2/3 条目与验证状态遗留说明）；`src/runtime/daemon/` 全部源码；
>   `src/extension/extension.ts` 装配代码。
> - **SDK 公开面**：`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`
>   类型定义与 `chunk-5UXINOXG.mjs` 实现（0.7.0），逐项标注行号。
> - **既有调研**：`daemon-architecture-design.md`、`daemon-implementation-plan.md`、
>   `cli-coverage-assessment.md`（10 条缺口与用户 2026-08-12 拍板，
>   见 `HANDOVER.md` §3「CLI 覆盖度缺口判定」）。
>
> 纪律：不发明 Droid/SDK 能力；每条结论标注证据来源（文件路径 + 行号或章节）。
> 与 `cli-coverage-assessment.md` 的区别：那份文档回答"CLI 有什么我们没有"，
> 本文回答"daemon 常驻之后，哪些功能从架构上不可能变成可能、哪些既有妥协
> 可以做得更好"。

---

## 0. 现状摘要：daemon 化落地到哪了

截至本文核对（证据：`implementation-status.md`「运行架构」节与验证状态）：

| 层 | 状态 |
| --- | --- |
| Phase 0 凭据 | 已落地。`readFactoryAccessCredential()` 黑盒复用 CLI 登录态，零配置 |
| Phase 1 只读 sidecar | 已落地。归档/取消归档/跨会话内容搜索走持久 ws 连接（`src/runtime/daemon/DaemonSessionCatalog.ts`） |
| Phase 2 执行链路 | 已落地但**默认关闭**。`droidvisx.runtime.mode = daemon` 时经 `createSdkSession` seam 注入 `createDaemonDroidSession`（`src/runtime/daemon/createDaemonDroidSession.ts`）；已知 fail-closed：模型目录 unavailable、浏览器 MCP OAuth 不可用 |
| Phase 3 Reload 存活 | 基础设施已落地。脱管共享 daemon（`daemonLifecycle.ts` `startDetachedDaemon`）+ 发现文件（`daemonDiscovery.ts`）+ 跨窗口租约（`sessionLease.ts`）+ `droidvisx.shutdownDaemon`；daemon 侧存活由 `probe-reload-survival.mjs` 实证 PASS |
| **遗留** | Webview 重连对账 UI 未接线（in-flight 回合活流重接、pending 权限重弹）；`sessions.getMessages` 在探针中两次返回异常待核对；版本漂移仅记录不强制 |

关键架构事实（后文反复引用）：

1. **会话真正寄生在 daemon 里**。`ConnectedDroidSession.detach()` 注释原话
   "The session keeps running in the daemon."（`index-D_SzTnFR.d.ts` L107713）；
   我们的 `close()` 已映射为 `detach()`（`createDaemonDroidSession.ts` L275–280）。
2. **一个会话同时只跑一个 turn**。`stream()` 在已有活跃流时抛
   `ConcurrentStreamError`，注释明确"session notifications carry no turn
   identifier"（`index-D_SzTnFR.d.ts` L107768–107777）。
3. **公开门面（`ConnectedDroid`）没有"只观察不发话"的流**。`stream(prompt)`
   一定携带一条新消息（`chunk-5UXINOXG.mjs` L9008 `streamFromClient`）；逐 token
   观察一个已在跑的回合需要降级到公开导出的 `DaemonSessionController`
   事件层（`sessionNotification` / `droidWorkingStateChanged` 等，
   `index-D_SzTnFR.d.ts` L113840–113916）。这是 A2/A4 完整档共同的技术前提。
4. **daemon 模式默认关闭**，默认 `process` 路径行为零变化。本文所有"依赖
   daemon"的功能，隐含前提都是 daemon 模式转正（或至少对该功能强制走
   daemon 连接）。

---

## 1. A 类：daemon 解锁的全新功能

### A1. Turn 运行中排队消息（重点，用户已定为主线发版前最后一步）

**现状**：GUI 明确不支持——Turn 运行时 Composer 提示先 Stop
（`implementation-status.md` §生产已接通 1）；`ChatController.handleSend`
在 `isTurnActive(this.turn)` 时静默丢弃（`src/extension/ChatController.ts`
L904–915）。

**SDK 能力证据（逐条核实）**：

1. **daemon 侧有原生队列**。`daemon.add_user_message` 参数含
   `queuePlacement?: QueuePlacement`（`end_of_turn` / `end_of_loop`，枚举定义
   `index-D_SzTnFR.d.ts` L92–95；请求 schema L55384–55483 含 text/images/files/
   queuePlacement/skipAgentLoop）。`DaemonSessionController.addUserMessage`
   的实现（`chunk-5UXINOXG.mjs` L16576–16674）：droid 空闲时立即执行；
   **busy 时进入队列**（`queueUserMessage` + `messageQueued` 事件），
   kind 为 `daemon_queued_discardable`（end_of_turn）或
   `daemon_queued_end_of_loop`。
2. **队列是 daemon 持久状态**。`daemon.load_session` 结果含 `queuedMessages`
   （requestId/text/images/files/queuePlacement，`index-D_SzTnFR.d.ts`
   L109827–109860）——重连/reload 后可取回。
3. **队列可编辑/删除**。公开门面 `sessions.resolveQueuedMessage(sessionId,
   { requestId, action: update_queue | delete })`（`index-D_SzTnFR.d.ts`
   L106209；实现 `chunk-5UXINOXG.mjs` L22849–22852、L16675–16697）。
4. **队列被丢弃时有通知**：控制器事件 `queuedMessagesDiscarded`
   （`index-D_SzTnFR.d.ts` L113907–113911）。

**但有两个关键的公开面缺口（决定切片形态）**：

- **门面没有"入队"入口**。`ConnectedDroidSession` 只有 `stream(prompt)`
  （活跃流期间抛 `ConcurrentStreamError`）；`createSessionOperationsResource`
  只暴露 `resolveQueuedMessage`（改/删），不暴露 add
  （`chunk-5UXINOXG.mjs` L22810–22872 全表核对）。要用 daemon 原生队列，
  必须绕过门面、直接持有公开导出的 `DaemonSessionController`（或低层
  `DaemonClient`）调用 `addUserMessage`——意味着放弃 `connectToDaemon`
  门面、自己组装控制器（连接/认证/重连逻辑要自己接）。
- **排队消息被 daemon 自动执行时，没人能收到它的流**。当前 turn 完成后
  我们的 `stream()` 生成器随 `agent_turn_completed` 结束；daemon 随即
  出队执行下一条，其增量事件只以 session notifications 广播——门面层
  没有可再挂接的流（同 §0 事实 3）。也就是说 **daemon 原生排队的
  "排队后自动跑"与我们"每回合一个 stream 生成器"的消费模型不兼容**，
  除非同时做活流观察通道（= A4 完整档）。

**因此给出两个方案**：

**方案甲：Host 层排队（推荐，主线发版切片）**。排队状态放在
`ChatController`：Turn 运行中收到发送请求→入 Host 队列（有界，建议 ≤5 条，
含文本+暂存附件）→当前回合到达终态（completed/interrupted/failed）且无
pending 交互时，自动经现有 `handleSend` 路径派发下一条——每条排队消息
都是一个普通回合，事件走现有 stream 消费循环，**Runtime 层零改动，
process 与 daemon 两种模式同样工作**（这点很重要：当前默认模式仍是
process，主线发版不应被 daemon 转正卡住）。

- Bridge 改动面（`src/shared/bridgeMessages.ts`，双侧校验对称）：
  - W→H：放宽/新增 `turn.queue { sessionId, turnId, text }`（或让
    `turn.send` 在运行中转为入队，倾向独立消息、语义显式）；
    `turn.queueRemove { sessionId, queueId }`。
  - H→W：`turn.queued { sessionId, items: [{ queueId, text, attachmentSummaries }] }`
    状态回发（沿用现有 `SentAttachmentSummary` 有界投影）。
- Host 改动面：`ChatController` 队列字段 + 终态派发钩子（`consumeTurn`
  终态处已有 `emitTurnState` 收口点）+ 三个守卫（pending 交互挂起不派发、
  Stop 时队列策略、会话切换/rewind/compact 丢弃队列并诊断回报）。
  附件语义：入队时即消费 Composer 暂存（与 `handleSend` 相同的
  `takePendingAttachments` 时机），避免两条排队消息争用暂存区。
- Webview 改动面：Composer 运行中不再提示"先 Stop"，Enter 变为入队；
  排队消息渲染为对话尾部的"待发送"用户气泡（弱化样式 + 移除按钮）。
  （注意 `src/webview/assistant/` 当前有并行代理在编辑，实现时按
  AGENTS.md 物理互斥错峰。）
- Stop 语义建议：Stop 中断当前回合并**保留**队列但暂停派发，同时把
  队列首条文本提示给用户（继续/清空二选一）；比"Stop 即清空"安全。
- 量级估计：1.5–3 天（Bridge+Host+UI+测试；无 Runtime 改动）。
- 风险：低。全部在自有代码内；唯一语义分叉是 CLI 的排队消息可参与
  steering（`QueuedUserMessageDisplayGroup.Steering`，L112061–112064），
  Host 层排队做不到"当前回合中途注入"，只能"下一回合执行"——如实
  在 UI 文案上表述为 "will send after current turn"。
- 恢复语义：队列建议持久化到 `workspaceState`（仅文本与附件元数据，
  与恢复检查点同级），reload 后作为"未发送草稿队列"恢复，不自动派发。

**方案乙：daemon 原生队列（后续增强，不做主线发版）**。直接持有
`DaemonSessionController` 调用 `addUserMessage(queuePlacement)`，队列
进 daemon（reload 存活、`load_session` 可取回、`resolveQueuedMessage`
可改删、多客户端一致）。代价：绕开 `connectToDaemon` 门面自管控制器；
必须同时解决排队回合的活流观察（A4 完整档）；且只在 daemon 模式可用。
量级 5–8 天起。**建议：登记为 A4 完整档落地后的顺势增强，不阻塞 A1。**

**结论：建议做（方案甲），排主线发版前最后一步（与用户既定决策一致）。**

### A2. 跨窗口共享同一会话（两个窗口看同一会话的实时流）

**架构上确实从"不可能"变成"可能"**：会话在 daemon 内，多客户端各自
`load_session` 后都会收到该会话的 session notifications（daemon 协议本身
是多客户端的，Factory Desktop 与 CLI 共用）。

**但三个证据都指向"贵且不值"**：

1. SDK 明示多客户端替换操作不协调："Daemon replacement locking does not
   coordinate separate clients."（`daemon-architecture-design.md` §1.6 引
   SDK 文档原文）；我们为此自建了**互斥**租约——`sessionLease.ts` 明确
   禁止两个窗口 attach 同一会话（`createDaemonDroidSession.ts` L69–85
   resume 前必须拿租约）。共享观看要把租约改造成"一写多读"模型。
2. 观察者的实时流需要 §0 事实 3 的控制器级事件通道（门面无 observe-only
   流），这是 A4 完整档的超集：不但要重建历史 + 状态占位，还要长期挂着
   逐 token 通知并处理另一窗口触发的 rewind/compact/fork 换会话。
3. 价值低：DroidVisX 是单人本地工具（`HANDOVER.md` §1 定位），"两个窗口
   盯同一会话"是罕见姿势；现状"归档搜索可见 + 另一窗口不可 attach 有
   明确提示"已经不产生数据损坏。

- 价值：低。实现量级：大（租约模型改造 + 观察者 UI + 控制器事件通道，
  7 天+）。依赖：A4 完整档、daemon 模式转正。风险：SDK 未对多客户端
  广播语义做承诺，需先探针实证两客户端同时 load 同一会话的通知行为。

**结论：建议不做（近期）。若未来做，先写只读探针验证双客户端通知广播。**

### A3. 后台任务通知中心（窗口关了任务还在跑，跑完全局通知）

**daemon 解锁的部分是真实的**：任务寄生在脱管 daemon 里，窗口 reload/
关闭后回合继续跑完——已由 `probe-reload-survival.mjs` 实证
（gen-A 死后 workingState running→idle，`implementation-status.md`
Phase 3 验证条目）。缺的只是"跑完后告诉用户"。

**通知的信息来源（两条公开路径，均已核实）**：

- 轮询：门面 `sessions.listOpened()` 返回每个已打开会话的
  `workingState`（`index-D_SzTnFR.d.ts` L106183–106190、L109879–109889）。
  Host 侧对"本窗口拥有租约但当前未 attach"的会话轮询 running→idle 迁移，
  触发 `vscode.window.showInformationMessage`（点击聚焦面板并切到该会话）。
- 订阅：公开导出的 `DaemonSessionController` 事件
  `droidWorkingStateChanged`（L113858–113861）——推送式，但要自管控制器
  （同 A1 方案乙的代价）。

**诚实边界**：通知的宿主是扩展主机。**所有 Cursor 窗口都关掉时没有任何
进程能发通知**（daemon 不会推 OS 级通知，SDK 无此能力）。所以准确的
产品定义是："关掉发起窗口/reload 后，任务在后台跑完，任一存活窗口
（或重开的窗口）收到完成通知"——不是脱离编辑器的系统级通知中心。

- 价值：中。与 A4 基础档天然互补（reload 回来看到"已完成"占位 +
  完成通知是同一状态源）。
- 实现量级：中（轮询版 1–2 天：Host 轮询器 + 通知 + 会话跳转；订阅版
  另计）。轮询间隔建议 ≥5s，只在"有 in-flight 标记的会话"存在时启动。
- 依赖：daemon 模式（任务存活本身就依赖脱管 daemon）；A4 的 in-flight
  标记（知道该盯哪个会话）。
- 风险：低。`listOpened` 是已实证可靠的路径（探针的存活判定就取自它）。

**结论：建议做，但排在 A4 基础档之后顺势做（共享同一 in-flight 状态源）。**

### A4. Reload 期间活流重连 + 待处理权限重弹（已知收尾边界）

这是 daemon 化自己的收尾项（`implementation-status.md` 运行架构
未勾选项"Webview 重连对账 UI"）。确认实现路径如下，分两档：

**基础档（公开门面内可达，建议做）**——照
`daemon-implementation-plan.md` §3.5 的"状态对账"模型：

1. reload 后按既有 in-flight 标记 `sessions.resume(sessionId)`。
2. **pending 权限/提问自动重弹已由 SDK 保证**：`load_session` 返回
   `pendingPermissions` / `pendingAskUserRequests`（`index-D_SzTnFR.d.ts`
   L109723–109824），控制器在 load 时经
   `replayBufferedPermissionOnLoad` / `replayBufferedAskUserResponses`
   把它们**补投给 resume() 注册的 handler**，并带 `isRestored: true`
   标记（`chunk-5UXINOXG.mjs` L16323–16459 实证；`PendingPermission` /
   `PendingAskUserRequest` 的 `isRestored` 字段见 `index-D_SzTnFR.d.ts`
   L112004、L112017）——也就是说走我们现有的
   `runtimeInteractions` → `pendingInteractionCoordinator` →
   Interactions UI 链路，权限卡片会自己弹出来，Host 只需保证 resume 时
   handler 已就位、且交互结算的会话/回合绑定校验放行 restored 请求。
3. 活跃回合的呈现：`load_session` 结果含 `isAgentLoopInProgress` 与
   `workingState`（L109825–109826）；running 时 Webview 显示"生成中"
   占位（复用现有 PendingResponse 状态），Host 轮询 `listOpened()`
   到 idle 后经 `get_session_messages`（或现有 history loader 路径）
   重载时间线，完成消息整条落地。**不追求逐 token 打字机恢复**——
   SDK 不补发断线期间的流增量（`daemon-implementation-plan.md` §2.7），
   这是对账模型的既定边界。
4. 中断入口：占位期间 Stop 按钮映射到
   `droid.sessions`…拿到句柄后 `interrupt()`（resume 后句柄可用）。

- 改动面：`ChatController` 恢复流程（消费 in-flight 标记 + resume 分支 +
  轮询收口）、Webview 占位与"任务仍在后台运行"状态条、`FactoryDroidRuntime`
  需要一个"resume 但不立即发话"的目标形态（现有 seam 只能新建回合——
  `implementation-status.md` Phase 3 遗留说明 (2) 如实登记了这一点，
  这是本切片最大的一块）。
- 已知技术债要先清：探针中 `sessions.getMessages()` 两次返回异常
  （遗留说明 (1)），本切片动手前先用只读探针核对 getMessages 的正确
  取数方式（参数形态 / limit 语义），否则时间线重载没有可靠通道
  ——兜底是继续走现有 `FactorySessionHistoryLoader`（短进程
  loadSession），功能等价只是慢。
- 量级：3–5 天。依赖：daemon 模式。风险：中（Runtime seam 扩展 +
  restored 交互与现有世代校验的对齐）。

**完整档（活流逐 token 重接，建议缓）**：需要控制器级
`sessionNotification` 订阅充当 observe-only 流（§0 事实 3），把
`normalizeSdkEvent` 的输入从 stream 生成器换成通知流。它同时是 A1
方案乙与 A2 的前置。单独为"reload 后那几秒的打字机效果"不值得；
等 A1 方案乙或 A2 真的立项时一并做。

**结论：基础档建议做——它是 daemon 模式从"实验性"转正的门槛切片；
完整档建议缓。**

### A5. 多工作区/多项目会话路由

**daemon 提供的通道（已核实）**：`sessions.list` 全局返回并带
`cwd`/`repoRoot`（`DaemonSessionSummary`，`index-D_SzTnFR.d.ts`
L107674–107682）；跨会话搜索天然全局（Phase 1 已在 UI 中把异工作区
命中只读展示，`DaemonSessionCatalog.search` 不做工作区过滤——
`DaemonSessionCatalog.ts` L97–101 注释即此设计）；另有
`workspace.changeDirectory` / `validateDirectory` / `checkTrust` RPC
（L106232–106241）；`sessions.create({ cwd })` 可指定任意目录。

**但产品面上的缺口在扩展自身**：当前 Host 固定
`workspaceFolders[0]`（`implementation-status.md` 部分完成表
"Workspace：多根工作区选择未实现"），会话列表、租约、恢复存储、
diff 打开全部按单根假设。真正的"多项目路由"是 Host 层的工作区模型
改造，daemon 只是让"看见别的项目的会话"变得容易。

- 价值：低-中（单人单项目为主的使用画像；搜索已给了跨项目可见性）。
- 实现量级：大（Host 工作区模型 + 每根一个 cwd 的会话目录 + 信任/
  安全边界重审；5 天+）。
- 依赖：无硬依赖 daemon 转正（列表/搜索走 sidecar 即可），但完整体验
  （跨项目 resume）需要 daemon 执行模式。
- 风险：中——路径安全校验（`belongsToWorkspace`、文件 diff 的包含关系
  复验）都要按多根重写，出错即越权读文件。

**结论：建议缓（V1 主链路完成后再评估；先保留搜索结果的只读展示现状）。**

---

## 2. B 类：既有功能升级为依赖 daemon 的机会

### B1. 会话收藏（现为 CLI 私有 `.favorites` 文件契约）

**核实结果：daemon 没有给收藏任何新通道。**

- `DaemonDroidMethod` 枚举全文核对（`index-D_SzTnFR.d.ts` L44965–45060）：
  无任何 favorite 相关 RPC。
- daemon 列表行 `DaemonSessionSummary`（L107674–107682）**不含**
  `isFavorite`；`isFavorite` 只出现在 Node 入口 `listSessions` 的
  `SessionMetadataSchema`（L105497–105531）——而那条路径本来就是直接
  读 `~/.factory/sessions` 磁盘文件 + `.favorites`（`node.mjs`
  L4108–4133 `listSessions` 实现：`loadFavorites(sessionsDir)` +
  目录扫描，无子进程）。
- 也就是说：收藏的读与写在 daemon 世界里同样只能走私有文件契约；
  现有实现（`src/runtime/sessionFavorites.ts` 原子写 + fail-closed）
  已经是该契约下的正确形态。

**结论：建议不做。维持现状与"非官方契约"标注；daemon 不改善一致性。**

### B2. 恢复/历史加载速度（daemon 常驻内存 vs 每次冷读）

**先纠正一处旧文档的偏差**：`daemon-implementation-plan.md` §1.1-3 说
`FactorySessionCatalog` "每次查询都拉起一次性进程"——实测不准确：
Node `listSessions` 是**直接磁盘读**（`node.mjs` L4108 起，扫目录 +
解析 .jsonl 头行），无进程启动成本。真正贵的是**历史加载**：
`FactorySessionHistoryLoader` 每次 `loadSession` 都新建
`ProcessTransport + DroidClient`（`src/runtime/history/FactorySessionHistoryLoader.ts`
L46–67），即一次完整的 `droid exec` 子进程冷启动——真实数据点：锚点
会话 loadSession 3455ms（`implementation-status.md` 切片③第一段冒烟）。

**daemon 替代通道**：`sessions.getMessages`（`daemon.get_session_messages`，
门面 L106203）走常驻连接零进程成本；另有 `daemon.warmup_cache`
（L45058，语义未验证）。**已知障碍**：探针中 getMessages 两次返回异常
（Phase 3 遗留 (1)），且返回形状是 `SessionMessage`（daemon 消息 DTO），
与现有 `projectSessionHistory` 消费的 `loadSession` 响应形状不同，
投影器要做一次适配与等价性验证（历史投影是恢复对账的信任基座，
改错的代价高）。

**另一个事实**：感知层面的痛点已被"恢复提速（快照先行）"切片大幅缓解
（早期快照先渲染、权威历史后台替换，`implementation-status.md`
2026-08-12 条目）——冷读成本现在藏在后台。

- 价值：中（daemon 模式下切会话/reload 后的权威历史刷新从秒级降到
  毫秒级；process 模式无收益）。
- 实现量级：中（getMessages 探针核对 0.5 天 + 投影适配与等价性测试
  1–2 天）。
- 依赖：daemon 连接（sidecar 即可，不必等执行模式转正）；A4 基础档
  同样需要 getMessages 核对——**两件事共享同一个前置探针**。
- 风险：中（历史投影等价性；getMessages 分页/limit 语义未知）。

**结论：建议缓——把"getMessages 探针核对"提前与 A4 合并做；确认通道
可靠后再决定是否把 history loader 切过去。**

### B3. MCP 持久权限管理（backlog"可以有"项）

用户决策（`HANDOVER.md` §3 优先级 2）：先调研公开 SDK/daemon 是否有
对应渠道，有则排期，无则判 fail-closed 写入 HANDOVER 表。

**核实结果：没有公开渠道。**

- `DaemonDroidMethod` 全枚举核对（L44965–45060）：MCP 相关只有
  config/toggle/auth 系列（`GET_MCP_CONFIG`、`UPDATE_MCP_CONFIG`、
  `TOGGLE_MCP_SERVER/TOOL`、`AUTHENTICATE_MCP_SERVER`、
  `CANCEL/CLEAR/SUBMIT_MCP_AUTH*`）。`CLEAR_MCP_AUTH` 清的是 OAuth
  凭据，不是工具权限授予记录。
- 全文检索 `toolPermission` / `persistedPermission` / `alwaysAllow`
  等关键词在 `index-D_SzTnFR.d.ts` 零命中（仅
  `autoRejectPermissionRequests` 会话选项，非管理面）。
- 即 `droid mcp permissions list/revoke/clear` 是 CLI 本地行为
  （大概率私有文件），daemon 协议不承载它。

daemon 常驻**没有**为此提供更自然的存储/查询位置。剩下的唯一路径是
仿照收藏的"私有文件契约"逆向 `~/.factory` 下的权限存储——那是另一次
独立调研 + 用户对"再背一个非官方契约"的明确拍板，超出本文范围。

**结论：建议不做（按用户既定决策判 fail-closed，写入 HANDOVER
fail-closed 表：「MCP 持久权限管理——公开 SDK/daemon 均无对应 RPC，
证据 `index-D_SzTnFR.d.ts` DaemonDroidMethod 枚举」）。如确有需求，
另立"私有文件契约"调研由用户拍板。**

> **勘误（2026-08-12，后续调研推翻本节结论）**：本节只核对了
> SDK/daemon RPC 面（该结论仍成立），但漏查了 CLI 命令面。
> [`mcp-permission-persistence-research.md`](./mcp-permission-persistence-research.md)
> 证实存在**官方渠道** `droid mcp permissions list/revoke/clear`
> （docs.factory.ai/harness/mcp 明文记载，本机实测可用），
> fail-closed 判定不成立。可做"只读列表（fail-soft 解析
> settings.json）+ 撤销走官方 CLI 命令"的切片。综合优先级表
> 第 10 行同此勘误。

### B4. 会话搜索/归档的增强空间

Phase 1 只用了 daemon 搜索能力的最小面。**未消费的公开参数**
（`DaemonSearchSessionsRequestSchema`，`index-D_SzTnFR.d.ts`
L58031–58057）：

- `kind: SessionSearchDocKind | 'all'`——按 message_text / document /
  tool_use / tool_result 分类检索（对应 CLI `droid search --kind`，
  `cli-coverage-assessment.md` §2.3 登记过该细粒度未纳入计划）；
- `updatedAfterMs` / `updatedBeforeMs` 时间窗；
- `limitHitsPerSession`（现在固定 1）与多片段展示。

归档侧：`DaemonSessionCatalog.listArchived` 现在取 200 行客户端过滤
（`DaemonSessionCatalog.ts` L13–14、L65–95），无分页；daemon `list`
的 `includeArchived` + limit 之外没有更细的服务端过滤，这块的增强
只能是 UI 分页/懒加载。

- 价值：低-中（搜索是低频动作；kind 筛选对重度用户有感）。
- 实现量级：小（Bridge 消息加可选枚举字段 + UI 筛选行，1 天内）。
- 依赖：现有 sidecar 即可。风险：低。

**结论：建议缓——排 V1 主链路之后的小打磨批次，与 tags 只读过滤
（见 B5）同批做性价比最高。**

### B5. 其他在代码里看到的妥协点与新通道

1. **daemon 模式模型目录 unavailable**（`createDaemonDroidSession.ts`
   头注释：daemon 门面报告 custom models 但缺 `supportedReasoningEfforts`，
   fail closed）。核对 `customModels.list`（`daemon.list_custom_models`，
   L106248–106252）返回形状后若确实无 efforts 字段，只能等 SDK 补；
   若有，则是 1 天内的补齐切片。**daemon 模式转正的门槛项之一，建议
   随 A4 一起核对。**
2. **daemon 模式浏览器 MCP OAuth 不可用**（同文件头注释：门面无
   `onNotification`）。但 `DaemonSessionController` 公开事件表里有
   `mcpAuthRequired` / `mcpAuthCompleted`（L113890–113895），且 daemon
   协议有完整 auth RPC 组（`SUBMIT_MCP_AUTH_CODE` 等）。补齐需要
   控制器级订阅（又是 §0 事实 3 的那扇门）。**daemon 模式转正门槛项，
   建议做（转正前）；若 A4 完整档立项则顺势覆盖。**
3. **tags 与 tool 启停有了自然通道**（backlog 低优先级项）：daemon 的
   `UpdateSessionSettingsOptions` 公开含 `tags` 与 `disabledToolIds`
   （`index-D_SzTnFR.d.ts` L106199）；`sessions.list` / `listOpened`
   行带 `tags`（L107680、L106189）。用户已把这两项拍在"计划末尾
   backlog"（`HANDOVER.md` §3 优先级 3/4）——本文只登记：**通道已
   具备、无需再调研，届时按拍板顺序直接开工即可。**
4. **每窗口私有 sidecar daemon 的资源冗余**：process 模式下每个窗口
   为归档/搜索拉一个 `--parent-pid` 私有 daemon（`extension.ts`
   L84–90）；Phase 3 的共享发现文件机制只在 daemon 模式启用。若 daemon
   模式转正，此冗余自然消失；不值得单独修。**建议不做（随转正消解）。**
5. **`daemon.warmup_cache` 未消费**（L45058）：语义未验证（无文档注释），
   探针验证前不排期。**建议不做（无证据）。**
6. **V2 远期项的通道预登记**（不排期，仅指路）：daemon 协议已有
   `GIT_COMMIT` / `GIT_PUSH` / `CREATE_PR`（L45043–45045）、terminals
   资源（L106269 起）、automations/crons 全套（L45014–45035）——
   HANDOVER V2 表里的"Git 提交/PR 工作流""原生 Terminal""Automations"
   届时全部走 daemon 连接，不需要新架构调研。

---

## 3. 综合优先级建议

结合已知用户决策（Turn 排队 = 主线发版前最后一步；MCP 权限 = 可以有
——本文原判 fail-closed，后续调研推翻，见 §B3 勘误；tags/工具开关 =
计划末尾低优先级）：

| 序 | 项 | 判定 | 一句话理由 |
| --- | --- | --- | --- |
| 1 | **A1 Turn 排队（方案甲：Host 层）** | **建议做**，主线发版前最后一步 | 不依赖 daemon 转正、Runtime 零改动、process/daemon 双模式同工；daemon 原生队列（方案乙）因门面无入队口 + 排队回合无流可观察，登记为后续增强 |
| 2 | **A4 基础档 reload 对账 UI** | **建议做**，A1 之后的第一个 daemon 切片 | daemon 化自己的收尾；pending 权限重弹 SDK 已内建补投，主要工作量在 Runtime "resume 不发话" seam 与占位 UI；动手前先探针核对 `getMessages` |
| 3 | **B5-1/2 daemon 模式转正门槛**（模型目录 + MCP OAuth） | **建议做**（转正前） | 不补齐则 daemon 模式永远是"实验性"，A3/B2 的收益都兑现不了 |
| 4 | **A3 后台任务完成通知** | **建议做**（缓到 A4 之后顺势） | 与 A4 共享 in-flight 状态源与 `listOpened` 轮询，增量 1–2 天 |
| 5 | **B2 历史加载 daemon 化** | **建议缓** | 感知痛点已被快照先行缓解；与 A4 共享 getMessages 探针，核对通过后再定 |
| 6 | **B4 搜索增强（kind/时间窗）+ tags 只读过滤** | **建议缓**（计划末尾同批） | 小改动、低频价值；与用户拍板的 tags backlog 同批性价比最高 |
| 7 | **A5 多项目会话路由** | **建议缓** | daemon 只解决"看见"，真正成本在 Host 多根工作区模型与安全边界重写 |
| 8 | **A4 完整档（逐 token 活流重接）/ A1 方案乙 / A2 跨窗口共享** | **建议不做（近期）** | 三者共享同一昂贵前置（控制器级观察通道），且各自独立价值都不足以单独立项；A2 另有 SDK 多客户端语义无承诺的风险 |
| 9 | **B1 收藏 daemon 化** | **建议不做** | daemon 无 favorite RPC、列表行无 isFavorite；私有文件契约已是正确形态 |
| 10 | **B3 MCP 持久权限管理** | ~~建议不做（判 fail-closed）~~ **可做，排发版后 backlog**（2026-08-12 勘误） | daemon RPC 面无对应方法的核对仍成立，但漏查了 CLI 命令面——[`mcp-permission-persistence-research.md`](./mcp-permission-persistence-research.md) 证实有官方渠道 `droid mcp permissions`，切片方案见该文档；排期见 HANDOVER §3 优先级 2 |

**一条主线读法**：daemon 化的下一步不是再加新面，而是（A1 发版）→
（A4 基础档 + 转正门槛补齐，让 `runtime.mode = daemon` 敢做默认）→
（A3/B2 这类"常驻红利"才真正兑现）。控制器级观察通道（§0 事实 3）
是所有"更实时"想法共同的贵门槛，建议保持不做，直到至少两个已立项
功能同时需要它。
