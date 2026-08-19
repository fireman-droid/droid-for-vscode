# Daemon 化运行调研与架构设计

> 状态（2026-08-12 更新）：**已实施，仅存档**——Phase 0（凭据）、
> Phase 1（只读 sidecar）、Phase 2（执行链路，默认关闭）、Phase 3
> （Reload 存活基础设施）均已落地，见 `implementation-status.md`
> 「运行架构」。遗留收尾（Webview 重连对账 UI 等）与后续机会见
> [`daemon-feature-opportunities.md`](./daemon-feature-opportunities.md)。
> 以下为调研定稿原文（当时状态：调研完成，未实施）。
> 依据：`@factory/droid-sdk` 0.7.0（`node_modules` 内类型定义与官方文档）、
> Droid CLI 0.193.0（`droid --help` / `droid daemon --help` 实测）、
> 只读探针 `artifacts/probe-daemon-handshake.mjs`（2026-08-11 实测输出）。

## 0. 结论摘要

| 问题 | 结论 |
| --- | --- |
| SDK 是否有公开的 daemon 客户端实现 | **有，且完整**。`connectToDaemon` 高层门面 + `DaemonClient`/`WebSocketDaemonTransport`/`DaemonSessionController` 低层组件全部从根入口 `@factory/droid-sdk` 公开导出，不是"只有类型" |
| daemon 如何启动 | `droid daemon --port <n> --host 127.0.0.1`（另支持 `--unix <path>` 与 `--listen ipc`）。CLI 不会自动拉起常驻 daemon，需要我们自己管理生命周期 |
| 认证 | **硬性要求**：`daemon.authenticate` 必须携带 `token` 或 `apiKey`（客户端 Zod 校验直接拒绝空凭据；实测伪造凭据被服务端拒绝）。未认证连接连方法都不可见（"Method not found"）。~~扩展拿不到 CLI 凭据是硬缺口~~ **已推翻，见第 6 节**：`~/.factory/auth.v2.*` 是"密钥就放在旁边"的对称加密，扩展进程内可直接解密复用免费登录 token，**daemon 化可零配置复活** |
| 断线重连/事件补收 | SDK 内建：`DaemonSessionController` 有 `scheduleReconnect`/`attemptReconnect`/`ensureSessionLoaded`；`daemon.load_session` 返回 `pendingPermissions`/`pendingAskUserRequests`/`queuedMessages`，控制器有 `replayBufferedPermissionOnLoad`/`replayBufferedAskUserResponses`。会话在客户端断开后继续在 daemon 内运行（`detach()` 文档原话："The session keeps running in the daemon."） |
| Reload Window 中途任务存活 | **可行**，前提是：① daemon 以脱离扩展主机生命周期的方式运行（不能带 `--parent-pid <扩展主机 pid>`）；② 扩展持有可用凭据完成重连认证（**已解决**：解密复用 CLI 免费登录 token，见第 6 节）。对账方式是"重取历史 + 补投 pending 请求"，不保证逐字节补发流式增量 |
| 凭据复用（零配置） | **成立（结论 a）**。实测：解密 `~/.factory/auth.v2.*` 得到 WorkOS JWT → `connectToDaemon({ auth: { apiKey: <JWT> } })` 认证成功并跑通只读 RPC。无需用户提供付费 API key。详见第 6 节 |
| 推荐路线 | 三阶段：先只读 sidecar（归档/列表/搜索），再迁执行链路（配置开关灰度），最后做 reload 存活（脱管 daemon + 重连对账）。**前置凭据问题已解决**，Phase 0 从"要用户给 key"改为"接入凭据解密器" |

---

## 1. SDK 的 daemon 公开面

### 1.1 两个运行时入口

- `@factory/droid-sdk/node`：现用路径。`ProcessTransport` 拉起 `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc` 子进程（本机实测正在运行的就是这条命令行）。
- `@factory/droid-sdk`（根入口）：daemon 客户端。**以下符号全部在 `dist/index.d.ts` 的导出表里确认为公开导出**（非仅类型声明）：

