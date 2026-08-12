# DroidVisX Daemon 化实现计划（自包含执行手册）

> 状态（2026-08-12 更新）：**本计划已执行完毕，仅存档**——Phase 0–3
> 均已落地（见 `implementation-status.md`「运行架构」与验证状态）。
> 正文（含 §0"仅 Phase 0 已落地"的基线描述）为执行前快照，请勿再按
> 本文开工。遗留收尾（Webview 重连对账 UI、`sessions.getMessages`
> 异常核对）见 implementation-status 与
> [`daemon-feature-opportunities.md`](./daemon-feature-opportunities.md) §A4。
>
> 本文件是给**接续 AI 独立执行**的完整实现计划。执行者只能看到本文件 + 仓库代码，
> 看不到产生本计划的对话。因此本文自包含：关键证据、API 用法、文件锚点、验收脚本
> 全部写在文内，不需要去翻其它文档才能理解。
>
> 只读参考（可看但不要依赖其存在）：`docs/product/daemon-architecture-design.md`（同一批调研的详版）。
> 探针脚本（已存在，可直接跑复核）：`artifacts/probe-daemon-handshake.mjs`、
> `artifacts/probe-daemon-token-auth.mjs`。
>
> **凭据模块约束（接续 AI 必读）**：Phase 0 已交付
> `src/runtime/daemon/factoryCredentials.ts`。**禁止**打开、阅读、解读、修改或重构该文件及其单测；
> **禁止**直接读取 `~/.factory/auth.v2.*`。需要 token 时**仅**调用公开函数
> `readFactoryAccessCredential()`（用法见 §2.5），把该模块当作黑盒。
>
> 环境基线：Windows / PowerShell；`@factory/droid-sdk` 版本 `0.7.0`；`droid` CLI 版本 `0.193.0`；
> 扩展 `package.json` version `0.0.0`。

---

## 0. 前置状态（开始本计划时的仓库基线）

- **daemon 化仅 Phase 0 已落地。** `src/runtime/daemon/factoryCredentials.ts` 及其单测已存在；
  其余 daemon 模块（连接、生命周期、目录、执行迁移等）**尚未实现**。
  调研文档（`docs/product/daemon-architecture-design.md`）与 `artifacts/` 探针仍可供复核。
- 当前运行架构（本计划要改造的对象）：每个 VS Code/Cursor 窗口的扩展主机通过
  `@factory/droid-sdk/node` 的 `ProcessTransport` 拉起自己的 `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc` 子进程。
  **子进程随扩展主机生命周期存亡**——`Developer: Reload Window` 会杀掉正在执行的回合。
- V1 功能切片进度（发消息 / 权限 / askUser / 技能 / 命令 / MCP / 上下文统计 / 会话历史恢复
  等）以 `docs/product/implementation-status.md` 为准（**只读引用，不要把其内容抄进本计划以免过时**）。
- **另一个代理正在编辑** `docs/product/implementation-status.md` 与
  `docs/product/session-management-design.md`。执行本计划时若这两个文件已稳定，按 §5 要求
  更新 `implementation-status.md`；除此之外不要触碰它们。

---

## 1. 目标与验收标准

### 1.1 要解决的问题

1. **Reload / 重启窗口不杀正在执行的回合**（首要目标）。用户在长任务执行途中
   `Reload Window`，回合应继续在后台跑完，重连后 UI 能恢复到该会话并看到最终结果。
2. **打通只存在于 daemon 协议里的能力**：归档 / 取消归档（`daemon.archive_session` /
   `daemon.unarchive_session`）、跨会话搜索（`daemon.search_sessions`）、统一会话列表。
   现状 `ProcessTransport` 会话对象无这些方法。
3. **消除"每次查询都拉起一次性进程"**：当前 `FactorySessionCatalog`
   （`src/runtime/FactorySessionCatalog.ts`）用 `listSessions`（`@factory/droid-sdk/node`）
   每次都短暂拉起 CLI。daemon 常驻后改走一条持久连接。

### 1.2 每阶段可观测完成标准

| 阶段    | 完成标准（可观测、可验证）                                                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 | **（已完成）** `readFactoryAccessCredential()` 可用；`pnpm exec vitest run src/runtime/daemon/factoryCredentials.test.ts` 通过。可选：`artifacts/probe-daemon-token-auth.mjs` 输出 `TOKEN AUTH: SUCCESS` 且 `FACADE connectToDaemon(...): SUCCESS`。接续 AI 勿重复实现或审查凭据模块内部。 |
| Phase 1 | 打包安装扩展后，在 Cursor 里能对一个已存在会话执行"归档→列表消失→取消归档→列表恢复"往返；这条链路走 daemon 连接而非一次性进程（通过日志中出现单条持久 ws 连接确认）。现有执行链路（发消息等）行为不变。                                                                                         |
| Phase 2 | 设置 `droidvisx.runtime.mode: "daemon"` 后，V1 全部功能（发消息、权限、askUser、技能、命令、MCP、上下文统计、rewind/compact/fork/rename）与 `process` 模式行为等价；切回 `"process"` 完全回退可用。全量 `pnpm test` + 两个 typecheck 通过。                                                     |
| Phase 3 | **两代客户端存活脚本**（§3.4.5）断言通过：客户端 A 起长回合中途 `process.exit()`，客户端 B 重连后收到 `running` 状态、补投的 pending 请求、最终 result。**手动验收**：Cursor 里发长任务 → 任务中途 `Developer: Reload Window` → 面板恢复后时间线完整、任务继续/完成、（若有）权限弹窗重新出现。 |

