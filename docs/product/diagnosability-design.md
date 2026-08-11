# 可诊断性增强设计（Diagnosability Design）

> 状态：**已按“全保真”前提实现**（2026-08-11 深夜，同日实现）。
> 本文档主体保留为定稿时的设计原文；实现与设计的差异如下：
>
> 1. **取消分级脱敏（覆盖 §5 全部内容）**：用户在定稿后决定这是
>    本地个人工具，日志默认全保真——prompt/消息文本、工具输入输出、
>    命令、路径、会话/回合/工具 ID、原始错误与堆栈、CLI stderr 全部
>    明文入盘。没有 verbose 设置开关，没有分级。唯一保留的过滤是
>    凭据类模式匹配（Bearer/JWT/sk-/ghp_/xox?-/AKIA/`key[:=]value`
>    赋值等 → `[REDACTED]`），见 `LocalDiagnostics.scrubCredentials`。
>    原 `projectAttributes` 白名单投影与 `safeCode` 值域限制已移除
>    （仅保留 name 字符集、attributes 数量/长度等结构约束）。
> 2. **存储位置改为 globalStorage（替代 §6.1 的轮换设计）**：日志
>    不再写 `context.logUri`（会被 Cursor 按启动清理），改写
>    `context.globalStorageUri/logs/`，按 UTC 日分文件
>    `droidvisx-YYYYMMDD.jsonl`，总量上限 200 MB，超限删除最旧整天
>    文件（当天文件永不删除）。每条记录带 `workspace`（工作区路径）
>    与 `act`（激活实例 id）。Output Channel 镜像保留。
> 3. **回合关联简化（§3.1/§3.2）**：因为不再脱敏，`turnId` 直接明文
>    入盘为顶层 `turn` 字段（sink 作用域方案：`beginTurnScope` /
>    `endTurnScope`，Host 在 turn 接受时开启、终态时关闭，期间的
>    Runtime/SDK/webview 信标记录自动盖章）。不再需要哈希短标识。
> 4. 其余按设计落地：host 业务失败镜像入盘（`host.ui.diagnostic`）、
>    `host.turn.accepted/state` 与 `host.interaction.opened/closed`
>    骨架事件、`host.bridge.rejected` 入站拒绝、tool.started 按
>    toolUseId 降噪（新增 `toolUniqueCount`）、性能埋点 P1–P9、
>    `DroidVisX: Export Diagnostics Bundle` 导出命令。
>    事件词典与 schema 的当前真相见
>    [`log-analysis-playbook.md`](./log-analysis-playbook.md)。
>
> 撰写方式：只读审计当前工作区源码（`src/extension/LocalDiagnostics.ts`、
> `src/runtime/runtimeDiagnostics.ts`、`src/runtime/FactoryDroidRuntime.ts`、
> `src/extension/webviewHtml.ts`、`src/extension/DroidViewProvider.ts`、
> `src/extension/ChatController.ts`、`src/shared/bridgeMessages.ts`）与本机
> 真实日志（`C:\Users\ASUS\AppData\Roaming\Cursor\logs\20260811T133756\
> window7\exthost\droidvisx.droidvisx\droidvisx.jsonl` 等 5 个文件，共约
> 1500 条记录）。本文档不修改任何既有契约；实现时按第 7 节切片另行开工。
>
> 目标（用户验收标准）：**“我本地使用一段时间之后，能让 AI 读日志，
> 发现新问题并修复隐藏 bug。”** 今晚已用 webview 启动信标定位一次白屏
> 崩溃（`Duplicate key toolCallId-… in useResources`），证明方向可行；
> 本设计把这条路径推广到性能退化、消息丢失、状态机卡死和 SDK 异常。
>
> 配套文档：[`log-analysis-playbook.md`](./log-analysis-playbook.md)
> 是写给“读日志的 AI”的操作手册（文件位置、schema、事件词典、
> 故障特征、分析模板）。本文档是写给“改代码的 AI/人”的增强方案。

---

## 1. 现状审计：谁在往哪里记什么

### 1.1 四条真实入盘路径（写进 JSONL 的）

所有落盘记录都经 `LocalDiagnostics.enqueue()` 汇聚到单一
`droidvisx.jsonl`（VS Code 扩展日志目录，512 KiB 轮换 ×2 备份，
文件 mode 0600），同时镜像到 `DroidVisX Logs` Output Channel。

