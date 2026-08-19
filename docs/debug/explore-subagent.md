# 功能探索（子代理）

只跟进 **子代理 / agent 团队 / 流式体验** 等需调研再定方案的条目。  
状态词：`已完成` / `待实机验收` / `未做` / `部分` / `待验证`。

---

## 条目

| 编号 | 问题 | 说明 | 版本 | 状态 |
| --- | --- | --- | --- | --- |
| 16 | 子代理 preview 不像主会话流式，一股脑输出 | 已改为 **Task 进度卡**：状态 / 已耗时 / 最近活动 / 工具次数；父会话保留最终结论，原转录 sheet 仅作 Details 兜底 | v0.7.28 | 待实机验收 |
| 31 | 工作流创建 agent 团队后看不到具体内容；有时开子代理、有时启终端会话 | 后端 + Bridge v20 + UI 已接通：顶部团队入口、整页只读转录、复用主聊天消息渲染且无 Composer；普通抽屉继续过滤 exec | v0.7.28 | 待实机验收 |

---

## 16 体验差距（备忘）

| 对比项 | 现状 | 主会话期望 |
| --- | --- | --- |
| 子代理 preview | 约 3s 轮询刷新 | 真 token 流式输出 |
| 产品决策 | 当前可视为「有预览」 | 若仍要真流式 → 开探索任务后再动 Runtime / Bridge |

## 方向定稿（2026-08-15）

按启动形态分两条路，不再追求 Task 型真流式：

- **Task 型子代理 → 进度卡片**：不做转录预览，卡片显示 状态 / 已耗时 / 最近活动 / 工具次数，结束后展示最终结论摘要。数据走现有轮询即可（间隔可放宽）。无真进度百分比，本质是活动指示器。#16 随之关闭。
- **终端团队型（`droid exec` 独立会话）→ 只读完整预览**：像主聊天一样渲染转录，仅禁发消息。前置依赖 #31 调研（会话可发现性、消息通道、Bridge 多会话）。
- 现有 SubagentTranscriptSheet 暂留作卡片详情兜底，实机验收后再决定删否。

### 实施（2026-08-15，v0.7.28）

- Task 行下的 `SubagentSummaryRow` 已升为进度卡；运行时计时是 Webview
  首次看到该任务后的本地 fallback，终态优先显示台账 `durationMs`。
  最近活动沿用 `subagent.activity` 轮询，`toolUseCount` 缺失时显示 `—`，
  不伪造百分比。
- `TeamSessionsPage` 按打开生命周期发送 `team.panel`，只请求 Host 已发现
  的 exec id；列表用“Active recently”明确 mtime 启发语义。转录 5s
  快照刷新，复用共享 `ReadOnlyTranscript`，无发送、重问、Fork、终端
  或 Changes 操作。
- BTW split pane 未承载 Task 或团队内容，继续只服务 `/btw`。
- v0.7.28 已完成 typecheck、预算门禁、11 个触及测试文件 194 例、
  build、VSIX 校验与 Cursor 安装；表中两项保留“待实机验收”，等待
  Reload Window 后确认真实数据和视觉。

---

## 31 调研结论（2026-08-15，只读调研）

### 形态结论（有证据）

启动形态由会话 sidecar / 索引的 `tags` 权威区分，三种形态**都完整落盘**到
`~/.factory/sessions/<cwd-slug>/<sessionId>.jsonl`（全量转录）+
`<sessionId>.settings.json`（tokenUsage / assistantActiveTimeMs / model / tags），
并进入全局索引 `~/.factory/sessions-index.json`（条目含
sessionId/title/cwd/mtime/messagesCount/tags）：

| tag | 形态 | 今日实盘证据（天气卡片工作区） |
| --- | --- | --- |
| `sdk` | 我们扩展经 SDK 创建的主聊天 | `cf82b1cf…`「搭建项目级多模型 Agent 工作流」 |
| `exec` | **agent 团队**：Droid 在主会话里用 Execute 工具跑 `droid exec` 起的独立 CLI 进程 | `92abab25…`（Sol 编排）、`38fa92f9…`（Luna）、`f67935c4…`（Flash 测试） |
| `subagent` | Task 工具派发的子会话，metadata 带 `callingSessionId`/`callingToolUseId` | `38d4ca49…`「Researcher-luna: 调研径向塔防设计」 |

启动命令原文（主会话转录 Execute tool_use 实拍）：
`droid exec --cwd 'D:\…' --model 'custom:gpt-5.6-sol' --enabled-tools Task,TaskOutput --output-format text "<prompt>"`。
exec 会话的 title 即 prompt 前缀，可与父会话的 Execute 行关联。
日志（`~/.factory/logs/droid-log-single.log`）显示 exec 走完整 CLI 冷启动
（`cli_startup_total_latency`、`SessionController Session created`），是独立进程，
**不经我们的 daemon**。