---

## 2. 背景证据（自包含，每条可自行复核）

### 2.1 SDK 的两个入口

- `@factory/droid-sdk/node`（现用）：导出 `ProcessTransport` / `createSession` /
  `resumeSession` / `listSessions`。证据：`src/runtime/FactoryDroidRuntime.ts` 第 1–20 行
  的 import；`src/runtime/FactorySessionCatalog.ts` 第 1 行。
- `@factory/droid-sdk`（根入口，daemon 客户端）：以下符号**全部是运行时导出**（不是仅类型），
  证据在 `node_modules/@factory/droid-sdk/dist/index.d.ts` 的导出表：
  `connectToDaemon`、`DaemonClient`、`createWebSocketDaemonClient`、
  `WebSocketDaemonTransport`、`DaemonSessionController`、`MultiSessionStateManager`、
  `MachineType`、`DEFAULT_LOCAL_DAEMON_WS_URL`。

### 2.2 关键类型（证据：`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`）

```ts
// 行 106443
interface DaemonAuth { apiKey: string; }
// 行 106446
interface ConnectToDaemonOptions extends HandlerOptions { // HandlerOptions = { permissionHandler?, askUserHandler? }
  url: string;
  auth: DaemonAuth;
  onAuthenticationError?: (error: Error) => void;
  onError?: (error: Error) => void;
}
// 行 106417 —— connectToDaemon 返回的门面
interface DaemonResources {
  workspace; settings; customModels; ssh; updates; relay; terminals;
  mcp; skills; commands; plugins; marketplaces; automations; git; feedback; unstable;
}
interface ConnectedDroid extends DaemonResources { readonly sessions: SessionsResource; disconnect(): void; }
// 行 107686
interface SessionsResource extends SessionOperationsResource {
  list(options?): Promise<DaemonSessionSummary[]>;
  create(options): Promise<ConnectedDroidSession>;
  resume(sessionId, options?): Promise<ConnectedDroidSession>;
}
// SessionOperationsResource 还含: getMessages / search / archive / unarchive / rename /
//   updateSettings / resolveQueuedMessage / killWorker / getRewindInfo / rewind /
//   compact / fork / getContextBreakdown / listOpened
// 行 107698
interface ConnectedDroidSession {
  readonly id: string; readonly settings; readonly cwd: string | undefined;
  stream(prompt, { includePartialMessages: true }): AsyncGenerator<DroidStreamEvent>;
  interrupt(); rename(title); compact(customInstructions?); fork(options?); rewind(params);
  detach(): Promise<void>;  // 注释原文: "Stop receiving events. The session keeps running in the daemon."
  close(): Promise<void>;   // "End the session in the daemon, then detach."
}
```

`ConnectedDroidSession.stream(..., { includePartialMessages: true })` 产出 `DroidStreamEvent`
异步生成器，与现用 Node 会话形状一致——意味着现有 `normalizeSdkEvent`
（`src/runtime/normalizeSdkEvent.ts`）与交互回调 `runtimeInteractions`
（`src/runtime/runtimeInteractions.ts`）可基本原样复用。

**能力方法位置差异（迁移必须适配）**：Node 会话把 `listSkills/listCommands/listMcpServers/ getContextStats` 等挂在会话对象上；daemon 侧挂在 `ConnectedDroid` 资源上、以 `sessionId`
为参数（如 `droid.skills.list(sessionId)`、`droid.mcp.listServers(sessionId)`）。

**替换型操作语义差异**：Node 会话 rewind/compact/fork 后源句柄"退役"；daemon 会话源句柄
仍可用并返回 `newSessionId`。迁移时"切换目标会话"的逻辑要按此调整。

### 2.3 daemon 认证握手（证据：`index-D_SzTnFR.d.ts` 行 45196 起 `DaemonAuthenticateRequestParamsSchema`）

字段：`token?`（注释"WorkOS JWT access token"）、`apiKey?`（注释"Factory API key (fk-_)"）、
`actAsGrant?`（服务账号委托 `fdg-_`，本场景不用）、`caller`（**必填**字符串）、
`connectionId?`、`metadata?`。

**未认证连接连方法都不可见**：探针 `artifacts/probe-daemon-handshake.mjs` 实测——
认证前调用 `daemon.list_available_sessions` 返回 `JsonRpcRequestError: Method not found`。
无凭据认证被客户端 Zod 拒绝（`"Either token or apiKey must be provided"`）。
`droid daemon --help` 无任何开启"信任本地免认证"的旗标。**结论：必须认证。**

### 2.4 命名误导陷阱（本计划最关键的一条，务必理解）

高层 `connectToDaemon` 的 `auth.apiKey` 字段**实际走** `token` **通道**，不是 apiKey 通道。
证据：`node_modules/@factory/droid-sdk/dist/chunk-5UXINOXG.mjs` 中
`function connectToDaemon(options)` 实现：

```js
const getAccessToken = () => Promise.resolve(options.auth.apiKey);
const controller = new DaemonSessionController({ ..., config: { ..., getAccessToken, ... } });
await controller.attemptInitialConnection();
return createConnectedDroid(controller, options.auth.apiKey, options);
```

