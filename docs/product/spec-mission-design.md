# 第三档难点调研与设计：Spec Mode 闭环、Mission、子代理层级

> 状态：**现行设计待实现**——§1 Spec 闭环 = V1 #4，§3 子代理摘要 +
> §2 Mission 只读 = V1 #5（见 `HANDOVER.md` §3）。Mode 切换与
> ExitSpec 审批子集已生产接通（见 `implementation-status.md`），
> 勿重复实现。§1 开工预研见
> [`slice-prep-spec-mode.md`](./slice-prep-spec-mode.md)。
>
> 调研日期：2026-08-11
>
> 证据来源：`@factory/droid-sdk@0.7.0` 类型定义
> （`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`，下称
> “完整 d.ts”；`dist/node.d.ts`，下称 “node d.ts”）、SDK 自带示例
> （`examples/node/`）、SDK 参考文档
> （`docs/typescript-sdk-reference.md`）、`droid --help` 实测输出、
> `~/.factory/` 真实目录结构，以及当前仓库源码。
>
> 本文档只做调研与设计，不包含实现。所有能力均标注 SDK 证据；
> 未找到证据的能力明确标记为“不支持”。

## 结论速览

| 项目 | 结论 | SDK 支持度 |
| --- | --- | --- |
| 完整 Spec Mode 闭环 | **可行**。进入/退出/审批/编辑/新会话交接全部有公开 SDK 渠道；唯一缺口是“起草过程无专用增量事件”（起草即普通流式文本）和“specs 目录无公开 API” | 高 |
| Mission 启动与阶段展示 | **只读展示可行，控制面不可行**。协议层（通知、确认、历史投影）完整；公开 SDK 无 pause/resume/start 专用 RPC。2026-08-12 外部攻关一度改判「可经公开通道实现」，随后实机验证推翻（mission 本身无法经 SDK 启动），用户拍板维持「等 SDK 暴露接口」——全程见 [`mission-control-feasibility.md`](./mission-control-feasibility.md)（以其 §0 为准） | 中（只读子集） |
| 子代理活动层级展示 | **摘要级可行，逐事件层级不可行**。`child_session_available` 通知 + `loadSession().subagentInvocations` 提供子会话身份与终态摘要；子会话内部事件不进父会话流 | 中（摘要子集） |

推荐实现顺序：**Spec 闭环 → 子代理摘要层级 → Mission 只读展示**（理由见末节）。

---

## 1. 完整 Spec Mode 闭环

### 1.1 SDK 真实能力清单（全部有证据）

**进入 Spec Mode（三条公开渠道）：**

1. 创建即进入：`createSession({ interactionMode: DroidInteractionMode.Spec, specModeModelId?, specModeReasoningEffort? })`
   —— node d.ts `SessionInitOptions`（第 588–604 行）；示例
   `spec-mode-new-session.ts` / `spec-mode-same-session.ts`。
2. 会话中切换（专用方法）：
   `session.enterSpecMode(params?: { specModeModelId?, specModeReasoningEffort? })`
   —— node d.ts 第 664 行；示例 `enter-spec-mode.ts`。
3. 通用设置更新：`session.updateSettings({ interactionMode, specModeModelId?, specModeReasoningEffort? })`
   —— 完整 d.ts `UpdateSessionSettingsRequestParamsSchema`（第 80358 行起），
   `specModeModelId` / `specModeReasoningEffort` 接受 `null` 表示重置。
   **DroidVisX 当前 Mode 触发器走的就是这条路**
   （`FactoryDroidRuntime.ts` 的 `interactionMode` 更新分支）。

**Spec Mode 专属会话设置：**

- `specModeModelId?: string`、`specModeReasoningEffort?: ReasoningEffort`
  —— 规划阶段可以用与实施阶段不同的模型和推理档位。SDK 文档
  （reference 第 205–208 行）确认这两个字段是公开 Settings 的一部分，
  `loadSession().settings` 会回读它们。**当前 DroidVisX 未暴露该设置。**

**起草过程：**

- **没有** “spec draft delta / spec file updated” 之类的专用通知。
  `SessionNotificationType` 枚举（完整 d.ts 第 105–148 行）中不存在任何
  spec 起草相关条目。Spec Mode 下 Droid 使用只读工具做调研
  （reference 第 389 行：“Spec: Droid is in planning/research mode only
  (read-only operations)”），起草内容以普通
  `assistant_text_delta` / `thinking_text_delta` 流式输出。
  **“spec 文档实时渲染”只能渲染普通对话流，不存在独立的 spec 文档流。**

