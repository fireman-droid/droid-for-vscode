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

> 依据：`artifacts/probe-mission-*.mjs` 四个实机探针，CLI 0.193.0，
> 消耗真实账户额度，在一次性 git 沙盒
> （`react+ts\个人简历-mission-probe`）内运行，未触碰任何生产代码或真实项目。

**一句话**：**当前 DroidVisX 的架构做不出截图里那种多 worker 面板**，
因为**通过 SDK（无论 ProcessTransport 还是 daemon WebSocket）都无法真正
启动一个 mission**——mission 工具从未被装配给模型，mission 状态机永远
不会启动，也就没有 worker、没有 `mission_*` 通知、没有可暂停/恢复的对象。

### 0.1 实测事实（四次独立运行，结果一致）

| # | 探针 | 观察到的事实 |
| --- | --- | --- |
| 1 | `probe-mission-control.mjs`（process，创建后 `updateSettings` 切 mission） | 模式写入成功（`settings_updated` 回显 `interactionMode:"mission"`），但模型直接把三个文件自己写了，**零** mission 通知、**零** propose/start 确认 |
| 2 | `probe-mission-why.mjs`（process，捕获助手原话） | 模型明说：**"I cannot propose or start the mission because the ProposeMission and StartMissionRun tools are not available in this environment."** 只调了 `ToolSearch` |
| 3 | `probe-mission-control3.mjs`（process，**创建时**即 `interactionMode: mission`） | 与 #2 相同：40s 结束、只调 `ToolSearch`、无 mission 活动。**创建时设 vs 事后设没有区别** |
| 4 | `probe-mission-daemon.mjs`（**daemon** WebSocket，用解密的 WorkOS token 认证，且已 `acknowledgeReadinessWarning`） | 与 process 完全一致：模型说 **"neither `ProposeMission` nor `StartMissionRun` is available in this session's tool catalog"**，只调 `ToolSearch`。**daemon 也救不了** |

### 0.2 工具目录里有、但没被装配

`droid.list_tools` 在 mission 模式下**确实**返回三个 mission 工具，且
`allowed: true`：

```
{"id":"EndFeatureRun","category":"read","defaultAllowed":true,"allowed":true}
{"id":"ProposeMission","category":"read","defaultAllowed":true,"allowed":true}
{"id":"StartMissionRun","category":"read","defaultAllowed":true,"allowed":true}
```

矛盾点在于：**目录里 `allowed:true`，但实际发给 LLM 的工具集里没有它们**
（模型自己反复确认拿不到）。也就是说，存在一道**目录之外的工具注入闸门**，
不在我们能通过 SDK 触达的权限层。`MissionRunner` 的真正编排逻辑不在
SDK 包里（SDK 只有 daemon RPC 的客户端桩），而在 `droid` 二进制内部。

### 0.3 唯一未排除的变量：仓库 readiness

daemon 的 `inspect_mission_readiness` 对沙盒仓库返回：

```json
{"isGitRepo":true,"hasRemote":true,"isEmpty":false,
 "warning":{"state":"no_report","repoUrl":"https://github.com/linzekai/resume-probe.git"}}
```

`no_report` = 该仓库**未被 Factory 后端索引/评分**。readiness 的合法态是
`ok | no_git | no_remote | no_report | low_score`。我在探针里调用了
`acknowledgeReadinessWarning` 仅**消除警告 UI**，mission 工具仍未装配。
**尚未验证**的是：一个 readiness=`ok`（已被 Factory 索引、有评分）的真实
仓库能否让工具装配起来。要造这样的仓库需要真实的 Factory 后端索引流程，
非本地可控，故留作单独变量。

### 0.4 对排期的影响

- 截图里的多 worker 面板、逐 worker 实时状态、逐 worker 暂停/恢复——
  **在 mission 无法通过 SDK 启动的前提下全部无数据可渲染、无对象可控制**。
