# 子代理转录只读回放 — 探针实测与分档设计

日期：2026-08-12。任务性质：调研 + 探针，未改动任何 `src/` 生产代码，
未打包。探针脚本：`artifacts/probe-child-observer.mjs`；原始结果：
`artifacts/probe-child-observer.out.json`（本文全部数字与形状样本
来自 2026-08-12 第 2 次运行；第 1 次运行用于发现认证与时序问题）。

## 0. 结论速览

| 探针 | 一句话结论 |
| --- | --- |
| P1 观察者连接 | 第二条连接可以只读附加到运行中的子会话且不打扰父回合，但 **daemon 不为子会话广播任何细粒度消息事件**（零 `create_message`/delta），观察者连接做不了转录直播。 |
| P2 历史文件尾随 | 子会话 JSONL **边跑边写、整行 flush、可安全并发读**（4 次运行中采样全部行完整、0 读错误、0 半行），文件尾随是可行的"准直播"通道，粒度为整条消息。 |
| P3 终态读取 | 子会话历史文件格式与主会话**完全一致**，现有 `projectSessionHistory` 管线**原样投影成功**（6 items，`historyStatus: complete`），唯一差异是 `session_start` 多带 `callingSessionId`/`callingToolUseId`。 |
| 顺手验证 | **会话抽屉泄漏属实**：`listSessions` 会返回子会话；子会话 `.settings.json` 带 `subagent` 标签，SDK 自带 `hasSubagentSessionTag` 判别函数，过滤成本低。 |

推荐路线：**保底档（终态回放）先行**，升级档走**文件尾随**（观察者
连接已被实测否决）。第一切片 = 保底档 + 抽屉过滤子会话。

## 1. 探针方法与成本

- 脚本用与生产 `daemonLifecycle.ts` 相同的方式拉起**私有 sidecar
  daemon**（`droid daemon --port <free> --parent-pid <probe pid>`，
  探针退出即消亡），不触碰用户可能在跑的共享 daemon。
- 认证复用 `readFactoryAccessCredential()` 同源的本地凭据（探针内
  自行解密 `~/.factory/auth.v2.file` 得 token；token 不进输出文件、
  不进本文）。
- 会话 cwd 指向一次性临时目录，父会话 prompt 要求"用 explore 子代理
  调查三个暗号词"，稳定触发一次 Task 委派。
- **真实成本**：2 次完整运行 = 2 个短父回合 + 2 个子会话（每次
  ~70–90 秒）。**残留**（未清理，均无害）：`~/.factory/sessions/`
  下临时 cwd 对应目录里的父+子 `.jsonl`/`.settings.json`、
  `~/.factory/task-invocations.json` 各一条 entry、`~/.factory/logs`
  下的 daemon 日志。

拓扑：一条**驱动连接**（`connectToDaemon` 门面，跑父回合）+ 两条
**裸 `DaemonClient` 观察连接**（P 观察父、C 观察子，`onMessage`
记录全部 WebSocket 帧）+ 一条**门面观察连接**（对运行中的子会话做
`sessions.resume`）。

## 2. 探针一：观察者连接（P1）

### 2.1 结论

1. **附加本身可行**：用已知 sessionId 对运行中的会话（父或子）发
   `daemon.load_session` RPC，第二条连接即被订阅进该会话的通知流；
   对子会话做 `sessions.resume` 也成功且父回合不受干扰（父回合
   正常 `success` 收尾、答案含全部暗号词，`facadeDetach: ok`）。
2. **对"父会话"，附加后能收到全量细粒度事件**（13 × `assistant_text_delta`、
   4 × `tool_call`、`create_message`、`child_session_available`、
   `agent_turn_completed`……）——说明 daemon 的通知扇出机制本身完整。
3. **但对"daemon 内部驱动的子会话"，附加后只有粗粒度事件**：观察者 C
   在子会话运行窗口内实时收到了 1 × `settings_updated` + 8 ×
   `mcp_status_changed`（49.2s–56.6s），而同窗口磁盘上子会话 JSONL
   从 1 行涨到 7 行——**零 `create_message`、零 delta**。子会话的
   agent loop 在 daemon 进程内部驱动，不经过通知广播路径发布消息
   事件。观察者连接拿不到子会话转录内容，**此路不通**。
