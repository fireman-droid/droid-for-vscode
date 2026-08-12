# 原生 Terminal 工作流设计（V2）

> 状态：设计完成，待排期。撰写日期 2026-08-12。
> 格式遵循 `message-card-design.md` 约定。

## 0. 结论速览

| 子能力 | 可行性 | 说明 |
| --- | --- | --- |
| Droid 的命令**跑在** VS Code 真终端、用户可接管 | **fail-closed** | SDK 无「命令路由到外部终端执行」的任何通道（证据 §2.3）；命令实际在 droid CLI 子进程内执行，GUI 无法把执行位置搬走 |
| 命令与输出实时**镜像**到只读伪终端 | **降级可行** | `vscode.window.createTerminal({ pty })` + SDK `tool_progress` 事件的输出字段（证据 §2.1/§2.2） |
| daemon 托管 PTY（真交互终端） | **判缓** | RPC 存在但 DATA 事件仅在控制器层可达，且与「镜像」目标不同（是给 Droid 用的终端，不是给用户看命令的终端）；登记不实现 |

结论：V2 表原文「可看可接管」中的**接管判 fail-closed**，本项收窄为
「终端镜像（可看不可接管）」。镜像与既有「流式命令输出预览」
（`tier1-polish-plan.md` §1，V1 ⑥ 相关）**共享同一数据源**，是其
放大视图而非并列建设，结论见 §3。

## 1. 需求与范围

用户诉求：Droid 执行的命令（构建、测试、脚本）能出现在 VS Code
终端面板里，获得真终端的滚动、选择、复制、等宽渲染体验，而不是
只在转录卡片里看截断文本。

范围外：

- 用户在该终端输入并影响 Droid 的命令执行（无通道，fail-closed）；
- 替代 Droid 的执行环境（命令仍在 droid CLI/daemon 子进程内跑）；
- shell integration、终端持久化恢复。

## 2. 能力证据

### 2.1 VS Code 伪终端 API

- `@types/vscode` `index.d.ts`：`Pseudoterminal` 接口（
  `onDidWrite`、`open`、`close`、可选 `handleInput`）与
  `ExtensionTerminalOptions`，经 `vscode.window.createTerminal({ name,
  pty })` 创建。扩展完全控制写入内容；`handleInput` 留空或忽略输入
  即得到只读终端。ANSI 转义序列原样透传，可保留 Droid 命令输出的
  颜色。这是官方 API，无发明。

### 2.2 SDK 侧输出数据源

来源：`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`：

- L4945–4946：`ToolProgressUpdateNotificationSchema` 载荷含
  `terminalId?: string` 与 `fullOutput?: string`（另有增量 `text`）。
  即 execute 类工具运行期间，SDK 以 `tool_progress` 通知持续推送
  输出，并给出可用于聚合的 `terminalId`。
- 仓库现状：`src/runtime/normalizeSdkEvent.ts` 已把 `tool_progress`
  归一为 `RuntimeEvent`，但目前**未透传输出字段**——这正是 tier1 §1
  （流式命令输出预览）要补的 Runtime/Bridge 通道。

### 2.3 「跑进真终端」无通道的取证（fail-closed 依据）

- SDK 类型面全文无「在外部终端执行」「execution target」「terminal
  routing」类参数：`ExecuteToolInputSchema`（
  `chunk-C3KHERVH.js` L20330–20337）仅有 `summary/command/timeout/
  riskLevel/riskLevelReason/fireAndForget`，无执行位置字段；工具
  确认（approval）流程的载荷同样没有可注入执行环境的选项。
- 执行发生在 droid CLI 进程树内（Runtime 与 CLI 的关系见
  `architecture-overview.md`）；VS Code 侧没有 API 能把别的进程的
  stdio「变成」一个用户 shell 终端。
- daemon 终端 RPC（L44953–44960：`daemon.create_terminal` /
  `write_terminal_data` / `resize` / `close` / `list`，事件 DATA/
  EXIT/ERROR）是 **daemon 托管的 PTY 资源**，语义是「给 Droid 或
  客户端开一个终端」，不是「把 execute 工具的命令搬进去跑」；且
  DATA 事件经 `DaemonSessionController` 层分发，现有 Runtime 尚无
  该观察通道。两点合计：不能用它实现「Droid 命令跑进用户终端」。

## 3. 与「流式命令输出预览」（tier1 §1）的关系：不重复建设

| | 流式输出预览（tier1 §1） | 终端镜像（本项） |
| --- | --- | --- |
| 位置 | 转录内 activity 行展开区 | VS Code 终端面板 |
| 数据源 | `tool_progress` 的 `text`/`fullOutput` | **同一数据源** |
| 长度 | 尾部 N 行环形缓冲 | 全量流式追加 |
| 交互 | 无 | 终端原生滚动/选择/复制 |