| # | 来源 | source 字段 | 内容 | 代码位置 |
| --- | --- | --- | --- | --- |
| 1 | Runtime 显式埋点 | `host` | 初始化 / Turn / Context / Rewind / Compact / Fork / Rename / Commands 的 started/finished（含 `durationMs`、`outcome`、事件计数），Tool start/finish，stream error | `FactoryDroidRuntime.ts` 共 26 处 `recordDiagnostic` |
| 2 | SDK Observability Bundle | `sdk` | SDK logger 事件（映射为 `sdk.*` 安全名）+ metrics（`sdk.metric`，实测只有 `cli_jsonrpc_child_spawn_latency`） | `LocalDiagnostics.observability`，注入 `ProcessTransport` 与 create/resume |
| 3 | Extension 生命周期 | `host` | 仅 2 个：`extension.activated`、`diagnostics.opened` | `extension.ts` |
| 4 | Webview 启动信标 | `host` | `webview.boot-ok` / `render-ok` / `boot-timeout` / `error` / `unhandledrejection`，携带有界自由文本 `detail`（≤2048） | `webviewHtml.ts` 信标脚本 + `vscode.ts` 的 announce + `AppErrorBoundary` → `DroidViewProvider` 入日志 |

### 1.2 一条重要的“不入盘”路径

`ChatController.emitSessionDiagnostic()`（约 40 个调用点、约 20 个静态
code：`edit-resend-blocked/-failed/-unsupported`、`session-compact-*`、
`session-fork-*`、`session-rename-*`、`session-selection-invalid`、
`session-operation-blocked`、`session-close-failed`、
`session-resume-failed`、`attachment-limit/-rejected/-read-failed/-empty`、
`settings-update-blocked/-unsupported`、`file-diff-failed`、
`workspace-changed`、`session-compacted`、`session-forked`、
`assistant-output-truncated`、`runtime-event-error`）**只发
`runtime.diagnostic` Bridge 消息进 Webview 转录**，不写 JSONL。

后果：Host 层的全部业务拒绝/失败（比如 rewind 被拒、附件读取失败、
Session 恢复失败）对读日志的 AI 完全不可见；如果 Webview 本身挂了，
这些信号连用户都看不到。**这些 code 全部是静态安全字符串，镜像入盘
没有任何脱敏成本**——这是本设计性价比最高的单项改动（见 §3.4）。

### 1.3 脱敏策略现状（`LocalDiagnostics.ts`）

- `name`：必须匹配 `^[a-zA-Z0-9_.:-]+$` 且 ≤96 字符，否则替换为
  `host.event` / `sdk.event` 兜底名。
- `attributes`：≤16 个；key ≤48 字符且**丢弃**以
  `id|path|cwd|args|command|prompt|content|output|error|stack|cause|token|secret|credential|apikey`
  结尾的 key；字符串值必须是 code-like（同 name 规则）否则替换为字面量
  `"redacted"`，≤96 字符；非有限数字归零。
- `detail`：唯一的自由文本通道，仅显式失败路径可用（当前只有 webview
  信标），剥离控制字符后截断到 2048 字符，仅本地落盘。
- SDK logger 消息按白名单映射安全名（`projectSdkLogName`），未匹配的
  用 `safeCode(event.name)` 兜底（实测出现 `droid.sdk.info`）；未知 SDK
  消息不入日志。

### 1.4 真实日志样本的结构性缺陷（审计发现）

对 5 个真实 JSONL（约 1500 条）核对后发现：

1. **`sequence` 每次激活归零**，且同一 window 文件里串着多次激活
   （Reload Window 不换文件）。单看一行无法知道它属于哪次进程生命周期。
2. **没有任何回合关联字段**。Bridge 消息全程携带 `turnId` + `sequence`
   （`bridgeMessages.ts`），但日志记录一个都没带——跨层时间线只能靠
   时间戳猜。两个并发窗口、或恢复+新 Turn 交错时无法归因。
3. **`runtime.tool.started` 严重虚高**：全部日志中 `tool.started` 946 条
   vs `tool.finished` 23 条。原因是 `normalizeSdkEvent` 对 `tool_call`
   **和每个 `tool_call_delta`** 都产出 `tool-start`（见
   `activity-shimmer-fix-design.md` §1），每个 delta 都触发一次
   `recordDiagnostic`。这既刷掉了信噪比，又占轮换预算。
