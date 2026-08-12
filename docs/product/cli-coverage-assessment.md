# DroidVisX ↔ droid CLI 能力覆盖评估

> 状态：**调研存档**。第 3 节 10 条缺口的用户拍板结果与现行排期见
> `HANDOVER.md` §3「CLI 覆盖度缺口判定」，以那里为准；文中
> "计划中V1 #N"序号为撰写时旧排序（此后 Canvas 移至 #7、Turn 排队
> 上移为 #7+），现行顺序以 HANDOVER §3 为准。
>
> 调研日期：2026-08-12。只读调研产物，未改动任何既有文件。
>
> 证据基线：
>
> - **CLI 实测**：`droid --version` = **0.193.0**；`droid --help` 及
>   `exec / daemon / search / update / mcp / plugin / computer` 全部子命令
>   `--help`（含 `mcp add`、`mcp permissions`、`plugin marketplace`、
>   `plugin list`、`computer register` 二级子命令）本机实测输出。
> - **SDK 公开面**：`node_modules/@factory/droid-sdk/dist/index.d.ts`
>   导出表（0.7.0）；daemon RPC 清单引
>   `daemon-implementation-plan.md` §2.8（L234–252，已实证）。
> - **仓库既有调研**：`docs/engineering/droid-capability-matrix.md`、
>   `docs/preflight/00–07`（历史快照，与 implementation-status 冲突时
>   以后者为准）、`session-management-design.md` §1.1、
>   `spec-mission-design.md`、`slash-commands-design.md`。
> - **DroidVisX 侧**：`implementation-status.md`（2026-08-11 核对版）、
>   `HANDOVER.md` 第 3 节（V1 八切片、V2 远期、用户排除、fail-closed 表）、
>   各设计文档。
>
> 纪律：每条结论标注证据；严格区分三类——**文档说做不了（有证据的
> fail-closed）**、**文档提过但未排期**、**任何设计/计划文档都没提
> （真空缺口，未评估）**。不发明 CLI 或 SDK 能力。

---

## 1. 结论速览

**做完现有全部设计/计划文档（V1 八切片 + daemon 化四阶段 + V2 远期表）
之后，DroidVisX 可以覆盖 droid CLI 日常交互式使用的绝大部分核心工作流
——发消息、流式输出、权限/AskUser、Session 全生命周期（含归档、跨会话
搜索、reload 存活）、Skills/MCP/自定义命令、附件、Spec 闭环、Mission
只读——定性估计"日常交互工作流"约八到九成可在 GUI 内完成；但它不能
成为 CLI 的完全替代品。** 三类场景仍然回不了 GUI：（a）**登录、CLI
升级执行、relay computer、headless 脚本/CI** 这类本质上属于终端或被
SDK 边界挡死的操作；（b）**Mission 暂停/恢复、Session 删除、Spec 起草
实时渲染**等公开 SDK 明确没有渠道、文档已判定 fail-closed 的能力；
（c）更值得警惕的是一批**真空缺口**——CLI 有、但现有任何设计/计划
文档都没评估过的能力（本文第 3 节，共 **10** 条，其中最重的是
**内置模型全目录切换**：CLI `/model` 与 `droid exec -m` 可选 40+ 个
内置模型，而 GUI 按现行设计只显示 BYOK 自定义模型，没有任何文档计划
补齐）。结论：**对轻度交互用户，文档做完后 GUI 基本可替代 CLI（首次
登录除外）；对重度用户和团队/自动化用户，CLI 仍是必需品**（详见第 5
节分档判定）。

---

## 2. 能力覆盖矩阵

状态图例：**生产已接通** / **部分** / **计划中V1**（HANDOVER §3 八切片）
/ **计划中V2**（HANDOVER V2 远期表）/ **架构专项**（daemon 计划四阶段）
/ **用户排除**（HANDOVER 排除表）/ **fail-closed**（文档有证据判定做
不了）/ **已调研未排期**（preflight/矩阵登记过、无设计无排期）/
**真空缺口**（任何设计/计划文档都没提，未评估）。