而同文件 `DaemonSessionController` 的 `authenticate` 把 `getAccessToken()` 的返回值
**一律作为** `token` **字段**发出：`this.daemonClient.authenticate({ token, ...caller... })`。

**含义**：把一个 WorkOS JWT 放进 `auth: { apiKey: <JWT> }` 即可用高层门面认证成功，
**无需降到低层手搓** `DaemonClient`。（这也解释了为何早期用 `fk-`\* 伪串当 apiKey 会失败——
它被当 `token` 校验、非 JWT 自然失败。）两条路径均已被 `artifacts/probe-daemon-token-auth.mjs`
实测通过：

- 低层：`createWebSocketDaemonClient({ machineType:'local' }).authenticate({ caller, token })` → `{ userId, orgId }`。
- 高层：`connectToDaemon({ url, auth: { apiKey: <JWT> } })` → 完整 `ConnectedDroid`，`sessions.list` 成功。

### 2.5 凭据获取（接续 AI 只读此节；勿打开实现文件）

**硬性约束**：`src/runtime/daemon/factoryCredentials.ts` 已由 Phase 0 交付。
接续 AI **禁止**打开、阅读、解读、修改或重构该模块及其单测；**禁止**直接读取
`~/.factory/auth.v2.*` 或在本计划里复述其内部格式。凭据模块视为**黑盒**。

**唯一合法用法**——在需要登录 token 时调用公开 API：

```ts
import { readFactoryAccessCredential } from '../runtime/daemon/factoryCredentials';

const result = readFactoryAccessCredential();
// 测试可注入 factoryHome；生产不传，默认读 ~/.factory

if (result.status === 'ok') {
  const { token, orgId, expiresAt } = result.credential;
  // token → connectToDaemon({ auth: { apiKey: token } })，见 §2.4
} else if (result.status === 'not-logged-in') {
  // 用户尚未在终端完成 droid 登录
} else {
  // unreadable：本地凭据不可用，归类为 availability
}
```

**调用约定**：

- **每次连接/重连都调用** `readFactoryAccessCredential()`，**不缓存**返回值（daemon 后台会刷新本地凭据文件）。
- 返回的 `token` 是 WorkOS JWT；`expiresAt` 仅作参考，**认证失败**（`onAuthenticationError`）才是过期/失效的权威信号——此时重新调用该函数后再连。
- `token` 只在内存中使用；严禁写入日志、诊断导出、Bridge、`workspaceState`、发现文件或租约文件。

**SDK 侧**：`@factory/droid-sdk` **不提供**本地凭据读取器；现用 `ProcessTransport` 路径也不注入
`FACTORY_API_KEY`（`FactoryDroidRuntime` 的 transport 无凭据参数）。daemon 连接侧统一走
上面的 `readFactoryAccessCredential()` → `connectToDaemon`。

### 2.6 daemon 启动与发现（证据：`droid daemon --help` 实测，0.193.0）

```
droid daemon [options]
  -p, --port <number>       TCP port to listen on
  --host <address>          默认 127.0.0.1
  --unix <path>             Unix socket（Windows 不用）
  --listen <transport>      websocket | ipc（默认 websocket）
  --enable-child-ipc
  --droid-path <path>
  --liveness-fd <fd>        通过继承管道监控父进程存活
  --parent-pid <pid>        监控父进程；父进程死则 daemon 退出
  --remote-access           默认 false
  --settings <path>
  -d, --debug
```

- 启动约 1.5 秒可连接；stdout 打印 `WebSocket endpoint: ws://127.0.0.1:<port>`、PID、
  日志目录 `~/.factory/logs`。
- **无内置服务发现文件**：`~/.factory` 下没有 daemon 的 socket/port/pid 约定文件；
  `DEFAULT_LOCAL_DAEMON_WS_URL` 只是 `ws://localhost` 前缀，不带端口。**发现要自建**（§3.4）。
- `--parent-pid` **是 reload 存活的关键陷阱**：Phase 0/1/2 探测阶段可用它保证清理；
  但 Phase 3 的常驻 daemon **绝对不能**带扩展主机的 `--parent-pid`，否则 reload 即死、
  daemon 化失去意义。
- `droid --help` 无 `auth`/`token`/`whoami` 子命令（子命令仅 exec/daemon/search/update/
  mcp/plugin/computer/help）——**CLI 不提供 token 导出命令**；扩展侧统一通过 §2.5 的
  `readFactoryAccessCredential()` 获取 token。

### 2.7 断线重连 / 事件补收（证据：`index-D_SzTnFR.d.ts` 的 `DaemonSessionController` 与 `daemon.load_session` 结果类型）

- `DaemonSessionController` 内建：`scheduleReconnect` / `attemptReconnect` /
  `pollUntilConnected` / `handleConnectionClose` / `autoAuthenticate` /
  `ensureSessionLoaded` / `replayBufferedPermissionOnLoad` / `replayBufferedAskUserResponses`。
- `daemon.load_session`（`sessions.resume` 内部调用）结果含 `pendingPermissions`、
  `pendingAskUserRequests`、`queuedMessages`（`PendingPermission`/`PendingAskUserRequest`
  带 `isRestored?: boolean`）——重连后未决的权限/提问会补投给新客户端。