4. **`sdk.request.sent` 有去无回**：只有发送记录，无完成/耗时/失败
   对应记录（SDK 侧未提供），不能用于测量 RPC 延迟。
5. **日志按 window 目录分散**（同一晚 5 个文件），找“当前那份”
   要人工按修改时间排序。

### 1.5 故障类型覆盖矩阵（对照今晚案例）

| 故障类型 | 现状能否定位 | 依据 / 缺口 |
| --- | --- | --- |
| Webview 渲染崩溃（今晚白屏） | ✅ 能 | `boot-ok` → `render-ok` → 紧跟 `webview.error`（detail 带真实异常文本），已实战定位 `Duplicate key toolCallId-…` |
| 陈旧缓存 Bundle | ✅ 能 | `boot-ok` detail 携带构建号，可与最新打包比对 |
| Webview 启动挂起 | ✅ 能 | 10s 看门狗 `boot-timeout` + 面板兜底文本 |
| 资源加载失败 | ✅ 能 | 信标捕获 `resource failed: TAG url` |
| CLI 进程启动失败/崩溃 | 🟡 部分 | `sdk.process.spawning/stderr/non_json_output`、spawn latency metric 能证明“发生了”；stderr 文本被脱敏成 `redacted`，看不到“为什么” |
| 性能退化 | ❌ 基本不能 | 仅有 `turn/context/initialize` 的 `durationMs` 与 spawn latency。无首屏耗时、无长任务、无消息合批延迟、无快照大小、无历史加载耗时。“页面一点击就卡死”这类问题（2026-08-11 已发生过一次）在日志中零痕迹 |
| 消息丢失（Host↔Webview） | ❌ 不能 | Bridge `sequence` 从不入日志；两侧校验失败都**静默丢弃**（`parseWebviewMessage` / `validateHostMessage` 返回 undefined 无记录）；无收发对账 |
| 状态机卡死 | 🟡 弱推断 | `turn.started` 无对应 `turn.finished`、`sdk.permission.started` 无 `finished` 可人工推断挂起；但无 Host 侧 turn 状态转换记录、无待处理交互超时事件、无心跳，AI 无法区分“卡死”与“日志截断” |
| SDK 异常行为 | 🟡 部分 | `runtime.stream.error` 无任何原因分类（零属性）；`turn.finished` 的 `outcome`（`error_*`/`stream-ended`）是唯一分类信号；未知 SDK 消息按设计静默 |
| Host 业务失败（rewind/附件/恢复等） | ❌ 不能 | 全部走 §1.2 的不入盘路径 |
| 恢复/reconcile 缺陷（今晚崩溃的根因侧） | ❌ 不能 | 恢复合并（recovered+loaded→reconciled 条数、重叠匹配成败）无任何日志；今晚是靠崩溃信标反推的 |

---

## 2. 关联链：回合级 correlation id 贯穿三层

### 2.1 评估：直接复用 Bridge 的 `turnId`

`turnId` 由 Webview `createTurnId()`（`crypto.randomUUID`）生成，随
`turn.send` 进 Host，之后出现在所有回合相关 Bridge 消息上
（`assistant.delta`、`tool.activity`、`turn.state`、`turn.error`、
`interaction.request` 等）。**结论：复用，但不能原样入盘**——
脱敏策略明确丢弃 `*id` 结尾的 attribute key，且完整 UUID 属于
“可关联标识符”，与现有隐私边界冲突（Session/Request/Tool ID 均不落盘）。

方案：入盘前把 `turnId` 单向哈希截短为 8 位十六进制
（`sha256(turnId).slice(0,8)`，下称 **turn 短哈希**）。它不可逆、
不可用于关联到 Droid 侧任何资源，但足以在一份日志内把一次交互的
记录串成时间线，并与用户复述的“第 N 次提问”对上。

### 2.2 记录格式扩展（顶层白名单字段，不走 attributes）

`PersistedDiagnosticRecord` 新增两个可选顶层字段，避开 attribute
key 过滤器，也让 schema 明确这是受控的关联字段而非自由属性：