**退出审批（闭环核心）：**

- 确认类型 `ToolConfirmationType.ExitSpecMode = "exit_spec_mode"`，
  详情载荷 `{ plan: string, title?: string }`
  —— 完整 d.ts 第 14843–14854 行。`plan` 是完整 Markdown 计划文本。
- 审批应答 `RequestPermissionResult = { selectedOption, comment?, editedSpecContent? }`
  —— 完整 d.ts 第 17252 行起。`editedSpecContent` 用于回传用户编辑后的
  spec（当前 DroidVisX 已接入，且 Runtime 强制只在
  `ProceedEdit` 时携带，见 `runtimeInteractions.ts`
  `permissionOptionRequiresEditedSpec`）。
- 关键 outcome（`ToolConfirmationOutcome`，完整 d.ts 第 5–24 行）：
  - `ProceedOnce`：批准计划，**同会话**继续实施；
  - `ProceedNewSession` / `ProceedNewSessionLow/Medium/High`：批准计划，
    **交接到新会话**实施（后缀为新会话的 autonomy 档位）；
  - `ProceedEdit`：携带 `editedSpecContent` 批准；
  - `Cancel`：拒绝。
  实际可见选项由 SDK 在权限请求的 `options` 列表中动态下发，
  UI 不应硬编码（当前实现已遵守）。

**新会话交接（handoff）的检测——两个公开信号：**

1. `agent_turn_completed` 通知带
   `reason: AgentTurnCompletionReason.SpecHandoff = "spec_handoff"`
   —— 完整 d.ts 第 179–204 行（枚举）与第 7889–7891 行
   （通知 schema：`type` / `reason` / `turnId?` / `tokenUsage`）。
   这是“本回合因 spec 交接而结束”的明确信号。
2. 新会话的 ID 没有专用字段：SDK 示例与文档（reference 第 790、1245 行）
   明确说明 “New-session handoff IDs currently require inspecting raw
   notifications” —— 交接后到达的 `SessionNotification` envelope 上
   `params.sessionId` 不再等于 `session.id`，以此为代理信号捕获实施会话
   ID（`spec-mode-new-session.ts` 第 52–63 行演示了
   `session.onNotification` + `SessionNotificationSchema` 的标准做法，
   并警告这只是 proxy）。
3. 同会话继续时，SDK 发出 `settings_updated`，Host 回读权威 Settings
   （DroidVisX 已接通，Mode 显示不会停留在旧 Spec）。

**specs 目录（实测）：**

- `~/.factory/specs/` 真实存在，扁平结构，按日期 + slug 命名的 Markdown
  文件（如 `2026-08-11-spec-1.md`），内容为完整 spec 文档
  （目标/交付文件/结构与质量标准等章节）。
- **SDK 没有任何列举/读取 spec 文件的公开 API**（完整 d.ts 与 reference
  文档中无 `specs` 目录相关方法；`DroidServerMethod` 枚举里也没有）。
  这是 CLI 私有磁盘约定，与 `~/.factory/sessions/` 同级
  （SDK 的 `listSessions()` 是 SDK 自己实现的 jsonl 扫描，
  spec 没有等价物）。

### 1.2 DroidVisX 现状

- Mode 触发器可切 Auto/Spec/Mission（`updateSettings` 路径）。
- ExitSpecMode 审批已接：plan 以安全 GFM 渲染、`ProceedEdit` 编辑框
  （32K 字符上限 `MAX_EDITED_SPEC_LENGTH`）、审批结果回传、
  `settings_updated` 权威回读（`Interactions.tsx` 的
  `getPermissionPresentation` 将其升级为 `plan` 卡片）。
- **缺**：spec 模式专属模型/推理设置；spec 模式下的可视状态标识；
  `ProceedNewSession*` 交接后的新会话收养；specs 目录浏览。

### 1.3 产品化闭环设计

**A. 进入 spec mode（小改动）**

- 保留 Mode 触发器为入口。切到 Spec 时 Runtime 改用
  `session.enterSpecMode(params)`（语义更明确，且可携带
  `specModeModelId` / `specModeReasoningEffort`）；或继续用
  `updateSettings`，二者等价，选一即可。
- Model 面板在 Spec 模式下增加一组 “Spec mode model / reasoning”
  可选项（数据源仍是既有 BYOK `availableModels` 投影，不新增目录来源）；
  不设置时留空让 CLI 用默认值。这是纯增量：Bridge 的 settings DTO
  加两个可选字段，校验复用现有 model/reasoning 规则。

