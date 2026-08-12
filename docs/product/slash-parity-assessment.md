# droid CLI `/` 命令全量对齐评估

> 状态：**调研结论**（2026-08-12，纯文档，未改生产代码）。
>
> 证据基线（三路交叉验证）：
>
> 1. **本机二进制**（权威）：`droid.exe` 0.193.0（`droid -v` 实测）。
>    `droid --help` 本身**不列**斜杠命令（只有 CLI 旗标与子命令，
>    实测输出确认）；斜杠命令注册表从二进制字符串提取——命令 slug
>    枚举 + `Ot$` 元数据映射（name/description/category/aliasOf/
>    envGated，`artifacts/btw-enum.txt`、`artifacts/btw-cmdmeta.txt`
>    转储，git 忽略本地留证）+ i18n 描述表
>    （`artifacts/btw-registry-dump.txt`）。
> 2. **官方文档**：`docs.factory.ai/droid-cli/cli-reference`
>    "Slash commands" 表（2026-08-12 抓取，45 行）。
> 3. **本仓库既有取证**：`slash-commands-design.md`（自定义命令
>    通道实证）、`cli-coverage-assessment.md`（能力矩阵）、
>    `implementation-status.md`（GUI 现状权威）、HANDOVER §3
>    （用户拍板与排除表）。
>
> 姊妹文档：`side-question-design.md`（`/btw` 切片设计，本文 S1）。

## 1. 结论速览

droid CLI 0.193.0 交互模式内置 **55 个斜杠 slug（52 个本命 + 3 个
别名）**，分六类（session / config / navigation / diagnostics /
tools / meta）。对照 GUI：**约 17 个已有生产等价物**（含 `/compact`
`/new` 已拦截执行、自定义命令经 SDK 通道已通）；**6 个已在现行
排期内**；**2 个有公开 SDK 通道可接但未排期**（`/btw`、`/cwd`）；
**约 30 个判不做/不适用/fail-closed**（TUI 终端专属、账号组织侧
用户已排除、无公开通道，逐条有证据）。

价值排序的补齐建议：**S1 `/btw`**（唯一"CLI 高频能力 + GUI 完全
无等价"的缺口，独立设计文档已就绪）→ **S2 `/` 弹窗 Built-in 组
扩充**（别名拦截 + 导航行映射到既有 UI，纯 Webview 本地，零新
通道）→ **S3 `/cwd`**（公开 RPC 在手，低频，backlog）。

## 2. 全量命令清单与三源差异

### 2.1 权威清单（二进制 slug 枚举，0.193.0）

按 CLI 自身分类（`Ot$.category`）。★ = 别名。

| 类 | 命令 |
| --- | --- |
| session (12) | `btw`、`clear`★(→new)、`compress`、`copy`、`favorite`★(→pin)、`fork`、`new`、`pin`、`rename`、`rewind-conversation`、`share`、`tree` |
| config (15) | `cd`★(→cwd)、`commands`、`connectors`、`cwd`、`droids`、`fast`、`hooks`、`language`、`mcp`、`model`、`plugins`、`skills`、`statusline`、`terminal-setup`、`themes` |
| navigation (4) | `account`、`billing`、`sessions`、`settings` |
| diagnostics (7) | `context`、`cost`、`diagnostics`、`limits`、`settings-debug`(非生产环境门控)、`stats`、`status` |
| tools (12) | `agent-effectiveness-report`、`automations`、`create-skill`、`git-ai`、`ide`、`install-slack-app`、`loop`、`missions`、`readiness-fix`、`readiness-report`、`review`、`setup-incident-response` |
| meta (5) | `bug`、`help`、`login`、`logout`、`quit` |

文本别名（i18n/文档证据，不在 slug 枚举里）：`/exit`→quit、
`/ms`→missions、`/handoff` 与 `/compact`→compress（i18n：
"alias: handoff, compact"）。

### 2.2 三源差异（交叉验证发现）