```jsonc
{
  "timestamp": "…", "sequence": 12, "source": "host",
  "level": "info", "name": "runtime.turn.finished",
  "act": "a1b2c3",        // 新增：激活实例 id（6 hex，构造时随机）
  "turn": "9f3e2a1c",     // 新增：turn 短哈希（回合作用域内的记录才有）
  "attributes": { … }
}
```

- `act` 解决 §1.4-1 的“sequence 归零无法分段”问题：每个
  `LocalDiagnostics` 实例构造时生成一次，所有记录携带。
- `turn` 由 sink 侧的**回合作用域**盖章（见下），单条 record 调用方
  不需要自己传。

### 2.3 盖章机制：sink 包装器而不是改 26 个调用点

在 `RuntimeDiagnosticSink` 上加一对方法（或包一层
`ScopedDiagnostics`）：

```ts
interface RuntimeDiagnosticSink {
  record(event: RuntimeDiagnosticEvent): void;
  beginTurnScope?(turnHash: string): void;  // ChatController 在接受 turn.send 时调用
  endTurnScope?(): void;                    // turn 终态（completed/failed/stopped）后调用
}
```

- `ChatController` 是唯一知道 Bridge `turnId` 又持有 sink 的层：在
  `turn.send` / `turn.editResend` 被接受时 `beginTurnScope(hash)`，
  在广播终态 `turn.state` 后 `endTurnScope()`。
- 作用域内 Runtime 的全部 `recordDiagnostic`（turn/tool/stream/context）
  与 SDK observability 记录自动带上 `turn`。DroidVisX 同时只允许一个
  活跃 Turn（现有不变式），单变量作用域即可，无需并发映射。
- Webview 信标带 turn：`webview.diagnostic` 消息扩展可选
  `turn?: string`（8 hex，双向校验），Webview 在回合运行期把当前
  `turnId` 哈希后附上；`DroidViewProvider` 原样落入顶层 `turn` 字段。
  这样“流式渲染中崩溃”能直接归因到回合。

### 2.4 补齐 Host 侧回合状态转换（关联链的骨架事件）

现状 Host 对回合零记录。新增（默认级别即记，均为静态安全值）：

| 事件 | 级别 | attributes |
| --- | --- | --- |
| `host.turn.accepted` | info | `kind`: send / editResend / regenerate |
| `host.turn.state` | debug | `status`: running / completed / failed / stopped（与 Bridge `turn.state` 同步） |
| `host.interaction.opened` | info | `kind`: permission / askUser / exitSpec |
| `host.interaction.closed` | info | `outcome`: responded / cancelled / expired，`pendingMs` |
| `host.bridge.rejected` | warn | `direction`: inbound / outbound（校验失败不再全静默，只记方向与消息 type 前缀，不记内容） |

有了 `act` + `turn` + 上表骨架事件，AI 能对任意一次交互输出完整
时间线：accepted → runtime.turn.started → tool 序列 →
interaction opened/closed → turn.finished → host.turn.state →
（webview render/error）。这正是今晚白屏排查中缺失的那条主轴。

---

## 3. 性能埋点

### 3.1 设计约束

- 全部 attributes 只用**数字与静态枚举**，不进自由文本，默认级别可开。
- **聚合优先于逐条**：所有高频信号（delta、longtask、合批）只在
  回合结束或固定时间窗聚合上报，禁止 per-delta 记录（§1.4-3 的教训）。
- 每个事件写明触发上限；预算核算见 §5.1。

### 3.2 埋点清单