**B. 起草过程展示（不发明能力）**

- 起草就是普通 assistant/thinking 流，现有转录组件原样承接。
  增加的只有状态标识：Session 处于 Spec 模式时，在 Composer Mode
  触发器与转录顶部显示 “Spec mode · planning” 徽标
  （数据源：已有的权威 `interactionMode`）。
- **不做** “spec 文档实时渲染”视图 —— 没有对应事件流，任何实现都只能
  伪造。明确记录为 SDK 限制。

**C. 审批 / 编辑 / 拒绝（打磨现有卡片）**

- 保留现有扁平内联 plan 卡片与 Deny/Edit/Approve 层级。升级两点：
  1. plan 预览区从“受限高度滚动”升级为可展开的全宽 spec 文档视图
     （仍是同一 GFM 渲染管线，只是排版：标题、章节间距、
     可折叠 “View full spec”），编辑态在同一卡片内切换
     预览 ↔ textarea（现状已有 textarea，补充预览/编辑切换即可）；
  2. Approve 的 Split Button 菜单里，把 `ProceedNewSession*` 选项
     按 SDK 下发的 label 显示为 “Approve → implement in new session
     (autonomy)”，让交接语义在点击前可见。选项仍完全来自 SDK
     `options`，无硬编码。

**D. 退出后的执行衔接（本切片的真正增量）**

- 同会话（`ProceedOnce` / `ProceedEdit`）：无需新机制，实施继续在
  当前流内，`settings_updated` 已让 Mode 回到 Auto。
- 新会话（`ProceedNewSession*`）：Host 在发送该审批结果前登记
  “handoff 待确认”状态，然后：
  1. 订阅 `session.onNotification`（生产代码已有该管线，MCP auth
     在用），校验 envelope 后捕获第一个
     `params.sessionId !== session.id` 的会话 ID 作为实施会话候选
     （SDK 官方做法，但按官方口径视为 proxy）；
  2. 同时监听 `agent_turn_completed`（filter `type`），
     `reason === 'spec_handoff'` 时确认交接发生；
  3. 二者齐备后，走与 Compact/Fork 完全相同的 Session 替换机制收养
     实施会话（重载转录、写恢复存储、目录刷新、发出 info 级
     `spec-handoff` 诊断）；规划会话保留在目录中可切回；
  4. 超时（如 60s 未捕获到新会话 ID）则降级：发出 warning 诊断
     并提示用户在 History 中手动刷新查找 —— 不阻塞、不伪造。
- 验收标准：真实 Cursor 中 Spec 模式起草 → Approve in new session →
  转录自动切到实施会话并继续流式显示实施过程。

**E. specs 目录浏览（建议降级为可选）**

- 技术上 Host 可只读扫描 `~/.factory/specs/*.md` 提供一个 “Specs”
  抽屉（复用 SessionDrawer 模式）。但这是**私有磁盘约定而非公开
  契约**，CLI 随时可能改变布局；且文件与会话无公开关联字段。
  建议：V1 不做；若做，明确标注 best-effort、只读、解析失败静默跳过。

### 1.4 做不了的（记录为 SDK 限制）

- 起草过程的 spec 文档增量事件：无。
- 列举/读取/关联 spec 文件的公开 API：无。
- 新会话交接 ID 的专用字段：无，只有 envelope sessionId proxy
  （SDK 文档自认的当前限制）。

---

## 2. Mission 启动与阶段展示

### 2.1 SDK 证据：协议层完整，控制面缺失

> 注意：早前一次对完整 d.ts 的检索工具查询曾误报 “mission 无匹配”。
> 经 `rg` 复核，mission 相关类型**大量存在**，以下全部为实际行号。

**可以进入 mission 模式：**

- `DroidInteractionMode.Mission = "mission"`（完整 d.ts 第 392–398 行，
  注释 “Droid orchestrates missions with read-only tools and orchestrator
  controls”；`AGI` 为其废弃别名）。可经 `createSession` 或
  `updateSettings` 设置 —— DroidVisX 的 Mode 触发器今天就允许切换。
- `missionSettings`（`MissionModelSettingsSchema`，第 4907–4929 行）：
  `workerModel` / `workerReasoningEffort` / `validationWorkerModel` /
  `validationWorkerReasoningEffort` / `skipScrutiny` / `skipUserTesting`，
  是 `UpdateSessionSettingsRequestParams` 的公开字段。

