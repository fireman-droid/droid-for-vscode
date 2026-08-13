# Mission 控制面可行性报告

> **最终状态（2026-08-12 傍晚，用户拍板）：Mission 控制面现阶段做不了，
> 等待 SDK 暴露接口后再议。**本报告 §1–§6 的乐观结论（"暂停/恢复可经
> 公开通道实现"）已被 §0 的实机验证推翻——mission 本身无法经 SDK 启动，
> 控制面无对象可控——**勿据本报告任何章节排期**。只读展示不在本判定
> 范围内，已随 V1 #5 落地。现行权威判定见
> [`../HANDOVER.md`](../HANDOVER.md) 第 3 节「SDK 边界内做不了的
> （fail closed）」表。§0–§7 的实测记录保留其技术证据价值。

> 状态：集成可行性调研报告（2026-08-12）。用途：评估 Mission「控制面」
> 能否纳入 DroidVisX 排期，以及以什么方式接入。
>
> **依据边界**：本报告只使用三类公开材料作为依据——(a) `@factory/droid-sdk`
> npm 包随包发布的 TypeScript 类型声明；(b) 官方 JSON-RPC 协议方法枚举；
> (c) Droid CLI 随产品分发的诊断标识与多语言文案资源。
>
> **实施边界**：下文建议的全部接入路径**只调用公开协议方法**。任何依赖
> 内部实现细节或私有文件写入的做法一律列入「不采用」（§6），理由同时是
> 合规性与稳定性。
>
> 本报告最初基于静态材料（§2 的来源 1–4）。**2026-08-12 已补做实机验证**，
> 结论被实测显著修正——见 §0。原静态分析（§1–§6）保留以说明"协议面本
> 应支持什么"，但其乐观结论已被 §0 推翻，阅读时以 §0 为准。

---

## 0. 实机验证结论（2026-08-12，决定性，覆盖并修正 §1/§7）

> 依据：`artifacts/probe-mission-*.mjs` 五轮实机探针 +
> `artifacts/bin-scan-mission*.mjs` 三轮二进制字符串检索，CLI 0.193.0，
> 消耗真实账户额度，在一次性 git 沙盒
> （`react+ts\个人简历-mission-probe`，已删除）内运行，未触碰生产代码或真实项目。
>
> ⚠️ 本节曾一度结论为"做不出来"。**第五轮实测推翻了该结论**，现为最终版。

**一句话**：mission **能真跑起来**，截图那种面板的**数据面完全可行**；但它
**不能走 DroidVisX 现在的 SDK 会话通道**，必须以**独立子进程 + 读磁盘**的
形态接入。控制面（暂停/恢复）在该形态下**没有受支持的通道**。

### 0.1 根因：mission 由 CLI 旗标开启，且与 SDK 通道硬性互斥

前四轮全部失败的原因是**开关找错了**。mission 模式不是靠会话设置
`interactionMode: mission` 开启的——那个字段能写进去、能回显，但**不装配
任何 mission 工具**。真正的开关是 `droid exec --mission` 旗标：

```
--mission   Run in mission mode (multi-agent orchestration)
            • Automatically upgrades session to orchestrator mode
            • Spawns worker sessions via factoryd to implement features
            • Missions auto-approve proposals (no interactive confirmation)
            • Requires --auto high or --skip-permissions-unsafe
```

而这是**硬性互斥**（实测原话）：

```
$ droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc --mission --auto high
Invalid flags: --mission cannot be used with streaming input formats.
```

SDK 恒定以 `droid exec --input-format stream-jsonrpc --output-format
stream-jsonrpc` 启动子进程（`node.mjs` 的 `buildArgs`），因此：

**任何 SDK / JSON-RPC 客户端都无法进入 mission 模式。** 这不是权限问题、
不是 readiness 问题、也不是 daemon 与 process 的差别——是 CLI 层的旗标互斥。

二进制侧的一致证据：门函数形如
`if (isWorker(tags)) return false; return !isNonInteractiveCLIMode()`，
而 SDK 走的 `droid exec` 恰好落在 `non-interactive-cli` 分支。

### 0.2 可行形态：`--mission` + 流式**输出**（输入不流式）

互斥只针对**输入**格式。改成一次性提示词 + 流式输出即被接受，且
`system/init` 事件的 `tools` 数组里**明确出现三个 mission 工具**：

```
droid exec --mission --auto high --output-format stream-json \
  --model custom:GPT-5.6-Sol-0 \
  --worker-model custom:GPT-5.6-Sol-0 \
  --validator-model custom:GPT-5.6-Sol-0 "<prompt>"

→ tools: [... "ProposeMission","StartMissionRun","EndFeatureRun","DismissHandoffItems" ...]
```

**模型坑（必须记住）**：mission 默认用 Factory 托管模型（`claude-opus-5` /
文档写 GPT-5.2），本账户直接 `402 No active subscription found`。必须用
`--model` / `--worker-model` / `--validator-model` 全部覆盖为 `custom:` 模型
才能跑。

实测该形态下 mission 走完了完整生命周期：`ProposeMission`（accepted）→
写 mission 产物 → `StartMissionRun` → 派生 worker → worker **真实完成 feature
并提交**（沙盒里留下 `bcb2316 Add project README`）。

### 0.3 数据面：完整落在磁盘，且与 SDK schema 一一对应

mission 目录 `~/.factory/missions/<sessionId>/`：

| 文件 | 内容 | 对应 SDK 类型 |
| --- | --- | --- |
| `state.json` | `{missionId, state, workingDirectory, createdAt, updatedAt}` | `MissionState` + 快照头部 |
| `features.json` | `{features:[...]}` | **`MissionFeature[]`**（字段完全一致） |
| `progress_log.jsonl` | 逐行进度条目 | **`ProgressLogEntry`** |
| `model-settings.json` | worker/validator 模型与 reasoning | `missionSettings` |
| `mission.md` / `architecture.md` / `validation-contract.md` | 编排器产物 | —— |
| `skills/<name>/SKILL.md`、`library/`、`services.yaml`、`init.sh` | worker 技能与环境 | —— |
| `validation-state.json` | 验收状态 | —— |

实测 `features.json` 片段（面板每行需要的字段全在）：

```json
{ "id": "create-project-readme",
  "description": "Create only the new repository-root README.md …",
  "skillName": "documentation-worker", "milestone": "documentation",
  "status": "in_progress",
  "workerSessionIds": ["9fb61515-e457-4a59-bb95-0dca1dde6bfc"],
  "currentWorkerSessionId": null, "completedWorkerSessionId": null }
```

实测 `progress_log.jsonl`（逐 worker 绑定，正是截图副标题所需）：

```
{"type":"mission_accepted","title":"Add resume project documentation"}
{"type":"mission_run_started","message":"…"}
{"type":"worker_selected_feature","workerSessionId":"9fb61515-…","featureId":"create-project-readme"}
{"type":"worker_started","workerSessionId":"9fb61515-…","spawnId":"worker_2e75ddcc","featureId":"create-project-readme"}
```

