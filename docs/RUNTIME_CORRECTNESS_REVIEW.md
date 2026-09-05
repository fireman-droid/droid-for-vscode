# Runtime 正确性审查

状态：本次静态调查已完成；未进行动态复现、性能测量或整改。覆盖具有明确边界，不能据此宣称整个项目没有泄漏。

## 1. 基线与范围

- 工作区：`D:\E\前端好玩的东西\droidvisx`。
- 父任务指定基线：`main` / `a29dec1f7d7f80b76035c8092fc815cd28676f3b`，包含 `bb89d03` 聊天改造。按当前磁盘源码审查，没有运行 Git，因此没有独立证明所有磁盘文件恰好等于该提交。
- 根规则以会话提供的 `D:\E\前端好玩的东西\droidvisx\AGENTS.md` 为准；阅读了 `D:\E\前端好玩的东西\droidvisx\docs\ARCHITECTURE.md` 和 `D:\E\前端好玩的东西\droidvisx\docs\STATUS.md`，后者标注包版本 `0.8.0`、最后更新 `2026-09-05`。文档中的历史测试及安装记录不是本次执行结果。
- 先读取已有同名报告。原文件只有进行中提纲，没有已验证问题或无关用户内容；本次没有把旧候选直接继承为结论。
- 枚举了 Runtime、Extension、Shared、Webview 全部源码路径及相关入口。沿入口、调用者、资源 owner、成功/错误/取消/卸载路径进行定向审查，重点包含 `processPresentation.tsx`、`streamingText.tsx`、`activityGrouping.ts`、`VirtualizedMessages.tsx`，但不限于这些文件或最近 diff。
- 目标是运行与功能正确性，不是安全防护或加固。未因文件大、同步 IO、缺少 memo、Hook 多、长生命周期本身报错；特别核对了跨层释放、去重、容量限制及重放。
- 本 worker 只使用 Read、Glob、Grep，以及对本报告的 Edit/Create。没有执行命令、测试、构建、安装、CLI、SDK 会话、服务器、浏览器/IDE 操作、Git 写操作或进一步委派。没有读取 `.env`、个人 settings、凭据、真实用户数据、会话日志、dist 或 VSIX；也未审计第三方包。
- 唯一写入路径：`D:\E\前端好玩的东西\droidvisx\docs\RUNTIME_CORRECTNESS_REVIEW.md`。另一 worker 的架构报告未读取、修改或等待。

### 结论标准

“已确认”表示源码可构造出完整、实际可达的状态/资源错误链，已经检查相关反证，不表示本次运行了复现。“待验证”表示仍缺少 backend 事件时序、持久化契约或渲染事实。优先级按功能影响和触发条件划分：P1 应优先修复，P2 正常排期修复；没有用安全漏洞等级替代功能影响。

## 2. 执行摘要

本次确认 **8 个独立根因：2 个 P1、6 个 P2**。未确认 P0 或需要单独列项的 P3；另列 4 个待验证候选。

| 编号 | 等级 | 主要结果 |
| --- | --- | --- |
| R1 | P1 | 旧回合 Changes durable 结算在异步 flush 后覆盖整份新 transcript，能回退已经显示的新回合/流式增量 |
| R2 | P1 | 普通 host.snapshot 清空 Webview 的 pending interactions，但 Host 仍等待响应，权限/AskUser 卡消失 |
| R3 | P2 | Watchdog 只释放 Host 回合，没有释放 FactoryDroidRuntime 的 activeTurn；“已停止”之后下一条消息仍失败 |
| R4 | P2 | 两个并发 daemon acquire 在连接失效后各自重连，产生没有唯一 owner 的连接 |
| R5 | P2 | 全局子代理 Store 永久保留所有已访问 child transcript/row，Viewer 关闭和 conversation 切换均不淘汰 |
| R6 | P2 | Markdown 本地图片结果只保留 24 项，requested 集合却终身去重；被淘汰的图片永久 Loading |
| R7 | P2 | 同一 Controller 的另一聊天客户端没有接收到新回合的建立状态，整个流式阶段丢弃其增量 |
| R8 | P2 | Sessions 操作失败只发 diagnostic，不改变 sessions 引用，Drawer 的 pendingAction 永久锁住 |

优先处理 R1 和 R2：前者触及 canonical 可见状态与恢复，后者能直接让需要用户批准的真实回合停住。资源方面已确认的是 R4 的连接所有权竞态和 R5 的无上限内容保留；没有进行 heap/RSS 测量，不给出虚构的泄漏速率或内存大小。

四个新增展示文件中，已看到 disclosure timer/rAF cleanup、按现有 messageIds 修剪展开选择、scroll/ResizeObserver 释放、runtime message cache 淘汰，以及停止状态传递；本次没有确认这些文件独立引入的高置信资源泄漏。实际滚动补偿、selection 与 CSS 动画仍需要后续在隔离环境验收，见覆盖缺口。

## 3. 已确认问题

### P0

本次没有确认 P0。此表述不等于对全项目作 P0 排除证明。

### P1 / R1：旧回合结算异步回写完整 transcript，覆盖较新的可见内容

**位置与符号**

- `D:\E\前端好玩的东西\droidvisx\src\extension\chat\publishTurnChanges.ts:37-74`，`publishTurnChanges` / `persistAndPublish`。
- 建立后台结算：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnFlow.ts:538-561`，`handleTurnComplete`。
- 下一回合不等待结算：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\queue.ts:309-353`，`settleQueueAfterTurn` → `scheduleQueueDispatch` → `maybeDispatchQueue`；后者在同文件 `:258-285` 调用 `handleSend` 并广播 snapshot。
- Store 不做 transcript 版本比较：`D:\E\前端好玩的东西\droidvisx\src\extension\SessionRecoveryStore.ts:166-204`；`D:\E\前端好玩的东西\droidvisx\src\extension\conversationRecoveryState.ts:134-168`，`writeConversationDisplay`。

**触发与具体时序**

1. 回合 A 完成，`handleTurnComplete` 启动 `publishTurnChanges(A)`，立即将 A 标记 completed。用户可以发送 B，或者队列在 microtask 中自动发送 B。
2. A 的文件统计完成，结算函数从当时的 `ctl.transcript` 生成完整对象 `next`，写入 recovery，等待异步 `recoveryStore.flush()`。
3. flush 尚未完成时，B 的用户行、正文、Thinking 或 Tool 增量进入当前 transcript，并可已经显示在 Webview。即使 B 已经启动后才生成 `next`，其后继续增长仍触发同一问题。
4. A 的 flush 完成，检查仅有 disposed、sessionId、runtimeGeneration；同 session 的 B 均满足。随后 `ctl.transcript = next`，并广播更高 sequence 的 snapshot。
5. Webview 合法接收 snapshot，已经显示的 B 行/前缀消失或回退。后续 delta 接在被回退内容之后，早先增量没有自动重发保证。

