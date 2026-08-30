# DroidVisX 可靠性与维护性修复计划

## 1. 计划定位

本计划记录对当前生产代码完成的只读全仓审计结果，并给出最小、依赖有序的修复路线。
审计基线为 `20119fa`，范围覆盖 `src/` 下 Runtime、Extension Host、共享 Bridge
和 Webview，排除依赖、生成输出、构建产物、测试原型和视觉风格意见。

当前基线约有：

- 331 个生产 TS、TSX 和 CSS 文件；
- 约 108K 行生产代码；
- 12 个超过 1000 行的生产文件。

结论：

- 未确认 P0；
- 确认 3 个 P1 正确性或安全风险；
- 确认 4 个 P2 正确性风险；
- 确认 6 项具有重复成本或行为漂移风险的维护债务。

本次更新只写计划，不修改生产代码。下列事项必须按独立任务分批实现、验证和提交。

## 2. 已确认的正确性与安全风险

### P1-1：共享 Daemon 在验证监听者身份前发送登录凭据

证据路径：

- `src/runtime/daemon/daemonDiscovery.ts`
  - `healthyEndpoint()` 先调用 `checkHealth(url)`；
  - 仅当发现记录中的 PID 已死亡时才调用 `resolveListenerPid()`。
- `src/extension/extension.ts`
  - `healthCheckDaemon()` 通过 `openDaemonConnection()` 执行认证 RPC。
- `src/runtime/daemon/daemonConnection.ts`
  - `openDaemonConnection()` 把当前 Droid CLI JWT 放入 `auth.apiKey`。

可达失败：

`~/.droidvisx/daemon.json` 是本地可写信任边界。若记录指向攻击者控制的 localhost
监听端口，同时填入任意仍存活的 PID，健康检查会在确认该端口确由 `droid daemon`
监听之前把 JWT 发给该端口。

修复边界：

1. 先把 discovery 记录中的端口解析为真实监听 PID；
2. 校验该 PID 的命令行确实匹配预期 Droid 可执行文件和 daemon 子命令；
3. 只有身份验证成功后才允许读取凭据并执行认证健康检查；
4. 身份不可验证时按 unavailable 处理，不发送凭据，也不信任记录中的 PID。

验收：

- 伪造 discovery 记录加恶意 localhost 监听者时，凭据解析器和连接器都不被调用；
- 记录 PID 存活但不拥有目标端口时拒绝复用；
- 已验证的真实 daemon 仍可复用；
- Windows shell wrapper 已退出时仍能通过监听 PID 恢复真实 daemon。

### P1-2：损坏的 Session Lease Registry 被当作空表，导致并发所有权失效

证据路径：

- `src/runtime/daemon/sessionLease.ts`
  - `readLeases()` 对损坏 JSON、非法顶层结构和非法条目返回或收敛为空表；
  - `acquireSessionLease()` 在独占事务锁内基于该空表继续写入。

可达失败：

事务锁只能串行化本次读写，不能恢复被丢弃的既有 lease。Registry 损坏后，一个窗口可把
“未知所有权”解释为“无人持有”，覆盖状态并与原持有窗口同时操作同一 daemon session。

修复边界：

- 仅“文件不存在”表示空 registry；
- 损坏 JSON、非法顶层结构或不能完整验证的条目表示 registry unavailable；
- acquire 在 unavailable 状态下失败关闭，不重写原文件；
- 合法但 PID 已死亡的 lease 仍按现有规则回收。

验收：

- 缺失文件允许第一次 acquire；
- 损坏文件和混入非法条目的文件拒绝 acquire，且原内容不被覆盖；
- 两个并发调用不能同时获得同一 session；
- 死进程 lease 可被安全接管。

### P1-3：恢复与 Turn Snapshot 持久化失败被报告为成功

证据路径：

- `src/extension/SessionRecoveryStore.ts`
  - `flush()` 捕获 `persistence.update()` 失败后仍推进 `persistedRevision`；
  - 调用方收到成功完成，失败 revision 也不再重试。
- `src/extension/turnSnapshots.ts`
  - `persist()` 捕获并丢弃 `persistence.update()` 失败；
  - `capture()`、`capturePaths()` 和 `rememberFiles()` 可在 durable write 失败后正常完成。

可达失败：