| 类别 | 公开导出符号（证据：`dist/index.d.ts` 导出表） |
| --- | --- |
| 高层门面 | `connectToDaemon(options: ConnectToDaemonOptions): Promise<ConnectedDroid>`、`connectAndAuthenticate`、`connectWithRetry` |
| 客户端/传输 | `DaemonClient`（类）、`createWebSocketDaemonClient(config)`、`WebSocketDaemonTransport`（类）、`FactoryDaemonTransport`（枚举值 `in_process`/`ipc`/`ws_direct`/`ws_localhost`/`ws_relay`）、`DaemonClientTransportKind`（`websocket`/`ipc`/`in_process`） |
| 重连/多会话状态 | `DaemonSessionController`（类）、`MultiSessionStateManager`（类） |
| 认证类型 | `DaemonAuth { apiKey: string }`、`DaemonAuthenticationMode`（枚举 `Token = "token"` / `Trusted = "trusted"`） |
| 常量 | `DEFAULT_LOCAL_DAEMON_WS_URL = "ws://localhost"`、`IPC_DAEMON_URL = "ipc://daemon"`、`LOCAL_MACHINE_ID` |
| 错误 | `ConnectionClosedError`（带 `closeCode`/`closeReason`）、`JsonRpcRequestError`、`WebSocketConnectionError`、`AbortError`、`ClientDestroyedError`、`SessionReplacedError` |

仅类型/接口（无运行时值，但配套实现已导出）：`ConnectToDaemonOptions`、`ConnectedDroid`、`ConnectedDroidSession`、`CreateDaemonSessionOptions`、`ResumeDaemonSessionOptions`、`DaemonSessionSummary`、`IDaemonClient`、`DaemonClientTransport`、`DaemonIpcMessageChannel`、`InProcessDaemonClientTransportOptions`。

### 1.2 连接方式

- **WebSocket（我们可用的方式）**：`connectToDaemon({ url: 'ws://127.0.0.1:<port>', auth: { apiKey } })`。`WebSocketDaemonTransportConfig` 支持 `getAccessToken`（token 模式）。
- **Unix socket**：daemon 侧 `--unix <path>` 支持；SDK 客户端 URL 是否支持 `ws+unix` 未验证（Windows 上不适用，忽略）。
- **IPC（`ipc://daemon`）/ InProcess**：`DaemonIpcMessageChannel` 的形状（`onDisconnect?(event?: DesktopDaemonDisconnectEvent)`）表明这是 Factory Desktop 应用的宿主内通道；`InProcessDaemonClientTransport` 是 CLI 自己进程内嵌 daemon 用的。两者都不适合"扩展主机重启后重连"场景——通道随宿主进程消亡。**对我们唯一有意义的是 WebSocket localhost。**

### 1.3 认证/握手（实测）

`DaemonAuthenticateRequestParams`：`{ caller: string; apiKey?; token?; actAsGrant? }`，返回 `{ userId, orgId }`。

探针实测（`artifacts/probe-daemon-handshake.mjs`，私有 daemon，端口随机）：

1. **未认证直接调用** `daemon.list_available_sessions` → `JsonRpcRequestError: Method not found`。daemon 在认证成功前不注册任何会话方法，没有"本地免认证只读"的后门。
2. **无凭据认证**（只给 `caller`）→ 客户端 Zod 校验直接抛错：`"Either token or apiKey must be provided"`，请求根本不会发出。
3. **伪造 apiKey** → 服务端 `RPC Error: Internal error`；`connectToDaemon` 门面把它归一为 `ConnectionFailureError: "Authentication failed. Please sign in again."`——说明 apiKey 是拿到 Factory 后端验真的，认证时需要网络。
4. `DaemonAuthenticationMode.Trusted` 在类型里存在，但 `droid daemon --help` 没有任何开启它的旗标；它对应 Desktop 的 IPC/InProcess 通道，不是我们能走的路。

**凭据来源缺口**：`~/.factory/auth.v2.file` + `auth.v2.key` 是加密存储（实测非 JSON、内容为密文），SDK 不导出解密/读取器，CLI 没有 `droid auth token` 之类的导出命令。Node 入口的 `apiKey` 默认读 `FACTORY_API_KEY` 环境变量（本机未设置）。SDK 文档也明说："Browser daemon authentication currently requires an API key."。**结论：daemon 化的前置条件是用户向扩展提供 Factory API key（存 VS Code SecretStorage），或 Factory 未来提供本地信任模式/凭据委托。**