### 2.1 交互会话核心（droid 交互式 TUI 主流程）

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| 交互式聊天 / 初始 prompt | `droid "prompt"`（`droid --help` 实测） | 生产已接通 | implementation-status §生产已接通1（L276–297） |
| 流式输出 / Thinking / Tool 生命周期 | TUI 主体验；SDK `DroidStreamEvent` | 生产已接通（Tool 参数/原始输出不进 Webview 属安全设计） | implementation-status §2（L299–327） |
| Stop / 中断回合 | TUI Esc；SDK `interrupt()` | 生产已接通 | implementation-status L287 |
| Resume（`-r [sessionId]`） | `droid --help` | 生产已接通 | implementation-status §7（L396–413） |
| Fork（`--fork <id>`） | `droid --help`、`exec --fork` | 生产已接通（会话抽屉 Fork 按钮，SDK `session.fork`） | implementation-status L111–117 |
| Rewind / 编辑重问 | TUI 内置；SDK `rewind`/`getRewindInfo` | 生产已接通（双击内联编辑 + 文件恢复勾选） | implementation-status L753–768 |
| Compact（TUI `/compact`） | slash-commands-design L85–90 内置命令等价表 | 生产已接通（Context 浮层 "Compact conversation"） | implementation-status L76–83 |
| Rename 会话 | SDK `session.rename` | 生产已接通（仅活跃会话） | implementation-status L50–54 |
| 会话列表（cwd 作用域） | SDK `listSessions` | 生产已接通 | implementation-status §7 |
| 会话历史加载 | SDK `DroidClient.loadSession` | 生产已接通（图片/Document 块暂省略标 partial → 计划中V1 #3 补） | implementation-status §8；rich-content-design §1 |
| Turn 运行中排队新消息 | SDK `QueuedUserMessage*` 类型族 + `daemon.resolve_queued_user_message`（index.d.ts 导出表；daemon-implementation-plan §2.8） | **已调研未排期**——GUI 明确"Turn 运行时不支持排队，提示先 Stop"；preflight 01 标 "Not wired / Later"；daemon 计划只覆盖重连后 queuedMessages 补投，没有排队输入 UI | implementation-status L286–287；preflight/01 L60；daemon-implementation-plan L469–471 |
| 权限请求（Edit/Execute/Create/Patch/MCP/Sandbox 等 11 类） | preflight/01 L114–126 类别清单 | 生产已接通（真实 SDK 选项投影，含 Always/Session 范围） | implementation-status §4 |
| AskUser（单选/多选/开放文本/多问题） | SDK handler | 生产已接通 | implementation-status §5 |
| MCP 持久权限的**管理**（列出/撤销/清空） | `droid mcp permissions list / revoke / clear`（实测 help） | **真空缺口**——GUI 只能在权限卡片里"授予"持久权限，没有任何文档提及查看/撤销已授予的 MCP 工具权限 | 无任何文档锚点（检索 docs/ 无命中） |

### 2.2 模型、设置、Context

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| 模型切换（**内置模型全目录**） | `droid exec --help` 列出 40+ 内置模型（Opus 5、GPT-5.6 系、Gemini、Grok…）；TUI `/model` | **真空缺口（最重）**——GUI 只显示 SDK `isCustom: true` 的 BYOK 模型；内置模型仅"当前值可见、不可选"。没有任何文档评估过是否/如何让 GUI 选择内置模型 | implementation-status L590–595、L727–736；preflight/01 L73（"Wired for captured BYOK catalog"） |
| BYOK 自定义模型选择 | `exec --model custom:*` | 生产已接通 | implementation-status §部分完成 |
| Reasoning effort | `exec -r`；各模型支持档实测 | 生产已接通（按所选模型真实声明值） | implementation-status L596–599 |
| Autonomy（`--auto low/medium/high`） | `droid --help`、`exec --help` 四档说明 | 生产已接通（Mode/Autonomy 选择器） | implementation-status §动态 Composer |
| `--skip-permissions-unsafe` | `exec --help` | fail-closed（有证据：preflight 明文"explicitly unsuitable for the normal local extension"） | preflight/01 L272–273 |
| Interaction Mode（Auto/Spec/Mission） | TUI `/settings`；SDK `updateSettings` | 生产已接通（切换）；完整 Spec 闭环计划中V1 #4 | implementation-status §动态 Composer；spec-mission-design §1 |
| Context 用量 | TUI 状态栏 | 部分——安全读取/刷新/不可信降级已接通；正确 Last-call Meter 是下一切片 | implementation-status L570–618 |
| 进程级运行时设置文件（`--settings <path>`） | `droid --help` | **真空缺口**——无文档提及 | 无 |
| 自定义系统提示（`--append-system-prompt` / `--append-system-prompt-file`） | `droid --help`、`exec --help` | **真空缺口**——无文档提及 | 无 |
| Tool 启停 / 白名单（`--list-tools` / `--enabled-tools` / `--disabled-tools` / `--additional-tools`） | `exec --help` | **已调研未排期**——preflight 登记 `disabledToolIds` Node stable / Not wired、tool inventory Probe only；无设计无排期 | preflight/01 L150–152；droid-capability-matrix L62 |
| Custom Models 创建/编辑/Provider 管理 | 配置文件 + daemon `customModels` 资源 | 计划中V2 | HANDOVER V2 远期表；implementation-status L824–825 |
| 会话 Tag（`--tag <spec>`，name/JSON 可重复） | `exec --help` Session Flags 段 | **真空缺口**——`.settings.json`/sessions-index 的 `tags` 字段在 session-management-design §1.1 表里出现过，但从未作为能力评估（无查看/打标/按 tag 过滤的任何设计） | session-management-design L23、L26（仅字段旁证） |