Reload 恢复记录、Review baseline、Restore 所需树信息或 changed-file metadata 可能只存在于
内存中，但 flush/capture 调用方会把它当作已经持久化。窗口关闭后数据丢失，且没有可靠的
重试或失败状态。

修复边界：

- durable write 失败必须保留 dirty revision；
- 显式 `flush()` 必须拒绝，或返回可判定的失败结果；
- 后续成功写入后才能推进 persisted revision；
- Turn Snapshot 写失败必须传递到需要 durability 的调用方，并记录不含敏感内容的诊断；
- 不引入通用存储框架，只修正两个现有 store 的成功语义。

验收：

- 同步和异步 update 失败都不能被报告为成功；
- 失败 revision 在下一次 flush 时可重试；
- snapshot capture/remember 的 durable write 失败可被调用方观察；
- dispose 不会静默确认未写入的数据。

### P2-1：Review 内部任务拒绝后可污染串行队列并阻断 Replay

证据路径：

- `src/extension/reviewCoordinator.ts`
  - `writingScopes.enqueue()` 使用 `this.operation = this.operation.then(task)`，没有恢复队尾；
  - `replayTo()` 直接 `await this.operation`。
- `src/extension/reviewWritingScopes.ts`
  - `settleWritingTurn()` 排队执行可拒绝的 load、refresh 和 persist 操作。

可达失败：

settled Review 任务一旦拒绝，`this.operation` 保持 rejected。随后 Replay 会直接拒绝；
watcher reload 和后续内部任务也会从 rejected promise 继续链式失败，直到另一条带 catch
的 Webview operation 偶然修复队尾。

修复边界：

- 队列本身始终保留 fulfilled tail；
- 每个任务保留自己的失败结果，用于诊断或 operation result；
- replay 等待此前任务 settle，但不继承已经处理过的历史拒绝；
- dispose 后不再接受新任务。

验收：

- 注入一次 settle/reload 失败后，下一次 replay 和 Review 操作仍可执行；
- 原始失败只报告一次；
- 排队顺序不改变；
- 不产生 unhandled rejection。

### P2-2：Recovered Turn 的最终 History 读取失败仍标记 Completed

证据路径：

- `src/extension/chat/recovery.ts`
  - `finishRecoveredTurn()` 在 `loadHistoryTimed()` 非 available 时发送诊断；
  - 随后仍调用 `setTurnStatus(..., 'completed')`，除非用户正在 Stop。

可达失败：

daemon 已报告 idle，但最终 session history 不可读时，完整 assistant 结果仍未知。UI 和恢复
缓存却把 turn 标记为 completed，掩盖了可能缺失的输出。

修复边界：

- 只有最终 history 成功加载并完成 reconcile 后才能标记 completed；
- history unavailable 使用现有 failed terminal state 和明确诊断；
- 用户 Stop 路径仍保持 interrupted；
- 不伪造 assistant 内容，也不把旧 placeholder 当作完整结果。

验收：

- available history 产生 completed；
- unavailable、malformed 或超时 history 产生 failed；
- Stop 竞态仍产生 interrupted；
- Reload 后不会把 failed recovery 投影回 completed。

### P2-3：Process 与 Daemon Session 的部分创建和替换缺少完整回滚

证据路径：

- `src/runtime/FactoryDroidRuntime.ts`
  - `createLocalDroidSession()` 在 transport 已连接后，create/resume 失败不会关闭 transport。
- `src/runtime/daemon/createDaemonDroidSession.ts`
  - 新 session 创建后的 lease acquire 异常没有统一 detach/release；
  - `attachReplacement()` 在新 session 已 attach 并持有 lease 后，旧 session detach 失败会遗留
    新 handle 和新 lease。

可达失败：

初始化或 rewind/compact/fork 的中间步骤失败后，可遗留 CLI 子进程 transport、daemon
attachment 或跨窗口 lease。后续初始化可能被幽灵所有权阻塞，Extension Host 也可能持有
无法再访问的资源。

修复边界：

- 为每条资源获取路径定义明确的“本地拥有、已转移、已释放”状态；
- process create/resume 失败关闭 transport；
- daemon create 在所有 post-create 失败出口 detach session 并释放已获得 lease；
- replacement 只有在新 handle 成功接管后才完成所有权转移，任何失败都清理未接管资源；
- cleanup 失败保留首要错误并记录诊断，不用 catch-all 把操作伪装为成功。