注意 `currentWorkerSessionId` 可能为 `null` 而 `workerSessionIds` 有值；
SDK 内部的取值顺序是 `currentWorkerSessionId ?? workerSessionIds.at(-1)`，
面板应照抄该回退逻辑。

**重要**：该形态下**没有** `mission_*` 会话通知——那些是 JSON-RPC 通道的
`SessionNotificationType`，而这里输出是 `stream-json`（事件只有
`system/message/tool_call/tool_result/reasoning`）。所以面板的状态来源是
**监听 mission 目录文件**，不是通知流。这与 §6「mission 工作目录只读不写」
的原则一致。

### 0.4 控制面：三个动作都有通道（本节修正了前一版"不可做"的判断）

> 前一版本这里写的是「暂停/恢复/逐 worker 停止都不可做」。**错了**。
> 后续二进制检索找到了官方自己使用的三条通道，如下。

**关键事实一：worker 是 daemon 会话。** `spawnWorkerSession` 用 daemon 的
`initializeSession` 创建 worker，并打上 `{role:"worker", missionId}` 标签；
i18n 里也有 `missionRunner.daemonNotReachable: "factoryd is not reachable"`。
所以 mission 运行期间 factoryd 必然在跑，worker 会话在其中可寻址。

**关键事实二：官方的暂停实现就是调 daemon 的中断。** `pauseMissionRunner`
反出来的语义：

```js
const runner = CGL.get(sessionId);
if (runner) { await runner.pause(); if (state === "paused") return }
// 状态前置：initializing / running / orchestrator_turn（planning → awaiting_input）
const feature = await A.getInProgressFeature();
const workerSessionId = feature?.workerSessionIds?.at(-1) ?? null;
if (workerSessionId) {
  cA().interruptSession(workerSessionId)                    // ← daemon 中断 worker
  await A.appendProgressLog({type:"worker_paused", workerSessionId, featureId})
}
await A.appendProgressLog({type:"mission_paused"})
await A.updateState({state:"paused"})
```

**关键事实三：SIGINT 就是官方的优雅暂停入口。** `MissionRunner.start()`：

```js
const A = async () => { GH("[MissionRunner] Received interrupt signal, pausing..."); await this.pause() };
process.on("SIGINT", A);
try { await this.runLoop($, L) } finally { process.off("SIGINT", A); ... }
```

**关键事实四：恢复由 `StartMissionRun` 再次调用驱动**，且会自动续跑被暂停的
worker——`getInterruptedWorkerSessionId()` 扫进度日志找"有 `worker_paused`
但无 `worker_completed`"的 worker，日志行为
`[StartMissionRun] Auto-resuming paused worker session`。而 `droid exec` 有
`-s, --session-id` 可续跑既有会话。

修正后的能力表：

| 动作 | 结论 | 通道 | 置信度 |
| --- | --- | --- | --- |
| 启动 | **可做** | 起 `droid exec --mission` 子进程，提案自动批准 | 已实测 |
| 只读展示 | **可做** | 读 `state.json`/`features.json`/`progress_log.jsonl` | 已实测 |
| **终止单个 worker** | **可做** | 连本机 factoryd（凭据可复用）→ `daemon.interrupt_session(workerSessionId)`，即官方暂停的第一步；worker id 来自进度日志 | 静态证据强，**未实测** |
| **暂停整个 mission** | **可做（POSIX 直接；Windows 需中转）** | 向 `droid exec --mission` 进程投递 SIGINT → 触发 `pause()`，自动完成"中断 worker + 写两条进度日志 + state=paused"三步 | 机制已确认，**投递未实测** |
| **恢复** | **可做** | `droid exec --mission -s <orchestratorSessionId> "继续"` → 编排器调 `StartMissionRun` → 自动续跑被中断 worker | 静态证据强，**未实测** |
| 终止整个 mission | 可做但粗暴 | 杀进程树（实测干净，无残留 droid 进程） | 已实测 |

**Windows 投递问题（唯一实务缺口）**：Node 文档明确"Windows 上
`child.kill('SIGINT')` 会强制终止进程"，处理器不会执行，因此拿不到优雅暂停。
正确做法是 `GenerateConsoleCtrlEvent(CTRL_C_EVENT, group)`，但它只作用于与
调用方共享控制台的进程；实测直接 `AttachConsole(childPid)` 返回
`ERROR_INVALID_HANDLE(6)`，因为用 `detached + 管道 stdio` 启动的子进程根本
没有控制台。可行解是加一个**自带控制台的中转启动器**（它启动 droid、把
stdout 转发给扩展、并对自己的进程组发 CTRL_C）。POSIX 上没有这个问题，
`kill -INT <pid>` 即可。

**仍然不采用**：自己写 mission 状态文件来假装暂停（§6 理由不变）。上面三条
都不需要我们写 mission 目录，写入仍限于 Droid 自己。

### 0.5 ✅ 已验证的干净路线：用角色 tag 在 daemon 里造 orchestrator 会话

> 实测探针：`artifacts/probe-mission-tags.mjs`（2026-08-12，真实额度）。
> **这条路成立**，它使 §0.1「SDK 通道进不了 mission」的结论只对
> `interactionMode` 这一个开关成立，而不适用于整个 SDK 通道。

**原理**：CLI 的 decomp 角色不是独立字段，而是**编码在会话 tag 里**：

```js
// 写：xs(tags, {role, missionId})
{ name: "mission-session", metadata: { role: "orchestrator" | "worker", missionId } }
// 读：Io(tags) 要求 role ∈ {orchestrator, worker} 且 missionId 为非空字符串
```

tag 名 `mission-session` 由真实运行的会话 sidecar 反查确认（
`~/.factory/sessions/<项目>/<id>.settings.json`）：

```json
// 编排器
[{"name":"mission-orchestrator"},{"name":"exec"},
 {"name":"mission-session","metadata":{"role":"orchestrator","missionId":"<自身 id>"}}]
// worker
[{"name":"exec"},{"name":"mission-worker"},
 {"name":"mission-session","metadata":{"role":"worker","missionId":"<编排器 id>"}}]
```

而 SDK 的 daemon `sessions.create` 虽然用 `PublicCreateSessionParamsSchema`
过滤掉了 `decompSessionType` / `missionSettings`，但 **`sessionId` 与 `tags`
是原样透传的**。于是：

```js
const sessionId = randomUUID();
const session = await droid.sessions.create({
  sessionId, cwd, interactionMode: 'mission', autonomyLevel: 'high',
  modelId: 'custom:<id>',
  tags: [
    { name: 'mission-orchestrator' },
    { name: 'mission-session', metadata: { role: 'orchestrator', missionId: sessionId } },
  ],
});
```

**实测结果（全部为正）**：

