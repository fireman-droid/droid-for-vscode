# DroidVisX 日志分析手册（写给读日志的 AI）

> 读者：被要求“读 DroidVisX 本地日志、发现并定位问题”的 AI 助手。
> 撰写日期：2026-08-11；同日随全保真日志改造更新。本手册描述
> **当前已落盘**的日志格式与事件。
>
> 核心原则：这份日志是**全保真**的（用户明确决定，本地个人工具）——
> prompt/消息文本、工具输入输出、命令、路径、会话/回合/工具 ID、
> 原始错误与堆栈、CLI stderr 都直接可读。唯一的过滤是凭据类模式
> 匹配（Bearer/JWT/`sk-`/`ghp_`/`xox?-`/`AKIA`/`key[:=]value` 赋值
> → 字面量 `[REDACTED]`）。看到 `[REDACTED]` 表示原文含凭据形状的
> 值，不是字段缺失。SDK 内部自行 redact 的内容我们无法控制，遇到
> SDK 侧占位符时如实报告即可。

---

## 1. 日志在哪里

固定在 Cursor 的 globalStorage 下（**不再**在 `logs\<boot>\window<N>`
里；那是 2026-08-11 之前的旧位置，会被 Cursor 清理）。Windows 完整
路径模式：

```text
C:\Users\<user>\AppData\Roaming\Cursor\User\globalStorage\droidvisx.droidvisx\logs\droidvisx-YYYYMMDD.jsonl
```

- **按 UTC 日期分文件**，所有 Cursor 窗口汇聚写同一份当日文件。
- 总量上限 200 MB，超限自动删除最旧整天的文件（当天文件永不删除）。
- 列出全部日志文件：

```powershell
Get-ChildItem "$env:APPDATA\Cursor\User\globalStorage\droidvisx.droidvisx\logs" |
  Sort-Object Name -Descending | Select-Object Name, Length, LastWriteTime
```

- 实时镜像也输出到 VS Code Output Channel `DroidVisX Logs`
  （命令 `DroidVisX: Open Logs`），格式为
  `[时间戳] [级别] source:name turn=<id> {attributes} | detail`。
- 命令 `DroidVisX: Export Diagnostics Bundle` 可把全部日志 +
  `metadata.json`（扩展/SDK/VS Code 版本、OS、工作区）+ 本手册
  打成一个 zip，交给分析方。

## 2. 记录 schema

每行一个 JSON 对象（JSONL）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `timestamp` | ISO 8601 UTC | 落盘时间 |
| `sequence` | number | **每次扩展激活从 0 重新计数**；配合 `act` 分段 |
| `act` | string（6 hex） | **激活实例 id**，每次扩展激活随机生成；多窗口/多次 Reload 写同一文件时用它区分生命周期段 |
| `source` | `"host"` \| `"sdk"` | `host` = Runtime/Extension/Webview 信标埋点；`sdk` = Droid SDK observability 转投 |
| `level` | `debug` \| `info` \| `warn` \| `error` | — |
| `name` | string | 事件名，词典见 §4；只含 `[a-zA-Z0-9_.:-]` |
| `workspace` | string，可缺省 | 该窗口当时的工作区根路径 |
| `turn` | string，可缺省 | **回合关联 id**（Bridge turnId 明文）。Host 在接受回合时开启作用域、终态时关闭；期间 Runtime/SDK/webview 信标记录自动带此字段，可据此串出一次交互的完整时间线 |
| `attributes` | object，可缺省 | ≤32 键；值全保真（字符串 ≤8192，凭据扫除后） |
| `detail` | string，可缺省 | 自由文本（≤16384，凭据扫除后）：prompt 全文、工具命令、原始错误与堆栈、SDK 原始日志消息等 |

## 3. 读日志前必知的陷阱

1. **生命周期分段看 `act`，不要只看 `sequence` 归零**。同一天文件
   里混着多个窗口和多次 Reload 的记录（交错写入），按 `act` 分组后
   再在组内按 `sequence` 排序。
2. **`runtime.tool.started` 已按 `toolUseId` 去重**（2026-08-11 起）：
   每个真实工具调用只记一条 start（带 `tool`/`toolUseId`/`action`，
   execute/task 类还带 `detail` 命令文本）。`runtime.turn.finished`
   里 `toolStartCount` 仍是含 delta 分片的原始计数，**真实工具数看
   `toolUniqueCount`**，完成数看 `toolResultCount`。
3. **`sdk.request.sent` 有去无回**：只记发送，没有对应完成事件，
   不能用于测量 RPC 耗时，也不能据缺失断言请求失败。
4. **Host 业务失败现在入盘了**（`host.ui.diagnostic`，见 §4.2）。
   如果这类记录也没有，才可以说 Host 层安静。