### 2.3 Session 管理扩展

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| Archive / Unarchive | daemon RPC `daemon.archive_session`/`unarchive_session`（无子进程渠道） | 架构专项（daemon Phase 1 首个可见验收就是归档往返） | session-management-design §1.1（L23）；daemon-implementation-plan Phase 1（L284–408） |
| Delete | 子进程/daemon/磁盘三条路径都无删除 API | fail-closed（有证据） | session-management-design §1.1（L24）；HANDOVER fail-closed 表（L140–148） |
| Favorite / 分组 | 读公开（`isFavorite`）、写为 CLI 私有 `.favorites` 文件 | 计划中V1 #1（私有文件契约方案，如实标注） | session-management-design §1.2–1.3；HANDOVER V1 表 |
| 跨会话内容搜索 | `droid search <query>`（--kind message_text/document/tool_use/tool_result、--json、--reindex，实测 help） | 架构专项（daemon Phase 1 `sessions.search`）；当前仅本地标题/ID 过滤（部分）。CLI 的 `--kind` 细粒度与 `--reindex` 未在计划中细化 | implementation-status L635；daemon-implementation-plan §1.1-2 |
| 分支关系展示 | daemon list `parentSessionId`；sessions-index | 计划中V1（随 #1 切片，Host 本地记录 + 索引只读增强） | session-management-design §1.3 |
| 跨设备 Session | Factory 云侧能力 | 用户排除 | HANDOVER 排除表（L102–115） |
| Reload 窗口任务存活 | daemon 会话 `detach()` 语义（"session keeps running in the daemon"） | 架构专项（daemon Phase 3，首要目标） | daemon-implementation-plan §1.1、Phase 3 |

### 2.4 Spec / Mission / 子代理

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| 进入 Spec（`--use-spec`；TUI 切换） | `droid --help`、`exec --use-spec`、SDK `enterSpecMode` | 部分（Mode 切换 + ExitSpec 审批/编辑已接通）；完整闭环计划中V1 #4（spec 专属模型设置、handoff 新会话收养、状态徽标） | implementation-status §6；spec-mission-design §1 |
| Spec 专属模型/推理（`--spec-model` / `--spec-reasoning-effort`） | `exec --help` | 计划中V1 #4（设计 A 段明确纳入） | spec-mission-design §1.3-A |
| Spec 起草过程实时渲染 | 无专用增量事件（起草即普通流式文本） | fail-closed（有证据） | spec-mission-design §1.4；HANDOVER fail-closed 表 |
| specs 目录浏览（`~/.factory/specs/`） | 实测目录存在；无公开 API | 文档评估过并建议 V1 不做（私有磁盘约定，可选降级项） | spec-mission-design §1.3-E、§1.4 |
| Mission 启动（`exec --mission`；TUI `/missions`） | `exec --help` Mission Mode 段；preflight/01 L206 | 部分（ProposeMission/StartMissionRun 确认卡片可结算，即公开 SDK 里的"启动"）；只读阶段展示计划中V1 #6 | spec-mission-design §2.1–2.3；implementation-status L642 |
| Mission worker/validator 模型（`--worker-model` 等 4 旗标） | `exec --help` | 计划中V1 #6 范围内提及 missionSettings 为公开字段；未细化 UI | spec-mission-design §2.1（missionSettings） |
| Mission 暂停/恢复/主动 Start 控制面 | 公开 SDK 无 pause/resume/start RPC（仅 `KILL_WORKER_SESSION` 低层） | fail-closed（有证据；"等 SDK"） | spec-mission-design §2.1–2.2；HANDOVER fail-closed 表 |
| 子代理摘要层级 | `child_session_available` 通知 + `loadSession().subagentInvocations` | 计划中V1 #6（摘要级；逐事件层级 fail-closed 有证据） | spec-mission-design §3 |