| # | 事件名 | 层 | attributes（全数字/枚举） | 触发与上限 |
| --- | --- | --- | --- | --- |
| P1 | `webview.perf.boot` | Webview→信标 | `bootMs`（timeOrigin→bundle mount）、`renderMs`（→首个非空转录提交）、`items` | 每次 webview 生命周期 1 条（把现有 `render-ok` detail "items N" 升级为结构化，`boot-ok`/`render-ok` 保留不动以兼容既有分析） |
| P2 | `webview.perf.longtask` | Webview→信标 | `count`、`maxMs`、`totalMs`、`windowMs` | `PerformanceObserver('longtask')` 聚合；仅 count>0 才上报；每 30s 窗口 ≤1 条，每生命周期 ≤40 条 |
| P3 | `webview.perf.batch` | Webview→信标 | `flushes`、`maxBatchSize`、`maxFlushMs`、`droppedFrames` | rAF 合批器（已存在于桥接层）在回合终态后 1 条 |
| P4 | `host.perf.snapshot` | Host | `bytes`（序列化长度）、`items`、`reason`: resolve / session-switch / recovery | 每次发 `host.snapshot` 时测量；仅 `bytes > 65536` 或 session 切换时上报 |
| P5 | `host.perf.turn-io` | Host | `messagesOut`、`bytesOut`、`deltas`、`toolActivities` | 回合终态后 1 条（Host 端对本回合出站 Bridge 消息的对账计数——与 Runtime `projectedEventCount` 相减即可发现 Host 层丢事件，覆盖“消息丢失”故障型） |
| P6 | `runtime.history.finished` | Runtime | `durationMs`、`messages`、`items`、`outcome`: complete / partial / truncated / failed | 每次历史加载 1 条（现状零记录；“恢复对话慢”正是已发生过的用户反馈） |
| P7 | `host.perf.recovery` | Host | `readMs` / `writeMs`、`items`、`recovered`、`loaded`、`reconciled`、`dropped` | 恢复读取与 reconcile 各 1 条——今晚崩溃根因（reconcile 重叠失败、重复 toolUseId）当时若有此对账早就现形 |
| P8 | `runtime.tool.started` 降噪 | Runtime | （修复）仅首个 `tool-start` 记录，delta 不再记；`turn.finished` 加 `toolUniqueCount` | 同时把 §1.4-3 的 946:23 修成 ≈1:1 |
| P9 | SDK 调用耗时 | Runtime | 已有：`initialize/context/rewind/compact/fork/rename/commands` 的 `durationMs`；spawn latency metric | 保持；`sdk.request.sent` 的 RPC 级耗时无公开钩子，**不伪造**，留给 SDK |

“今晚这类白屏 + 上周这类卡死”所需的最小集是 **P1 + P2 + P6 + P7**；
P3/P4/P5 是消息丢失与合批退化的对账层，建议同切片做完。

---

## 4. 分级脱敏：verbose 开关

### 4.1 原则

默认级别**一字不改**（现有隐私边界继续成立：无 prompt、无路径、无
命令、无原始错误、无 ID）。verbose 是用户显式知情开启的本地调试级，
所有新增内容仍然有界、仍然仅本地落盘、仍然过控制字符剥离。

### 4.2 开关方式

`package.json` 当前没有任何 `configuration` 贡献点，新增：

```jsonc
"configuration": {
  "title": "DroidVisX",
  "properties": {
    "droidvisx.diagnostics.verbose": {
      "type": "boolean",
      "default": false,
      "markdownDescription": "记录更详细的本地诊断（有界错误原文、消息长度分布、状态机转换）。这些内容可能包含错误消息中的文件路径或代码片段。日志仅保存在本机扩展日志目录，DroidVisX 不上传任何数据；导出诊断包前请自行审查。"
    }
  }
}
```

- `LocalDiagnostics` 构造时读取 + `onDidChangeConfiguration` 热更新。
- 模式切换时写入 `diagnostics.verbose-enabled` / `-disabled` 标记记录，
  让读日志的 AI 知道每段日志的可信详略级别。

### 4.3 verbose 级新增内容（全部有界）

| 内容 | 载体 | 上限 |
| --- | --- | --- |
| 失败路径错误原文 | `RuntimeDiagnosticEvent` 新增 `verboseDetail?: string`，默认级别被 sink 丢弃，verbose 时经 `sanitizeDetail` 落入 `detail` | ≤512 字符（比信标的 2048 更紧，因为量大） |
| Host 业务失败镜像的 message 文本 | 同上（§3.4 的镜像默认只有 code，verbose 附 message） | ≤256 |
| 消息长度分布 | `turn.finished` 附加 `textP50/textP95/textMax`、`deltaCount` 等桶化数字 | 数字，无文本 |
| 状态机转换 | §2.4 的 `host.turn.state` 从 debug 提升记录密度：附 `fromStatus`，交互事件附 `requestHash`（8 hex 单向哈希，同 §2.1 规则） | 枚举 + 8 hex |
| Bridge 校验失败样本 | `host.bridge.rejected` 附被拒消息的 `type` 字段原文 | ≤48 code-like |

### 4.4 默认级即应补上的（不属于 verbose）