**根因与影响**

- 持有整个 transcript 的陈旧快照越过了持久化 await；runtimeGeneration 只能阻止 runtime replacement，不能阻止同 runtime 的 turn/content advancement。
- `writeActiveDisplay(..., next, null)` 还可能在 B 活跃期间暂时把 durable display 的 active turn 写为 null。这里不仅是 UI 短暂抖动，还影响 Reload 看到的 canonical 状态。
- A 的零文件集也走结算路径，不能只把问题归为修改文件回合。

**证据与已排除反证**

- `writeConversationDisplay` 仅要求 activeSessionId 匹配，直接创建新 display 并增加 revision；revision 是写入计数，不是 compare-and-swap 的预期版本。
- queue 的普通完成流程已经正确关闭旧 generator 后才启动下一条，见 `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnFlow.ts:228-236`。这保护 Runtime 的 active slot，不会等待独立的 Changes flush。
- 已阅读 `D:\E\前端好玩的东西\droidvisx\src\extension\ChatController.queue.test.ts:130-237`：覆盖队列顺序和 generator slot，但没有延迟 settlement persistence 后断言最新 transcript 不回退。

**最小修复方向**

让 settlement 持有不可变的“回合 A 文件结算结果”，不要持有用于以后覆盖的完整 transcript。持久化与发布时应对最新 canonical revision 合并 A 的 changes，保留当时 active turn；flush 返回后核对 revision，必要时重新合并/提交。不能简单增加 `ctl.turnId === A` guard 后丢掉旧回合 settlement，否则独立 Changes ledger 会丢账。

**建议验证**

在现有 Controller/recovery seams 上延迟 A 的 flush，注入 B 的 user、thinking、text，再放行 A；断言 Host transcript、两客户端 snapshot 和最终 durable display 全都包含 B 的最新前缀。另覆盖 A 空 files、A flush 首次失败重试、B 自动排队三种必要时序。无需启动真实模型即可验证根因。

### P1 / R2：普通 snapshot 使仍 pending 的权限/AskUser 卡消失

**位置与调用链**

- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts:489-585`，host.snapshot 分支无条件设置 `interactions: []`。
- `D:\E\前端好玩的东西\droidvisx\src\extension\chat\hostSnapshot.ts:13-85`，snapshot 不包含 pending interaction 列表。
- 普通 snapshot 来源包括 `D:\E\前端好玩的东西\droidvisx\src\extension\chat\sessionDirectory.ts:189-209` 的 rename 完成、`:229-317` 的 favorite 读回、`:850-893` 的目录刷新，以及 R1 的旧回合 settlement。
- 真正等待响应：`D:\E\前端好玩的东西\droidvisx\src\extension\pendingInteractionCoordinator.ts:103-163`，请求存入 pending Map 并返回 Promise；响应/取消才在 `:195-197,230-232,299-315` 删除并 resolve。

**触发与时序**

1. 在 daemon 的运行回合中、尚无 pending interaction 时，从 Sessions 发起 favorite；或在 idle 时开始一次较慢 rename，再发送新回合。
2. 该目录/rename 异步操作完成前，Runtime 发出 permission/AskUser，Host 发布 interaction.request；Webview 显示卡，SDK 正在 await 用户。
3. 先前操作返回，Host 发普通 snapshot，session 和 turn 可以完全未变。
4. reducer 清空 interactions；该路径没有重放。Host pending Map 仍保留 resolver，回合无法从正常批准入口继续。

旧回合 settlement 与新回合 permission 重叠同样可触发，不依赖用户在“已有权限卡”时点击被禁用的会话操作。

**影响**

权限、AskUser、Plan 的交互入口可能消失，Host/SDK 仍在等待；UI 却可能恢复显示 working 和允许排队。用户只能 Stop 或通过真正 reload/ready 重放找回入口。

**证据与反证**

- 当前 App 在已有 interaction 时禁用 session actions，`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\App.tsx:1186-1191`；以上使用的是“卡出现前已发出的异步操作”，该前端禁用不能撤回它。
- ready/recovery 有专门重放：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\browserReplay.ts:23-47`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\runtimeLifecycle.ts:153`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\recovery.ts:249-252`。普通 `emitSnapshot` 没有该原子语义，因此这些重放不能覆盖全部 snapshot 来源。
- PendingInteractionCoordinator 的 16 项上限和终态 cancelAll 解决资源边界，不解决卡被清空后的正常批准路径。

**最小修复方向**

建立统一的 snapshot 与 pending-interaction 一致性语义：可把 pending 列表纳入 authoritative snapshot，或在所有 snapshot 发布处集中进行一致重放；若选择 reducer 保留，必须按相同 session/仍有效 turn 保留，避免切换后泄漏旧权限。不能靠逐个 UI 禁用或零散补 replay 修补。

**建议验证**

用 deferred rename/favorite 完成 Promise，先交付 interaction.request，再完成目录操作；断言卡仍可答、请求 resolve 恰好一次。另覆盖旧 turn settlement、新 session 清空、terminal 后不复活、第二客户端 ready 不破坏第一客户端。

### P2 / R3：Watchdog 本地终结回合后，Runtime activeTurn 仍占用

**位置与调用链**