| 差异 | 判定 |
| --- | --- |
| 官方文档表有 `/install-code-review`，本机 0.193.0 枚举**没有** | 文档超前或滞后于本机版本；以本机为准，不评估 |
| 枚举有、文档表没有：`agent-effectiveness-report`、`cd`、`loop`、`pin`、`connectors`、`settings-debug` | 前两者为新命令/别名未入文档；`settings-debug` 有 `envGated:"non-production"` 属内部命令 |
| i18n 描述表还有 `update`、`wrapped`、`gitAi` 等键，`update`/`wrapped` 不在枚举 | 斜杠注册经 feature flag 门控（二进制：`doH("feature_flags",…)` 后才 `doH("slash_commands",…)`），此二者视为未上线/活动性命令，不评估 |
| `droid --help` 完全不含斜杠命令 | 斜杠命令是 TUI 内部注册表，非 CLI 子命令；这本身就是"三路"里 help 一路的结论 |
| CLI 忙时策略：文档明文"read-only 与 settings 命令在 turn 运行中可用；改会话的命令（/new /clear /compress /fork）先确认停止；/model /fast 只在 turn 间生效"；二进制有 `slashBusyPolicy.ts`、自定义命令 `busyBehavior:"steer-or-queue"` | GUI 现状是 turn 运行中一律先 Stop；排队切片（V1 #7+）落地后应参照该分级策略放宽（见 §5 S2 注） |

## 3. GUI 现状基线

- **已拦截执行**：`/compact` → `session.compact` RPC（与 Context
  浮层按钮同管线）、`/new` → `session.new`
  （`src/webview/assistant/App.tsx` L305–325 拦截；
  `Thread.tsx` `BUILT_IN_COMMANDS` L2396–2402 提供 `/` 弹窗
  Built-in 组两行）。
- **自定义命令**：`droid.list_commands` 枚举 + 服务端 `$ARGUMENTS`
  展开已实测打通（slash-commands-design §8.1），`/` 弹窗
  Custom commands 分组 + 最近使用排序生产已接通。
- **`/` 弹窗结构**：Built-in / Custom commands / Skills 三分组
  （Skills 行为提示词助手）。CLI 侧对应物是带分组标头的命令菜单
  （二进制：`built_in_commands`/`custom_commands`/
  `plugin_commands`/`factory_skills` 等 menuGroup）。

## 4. 逐条对齐判定

判定图例：**a** = GUI 已有等价入口；**b** = 有公开 SDK/daemon
通道可执行、未接；**c** = 可 GUI 本地实现（无需 Droid 通道）；
**d** = fail-closed / 不适用 / 用户已排除（给证据）。
"排期" = 已有设计文档与排期位置，本文不重复排。

### 4.1 session 类

| 命令 | 判定 | 依据 |
| --- | --- | --- |
| `/btw` | **b → 切片 S1** | 公开 fork RPC 原生识别 `btw-fork` tag；全套设计见 `side-question-design.md` |
| `/compress`（`/compact`、`/handoff` 别名） | **a**（部分） | GUI 已拦截 `/compact`；**缺口**：`/compress`（CLI 本命名！）与 `/handoff` 未拦截，会当普通文本发给模型 → S2-a 补 |
| `/new` | **a** | 已拦截 → `session.new` |
| `/clear`★ | **a**（近似）→ S2-a | CLI 语义 = 清上下文**保留**模型/autonomy；GUI `session.new` 重置为默认。差异低价值，按 `/new` 别名拦截并如实接受语义差 |
| `/copy` | **a**（部分） | 每条助手消息已有 Copy 按钮（`Thread.tsx` L1118）；CLI 还可复制 turn 范围/session ID，增量价值低，不补 |
| `/fork` | **a** | 会话抽屉 Fork 按钮（SDK `session.fork`，implementation-status L111–117） |
| `/pin`（`/favorite`★） | **a** | 会话行 Favorite（CLI 私有 `.favorites` 文件契约，如实标注） |
| `/rename` | **a** | 会话抽屉内联 Rename（SDK `session.rename`） |
| `/rewind-conversation` | **a** | 双击消息内联编辑重问 + Rewind 文件恢复（implementation-status L753–768） |
| `/share` | **d** | SDK 全量 d.ts 无 share 符号（`rg shareSession\|share_session` 零命中）；组织共享属云侧，与用户排除的"组织策略"同类 |
| `/tree` | 排期 | V1 #1 分支关系展示（session-management-design §1.3，`parentSessionId` 只读） |

### 4.2 config 类