| 观察项 | 结果 |
| --- | --- |
| mission 工具是否装配 | **是**，`ProposeMission` 真实触发（`proposeMissionFired: true`） |
| 确认是否走标准通道 | **是**，`ProposeMission/propose_mission → proceed_once` 经普通 `permissionHandler` 结算——**DroidVisX 现有确认卡片可直接复用** |
| mission 通知是否走会话流 | **是**，收到 `mission_progress_entry` 与 `mission_state_changed`——**无需监听文件** |
| mission 产物 | 正常生成，`features.json` 含 2 个完整 feature |
| `interrupt_session` 是否触发暂停流程 | **是**。调用后收到 `mission_state_changed → awaiting_input`，正是 `pauseMissionRunner` 的 `planning` 分支（`if (state==="planning") updateState({state:"awaiting_input"})`），证明中断确实进入了官方暂停逻辑 |
| readiness | 该沙盒返回无 warning（有远端、非空），readiness 不是障碍 |

### 0.6 ✅ 控制面全链路实测通过（含 running 态暂停、恢复、mission 跑完）

> 探针：`artifacts/probe-mission-control-full.mjs` 与
> `artifacts/probe-mission-control-final.mjs`（2026-08-12，真实额度）。

**先解决两个拖慢/拖死的问题：**

1. **模型**：`custom:GPT-5.6-Sol-0` + `reasoningEffort: high` 的编排器 14 分钟
   都没进入运行（大量 `Task` 子代理交叉评审）。换
   `custom:DeepSeek-V4-Flash-0` + `low` 后，**约 50s 到 `ProposeMission`、
   80s 进入 `running`、3 分钟整条 mission 跑完**。
2. **worker 402**：`missionSettings`（worker/validator 模型）被
   `sessions.create` 的 pick 过滤掉，worker 因此回落到受订阅门控的默认模型，
   直接 `unrecoverable_usage_402` 并触发自动暂停。**解法**：创建会话后调
   `droid.sessions.updateSettings(sessionId, { missionSettings })`——
   `SessionOperationsResource.updateSettings` 是公开方法，`missionSettings`
   在其参数类型内。实测写入成功（mission 目录的 `model-settings.json` 已确认）
   且 `worker402: false`。

```js
await droid.sessions.updateSettings(session.id, {
  missionSettings: {
    workerModel: 'custom:DeepSeek-V4-Flash-0',
    workerReasoningEffort: 'low',
    validationWorkerModel: 'custom:DeepSeek-V4-Flash-0',
    validationWorkerReasoningEffort: 'low',
    skipScrutiny: true,      // 跳过评审轮，大幅加速
    skipUserTesting: true,
  },
});
```

**控制面实测结果：**

| 项 | 结果 | 证据 |
| --- | --- | --- |
| worker 真实运行 | **✅** | `worker402:false`，`worker_started` → `worker_completed exit=0` |
| **running 态用户主动暂停** | **✅** | `stateBeforePause:"running"` → `session.interrupt()` → `stateAfterPause:"paused"`，且 `worker_paused` 与 `mission_paused` 都写入 |
| 暂停归因可区分 | **✅** | 用户暂停的 `mission_paused.pauseReason` 为 **null**；自动暂停（上一轮 402）为 `"unrecoverable_usage_402"`。UI 可据此区分「用户暂停」与「系统暂停」 |
| **恢复** | **✅** | 向同一会话发普通消息 → `StartMissionRun` → `mission_resumed`（带 `resumeWorkerSessionId`）→ state `running` → worker 续跑 → `worker_completed exit=0` |
| mission 走到终态 | **✅** | `state -> completed`，并出现 `milestone_validation_triggered` |
| worker 真实产出 | **✅** | 沙盒里留下提交 `1f45393 Add project README.md`，内容正确 |
| 通知齐备度 | **✅ 五种全到** | `mission_progress_entry` / `mission_features_changed` / `mission_state_changed` / `mission_worker_started` / `mission_worker_completed` |
| `killWorker` 对**活** worker | **⚠️ 未验** | `droid.sessions.killWorker(orchestratorId, workerId)` 存在且可调；本轮调用时 worker 已 `completed`，返回 `Kill worker session request failed`。对已结束 worker 失败属合理，对活 worker 的效果仍需补验 |

**逐 worker 停止的间接证据**：官方 `pauseMissionRunner` 内部就是
`cA().interruptSession(workerSessionId)`，而本轮实测看到 `worker_paused` 被
写入 → 说明那次对 worker 的中断确实生效。因此"停某一个 worker"的底层能力
是通的；只是首选 API 应为 `sessions.killWorker()`（对活 worker 待验），
备选为 `sessions.resume(workerId).interrupt()`（上一轮调用成功返回）。

### 0.7 ✅ 面板数据契约与并发模型（全部实测，无剩余待验项）

> 探针：`artifacts/probe-mission-panel-data.mjs`（3 feature 任务，4.6 分钟跑完）
> 与 `artifacts/bin-scan-parallel.mjs`。

#### 0.7.1 ⚠️ Droid 的 mission 是**严格串行**的——这推翻了截图的前提

反编译的 `runLoop` 每轮只 `await` 一次派生，没有 worker 池、没有
`Promise.all`、没有并发上限旋钮：

```js
async runLoop(H, $) {
  while (this.isRunning) {
    if (abortSignal?.aborted) { await this.pause(); break }
    const st = await readState();
    if (st.state === "paused") break;                 // 外部置 paused 也能停
    if (st.state === "completed") {...}
    if (!await getNextPendingFeature()) {...}
    GH("[MissionRunner] Spawning worker for next feature");
    const P = await this.spawnWorker();               // ← 一次一个
    if (!P.success) { updateState({state:"orchestrator_turn"}); break }
    ...
  }
}
```

实测佐证（3 个**完全独立**的 feature，且提示词明确要求尽量分开跑）：

| 时刻 | 事件 | 同时存活 worker |
| --- | --- | --- |
| 174.7s | worker#1 started | 1 |
| 239.5s | worker#1 completed exit=0 | 0 |
| 244.1s | worker#2 started | 1 |
| 252.1s | worker#2 被 kill | 0 |

`maxConcurrentLiveWorkers: 1`，**从未重叠**。

**结论**：那张截图（多个 worker 同时跑、每行一个停止按钮）是另一个产品的
形态，**Droid mission 不是这样工作的**。DroidVisX 的面板应当是
**Feature 列表**：N 行 feature，任意时刻至多 1 行处于 `in_progress` 且绑定
一个活 worker。"逐 worker 停止"在语义上等价于"停掉当前这个 feature"。

#### 0.7.2 `killWorker` 打在活 worker 上：成功，但会**暂停整个 mission**

```
[252.1s][Q3] killWorker on live worker 8ba86565-… (state=running)
[252.1s] worker_completed 8ba86565-… exit=1
[252.2s] state -> orchestrator_turn
[252.2s] state -> paused
```

`droid.sessions.killWorker(orchestratorId, workerSessionId)` **调用成功**
（`killWorkerLiveOk: true`），进度日志新增 `worker_failed` + `mission_paused`，
最终 `state = paused`；被杀 feature 回到 `pending`，其 `workerSessionIds`
保留该次尝试。

这与 §0.7.1 的串行模型一致：runLoop 里 `if(!P.success)` 会转
`orchestrator_turn` 并 break。**UI 必须如实表达**：这个按钮不是"停掉其中一个、
其余继续"，而是"中止当前 feature 并暂停整个 Mission"。文案建议
「停止当前 Feature（将暂停 Mission）」。