### 1.4 `daemon.*` RPC 方法清单（`DaemonDroidMethod` 枚举 + `DaemonClient` 方法）

会话生命周期：`daemon.initialize_session`、`daemon.load_session`、`daemon.close_session`、`daemon.add_user_message`、`daemon.interrupt_session`、`daemon.kill_worker_session`、`daemon.resolve_queued_user_message`。

查询/管理（Phase 1 只读价值最高的部分加粗）：**`daemon.list_available_sessions`**、**`daemon.list_opened_sessions`**、**`daemon.get_session_messages`**、**`daemon.search_sessions`**、**`daemon.archive_session`**、**`daemon.unarchive_session`**、`daemon.rename_session`、`daemon.fork_session`、`daemon.execute_rewind`、`daemon.get_rewind_info`、`daemon.compact_session`、`daemon.get_context_stats`、`daemon.get_context_breakdown`、`daemon.update_session_settings`、`daemon.change_working_directory`。

能力目录：`daemon.list_skills`、`daemon.set_skill_disabled`、`daemon.list_commands`、`daemon.list_mcp_servers`、`daemon.list_mcp_tools`、`daemon.list_mcp_registry`、`daemon.add_mcp_server`、`daemon.remove_mcp_server`、`daemon.toggle_mcp_server`、`daemon.toggle_mcp_tool`、`daemon.authenticate_mcp_server`、`daemon.list_custom_models`、`daemon.list_git_branches`、`daemon.list_terminals`、plugins/marketplaces/automations/crons 系列。

杂项：`daemon.authenticate`、`daemon.logout`、`daemon.warmup_cache`、`daemon.submit_bug_report`。

高层资源门面 `ConnectedDroid extends DaemonResources`：`sessions`（`list/create/resume/getMessages/search/archive/unarchive/rename/updateSettings/resolveQueuedMessage/killWorker/getRewindInfo/rewind/compact/fork/getContextBreakdown/listOpened`）+ `workspace/settings/customModels/terminals/mcp/skills/commands/plugins/marketplaces/automations/git/feedback/unstable` 资源。**归档能力（session-management-design.md 第 1 节登记的缺口）在这里直接可用。**

### 1.5 会话 API 与现有 Runtime 的形状对比（迁移成本关键）

`ConnectedDroidSession`（`index-D_SzTnFR.d.ts` 107698 行）：

```
id / settings / cwd
stream(prompt, { includePartialMessages: true }): AsyncGenerator<DroidStreamEvent>
interrupt() / rename() / compact() / fork() / rewind()
detach()   // 停止收事件，会话继续在 daemon 里跑
close()    // 结束 daemon 内会话
```

`stream()` 的返回形状与 Node SDK 会话一致（`DroidStreamEvent` 异步生成器），`create/resume` 同样接受 `permissionHandler`/`askUserHandler`。这意味着 `FactoryDroidRuntime.sendTurn` 的事件归一化层（`normalizeSdkEvent`）和交互回调层（`runtimeInteractions`）**基本可以原样复用**。

差异点（需要适配）：

- 能力方法的位置不同：Node 会话把 `listSkills/listCommands/listMcpServers/getContextStats` 等挂在会话对象上；daemon 侧挂在 `ConnectedDroid` 的资源上、以 `sessionId` 为参数（如 `droid.skills.list(sessionId)`、`droid.mcp.listServers(sessionId)`）。
- 替换型操作语义不同：Node 会话 rewind/compact/fork 后源句柄"退役"；daemon 会话源句柄仍可用并返回 `newSessionId`（SDK 文档明确）。`FactoryDroidRuntime` 目前的"切换目标会话"逻辑要按此调整。
- 模型目录：现在靠 `modelCatalogCaptureTransport` 从初始化流里截获 `availableModels`；daemon 侧可改用 `daemon.list_custom_models` + `initialize_session` 结果。