Host 业务失败 **code 镜像入盘**（§1.2）：code 是静态安全字符串，
与现有隐私级完全一致，作为 `host.ui.diagnostic`（attributes:
`{ code }`）默认记录。不要把这个改进绑在 verbose 开关后面。

---

## 5. 容量与导出

### 5.1 轮换尺寸

实测数据：今晚最重的 window7 文件 142 KB ≈ 1000 条记录 ≈ 2.5 小时
重度使用（含一次崩溃排查的反复 reload）。当前 512 KiB ×(1+2) ≈
1.5 MiB 总预算，在现有埋点密度下约够 2–3 天。

叠加本设计：P8 降噪把最大噪声源（tool.started delta 洪水，占今晚
记录数的 60%+）砍掉，但 §2.4 骨架、§3 性能聚合、verbose 详情会净增
约 2–4×。建议：

- `maxFileBytes`: 512 KiB → **2 MiB**；`backupCount`: 2 → **4**。
  总预算 ≈10 MiB，磁盘成本可忽略，重度使用可保留约一周——足够
  “用一段时间后让 AI 复盘”的窗口。
- 不做成用户可配置项（YAGNI）；数值以常量固化，导出功能（§5.2）
  才是长期留存的正解。

### 5.2 “导出诊断包”命令设计

新命令 `droidvisx.exportDiagnostics`（`DroidVisX: Export Diagnostics
Bundle`）：

1. `flush()` 当前写队列。
2. 收集：`droidvisx.jsonl` + `.1` + `.2…`（当前 window 的
   `context.logUri` 目录）。
3. 生成 `metadata.json`：扩展版本、Webview 构建号
   （`WEBVIEW_BUILD_ID`）、VS Code/Cursor 版本（`vscode.version`）、
   OS/arch、`droidvisx.*` 设置快照（含 verbose 开关状态）、导出时间。
   **不含**工作区路径（可选：路径的 8 hex 哈希用于区分多项目）。
4. 附一份 `PLAYBOOK.md`（即 `log-analysis-playbook.md` 的拷贝），
   使诊断包自带 AI 分析说明书——收包的 AI 无需访问仓库即可开工。
5. zip 后经 `showSaveDialog` 存到用户选择的位置，完成后
   `revealFileInOS`。
6. 已知边界（文档写明）：只导出当前窗口的日志；其他 window 目录的
   历史日志需用户按 playbook §1 的路径规则自行补充。

---

## 6. 与今晚案例的对照验证（设计自检)

今晚白屏排查若在本设计落地后重演：

1. `webview.error` 已带 `turn`/`act` → 立即知道崩溃发生在恢复渲染
   而非某次交互回合（turn 字段为空 + render-ok 紧邻）。
2. `host.perf.recovery`（P7）显示 `recovered:72, loaded:78,
   reconciled:150, dropped:0` → 重叠匹配完全失败一眼可见，
   不需要事后写探测脚本反推。
3. `webview.perf.boot`（P1）的 renderMs 异常与 items 膨胀提供旁证。
4. 遗留问题（对话内容重复展示）在 reconcile 对账数字里持续可见，
   不会静默。

“页面一点击就卡死”类问题重演时：P2 longtask 聚合 + P3 合批统计 +
P6 历史加载耗时可直接给出“哪一层慢、慢多少”的量化答案。

---

## 7. 实现切片建议（依赖序）

1. **切片 A（对账与降噪，纯 Host/Runtime）**：P8 降噪、`act` 字段、
   Host 业务失败 code 镜像（§4.4）、`host.turn.accepted/state`。
   无 Bridge 变更，风险最低，立刻改善信噪比。
2. **切片 B（关联链）**：turn 短哈希 + sink 作用域 + 信标 `turn`
   字段（唯一的 Bridge 契约变更：`webview.diagnostic` 加可选字段，
   双向校验）。
3. **切片 C（性能埋点）**：P1–P7，Webview 侧 PerformanceObserver
   与合批统计走既有信标通道。
4. **切片 D（verbose + 导出）**：configuration 贡献点、
   `verboseDetail` 通道、导出命令。
5. 每个切片同步更新 `implementation-status.md` 与
   `log-analysis-playbook.md` 的事件词典。

---

## 附录 A：交接文档完整度盘点（2026-08-11 深夜）

> 按任务约定，本盘点只写在这里，不修改任何现有文档。