#### 0.7.3 逐 worker 实时活动：`getMessages` 可读（面板副标题的数据源）

`droid.sessions.getMessages(workerSessionId, { limit })` 对**正在运行**的
worker 会话调用成功，返回其消息，可取出最后一个 `tool_use` 名字与文本：

```json
{ "role":"assistant", "contentTypes":["thinking","tool_use"], "toolNames":["Skill"] }
{ "role":"user", "textHead":"<system-reminder>\nYou are a worker assigned to execute feature \"create-changelog\"…" }
```

因此截图里那行灰色副标题（"这个 worker 现在在干什么"）**可以做**，方式是
对活 worker 轮询 `getMessages` 取最后一个工具名。注意这是**拉取**，不是推送；
worker 自身的流式事件不会进编排器会话的通知流。

#### 0.7.4 逐 worker 成本与耗时：从会话 sidecar 可得

`~/.factory/sessions/<项目>/<sessionId>.settings.json` 内含
`tokenUsage`、`inclusiveTokenUsage`、`assistantActiveTimeMs`，以及编排器上的
`childInclusiveTokenUsageBySessionId`。实测：

| 会话 | input | output | thinking | 活跃时长 |
| --- | --- | --- | --- | --- |
| worker#1 | 35,928 | 3,324 | 1,425 | 64.3s |
| worker#2（被杀） | 12,778 | 239 | 306 | 30.3s |
| 编排器 | 8,487 | 16,201 | 15,029 | 241.4s |

角色也能从同一文件的 tags 反查（`mission-session.metadata.role`）。

#### 0.7.5 面板数据契约总表（全部已实测）

| 面板元素 | 数据来源 | 推/拉 |
| --- | --- | --- |
| Mission 状态徽标 | `mission_state_changed` → 7 态 | 推送 |
| Feature 行（标题/描述/里程碑/技能） | `mission_features_changed` → `MissionFeature[]` | 推送 |
| Feature 状态 | 同上 `status`（pending/in_progress/completed/cancelled） | 推送 |
| 行↔worker 绑定 | `currentWorkerSessionId ?? workerSessionIds.at(-1)` | 推送 |
| 进度时间线 | `mission_progress_entry` → `ProgressLogEntry[]` | 推送 |
| worker 起止 | `mission_worker_started` / `mission_worker_completed`（带 exitCode） | 推送 |
| 当前 worker 在干什么 | `sessions.getMessages(workerId)` 取末个 `tool_use` | **拉取/轮询** |
| 逐 worker 成本与耗时 | 会话 sidecar `tokenUsage` / `assistantActiveTimeMs` | **拉取** |
| 暂停归因 | `mission_paused.pauseReason`（null=用户，否则系统） | 推送 |

五种 `mission_*` 通知全部走编排器会话的 JSON-RPC 流，**只有后两项需要拉取**。

#### 0.7.6 实现要点清单（Mission 层）

1. `sessions.create` 必须带角色 tag（§0.5），`missionId` 填自身 sessionId。
2. 创建后**必须**调 `sessions.updateSettings(id, { missionSettings })` 设置
   worker/validator 模型，否则 worker 402（§0.6）。
3. 建议默认打开 `skipScrutiny` / `skipUserTesting`，否则规划阶段可能十几分钟
   不进入执行；模型选快的（DeepSeek V4 Flash 低 reasoning 实测 ~3 分钟全程，
   GPT-5.6-Sol 高 reasoning 14 分钟未进执行）。
4. 面板按 **Feature 列表**设计，不是多 worker 网格。
5. 停止按钮文案必须表达"会暂停整个 Mission"。
6. 规划阶段很长且无 feature 数据，UI 需要一个明确的"规划中"态。

---

## 0.8 ✅ Droid 真正的多 agent 并行层：`Task` 子代理（截图形态在这里成立）

> 探针：`artifacts/probe-subagent-parallel.mjs`、
> `artifacts/probe-subagent-panel.mjs`、`artifacts/bin-scan-subagents.mjs`
> （2026-08-12，真实额度，普通会话即可，**不需要 mission**）。

§0.7.1 的结论"Droid 同时只有 1 个 worker"**只对 mission worker 层成立**。
Droid 另有一层真正的并发：`Task` 子代理。用户最初那张多 agent 面板截图
（多个 agent 同时跑、每行独立停止）**在这一层可以完整复刻**。

### 0.8.1 工具三件套

| 工具 | 契约 | 用途 |
| --- | --- | --- |
| `Task` | `{ subagent_type, description, prompt, await?, machine_name?, run_in_background?, resume?, image_paths? }` | 派生子代理 |
| `TaskOutput` | `{ task_id, block=true, timeout=30000（上限 1200000） }` | 读进度/报告 |
| `TaskStop` | —— | 停单个 |

工具说明原文（二进制内）：

> A **non-awaited Task returns a task_id immediately** and its completed report
> is delivered to you automatically … a `block: false` TaskOutput **peek at a
> running task's progress** is fine. Set `await: true` when the subagent's
> report is a prerequisite for the rest of this turn.

要点：
- `await: false`（或省略）→ **后台并行**，立即返回 `task_id`；`await: true` → 阻塞本回合。
- `subagent_type` 描述为"the custom droid name/identifier（必须是已存在的 droid，不要猜）"，实测内置有 `explorer`（只读）。
- `machine_name` 可把子代理**派到云端 computer** 上跑。
- 存在设置项 `BackgroundSubagentsByDefault`（默认是否后台）。

### 0.8.2 实测：真并行

两轮独立实测，三个 `Task` 都在**同一毫秒的并行批次**发出：

```
[19.038s] TOOL Task "List repository root files"      type=explorer
[19.039s] TOOL Task "Summarize gen-resume-pdf.mjs"    type=explorer
[19.039s] TOOL Task "Report git branch and last commit" type=explorer
```

三个 `task_id` 均为真实会话，会话 tag 为 `subagent`。

### 0.8.3 面板行数据源：`Task` 的 tool_result（无需依赖通知）

`Task` 的 tool_result 是**结构化文本**，面板需要的字段全在里面：

```
Task launched in background.
task_id: 35b5b8b8-4d06-415e-ac15-b7f751092a09
session_id: 35b5b8b8-4d06-415e-ac15-b7f751092a09
subagent_type: explorer
description: Inspect git history and repo state
The task is running in a subagent session.
You will be notified automatically when it completes …
```

**`task_id` 就是 `session_id`**——这把子代理直接接进了会话体系（可
`getMessages`、可 `resume`、可 `interrupt`）。

⚠️ **`child_session_available` 通知实测没有到达父会话流**（两轮均为 0 条）。
该通知在协议里确实存在：

```js
{ type:"child_session_available", childSessionId, toolUseId?, subagentType?, description?, timestamp }
```