### 1.6 断线重连与事件补收（reload 存活的机制依据）

- `DaemonSessionController`（公开导出）：`scheduleReconnect`/`attemptReconnect`/`pollUntilConnected`/`handleConnectionClose`/`autoAuthenticate`/`ensureSessionLoaded`/`replayBufferedPermissionOnLoad`/`replayBufferedAskUserResponses`，配 `reconnectionStrategy`。
- `daemon.load_session` 结果含 `pendingPermissions`、`pendingAskUserRequests`、`queuedMessages`（`PendingPermission`/`PendingAskUserRequest` 类型带 `isRestored?: boolean` 标记）——重连后未决的权限/提问请求会补投给新客户端。
- 历史消息可通过 `daemon.get_session_messages` 全量重取。
- **边界**：SDK 没有承诺补发断线期间错过的流式增量（`assistant_text_delta` 等）。对账模型是"状态对账"而非"事件重放"：重连后重取持久化消息 + 接收补投的 pending 请求 + 继续接收后续通知。对 UI 意味着 reload 后重渲染历史，正在生成的那条消息在完成后以完整形态出现。
- SDK 文档明确的多客户端限制："Daemon replacement locking does not coordinate separate clients."——两个窗口不能同时 attach 同一个会话做替换型操作。

## 2. CLI 侧证据

- `droid daemon --help`（0.193.0）：`--port/--host/--unix/--listen websocket|ipc/--enable-child-ipc/--droid-path/--liveness-fd/--parent-pid/--remote-access/--settings/--debug`。`--parent-pid`/`--liveness-fd` 提供父进程存活联动（探针已验证 `--parent-pid` 生效）。
- 探针实测启动：约 1.5 秒可连接（`loadShellEnvironment` 约 0.9s + `daemon.start()` 约 0.1s），stdout 打印 `WebSocket endpoint: ws://127.0.0.1:<port>`、PID、日志目录 `~/.factory/logs`。
- `~/.factory` 无 daemon 的 socket/port/pid 发现文件；无全局约定端口（`DEFAULT_LOCAL_DAEMON_WS_URL` 只是 `ws://localhost` 前缀，不带端口）。**服务发现要自己做。**
- 本机运行中的 `droid.exe`（PID 62208）命令行为 `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc`，是本扩展 ProcessTransport 的子进程；`netstat` 显示它只有一个回环监听端口（Sentry/内部用），**本机没有现成 daemon 在跑**。
- `droid --help` 无 `auth`/`token` 子命令；凭据无 CLI 导出途径。

## 3. 迁移设计

### 3.1 总体拓扑

```
每窗口:  Webview ── Bridge ── Extension Host ── FactoryDroidRuntime
                                                    │ ws://127.0.0.1:<port>（apiKey 认证）
本机单例: droid daemon（脱管进程，持有全部会话与执行）
```

### 3.2 连接管理（新增 `src/runtime/daemon/` 模块，建议 3 个窄模块）

1. **`daemonLifecycle.ts`**：确保本机有一个可用 daemon。
   - 发现：读自有发现文件（建议 `~/.droidvisx/daemon.json`：`{ port, pid, version, startedAt }`），健康检查失败则视为陈旧。
   - 拉起：`spawn('droid', ['daemon','--port',p,'--host','127.0.0.1'], { detached: true, stdio: 'ignore' })` + `unref()`。**不得**传 `--parent-pid`，否则 reload 即死，daemon 化失去意义。
   - 并发拉起竞争：发现文件写入用 `wx` 独占创建 + 端口探测重试，输掉竞争的一方改连赢家。
   - 版本漂移：发现文件记 CLI 版本，`droid update` 后由新连接方检测不一致并提示重启 daemon。
   - 孤儿治理：daemon 没有"无客户端自动退出"旗标（缺口），需要提供显式 `DroidVisX: Shut Down Daemon` 命令（daemon 协议未见 shutdown RPC，用 PID 终止）。