### 2.5 能力目录（Skills / Commands / MCP / Plugins / Custom Droids）

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| Skills 浏览与启停 | SDK `listSkills`/`setSkillDisabled` | 生产已接通 | implementation-status L56–62 |
| `--disable-builtin-skills`（启动级整体禁用内置技能） | `droid --help`、`exec --help` | **真空缺口**（轻）——GUI 有逐技能开关近似等价，但启动级整体禁用无文档提及 | 无 |
| 自定义 `/` 命令（`.factory/commands`） | SDK `droid.list_commands` | 生产已接通（`/` 弹窗 + 服务端展开已实测） | implementation-status L1197–1219；slash-commands-design |
| TUI 内置 slash 命令（/model /compact /settings /mcp …） | slash-commands-design L36–38（不经 list_commands 枚举） | GUI 等价物矩阵已文档化；**其中 /model 的"全目录切换"部分是真空缺口（见 §2.2）** | slash-commands-design L81–90 |
| MCP Server 列表/启停/增删/OAuth 认证 | `droid mcp add/remove/list`（实测 help） | 生产已接通 | implementation-status L64–74、L170–191 |
| MCP resources / prompts 发现 | 无公开契约 | fail-closed（Blocked pending evidence） | droid-capability-matrix L72 |
| Plugins / Marketplaces（install/uninstall/update/list、marketplace add/remove/update） | `droid plugin --help` 实测 | 计划中V2（一行索引，无设计） | HANDOVER V2 远期表；implementation-status L820–821 |
| Custom Droids | 配置文件行为，无 runtime API | **已调研未排期**——capability matrix 标 "Gated; no runtime API claimed"；implementation-status V1 清单留有未勾选项，但 HANDOVER V1 八切片不含它，无设计文档 | droid-capability-matrix L70；implementation-status L797 |
| Hooks（`.factory/hooks.json` 配置；hook 流事件） | preflight/01 L282–283 | 计划中V2（"Hooks 管理"一行索引，无设计） | HANDOVER V2 远期表 |
| Automations / Crons | daemon `automations` 资源；`unstable.crons` | 计划中V2（一行索引）；crons 属 unstable 需版本钉死 | droid-capability-matrix L91–92 |

### 2.6 附件与富内容

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| 图片/PDF/文本附件发送 | SDK `MessageOptions.images/files` | 生产已接通（文件对话框/编辑器/选区/Problems/Git changes/`@` 提及） | implementation-status L94–109 |
| 对话内图片显示 + 拖拽/粘贴 | SDK ContentBlock `image`（base64 唯一形态） | 计划中V1 #3 | rich-content-design §1、§1.5 |
| Canvas / HTML 原型预览 | —（CLI 无对应；GUI 增值项） | 计划中V1 #5 | rich-content-design §2 |
| 目录级 context 源（`droid exec` 风格） | CLI 行为 | fail-closed（有证据："无公开 SDK 渠道，保持未实现"） | implementation-status L108–109 |
| `@` Symbol 引用 | TUI `@` 引用 | 台账未勾选，无设计排期 | implementation-status L720 |

### 2.7 运行架构与非交互面