4. 两个工程事实（第 1 次运行的失败换来的）：
   - `DaemonLoadSessionRequest` 的客户端 Zod 要求 `params.token`
     （缺了直接 ZodError，不发请求）；
   - 子会话的 JSONL 落盘滞后于 `task-invocations.json` 台账 ~4s、
     滞后于 `child_session_available` 通知数秒，落盘前 `load_session`
     / `resume` 报 `Session file not found` / `SessionNotFoundError`，
     需要有界重试（本次运行观察者 C 第 3 次尝试、attach 于 48.7s
     成功）。

### 2.2 关键证据（脱敏摘录）

时间轴（ms 为探针启动后耗时）：

```
11430  观察者 P loadSession(parent) 成功（回合开始前）
11432  父回合开始
41542  台账 task-invocations.json 出现 childSessionId
45211  子会话 .jsonl 落盘（首行 session_start）
45253  观察者 P 收到 child_session_available 通知
48726  观察者 C loadSession(child) 成功（重试第 3 次）
49197  门面连接 sessions.resume(child) 成功
72798  父回合 success 结束
```

观察者 P（附加到父）收到的通知类型计数——细粒度事件齐全：

```json
{
  "settings_updated": 1, "mcp_status_changed": 7,
  "droid_working_state_changed": 4, "create_message": 4,
  "session_token_usage_changed": 6, "thinking_text_complete": 1,
  "tool_call": 4, "session_title_updated": 1,
  "tool_execution_phase_changed": 2, "child_session_available": 1,
  "tool_result": 1, "assistant_text_delta": 13,
  "assistant_text_complete": 1, "agent_turn_completed": 1,
  "session_closed": 1
}
```

观察者 C（附加到运行中的子）收到的、以子会话 id 为 scope 的通知——
只有粗粒度：

```json
{ "settings_updated": 1, "mcp_status_changed": 8 }
```

`child_session_available` 通知形状（观察者 P 于 45253ms 收到，字段
名实测）：

```json
{
  "method": "daemon.session_notification",
  "sessionId": "<parent uuid>",
  "type": "child_session_available",
  "childSessionId": "<child uuid>",
  "toolUseId": "…", "subagentType": "explorer", "description": "…"
}
```

补充：对运行中的子会话轮询 `daemon.get_session_messages`（3 次采样：
48.7s → 0 条、52.2s → 0 条、72.8s（回合后）→ 5 条）。中段无采样点，
**运行中途该 RPC 能否看到已落盘消息未证实**；即便可行，其粒度与文件
尾随相同（整条消息）而门槛更高（要 daemon + token），故不作为升级档
候选。

## 3. 探针二：历史文件尾随（P2）

### 3.1 结论

子会话 JSONL **边跑边写**，flush 粒度为**完整 JSONL 行 = 完整一条
消息**（不含流式 delta；delta 只存在于通知流，从不落盘）。运行中用
普通 `readFileSync` 并发读取（Windows、daemon 进程持续写入）**无锁
冲突、无半行**。这足以支撑"准直播"：延迟 = 消息完成时间 + 尾随
轮询间隔（秒级）。

### 3.2 证据

运行中 4 次采样（+ 终态 1 次），全部 `endsWithNewline: true`、
`lastLineParses: true`、读错误 0、半行 0：

| 采样时刻 | 字节 | 行数 | 尾行完整 |
| --- | --- | --- | --- |
| 45.6s | 407 | 1 | ✓ |
| 57.7s | 8 271 | 3 | ✓ |
| 64.6s | 12 106 | 5 | ✓ |
| 67.5s | 12 692 | 7 | ✓ |
| 终态 | 12 692 | 7 | ✓ |

注意事项（升级档实现要点）：

- 文件**出现时刻滞后**：`child_session_available` / 台账先到，
  `.jsonl` 晚 ~4s 落盘，尾随器要容忍"文件暂不存在"。
- 子会话文件与父会话在**同一 cwd 目录**下，路径可由
  `<sessions dir>/<cwd 派生目录>/<childSessionId>.jsonl` 直接构造。

## 4. 探针三：终态读取（P3）

### 4.1 结论

子会话结束后，其 loadSession 信封**原样**喂给生产
`projectSessionHistory`（探针直接 import `src/runtime/history/projectSessionHistory.ts`）
投影成功：`status: available`、6 items（user 1 / thinking 1 /
tool 3 / assistant 1）、`historyStatus: complete`、`truncated: false`、
tokenUsage 存在。**零适配成本**。