5. **未知 SDK 消息按设计静默丢弃**。缺信息本身不是 bug 证据。
6. 旧日志（2026-08-11 前的 `droidvisx.jsonl`，在
   `logs\<boot>\window<N>\exthost\...` 下）是隐私安全级格式：无
   detail、字符串值可能是字面量 `"redacted"`、`tool.started` 虚高。
   分析旧文件时按旧口径读。

## 4. 事件名词典（当前全集）

### 4.1 `source: "host"` — Runtime 埋点（`FactoryDroidRuntime.ts`）

| name | 级别 | 载荷 | 含义 |
| --- | --- | --- | --- |
| `runtime.initialize.started` | info | `targetKind`: create / resume | Runtime 初始化开始 |
| `runtime.initialize.finished` | info / error | `durationMs`, `outcome`（`available` = 成功） | 初始化结束 |
| `runtime.turn.started` | info | `textLength`, `attachmentCount`; `detail` = **prompt 全文** | 一个回合开始 |
| `runtime.turn.finished` | info / warn / error | `durationMs`, `outcome`, `projectedEventCount`, `toolStartCount`（含 delta 虚计）, `toolUniqueCount`（真实工具数）, `toolProgressCount`, `toolResultCount`; 失败时 `detail` = 原始错误与堆栈 | 回合结束。`outcome`: `success` / `stopped` / `failed` / `error_*` / `stream-ended`(**warn**，流意外走完) |
| `runtime.tool.started` | debug | `tool`, `toolUseId`, `action`, 可选 `filePath`; 可选 `detail` = 命令/计划文本 | 每个 toolUseId 只记一条 |
| `runtime.tool.finished` | debug / warn | `tool`, `toolUseId`, `isError` | 工具完成；warn = 工具报错 |
| `runtime.stream.error` | error | `detail` = SDK 原始 error 事件 JSON | SDK 流内 error 事件 |
| `runtime.context.started/.finished` | debug; info / error | finished: `durationMs`, `outcome`, `accuracy`/`reason` 等 | Context 统计读取 |
| `runtime.rewind.started/.finished` | info / error | finished: `durationMs`（+失败分类） | 编辑重问 / Regenerate 的 Rewind |
| `runtime.compact.started/.finished` | info / error | 同上 | Session Compact |
| `runtime.fork.started/.finished` | info / error | 同上 | Session Fork |
| `runtime.rename.finished` | info / error | `durationMs` | Session Rename |
| `runtime.commands.finished` | info / error | `durationMs` | `/` 命令目录拉取 |
| `runtime.history.finished` | info / error | `durationMs`, `outcome`(available/unavailable/failed), `sessionId`, `items`, `historyStatus`; 失败带 `detail` 堆栈 | 历史加载耗时（P6，`ChatController.loadHistoryTimed`：激活恢复 / compact / fork 三处） |

### 4.2 `source: "host"` — Host 业务与骨架事件（`ChatController.ts`）

| name | 级别 | 载荷 | 含义 |
| --- | --- | --- | --- |
| `host.turn.accepted` | info | `kind`: send / edit-resend; `textLength`, `sessionId`; `detail` = prompt 全文 | Host 接受回合；同时开启 `turn` 作用域 |
| `host.turn.state` | debug | `status` | 每次 turn.state 推送（submitting → streaming → 终态）；终态（completed/interrupted/failed）关闭 `turn` 作用域 |
| `host.ui.diagnostic` | warn | `code`（静态标识，如 `edit-resend-blocked` / `session-resume-failed` / `attachment-read-failed`）; `detail` = 用户可见消息 | **全部 emitSessionDiagnostic 业务失败/提示的入盘镜像**（约 40 个调用点） |
| `host.interaction.opened` | info | `kind`: permission / ask-user; `requestId` | 权限/提问卡片弹出 |
| `host.interaction.closed` | info | `requestId`, `pendingMs` | 卡片关闭；`pendingMs` = 用户思考时长（分析回合耗时先扣它） |
| `host.bridge.rejected` | warn | `direction: inbound`; `detail` = 原始消息 JSON（≤2048） | Webview→Host 消息未过校验被丢弃（旧版完全静默） |
| `host.perf.early-snapshot` | info | `sessionId`, `items` | 激活时本地恢复检查点的早期快照已推送（连接仍为 connecting）；它应先于 `runtime.initialize.finished` 出现，是"重开窗口秒出内容"的证据 |
| `host.perf.snapshot` | debug | `bytes`, `items` | 每次 host.snapshot 的序列化大小（P4） |
| `host.perf.turn-io` | debug | `bytesOut`, `messagesOut`, `n_<type>` 每消息类型计数 | 回合终态时的出站消息总账（P5） |
| `host.perf.recovery` | info | `sessionId`, `recovered`, `loaded`, `reconciled`, `reconcileMs` | 恢复对账（P7）。`reconciled ≈ recovered + loaded` 是重复转录/重复 toolUseId 类 bug 的特征（白屏案例根因） |