验收：

- 在 connect、create/resume、lease、attach、旧 handle detach 各阶段注入失败；
- 每个失败出口最终都没有遗留 transport、attachment 或 lease；
- 成功路径仍只关闭旧 handle 一次并保留新 session；
- 原始业务错误不被 cleanup 错误覆盖。

### P2-4：Browser Dev 在异步 Startup 期间不能可靠 Stop 或 Dispose

证据路径：

- `src/extension/BrowserDevBridge.ts`
  - `start()` 用 `starting` 跟踪 `startRun()`；
  - `stop()` 只读取 `run`，startup 尚未赋值时直接返回；
  - `startRun()` 可在 Stop 返回后继续设置 `this.run`；
  - `dispose()` 发起但不等待 `stop()`。

可达失败：

在 Vite 或 Bridge 尚未完成启动时执行 Stop、Extension Host deactivate 或窗口关闭，Stop
会看到 `run === null` 并结束。Startup 随后继续发布 run，留下监听端口、Vite 子进程和
订阅，且 UI 已认为 Stop 完成。

修复边界：

- startup 具有可取消 generation 或等价的生命周期令牌；
- Stop/Dispose 会使当前 startup 失效，并等待其创建的资源完成清理；
- 已失效 startup 不能发布 run、复制 URL 或记录 started；
- Start、Stop 和 Dispose 保持幂等。

验收：

- 在 `listen()` 和 `waitForVite()` 阶段分别暂停 startup 后调用 Stop/Dispose；
- startup settle 后无活动 server、Vite、interval、subscription 或 run；
- 不发送 started 诊断，也不复制失效 URL；
- 正常 start-stop-start 仍只存在一个实例。

## 3. 已确认的维护债务

### M1：Session 操作资格由多组重叠布尔 Guard 重复拼装

证据路径：

- `src/extension/ChatController.ts` 的 `sessionRequestDropReason()`；
- `src/extension/chat/runtimeLifecycle.ts` 的 `canReplaceSession()`；
- `src/extension/chat/turnFlow.ts` 的 send、handoff、retry、compact guards；
- `src/extension/chat/sessionDirectory.ts` 的 select、archive、fork guards；
- `src/extension/chat/capabilityPanels.ts` 和 `customModels.ts` 的 panel/reload guards。

问题：

同一组 runtime、connection、turn、interaction、session operation、refresh、settings 和
workspace 条件被不同 handler 选择性复制。差异有些是必要的，例如 activation metadata
push 必须绕过用户请求 guard；目前这些差异依靠手写子集和注释维持，容易发生无意漂移。

最小收敛：

- 先写一张 operation-class eligibility 表；
- 提取少量有语义名称的判定，例如 user panel request、session replacement、turn start；
- 生命周期内部 push 保留独立入口，不强行套用一个万能 guard；
- drop reason 由同一判定结果生成，不再重复重建条件。

验收：

- 每类操作有明确且唯一的资格函数；
- 必要例外有测试覆盖；
- 相同 operation class 不再散布重叠布尔子集。

### M2：Settled Changed Files 存在两个 Durable Truth Source

证据路径：

- `src/extension/chat/turnFlow.ts` 的 `publishTurnChanges()` 同时写
  `turnSnapshots.rememberFiles()` 和 transcript `changes` item；
- `src/extension/turnSnapshots.ts` 把 `files` 持久化到
  `droidvisx.turnSnapshots`；
- `src/extension/SessionRecoveryStore.ts` 持久化包含 `changes` item 的 transcript；
- `src/extension/chat/recovery.ts` 又从 recovered transcript 把 files 回写 snapshot store。

问题：

同一 turn 的 file path/additions/deletions 在两个 store 中独立持久化，并存在单向回填。
写入时序、保留上限或失败语义不同后，Review 与 transcript 可能读取不同版本。

最小收敛：

- 在 P1-3 修复后，把 transcript `changes` item 定为 settled file ledger 的 canonical owner；
- Turn Snapshot Store 只持有 Git tree/object 和 Restore 所需 snapshot metadata；
- Review 从 canonical ledger 获取 settled files；
- 对已有 snapshot v1 `files` 保留一次有界的只读兼容路径，不建立通用 migration 框架。

验收：