| 命令 | 判定 | 依据 |
| --- | --- | --- |
| `/model` | **a**（部分） | Model/Reasoning 选择器；仅 BYOK 目录是用户 2026-08-12 拍板维持的边界（HANDOVER 排除表） |
| `/fast` | **d** | SDK 全量 d.ts 无 `fastMode`/`fast_mode` 符号（rg 零命中）；`updateSessionSettings` 无对应字段 → 无公开通道 |
| `/cwd`（`/cd`★） | **b → S3** | `DroidClient.changeWorkingDirectory` 公开（node.d.ts L289）+ daemon `handleChangeWorkingDirectory` 二进制实证；低频，backlog |
| `/mcp`（`/connectors`） | **a** | `+` 面板 MCP servers 视图（列表/启停/增删/OAuth 生产已接通） |
| `/skills` | **a** | `+` 面板 Skills 视图（浏览/启停） |
| `/commands` | **a**（部分） | `/` 弹窗即自定义命令浏览；管理器（重载/导入）明确不做（slash-commands-design §2） |
| `/droids` | **d**（已调研未排期） | capability matrix："Gated; no runtime API claimed" |
| `/hooks` | 排期 V2 | plugins-hooks-design：只读可做、写 fail-closed |
| `/plugins` | 排期 V2 | plugins-hooks-design：stable daemon RPC，第一切片=设置弹层只读分区（用户：放最后） |
| `/language` | **d** | 界面中文化/i18n 是用户明确排除项；TUI 显示语言与 GUI 无关 |
| `/statusline`、`/terminal-setup`、`/themes` | **d**（不适用） | 终端 TUI 专属（状态行/键位/配色）；GUI 由 VS Code 主题体系覆盖 |

### 4.3 navigation 类

| 命令 | 判定 | 依据 |
| --- | --- | --- |
| `/sessions` | **a** | History 抽屉（list/select/resume/本地过滤 + daemon 内容搜索/归档） |
| `/settings` | **a**（部分） | 高频子集（Mode/Autonomy/Model/Reasoning）在 Composer 控件；完整 settings 编辑器无排期，`settings.json` 属 CLI 契约不碰 |
| `/account`、`/billing` | **d** | 本质是打开浏览器（`c` 技术上可 openExternal），但账号用量/组织侧是用户明确排除项（HANDOVER 排除表），不做 |

### 4.4 diagnostics 类

| 命令 | 判定 | 依据 |
| --- | --- | --- |
| `/context` | **a**（部分） | Context 浮层（安全读取/刷新/Compact；Last-call meter 为下一切片，implementation-status L570–618） |
| `/cost` | 排期 V2 | 会话级 token 用量通知 SDK 已有；"成本/token 明细可视化"在 V2 表 |
| `/stats`、`/limits` | **d** | 账号用量是用户明确排除项（HANDOVER 排除表） |
| `/status` | **a**（部分） | 连接状态横幅 + Composer 常显模型/模式/autonomy；不做专门状态页 |
| `/diagnostics` | **a**（超出） | CLI 仅显示设置配置错误；GUI 有全保真 JSONL 日志 + 导出命令（implementation-status §10） |
| `/settings-debug` | **d**（不适用） | `envGated:"non-production"`，内部命令 |

### 4.5 tools 类

| 命令 | 判定 | 依据 |
| --- | --- | --- |
| `/missions` | **a**（部分）+ 排期 | ProposeMission/StartMissionRun 确认卡已接通；只读展示 + 控制面增量 = V1 #5（mission-control-feasibility） |
| `/review` | 排期 V2 | git-pr-workflow-design；近期用户可直接发审查提示词达成近似效果 |
| `/create-skill` | **d**（待证不做） | SDK 无 createSkill 类符号；TUI 引导流程，无公开 RPC 证据；如后续有需求再取证 |
| `/automations` | 排期 V2（受限） | plugins-hooks-design：本机 Factory 后端 list 报 Network error，只读受限 |
| `/loop` | **d**（判不做） | 定时重发提示词技术上可 GUI 本地实现（c），但无人值守循环执行的权限/成本风险高、价值低；显式判不做 |
| `/ide` | **d**（不适用） | 该命令用于让 CLI 连接 IDE 扩展；DroidVisX 本身就是 IDE 集成 |
| `/git-ai`、`/install-slack-app`、`/setup-incident-response`、`/agent-effectiveness-report` | **d** | 一次性安装器 / 组织级工具（Slack、Git AI、org 报告），本质终端/浏览器场景，与个人交互工作台定位不符 |
| `/readiness-fix`、`/readiness-report` | **d**（判不做） | 专用 TUI 工作流，无公开 RPC 证据；价值偏 CI/团队侧 |