### 4.3 `source: "host"` — Extension 与 Webview 信标

| name | 级别 | 载荷 | 含义 |
| --- | --- | --- | --- |
| `extension.activated` | info | `extensionVersion`, `appName`, `vscodeVersion` | 扩展激活（生命周期分段锚点） |
| `diagnostics.opened` / `diagnostics.exported` / `diagnostics.export-failed` | info / error | export-failed 带 `detail` 堆栈 | Open Logs / Export Bundle 命令 |
| `webview.boot-ok` | info | `detail`: `build <构建号> bootMs <N>` | Bundle 挂载成功；`bootMs` = timeOrigin→挂载（P1） |
| `webview.render-ok` | info | `detail`: `items <N> renderMs <M>` | 首个非空转录提交；`renderMs` = timeOrigin→首帧（P1） |
| `webview.boot-timeout` | error | `detail`: 固定文本 | Bundle 10 秒内未挂载 |
| `webview.error` | error | `detail`: 异常消息 + 脚本位置 / `resource failed: TAG url` / `render crash: …` | 未捕获异常、资源失败或 React 渲染崩溃 |
| `webview.unhandledrejection` | error | `detail`: reason 或 stack | 未处理 Promise 拒绝 |
| `webview.perf-longtask` | info | `detail`: `count <N> maxMs <M> totalMs <T> windowMs 30000` | 主线程长任务聚合（P2），每 30s 窗口最多一条、无长任务不发 |
| `webview.perf-batch` | info | `detail`: `flushes <N> messages <M> maxBatch <B> maxFlushMs <F>` | rAF 消息合批统计（P3），回合终态时发一条 |

### 4.4 `source: "sdk"` — SDK observability 转投

| name | 含义 |
| --- | --- |
| `sdk.process.spawning` | droid CLI 子进程启动 |
| `sdk.process.stderr` | CLI 进程 stderr（`detail` 现为原文） |
| `sdk.process.non_json_output` | CLI 输出了非 JSON 行 |
| `sdk.transport.error` | 传输层错误（`detail` 含错误与堆栈） |
| `sdk.request.sent` | JSON-RPC 请求发出，`attributes.method` 如 `droid.add_user_message` |
| `sdk.message.invalid` / `sdk.response.invalid` | SDK 收到无法处理的消息/响应 |
| `sdk.permission.started/.finished` | 权限请求生命周期；finished 附 `result` |
| `sdk.ask_user.started/.finished` | AskUser 生命周期 |
| `sdk.metric` | SDK 指标；实测只有 `metric: cli_jsonrpc_child_spawn_latency`（ms） |
| 其他 | SDK 日志按其 `name` 原样通过（字符集校验后），`detail` = 原始 message（+error 堆栈）；兜底名 `sdk.log` / `sdk.event` |

## 5. 典型故障的日志特征

### 5.1 范例：Webview 白屏渲染崩溃（2026-08-11 实战案例）

真实日志（旧格式，节选）：

```text
{"sequence":1,"level":"info","name":"webview.boot-ok","detail":"build 20260811T132138"}
…
{"sequence":9,"level":"info","name":"webview.render-ok","detail":"items 226"}
{"sequence":10,"level":"error","name":"webview.error","detail":"Uncaught Error: Duplicate key toolCallId-tool-c3c6fb60bda1cce4 in useResources @…/webview.js:15"}
```

读法：`boot-ok` 有（Bundle 没坏）、`render-ok` 有（数据到了、首次
提交成功）、**紧跟** `webview.error` → 崩溃发生在渲染层提交之后，
不是启动链路，不是 Host。detail 直接给出组件级线索（重复 key）。
该案例根因：恢复检查点与重载历史 reconcile 产出重复 `toolUseId`。
在新格式下，这类问题还会提前在 `host.perf.recovery` 里露出
`reconciled ≈ recovered + loaded` 的特征。

反向模式速查：

| 观察 | 结论方向 |
| --- | --- |
| 无 `boot-ok`，有 `boot-timeout` | Bundle 加载/执行挂起（CSP、资源、语法错误） |
| `boot-ok` 构建号 ≠ 最新打包构建号 | 陈旧缓存 Bundle，需完整重启 Cursor |
| `boot-ok` 有、无 `render-ok`、无 error | 转录一直为空或 Host 没发快照——查同 `act` 段有无 `runtime.initialize.finished` |
| `render-ok` 后 `webview.error` | 渲染层崩溃（本范例） |
| `webview.error` detail 以 `resource failed:` 开头 | 静态资源加载失败 |