**mission 生命周期由确认流驱动（已部分接入）：**

- `ToolConfirmationType.ProposeMission = "propose_mission"`，详情
  `{ proposal: string, title?: string }`（第 14855–14866 行）；
- `ToolConfirmationType.StartMissionRun = "start_mission_run"`，详情
  `{ runningMissionCount: number, runningMissionSessionIds: string[] }`
  （第 14867–14878 行）。
- DroidVisX 已把这两类显示为 mission 风格权限卡片
  （`Interactions.tsx` `getPermissionPresentation`）并能结算 ——
  即“接受任务提案 / 批准开跑”已经可用，这就是公开 SDK 里的
  “Mission 启动”。

**运行期通知（全部在生产 stream 循环可见）：**

`DroidStreamEvent` 联合类型（完整 d.ts 第 106108 行）**直接包含**
`MissionStateChanged | MissionFeaturesChanged | MissionProgressEntry |
MissionHeartbeat | MissionWorkerStarted | MissionWorkerCompleted`。
DroidVisX 的 Turn 循环用 `session.stream(text, { includePartialMessages:
true })`（`FactoryDroidRuntime.ts` 第 288 行），所以这些事件已经在
流里到达，只是被 `normalizeSdkEvent` 的 `default` 分支丢弃。载荷：

- `mission_state_changed`：`{ state: MissionState, updatedAt? }`；
  `MissionState` 七态：`planning / awaiting_input / initializing /
  running / paused / orchestrator_turn / completed`（第 286–301 行）。
- `mission_features_changed`：`{ features: MissionFeature[] }`；
  `MissionFeature = { id, description, status(FeatureStatus 四态),
  skillName, preconditions[], expectedBehavior[], fulfills?, milestone?,
  workerSessionIds?, currentWorkerSessionId?, completedWorkerSessionId? }`
  （第 2974–3010 行）。
- `mission_progress_entry`：`{ progressLog: ProgressLogEntry[] }`；
  条目 11 种（第 328–340 行）：mission accepted/paused/resumed/
  run-started、worker started/selected-feature/completed/failed/paused、
  handoff items dismissed、milestone validation triggered。
  `WorkerCompletedEntry` 还带 `successState`、`handoff`
  （whatWasImplemented / whatWasLeftUndone / verification /
  discoveredIssues）等丰富结构。
- `mission_heartbeat`：`{ timestamp }`；
  `mission_worker_started` / `mission_worker_completed`：
  `{ workerSessionId }` / `{ workerSessionId, exitCode }`
  （第 5918–5950 行）。

**历史与恢复投影：**

- `loadSession()` 结果顶层带
  `mission?: { state, title?, features[], progressLog[], workerStates?,
  tokenUsage?, tokenUsageBySessionId?, workingDirectory?, updatedAt? }`
  与 `decompSessionType?: 'orchestrator' | 'worker'`
  （`LoadSessionResultSchema`，第 27518 行起；mission 字段第 29761 行；
  `DecompSessionType` 第 281–284 行）。恢复旧 mission 会话时可以
  一次性重建全部阶段展示。

**控制面（这里是硬缺口）：**

- `DroidServerMethod` 枚举（第 56–91 行）中与 mission 相关的 RPC 只有
  `KILL_WORKER_SESSION`；node d.ts 上它是低层
  `DroidClient.killWorkerSession()`（第 287 行），高层 `DroidSession`
  没有暴露。
- **没有** `pause_mission` / `resume_mission` / `start_mission` RPC。
  `MissionStateManager` / `MissionSnapshotStore` /
  `MultiMissionStateManager` 虽出现在导出表中，但 SDK 文档明确把它们
  归入内部/daemon 依赖注入面（reference 第 936 行）；daemon 的
  `MissionsResource` 只有 `inspectReadiness` /
  `acknowledgeReadinessWarning`（第 106388 行），且 daemon 路径
  DroidVisX 尚未接入。
- CLI 侧：`droid --help` 无 mission 子命令或旗标（spec 有 `--use-spec`，
  mission 没有对应项），mission 在 CLI 内是交互式触发。

### 2.2 结论

> **2026-08-12 攻关注记**：本节原判「Pause / Resume 不可行，只能等
> SDK」当日一度被外部攻关的静态调研推翻（称暂停/恢复可经公开
> `interrupt_session` + 既有 `start_mission_run` 确认实现），随后
> 实机验证再次推翻该乐观结论：mission 本身无法经 SDK 启动（mission
> 工具不被装配给模型），控制面无对象可控。用户拍板：**现阶段做不了，
> 等待 SDK 暴露接口后再议。**攻关全记录见
> [`mission-control-feasibility.md`](./mission-control-feasibility.md)
> （以其 §0 为准）。本节原判维持有效。