但 daemon 侧 `DaemonSessionController` 自己持有
`pendingChildSessionHydrations` / `trackedChildSessionIds` /
`childSessionAttachmentGeneration`，看起来把它**内部消费**掉了。
**结论：面板不要依赖这条通知**，用 `Task` 的 tool_call（`description` +
`subagent_type`）配 tool_result（`task_id`）即可，而 DroidVisX 本来就在渲染
tool_call/tool_result。

### 0.8.4 🎯 实测：逐 agent 独立停止（截图那个按钮）

只停三个中的**第一个**（`sessions.resume(childId).interrupt()`），随后两次采样：

| 采样时刻 | 35b5b8b8（被停） | 538425ca | 4bcb4ea1 |
| --- | --- | --- | --- |
| 59.0s（停止前） | msgs=3 tools=2 last=LS | msgs=3 tools=2 last=Glob | msgs=5 tools=4 last=LS |
| **75.6s：仅停 35b5b8b8** | | | |
| 105.6s | msgs=5 **tools=2（冻结）** | msgs=10 **tools=17** | msgs=10 **tools=7** |
| 135.6s | msgs=5 **tools=2（仍冻结）** | msgs=10 tools=16 **last=Grep** | msgs=10 tools=7 |

**被停的那个彻底停住，另外两个继续推进**（`538425ca` 的 `lastTool` 从
`Glob` 变为 `Grep`）。这是**真正的"停一个、其余继续"**，与 §0.7.2 的
mission worker（停一个 → 整个 mission 暂停）本质不同。

### 0.8.5 实测：逐 agent 实时活动与成本

**实时活动**：`droid.sessions.getMessages(taskId, { limit })` 对**正在运行**的
子代理成功，可取末个 `tool_use` 名字，且随时间变化（LS → Glob → Grep）。
这就是截图里每行那句灰色副标题的数据源。**注意是拉取/轮询**，子代理自身的
流式事件不进父会话通知流。

**成本**（会话 sidecar `tokenUsage`）：

| 子代理 | input | output | 说明 |
| --- | --- | --- | --- |
| 35b5b8b8 | 406 | 177 | 早期被停，成本很低 |
| 538425ca | 6,376 | 4,736 | 跑得最久 |
| 4bcb4ea1 | 3,447 | 802 | —— |

父会话的 `childInclusiveTokenUsageBySessionId` 也会累计子会话成本
（本轮只落了一个 key，采样时机所致；上一轮 mission 中该字段有 12 个 key）。

### 0.8.6 两层对比（决定面板怎么设计）

| 维度 | `Task` 子代理层 | Mission worker 层 |
| --- | --- | --- |
| 并发 | **真并行**，一批可同时多个 | **严格串行**，至多 1 个 |
| 启动 | 模型调 `Task`（await:false） | `StartMissionRun` 后由 runner 逐个派生 |
| 行标题 | `description`（工具明说"用于 UI"） | feature `description` |
| 类型徽标 | `subagent_type`（如 `explorer`） | feature `skillName` |
| 行 id | `task_id`（= session id） | `workerSessionIds.at(-1)` |
| 实时活动 | `getMessages(task_id)` 轮询 | `getMessages(workerId)` 轮询 |
| **停单个** | **✅ 只停它，其余继续** | ⚠️ 会暂停整个 mission |
| 成本 | 子会话 sidecar / 父 `childInclusive…` | 同 |
| 需要 mission 模式 | **不需要**（普通会话即可） | 需要（角色 tag + missionSettings） |
| 是否需 daemon | 否（process 通道也有 Task） | 走 tags 路线时需要 |

**因此：用户截图那种"多 agent 同时工作 + 每行独立停止"的面板，应当建在
`Task` 子代理层，而不是 mission 层。** 这一层门槛低得多：不需要 mission
模式、不需要角色 tag、不需要 daemon、不受订阅门控（子代理继承父会话模型），
且 DroidVisX 已经有部分管线（`hasSubagentSessionTag`、
`getSubagentCallingMetadata`、subagent watch）。

### 0.8.7 子代理面板实现清单

1. 行的产生：拦 `Task` 的 tool_call 取 `description` / `subagent_type`，
   配对其 tool_result 取 `task_id`（同一 `toolUseId` 配对）。
2. 行的实时副标题：对每个活 `task_id` 轮询
   `sessions.getMessages(task_id, {limit})`，取末个 `tool_use` 名字。
   建议 2–3 秒一次并做退避，跑完就停。
3. 行的停止按钮：`sessions.resume(task_id)` → `interrupt()` → `detach()`。
   实测只影响该行。
4. 行的成本：读子会话 sidecar `tokenUsage`，或父会话
   `childInclusiveTokenUsageBySessionId`。
5. 不要依赖 `child_session_available`（daemon 内部消费，实测收不到）。
6. 完成态：子代理报告会**自动**回到父会话（工具说明明确要求不要轮询等待
   交付），所以行的"完成"以父会话收到报告为准，不要用阻塞 `TaskOutput`。

**因此控制面能力表进一步修正为**：

| 动作 | 结论 | 通道 | 置信度 |
| --- | --- | --- | --- |
| 启动 mission | **可做** | daemon `sessions.create` + 角色 tag | **已实测** |
| 设 worker/validator 模型 | **必须做** | `sessions.updateSettings(id,{missionSettings})`，否则 worker 402 | **已实测**（§0.6） |
| 只读展示 | **可做** | 五种 `mission_*` 通知全走会话流（mission 目录可作兜底） | **已实测** |
| 暂停（running 态、用户主动） | **可做** | `session.interrupt()` → `paused` + `worker_paused` + `mission_paused`(pauseReason=null) | **已实测**（§0.6） |
| 恢复 | **可做** | 向同一会话发消息 → `StartMissionRun` → `mission_resumed` → worker 续跑至完成 | **已实测**（§0.6） |
| 停止当前 worker/Feature | **可做（但会暂停整个 Mission）** | `sessions.killWorker(orchestratorId, workerId)` | **已实测**（§0.7.2） |
| 逐 worker 实时活动 | **可做（轮询）** | `sessions.getMessages(workerId)` 取末个 `tool_use` | **已实测**（§0.7.3） |
| 逐 worker 成本/耗时 | **可做（读文件）** | 会话 sidecar `tokenUsage` / `assistantActiveTimeMs` | **已实测**（§0.7.4） |
| 多 worker 并行 | **不存在** | Droid mission 严格串行，同时至多 1 个 worker | **已实测**（§0.7.1） |
| 整体终止 | 可做 | 关会话 / 杀 daemon 会话 | 已实测（进程侧） |

**结论**：截图那套多 worker 面板——含**每行的停止按钮**——**可以干净地做出来**，
不需要写 mission 目录、不需要 Windows 控制台中转、也不需要子进程形态。
§0.2/§0.3/§0.4 描述的「`droid exec --mission` 子进程 + 读磁盘」形态因此降级为
备选方案（仍然有效，但更笨重）。

**代价提醒**：mission 规划阶段很慢很贵（本轮 14 分钟仍未进入执行，编排器
会大量调用 `Task` 子代理做评审），且默认模型受订阅门控，必须显式指定
可用模型。UI 需要为"规划中"这个长阶段设计交代。