### 4.2 与主会话的格式差异（实测全量对比）

| 维度 | 父会话 | 子会话 |
| --- | --- | --- |
| 行类型分布 | `session_start` 1 / `message` 5 / `agent_turn_outcome` 1 | 完全相同 |
| `session_start` 独有键 | `sessionTitleAutoStage` | `callingSessionId`、`callingToolUseId` |
| loadSession 结果顶层 | — | 额外 `callingSessionId`、`callingToolUseId` |
| 无法解析行 | 0 | 0 |

差异仅是**附加元数据**，投影管线本就忽略未知键，无需改动。

## 5. 顺手验证：会话抽屉泄漏

- 实测 `listSessions`（生产抽屉数据源同款 API）返回值**包含子会话**
  （`drawerLeak.containsChild: true`），条目形状与普通会话相同
  （`id`/`title`/`createdTime`/`modifiedTime`/`messageCount`/…，
  **不含 tags**）。用户"抽屉里见过子会话"的报告属实。
- 子会话 `.settings.json` 的 `tags` 含 `subagent` 标签；SDK 公开
  `hasSubagentSessionTag(tags)`（实测返回 true）与
  `getSubagentCallingMetadata(tags)`（实测返回的 `callingSessionId`
  与父会话 id 相符、`callingToolUseId` 存在）。
- 因此过滤方案明确：列表投影时按会话 id 读取同目录 `.settings.json`
  的 tags 判 `subagent` 即可（`listSessions` 本身不带 tags，需要
  每会话一次有界的小文件读取；结果可按 sessionId 缓存——标签在
  会话创建时写定）。

抽屉过滤与本特性**必须同切片**：子代理行一旦可点击，就成为子会话的
唯一正规入口；抽屉里混入的子会话行为（点击即 resume 接管）与只读
边界矛盾。

## 6. 分档设计

### 6.0 共同的安全边界（两档一致）

- **`childSessionId` 不过桥**（维持现状不变量）：现有代码在 Runtime
  边界刻意丢弃它（`FactoryDroidRuntime.ts` 的
  `readSubagentStartedNotification`、`subagentSummary.ts` 的投影），
  Webview 校验器有显式"拒绝 `childSessionId` 泄漏"测试
  （`validateHostMessage.test.ts`）。设计沿用：**Webview 以父会话的
  `toolUseId` 为不透明句柄**发起请求（`ToolTranscriptItem` /
  `tool.activity` 已携带 `toolUseId`），Host 侧解析
  `toolUseId → childSessionId`（数据源：loadSession 信封的
  `subagentInvocations` 台账，Runtime 新增一个 Host-only 的解析
  入口，返回值不进任何 Bridge 消息）。
- **只读由构造保证**：回放数据全部来自历史文件投影，Host 不为子会话
  创建任何可写句柄（不 resume、不 attach 驱动连接）；回放视图无
  Composer、无权限/ask-user UI，不复用 `session.select`（该路径是
  `startReplacement({kind:'resume'})`，会接管驱动权）。
- 转录内容经与 `host.snapshot.transcript` 相同的投影 + sanitize +
  上限（`projectSessionHistory` 自带 MAX_* 边界）。

### 6.1 保底档：终态回放

交互：子代理摘要行（`Thread.tsx` 的 `SubagentSummaryRow`）在状态为
终态（`completed`/`failed`/`cancelled`）时变为可点击 → 只读转录
浮层（视觉沿用现有 quiet 语言与既有 sheet 先例，如 `SideChatSheet`
的呈现模式；新浮层视觉需按 AGENTS.md 规则先给用户过目）。

四层改动清单：