- **可行（公开 SDK 支持）**：切换 Mission 模式、配置 missionSettings、
  审批 ProposeMission / StartMissionRun（即“启动”）、实时消费六种
  mission 通知做只读阶段展示、从 `loadSession().mission` 恢复历史
  mission 状态、识别 worker 会话（`decompSessionType`）。
- **不可行（记录为“等 SDK”）**：Pause / Resume / 主动 Start 按钮、
  Worker 重试控制、mission 级设置的运行中修改保证。
  `killWorkerSession` 虽存在但属低层破坏性操作，不建议在无官方
  语义文档时暴露为产品按钮。

### 2.3 设计（只读展示切片）

- **Runtime**：`normalizeSdkEvent` 新增 mission 事件分支，投影为有界
  `RuntimeEvent`（state 枚举白名单、features 数量上限如 64、
  description ≤512、progressLog 增量只投影最新 N 条、worker ID 保持
  Host 侧不进 Webview——与既有隐私边界一致，feature 描述文本例外放行
  因为它就是给用户看的计划内容）。
- **Bridge**：新增 `mission.status` 消息（state + features 摘要 +
  最近 progress 条目 + worker 计数），双向严格校验。
- **Host**：会话为 mission 模式或 `loadSession().mission` 存在时启用；
  Session 替换/恢复时从历史 mission blob 合成一次全量，然后按通知增量
  更新。
- **Webview**：转录顶部（Header 下）一条 mission 状态条：
  `MissionState` 标签 + features 进度（`已完成/总数`，复用 task-plan
  清单的渲染模式）+ 可展开的 progress 时间线。`running` 态按 SDK 注释
  禁用 Composer 输入（“User input disabled”）。
- **最小替代方案**（若整片延后）：只识别 mission 会话并展示状态标签 ——
  Host 在 `loadSession` 投影时读 `mission.state` 与
  `decompSessionType`，History 行与 Header 显示 “Mission ·
  running/paused/completed” 徽标。改动面：一个投影字段 + 一个 Bridge
  字段 + 一个徽标组件。
- 风险：需要真实 mission 会话做冒烟验证（要有可跑 mission 的账户/
  环境），验证成本高于 spec；建议排在 spec 之后。

---

## 3. 子代理活动层级展示

### 3.1 SDK 证据

- **实时通知** `SessionNotificationType.CHILD_SESSION_AVAILABLE =
  "child_session_available"`，载荷 `{ childSessionId, toolUseId?,
  subagentType?, description?, timestamp }`（完整 d.ts 第 7553–7572
  行）。`toolUseId` 把子会话精确挂到父转录中的那一个 Task 工具调用上。
  **注意：它不在 `DroidStreamEvent` 联合里**，必须走
  `session.onNotification`（生产代码已有该管线）。
- **工具进度** `ToolProgressUpdateSchema` 带可选
  `subagentSessionId`（第 4947–4948 行，注释 “The session ID of the
  spawned subagent”）—— 第二个实时关联信号。
- **历史/终态摘要**：`loadSession()` 顶层
  `subagentInvocations?: SubagentInvocationSummary[]`，每项
  `{ childSessionId, subagentType, description,
  status: TaskInvocationStatus, toolUseCount?, durationMs? }`
  （第 27496–27517、30681–30702 行）；`TaskInvocationStatus` 五态
  `pending/running/completed/failed/cancelled`（第 154–160 行，注释
  明确这是 “Task-spawned subagent invocation” 的生命周期，
  “Mirrored by the CLI's durable invocation ledger”）。
- **磁盘佐证**：`~/.factory/task-invocations.json` 真实存在（本机
  126KB），条目含 `taskInvocationId / parentSessionId / parentToolUseId /
  childSessionId / status / subagentType / description / toolUseCount /
  durationMs`，与 schema 完全对应。
- **辅助函数**：SDK 导出 `hasSubagentSessionTag(tags)` 与
  `getSubagentCallingMetadata(tags)`（第 108435–108436 行）——
  子会话本身通过 SessionTag 标记其父子关系，可用于在 History 中
  识别“这是某次 Task 的子会话”。