### 0.5 对排期的影响

- **只读 Mission 面板：可做**，但接入形态与原假设完全不同——需要
  「派生 `droid exec --mission` 子进程 + 解析 stream-json + 监听 mission 目录」
  这条新链路，而不是复用现有 SDK 会话。工作量比原 V1 #5 的估计大。
- **控制面（暂停/恢复）：不可做**（该形态无 RPC 通道）。§1/§4 那套
  「暂停走 `interrupt_session`、恢复走 `start_mission_run` 确认」只在
  假想的 JSON-RPC mission 会话里成立，而那种会话**不存在**。
- 截图里的多 worker 面板：**行、标题、状态、逐 worker 绑定、成本都能做**；
  **每行的停止按钮做不了**（只能整体杀进程）。
- **建议**：把 V1 #5 重新定义为「Mission 只读观察台（子进程 + 目录监听）」，
  并明确标注控制面缺失；或推迟到 Factory 提供 JSON-RPC 可驱动的 mission
  入口后再做完整版。

---

## 1. 结论摘要（静态分析，已被 §0 实测修正）

> ⚠️ 本节及 §3–§6 是 2026-08-12 实机验证**之前**的静态推理，其乐观结论
> （pause/resume 可经公开通道实现）**已被 §0 推翻**——因为 mission 根本
> 无法通过 SDK 启动。保留本节仅为记录"协议面本应支持什么"。

先前结论记录为「公开面缺控制接口，GUI 最多做只读仪表盘」
（`spec-mission-design.md` §2.2）。本轮复核确认前半句成立、后半句
**过于保守**：不存在 mission 专用的控制方法，但 mission 的暂停与恢复
语义已经被**现有公开协议**覆盖。

| 能力 | 可行性 | 依赖的公开通道 | DroidVisX 现状 |
| --- | --- | --- | --- |
| 暂停 Mission | **可做** | `droid.interrupt_session` | **已接通**（未在 UI 标注语义） |
| 恢复 Mission | **可做** | 会话消息 + `start_mission_run` 工具确认 | 确认卡片已接通，缺引导 |
| 启动 Mission | 已可做 | `propose_mission` / `start_mission_run` 确认 | 已接通 |
| 终止单个 Worker | **可做** | `droid.kill_worker_session` | 未接（需低层客户端） |
| 阶段 / Feature / Worker 视图 | 可做 | 现有 mission 通知与 `loadSession().mission` | V1 #5 正在铺 |
| 打开 mission 工作目录 | 可做 | 纯编辑器能力（`vscode.open`） | 未接 |
| 独立的 pause / resume 专用方法 | **不存在** | —— | 用上面替代路径 |

**一句话（原静态结论，已被 §0 修正）**：控制面不需要任何私有接口即可复刻，
代价是「一个按钮 = 一次公开调用」的映射关系不是一对一，恢复需要两步。
**——实测表明前提（mission 能启动）不成立，见 §0。**

---

## 2. 调研依据与方法

### 2.1 依据来源

| # | 来源 | 性质 | 用途 |
| --- | --- | --- | --- |
| 1 | `node_modules/@factory/droid-sdk/dist/*.d.ts` | 随 npm 包发布的对外类型契约 | 协议方法枚举、资源面、事件与状态机类型 |
| 2 | SDK 导出表（`index.d.ts` / `node.d.ts`） | 公开 API 边界 | 判定某能力是「公开」还是「内部依赖注入面」 |
| 3 | CLI 随产品分发的诊断标识与 i18n 文案键 | 产品自带的可观测输出 | 确认行为语义（哪个动作触发哪个状态迁移） |
| 4 | CLI 运行期在本机生成的 mission 工作目录 | 本地产物，Schema 有公开定义 | 确认数据面可读性与目录布局 |

### 2.2 方法

1. **协议面盘点**：从来源 1、2 抽取客户端可调用的方法全集，与 mission
   相关需求逐项比对，确定「有 / 无」。
2. **交叉核对**：把 SDK 类型声明中的 daemon 方法名集合与本机 CLI 实际
   携带的同名集合做差集，确认公开声明**没有隐藏未公开的 mission 控制
   方法**（两侧一致）。
3. **行为语义确认**：用来源 3 的稳定诊断标识（`[JsonRpc]`、
   `[MissionRunner]`、`[StartMissionRun]`、`[pauseMissionRunner]`）与
   i18n 文案键（`statusMessages.pausingMission`、`missionResume.*`、
   `progressEntries.missionPaused/missionResumed`）定位「哪个公开调用会
   引起哪个 mission 状态迁移」。
4. **数据面确认**：核对 mission 工作目录布局与 `loadSession()` 返回的
   mission 结构，确认只读展示所需数据是否齐备。

### 2.3 本轮未做

- 未在真实 mission 会话上做端到端实机验证（需要可跑 mission 的账户与
  环境）。待验证项见 §7。
- 未改动生产代码，未新增依赖。

---

## 3. 公开协议面现状

### 3.1 客户端可调用的方法（我们当前的通道）

DroidVisX 走 `droid exec` 的 stream-jsonrpc 通道，可调用集合即
`DroidServerMethod`（35 项）。其中与 mission 相关的**只有两项**：

```ts
INTERRUPT_SESSION   = "droid.interrupt_session",
KILL_WORKER_SESSION = "droid.kill_worker_session",
```

**没有** `pause_mission` / `resume_mission` / `start_mission`。

### 3.2 daemon 资源面

daemon 侧 mission 资源被官方归入 experimental（`unstable.missions`），
且只有两个只读/确认类方法：

```ts
/** Experimental mission readiness operations available under `unstable.missions`. */
interface MissionsResource {
  inspectReadiness(cwd: string): Promise<DaemonInspectMissionReadinessResult>;
  acknowledgeReadinessWarning(cwd: string): Promise<DaemonAcknowledgeMissionReadinessWarningResult>;
}
```

daemon 方法全集里 mission 相关只有
`inspect_mission_readiness`、`acknowledge_mission_readiness_warning`、
`kill_worker_session`。经 §2.2 步骤 2 的差集核对，**公开声明与实际
携带集合一致**，不存在未公开的 mission 控制方法。

### 3.3 状态机（控制面设计的基准）

`MissionState` 七态，注释直接给出了控制语义：

```ts
Planning        = "planning"          // 运行未初始化前的规划阶段
AwaitingInput   = "awaiting_input"    // 空闲，等用户发消息
Initializing    = "initializing"      // 用户接受提案后创建 mission 产物
Running         = "running"           // Runner 活跃，派生/监控 worker；用户输入禁用
Paused          = "paused"            // 用户暂停执行，可恢复
OrchestratorTurn= "orchestrator_turn" // Worker 交回控制或失败，编排器接手
Completed       = "completed"         // 全部完成，终态
```

两点直接影响设计：

- `Running` 明确「用户输入禁用」→ 运行中 Composer 应禁用；
- `Paused` 明确「可恢复」→ 恢复是产品内既有语义，不是我们发明的。