- `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnWatchdog.ts:240-313`，`settleStuckTurn`；`:260` 仅增加 Host turnGeneration，随后设置 terminal 状态。
- `D:\E\前端好玩的东西\droidvisx\src\runtime\FactoryDroidRuntime.ts:367-407`，`sendTurn` 在 `:382-383` 拒绝已有 activeTurn；`:496-523` 的 generator finally 才释放该 slot。
- 下一条被拒绝后：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnFlow.ts:269-280` 将其标为 runtime-stream-failed。

**触发与时序**

A 的 SDK iterator 在 `next()` 上没有终结，正是 Watchdog 要处理的“流不再返回”条件。用户 Stop，超过 10 秒 deadline 后某次 5 秒 tick 完成历史读取，Watchdog 将 Host A 标记 interrupted。只改变 Host generation 不会让挂起的 async generator 进入 finally。用户发送 B，Host 已认为空闲并接受 B，但同一 FactoryDroidRuntime.activeTurn 仍为 A，B 立即抛出 already has an active turn。

**影响与反证**

- UI 已显示 Stopped/允许发送，B 却失败，需要 Retry 重建 Runtime，不能完成宣称的自动恢复。
- Watchdog 有再次 `interruptSession()` 的 best-effort 调用（同文件 `:165`），但没有等待其保证终结，也没有替换坏 Runtime。若 backend 的确随后返回终态，该问题会自行缓解；已确认的适用条件就是“终态继续不返回”。
- 普通 stream-complete 分支正常关闭 generator，不属于本问题。
- 现有 `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnWatchdog.test.ts:39-99` 使用不带真实 Runtime slot 的 mock，并只检查下一条同步进入 submitting；这不能证明下一条会真正运行。队列测试有 slot 模拟，但不覆盖 watchdog orphan。

**最小修复方向**

Watchdog 强制终结必须同时使坏 Runtime 不再被当作可发送：走受控 detach/replace/resume，或提供能够真正取消旧 stream 并释放 SDK/Runtime slot 的明确契约。只把 private activeTurn 清 null 而不收拢 SDK stream 也不充分，可能造成两个后端回合重叠。

**建议验证**

以真实 FactoryDroidRuntime + 可注入 SDK session 的挂起 iterator 复用 Controller fixture；强制 tick 后发送 B，观察 B 的首个实际增量/完成，而非仅 submitting。需要覆盖 late terminal 不二次结算及队列 Send now。

### P2 / R4：daemon 失联后的并发 acquire 会重复建立连接，缺少唯一释放 owner

**位置与调用链**

- `D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.ts:232-260`，`acquire`。
- 连接释放能力：`D:\E\前端好玩的东西\droidvisx\src\runtime\daemon\daemonConnection.ts:107-119`，dispose 调用 `droid.disconnect()`。
- sidecar dispose 仅关闭最后保存的 Promise：`D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.ts:268-280`。
- 实际并发入口：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\runtimeLifecycle.ts:340-348` 同时准备 history 和 Runtime；`D:\E\前端好玩的东西\droidvisx\src\extension\extension.ts:175-186,220-224` 分别给它们提供同一 sidecar 的 droid 方法。

**触发与 A/B 时序**

1. sidecar 已缓存连接 S 的 resolved Promise，但 S.status 变为 failed/auth-error。
2. acquire A、B 在同一轮均执行 `const current = await sidecar`，各自等待旧 Promise S。
3. A continuation 关闭 S，创建重连 Promise P1 并保存为 sidecar，返回 P1。
4. B continuation 的 current 仍是 S；没有检查“sidecar 是否已被 A 替换”，于是再次关闭 S，创建 P2 覆盖 sidecar，返回 P2。
5. P1、P2 均可连接成功，调用者拿到不同 ConnectedDroid；管理器只记得 P2。以后 dispose 不会关闭 P1。

**保留链与影响**

P1 的 ConnectedDroid/transport/事件订阅继续存活，却没有进入 sidecar 的释放集合。Runtime 关闭 daemon session 是 detach，不是对整个 ConnectedDroid disconnect。使用过 getDaemonDroid 的连接还可能被全局 SubagentTranscriptService 的解绑 closure 保留。反复经历连接失效 + 并发恢复可继续累积独立连接，并将会话/通知分散到不同 controller。

**反证**

首次 start 有共享 in-flight Promise，可正常合并；问题限定在 await 旧实例之后的 reconnect 分支。不是把“共享 daemon 进程故意跨 Reload 保留”误报为泄漏。现有 `D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.test.ts:5-10` 只看到 warmup retry 场景，没有并发失效 acquire 的覆盖。

**最小修复方向**

用观察到的 sidecar Promise/connection 身份建立 single-flight reconnect；只有仍拥有该身份的调用者能替换，其他调用者 await 已启动的 successor。失败清空也必须校验身份，避免旧失败擦掉新连接。所有临时连接在未转移所有权时由创建者关闭。

**建议验证**

无需真实 daemon：注入两个 deferred 连接结果，对已失效缓存执行并发 acquire；断言 connect 仅一次、返回同一 droid、dispose 恰好覆盖每个成功创建的连接。再交换 P1/P2 成败顺序验证旧 rejection 不清除 successor。

### P2 / R5：子代理 registry/store 对 terminal child 的大对象跨 conversation 无上限保留

**位置与保留链**

- 全局 owner：`D:\E\前端好玩的东西\droidvisx\src\extension\extension.ts:261-296,477,499-505`，一次 activation 创建 SubagentTranscriptService，同时保留于 Controller 和 context subscriptions。
- 大对象入口：`D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts:112-127,342-386`，byChild → ChildEntry → state.transcript/activity/rows/buffered/listeners，byRow 同时引用 entry。
- 唯一全量清空：同文件 `:292-301`，service.dispose。
- Viewer 关闭：`D:\E\前端好玩的东西\droidvisx\src\extension\SessionViewerPanelController.ts:442-452` 只停止 timer 和执行 sourceSubscription；service 的 subscribeViewer cleanup（`:280-289`）只删除 listener。

**触发与预期释放时机**

在同一 Cursor 窗口运行多个含 Task 的 conversation；每个 child 经 live 通知或 `syncParent` 注册，完成后关闭 Viewer、切换主 conversation。每个新 childSessionId 都新增 entry；旧 terminal child 的 transcript 没有 LRU、总字节预算、closed-viewer 释放或当前 parent 淘汰。

合理长生命周期的是 child identity/父 Task 映射和运行中或正在查看的 child。没有 reader 的历史 terminal child 完整内容可以在再次打开时从 history 重载，不必永久挂在扩展级强引用下。

**影响与反证**

- 已确认“保留内容随累计访问 child 数增长且无全局上限”，不是声称实际 RSS 已测到某值。
- 单 transcript 有 2,000 行、1,000,000 加权文本单位、64 张/16,000,000 base64 字符图片预算，见 `D:\E\前端好玩的东西\droidvisx\src\shared\transcriptLimits.ts:3-27`。这些是每份 transcript 的上限，不限制 byChild 的数量。
- 不能在 Viewer close 时一律丢弃 running child；它仍给父 Task 提供实时活动。修复必须区分 running、被订阅、可重载的 retired child。
- `subscribeParent` 每次还扫描全部 byChild（同文件 `:232`），因此持续保留除了内存也会增加以后重新订阅成本。
- 已读的 service 测试覆盖 live invocation、分开重复 invocation、terminal history 去重，没有跨多 parent 的 retirement/budget 场景。

**最小修复方向**

将轻量 identity 映射与可重载 transcript payload 分开；为无 reader 的 terminal entries 建立实际总预算/LRU 或显式 parent retirement，保留 running/正在查看 entries，reopen 走现有 history 初始化。连接替换时同时释放已失效 controller 的解绑列表，避免该列表持续保留旧连接图。

**建议验证**

使用 fake history 注册多批 child，逐批 terminal、关闭 viewer、切换 parent；检查 store 的保留条目/文本单位达到上限后停止增长、旧条目可重载、运行中 child 仍推送。可选在未来获批的隔离实例记录 heap retaining path；本次未测。

### P2 / R6：本地 Markdown 图片缓存淘汰后无法再次请求

**位置与调用链**

- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\App.tsx:767-784`，requestedImagesRef 对整个 session 已请求过的 path 去重，只在 session 改变时 clear。
- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts:301,805-829`，workspace.imageData 仅保留 24 项并 shift 淘汰最旧结果。
- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\MarkdownText.tsx:351-386`，LocalMarkdownImage 在 entry 缺失时调用 request，随后显示 Loading image。

**触发与结果**

在同一 session 阅读分布于不同消息的 25 个不同本地图片路径，令旧消息离开虚拟窗口后再向前滚动。第 25 个结果淘汰第 1 个 entry；重新挂载第 1 张图时 request 因 requested Set 已包含 path 而直接返回。没有请求在飞，也不会再有 Host 回包，UI 永久显示 Loading image，直到换 session/reload。

**根因与反证**

结果缓存是有淘汰的，而请求去重集合实际记录的是“历史上请求过”，不是注释描述的“one in-flight request per path”。正确的 24 项容量限制没有与请求重试协议配合。失败结果被淘汰后同样适用；Host 读取逻辑不是根因，因为第二次根本没有发请求。

**最小修复方向**

只对真正 in-flight 请求去重，收包后释放；或让请求状态与结果缓存的淘汰共同管理。需避免同时挂载超过缓存容量时反复互相淘汰/请求，优先保留正在使用的条目或采用明确占位状态。不要简单取消全部去重。

**建议验证**

顺序收 25 个受控 imageData，模拟虚拟卸载/重新挂载第一张；检查它重新发请求并从 Loading 恢复。同时检查同 path 的并发组件仍只发一次请求。既有 `store.test.ts` 的图片结果场景没有把 App 的 requested Set 与淘汰组合起来。

### P2 / R7：双客户端实时共享缺少“新回合被 Host 接受”的投影

**位置与调用链**

- `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnFlow.ts:114-194`：用户行只直接写 Host transcript，随后广播 turn.state；没有广播 accepted user prompt/建立 turn 的 snapshot。
- 发起端才有乐观 turn：`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\App.tsx:535-545`。
- 非发起端的 reducer：`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts:1028-1048,1248-1272`，turn.state 必须匹配已有 turn；`:845` 的 assistant.delta 又要求匹配 active turn。
- 两个真实消费者：`D:\E\前端好玩的东西\droidvisx\src\extension\DroidViewProvider.ts:124-137` 与 `D:\E\前端好玩的东西\droidvisx\src\extension\BrowserDevBridge.ts:253-255` 都订阅同一 Controller；browser ready 的定向 replay 在后者 `:466-470`，不负责以后每个普通 turn。

**触发与时序**

1. Cursor sidebar 和 `/live` 页面已完成 ready，停在同一个 idle/已完成 session。
2. 只从 A 发送新 prompt。A 的 reducer 通过 turn.send 建立新 turn，B 没有这个本地 action。
3. B 收到 Host 的 submitting/streaming turn.state，因为 turnId 不匹配而只 advance sequence；正文/Thinking/Tool 增量全部因 acceptsActiveTurn 被丢掉。
4. B 在流式期间仍显示旧 transcript，无正常 Stop 状态。若用户在 B 继续发送，Host 正忙，会在 turn eligibility 中拒绝（`D:\E\前端好玩的东西\droidvisx\src\extension\chat\operationEligibility.ts:227-228`），而发起端 B 已清空草稿。

**影响与反证**

该问题是“两客户端共享运行状态”缺失，不是网络消息没有送到。正常完成后的 Changes settlement 会发全量 snapshot（R1 文件 `:74`），所以另一端往往在回合结束后突然补齐；不能宣称所有内容永久丢失。队列 dispatch 也明确发 snapshot，同样是例外。问题限定于普通 direct turn.send 建立到下一个全量 snapshot 之间。

**最小修复方向**

Host 接受 direct send 后，应向所有客户端发布足以建立同一 turn 和用户行的 authoritative 投影；可以选 typed accepted-turn 事件或合适的开始 snapshot，但必须与发起端乐观 user id 去重、与 R2 的 interaction snapshot 语义一致。不要让客户端从没有用户文本的 delta 猜测并拼装新 turn。

**建议验证**

无需浏览器：把同一 Controller 输出送给两个独立 reducer，仅 A 执行本地 turn.send；断言 B 在首个增量前得到用户行和 active turn、两端正文一致、B 的 Stop 可用。再反向从 B 发起，并验证第二客户端 ready 不向 A 重放旧内容。

### P2 / R8：Sessions 失败路径没有解除 Drawer 操作锁

**位置与调用链**

- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\SessionDrawer.tsx:92-104,158-168`，pendingAction/pendingActionRef；只有 sessions 对象引用变化才解锁。
- favorite 经 `runOnce`（同文件 `:268-270`）设置 pending。
- `D:\E\前端好玩的东西\droidvisx\src\extension\chat\sessionDirectory.ts:272-285`，writeFavorite 返回 false/reject 时仅清 Host refreshInProgress 并发 session-favorite-failed diagnostic，不改变 sessions 或广播 snapshot。
- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts` 的 runtime.diagnostic 分支只改变 transcript/sequence，不更换 sessions。

**触发步骤**

在 idle session 点击收藏，使 Host 的 favorite 写入失败，例如文件暂时不可写。Host 释放自身锁并回 diagnostic，但 Drawer 的 pendingAction 仍为 true；此后 Select/Fork/Favorite/Archive 等都被 disabled。关闭重开 popover 不会卸载 SessionDrawer，也不重置该 latch。

**影响与反证**

一次正常可恢复的操作失败会锁住 Sessions 导航。后来某个不相关的 snapshot 或 running flag 更新可能改变 sessions 引用并碰巧解锁；这不是该失败操作的完成协议。idle 时没有这些更新，问题持续到一次外部刷新/重载。

**最小修复方向**

让目录操作的成功、失败、拒绝都有可关联的完成状态，Drawer 按该结果释放当前 pending；若最小修复采用失败后 authoritative snapshot，也必须与 R2 一起解决，且不能依赖任意 sessions 引用变化来判定另一个操作完成。

**建议验证**

现有 Host seam 返回 writeFavorite=false，接收 diagnostic 后重新点击另一个有效 session，应能发出 select。另覆盖成功、unsupported、连续操作结果不能错解锁，以及关闭重开 popover。

### P3

没有为短生命周期的 timeout、单纯代码风格或未 memo 的函数增加 P3 问题，避免把维护建议混入运行缺陷数量。

## 4. 资源生命周期矩阵

下表区分正常清理、确认缺陷和仍需观察的边界。计数/字节预算是代码预算，不是实测 heap。

| Owner / 资源 | 注册或创建 | 释放、取消、重连、卸载 | 有界性与判断 |
| --- | --- | --- | --- |
| ChatController → view listeners | `D:\E\前端好玩的东西\droidvisx\src\extension\ChatController.ts:534-545` | subscription.dispose 删除 listener；Controller.dispose `:954` clear；DroidViewProvider disposeViewSubscriptions 在 resolve replacement、view dispose、provider dispose 使用 | 当前 View 是有意保活；已核对不是每次显隐重新注册 |
| Factory Runtime / SDK session / process transport | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\runtimeLifecycle.ts:477-575` 将临时 runtime 加入 managedRuntimes；process factory 在失败时 close provisional transport | `:781-808` 合并同一 runtime closure，成功后 managedRuntimes.delete；late initialized runtime 有 close；`D:\E\前端好玩的东西\droidvisx\src\runtime\processSessionTransport.ts:8-28` 合并 close | 常规临时 owner 与错误 cleanup 已接通；挂起 stream 的强制终结仍有 R3 |
| Factory Runtime activeTurn / spec/subagent watch | `D:\E\前端好玩的东西\droidvisx\src\runtime\FactoryDroidRuntime.ts:387,1287-1326` | stream finally `:496-523` 释放 activeTurn、pending events 和 spec watch；dispose `:1337-1345` 退订 | 正常 turn 只一份状态；强制 Host terminal 不等于 Runtime terminal，见 R3；未验证 process transform 后通知迁移 |
| PendingInteractionCoordinator | `D:\E\前端好玩的东西\droidvisx\src\extension\pendingInteractionCoordinator.ts:133,161` Map + Promise resolver | respond、cancelTurn、cancelAll 删除并 resolve；新 Runtime token 拒绝旧 Runtime；MAX_PENDING_INTERACTIONS=16 | 容量与 resolver settlement 有约束；卡丢失后无正常答复入口，见 R2，不误报为无限 Map |
| daemon sidecar / ConnectedDroid | `D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.ts:184-260` | 当前连接 dispose 调用 disconnect；shared daemon 故意不随窗口关闭，private 策略回收进程 | reconnect single-flight 不完整，见 R4；不能把共享进程本身长期存在视为泄漏 |
| daemon startup / port wait | `D:\E\前端好玩的东西\droidvisx\src\runtime\daemon\daemonLifecycle.ts:72-257` | startup 超时/非正常退出处理、失败回收；private 最多重试一次，端口等待 30 秒 | 已定向阅读启动/失败 owner；未逐行验证全部系统命令、listener 查询或 SDK socket 实现 |
| SubagentTranscriptService | `D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts:112-127,373-386` | 仅扩展 dispose 清空 byChild/byRow；viewer/parent unsubscribe 只移除 listeners | 单 transcript 有预算，但累计 child 数和 daemonDisposables 没有总体淘汰；R5；loading buffered 的并发风险见 C1 |
| Session Viewer | `D:\E\前端好玩的东西\droidvisx\src\extension\SessionViewerPanelController.ts:230-245` | 2.5 秒 interval + source subscription；settled 后再等一个 interval 停 poll；close `:442-452` 停 timer/退订；异步回包 isCurrent | refreshBusy + 一个 trailing 标志合并刷新，不是每通知无限排队；关闭 Viewer 不释放 child payload，见 R5 |
| Host Thinking batch | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\thinkingBatch.ts:14-126` | 200ms timeout；非 Thinking 事件、Stop/terminal 主动 flush；flush clear timer/delete WeakMap 并校验 runtime/turn generation | 一份当前 batch，按 MAX_THINKING_DELTA_LENGTH 拆分；dispose/切换后的短暂 timer 会拒绝旧身份，不是永久泄漏 |
| Watchdog / zombie follow-up | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnWatchdog.ts:81-135`；`D:\E\前端好玩的东西\droidvisx\src\extension\chat\subagentWatch.ts:320-374` | 5 秒 interval、ticking 防重入；terminal/下一 turn/身份失效或 dispose 清理；zombie 基本窗口 10 分钟，parent follow-up 另有 hard deadline | 控制器只保存一个 watch；Stop deadline 后还要等待历史读取，不能把 10 秒理解为总完成时限；R3 |
| Recovery / background polls | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\recovery.ts:271-339`；`D:\E\前端好玩的东西\droidvisx\src\extension\chat\sessionRunning.ts:104-154` | 500ms recovered / 1s background；读回前后身份检查；background 无 flags 或三次失败结束；final history 10s race 清 timeout | 没有每 tick 并行增长；底层未取消的单个 history 请求需要单独观测，不宣称无挂起 Promise |
| RecoveryStore / canonical cache | `D:\E\前端好玩的东西\droidvisx\src\extension\SessionRecoveryStore.ts:448-485,567-609` | debounce + flush/dispose；8 conversations，节点32/turn256/operation64 由 `D:\E\前端好玩的东西\droidvisx\src\extension\conversationRecoveryState.ts:12-15` 定义 | 有总体文本及 LRU 淘汰；R1 是陈旧写回而非无限 cache；images.persist 先于写锁的时序见 C3 |
| Queue / sent attachments | `D:\E\前端好玩的东西\droidvisx\src\shared\queueProtocol.ts:26`；`D:\E\前端好玩的东西\droidvisx\src\extension\chat\attachments.ts:650-675` | Queue 10 项，session-line discard；sentAttachments 按32MiB accounting 逐项淘汰；staging 在 reset 清空 | sentAttachments 没在每个切换 clear 不能据此报泄漏，已有 owner budget；同 session settlement 顺序见 R1 |
| Turn snapshot objects | `D:\E\前端好玩的东西\droidvisx\src\extension\turnSnapshots.ts:503-515,586-619` | capture 走 queue，dispose 先 closing 再等 queue 清 Map；prune 比较256MiB对象预算 | 只检查这些 owner/queue/closing 段；未审计整个 Git对象写入和 restore 数据一致性 |
| Review watcher / restore previews | `D:\E\前端好玩的东西\droidvisx\src\extension\reviewCoordinator.ts:126-136,211-226`；`D:\E\前端好玩的东西\droidvisx\src\extension\reviewWatcherRefresh.ts:15-51` | 120ms debounce，Set合并 affected paths，一个 scheduled drain；版本读取最多6并发；dispose watcher/timer/previews；preview 新建前 clear | persisted scopes≤16；共享 operation tail 用 catch 继续。没有把持续工作负载本身报成资源泄漏；restore事务后半段未完整审计 |
| Canvas panel / file watcher | `D:\E\前端好玩的东西\droidvisx\src\extension\PreviewPanelController.ts:295-364` | 一 panel、一当前 file watcher；watch replacement先stopWatching；panel close清 timer/watch/current；generation+revision验证 | artifact cache 有 MAX_CANVAS_BASELINES 修剪；仅生命周期片段审查，未审 iframe 消息全契约 |
| Terminal mirror | `D:\E\前端好玩的东西\droidvisx\src\extension\terminalMirror.ts:227-485` | commandSettled/settleAll 删除 tails/header；terminal close解除 instance；extension dispose关闭 terminal并清commands | pre-open pending文本100,000字符预算。未把单实例长期终端当成泄漏；background detach 后命令投影最终清理尚未动态覆盖 |
| React Process / Virtualizer / scroll | `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\processPresentation.tsx:7-80`；`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\thread\VirtualizedMessages.tsx:142-187,240-278,334-350` | matchMedia退订；220ms timeout和双rAF cleanup；choices按messageIds删；scroll退订、ResizeObserver.disconnect、apiRef身份清空 | 没有确认泄漏。`Thread.tsx:668-674` 与 `useQuestionNavigation.ts` 也清 listener/observer/rAF。具体滚动数值未测 |
| Text / assistant-ui adapter cache | `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\streamingText.tsx:66-132`；`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\runtimeAdapter.ts:523-534` | committedLength为标量；FadingText只保存当前text/prefix，无打字任务队列；adapter每轮清/重建cache、移除不在messages内的clock项 | 不能把 Context/ref 持有当前消息当成泄漏；默认渲染60消息，但完整转换仍受 transcript预算。图片缓存协议见R6 |
| BTW sidecar | `D:\E\前端好玩的东西\droidvisx\src\extension\btwSideChat.ts:227-304` | session/reset加generation，清50ms emit timer，dispose已有/迟到sidecar；一项pending question；card按MAX_BTW_ENTRIES/ANSWER_LENGTH截断 | Webview dismiss只隐藏是当前产品语义，见 `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\useBtwPanel.ts:74-75`，不是未调用Host teardown的泄漏 |
| Browser Dev Bridge | `D:\E\前端好玩的东西\droidvisx\src\extension\BrowserDevBridge.ts:245-274,762-781` | generation+AbortController；stop清15秒keepalive、end SSE、dispose订阅、close server、kill Vite；startup临时owner失败回收 | 已核对启动取消和主要释放；多客户端状态正确性见R7。browserRuntime pagehide只设 stopped，未测BFCache/未完成fetch的行为 |

## 5. 异步与状态竞态矩阵

| 场景 | A/B 时序与可观察错误 | 已有保护 / 不足 | 判定 |
| --- | --- | --- | --- |
| A结算与B新回合/增量 | A生成next → await flush → B追加 → A覆盖next/发snapshot | session/runtimeGeneration保护旧runtime，不保护同runtime新内容 | R1，已确认；主证据 `D:\E\前端好玩的东西\droidvisx\src\extension\chat\publishTurnChanges.ts:37-74` |
| 卡出现与普通snapshot | 目录操作开始 → permission卡出现 → 目录snapshot → 卡清空、Host仍pending | ready重放存在，普通snapshot没有 | R2，已确认；`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts:585` |
| Stop强制终态与下一次send | 挂起next → Host强制terminal → 同runtime send被activeTurn拒绝 | Host generation隔离迟到事件，不取消SDK iterator | R3，已确认；`D:\E\前端好玩的东西\droidvisx\src\runtime\FactoryDroidRuntime.ts:382-407,496-523` |
| daemon两次acquire | A/B await旧S → A创建P1 → B用旧S创建P2 | 初次start有single-flight，reconnect无observed identity检查 | R4，已确认；`D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.ts:239-260` |
| child完成/关Viewer/换parent | N个child逐步退休 → unsubscribe → 全量payload仍在byChild/byRow | 单transcript预算不控制累计child数量 | R5，已确认；`D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts:342-386` |
| 图片结果淘汰与再次挂载 | 25结果淘汰旧entry → mount请求 → 已请求Set拒绝 | 结果缓存和去重集合寿命不一致 | R6，已确认；`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\App.tsx:778` |
| 两客户端direct send | A乐观建立turn → B收到state/delta但无匹配turn → B丢流 | ready定向snapshot与end snapshot仅事后修复 | R7，已确认；`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts:1046,1260-1272` |
| Sessions操作失败 | runOnce置pending → Host只发diagnostic → sessions引用不变 | Host锁释放；UI无correlated settlement | R8，已确认；`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\SessionDrawer.tsx:98-104,158-168` |
| 正常Runtime替换 | 并行history/runtime后身份失效 | createInitializedRuntime与activate分支关闭迟到的managed runtime | 已读路径有保护；不报“缺局部clear”问题，`D:\E\前端好玩的东西\droidvisx\src\extension\chat\runtimeLifecycle.ts:350-370,544-564` |
| child初始history与通知 | history在飞期间buffer通知，history可能已含部分通知 | 仅顺序回放buffer；是否重复需要backend边界事实 | C1；`D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts:335-403` |
| recovered history只改旧行 | 同数量/同最后id，Thinking变长或Tool状态变化 | advancement判断只看最后assistant增长 | C2；`D:\E\前端好玩的东西\droidvisx\src\extension\chat\recovery.ts:380-406` |
| 两次flush与image artifacts | 两次在writeInFlight为空时都进入await image persist | 完整serialization gate是否包含artifact阶段仍需验证 | C3；`D:\E\前端好玩的东西\droidvisx\src\extension\SessionRecoveryStore.ts:448-483` |
| 子代理panel打开/关闭 | open等待mapping → close退订 → 旧open continuation再次订阅 | session/disposed guard没有desired-open token | C4；`D:\E\前端好玩的东西\droidvisx\src\extension\chat\subagentPanel.ts:46-73` |

## 6. 待验证候选与低成本验证

这些不计入已确认问题总数，不能作为已测泄漏或已发生内容损坏引用。

### C1：child history 初始化/terminal reconcile 与 live 通知重叠

- 定位：`D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts:335-403,408-416,634-641`。
- 候选时序一：history request开始 → child text delta进入buffer → history响应已包含同一delta → state整体替换后buffer再次append。已有 user-message id 去重不能自动证明 assistant delta去重。
- 候选时序二：child terminal触发两次history读取 → 同一child被新Task resumed/新增live内容 → 较旧history响应重新覆盖entry.state。terminal reconcile没有独立epoch，初始loading的buffer也不能保护该分支。
- 反证/缺口：若公开history返回的内容严格早于订阅边界，或terminal期间child不会复用，这些具体时序不发生；本次没读取真实session或运行SDK来验证这个backend契约。已有测试只验证完整terminal替换，不验证重叠。
- 低成本步骤：使用现有service fake history的deferred响应，分别注入相同messageId的delta、terminal后新user/assistant，再交付较旧history，检查重复文本或新内容回退。后续仅当该事件序列能由公开SDK证实时提升为确认问题；不需要改真实用户session。

### C2：Recovered turn 的行内变化可能长时间不发布

- 定位：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\recovery.ts:380-406`，`recoveredTranscriptAdvanced`；`D:\E\前端好玩的东西\droidvisx\src\extension\ingestConversationHistory.ts:187-217`，按长度enrich Thinking与Tool。
- 当前判断只接受数量变化、最后id变化或最后一项assistant文字增长。相同行数且尾项为Thinking/Tool时，正文增长、tool状态完成可被忽略；相同长度的Thinking complete也不会经enrichItem更新status。
- 缺口：需要确认daemon getMessages在运行中是否实际返回上述同形增长/状态修订，以及是否很快由新行或最终history补齐。不能把可能在下次追加即修复的延迟声称为永久丢失。
- 低成本步骤：fake loader先返回同id Thinking短文本，再返回更长文本，再只改Tool status；推进既有recovery poll，检查Host是否发布变化。若真实公开fixture能证明该响应形态，按实际延迟定级。