- **对账模型 = "状态对账"而非"事件重放"**：SDK 不承诺补发断线期间错过的流式增量
  （`assistant_text_delta` 等）。重连后靠 `daemon.get_session_messages` 全量重取历史 +
  接收补投的 pending 请求 + 继续接收后续通知。UI 意义：reload 后重渲染历史，
  正在生成的那条消息在完成后以完整形态出现（打字机中断，可接受）。
- **多客户端限制**：SDK 文档明确"Daemon replacement locking does not coordinate separate
  clients."——两个窗口不能同时对同一会话做替换型操作，需客户端租约（§3.4 / §4）。

### 2.8 daemon.\* RPC 清单（Phase 1 只读价值最高的加粗）

会话生命周期：`daemon.initialize_session`、`daemon.load_session`、`daemon.close_session`、
`daemon.add_user_message`、`daemon.interrupt_session`、`daemon.kill_worker_session`、
`daemon.resolve_queued_user_message`。

查询/管理：`daemon.list_available_sessions`、`daemon.list_opened_sessions`、
`daemon.get_session_messages`、`daemon.search_sessions`、
`daemon.archive_session`、`daemon.unarchive_session`、`daemon.rename_session`、
`daemon.fork_session`、`daemon.execute_rewind`、`daemon.get_rewind_info`、
`daemon.compact_session`、`daemon.get_context_stats`、`daemon.get_context_breakdown`、
`daemon.update_session_settings`、`daemon.change_working_directory`。

能力目录：`daemon.list_skills`、`daemon.set_skill_disabled`、`daemon.list_commands`、
`daemon.list_mcp_servers`、`daemon.list_mcp_tools`、`daemon.add/remove/toggle_mcp_*`、
`daemon.list_custom_models`、`daemon.list_git_branches` 等。

杂项：`daemon.authenticate`、`daemon.logout`、`daemon.warmup_cache`、
`daemon.submit_bug_report`。**未见 shutdown RPC**（§4 孤儿治理）。

---

## 3. 分阶段实现计划

> ++目标模块目录：++`src/runtime/daemon/`++（新建）。保持窄模块、依赖显式、无投机抽象（见 §5）。
> 每阶段结束后按 §5 完整验证再提交。++

### Phase 0 — 凭据模块与握手验证（**已完成，勿重复实现**）

**状态**：已交付 `src/runtime/daemon/factoryCredentials.ts` 及单测。接续 AI **从 Phase 1 开始**；
**不得**重新实现、审查或修改凭据模块内部逻辑。

**接续 AI 只需知道**：

- 公开入口：`readFactoryAccessCredential()`（签名与返回值见 §2.5）。
- 成功时取 `result.credential.token` 传给 `connectToDaemon({ auth: { apiKey: token } })`。
- 失败时按 `not-logged-in` / `unreadable` 归类为 availability，提示用户先完成 `droid` 登录。

#### Phase 0 验收（已通过）

- `pnpm exec vitest run src/runtime/daemon/factoryCredentials.test.ts` 通过。
- （可选）`node artifacts/probe-daemon-token-auth.mjs` 输出含 `TOKEN AUTH: SUCCESS` 与
  `FACADE connectToDaemon(...): SUCCESS`。

#### 依赖顺序

Phase 1 及之后直接依赖 §2.5 的公开 API；**无需**再动 Phase 0 文件。

---

### Phase 1 — 只读 sidecar（2–4 天）

**目的**：把 daemon 连接作为**旁路只读通道**接进来，先交付归档/列表/搜索，
**完全不动现有执行链路**（发消息仍走 ProcessTransport）。这样风险最小、可独立验收。

#### 要新建的文件

1. `src/runtime/daemon/daemonLifecycle.ts` — 确保本机有一个可连接的 daemon（Phase 1 版：简单版）

```ts
export interface DaemonEndpoint {
  readonly url: string;
  readonly pid: number;
}
export interface DaemonLifecycleOptions {
  readonly droidPath?: string; // 默认 'droid'
  readonly host?: string; // 默认 '127.0.0.1'
  readonly parentPid?: number; // Phase 1 传 process.pid（随扩展退出而清理）
}
/**
 * Phase 1 策略：为当前扩展主机拉起一个私有 daemon（带 --parent-pid=process.pid，
 * 保证扩展退出时 daemon 一并退出，避免孤儿）。选随机空闲端口，等待端口 listening，
 * 解析 stdout 的 "WebSocket endpoint: ws://..." 或直接用已知端口构造 url。
 * 注意：Phase 1 不共享 daemon、不写发现文件——共享与脱管留到 Phase 3。
 */
export function ensurePrivateDaemon(
  options?: DaemonLifecycleOptions,
): Promise<DaemonEndpoint>;
export function stopDaemon(endpoint: DaemonEndpoint): Promise<void>; // taskkill /PID <pid> /T /F
```

实现参考：`artifacts/probe-daemon-handshake.mjs` 里的 `spawn('droid',['daemon','--port',..., '--host','127.0.0.1','--parent-pid',String(process.pid)])` + `waitForPort`。

1. `src/runtime/daemon/daemonConnection.ts` — 连接与认证（供只读资源与后续执行链路共用）