- 新 turn 只持久化一份 settled file ledger；
- Reload 后 transcript、Review 和 Restore 使用同一文件集合；
- 旧数据仍可读取，但不会再次写入两个来源；
- 任一 durable write 失败不会产生两个“都成功”的分叉状态。

### M3：打开 Branch Review 会读取两次相同 Git Diff（已完成）

证据路径：

- `src/extension/createReviewFeature.ts` 的 `readBranchDiff()` 为
  `review.open` 调用 runtime `readGitDiff()`；
- `src/webview/assistant/reviewDockSlot.tsx` 在 branch scope 激活后再次发送
  `git.requestBranchDiff`，主要用于 commit count/summary。

已完成：

Branch `RuntimeGitDiff` 的 commit count 已投影进同一次 Review state，并在 Bridge
边界按非负安全整数解析；ReviewDock 直接渲染该值，已移除 branch scope 激活后的
`git.requestBranchDiff`。一次 Branch Review open 只读取一次 Git diff。

验收：

- 一次 Branch Review open 只调用一次 runtime Git diff；
- 文件列表、baseline 和 commit count 来自同一结果；
- refresh 明确触发一次新的读取。

### M4：Review Watcher 可累计 Reload，且版本刷新串行读取全部文件（部分完成）

证据路径：

- `src/extension/reviewCoordinator.ts`
  - `noteWorkspaceChange()` 每个 debounce 周期向 `operation` 追加一次
    `reloadActive()`；in-flight reload 期间的新事件仍可继续累积后续 reload；
  - `refreshVersions()` 已改为固定最多 6 个并发 `readFile()`，不再串行读取全部文件。

问题：

大型 Review 的版本读取已缩短为有界并发；文件事件风暴仍会积累重复的全 scope reload，
并扩大 P2-1 队列失败的影响。Watcher coalescing 和 queue resilience 仍待处理。

最小收敛：

- watcher refresh 使用一个 pending/in-flight 状态，事件风暴最多合并为当前执行和一次补跑；
- 记录受影响路径，能局部刷新时不重读整个 scope；
- 全量刷新已使用现有资源范围内固定 6 个并发；
- 不引入新的 watcher 或缓存框架。

验收：

- burst 事件不会线性增加 queued reload；
- 单文件变化只重算必要版本；
- 全量刷新保持确定顺序和同一 lifecycle 结果；
- dispose 后不会执行补跑。

### M5：Bridge Union 与手写 Parser Dispatch 没有编译期穷尽关系

证据路径：

- `src/shared/bridgeMessages.ts` 定义 `WebviewToHostMessage` 和
  `HostToWebviewMessage` 大型 union；
- `src/shared/validateMessage.ts` 手写 Webview message switch；
- `src/webview/bridge/validateHostMessage.ts` 手写 Host message switch；
- 两个 switch 都从普通 string 分派并以 `default -> undefined` 收尾。

问题：

向 union 添加新 message 时，TypeScript 不要求同步注册 parser case。契约可以通过编译，
但运行时在 Bridge 信任边界被静默丢弃。

最小收敛：

- 为两个方向建立由 message discriminant 约束的 typed parser registry，或等价的
  `satisfies Record<MessageType, ...>` 检查；
- panel family delegation 保持显式；
- 继续在 Bridge 边界执行严格 runtime validation，不引入 schema/codegen 依赖。

验收：

- 新增 union discriminant 但未注册 parser 时 typecheck 失败；
- 未知外部 message 仍返回 undefined；
- 现有 strict key、长度和路径验证不放宽。

### M6：Question 边界的 1px 所有权规则在两个模块重复

证据路径：

- `src/webview/assistant/useQuestionNavigation.ts`
  - active question 使用 `top <= scrollTop + 1`；
- `src/webview/assistant/thread/VirtualizedMessages.tsx`
  - Sticky Question 使用 `getVirtualItemForOffset(scrollTop + 1)` 和相同边界比较。

问题：

两个消费者必须共享完全相同的边界所有权。此前其中一处使用 exact `scrollTop`，已造成
Navigator 选中 question 12 而 Sticky Question 显示 question 11 的真实缺陷。

最小收敛：

- 在现有 sticky/navigation 模块边界中定义一个 question-entry tolerance；
- 两个消费者调用同一比较 helper 或常量；
- 不把所有滚动阈值合并为一个无语义全局常量。