- 原报告 §1/§4「暂停走 `interrupt_session`、恢复走 `start_mission_run`」
  的路径**尚未被证实，且很可能是空中楼阁**：连 mission 都起不来，控制面
  是下游问题。这些路径的静态推理保留在 §4，但**不得据此排期**。
- **建议**：Mission 控制面（含只读展示）**移出 V1**，降级为"受阻，待
  Factory 侧提供 SDK 可驱动的 mission 入口或经 readiness=ok 复测确认"。
  V1 #5 若要保留，只做**已存在于普通会话流里的** `propose_mission` /
  `start_mission_run` 确认卡片的被动渲染（当它们真的出现时），不主动依赖
  mission 模式。

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

§7 原为"待验证清单"。现已实测，但**在第 0 步就被拦下**：mission 无法
通过 SDK 启动，因此清单里第 1–6 项（全部以"mission 已在运行"为前提）
**无法进入验证**。逐项状态：

| # | 原待验证项 | 实测状态 | 说明 |
| --- | --- | --- | --- |
| 0（新增前置） | mission 模式能否经 SDK 启动 | **否（决定性）** | process + daemon 四次运行，模型均报告 ProposeMission/StartMissionRun 不可用；见 §0 |
| 1 | interrupt 后 mission 转 `paused` | **无法验证** | 无 mission 可暂停 |
| 2 | 中断对编排器回合的影响 | **无法验证** | 同上 |
| 3 | 暂停后 Composer 解禁 | **无法验证** | 同上 |
| 4 | 继续指令是否触发 `start_mission_run` | **无法验证** | 同上 |
| 5 | 被暂停 worker 是否自动续跑 | **无法验证** | 同上 |
| 6 | worker 中断是否不触发 mission 暂停 | **无法验证** | 同上 |

**唯一剩余变量**（§0.3）：readiness=`ok` 的 Factory 已索引仓库是否会
改变工具装配。需要真实后端索引流程，本地不可造，留作单独跟进。

复现方式：

```
node artifacts/probe-mission-why.mjs       # process，捕获模型原话
node artifacts/probe-mission-daemon.mjs    # daemon，token 认证 + readiness ack
```

---

## 8. 排期建议（已按 §0 实测更新）

1. **Mission 控制面移出 V1，标记为"受阻"**。根因不是"缺控制方法"，而是
   **mission 模式无法通过 SDK 驱动**（§0）。在这个前提解除前，控制面与
   只读面板都无数据、无对象可做。
2. **V1 #5 降级或移除**。若保留，只做"当 `propose_mission` /
   `start_mission_run` 确认在普通会话流里自然出现时被动渲染确认卡片"，
   **不主动切 mission 模式、不依赖 mission 状态机**。
3. **解除阻塞的两条路**（任一成立即可重启本议题）：
   (a) 在 readiness=`ok` 的真实 Factory 已索引仓库上复测 §0，确认工具是否
   装配；(b) 等 Factory 提供 SDK/daemon 可驱动的 mission 启动入口。
4. **Worker 终止（§4.3）** 一并延后，且建议把 §4.3 的"杀 worker"改为
   worker 会话级 `interrupt()`（更干净），但同样受制于 mission 起不来，
   本期不做。
5. **先前结论回标**：`spec-mission-design.md` §2.2 与 `HANDOVER.md` §3
   「做不了的」表原记"Mission 控制面只读"。本报告一度改判为"可经公开通道
   pause/resume"，**现经实机验证再次修正为**：无专用方法，且 mission 模式
   本身无法经 SDK 启动，控制面与只读面板当前**均受阻**。回标动作待用户
   确认后执行。

---

## 附：与既有文档的关系

- `spec-mission-design.md` §2：mission 数据面证据（事件、状态、
  `loadSession().mission` 恢复投影）与只读展示设计——仍然有效，本报告
  不重复，只补控制面。
- `HANDOVER.md` §3：V1 #5 即 mission 相关切片；「做不了的」表需按 §8.4
  回标。
- `implementation-status.md`：待控制面实际交付后再更新，本报告不预先
  记账。