2. **`daemonConnection.ts`**：每窗口一个 `connectToDaemon` 连接；apiKey 从 `ExtensionContext.secrets` 读取；`onAuthenticationError` 驱动"重新输入 key"流程；断线交给 SDK 的重连控制器，向上只暴露 `connected/reconnecting/failed` 状态给 Bridge（映射到现有 availability 事件）。
3. **`DaemonDroidRuntime.ts`**：实现现有 `DroidRuntime` 接口（`src/runtime/DroidRuntime.ts`），内部持 `ConnectedDroid` + `ConnectedDroidSession`。

### 3.3 切换点（改动最小化）

现有 `createLocalDroidSession`（`FactoryDroidRuntime.ts` 1256 行）已经把 `createTransport/createSession/resumeSession` 做成了注入的 `LocalSessionDependencies`。迁移不必重写 `FactoryDroidRuntime` 的事件归一化/交互/设置投影逻辑：

- 方案：新增 `DaemonSessionDependencies` 平行实现——`createSession` → `droid.sessions.create({ cwd, permissionHandler, askUserHandler })`，`resumeSession` → `droid.sessions.resume(sessionId, {...})`；能力方法（skills/commands/MCP/contextStats）改走 `ConnectedDroid` 资源并透传 `sessionId`。
- 由 `droidvisx.runtime.mode: "process" | "daemon"`（默认 `process`）在扩展激活时选择路径，保证可回退。

### 3.4 会话所有权与多窗口隔离

- 所有权登记在扩展侧：每窗口只 attach 自己创建/恢复的 sessionId（现状已按窗口隔离，延续即可）。
- 会话列表 UI（若做）按 `cwd`/`repoRoot` 过滤（`DaemonSessionSummary` 带 `repoRoot`）。
- 禁止双窗口同时 resume 同一 sessionId：在发现文件旁维护 `sessions-attached.json`（pid + sessionId 租约，陈旧 pid 自动失效）。这是纯客户端约定，因为 daemon 不做跨客户端替换锁（SDK 文档明确）。

### 3.5 断线重连与状态对账（reload 后恢复中途 turn）

1. reload 前：Extension Host 把"活动 sessionId + turn 进行中标记"写入 `workspaceState`（现有会话恢复机制已持久化 sessionId，补一个 in-flight 标记）。
2. reload 后：连接 daemon → `sessions.resume(sessionId)`（内部 `daemon.load_session`）→ 取回消息全量 + `pendingPermissions`/`pendingAskUserRequests`（`isRestored: true` 补投到我们的 `permissionHandler`/`askUserHandler`，走现有 Interactions UI）。
3. UI 对账：Webview 以 `get_session_messages` 结果重建时间线；若 daemon 报告工作状态仍是 running（`DroidWorkingStateChangedNotification`），显示"生成中"占位，后续完成消息到达时落地。**不追求恢复逐 token 打字机效果。**
4. 中断语义：reload 期间用户无法点停止——恢复连接后 `interrupt()` 仍可用。

### 3.6 缺口清单（诚实评估）

| 缺口 | 影响 | 对策 |
| --- | --- | --- |
| 扩展拿不到 CLI 登录凭据 | **硬阻塞**：无 API key 就无法认证 | 让用户在扩展里录入 Factory API key（SecretStorage）；跟进 Factory 是否提供 trusted localhost / 凭据委托 |
| 认证需访问 Factory 后端 | 离线时连不上 daemon（现 ProcessTransport 路径同样需要登录态，非倒退） | 连接失败归类为 availability 事件提示 |
| 无 daemon 服务发现约定 | 需自建发现文件 + 竞争处理 | 3.2 方案 |
| 无"无客户端自动退出"/shutdown RPC | 孤儿 daemon 常驻 | 显式关闭命令 + 文档说明 |
| 流式增量不保证补发 | reload 后打字机中断，只有完整消息 | 接受；UI 用状态对账 |
| 多客户端替换锁缺失 | 双窗口同会话可能互踩 | 客户端租约（3.4） |

### 3.7 被否决的替代：detached ProcessTransport

"保持 ProcessTransport 但 detached 子进程 + 重连"不可行：`droid exec --input-format stream-jsonrpc` 的会话通道就是 stdio 管道，父进程（扩展主机）死亡即管道关闭，且没有任何机制向一个已存在进程的 stdio 重新附着。stdio 一次性通道是这条路径的本质限制，部分 daemon 化只能走真 daemon。