- 子会话是普通会话：`childSessionId` 可以直接走既有
  `loadSession` 历史加载管线只读查看。

### 3.2 现状与关键限制

- 仓库现状：`src/` 中没有任何 subagent / child_session 痕迹
  （`rg` 证实；`normalizeSdkEvent.ts` / `runtimeEvents.ts` 均无）。
  Task 工具调用目前显示为一条普通 Tool 行。
- **关键限制**：子会话内部的逐事件流（它自己的 thinking/tool/text）
  **不会**进入父会话的 stream 或通知。公开渠道只提供：启动时的身份
  （type/description/childSessionId）、进度 update 里的零散
  `subagentSessionId`、以及终态摘要（toolUseCount/durationMs/status）。
  所以“转录中实时缩进展示子代理的每一步”做不到，能做到的是
  “层级化的子代理摘要行”。

### 3.3 最小方案设计

- **Runtime**：
  1. 订阅 `onNotification`（filter `child_session_available`），投影为
     `subagent-started` RuntimeEvent：`{ toolUseId?, subagentType,
     description }`（description ≤512；childSessionId 留在 Host，
     不进 Webview——与既有 “Subagent ID 不进 Webview” 的隐私边界一致）。
  2. Turn 结束或历史加载时，从 `loadSession().subagentInvocations`
     投影终态摘要（status/durationMs/toolUseCount）。
- **Bridge**：Tool transcript 项新增可选
  `subagent?: { type, description, status?, toolUseCount?, durationMs? }`
  字段（双向校验，数量上限沿用现有 Tool 上限）。
- **Webview**：`toolUseId` 匹配的 Tool 行升级为“子代理行”：
  - 主标签 “Delegated to `<subagentType>` subagent”，副行 description；
  - 状态徽标 pending/running/completed/failed/cancelled；
  - 完成后行内显示 “N tool uses · 真实耗时”（仅当 SDK 报告）；
  - 视觉上以一级缩进 + 左侧竖线呈现在父 Task 行之下 —— 层级只有一层
    （父 Task → 子代理摘要），与 SDK 能力一致，不伪造更深层级。
- **可选进阶**（仍在公开 SDK 内）：子代理行提供 “View subagent
  transcript” 动作，Host 用 `childSessionId` 走既有历史加载管线在
  只读视图打开子会话转录。改动大（需要只读转录视图容器），建议
  作为独立后续切片。

### 3.4 做不了的

- 父转录内实时逐事件的子代理活动流：无公开渠道。
- 多层嵌套（子代理的子代理）层级：`subagentInvocations` 是父会话
  一层的平面列表，`child_session_available` 也只在直接父会话上发出；
  更深层级需要递归 loadSession，属进阶而非最小方案。

---

## 4. 实现优先级建议

1. **P1 — Spec Mode 闭环**：SDK 支持最完整（专用方法、专用确认、
   专用完成原因、官方示例三个），DroidVisX 已有 60% 的管线
   （Mode 切换、ExitSpec 卡片、编辑回传、settings 回读、onNotification、
   Session 替换机制），真正的新增量只有 handoff 收养 + spec 设置 +
   展示打磨。可独立冒烟（`--use-spec` / `enterSpecMode` 在任何账户
   可复现），风险低。
2. **P2 — 子代理摘要层级**：数据源清晰（一个通知 + 一个历史字段），
   改动面窄（Tool 行增强），且本机已有真实 ledger 数据可对照验证。
   依赖 Task 工具真实触发做冒烟。
3. **P3 — Mission 只读展示**：协议完整但（a）控制面缺失导致产品体验
   天然残缺（不能暂停/恢复，只能看），（b）冒烟需要真实可跑的 mission
   环境，验证成本最高。建议先做“最小替代”（mission 会话状态标签，
   见 2.3），完整状态条/时间线在 Spec 与子代理落地后再排。

## 5. 与 implementation-status 的衔接

落实以上任一切片时，`docs/product/implementation-status.md` 需要
同步更新的条目：

- “部分完成 → Spec” 行（当前只写了 ExitSpec 审批子集；闭环落地后
  改写“尚缺”列）；
- “部分完成 → Mission” 行与 “仅探测/声明 → Mission Mode 和 Events”；
- V1 清单中的 “完整 Spec Mode / Mission 启动 / Mission 阶段和 Worker
  摘要” 三个复选项；
- Tool 展示的安全限制段（若子代理 description 开始进入 Webview，
  需要把该字段列为经校验的例外，与 AskUser 问题文本同类）。