```ts
import type { ConnectedDroid } from "@factory/droid-sdk";

export type DaemonConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "auth-error"
  | "failed";

export interface DaemonConnection {
  readonly droid: ConnectedDroid; // connectToDaemon 返回的门面
  status(): DaemonConnectionStatus;
  onStatusChange(cb: (s: DaemonConnectionStatus) => void): () => void;
  dispose(): Promise<void>; // droid.disconnect()
}

export interface DaemonConnectionDeps {
  readonly readCredential: typeof import("./factoryCredentials").readFactoryAccessCredential;
  readonly connect: typeof import("@factory/droid-sdk").connectToDaemon;
}

/**
 * 连接并认证一个 daemon endpoint。
 * - 调用 `readFactoryAccessCredential()` 取 token（见 §2.5：不缓存）。not-logged-in / unreadable → 抛结构化错误供上层归类为 availability。
 * - connectToDaemon({ url, auth: { apiKey: cred.token }, onAuthenticationError })。
 *   注意 auth.apiKey 实为 token 通道（§2.4）。
 * - onAuthenticationError：重新调用 `readFactoryAccessCredential()` 后重连（token 会过期，见 §2.5）。
 */
export function openDaemonConnection(
  endpoint: { url: string },
  deps?: Partial<DaemonConnectionDeps>,
): Promise<DaemonConnection>;
```

1. `src/runtime/daemon/DaemonSessionCatalog.ts` — 只读会话目录（替代/并行于 `FactorySessionCatalog`）

- 实现 `src/runtime/SessionCatalog.ts` 的 `SessionCatalog` 接口（`listSessions(cwd)`），
  内部用 `connection.droid.sessions.list({ ...按 cwd/repoRoot 过滤... })`，
  投影为现有 `SessionCatalogEntry`（复用 `FactorySessionCatalog.ts` 里的
  `projectSessionMetadata` 同款字段校验，保持信任边界）。
- 新增只读能力：`archive(sessionId)` → `droid.sessions.archive(...)`；
  `unarchive(sessionId)` → `droid.sessions.unarchive(...)`；`search(query, cwd)` →
  `droid.sessions.search(...)`。

#### 要新增的 Bridge 消息（`src/shared/bridgeMessages.ts`）

在 `WebviewToHostMessage` 联合里新增（沿用文件现有 `hasExactKeys`/`isStrictRecord`
严格校验风格，每个新消息都要有对应校验分支）：

- `SessionArchiveMessage { type: 'session/archive'; sessionId: string }`
- `SessionUnarchiveMessage { type: 'session/unarchive'; sessionId: string }`
- `SessionSearchMessage { type: 'session/search'; query: string }`（query 长度上限，新增 `MAX_SESSION_SEARCH_QUERY_LENGTH` 常量并校验）

Host→Webview 侧新增列表/搜索结果状态（沿用现有 `SessionCatalogState` 风格）。
**校验点**：所有从 Webview 进来的 `sessionId`/`query` 必须过 `isId`/长度上限校验，
拒绝控制字符（复用 `FactorySessionCatalog.ts` 的 `isSafeIdentifier` 同款规则）。

#### Host 接入点

- `src/extension/ChatController.ts`：注入一个可选的 `DaemonConnection` 提供者与
  `DaemonSessionCatalog`；把新 Bridge 消息路由到对应 daemon 只读方法。
  （现状 `ChatController` 由 `src/extension/extension.ts` 第 55–77 行构造，
  持有 `FactorySessionCatalog`、`SessionRecoveryStore` 等依赖——按同样的依赖注入方式加。）
- `src/extension/extension.ts`：在 `activate()` 里惰性创建 daemon 连接
  （首次需要只读能力时再 `ensurePrivateDaemon` + `openDaemonConnection`，避免无谓拉起）。

#### UI 入口

- 会话列表项加"归档/取消归档"操作；加一个搜索输入框（走 `session/search`）。
  Webview 侧遵循 assistant-ui 既有组件风格（参考 `src/webview/assistant/`）。

#### Phase 1 依赖顺序

`factoryCredentials`(P0) → `daemonLifecycle` → `daemonConnection` → `DaemonSessionCatalog`
→ Bridge 消息 + 校验 → `ChatController` 路由 → `extension.ts` 装配 → UI。

#### Phase 1 测试清单

- `daemonConnection` 单测：注入 `readCredential` 返回 `not-logged-in`/`unreadable`/`ok`，
  断言分别归类为 availability 错误 / 成功连接（`connect` 用 mock）。
- `DaemonSessionCatalog` 单测：mock `ConnectedDroid.sessions.list/archive/unarchive/search`，
  断言投影与错误处理。
- Bridge 消息校验单测：非法 `sessionId`/超长 `query` 被拒（沿用 `bridgeMessages` 现有测试风格）。

#### Phase 1 可见验收

打包安装后在 Cursor 里：选一个已存在会话 → 归档 → 列表中消失 → 取消归档 → 恢复；
搜索关键词返回命中会话。日志中确认只读能力走单条持久 ws 连接（非每次拉起进程）。
发消息等现有链路行为不变。

---

### Phase 2 — 执行链路迁移（5–8 天）

**目的**：让"发消息/权限/askUser/能力/替换型操作"整条执行链路可切到 daemon 连接，
用配置开关灰度与回退。**此阶段仍用 Phase 1 的私有 daemon（带 --parent-pid），不追求 reload 存活**
（reload 存活是 Phase 3）。

#### 核心改造：给 `FactoryDroidRuntime` 增加 daemon 会话依赖

现有注入 seam（**必须复用，不要重写** `FactoryDroidRuntime`）：