## 4. 分阶段路线、工作量与验收

### Phase 0 — 凭据与中途重连探针（0.5–1 天）

- 用户提供真实 API key，跑通 `connectToDaemon` 完整握手（探针已备好，改一行凭据即可）。
- 追加探针：daemon 内起会话发长 turn → 杀客户端进程 → 新客户端 resume → 断言 turn 继续完成、`load_session` 返回预期 pending 状态。
- 验收：两个探针输出登记进本文档附录。**此阶段结果决定是否继续。**

### Phase 1 — 只读 sidecar（2–4 天）

- daemon 生命周期模块 + SecretStorage key 录入流程 + 只读能力接入：会话列表/搜索/**归档/取消归档**（补齐 session-management-design.md 缺口）。执行链路不动，仍走 ProcessTransport。
- 验收：Cursor 内可视验证归档往返；`implementation-status.md` 同步更新。

### Phase 2 — 执行链路迁移（5–8 天）

- `DaemonSessionDependencies` + 能力方法资源化改造 + 替换型操作（rewind/compact/fork）新语义适配 + `runtime.mode` 开关；全量回归现有 runtime 测试（现有测试注入 seam 使这部分可控）。
- 验收：daemon 模式下现有全部功能等价（发消息/权限/askUser/技能/命令/MCP/上下文统计）；`runtime.mode=process` 回退可用。

### Phase 3 — Reload 存活（4–6 天）

- 脱管 daemon（去 `--parent-pid`）+ 发现文件竞争 + in-flight 标记 + 重连对账 UI + 会话租约。
- 验收脚本设计：
  1. 自动化：Node 脚本模拟两代客户端——客户端 A 建会话发"写 10 个文件"类长任务，任务中途 `process.exit()`；客户端 B 3 秒后 resume，断言收到 running 状态、pending 请求补投、最终 result 消息到达。
  2. 手动：Cursor 中发长任务 → 任务中途 `Developer: Reload Window` → 面板恢复后时间线完整、任务继续/完成、权限弹窗（若有）重新出现。
- 合计：**11.5–19 天**（不含 Factory 侧凭据方案变化带来的返工）。

## 附录：探针实测输出（2026-08-11，droid 0.193.0）

```
PRE-AUTH RPC listAvailableSessions: FAILED: JsonRpcRequestError - Method not found: daemon.list_available_sessions
AUTH-NO-CREDENTIALS: FAILED: ZodError - "Either token or apiKey must be provided"
AUTH-DUMMY-APIKEY: FAILED: JsonRpcRequestError - RPC Error: Internal error
FACADE-DUMMY-APIKEY: FAILED: ConnectionFailureError - Authentication failed. Please sign in again.
```

daemon 启动横幅：`WebSocket endpoint: ws://127.0.0.1:<port>`，PID 与日志目录（`~/.factory/logs`）随附；`--parent-pid` 联动退出已验证。

---

## 6. 凭据复用可行性深挖

> 追加调研（2026-08-11）。目标：验证"复用 Droid CLI 免费登录态、而非让用户提供付费 API key"是否可行。
> 探针：`artifacts/probe-credential-decrypt.mjs`、`artifacts/probe-daemon-token-auth.mjs`（均只读；**从不打印任何凭据明文**）。

### 6.1 分级结论：**a）能直接读 + 复用登录凭据，daemon 化可零配置复活**

三条证据链全部实测通过：

1. **凭据文件可在扩展进程内解密**（无 OS keychain 依赖）。
2. **解密出的正是 WorkOS JWT access token**，即 `daemon.authenticate` 的 `token` 字段所需类型。
3. **用该 token 认证私有 daemon + 跑只读 RPC 全部成功**，且高层 `connectToDaemon` 门面直接可用。

不需要 `FACTORY_API_KEY`，不需要用户任何配置。结论 (b)（绑 OS keychain 无法解密）、(d)（走不通）均被排除；结论 (c)（CLI 导出 token 命令）不成立但也不需要（见 6.5）。

### 6.2 凭据到底怎么存的（结构证据）

`~/.factory` 下相关文件（探针实测，仅报告结构）：

| 文件 | 大小/形态 | 结论 |
| --- | --- | --- |
| `auth.v2.key` | 44 字符，全 base64，解码 **正好 32 字节**；无 DPAPI magic（非 `01 00 00 00`） | **明文 AES-256 密钥**（base64 编码），未受 OS 保护 |
| `auth.v2.file` | `base64(iv):base64(tag):base64(ciphertext)`，分段解码为 **16 / 16 / 1476 字节** | **AES-256-GCM 密文**：16B IV + 16B GCM 认证标签 + 密文 |
| `host.json` / `computer.json` | 明文 JSON | 主机/computer 标识，非敏感凭据 |

**这是"把钥匙和保险箱放在一起"**：解密密钥 (`auth.v2.key`) 就以明文躺在密文 (`auth.v2.file`) 旁边。node 标准库 `crypto.createDecipheriv('aes-256-gcm', key, iv)` + `setAuthTag(tag)` 即可解密，**没有绑定 Windows DPAPI / `safeStorage` / keytar**（探针在普通 Node 进程内解密成功即为铁证）。这等于混淆而非真加密——对我们是好消息。

解密后 payload 顶层字段（**仅字段名，绝不含值**）：`access_token`（JWT）、`refresh_token`、`active_organization_id`。JWT claim 名集合含 `iss=https://api.workos.com`、`sub`、`org_id`、`exp` 等；`exp` 实测约 **17 小时**后过期，配 `refresh_token` 续期。

### 6.3 SDK/CLI 内部如何拿凭据（为什么现状能免配置工作）

- 现用 ProcessTransport 路径：`FactoryDroidRuntime` 注入的 `createTransport` 是 `new ProcessTransport({ cwd, observability })`——**不注入 `FACTORY_API_KEY`**（实测本机该环境变量不存在，扩展照常工作）。SDK 的 `node.mjs` 里 `.factory` 只被用于 HOME/sessions/logs 路径解析，**没有任何 `auth.v2` / `createDecipheriv` / `safeStorage` 读取逻辑**（全量关键字扫描为 0）。
- 结论：**凭据读取发生在 `droid` 可执行文件内部**，不在 Node SDK 里。SDK 只负责 spawn `droid exec …`，由 CLI 子进程自读 `auth.v2` 自认证。SDK 里唯一的凭据入口是 `helpers.ts` 的 `resolveApiKey(apiKey ?? process.env.FACTORY_API_KEY)`，且仅在调用方**没有自带 transport** 时才用——我们的运行时自带 transport，所以从不触发。

### 6.4 连 daemon 的握手参数全集与"token 复用"接入点（关键）

`DaemonAuthenticateRequestParams`（`index-D_SzTnFR.d.ts` 45196 起）字段：

- `token?`：**"WorkOS JWT access token"**（就是我们解密出来的 `access_token`）。
- `apiKey?`：**"Factory API key (fk-*)"**。
- `actAsGrant?`：服务账号委托（`fdg-*`），本场景不用。
- `caller`（必填）、`connectionId?`、`metadata.tracing?`。

**高层 `connectToDaemon` 可直接复用 token**（重要且反直觉）：其实现 `getAccessToken = () => Promise.resolve(options.auth.apiKey)`，而 `DaemonSessionController.authenticate` 把 `getAccessToken()` 的返回值**一律作为 `token` 字段**发给 `daemonClient.authenticate({ token, … })`（`chunk-5UXINOXG.mjs` 实测）。也就是说 `ConnectToDaemonOptions.auth.apiKey` 是**命名误导**——传进去的字符串走的是 `token` 通道。所以把解密出的 JWT 放进 `auth: { apiKey: <JWT> }` 即可，**无需降到低层手搓 `DaemonClient`**。（这也解释了 5.x 节里"伪造 apiKey 被拒"——那串 `fk-probe-invalid` 实际是被当 `token` 校验的，非 JWT 自然失败。）

两条接入路径都实测通过（`probe-daemon-token-auth.mjs`）：

- 低层：`createWebSocketDaemonClient({ machineType:'local' }).authenticate({ caller, token })` → 返回 `{ userId, orgId }`。
- 高层：`connectToDaemon({ url, auth: { apiKey: <JWT> } })` → 拿到完整 `ConnectedDroid`（`sessions` / `skills` 等资源齐备），`sessions.list` 成功。

### 6.5 CLI 能不能导出 token（结论 c 核查）

`droid --help`（0.193.0）子命令只有 `exec / daemon / search / update / mcp / plugin / computer / help`——**无 `auth` / `token` / `whoami` / `print-access-token` 之类导出命令**。所以"让 CLI 吐 token"这条路不存在；但因为 6.2 的直接解密已成立，**不需要它**。

### 6.6 接入 FactoryDroidRuntime / daemon 连接的具体位置

在第 3 节的 `src/runtime/daemon/` 规划里新增一个 **`factoryCredentials.ts`**（约 30 行）：

```
readFactoryAccessToken(): { token: string; orgId: string; expiresAt: number }
// 读 ~/.factory/auth.v2.key + auth.v2.file → aes-256-gcm 解密 → JSON.parse
// 取 access_token / active_organization_id / JWT.exp
```

- **连接点**：`daemonConnection.ts` 里把它接到 `connectToDaemon({ url, auth: { apiKey: readFactoryAccessToken().token } })`。凭据只在内存中流转，不落盘、不进日志、不进 Bridge。
- **过期与续期**：JWT ~17h 有效。`connectToDaemon` 的 `onAuthenticationError` 触发时**重新读盘取最新 token 再重连**——因为常驻 `droid daemon` 进程会在后台用 `refresh_token` 刷新并回写 `auth.v2.file`，扩展只要"每次连接/重连都现读盘"即可拿到新鲜 token（不要缓存首个 token）。
- **未登录兜底**：若解密失败或文件不存在（用户从未 `droid` 登录），归类为 availability 事件，提示"请先在终端运行 `droid` 完成登录"——这与现状 ProcessTransport 需要登录态一致，不是倒退。

### 6.7 对路线图的影响

- **Phase 0 重定义**：不再"等用户提供 API key"，而是"落地 `factoryCredentials.ts` 解密器 + 用真实 token 跑通 6.4 的两条握手"（已用探针预验证，实现成本 <0.5 天）。
- **风险登记**：Factory 若未来把 `auth.v2.key` 改为 DPAPI/`safeStorage` 包裹（真加密），本方案即失效、需回退到"用户提供 API key 或 CLI 提供官方 token 导出"。当前 0.193.0 未加此保护。属于"依赖内部存储格式"的脆弱点，需在 `implementation-status.md` 标注，并对 CLI 版本升级保持警惕。
- 该风险不影响 Phase 1/2/3 的其余设计；凭据来源从"用户配置"降级为"内部解密适配器"，其余不变。

### 6.8 安全与合规注记

- 探针遵守约束：解密仅在内存进行，输出只有布尔/结构/成败，**无任何凭据明文**落到回复或磁盘。
- 生产实现应：token 仅存内存、不写 `workspaceState`/日志/诊断导出；`describeUnknown` 等日志工具需确保不会序列化到 token；若做诊断导出需对 `Authorization`/`token` 字段脱敏。

### 6.9 附录：凭据复用探针实测输出（脱敏）

```
# probe-credential-decrypt.mjs
key bytes: 32 | file segments: 3 | seg byte lens: 16,16,1476
DECRYPT SUCCESS via aes-256-gcm iv=16. Payload shape (names+types only, NO values):
    access_token: string(jwt-like)
    refresh_token: string(short)
    active_organization_id: string(short)

# probe-daemon-token-auth.mjs
token decrypted in-memory: true | looks like JWT: true | orgId present: true
TOKEN AUTH: SUCCESS — userId present: true | orgId present: true
POST-AUTH listAvailableSessions: SUCCESS — 3 rows (values not printed)
FACADE connectToDaemon({auth.apiKey=<JWT>}): SUCCESS — 3 sessions; resources present: true
```