### C3：RecoveryStore 的 flush 写入互斥未覆盖 image artifact await

- 定位：`D:\E\前端好玩的东西\droidvisx\src\extension\SessionRecoveryStore.ts:448-483`。writeInFlight仅在await imageArtifacts.persist之后赋值；flushInBackground、显式flush和dispose可能在前段并发进入。
- 候选：artifact阶段出现两个并行persist，serialize时读取的revision/conversations与已persist图片集合不一致；旧snapshot是否可能后写、失败后的revision是否精确，仍取决于下层artifact和workspaceState队列。
- 反证/缺口：没有imageArtifacts时这一前置await不存在；单纯看到两个flush不能直接断言最终存储错误。未深入本地image artifact全实现，也未测试VS Code workspaceState的排队结果，因此保持候选。
- 低成本步骤：对已有RecoveryStore测试注入可控imageArtifacts.persist和persistence.update，交叉释放两次flush，记录每份payload的revision、image refs及最终durable值；不需要写真实用户图像。

### C4：子代理活动订阅在“关掉”之后被迟到的 open 重新建立

- 定位：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\subagentPanel.ts:46-73`。open先await ensureMapping；close只退订/清fingerprint，未使之前open continuation失效。
- 静态可见：close若先于mapping完成，旧open仍可subscribeParent。但最多保留一个当前subscription，本身不足以称为无限泄漏。
- 尚缺可观察影响：需要检查当前App自动onPanelToggle在child完成、双客户端或会话切换时是否把这一时序转化为持续无用activity推送；父session/全扩展dispose仍能回收。可能只是有界额外订阅。
- 低成本步骤：defer loadSubagentInvocations，依次open、close、resolve，检查是否仍建立subscriber以及随后是否实际发activity；只有确认用户可观察错误或长期不必要工作，才另行定级。

### 已检查后不报问题的事项

- `processPresentation` collapsed状态的220ms timer、双rAF均有cleanup；`streamingText`没有可无限增长的token队列。没有用“新增effect多”作结论。
- assistant-ui适配器每轮修剪cache和completionClock；当前可见messageId范围的展开选择会被修剪。
- sentAttachments虽跨session保留，但32MiB accounting预算会淘汰；Review previews在新preview时clear；Canvas artifact有上限。
- CodeBlock Copy的1.5秒timeout缺少组件卸载cleanup（`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\MarkdownText.tsx:529-533`）只证明短时retention，未找到永久累积链，不单独报泄漏。
- 不将stopped后仍有后台daemon turn视为错误：preserveBackendTurn是明确产品能力；必须区分故意detach和R3的仍被复用的坏Runtime。

## 7. 分阶段整改计划

本节仅给顺序与验证条件，没有实施。工时为一名熟悉本仓库工程师的粗估，不含等待用户批准、真实Cursor验收或backend问题定位；总量约 **5–9工程日**，可在决定共享契约后重估。

| 阶段 | 顺序与依赖 | 涉及文件 | 估算 | 回归完成条件 |
| --- | --- | --- | --- | --- |
| 1：canonical一致性 | 先R1，再R2；若修改snapshot的公开契约，先稳定Shared并获计划批准 | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\publishTurnChanges.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\recovery.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\SessionRecoveryStore.ts`；R2按方案涉及`D:\E\前端好玩的东西\droidvisx\src\extension\chat\hostSnapshot.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts`及Shared bridge/两侧parser | 1.5–3日 | A结算不能回退B内容/active turn；零文件及一次失败重试正确；任何普通snapshot不丢仍pending交互；跨session/terminal不复活旧卡 |
| 2：坏Runtime与连接owner | R3、R4；先确定强制恢复是replace还是新的可取消stream契约，再实施，勿只清标志 | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnWatchdog.ts`、`D:\E\前端好玩的东西\droidvisx\src\runtime\FactoryDroidRuntime.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\runtimeLifecycle.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.ts` | 1.25–2日 | 强制停止后下一条收到真实增量；旧stream迟到不重写；并发失效acquire只一条新连接；所有创建成功连接均有唯一可验证释放owner |
| 3：子代理大对象retirement | R5；依赖R4明确连接替换事件。C1先用deferred seam验证再决定是否同阶段纳入 | `D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\SessionViewerPanelController.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\subagentPanel.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\extension.ts` | 0.75–1.25日 | retired child总体保留达到预算后不增长；仍running/正查看child不被打断；旧历史按需恢复；reconnect不保留多余旧controller graph |
| 4：客户端运行状态与局部锁 | R7依赖阶段1的snapshot/accepted-turn语义；随后R6、R8。共享同文件时串行编辑 | `D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnFlow.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\App.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\SessionDrawer.tsx`、必要的`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\MarkdownText.tsx` | 1–1.75日 | 两reducer同一turn从首增量一致；发起端不重复用户行；第25张图片后旧图可重载且无请求风暴；目录失败后正常解锁且不能错解锁新请求 |

### 验证顺序与不做项

1. 优先使用现有注入点、可控Promise和两个reducer，不启动真实模型、不建立额外连接、不用真实用户历史。
2. 新增/运行测试须遵守用户当前会话授权；本次只是建议，未创建或执行测试。每个新增测试必须保护表中具体生产缺陷，不能仅验证类名、Getter、样式或覆盖率。
3. 代码整改后按项目规则执行 `pnpm run typecheck`、`pnpm run lint:budgets`；如需用户安装，则串行build、VSIX、install并提示Reload Window。这里没有执行这些命令。
4. 真正跨Host/SDK资源释放和UI表现须在后续获准的隔离/用户验收阶段确认。文字流淡入、展开/收起、虚拟回合高度补偿、Reduce Motion、选择文字期间追加不应凭截图想象通过。
5. 不重构整个Runtime/Host、不更换assistant-ui或SDK、不增加安全加固/认证策略、不制作新调试CLI/harness/PoC脚本、不清理用户文件、不顺带修全部待验证项。整改同步产品事实时才更新状态文档；本报告不冒充已修复状态。

## 8. 实际覆盖清单与未检查范围

### 已深读或沿相关调用链审查

- 入口：`D:\E\前端好玩的东西\droidvisx\src\extension\extension.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\ChatController.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\DroidViewProvider.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\main.tsx`。
- 主运行链：`D:\E\前端好玩的东西\droidvisx\src\extension\chat\runtimeLifecycle.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnFlow.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\queue.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\recovery.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\sessionDirectory.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\sessionMetadata.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\browserReplay.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\hostSnapshot.ts`。
- Runtime核心：`D:\E\前端好玩的东西\droidvisx\src\runtime\FactoryDroidRuntime.ts` 的会话、turn、MCP timer/subscription、create/dispose、transformation部分；该Read返回到2021行后被工具截断，未读剩余纯投影尾部。还审查了 `D:\E\前端好玩的东西\droidvisx\src\runtime\processSessionTransport.ts`、`D:\E\前端好玩的东西\droidvisx\src\runtime\daemon\createDaemonDroidSession.ts`、`D:\E\前端好玩的东西\droidvisx\src\runtime\daemon\daemonConnection.ts`。没有读取凭据文件或执行这些源码。
- 资源/结算：`D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\SessionViewerPanelController.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\pendingInteractionCoordinator.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\terminalMirror.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\btwSideChat.ts`，以及chat下的`publishTurnChanges.ts`、`settleTurnChanges.ts`、`turnWatchdog.ts`、`thinkingBatch.ts`、`subagentWatch.ts`、`subagentPanel.ts`、`sessionRunning.ts`（均位于 `D:\E\前端好玩的东西\droidvisx\src\extension\chat\`）。
- canonical恢复/历史：`D:\E\前端好玩的东西\droidvisx\src\extension\SessionRecoveryStore.ts:1-615`、`D:\E\前端好玩的东西\droidvisx\src\extension\conversationRecoveryState.ts:1-340`、`D:\E\前端好玩的东西\droidvisx\src\extension\ingestConversationHistory.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\reconcileSessionHistory.ts:1-340`、`D:\E\前端好玩的东西\droidvisx\src\runtime\history\DaemonSessionHistoryLoader.ts`、`D:\E\前端好玩的东西\droidvisx\src\shared\transcriptLimits.ts`；后续预算符号做了定向检索。
- Webview重点全读：`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\App.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\store.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\runtimeAdapter.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\Thread.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\processPresentation.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\streamingText.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\activityGrouping.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\thread\VirtualizedMessages.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\thread\activityRows.tsx`。
- Webview其他关联：`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\MarkdownText.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\followScroll.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\useQuestionNavigation.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\subagentPanelFlow.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\ReadOnlyTranscript.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\conversationTransition.tsx`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\imagePreviewCache.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\useBtwPanel.ts`、`D:\E\前端好玩的东西\droidvisx\src\webview\dev\browserRuntime.ts`。