- `FactoryDroidRuntime` 构造参数 `createSdkSession?: FactoryDroidSessionFactory`
  （`src/runtime/FactoryDroidRuntime.ts` 行 172–213）。默认走 `createLocalDroidSession`。
- `createLocalDroidSession`（行 1256）接受 `dependencies: LocalSessionDependencies`
  （行 1227–1254），其中 `createTransport`/`createSession`/`resumeSession` 可替换。

改造方案：新建**平行工厂** `createDaemonDroidSession`（新文件
`src/runtime/daemon/createDaemonDroidSession.ts`），签名与 `FactoryDroidSessionFactory`
一致（`(options: { target, interactionHandler }) => Promise<FactoryDroidSession>`），
内部：

- `target.kind === 'new'` → `connection.droid.sessions.create({ cwd, permissionHandler, askUserHandler })`；`resume` → `connection.droid.sessions.resume(sessionId, {...})`。
- 用返回的 `ConnectedDroidSession` 适配出 `FactoryDroidSession`
  （`src/runtime/FactoryDroidRuntime.ts` 行 ~100–165 定义的接口）：
  - `stream` → `session.stream(text, { includePartialMessages: true })`，事件仍过
    `normalizeSdkEvent`。
  - 能力方法（`listSkills/listCommands/listMcpServers/getContextStats/…`）改为委托
    `connection.droid.skills.list(session.id)` / `commands...` / `mcp...` / `sessions.getContextBreakdown(session.id)` 等（§2.2 的资源化差异）。
  - `rewind/compact/fork/rename` → `ConnectedDroidSession` 同名方法；注意替换型操作
    返回 `newSessionId`，需更新 `FactoryDroidRuntime` 的目标会话（现有逻辑见
    `RuntimeRewindResult`/`RuntimeForkResult`/`RuntimeCompactResult`，
    `src/runtime/DroidRuntime.ts` 行 252–271）。
  - `close` → `session.detach()`（Phase 2 断开即 detach，会话留在 daemon）。
- 模型目录：现状靠 `modelCatalogCaptureTransport`（`src/runtime/modelCatalogCaptureTransport.ts`）
  从初始化流截获 `availableModels`。daemon 侧改用 `connection.droid.customModels`/
  `sessions.create` 返回的 settings + `daemon.list_custom_models`。若一时对不齐，
  可先让 daemon 模式下模型目录返回 `unavailable`（`RuntimeModelCatalogUnavailable`），
  不阻塞主链路，Phase 2 末尾补齐。

#### 配置开关与回退

- 在 `package.json` 的 `contributes.configuration` 新增
  `droidvisx.runtime.mode`（enum `"process" | "daemon"`，默认 `"process"`）。
- `src/extension/extension.ts` 第 55–77 行构造 `FactoryDroidRuntime` 处，按配置决定
  传入 `createSdkSession`：`daemon` 模式传 `createDaemonDroidSession`（绑定当前
  `DaemonConnection`），`process` 模式保持现状（不传，走默认 `createLocalDroidSession`）。
- **回退策略**：daemon 模式初始化/连接失败时，归类为 availability 事件并提示；
  用户改回 `"process"` + Reload Window 即完全回退（因 version 仍 0.0.0，见 §5）。

#### 会话所有权与多窗口隔离

- 每窗口的 `FactoryDroidRuntime` 只 attach 自己 create/resume 的 `sessionId`（延续现状按窗口隔离）。
- 禁止双窗口同时 resume 同一 `sessionId`：Phase 2 内先用**进程内**记录（同一扩展主机内
  `Map<sessionId, owner>`）防重；跨窗口租约留到 Phase 3（§3.4）。

#### 断线重连对账（Phase 2 版：连接抖动，非 reload）

- 依赖 SDK `DaemonSessionController` 内建重连（`connectToDaemon` 已挂载）。
- 重连后：`sessions.resume(sessionId)` 内部 `daemon.load_session` 会带回
  `pendingPermissions`/`pendingAskUserRequests`/`queuedMessages`；把补投的 pending 请求
  经现有 `runtimeInteractions` 的 `permissionHandler`/`askUserHandler` 重新弹给 UI。
- 历史用 `sessions.getMessages` 重取，交给现有 `FactorySessionHistoryLoader`
  （`src/runtime/history/FactorySessionHistoryLoader.ts`）等价路径渲染。

#### Phase 2 依赖顺序

`createDaemonDroidSession`（依赖 P1 的 `daemonConnection`）→ 配置开关 + `extension.ts` 装配
→ 能力方法资源化 → 替换型操作新语义 → 重连对账 → 模型目录补齐。

#### Phase 2 测试清单

- `createDaemonDroidSession` 单测：mock `ConnectedDroid`/`ConnectedDroidSession`，
  断言 `stream` 事件归一化、能力方法委托到正确资源、替换型操作返回 `newSessionId` 后目标切换。
- `FactoryDroidRuntime` 现有测试（`src/runtime/FactoryDroidRuntime.test.ts`）在两种
  `createSdkSession` 下都要过（daemon 工厂用 mock 注入）。
- 全量 `pnpm test`；`pnpm run typecheck`。

#### Phase 2 可见验收

`droidvisx.runtime.mode: "daemon"` 下，逐项手测 V1 功能与 `process` 模式等价；
切回 `"process"` 回退可用。

---

### Phase 3 — Reload 存活完全体（4–6 天）

