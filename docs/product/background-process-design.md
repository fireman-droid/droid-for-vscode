# 后台进程管理设计（V2）

> 状态：设计完成，待排期。撰写日期 2026-08-12。
> 格式遵循 `message-card-design.md` 约定。

## 0. 结论速览

| 子能力 | 可行性 | 说明 |
| --- | --- | --- |
| 后台进程**列表**（GUI 枚举 Droid 启动的长驻进程） | **降级** | SDK/daemon 无进程注册表 RPC（证据 §2.2）；只能从工具事件推导「尽力而为」清单 |
| GUI **停止**进程（kill） | **fail-closed** | 无进程句柄、无 PID 通道；文本启发式取 PID 误杀风险不可接受 |
| 疑似长驻命令的**检测与提示** | **可行** | execute 工具协议有 `fireAndForget` 字段（证据 §2.1）+ 命令模式启发式 |
| 用户**手动管理**辅助（复制 kill 命令 / 打开日志） | **可行** | 纯文本辅助，无系统调用 |

结论：V2 表原文「列表/停止」中**停止判 fail-closed**；本项收窄为
「检测 + 尽力而为列表 + 手动管理辅助」。

## 1. 需求与范围

Droid 常被要求启动 dev server、watcher 等长驻进程。用户诉求：知道
「Droid 帮我起了什么还在跑」，并能收掉它们。

范围外：

- GUI 直接 kill 进程（无可靠句柄，见 §2.3，fail-closed）；
- 跨会话/跨重启的进程持久追踪（无注册表可查）；
- 端口扫描、进程树探测等系统级探查（超出扩展定位，且平台差异大）。

## 2. 能力证据

### 2.1 协议里存在后台执行语义（检测的依据）

- `node_modules/@factory/droid-sdk/dist/chunk-C3KHERVH.js`
  L20330–20337：`ExecuteToolInputSchema = z.object({ summary?,
  command, timeout?, riskLevel?, riskLevelReason?, fireAndForget?:
  boolean })`。即 execute 工具协议含 `fireAndForget` 可选布尔——
  Droid 决定「发射后不管」时该字段可出现在工具调用 input 里，GUI
  能在 activity 数据中读到。
- 该字段**未导出到 `.d.ts` 类型面**（`index-D_SzTnFR.d.ts` 全文无
  `fireAndForget`），属于打包产物内可见但未公开成型的协议细节——
  使用时必须 fail-soft（字段缺失不报错）。
- 官方 CLI 有实验性的后台进程能力（`droid exec` 相关的
  allow-background-processes 语义在官方 changelog 有踪迹），但本机
  CLI 0.193.0 的 `--help` 面与官方 settings 文档均未暴露对应
  flag/子命令；不可作为 GUI 依赖。

### 2.2 无进程注册表 / 无管理 RPC（列表降级、停止 fail-closed 的依据）

- `index-D_SzTnFR.d.ts` 全类型面检索 `kill|process|task_stop`：仅有
  `droid.kill_worker_session`（L63，杀 worker 会话而非 OS 进程）；
  无 `list_processes`、无 `stop_task`、无任何返回 PID 的 RPC。
- `tool_progress` / 工具完成事件载荷（L4945 附近）无 PID 字段；
  工具调用只有开始/进度/结束三态，进程在「工具结束」后是否存活，
  SDK 不再提供任何信号。
- daemon 终端 RPC（L44953–44960）托管的是 PTY 会话，不是任意工具
  进程的句柄，无法用于收割 execute 启动的后台进程。

### 2.3 stop 判 fail-closed 的推理

要 kill 必须有 PID 或句柄。三条候选路全断：SDK 无 PID（§2.2）；
从命令输出文本正则抓 PID 属启发式，误配后 kill 错进程属破坏性
失败，不可接受；Host 自己 spawn 的进程才有句柄，但这些进程是
droid CLI 的子进程，不归 Host。故 GUI 主动 kill 判 fail-closed，
仅提供「复制 kill 命令」文本辅助，由用户在真终端自行执行。

## 3. 分层设计（降级方案）

### 3.1 检测（Runtime → Host）

execute 工具的 activity 事件到达时，Host 侧判定「疑似后台/长驻」：

1. **强信号**：工具 input 含 `fireAndForget: true`（fail-soft 读取，
   字段不存在则跳过）；