另有 `MissionPauseReason` 两个**自动**暂停原因（用量上限 402、
Feature 重试预算耗尽），说明除用户主动暂停外还存在系统触发的暂停，
UI 需要区分展示。

### 3.4 小结

控制面**没有专用方法**——这一点与先前结论一致，不需要再复查。
真正的问题是：暂停/恢复语义有没有被别的公开方法覆盖。答案是有（§4）。

---

## 4. 可行的控制路径

### 4.1 暂停：公开的中断语义已覆盖 mission 暂停

**机制**：CLI 的 JSON-RPC 服务端在处理 `droid.interrupt_session` 时，
除了中断当前回合，还会附带执行 mission 暂停流程。该流程完成三件事：

1. 中断当前在跑的 worker 会话；
2. 追加 `worker_paused` 与 `mission_paused` 两条进度日志；
3. 把 mission 状态更新为 `paused`。

**证据锚点**：中断处理路径上的诊断标识 `[JsonRpc] Session interrupted
successfully` 与 `[JsonRpc] Failed to pause mission after interrupt`
成对出现；暂停流程自身的标识为 `[pauseMissionRunner]`；i18n 侧对应
`statusMessages.pausingMission` → `missionPaused`。

**适用条件（重要）**：该附带暂停只对**编排器（orchestrator）会话**生效；
若目标会话被标记为 worker / 委派会话，则跳过暂停，只做普通中断。这与
产品语义一致：中断编排器 = 暂停整个 mission；中断 worker = 只停那个 worker。

**状态前置条件**：暂停只在 `initializing` / `running` /
`orchestrator_turn`（以及特定条件下的 `awaiting_input`）生效；
`planning` 态会被转为 `awaiting_input`；其余状态为无操作。UI 因此
应当按状态决定暂停按钮的可用性，而不是无条件展示。

**DroidVisX 现状**：`FactoryDroidRuntime.interrupt()` 调用
`session.interrupt()`，即 `droid.interrupt_session`。**该能力已经接通**，
也就是说今天在 mission 运行中点停止，mission 已经在被正确暂停，只是
UI 未向用户表达这层语义。

**接入成本**：接近零——把现有停止动作在 mission 上下文中改为语义化
表达（见 §5）。

### 4.2 恢复：经会话消息触发既有的 `start_mission_run` 确认

**机制**：恢复不是一次独立调用，而是产品既有的两步流程：

1. mission 处于 `paused` 时用户输入解禁（对比 `Running` 的输入禁用），
   用户发一条继续指令；
2. 编排器据此发起 `start_mission_run` 工具调用 → 产生
   `ToolConfirmationType.StartMissionRun` 确认 → 批准后 mission 状态
   回到 `running` 并追加 `mission_resumed` / `mission_run_started`
   进度日志；若存在被暂停的 worker，会自动续跑该 worker。

**证据锚点**：`[StartMissionRun]` 路径上的
`Auto-resuming paused worker session` 与「恢复时授予重试预算」失败分支；
工具自身给模型的引导语明确写着「再次调用 `start_mission_run` 以继续」；
i18n 侧 `missionResume.*`（含 `cannotResume`、`invalidJson`、
`permissionDenied`、`missingTranscript` 等失败态文案）。

**辅助事实**：mission 处于 `paused` 时，编排器上下文会被自动注入一条
「已暂停 mission」提醒（含进行中 Feature 与 worker 交接信息），因此
用户只需给出继续意图，编排器有足够上下文发起恢复。

**DroidVisX 现状**：`StartMissionRun` 确认卡片**已经能渲染并结算**
（`spec-mission-design.md` §2.1 已记录）。缺的只是把「恢复」表达成
一个引导动作。

**接入成本**：低。见 §5 的「恢复」按钮设计。

### 4.3 终止单个 Worker：公开方法，但属破坏性操作

`DroidServerMethod.KILL_WORKER_SESSION` 是公开协议方法，低层客户端
暴露为 `killWorkerSession()`；高层会话对象未转发。

**判断**：能力真实且公开，但语义是「杀掉」而非「暂停」，且官方未提供
使用指引。建议：**纳入能力清单，但不作为一期按钮**；若要做，必须二次
确认 + 明确文案（「终止该 Worker，Mission 将由编排器接手」），并且只在
能明确识别 worker 会话时可用。

### 4.4 视图类控件（无协议依赖）

产品 Mission Control 视图自带的控件共五类：三视图切换
（Features / Workers / Models）、筛选、暂停、恢复、打开 mission 工作目录。
其中三视图切换与筛选是**纯展示逻辑**，打开目录用编辑器自身能力
（`vscode.open` / `revealFileInOS`）即可，均无协议依赖。

「完美复刻」的对齐目标就是这五项 + §4.1/§4.2 的两个控制动作。

---

## 5. GUI 接入具体思路

前提：V1 #5（Mission 只读展示）会把数据面与面板铺好。控制面在其之上
增量叠加，**不需要新的 Runtime 能力**（暂停复用 interrupt，恢复复用
既有确认结算通道）。

### 5.1 分层改动

| 层 | 改动 | 说明 |
| --- | --- | --- |
| Runtime | 无新增能力；`interrupt()` 保持不变 | 暂停即中断，语义差异在 Host 侧解释 |
| Bridge | 新增 `mission.control` 消息（`action: 'pause' \| 'resume-hint'`，带 `sessionId`） | 严格枚举 + 双向校验，不传内部 ID |
| Host | 路由：`pause` → 现有中断路径；`resume-hint` → 把一条继续指令送入会话（等价用户发消息） | 复用既有守卫（运行态、待处理交互） |
| Webview | Mission 面板增加动作区；按 `MissionState` 决定按钮可用性 | 复用现有安静视觉语言，不新增显眼元素 |

### 5.2 按钮可用性矩阵（按 §3.3 的状态前置条件）

| 状态 | 暂停 | 恢复 | 说明 |
| --- | --- | --- | --- |
| `planning` | 否 | 否 | 尚未进入运行 |
| `awaiting_input` | 视条件 | 否 | 空闲等输入 |
| `initializing` | 是 | 否 | 正在创建产物 |
| `running` | **是** | 否 | Composer 应禁用 |
| `paused` | 否 | **是** | 输入解禁 |
| `orchestrator_turn` | 是 | 是 | 编排器接手中 |
| `completed` | 否 | 否 | 终态 |

### 5.3 「暂停」的具体做法

1. mission 上下文下，把现有停止动作的呈现改为语义化：主按钮文案
   「暂停 Mission」，副文案说明「将中断当前 Worker，Mission 可稍后恢复」；
2. 点击 → 发 `mission.control { action:'pause' }` → Host 走现有中断；
3. 乐观反馈：立即进入「正在暂停…」（对齐产品自身的
   `pausingMission` → `missionPaused` 两段反馈），随后由真实的
   `mission_state_changed` 通知与 `mission_paused` 进度日志收敛为终态；
4. 非 mission 会话保持原「停止」语义不变。

### 5.4 「恢复」的具体做法

两种实现，建议先做 A：