**目的**：把 daemon 变成**脱离扩展主机生命周期**的常驻单例，实现 reload/重启窗口中途任务存活。

#### 3.1 脱管 daemon（去 --parent-pid）

- 新增 `daemonLifecycle` 的"共享常驻"模式：`spawn('droid',['daemon','--port',p, '--host','127.0.0.1'], { detached: true, stdio: 'ignore' })` + `child.unref()`，
  **不传** `--parent-pid`。这样扩展主机 reload/退出后 daemon 继续运行。

#### 3.2 服务发现文件约定（自建）

- 约定文件：`~/.droidvisx/daemon.json`，内容 `{ port:number, pid:number, version:string, startedAt:number }`。
- 发现流程：读该文件 → 健康检查（连 `ws://127.0.0.1:<port>` + 一次
  `sessions.list({limit:1})` 认证探活）→ 失败视为陈旧，重新拉起。
- **并发拉起竞争**：写发现文件用 `fs.openSync(path, 'wx')` 独占创建；输掉竞争者改连赢家。
- **版本漂移**：发现文件记 CLI 版本；`droid update` 后由新连接方检测不一致并提示重启 daemon。

#### 3.3 In-flight 标记（reload 后知道要恢复哪个会话/回合）

- 复用 `SessionRecoveryStore`（`src/extension/SessionRecoveryStore.ts`，
  workspaceState key `droidvisx.sessionRecovery`）已持久化的 `selectedSessionId`；
  新增一个**轻量 in-flight 标记**（bump `SESSION_RECOVERY_VERSION` 或另开一个
  workspaceState 键 `droidvisx.daemonInFlight = { sessionId, turnStartedAt }`）。
  **注意**：绝不把 token 或任何凭据写进 workspaceState（§5）。

#### 3.4 客户端租约（多窗口不互踩替换型操作）

- 在 `~/.droidvisx/` 下维护 `sessions-attached.json`：`{ [sessionId]: { pid, ts } }`。
  attach 前检查是否已被**存活 pid**占用（`pid` 不存活则租约失效可抢占）。
  替换型操作（rewind/compact/fork）前必须持租约。

#### 3.5 重连对账 UI

- reload 后：调用 `readFactoryAccessCredential()` 取得 token → `openDaemonConnection` → `sessions.resume(inFlight.sessionId)`
  → 取回 `get_session_messages` 全量重建时间线 → 若 daemon 报工作状态仍 `running`
  （`DroidWorkingStateChangedNotification`），UI 显示"生成中"占位，完成消息到达时落地。
  补投的 pending 权限/askUser 重新弹窗。**不恢复逐 token 打字机**（§2.7，接受）。

#### 3.6 孤儿治理

- 新增命令 `droidvisx.shutdownDaemon`（`package.json` contributes.commands）：因无 shutdown
  RPC（§2.8），用 `taskkill /PID <发现文件.pid> /T /F` 终止，并删发现文件。文档说明。

#### Phase 3 要新建/修改的文件

- 修改 `src/runtime/daemon/daemonLifecycle.ts`（加共享/脱管/发现/竞争）。
- 新建 `src/runtime/daemon/daemonDiscovery.ts`（发现文件读写 + 健康检查 + 竞争）。
- 新建 `src/runtime/daemon/sessionLease.ts`（租约）。
- 修改 `src/extension/extension.ts`（激活时走发现而非私有拉起；注册 shutdown 命令；恢复流程）。
- 修改 `src/extension/ChatController.ts`（in-flight 标记读写 + 重连对账驱动）。
- 修改 `package.json`（新命令；`activationEvents` 若需要）。

#### 3.7 依赖顺序

`daemonDiscovery` → `daemonLifecycle`（脱管/共享）→ `sessionLease` → in-flight 标记
→ 重连对账 UI → shutdown 命令。

#### 3.8 Phase 3 验收脚本（两代客户端存活，新建 `artifacts/probe-reload-survival.mjs`）

设计（照此实现）：

1. 起一个**共享 daemon**（脱管，随机端口）。
2. **客户端 A**：`connectToDaemon`（token 来自 `readFactoryAccessCredential()`）→ `sessions.create({cwd})` →
   `stream("创建 10 个文件，每个之间 sleep，逐个写入")` 这类**可观测长回合**；消费到第一个
   工具事件后立即 `process.exit(0)`（模拟 reload：客户端骤死，daemon 不带 --parent-pid 故存活）。
3. **客户端 B**（新进程，等 3 秒）：`connectToDaemon` → `sessions.resume(sessionId)` →
   断言：(a) `load_session`/后续通知里该会话工作状态曾为 `running`；
   (b) 能收到该回合的后续/最终 `result`（回合确实在客户端 A 死后继续跑完）；
   (c) 若回合触发过权限请求，B 收到 `isRestored` 的 pending 补投。
4. 清理：终止共享 daemon（taskkill）。

脚本只打印布尔/计数/成败，**不打印任何凭据或会话内容明文**（沿用现有探针风格）。

#### 3.9 手动验收

Cursor 中 `droidvisx.runtime.mode: "daemon"` → 发一个明显长任务 → 任务执行途中
`Developer: Reload Window` → 面板恢复后：时间线完整重建、任务继续并最终完成、
（若有）权限弹窗重新出现、可继续正常交互。

---

## 4. 风险与已知缺口