### A.1 docs/ 现有文档清单与状态

| 文档 | 状态 | 说明 |
| --- | --- | --- |
| `product/implementation-status.md` | ✅ 权威、当日更新 | 事实台账 + 维护规则。**风险**：已 63 KB 且按“同日追加”流水式增长，正在从“状态台账”退化为“变更日志”，新 AI 抓重点困难（见 A.2-4） |
| `product/delivery-plan.md` | ✅ 现行（2026-08-10） | 模块顺序、交付原则、完成标准 |
| `product/tier1-polish-plan.md` | 📐 设计未实现（用户明确暂缓） | 状态标注清晰 |
| `product/session-management-design.md` | 📐 设计未实现（当日调研） | SDK 证据充分，标注清晰 |
| `product/spec-mission-design.md` | 📐 设计未实现（当日调研） | 同上 |
| `product/slash-commands-design.md` | ⚠️ 部分过时 | 写明“阶段一只设计”，但阶段二**当晚已实现并打包**（见 implementation-status）；文档未回标完成状态，新 AI 会误判为待实现 |
| `product/rich-content-design.md` | 📐 设计未实现 | 标注清晰 |
| `product/activity-shimmer-fix-design.md` | 📐 设计未实现 | 引用具体行号，源码一动就漂移，实现前需重新核行号 |
| `product/diagnosability-design.md`（本文档） | 📐 设计未实现 | — |
| `product/log-analysis-playbook.md` | ✅ 即时可用 | 按当前已落盘格式撰写；实现本设计各切片后需同步扩词典 |
| `engineering/droid-capability-matrix.md` | ✅ 探测证据 | 与“仅探测/声明 ≠ 产品功能”规则配套 |
| `preflight/00–07`（8 份） | 🗄️ 历史存档 | 为已结束的“两小时实现窗口”准备，结论多已被 implementation-status 吸收或推翻（如 Context Meter 结论已进主台账）；无过时标注，新 AI 可能误当现行规范 |

### A.2 交接给新 AI 时缺什么

1. **缺一份架构 onboarding 文档**（最大缺口）。现在“各层职责 +
   关键流程”散落在 AGENTS.md（约 10 行）、implementation-status 的
   “主要实现”小节和各设计文档里。建议新增
   `docs/engineering/architecture-overview.md`：
   - 四层职责与目录地图（Runtime / Host / Bridge / Webview 各自
     可以 import 什么、禁止 import 什么）；
   - 三条关键时序图：发送一个 Turn、恢复一个 Session、
     一次权限交互（文本时序即可，不必画图）；
   - Bridge 契约的**不变式清单**（双向严格校验、sequence/turnId
     语义、fail-closed 原则），正文指向 `bridgeMessages.ts` 为唯一
     真源，不复制字段表（避免漂移）;
   - 常用命令：typecheck / test / build / package / install 与
     验收流程（Reload Window vs 完整重启的缓存差异——今晚刚踩过）。
2. **AGENTS.md 缺多代理并行约定**。今晚已实际出现“一个代理改源码 +
   一个代理只读审计”并行，但 AGENTS.md 只写了“不要主动委派
   subagent”，没有并行协作规则。建议补充：
   - 并行代理的写权限划分（谁独占 `src/`；只读代理只允许新增
     `docs/` 文件）；
   - `implementation-status.md` 单写者原则（只有改代码的代理在同一
     变更中更新它，避免双写冲突）；
   - build / package / install 全局互斥（同一时刻至多一个代理跑）；
   - 新设计文档命名与"状态头"约定（每份文档第一行标注
     设计/已实现/已过时，A.1 中 slash-commands 的漂移就源于没有
     回标机制）。
3. **缺日志/诊断的使用者文档**——本次已由
   `log-analysis-playbook.md` 补上；后续切片实现时按 §7-5 同步。
4. **implementation-status.md 需要一次结构化收编**：把“同日追加 ×N”
   的流水段落折叠进各功能小节，历史细节移到 git 历史；保持
   “当前结论 + 状态表”在 2 屏内可读。这属于内容重组，应由持写
   权限的代理择期执行。
5. **preflight/ 目录建议加过时标注**（每份文件头加一行“已存档，
   结论以 implementation-status 为准”），或整体移入
   `docs/archive/`。同样留给持写权限的代理。