| 能力 | CLI 侧证据 | DroidVisX 现状 | 文档锚点 |
| --- | --- | --- | --- |
| daemon 运行（`droid daemon` 全旗标） | 实测 help（--port/--host/--unix/--listen/--parent-pid/--remote-access…） | 架构专项（四阶段计划自包含；Phase 0 凭据模块已交付） | daemon-architecture-design；daemon-implementation-plan |
| headless 脚本/CI（`droid exec` 文本/json/stream-json；`-f` 文件；管道） | 实测 help + Examples 段 | 本质终端场景，GUI 不适用（见第 4 节）；其中**结构化输出渲染**（`--output-format json`、`structured_output` 事件）为已调研未排期 | preflight/01 L216（"Runtime supported, no UI"）、preflight/03 L510–512 |
| Worktree 会话（`-w` / `--worktree-dir`） | `droid --help`、`exec --help` | 计划中V2（"worktree 并行任务"一行索引）；worktree 生命周期管理 fail-closed（Blocked，无专属公开资源） | HANDOVER V2 远期表；droid-capability-matrix L76–77 |
| 原生 Terminal 工作流 / 后台进程 | daemon `terminals` 资源；后台进程无稳定门面 | Terminal 计划中V2；Background processes fail-closed（Blocked pending evidence） | HANDOVER V2 远期表；droid-capability-matrix L79 |
| Git commit / push / PR | daemon `git` 资源 | 计划中V2 | HANDOVER V2 远期表 |
| CLI 更新（`droid update [-c] [-v]`） | 实测 help | 计划中V2（"更新管理：版本检测与升级提示"——**执行升级本身仍在终端**） | HANDOVER V2 远期表；droid-capability-matrix L90（daemon `updates.trigger` Gated） |
| Relay computer（register/remove/list/ssh/port-forward） | `droid computer --help` 实测 | **真空缺口**——仅 preflight 资源名清单出现 `relay`/`ssh`；V2"远程环境"一句话不构成对 relay computer 管理的评估 | preflight/01 L232–234；HANDOVER V2 表"远程环境" |
| 登录 / 登出 / 账户 | CLI 首启交互登录；`droid --help` 无 auth/token/whoami 子命令（实测） | 部分（GUI 只有"CLI 不存在/初始化失败"提示；登录操作、账户状态、版本兼容 UI 尚缺且无设计）；账号用量为用户排除 | implementation-status L634；daemon-implementation-plan L215–217、L586；HANDOVER 排除表 |
| 组织策略 / Account Profile | 无公开数据 API | fail-closed（Blocked pending evidence）+ V2 一行索引 | droid-capability-matrix L87 |
| `--log-group-id` 日志分组 | `exec --help` | 无文档提及（headless 专用旗标，GUI 无对应场景，判定不需要） | 无 |
| 诊断 / 日志 / 导出 | CLI `~/.factory/logs` | 生产已接通（全保真 JSONL + 导出命令；超出 CLI 等价物） | implementation-status §10 |
| Bug report（daemon `submit_bug_report`） | daemon RPC 清单 | 计划中V2（"Help / Feedback"一行索引） | daemon-implementation-plan §2.8；HANDOVER V2 表 |

---

## 3. 真空缺口清单（重点）

定义：CLI/SDK 有实证能力，但**现有任何设计/计划文档都没有覆盖**
（preflight 调研快照里的"Not wired/Ignored"登记不构成设计或排期；
此类单独标注为"已调研未排期"）。共 **10 条**：纯真空 7 条 +
已调研未排期 3 条。

### 纯真空（任何文档都没提，未评估）

1. **内置模型全目录切换**（最重要）。
   证据：`droid exec --help` 列出 40+ 内置模型及各自 reasoning 支持档；
   TUI `/model` 等价。GUI 现行设计只投影 `isCustom: true` 的 BYOK 模型
   （implementation-status L590–595），内置模型"当前值可见但不可选"
   （L727–736）。该限制的动机是"不硬编码模型清单/不用原型数据"，但
   `availableModels` 本身就是 SDK 返回的真实目录（含内置项，只是被
   过滤），**"是否让用户在 GUI 里切换内置模型"从未被任何文档评估**。
   影响：模型切换是最高频的日常操作之一，缺它则每次换内置模型都必须
   回 CLI，直接动摇"GUI 日常替代"的成立性。
   建议：**补文档并排期**——评估直接放开 `availableModels` 全目录
   （数据来源已有、无需发明），保留 fail-closed 校验。

2. **MCP 持久权限管理**（`droid mcp permissions list/revoke/clear`）。
   证据：实测 help。GUI 能通过权限卡片"授予"持久 MCP 工具权限
   （Always Allow 类选项），但没有任何文档提及查看/撤销/清空已授予
   权限。影响：授了收不回，安全治理不闭环，用户必须回终端。
   建议：**补文档**——先调研公开 SDK/daemon 是否有对应 RPC
   （index.d.ts 导出表未见明显对应项，可能是 CLI 本地文件行为）；
   若无公开渠道则如实判定 fail-closed 并写入 HANDOVER 表。