验收：

- shared boundary 的前一像素、边界像素和后一像素均有一个参数化回归；
- Navigator 与 Sticky Question 在每个样例返回同一 question；
- bottom ownership 和 overflow 判定保持现有行为。

## 4. 依赖有序的实施顺序

### 批次 1：关闭本地信任边界

实施：

1. P1-1 Daemon listener identity before credentials；
2. P1-2 Lease registry fail-closed corruption handling。

原因：

这两项决定跨进程信任和跨窗口所有权，必须先于更高层生命周期修复。

批次验收：

- 运行 daemon discovery、connection、lifecycle 和 session lease 定向测试；
- 增加恶意 listener、alive unrelated PID 和 corrupt registry 回归；
- `pnpm run typecheck`；
- `pnpm run lint:budgets`。

### 批次 2：修正 Durable Success 语义并统一 Changed Files 真相

实施：

1. P1-3 SessionRecoveryStore 与 TurnSnapshotStore 写入失败语义；
2. M2 Settled changed-file canonical owner 和旧数据兼容读取。

依赖：

必须先让持久化失败可观察，再删除重复 truth source，否则迁移过程仍可能静默丢数据。

批次验收：

- 运行 recovery store、turn snapshot、ChatController recovery 和 Review settled-file 定向测试；
- 覆盖失败重试、Reload 一致性和旧数据读取；
- `pnpm run typecheck`；
- `pnpm run lint:budgets`。

### 批次 3：完成 Session 与 Browser Dev 生命周期

实施：

1. P2-2 Recovered Turn terminal truth；
2. P2-3 Process/Daemon resource rollback；
3. P2-4 Browser Dev startup cancellation。

批次验收：

- 对每个资源获取阶段执行故障注入；
- 运行 FactoryDroidRuntime、daemon session、recovery 和 BrowserDevBridge 定向测试；
- 确认无 child process、attachment、lease、server、interval 或 subscription 泄漏；
- `pnpm run typecheck`；
- `pnpm run lint:budgets`。

### 批次 4：让 Review 状态与 I/O 收敛

实施：

1. P2-1 Review queue rejection recovery；
2. M3 Branch diff single-read projection；
3. M4 Watcher refresh coalescing 和 bounded I/O。

依赖：

先修复 queue tail，再改变 watcher 排队和 branch state 投影，避免新流量继续建立在可中毒队列上。

批次验收：

- 运行 ReviewCoordinator、ReviewDock 和 Git flow 定向测试；
- 证明失败后 replay 可继续、Branch open 只读一次 diff、事件风暴被合并；
- `pnpm run typecheck`；
- `pnpm run lint:budgets`。

### 批次 5：收敛 Guard、Bridge 契约和 Question 坐标规则

实施：

1. M1 operation-class eligibility；
2. M5 typed parser coverage；
3. M6 shared question boundary semantics。

原因：

这些是防止再次漂移的局部结构修复。应在前四批行为稳定后进行，不与 correctness fix 混写。

批次验收：

- 为 guard exception、parser coverage 和 question boundary 运行最小回归；
- 新 union member 缺 parser 时必须产生编译错误；
- `pnpm run typecheck`；
- `pnpm run lint:budgets`。

## 5. 全计划退出条件

全部批次完成后：

1. 七个 correctness/security failure path 都有直接回归；
2. 六项维护债务的重复来源或漂移点已按本计划收敛；
3. `pnpm run typecheck` 通过；
4. `pnpm run lint:budgets` 通过，现有超限文件不增长；
5. `pnpm run build` 通过；
6. 产品事实变化同步写入 `docs/STATUS.md`；
7. 若用户要求发布安装，再按顺序执行 VSIX package、verify 和 install；
8. 每个批次独立提交，不把无关重构、生成产物或用户改动混入提交。

## 6. 明确非目标

- 不在本计划提交中实现任何生产修复；
- 不因文件超过 1000 行就进行无行为目标的拆分；
- 不重写整个 ChatController 或 Runtime 状态机；
- 不创建通用 storage、migration、queue 或 watcher 框架；
- 不增加 schema/codegen 依赖；
- 不合并具有不同语义的所有 scroll threshold；
- 不处理未确认、不可达或纯风格性的审计意见；
- 不改变 Droid Runtime 能力、Review 产品范围或现有 UI 视觉设计。