### 5.2 回合卡死 / 状态机挂起

- 按 `turn` 字段抽出一次交互的全部记录，核对骨架完整性：
  `host.turn.accepted` → `runtime.turn.started` →（工具/权限流）→
  `runtime.turn.finished` → `host.turn.state`(终态) →
  `host.perf.turn-io`。断在哪一环，问题就在哪层。
- `sdk.permission.started` 后无 `.finished` → 权限请求悬挂（用户
  没答，或交互卡没渲染——交叉核对 `host.interaction.opened` 有无
  对应 `closed` 以及有无 `webview.error`）。
- `runtime.turn.finished` `outcome: "stream-ended"`（warn）→ SDK 流
  在没有 turn-complete 的情况下走完，疑似 CLI 异常终止；此时查
  相邻的 `sdk.process.stderr` / `sdk.transport.error` 的 detail。

### 5.3 CLI / 进程层异常

- `sdk.process.stderr` / `sdk.process.non_json_output` /
  `sdk.transport.error` 的 detail 现在是原文，直接读。
- `sdk.metric` 的 `cli_jsonrpc_child_spawn_latency` 正常约 300–650ms；
  数秒级说明本机环境异常。
- `runtime.initialize.finished` `outcome` ≠ `available` → 初始化失败。

### 5.4 性能问题

| 主诉 | 看什么 |
| --- | --- |
| 首屏慢 | `webview.boot-ok` 的 `bootMs`（Bundle 启动）与 `webview.render-ok` 的 `renderMs`（首个非空转录），两者差值是数据等待+渲染 |
| 打开面板后卡顿 | `webview.perf-longtask`（长任务聚合）+ `host.perf.snapshot.bytes`（快照是否过大） |
| 流式输出卡 | `webview.perf-batch` 的 `maxBatch`/`maxFlushMs` + `host.perf.turn-io` 的 `n_assistant_delta` 计数 |
| 回合总时长异常 | `runtime.turn.finished.durationMs`，先扣除该回合 `host.interaction.closed.pendingMs`（用户思考时间） |
| 初始化/恢复慢 | `runtime.initialize.finished.durationMs`（基线 3.8–5s）、`runtime.history.finished.durationMs`、`host.perf.recovery.reconcileMs` |
| Context 读取慢 | `runtime.context.finished.durationMs`（冷读 1.3–7s，热读 ~35ms） |

## 6. 分析步骤模板

1. **收集**：列出 `…\globalStorage\droidvisx.droidvisx\logs\` 下按天
   的文件，对应用户描述的时间段（UTC 日期，本地晚八点后注意跨天）。
2. **分段**：按 `act` 分组（一组 = 一次扩展激活 = 一个窗口生命周期），
   组内按 `sequence` 排序；记下每段 `webview.boot-ok` 的构建号。
3. **扫异常**：过滤 `level in (warn, error)`，读 detail 原文；统计
   各 name 计数分布。
4. **重建时间线**：对用户主诉的那次交互，按 `turn` 字段抽出全链路
   记录（Host 骨架 + Runtime + SDK + webview 信标），核对配对完整性。
5. **对照特征库**：与 §5 模式匹配；不匹配的新模式回源码确认语义
   （事件产地：`FactoryDroidRuntime.ts` / `ChatController.ts` /
   `DroidViewProvider.ts` / `LocalDiagnostics.ts`）。
6. **报告格式**：结论先行（哪层、什么故障、证据行）；给时间线摘录；
   明确写出“日志无法回答的部分”。
7. **修复后回看**：让用户复现原场景，比对同一特征是否消失。

## 7. 快速统计代码片段（PowerShell）

```powershell
$f = "$env:APPDATA\Cursor\User\globalStorage\droidvisx.droidvisx\logs\droidvisx-<日期>.jsonl"
# 事件名分布
Get-Content $f | ForEach-Object { $_ | ConvertFrom-Json } |
  Group-Object name | Sort-Object Count -Descending | Format-Table Count, Name
# 只看 warn/error
Get-Content $f | ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.level -in 'warn','error' } |
  Format-Table timestamp, act, name, detail -Wrap
# 单次交互全链路（按 turn 关联）
Get-Content $f | ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.turn -eq '<turnId>' } |
  Format-Table timestamp, source, level, name -Wrap
# 回合耗时一览
Get-Content $f | ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.name -eq 'runtime.turn.finished' } |
  ForEach-Object { $_.attributes } |
  Format-Table durationMs, outcome, toolUniqueCount, toolResultCount
```