3. **会话 Tag**（`--tag <spec>`，纯名或 JSON、可重复）。
   证据：`exec --help` Session Flags 段；SDK `SessionTagSchema` 公开；
   `.settings.json`/sessions-index 均有 `tags` 字段
   （session-management-design L23、L26 仅作字段旁证，未评估能力）。
   影响：重度用户用 tag 做会话分类/自动化关联（如 PR URL），GUI 的
   收藏/分组切片（V1 #1）没有考虑 tag 维度。
   建议：**补文档**——至少评估"只读显示 + 按 tag 过滤"，与 V1 #1
   分组设计合并考虑。

4. **自定义系统提示**（`--append-system-prompt` / `--append-system-prompt-file`）。
   证据：`droid --help`、`exec --help`。无任何文档提及。
   影响：个性化工作流（团队约定、语言偏好）无 GUI 渠道。
   建议：**补文档**——先核实公开 SDK 会话创建参数是否暴露该选项；
   无公开渠道则判定 fail-closed。

5. **进程级运行时设置文件**（`--settings <path>`）。
   证据：`droid --help`（daemon 子命令同名旗标仅在 daemon 计划的
   help 转录中出现，未被评估）。影响：低频高级用法。
   建议：**判定不需要**（GUI 有会话级设置更新；进程级 override 属
   终端高级用法），但应在文档里显式写明该判定。

6. **Relay computer 管理**（`droid computer register/remove/list/ssh/port-forward`）。
   证据：实测 help；SDK 导出 `Computer*`/`listComputers`/`TunnelConnection`
   等符号（index.d.ts 导出表）。preflight 仅枚举了 daemon `relay`/`ssh`
   资源名；HANDOVER V2"远程环境"一句话没有指向 relay computer。
   影响：远程/中继工作流完全在评估范围外。
   建议：**判定不需要（近期）**并显式写入文档；若"远程环境"V2 项
   启动，届时把 relay computer 纳入其调研范围。

7. **启动级禁用内置技能**（`--disable-builtin-skills`）。
   证据：`droid --help`、`exec --help`。GUI 有逐技能开关（近似等价），
   但"一键整体禁用 Factory 内置技能"无文档提及。影响：轻。
   建议：**判定不需要**（逐技能开关可覆盖），显式写明即可。

### 已调研未排期（preflight/矩阵登记过，但无设计文档、无排期）

8. **Turn 运行中排队消息**。
   证据：SDK `QueuedUserMessage*` 类型族与
   `daemon.resolve_queued_user_message`（daemon-implementation-plan
   §2.8）；preflight/01 L60 标 "Not wired / Later"。GUI 明确不支持
   （implementation-status L286–287）；daemon 计划只覆盖重连后
   queuedMessages **补投**，没有"边跑边排队输入"的 UI 设计。
   影响：TUI 用户习惯在长任务中先把下一条指令打进去，GUI 强制
   Stop-再发，体验差距明显。建议：**补设计**（daemon Phase 2/3 之后
   顺势做，数据通道届时已具备）。

9. **Tool 启停/白名单**（`--list-tools`、`--enabled/--disabled/--additional-tools`）。
   证据：`exec --help`；preflight/01 L150–152（`disabledToolIds`
   Node stable / Not wired；tool inventory Probe only）。
   影响：受控环境（只读审查、禁 shell）是 CLI 的一等用法，GUI 完全
   没有。建议：**补文档评估**——`disabledToolIds` 有公开 Node 渠道，
   技术上可做；先决定产品上要不要。

10. **结构化输出**（`exec --output-format json` / `structured_output` 事件）。
    证据：实测 help；preflight/01 L216 "Runtime supported, no UI"；
    preflight/03 已列入 gaps。影响：主要服务脚本场景，GUI 价值有限。
    建议：**判定不需要**（归入"headless 属终端"），显式写明。

---

## 4. "必须回终端"清单

即使现有全部文档做完，以下操作仍只能在终端完成：