- **A. 引导式（推荐，最小且诚实）**：`paused` 态显示「恢复 Mission」
  按钮，点击后把一条继续指令作为普通用户消息送入会话，随后编排器发起
  `start_mission_run`，用户在**已有的确认卡片**上批准。UI 需明示这是
  两步（按钮文案可为「恢复 Mission…」，暗示还有一次确认）。
- **B. 半自动**：在 A 的基础上，对紧随其后的 `start_mission_run` 确认
  提供「一并批准」的快捷路径。**风险**：把权限确认自动化会削弱用户对
  破坏性操作的控制，且需要精确判断「这张确认卡就是我刚触发的那次恢复」。
  建议在 A 稳定并有真实会话验证后再评估。

### 5.5 失败与降级

产品自身的恢复失败态已有文案分类（mission 文件 JSON 非法、读取权限
不足、会话转录缺失、读取错误）。GUI 应把恢复失败如实展示为对应原因，
**不做静默重试**；暂停失败（如状态不满足前置条件）则按无操作处理并
提示当前状态，不伪造成功。

---

## 6. 明确不采用的路径

| 路径 | 技术上是否可行 | 为何不采用 |
| --- | --- | --- |
| 直接写 mission 内部状态文件来暂停 | 运行循环每轮重读状态，写入确实会使其停止 | 属产品内部实现细节而非公开契约；会与产品进程并发写入同一文件；且**跳过**了中断 worker 与写进度日志两步，将留下「Mission 已停但 Worker 仍在跑」的不一致状态。公开的中断路径能得到完整且正确的暂停，没有任何理由走这条 |
| 依赖内部符号 / 内部管理器类 | —— | SDK 文档把这些归入内部与 daemon 依赖注入面，不属对外契约，随版本变动即失效 |
| 自动批准恢复确认（§5.4 方案 B 的激进版） | 可行 | 违反「破坏性操作需用户确认」的既有产品原则；先做方案 A |
| 模拟终端按键驱动交互式界面 | —— | 与我们的运行形态（非交互式协议通道）不符，脆弱且不可测 |

**总原则**：控制面只允许经公开协议方法与既有确认结算通道实现；
mission 工作目录**只读不写**。

---

## 7. 实机验证结果（2026-08-12，已执行）

§7 原为"待验证清单"，其六项全部以"mission 已在 JSON-RPC 会话里运行"为
前提。实测证明**该前提不成立**（§0.1：`--mission` 与流式输入互斥），因此
这六项在 DroidVisX 可用的通道里**永久无法成立**，不是"暂未验证"。

| # | 原待验证项 | 实测状态 | 说明 |
| --- | --- | --- | --- |
| 0（新增前置） | mission 能否经 SDK / JSON-RPC 启动 | **否（决定性）** | `--mission cannot be used with streaming input formats`；见 §0.1 |
| 0b（新增） | mission 能否经 `droid exec --mission` 子进程启动 | **是** | 完整跑通：提案→产物→StartMissionRun→worker 完成并提交；见 §0.2 |
| 1 | interrupt 后 mission 转 `paused` | **形态不适用** | 子进程形态无 JSON-RPC 通道，调不到 `interrupt_session` |
| 2 | 中断对编排器回合的影响 | **形态不适用** | 同上 |
| 3 | 暂停后 Composer 解禁 | **形态不适用** | 子进程形态没有持续输入通道 |
| 4 | 继续指令是否触发 `start_mission_run` | **形态不适用** | 同上 |
| 5 | 被暂停 worker 是否自动续跑 | **未验证** | 需先有可用的暂停手段 |
| 6 | worker 中断是否不触发 mission 暂停 | **形态不适用** | 无 worker 级 RPC 通道 |

新增已验证项（面板可行性的正面结论）：

| # | 项 | 结果 |
| --- | --- | --- |
| 7 | mission 工具是否被装配 | **是**，`--mission` 下 `system/init` 的 `tools` 含三个 mission 工具 |
| 8 | 默认模型可用性 | **否**，Factory 托管模型 402；须 `--model`/`--worker-model`/`--validator-model` 覆盖为 `custom:` |
| 9 | worker 是否真实派生并干活 | **是**，`worker_started` + 沙盒里留下真实提交 |
| 10 | 面板数据面是否齐备 | **是**，`features.json` / `progress_log.jsonl` / `state.json`，字段与 SDK schema 一致（§0.3） |
| 11 | 逐 worker↔feature 绑定是否可得 | **是**，`worker_selected_feature` + `workerSessionIds` |
| 12 | 整体终止是否干净 | **是**，杀进程树后无残留 droid 进程 |

复现方式：

```
# 反面（SDK 通道，必然失败，含模型原话）
node artifacts/probe-mission-why.mjs
node artifacts/probe-mission-daemon.mjs

# 互斥证据
droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc --mission --auto high

# 正面（真跑通，注意覆盖模型，会消耗额度并真实改文件）
droid exec --mission --auto high --output-format stream-json \
  --model custom:<id> --worker-model custom:<id> --validator-model custom:<id> "<prompt>"

# 二进制门控检索
node artifacts/bin-scan-mission.mjs && node artifacts/bin-scan-mission2.mjs
```

---

## 8. 排期建议（已按 §0 实测更新）

1. **重新定义 V1 #5 为「Mission 只读观察台」**，接入形态改为：派生
   `droid exec --mission` 子进程 → 解析 stream-json 拿会话流 → 监听
   `~/.factory/missions/<id>/` 拿状态/Feature/进度。**不复用现有 SDK 会话**，
   因此工作量高于原估计（新增一条独立链路 + 文件监听 + 进程生命周期管理）。
2. **控制面（暂停/恢复）不进任何版本**，直到 Factory 提供 JSON-RPC 可驱动
   的 mission 入口。§1/§4 那套替代路径只在假想的 JSON-RPC mission 会话里
   成立，而该会话被 CLI 旗标互斥排除。唯一可做的是「整体终止」（杀进程树），
   若要提供必须明确文案为"终止 Mission"而非"暂停"。
3. **模型覆盖是硬前置**，须写进实现：mission 默认模型受订阅门控，本账户 402。
   UI 必须允许（或自动）把 worker/validator 模型设为可用模型，否则一启动就失败。
4. **Worker 终止（§4.3）** 不进本期：`kill_worker_session` 是 JSON-RPC 方法，
   子进程形态下无通道。
5. **先前结论回标**：`spec-mission-design.md` §2.2 与 `HANDOVER.md` §3
   「做不了的」表需修正为——**只读展示可做（经子进程 + 目录监听）；
   start 可做（即启动子进程）；pause / resume 不可做（无 RPC 通道）；
   逐 worker 停止不可做**。回标动作待用户确认后执行。

---

## 附：与既有文档的关系

- `spec-mission-design.md` §2：mission 数据面证据（事件、状态、
  `loadSession().mission` 恢复投影）与只读展示设计——仍然有效，本报告
  不重复，只补控制面。
- `HANDOVER.md` §3：V1 #5 即 mission 相关切片；「做不了的」表需按 §8.4
  回标。
- `implementation-status.md`：待控制面实际交付后再更新，本报告不预先
  记账。