### 终端团队型 → 只读完整预览：可行

- **发现通道（有证据）**：daemon `sessions.list` 行含 `tags`/`cwd`/`modifiedTime`
  （`DaemonSessionCatalog.ts:80-104` 已消费），或直读 `sessions-index.json`
  （私有契约，先例 `sessionFavorites.ts`）。按 cwd + `exec` tag + mtime 新鲜度过滤即得团队会话。
- **消息通道（部分有证据）**：
  - daemon `sessions.getMessages(id,{limit≤100})` 对 **daemon 内**运行的子代理已实测可用
    （`mission-control-feasibility.md` §0.7.3/§0.8.5）；对 exec 外部会话**未探测**
    （旁证：daemon 的 `sessions.search`/`list` 是全局盘面读，getMessages 读盘可能成立）。
  - jsonl 直读 tail：文件自 session_start 起存在；**是否逐消息 append 待实机验证**
    （日志无每消息落盘行；crash 恢复语义与 45MB 活跃会话强烈暗示增量写）。
  - `FactorySessionHistoryLoader.loadHistory`（spawn CLI 短进程）对任何持久化会话可用，
    但单次 ~3.5s，只配做首帧/终帧，不配做轮询主通道。
- **呈现（有证据）**：`SubagentTranscriptSheet.tsx` 已实现「3s 快照 + item 级增量
  diff + running 状态映射 + follow scroll」的只读转录（v0.7.23 #58），换个数据源即可复用；
  快照轮询体验接近主聊天，但**不是真 token 流**（与 #16 同边界）。
- **Bridge（有证据）**：Webview store 是单会话（`store.ts` `sessionId: string|null`），
  btw 是同状态侧卡、子代理转录是快照消息 + sheet 覆盖层——只读预览沿用 sheet 模式即可，
  **不需要 store 多会话重构**；新增一对 W→H/H→W 消息，`BRIDGE_PROTOCOL_VERSION` 19→20。
- **附带发现（风险）**：会话抽屉目录只滤 `subagent`/mission worker tag、**不滤 `exec`**
  （`FactorySessionCatalog.ts:212-221`），exec 会话现在就进抽屉；用户若 resume 一个
  正在跑的 exec 会话会与终端进程双写（待实机确认表现）。

### Task 型 → 进度卡片数据面：基本够

台账 `loadSession().subagentInvocations`（`subagentSummary.ts:87-138`）已有
`status`/`toolUseCount`/`durationMs`/`childSessionId`；最近活动 = 现有
`sampleActivity` 轮询末个 tool 名（`subagentControl.ts:58-69`）；最终结论 =
父会话 Task 行 tool_result 已在转录里。缺口：token/费用需另读子会话 sidecar
`tokenUsage`（probe §0.7.4 已证可读、未接线）；`toolUseCount`/`durationMs`
运行中是否更新待验证（可能仅终态可用）。

### 改造方案

- **方案一（推荐）：发现 + 复用 sheet 管线**。Runtime 加 exec 会话发现与转录快照读取
  （getMessages 优先，探针核对后决定退 loadHistory 降频或 jsonl tail）；Host 新模块
  `teamSessionPanel.ts`（对照 `subagentPanel.ts` 的轮询/单飞/生命周期约定）；Bridge v20
  新消息对（exec 会话 id 作 opaque id 过桥，沿用 SAFE id 校验）；Webview 复用
  SubagentTranscriptSheet 呈现 + quiet 团队列表入口。量级 ~3-4 天，风险中低。
- **方案二：jsonl tail 直读为主通道**。不依赖 daemon、若增量写成立可近似流式；
  但私有文件契约、Windows fs.watch 可靠性、部分行解析、首读成本，量级 4-6 天，风险中。

**探针已跑（2026-08-15 施工）**：(a) getMessages 对 exec **可读**；(b) jsonl **批量增量** append；(c) listOpened **不含** exec。方案一已实施后端，见 [handover-2026-08-15.md](./handover-2026-08-15.md)。

---

## 不在本册

Bug → [bug.md](./bug.md)；样式 → [style-refactor.md](./style-refactor.md)；扩展 → [feature-extend.md](./feature-extend.md)。

> 今天我发现的问题是这样，他自己主动派发的agent和我设置的agent团队 是两种不同的形式，我设置的agent团队是他通过指定终端启动的，如果是这样的话，我感觉就可以像cursor和我们的主聊天一样预览除了我不能主动对话，别的应该都一样，但是他自己派发的agent的话，之前就说做了无法预览，需要自己像办法，你看看他到底是怎么样的形式，我们能怎么改不