| 操作 | 原因 | 证据 |
| --- | --- | --- |
| **首次登录 / 重新登录** | CLI 无 auth/token 子命令，登录是 TUI 交互流程；GUI 与 daemon 计划都明确依赖"用户已在终端完成 droid 登录"，凭据模块只读复用登录态 | daemon-implementation-plan L215–217、L586（"请先在终端运行 droid 完成登录"）；implementation-status L634（登录操作尚缺） |
| **执行 CLI 升级** | V2"更新管理"只计划"版本检测与升级提示"；`droid update` 的实际安装在终端（daemon `updates.trigger` 仅 Gated 声明，无设计） | HANDOVER V2 表；droid-capability-matrix L90 |
| **headless 脚本 / CI / 管道**（`droid exec` 全家） | 非交互自动化本质上不是 GUI 场景；`--skip-permissions-unsafe` 被文档明确排除 | preflight/01 L257–273 |
| **daemon 异常处置**（版本漂移重启、孤儿清理兜底） | 计划提供 `droidvisx.shutdownDaemon` 命令，但无 shutdown RPC，版本漂移后"提示重启 daemon"，非常规恢复仍靠终端/任务管理器 | daemon-implementation-plan §2.8（未见 shutdown RPC）、§3.2、§3.6 |
| **Relay computer 注册/SSH/端口转发** | 真空缺口（第 3 节 #6），近期无计划 | `droid computer --help` 实测 |
| **Plugin / Marketplace 管理**（V2 启动前） | 仅 V2 一行索引，V1 全部做完时仍无 GUI | HANDOVER V2 表 |
| **Mission 暂停/恢复** | 公开 SDK 无 RPC，GUI 判定 fail-closed；CLI 侧 Mission 工作流（`/missions`）仍是唯一控制面 | spec-mission-design §2.1–2.2；preflight/01 L206 |
| **内置模型切换**（在真空缺口 #1 被补齐之前） | 现行设计 GUI 只可选 BYOK 模型 | implementation-status L590–595 |
| **MCP 持久权限撤销**（在真空缺口 #2 被补齐之前） | GUI 无管理入口 | `droid mcp permissions --help` 实测 |
| **Tool 启停 / 结构化输出 / 系统提示注入 / 会话 tag 打标** | 均为第 3 节缺口，未评估或未排期 | 见第 3 节 |
| （注）**Session 删除** | CLI 同样没有该能力（三条路径均无删除 API），不算"回终端"项，两侧都做不了 | session-management-design §1.1 L24 |

---

## 5. 最终判定（按用户档位）

### 轻度用户（日常对话、改代码、看 diff、偶尔换会话）

**做完文档后基本可完全替代 CLI。** 核心闭环（聊天/权限/AskUser/
附件/历史/恢复/Compact/Fork/Rewind/Skills/MCP/`/`命令）已生产接通；
V1 #1–#3 与 daemon 化补上收藏分组、图片、归档、内容搜索与 reload
存活后，日常留在 GUI 没有硬障碍。仅剩两件事碰终端：**首次登录**
（一次性）与**内置模型切换**（真空缺口 #1；若用户只用 BYOK 模型或
默认模型则无感）。定性：**~9 成场景 GUI 自足**。

### 重度用户（多会话并行、Spec/Mission、模型频繁切换、tool 控制、worktree、tag、hooks）

**不能完全替代，CLI 仍是常驻工具。** 即使全部文档做完：内置模型
全目录切换（真空 #1）、运行中排队（缺口 #8）、tool 启停（#9）、
tag（#3）、系统提示（#4）无 GUI；Mission 只有"审批启动 + 只读看"
（暂停/恢复 fail-closed）；worktree/Terminal/后台进程/Git-PR 都在
V2 远期且多数只有一行索引没有设计。定性：**核心交互约 7–8 成在
GUI，控制面与高级旗标约一半必须回终端**。

### 团队用户（CI/脚本、组织策略、用量治理、插件分发）

**GUI 不定位于此，替代不成立。** headless/CI 本质是终端场景；
组织策略与 Account Profile 是 fail-closed（Blocked pending
evidence）；账号用量是用户明确排除项；Plugins/Marketplaces/Hooks/
Automations 全在 V2 远期。DroidVisX 的价值是给团队成员的**个人
交互工作台**，不是团队治理/自动化面。

### 总体

现有文档集合的方向是对的：它覆盖了"交互式日常使用"这条主线的
绝大部分，并用 fail-closed 表诚实圈出了 SDK 边界。真正的风险不在
"文档说做不了"的部分（那些有证据），而在第 3 节的 10 条真空/未排期
缺口——其中**内置模型切换、MCP 权限管理、运行中排队**三条直接影响
"日常替代 CLI"的成立性，建议优先补文档评估并给出排期或显式判定。