| 层 | 改动 |
| --- | --- |
| Bridge（`src/shared/bridgeMessages.ts` + 两侧校验器） | 新增 webview→host `subagent.openTranscript { sessionId /*父*/, toolUseId }`；新增 host→webview `subagent.transcript { toolUseId, status: 'available'\|'unavailable', items?: SessionTranscriptItem[], historyStatus?, truncated? }`。复用现有 `SessionTranscriptItem` 类型；校验器保持拒绝任何含 `childSessionId` 的载荷。 |
| Runtime | `subagentSummary.ts` 侧新增 Host-only 解析：从 loadSession 信封的 `subagentInvocations` 中按 `toolUseId` 取 `childSessionId`（不改既有过桥投影）。历史加载复用 `FactorySessionHistoryLoader.loadHistory({ cwd, sessionId: childId })`——它走本地 `ProcessTransport`，**与运行时模式（process/daemon）无关**，P3 已实测可投影子会话。 |
| Host（`ChatController.ts`） | 处理 `subagent.openTranscript`：校验父会话属于当前目录 → 解析 childId（解析失败 = unavailable）→ loadHistory → 回 `subagent.transcript`。同请求去重、单飞（同一 toolUseId 并发点击只触发一次加载）。抽屉过滤：`FactorySessionCatalog` 列表投影时剔除 `subagent` 标签会话（见 §5）。 |
| Webview | `SubagentSummaryRow` 终态时渲染为可点击（quiet 触发样式，遵守 UI 克制规则）；新增只读转录浮层组件，复用现有 transcript item 渲染器；`historyStatus`/`truncated` 沿用现有语义展示。 |

Fail-closed 语义：

- 子会话文件缺失 / 损坏 / 解析失败 / toolUseId 无法解析 → Host 统一
  回 `status: 'unavailable'`（`loadHistory` 已有 `unavailableSessionHistory()`
  路径），Webview 在浮层位置显示一行安静的"转录不可用"，不重试风暴、
  不降级成 resume。
- `status: 'running'` 的行在保底档不可点击（升级档解锁）。
- 校验器拒收的消息按既有惯例丢弃 + 诊断。

### 6.2 升级档：准直播（文件尾随）

选型：**文件尾随**。理由：观察者连接已被 P1 实测否决（无细粒度
子事件）；daemon RPC 轮询门槛更高（仅 daemon 模式可用、需 token、
中途可见性未证实）且粒度与尾随相同。尾随在 process 与 daemon 两种
运行时模式下同样工作。

在保底档之上叠加：

| 层 | 增量改动 |
| --- | --- |
| Runtime | `readSubagentStartedNotification` 停止丢弃 `childSessionId`，但仅存入 Runtime 内部的 `toolUseId → childSessionId` 映射（事件载荷过桥部分不变）。新增尾随器：按 §3.2 构造子会话 JSONL 路径，容忍文件未出现（有界等待），1–2s 节流轮询增量行，增量整行解析后重投影（或增量投影）出 `SessionTranscriptItem[]`。子会话 `agent_turn_outcome` 落盘或父回合结束即停表。 |
| Bridge | `subagent.transcript` 增加 `status: 'streaming'` 与后续更新帧（同 `toolUseId` 幂等覆盖或 append 语义，取实现简者）。 |
| Host | 浮层打开且行仍 running 时启动尾随；浮层关闭 / 会话切换 / 回合结束时停止并释放。任何读/解析错误 → 降级为终态回放路径重载一次，再失败则 unavailable。 |
| Webview | running 行也可点击；浮层顶部显示安静的"live"状态点；收到更新帧追加渲染。 |

已知体验边界（如实呈现，不造假能力）：粒度是**整条消息**（无打字机
delta——delta 不落盘）；子会话文件晚 ~4s 出现，浮层先显示等待态。

## 7. 第一切片建议

范围：**保底档全量 + 抽屉过滤**（§6.1，含全部 fail-closed 语义），
不含升级档。

完成判据：

1. 委派完成后，点击子代理摘要行 → 浮层内只读展示该子会话完整转录
   （真实委派实测，非 mock），无 Composer、无任何可写操作入口。
2. 人为改名/损坏子会话 `.jsonl` 后点击 → 浮层显示"转录不可用"，
   无异常、无重试风暴（诊断有记录）。
3. 会话抽屉不再出现 `subagent` 标签会话（真实委派后刷新验证），
   普通会话列表不受影响。
4. 全部 Bridge 消息经两侧校验器；带 `childSessionId` 的载荷仍被
   Webview 校验器拒绝（既有测试保持绿 + 新消息的拒绝测试）。
5. 单测（Runtime 解析、Host 单飞与 fail-closed、Webview 校验器与
   浮层状态）、类型检查、构建、打包、Cursor 内可见验证全绿；
   `implementation-status.md` 同步更新。

## 8. 复跑方法

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/probe-child-observer.mjs
# 结果落盘 artifacts/probe-child-observer.out.json（含 verdict 区）
```

注意：每次复跑消耗一次真实短回合 + 一次子会话，并按 §1 留下无害
残留。