2. **弱信号（启发式，可配置关闭）**：命令匹配长驻模式表——结尾
   ` &`、`nohup `、`start-`/`dev`/`serve`/`watch` 类脚本名、
   `--watch` flag。弱信号仅提示，不进列表（降低误报噪音）。

### 3.2 转录提示行（Webview）

命中强信号的工具行，在 activity 行下方追加一行 quiet 文本（复用
既有 hint 样式，不加图标不加色块）：
`后台进程 · Droid 已发射不管，完成后需手动停止`。

### 3.3 「后台进程（尽力而为）」列表（Webview）

- 会话抽屉或 status 区一个折叠分节，仅当本会话存在强信号命中时
  出现；列出：命令文本（截断）、启动时间、来源工具调用锚点
  （点击滚动到转录对应行）。
- 明确标注「尽力而为」语义：一行说明文本「列表来自工具调用记录，
  进程实际存活状态未知」。**不显示假的运行状态点**（不发明数据，
  也符合视觉克制——不引入新的彩色状态元素）。
- 每项动作（quiet 文本链接）：
  - **复制停止命令**：按平台生成建议文本（Windows：
    `Get-Process | Where-Object {...}` 提示模板；POSIX：
    `pkill -f "<命令特征>"`），复制到剪贴板，由用户自行核对执行；
  - **在终端打开**：`vscode.window.createTerminal` 开一个普通用户
    终端（不预执行任何命令），方便用户手动排查。

### 3.4 Bridge 契约

数据走既有 activity/transcript 通道扩展，不建独立域：

| 变更 | 内容 |
| --- | --- |
| activity 条目扩展字段 | `backgroundHint?: { fireAndForget: boolean }`（H→W，向后兼容可选字段） |
| W→H | `background.copyKillCommand { toolCallId }`（Host 生成平台化文本并写剪贴板）；或首切片直接在 Webview 拼文本、走既有剪贴板路径，则 Bridge 零新增 |

## 4. 边界与失败路径

| 情形 | 行为 |
| --- | --- |
| `fireAndForget` 字段从协议消失/改名 | fail-soft：检测不到 → 提示与列表不出现，无报错 |
| 进程已被用户手动杀掉 | 列表不感知（如实标注「存活状态未知」），条目保留至会话结束 |
| 弱信号误报 | 仅一行提示、不进列表；提供设置关闭启发式 |
| 会话恢复/回放 | 历史强信号条目重建列表但追加「历史」标注；不假设进程仍存活 |
| 用户要求 GUI 直接停止 | 明确拒绝路径：动作不存在；文档与列表说明文本解释原因（无进程句柄） |

## 5. 切片划分与第一切片

- **切片 A（第一切片，一天内可交付）**：§3.1 强信号检测 + §3.2
  转录提示行（不含列表）。前置半天探针（放 `artifacts/`）：让
  Droid 实际发射一个后台命令，抓取工具调用 input 验证
  `fireAndForget` 在本机 CLI 0.193.0 的真实出现形态；若探针证明
  该字段实际不出现，切片 A 降级为仅弱信号提示，列表切片冻结。
  可观察完成标准：真实 Cursor 中让 Droid 启动 dev server，转录中
  该命令行下出现后台提示行；普通短命令不出现。
- **切片 B**：§3.3 尽力而为列表 + 复制停止命令。
- **切片 C（可选）**：弱信号启发式 + 设置开关。

## 6. 改动面预估（切片 A）

| 层 | 改动 | 量级 |
| --- | --- | --- |
| Runtime | activity 归一时透传 `fireAndForget`（fail-soft 读取） | 极小（~15 行） |
| Bridge | activity 条目 1 个可选字段 | 极小 |
| Host | 无（透传即可） | 0 |
| Webview | activity 行提示文本渲染 | 小（~40 行） |
| 探针 | `artifacts/` 后台命令工具事件抓取脚本 | 小 |

## 7. 可观察验收标准

1. Droid 发射 `fireAndForget` 命令后，对应 activity 行下出现一行
   quiet 后台提示；短命令、前台长命令不出现。
2. 字段缺失（老会话回放）不报错、不误显。
3. （切片 B）列表条目点击锚点能滚动到对应转录行；复制的停止命令
   文本包含正确的命令特征串。
4. 全流程无任何 GUI 发起的 kill/系统调用；代码评审可核验。