### 4.6 meta 类

| 命令 | 判定 | 依据 |
| --- | --- | --- |
| `/help` | **c**（判不做专页） | `/` 弹窗分组列表本身即自文档；GUI 快捷键少，无 help modal 必要 |
| `/bug` | **d** | daemon `submit_bug_report` RPC 公开，但 Help/Feedback 是用户排除项（HANDOVER 排除表） |
| `/login`、`/logout` | **d** | 无 SDK auth 渠道（cli-coverage §4"必须回终端"首条）；GUI 维持"请先在终端 droid 登录"提示 |
| `/quit` | **d**（不适用） | GUI 无进程可退；daemon 回收已有 `droidvisx.shutdownDaemon` |

### 4.7 汇总

| 判定 | 数量 | 命令 |
| --- | --- | --- |
| a 已有等价（含部分） | 17 | compress(经/compact)、new、clear★、copy、fork、pin/favorite★、rename、rewind-conversation、model、mcp/connectors、skills、commands、sessions、settings、context、status、diagnostics |
| b 通道在手未接 | 2 | **btw**（S1）、**cwd/cd★**（S3） |
| 已在排期 | 6 | tree(V1#1)、missions(V1#5)、hooks(V2)、plugins(V2)、automations(V2)、review(V2)、cost(V2) |
| d 不做/不适用/排除/fail-closed | 其余 ~30 | 见各表，逐条有证据 |

## 5. 补齐切片建议（按价值排序）

### S1：`/btw` Side Chat（价值最高）

唯一"CLI 高频日常能力 + GUI 完全无等价"的缺口。完整设计、第一
切片定义与改动面见 `side-question-design.md`。

### S2：`/` 弹窗 Built-in 组扩充（低成本高确定性，纯 Webview 本地）

零新 Droid 通道，全部映射既有 UI/管线：

- **a. 别名拦截补全**：`/compress`、`/handoff` → 既有 compact
  拦截管线（当前只认 `/compact`，用户抄 CLI 文档输入 `/compress`
  会被当普通文本发给模型——这是现存的真实语义错误）；`/clear` →
  `session.new`（语义差异如实接受，见 §4.1）。
- **b. 导航行**：Built-in 组新增只读导航条目，选中即打开对应
  既有 UI——`/model`（模型选择器）、`/mcp`（`+` 面板 MCP 视图）、
  `/skills`（`+` 面板 Skills 视图）、`/sessions`（History 抽屉）、
  `/context`（Context 浮层）。均为 Webview 本地状态切换，
  turn 运行中也可用（对齐 CLI"read-only 命令随时可用"的忙时
  策略，§2.2 末行）。
- 改动面：`Thread.tsx` `BUILT_IN_COMMANDS` 扩表 + `App.tsx`
  拦截分支 + 各面板 open 回调（全部已存在）+ 组件测试，约
  150–250 行级。**不加**没有既有 UI 目标的行（不为对齐而造页面，
  遵守 UI restraint）。

### S3：`/cwd`（backlog，低优先级）

公开 RPC 在手（§4.2），但改工作目录属低频高级操作，且与 V2
worktree 并行任务切片天然相邻——建议归入该切片调研范围，不单开。

### 不新增排期的部分

已在排期的 6 项维持原位（HANDOVER §3 为准）；d 类不做项以本文
为证据存档，后续有人再提时先对表。

## 6. 与既有文档的关系

- `slash-commands-design.md` §2 的内置命令等价表（8 行）被本文
  §4 全量表**取代**（该文其余部分仍是自定义命令通道的实现权威）。
- `cli-coverage-assessment.md` 的 10 条缺口判定不受影响；本文
  补充的是"斜杠命令"这一交互面的逐条视图，两文引用同一批
  implementation-status/HANDOVER 锚点。
