# 切片④开工预研：完整 Spec Mode 闭环（spec-mission §1）

> 状态：**现行预研，对应切片未实现**（V1 #4，见 `HANDOVER.md` §3）。
> 开工时与 spec-mission-design §1 同读。
>
> 预研日期：2026-08-12。由只读预研代理产出，服务
> [`spec-mission-design.md`](./spec-mission-design.md) §1 的实现开工。
> 所有结论基于本地文件实证（标注文件与行号）。SDK 版本
> `@factory/droid-sdk@0.7.0`；完整 d.ts = `dist/index-D_SzTnFR.d.ts`，
> node d.ts = `dist/node.d.ts`。

## 1. 设计假设 → 实证结果

### 1.1 SDK 能力（设计 §1.1）——全部核实

| 设计假设 | 实证结果 | 证据 |
| --- | --- | --- |
| `createSession({ interactionMode: Spec, specModeModelId?, specModeReasoningEffort? })` | ✅ `SessionInitOptions` 含全部三字段 | node d.ts L588–604（specMode 两字段 L596–597） |
| `session.enterSpecMode(params?)` 专用方法 | ✅ 行号精确一致：`enterSpecMode(params?: Pick<UpdateSessionSettingsRequestParams, 'specModeModelId' \| 'specModeReasoningEffort'>)` | node d.ts L664 |
| `updateSettings({ interactionMode, specModeModelId?, specModeReasoningEffort? })`，spec 字段可 `null` 重置 | ✅ 行号精确一致；`specModeModelId: ZodOptional<ZodNullable<ZodString>>` | 完整 d.ts L80358–80426（spec 字段 L80364–80365） |
| ExitSpecMode 确认详情 `{ plan: string, title?: string }` | ✅ 行号精确一致 | 完整 d.ts L14843–14854 |
| 审批应答含 `editedSpecContent?` | ✅ | 完整 d.ts L17255 起 |
| outcome：ProceedOnce / ProceedNewSession{,Low,Medium,High} / ProceedEdit / Cancel | ✅ 枚举完整（另含 ProceedAlways* / ProceedAutoRun* / MCP 专用项） | 完整 d.ts L5–24 |
| `agent_turn_completed` 通知带 `reason: SpecHandoff = "spec_handoff"` | ✅ 枚举 L179–204（SpecHandoff L185）；通知 schema `{ type, reason, turnId?, tokenUsage, cumulativeTokenUsage? }` | 完整 d.ts L185、L7889–7924；通知类型注册 L126 |
| 新会话 ID 无专用字段，靠 envelope `params.sessionId !== session.id` proxy | ✅ 官方示例逐行确认（订阅 + SessionNotificationSchema 校验 + proxy 警告注释） | `examples/node/spec-mode-new-session.ts` L52–63 |
| `settings_updated` 回读权威 Settings | ✅ `SettingsUpdatedPayloadSchema` 含 interactionMode + specModeModelId + specModeReasoningEffort | 完整 d.ts L105167–105174 |

**新发现的 schema 细微差**（设计未提，实现时留意）：
`SettingsUpdatedPayloadSchema` 里 `specModeModelId` 是
`ZodOptional<ZodString>`（L105173）——**不可 null**；而 update 请求里
可 null 重置（L80364）。即"重置后"的回读表现为字段缺席而非 null，
Host 投影时把 undefined 当"未设置"即可，不要写 null 分支。

### 1.2 现有代码差距清单（设计 §1.2 核实 + 补充）

**已接通（不要重做）：**

- ExitSpecMode 权限投影：`src/runtime/runtimeInteractions.ts` L387–394
  （title/plan/editableSpecContent = plan）；kind 白名单含
  `exit_spec_mode`（`src/shared/interactionProtocol.ts` L26）。
- `ProceedEdit` 强制携带 editedSpecContent：
  `permissionOptionRequiresEditedSpec`（runtimeInteractions.ts
  L127–131）+ 结果校验（L161–178，非 ProceedEdit 忽略编辑稿、
  超长 Cancel）。