结论：**终端镜像是预览的放大视图**。实现顺序上 tier1 §1 先行（它
负责把输出字段从 Runtime 透传出来）；本项复用同一 Runtime 通道，仅
新增 Host 侧 pseudoterminal 投影与一个入口，不另建输出管线。若本项
开工时 tier1 §1 尚未落地，则本切片吸收其 Runtime 透传部分（见 §6
依赖说明），两者仍是一条管线。

## 4. 分层设计（镜像方案）

### 4.1 数据流

```
droid CLI/daemon → SDK tool_progress(text, fullOutput, terminalId)
  → Runtime normalizeSdkEvent 透传 outputChunk（tier1 §1 通道）
  → Host TerminalMirror（本项新增）
  → vscode.window.createTerminal({ pty }) onDidWrite
```

### 4.2 Host：TerminalMirror

- 单例 `src/extension/terminalMirror.ts`：惰性创建一个名为
  `DroidVisX: 命令输出` 的伪终端；同一会话的 execute 输出按工具
  调用为单位写入，调用开始时写一行分隔头（`$ <command>` + 时间），
  输出增量原样 `fire(text)`（保留 ANSI）。
- 多命令汇聚到同一个终端（按时间顺序追加），不是每命令一个终端——
  避免终端面板爆炸；`terminalId` 仅用于内部归组判断分隔头。
- `handleInput` 实现为丢弃输入；首次打开时写一行提示
  `[DroidVisX 镜像终端 · 只读]`（弱化灰色 ANSI，遵守 UI restraint）。
- 终端被用户关闭 → dispose 并回到惰性待创建状态，不自动重开。

### 4.3 入口与 Bridge

- 入口：execute 类 activity 行的展开区加一个 quiet 文本动作
  「在终端中查看」（与既有 hint 样式一致，不新增彩色元素）。
- Bridge：一条 W→H 消息 `terminal.openMirror`（无载荷或含
  `toolCallId` 用于滚动定位）。H→W 无新消息——镜像状态不需要回流。
- 输出数据本身**不经过** Webview（Host 直接从 Runtime 事件订阅），
  Bridge 不为镜像加输出消息，避免双倍序列化。

## 5. 边界与失败路径

| 情形 | 行为 |
| --- | --- |
| 用户在镜像终端敲键盘 | 输入丢弃；不回显、不转发（fail-closed 的「接管」路径） |
| tool_progress 无输出字段（部分工具/旧 CLI） | 该命令只有分隔头 + `[无输出流]` 一行；不报错 |
| 回放/恢复会话的历史命令 | 不回灌历史输出（镜像只反映实时流）；入口在历史 activity 行上隐藏 |
| 输出洪峰 | 直接透传给终端（xterm 自身有缓冲与裁剪）；Runtime 侧沿用 tier1 §1 的节流策略，不另加 |
| 多会话并发（daemon 模式） | 第一切片仅镜像当前激活会话；分隔头带会话短名以防混淆 |

## 6. 切片划分与第一切片

- **前置依赖**：tier1 §1 的 Runtime 输出透传（`normalizeSdkEvent`
  提取 `text`/`fullOutput` + 事件字段）。若届时未落地，第一切片
  包含该 Runtime 部分（约 +40 行），Bridge 预览消息仍留给 tier1 §1。
- **切片 A（第一切片，一天内可交付）**：TerminalMirror 单例 +
  `terminal.openMirror` 消息 + activity 行入口。可观察完成标准：
  在真实 Cursor 中让 Droid 跑一条多行输出命令（如 `pnpm ls`），
  点「在终端中查看」后终端面板出现只读镜像终端，能看到带分隔头的
  实时输出；敲键盘无任何效果；关闭终端后再次点入口可重新打开。
- **切片 B（可选增强）**：自动打开开关（设置项，默认关）、输出洪峰
  节流调优、多会话分隔头完善。

## 7. 改动面预估（切片 A）

| 层 | 改动 | 量级 |
| --- | --- | --- |
| Runtime | 无（或吸收 tier1 §1 透传，~40 行） | 0–小 |
| Bridge | 1 条 W→H 消息 | 极小 |
| Host | 新 `terminalMirror.ts` + 事件订阅接线 | 中（~120 行） |
| Webview | activity 展开区一个文本动作 | 极小（~20 行） |
| 测试 | TerminalMirror 单测（mock pty）+ 消息接线测试 | 小 |

## 8. 可观察验收标准

1. 运行中 execute 工具的 activity 展开区出现「在终端中查看」；
   历史/回放行不出现。
2. 终端面板出现 `DroidVisX: 命令输出`，含只读提示行与命令分隔头，
   输出与转录预览一致且更全。
3. 终端内键盘输入无效果，Droid 命令执行不受影响。
4. 关闭终端 → 再次触发入口 → 终端重建，无僵尸终端残留。
5. 非 execute 类工具的 activity 行不出现该入口。