### 定向片段/符号扫描，不能算完整审计

- `D:\E\前端好玩的东西\droidvisx\src\extension\DaemonSidecar.ts:1-280`、`D:\E\前端好玩的东西\droidvisx\src\runtime\daemon\daemonLifecycle.ts:1-390`。
- `D:\E\前端好玩的东西\droidvisx\src\extension\BrowserDevBridge.ts:1-620,762-831`，未全读Vite等待、HTTP读取辅助函数中段。
- `D:\E\前端好玩的东西\droidvisx\src\extension\reviewCoordinator.ts:1-500`及preview/persistence/发布guard符号，`D:\E\前端好玩的东西\droidvisx\src\extension\reviewWatcherRefresh.ts`全读；未全读restore事务。
- `D:\E\前端好玩的东西\droidvisx\src\extension\turnSnapshots.ts:495-624`和owner/预算符号；`D:\E\前端好玩的东西\droidvisx\src\extension\PreviewPanelController.ts:280-368`和cache/dispose符号。
- `D:\E\前端好玩的东西\droidvisx\src\extension\chat\attachments.ts:1-280,620-729`；`D:\E\前端好玩的东西\droidvisx\src\extension\chat\operationEligibility.ts:188-244`及相关guard符号。
- `D:\E\前端好玩的东西\droidvisx\src\webview\assistant\SessionDrawer.tsx:1-450`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\thread\transcriptRows.tsx:1-260`、`D:\E\前端好玩的东西\droidvisx\src\webview\assistant\Lightbox.tsx:1-300`、`D:\E\前端好玩的东西\droidvisx\src\webview\sessionViewer\SessionViewerApp.tsx:1-165`。
- MissionGateway/MissionRuntime、theme、queue/btw limits、测试文件等只对所列资源/回归符号检索，不能把路径枚举或搜索命中算作逐行覆盖。

### 只读测试核对

- 全读 `D:\E\前端好玩的东西\droidvisx\src\extension\SubagentTranscriptService.test.ts`、`D:\E\前端好玩的东西\droidvisx\src\extension\chat\turnWatchdog.test.ts`。
- 阅读 `D:\E\前端好玩的东西\droidvisx\src\extension\ChatController.queue.test.ts:130-237`；检索recovery、turnEvents、DaemonSidecar、BrowserDevBridge、settleTurnChanges、subagentPanel和Webview store测试的相关断言/场景名，未声称完整测试套件覆盖结论。
- 没有运行任何测试，也没有新增测试、PoC、harness或草稿文件。

### 未检查或未证明的范围

- SDK内部EventEmitter、WebSocket、AsyncIterator取消的实际实现和浏览器/assistant-ui/TanStack内部资源释放；本次问题所依赖的active slot和disconnect owner已在项目源码中可见，未需要启动SDK或读取第三方实现。
- Mission完整创建/恢复/停止状态机、MCP/custom provider管理全链、图片标注与附件摄取全链、Git restore/commit事务、所有Bridge exact-key parser、独立process history loader、文件句柄/子进程辅助函数的全部错误分支。
- CSS动画事件在隐藏Webview/Reduced Motion/选择文字期间的实际行为；虚拟列表从空变非空、prepend、Pinned editor、宽度变化和长内容展开时的真实数值。四个重点新文件的静态cleanup检查不能替代这些运行验收。
- 实际网络断开/重连、SDK最终history落盘边界、真实heap retaining path、CPU/RSS、文件描述符/句柄数、浏览器BFCache、Extension Host关闭顺序与多窗口后台daemon行为。
- 没有修改生产代码、配置、依赖、tests、AGENTS、其他文档或产品状态；没有提交。唯一范围内改动是本报告。最终结论应按上述局限使用，不应写成“全部代码已审完”“已修复”“已跑测试”或“全项目没有其他泄漏”。