- 选项完全由 SDK 下发、无硬编码：`projectPermissionRequest`
  L259–278 逐项校验 label/value。
- Webview plan 卡片：`getPermissionPresentation` 把 exit_spec_mode
  升级为 `plan` 卡（`src/webview/assistant/Interactions.tsx`
  L696–714）；编辑 textarea + 32K 计数 + 超长禁用
  （L103–189、L282–283）。
- `settings_updated` 事件：`src/runtime/normalizeSdkEvent.ts` L113–116
  → Host 回读权威 Settings。
- `onNotification` 管线：`FactoryDroidRuntime.ts` L933–978（MCP auth
  在用），session view 已透出 `onNotification`（L1630–1632）。
- Session 替换/收养机制：fork 收养全流程在
  `src/extension/ChatController.ts` L1542–1580（sessionId 切换、目录
  upsert、recoveryStore 写入、历史重载）——handoff 收养可照此复用。

**缺口（本切片的实现面）：**

| # | 缺口 | 锚点 |
| --- | --- | --- |
| G1 | Settings 投影丢弃 spec 字段：`projectSessionSettings` 只投 interactionMode/modelId/reasoningEffort/autonomyLevel | `FactoryDroidRuntime.ts` L1352–1382 |
| G2 | Settings 更新不支持 spec 字段、未用 enterSpecMode：`projectSettingsUpdate` 只有四个 field 分支 | `FactoryDroidRuntime.ts` L1455–1498 |
| G3 | Bridge settings DTO 无 spec 字段：`SessionSettingUpdateMessage` 四个 field；`ConfirmedSessionSettings` 四字段 | `src/shared/bridgeMessages.ts` L489–513、L573–578 |
| G4 | `agent_turn_completed` / `spec_handoff` 零消费（全仓 rg 无命中） | 无 |
| G5 | envelope sessionId proxy 捕获逻辑不存在（onNotification 只订阅 MCP auth 两类） | `FactoryDroidRuntime.ts` L945、L978 |
| G6 | Spec 模式可视标识（Composer/转录顶部徽标）不存在 | — |
| G7 | specs 目录浏览不存在（设计已建议 V1 不做，维持） | — |

### 1.3 设计未标注的风险（实证发现）

**R1（重要）：超长 plan 会被静默 Cancel。**
plan 作为 detail 受 `MAX_INTERACTION_DETAIL_LENGTH = 32_768` 约束
（`interactionProtocol.ts` L6）；`summary()` 对超限 detail 返回 null
（`runtimeInteractions.ts` L536–549），链式导致
`projectPermissionTool` → `projectPermissionRequest` 返回 null →
**整个审批被自动 Cancel**（L143–145），用户看不到任何卡片、Droid 收到
拒绝。真实 spec 文档超 32K 字符并不罕见（`~/.factory/specs/` 是完整
多章节 Markdown）。实现闭环时必须处理：要么提高
exit_spec_mode 专属上限，要么截断展示但保留完整 plan 供编辑/回传，
并给出可见降级——不能保留"静默取消"。

**R2：handoff proxy 的误报面。**
官方口径（示例 L52–55 注释）：任何"其他会话"的通知都会触发
`params.sessionId !== session.id`。子代理（`child_session_available`）
与 mission worker 会话也走同一 envelope。设计 §1.3-D 的双信号确认
（proxy + `reason === 'spec_handoff'`）是必须的，不能只看 proxy；
且捕获窗口应限定在"已发送 ProceedNewSession* 审批之后"。

**R3：`enterSpecMode` 与 `updateSettings` 的选择。**
两者等价（enterSpecMode 就是 updateSettings 的收窄投影，node d.ts
L664 签名可证）。现有 Mode 触发器走 `updateSettings`
（`projectSettingsUpdate` L1469–1475）。建议**继续用 updateSettings
一条通道**并扩展 spec 字段（G2 一并解决），不引入第二条代码路径；
设计中"改用 enterSpecMode（语义更明确）"是可选项而非必需。