| 缺口/风险                             | 判断与对策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **凭据模块依赖 Factory 本地存储** | `readFactoryAccessCredential()` 已封装读取逻辑（黑盒，勿改）。**风险**：Factory CLI 升级后本地凭据格式变化可能导致 `unreadable`。**对策**：失败时归类为 availability；预留回退——扩展设置项 `droidvisx.factoryApiKey`（存 VS Code SecretStorage），有值时传给 `connectToDaemon`（见 §2.4 命名陷阱；必要时用低层 `DaemonClient.authenticate({ caller, apiKey })` 走 fk- 通道，用探针 `probe-daemon-handshake.mjs` 确认）。在 `implementation-status.md` 标注脆弱点。 |
| **无内置服务发现约定**                | 接受并自建：`~/.droidvisx/daemon.json` + `wx` 独占创建处理竞争（§3.2）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **无 daemon shutdown RPC / 孤儿进程** | 接受现状：提供 `droidvisx.shutdownDaemon` 命令用 PID 终止（§3.6）；文档说明常驻 daemon 需手动或随机器重启回收。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **多客户端替换锁缺失**                | SDK 明确不协调跨客户端替换（§2.7）。对策：客户端租约 `sessions-attached.json`（§3.4），替换型操作前须持租约。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **reload 后流式增量不补发**           | 接受（§2.7）：打字机中断，重连后重渲染历史 + 完成消息整条落地。UI 用"生成中"占位对账。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **token 过期**                        | 接受：不缓存、每次连接调用 `readFactoryAccessCredential()`；`onAuthenticationError` → 重新调用后再连（§2.5）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **未登录用户**                        | `readFactoryAccessCredential()` 返回 `not-logged-in` / `unreadable` → availability 提示"请先在终端运行 `droid` 完成登录"。与现状 ProcessTransport 需登录态一致，非倒退。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 5. 执行须知（写给接续 AI 的元信息）

- **遵守** `AGENTS.md`：单实现代理，不派生子代理；先定义一个有可观测完成标准的纵向切片；
  信任边界（读磁盘外部文件、Webview 入站消息）必须校验，内部代码不要撒冗余守卫；
  窄模块、依赖显式、优先函数与组合、**不要投机抽象层**（不要为"将来可能的多传输"预造框架，
  就按 process/daemon 两条具体路径写）；保留既有用户改动与无关文件；小步一致优于大重写。
- **不要发明 API/命令/结构**：所有 daemon API 用法以 `node_modules/@factory/droid-sdk/dist/*.d.ts`
  为准，先本地核对再用。
- **每阶段的提交纪律**：一个阶段完成 = 该阶段 Runtime/Host/Bridge/UI 改动 + 测试 + 打包 +
  安装 + Cursor 可见验收都过之后，再提交。运行顺序建议：
  `pnpm run typecheck` → `pnpm test` → `pnpm run build` →（影响扩展 UI 时）
  `pnpm run package:vsix` + `pnpm run verify:vsix` → 在 Cursor 里安装 vsix 做可见验收。
- **PowerShell 下 git commit**：用临时文件传消息，`git commit -F <tmpfile>`（不要用可能踩
  引号/换行的内联 `-m`）。除非用户明确要求，不要 commit——本计划本身也**不要执行提交**，
  提交由后续实现阶段按用户指示进行。
- **版本仍** `0.0.0`：`package.json` version 未变，安装新 vsix 后需 `Developer: Reload Window`
  才能加载新代码；验收前务必 reload。
- **同步更新** `implementation-status.md`：每阶段落地后，在该文件如实登记 daemon 相关能力的
  状态（production-wired / partial / probe-only / not implemented）。**注意另一个代理也在改此文件**，
  提交前先拉取其最新内容、只追加/更新 daemon 相关条目，避免覆盖它的改动。
- **凭据模块黑盒（硬性）**：**禁止**打开、阅读、解读、修改
  `src/runtime/daemon/factoryCredentials.ts` 及其单测；**禁止**直接读 `~/.factory/auth.v2.*`。
  需要 token 时**只**调用 `readFactoryAccessCredential()`（§2.5）。
- **凭据是敏感数据**：`token` 严禁落盘（含 `workspaceState`、发现文件、租约文件）、
  严禁进日志与诊断导出、严禁进 Bridge 消息。探针输出只允许布尔/结构/成败。

---

## 6. 目录结构概览（本计划落地后新增，供对照）

```
src/runtime/daemon/
  factoryCredentials.ts          # P0 凭据黑盒（已完成；禁止打开/修改）
  factoryCredentials.test.ts     # P0（禁止打开/修改）
  daemonLifecycle.ts             # P1 私有拉起 → P3 脱管/共享
  daemonConnection.ts            # P1 连接+认证（token 通道）
  DaemonSessionCatalog.ts        # P1 只读会话目录 + 归档/搜索
  createDaemonDroidSession.ts    # P2 执行链路 daemon 会话工厂
  daemonDiscovery.ts             # P3 发现文件 + 健康检查 + 竞争
  sessionLease.ts                # P3 多窗口租约
artifacts/
  probe-reload-survival.mjs      # P3 两代客户端存活验收（新建）
docs/product/
  daemon-implementation-plan.md  # 本文件
（修改：src/shared/bridgeMessages.ts、src/extension/ChatController.ts、
  src/extension/extension.ts、package.json；P3 另涉 SessionRecoveryStore 或新 workspaceState 键）
```