## 2. 开工实现清单（Bridge → Runtime → Host → Webview）

### Bridge

- `src/shared/bridgeMessages.ts`
  - `ConfirmedSessionSettings`（L573）加
    `specModeModelId: string | null`、
    `specModeReasoningEffort: SessionReasoningEffort | null`
    （null = 未设置，与回读缺席语义对齐）。
  - `SessionSettingUpdateMessage`（L489）加两个 field 变体
    （值允许 null 表示重置）。
  - 新增 Host→Webview `spec.handoff` 状态消息（pending/adopted/
    timeout 三态 + 新会话标题），或并入现有 session 目录/快照机制——
    实现时二选一，倾向后者（收养即快照替换，无需新消息）。
- `src/shared/validateMessage.ts` + `src/webview/bridge/validateHostMessage.ts`：
  新 field 变体与新消息的双向 exact-keys 校验 + 敌对输入测试。

### Runtime

- `FactoryDroidRuntime.ts`
  - `projectSessionSettings`（L1352）投影 spec 两字段（缺席 → null）。
  - `projectSettingsUpdate`（L1455）加 `specModeModelId` /
    `specModeReasoningEffort` 分支（校验复用 isSafeModelId /
    RUNTIME_REASONING_EFFORTS，允许 null）。
  - 新增 handoff 监听：在审批结果为 `proceed_new_session*` 发出前，
    Runtime 侧登记待确认态；`onNotification` 订阅（复用 L933 起的
    管线模式）捕获 envelope proxy + `agent_turn_completed`
    （filter type）的 `reason === 'spec_handoff'`；双信号齐备后发
    `spec-handoff { implementationSessionId }` RuntimeEvent；60s 超时
    发 warning 事件。ID 校验 `isSafeBridgeId`。
- `runtimeInteractions.ts`：R1 修复——exit_spec_mode 的 plan 上限
  单列（建议新常量 `MAX_SPEC_PLAN_LENGTH`，两侧共享），超限走
  截断展示 + 完整回传，不再整体 Cancel。
- `runtimeEvents.ts`：新增 `spec-handoff` / handoff 超时事件类型。

### Host（ChatController.ts）

- 处理 spec 设置更新消息（走既有 settings updating/ready 状态机）。
- 处理 `spec-handoff` 事件：复用 fork 收养序列（L1542–1580 模式）——
  sessionId 切换、目录刷新、`loadHistoryTimed` 重载、recoveryStore
  写入、`spec-handoff` info 诊断；超时走 warning 诊断 + 转录内
  diagnostic 项提示手动刷新 History。
- 收养期间拒绝新 turn（复用 session 操作互斥态）。

### Webview

- `ComposerControls.tsx`：Spec 模式下 Model 面板加 "Spec mode model /
  reasoning" 组（数据源 = 既有 modelCatalog 投影）；Mode 触发器旁
  "Spec mode · planning" 徽标（数据源 = 权威 interactionMode）。
- `Interactions.tsx`：plan 卡升级——可展开全宽预览 ↔ textarea 切换
  （GFM 管线复用）；Approve Split Button 对 `proceed_new_session*`
  显示 SDK label 原文（现已无硬编码，只调排版）。
- `store.ts`：spec 设置字段进 settings state；handoff 提示态。

### 验收锚点

- 真实 Cursor：Spec 起草 → Approve in new session → 转录自动切到
  实施会话并继续流式显示（设计 §1.3-D 验收标准）。
- 冒烟可复现：任何账户可用 Mode 触发器进 Spec；`--use-spec` CLI 旗标
  存在（设计文档已实测 `droid --help`）。
- R1 回归：构造 >32K plan 的 ExitSpec 请求，断言不再静默 Cancel。

## 3. 与 implementation-status 的同步项

落地时更新："部分完成 → Spec" 行的"尚缺"列（spec 设置、handoff
收养、徽标）；V1 清单"完整 Spec Mode"复选项；若 R1 修复引入新上限
常量，在 Bridge 上限清单中登记。
