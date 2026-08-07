# DroidVisX 产品与 UI 规格（讨论稿）

> 状态：用于确认产品方向，尚未进入视觉原型和开发。
>
> 核心结论：采用 **Cursor 风格的聊天骨架 + Claude 风格的统一动作面板 + Droid 原生能力模型**。能力可以完整，但主界面必须克制。

## 1. 产品定位

DroidVisX 是 Droid 的 VS Code 图形界面，不是另一个 AI Agent，也不重新实现 Droid 后端。

它要解决的是：保留 Droid CLI 的模型、会话、权限、Skill、MCP、Spec、Mission、工具调用和文件变更能力，同时把终端式交互改造成更适合长期工作的编辑器内聊天体验。

推荐架构：

```text
React Webview（聊天、状态和交互）
        ↕ VS Code message bridge
Extension Host（生命周期、权限、文件、Diff、终端和上下文）
        ↕ @factory/droid-sdk/node
Droid CLI / daemon（Agent 运行时与唯一能力真源）
```

因此它在产品上像一个前端，但工程上不是“只有一个网页”。本项目不做远程业务后端，核心后端仍是用户本机的 Droid。

MVP 以 **Droid daemon 为主运行路径**，因为完整的 Session 读取、搜索、归档和资源状态依赖 daemon 能力；Node subprocess 作为 daemon 不可用时的降级路径。降级模式至少保证新建会话、流式聊天、Stop 和基本权限交互，无法可靠提供的历史搜索、归档、上下文统计与分支管理必须隐藏并明确提示，不能展示失效按钮。

## 2. 产品原则

1. **Droid 是唯一真源**：模型、推理强度、模式、权限选项、Skills、MCP、命令和组织限制都从 Droid 运行时读取，不在 UI 中写死。
2. **聊天是主角**：日常操作应在一个干净的聊天页面里完成，不先做 Mission Control 式大仪表盘。
3. **能力完整不等于全部常驻**：高频状态放在 Composer，低频能力进入可搜索动作面板，复杂管理进入独立页面。
4. **复用 VS Code**：文件选择、编辑器、Diff、终端、SCM、Problems 等使用 VS Code 原生能力，不在 Webview 内造一个假的编辑器。
5. **不可逆操作必须显式**：特别是权限执行、历史回退和文件恢复，不使用含糊按钮或危险默认值。
6. **渐进披露**：工具日志、推理过程、Mission Worker、原始输出默认折叠，需要时再展开。

## 3. 总体信息架构

### 3.1 主入口

- Activity Bar 中提供 DroidVisX 图标，用于打开或聚焦界面。
- 主聊天以完整的 VS Code Editor Tab 打开，避免侧边栏宽度不足。
- 可后续增加一个轻量 Side Bar，只显示当前任务状态与最近会话，不承载完整聊天。

### 3.2 主聊天页面

页面从上到下只有四层：

```text
顶部栏：会话标题 / 新会话 / 历史 / 更多
消息流：用户、助手、工具、计划、权限和变更
阻塞决策条：AskUser / 权限 / Spec 审批（仅需要时出现）
Composer：上下文标签 / 输入 / 当前运行状态 / 发送
```

不常驻左侧 Session 列表。点击顶部历史按钮打开浮层，包含搜索、重命名、归档、时间分组和分支关系；需要管理大量会话时，再进入完整 Sessions 页面。

## 4. 视觉与消息流

整体接近 Cursor 和 Codex：使用 VS Code 主题变量，暗色下保持低对比边框，避免独立 SaaS 控制台的卡片感。

- 用户消息使用很轻的圆角背景块，可被直接点击进入编辑状态。
- 助手回答使用自然文档流，不套大卡片。
- `Worked for`、`Thought for` 等运行信息为可折叠的小标题。
- Tool Call 默认是一行紧凑状态：图标、工具名、目标、耗时、结果；点击后展开参数和输出。
- 代码块提供复制、应用、打开文件等与内容相关的操作。
- 每轮结束展示紧凑的 Changes 摘要，点击后打开 VS Code 原生 Diff。
- Mission 在聊天中只显示阶段、里程碑、阻塞和结果；Worker 详情进入 Mission Control。

只有与内容直接相关的操作才在 Hover 时出现。历史用户消息旁不显示 `Edit / Fork / Copy` 这类操作栏。

## 5. Composer：建议方案

### 5.1 常驻结构

```text
[已附加文件] [当前选区] [已选择 Skill] [异常状态]
┌─────────────────────────────────────────────────────────┐
│ 输入内容；支持 @、/ 和多行                               │
│                                                         │
│ ＋  [模式 ▾] [Autonomy ▾] [模型 · 推理 ▾]  [上下文环] [发送] │
└─────────────────────────────────────────────────────────┘
```

常驻项只保留：

- `＋`：添加本次请求需要的内容或打开常用动作。
- 模式：由 Droid 动态返回。设计稿可暂标 `Auto / Spec / Mission`；若当前 SDK/CLI 使用 `Normal`，则原样展示 `Normal`，不自行改名。
- Autonomy：与模式分离，展示 Droid 当前允许的等级，例如 `Off / Low / Medium / High`。
- 模型与推理强度：合并成一个紧凑入口，显示当前值。
- Context 使用量：默认只显示环形状态，Hover 或点击查看明细。
- 发送/停止：运行中同一位置切换为 Stop。

模式和 Autonomy 必须分开：Spec 是工作方式，High 是执行权限，二者不是同一维度。

### 5.2 `＋` 动作面板

借鉴 Claude 的可搜索动作面板，但分类和内容由 Droid 与 VS Code 能力共同提供：

```text
搜索动作…

上下文
  Attach file…
  Mention project file…
  Current selection
  Open editors
  Problems
  Git changes
  Terminal output

Droid 能力
  Skills…
  Commands…
  MCP status & tools…
  Custom Droids…

会话
  New session
  Compact context
  Fork session
  Rewind…

运行
  Switch model…
  Reasoning effort…
  Autonomy…

管理
  Manage Droid…
```

菜单应支持搜索、最近使用和键盘导航。不可用的能力不放灰色占位；尚未安装、未连接或被组织策略禁止时，给出明确状态和解决入口。

### 5.3 `＋`、`@` 与 `/` 的职责

- `＋`：面向鼠标，添加上下文和进入常用动作。
- `@`：快速引用文件、目录、Symbol、诊断或其它可引用对象。
- `/`：面向键盘，搜索并调用完整的 Droid Skills、Commands、Custom Droids 和会话命令。

三者共享同一个动态能力目录和执行层，不能各写一套硬编码菜单。

### 5.4 Skill、MCP、Plugin 放在哪里

**Skill 可以从底部选择，但不永久占一个按钮。** 通过 `＋` 或 `/` 选择后，它以输入区上方的小标签显示；如果 Droid 的真实调用方式要求插入命令，则 UI 插入真实命令而不是制造一个前端状态。

**MCP 不应被当作附件。** 底部只展示连接异常、显式启用的服务器或当前会话限定的工具集。服务器、认证、工具清单与开关放在 `Manage Droid → MCP`。

**Plugins、Marketplaces、Hooks、Custom Models 不常驻 Composer。** 这些是管理能力，统一放进 `Manage Droid` 专页；只有其产生的 Skill、Command 或状态进入聊天入口。

由此得到的原则是：

> Composer 展示“我这一条消息正在使用什么”，Manage Droid 管理“Droid 总共拥有什么”。

## 6. 点击历史消息重新发送

这是核心体验，直接采用 Cursor 式就地编辑，不显示 `Edit / Fork / Copy`。

### 6.1 进入编辑

1. 单击历史用户消息的空白区域。
2. 该消息原地替换为与底部完全相同的 Composer 组件。
3. 恢复当时的文字、附件、上下文引用、模式、模型、推理强度和 Autonomy。
4. 底部 Composer 暂时隐藏，目标消息之后的对话降低透明度。
5. `Esc` 取消；点击外部只收起未修改的草稿。已经修改过的长文本先保存在本地草稿中，再提示用户继续编辑或放弃。

选中文字、点击链接、点击附件或代码时不能误触编辑。Agent 正在生成时，需先 Stop 并确认本轮已终止。

DroidVisX 需要为自己发出的每一轮保存一个轻量 `turn envelope`，至少包括：消息 ID、文字、附件引用、上下文引用、模式、模型、推理强度、Autonomy、工作区标识和发送时间。不能假设 Droid 的每条历史消息天然包含全部 UI 状态。对于从 CLI 或其它客户端创建的旧 Session，缺失字段使用当前值，并在 Composer 中提示“部分原始设置不可恢复”。

### 6.2 发送语义

点击旧消息本身只创建草稿。用户再次发送时才执行：

```text
读取 rewind 影响范围
      ↓
无文件变化 ─────────────→ rewind + resend
      ↓ 有文件变化
显示安全选择
  A. 仅从该消息重建对话，保留当前工作区
  B. 同时恢复该轮之后由 Droid 产生的文件变化
      ↓
创建新的后继 Session / 分支并发送
```

文件发生变化时，必须先展示具体文件清单和可检查的 Diff，并检测：

- VS Code 中尚未保存的编辑；
- 当前文件哈希与 Droid 当时记录是否一致；
- 后续由用户或其它工具造成的修改；
- 文件已删除、重命名或产生冲突。

存在冲突时允许逐文件选择，不提供“一键覆盖当前工作区”的危险默认。两个顶层选项都不预选，用户必须明确决定；无法安全自动恢复的文件只允许打开 Diff 后手动处理。UI 只有在新 Session 成功后才切换；失败时恢复旧消息流。原 Session 永不直接删除，可从历史中的分支关系返回。

产品文案可使用“从这里重新开始”，但内部实现必须服从 Droid SDK 的 `getRewindInfo` 和 `rewind` 语义。

### 6.3 为什么不放 Edit / Fork / Copy

- `Edit` 已由点击消息直接表达，多一个按钮没有价值。
- `Fork` 是发送后的实际结果，不需要用户先理解版本控制术语。
- 文本选择和系统复制已经足够；内容操作不应干扰主流程。

高级用户仍可在会话动作面板中显式使用 Fork。

## 7. Droid 能力应该出现在哪里

| Droid 能力 | 主 UI 位置 | 表现方式 |
|---|---|---|
| 模式（Auto/Normal、Spec、Mission） | Composer | 动态下拉，不硬编码可用项 |
| Autonomy / 权限等级 | Composer | 独立状态选择器，受组织策略限制 |
| 模型 / Reasoning | Composer、动作面板 | 当前值常驻，完整列表搜索选择 |
| Files / Selection / Problems / Git / Terminal context | `＋`、`@` | 生成可移除的上下文标签 |
| Skills / Commands / Custom Droids | `＋`、`/` | 可搜索、最近使用、选中后显示标签或命令 |
| MCP tools | 工具调用行 | 由 Droid 调用；连接与工具管理进入专页 |
| Permissions | Composer 上方 | 阻塞决策条，按钮严格使用 Droid 返回的 outcomes |
| AskUser | 消息流末端 | 原生问题控件，回答后继续同一轮 |
| Spec | 消息流 | 文档式计划 + 审批条，不做大表格 |
| Mission | 消息流、Mission Control | 聊天显示摘要，专页显示 Worker 和里程碑 |
| Session / Search / Archive | 顶部历史浮层 | 搜索、重命名、归档、继续 |
| Fork / Rewind / Compact | 历史消息、动作面板 | 常用交互自然化，高级命令仍可搜索 |
| Tool calls | 消息流 | 紧凑状态行，按需展开原始详情 |
| File changes | 轮次末尾、Changes | 摘要 + VS Code 原生 Diff |
| Plugins / Marketplaces / Hooks | Manage Droid | 安装、更新、启用、错误和来源管理 |
| Automations / Custom Models | 独立专页 | 后续版本，不挤进聊天主流程 |

### 7.1 扩展能力目录

“全部都有”通过完整能力目录和渐进式入口实现，不等于都放进聊天底栏。进入开发前，需要把当前 Droid 版本的能力扫描成可维护矩阵；初始归属如下：

| 能力族 | 产品位置 | 计划阶段 | 接入说明 |
|---|---|---|---|
| Session favorite / rename / archive / share | 历史浮层、Sessions | V1 | daemon/官方接口可用项动态出现；分享受账户与组织策略控制 |
| Session cost / token / status | 历史项、会话详情 | MVP/V1 | MVP 先显示上下文和运行状态，费用字段存在时再显示 |
| Tool 启停与限定 | Manage Droid、会话动作 | V1 | 不在 Composer 常驻；运行时发现可配置范围 |
| MCP server / tool / resource / prompt | Manage Droid、动作面板 | V1 | 管理与调用分离，认证失败显示诊断 |
| Skills / Commands / Custom Droids | 动作面板、Manage Droid | V1 | `/` 与 `＋` 共用目录 |
| Plugins / Marketplaces | Manage Droid | V2 | 安装来源、版本、更新和启用状态 |
| Hooks | Manage Droid | V2 | 若 SDK 无注册 API，则通过官方 CLI 或配置文件适配，不假设存在 SDK 管理接口 |
| Worktree / workspace isolation | 会话创建、Sessions | V2 | 显示真实目录与清理状态，删除前显式确认 |
| Background processes / terminals | 运行状态、VS Code Terminal | V1/V2 | 进程由 Extension Host 跟踪，交互进入原生终端 |
| Git / commit / PR | Changes、SCM | V2 | 优先调用 VS Code SCM 与官方 Droid 能力 |
| Account / usage / organization policy | Settings | V1/V2 | 只读展示有效策略，不允许 UI 绕过上限 |
| Feedback / diagnostics / logs | Help & Diagnostics | V1 | 导出前预览并脱敏 |
| Automations | 独立 Automations 页 | V2 | 与普通 Session 分离，展示触发器和最近运行 |

每次适配新 Droid 版本时，矩阵应记录：`运行时是否存在 / daemon 或 subprocess / SDK、CLI 或配置文件接入 / 所属版本 / 降级行为`。这会成为功能完整性的验收依据。

## 8. 关键页面与状态

### 8.1 首次使用

- 检测 Droid 是否安装、版本是否满足 SDK 要求。
- 检测登录状态和工作区信任。
- 逐项给出安装、登录或升级动作，不使用空白页。
- 展示清楚：DroidVisX 使用本机 Droid，权限与组织策略仍然有效。

### 8.2 空会话

页面中心只保留一个简洁标题和少量建议，不做功能卡片墙。Composer 仍是视觉重心。

### 8.3 生成中

- 流式输出正文。
- 展示当前阶段、耗时和 Stop。
- Tool、Thinking、搜索和文件操作以紧凑行更新。
- 页面在用户主动向上滚动后停止自动吸底。

### 8.4 权限与 AskUser

权限请求固定在 Composer 上方，保证用户总能看见当前阻塞原因。允许选项完全由 Droid 返回；若包含“本次允许”“本会话允许”等语义，原样解释其作用域。

### 8.5 Spec

计划作为消息正文的一部分，支持折叠章节。审批区域只显示当前真正可用的继续方式，审批后回到普通执行流。

### 8.6 Changes 与 Diff

聊天中只列文件名、增删行数和状态。点击文件后调用 `vscode.diff` 打开原生编辑器；批量审查进入 Changes 页面。不要在聊天卡片里重新实现完整 Diff。

### 8.7 异常与恢复

至少覆盖：Droid 未安装、未登录、daemon 断开、Session 恢复失败、MCP 失联、上下文超限、组织策略禁止、工具调用失败和文件冲突。错误必须给出可执行的下一步，并保留用户尚未发送的草稿。

## 9. 页面分层

### 主聊天层

日常 80% 的使用：聊天、上下文、模式、模型、推理、权限、AskUser、计划、工具和文件变化。

### 浮层

历史会话、动作搜索、模型选择、上下文选择和快捷命令。操作完成即关闭，不改变页面布局。

### 专页

- Sessions：大量会话、搜索、归档、分支关系。
- Mission Control：任务、Worker、阶段、阻塞和结果。
- Changes：跨轮次文件变化和审查状态。
- Manage Droid：Skills、MCP、Plugins、Marketplaces、Hooks、Custom Droids、Custom Models。
- Settings：Droid 路径、默认模型、默认模式、显示偏好、诊断和账户入口。

## 10. 版本范围

### MVP：先让主聊天真正可用

- Droid 安装、版本、登录和连接检测。
- Auto/Normal 与 Spec；Mission 入口在运行时不可用时不展示。
- 流式聊天、Stop、Tool 状态和错误恢复。
- 统一 Composer；模型、推理、Autonomy 动态发现。
- 文件、当前选区、Problems、Git 变更等上下文。
- 权限请求与 AskUser。
- 点击历史用户消息，使用 Droid rewind 完成重新发送。
- Session 新建、继续、搜索和切换。
- Changes 摘要与 VS Code 原生 Diff。

MVP 实施再拆成四个可独立验收的切片：

1. 连接检测、daemon 生命周期与流式聊天。
2. Composer、上下文、权限与 AskUser。
3. Session、`turn envelope`、历史编辑与 rewind。
4. 文件变化、安全恢复与原生 Diff。

### V1：补齐 Droid 的日常高级能力

- Skills、Commands、MCP 的完整入口和状态管理。
- 动态 Slash Commands 与最近使用。
- Fork、Compact、归档和 Session 分支关系。
- 完整 Spec 审批与执行交接。
- Mission 启动、阶段进度和基础 Worker 摘要。
- 图片、文档和更丰富的上下文来源。

### V2：完整工作台

- 完整 Mission Control。
- Custom Droids、Plugins、Marketplaces、Hooks。
- Automations、Custom Models 和组织策略管理。
- 更完整的 Git、PR、终端和远程环境工作流。
- 高级 Session/工作树可视化与跨设备能力（取决于 Droid 官方接口）。

版本划分只决定何时实现，不代表隐藏真实已支持能力。如果 Droid 运行时没有某能力，则 UI 不制造模拟入口。

## 11. 视觉原型计划

在本规格确认后再生成图片，每张图片只表达一个界面或状态，不再使用四宫格：

```text
design/ui-concepts/round-01/
  01-main-chat.png
  02-action-palette.png
  03-edit-and-resend.png
  04-permission-request.png
  05-spec-review.png
  06-session-history.png
  07-mission-progress.png
  08-manage-droid.png
```

第一轮优先生成前三张：主聊天、Claude 式动作面板、历史消息就地重发。三张使用同一套 Cursor/Codex 风格视觉系统，便于判断产品是否成立，而不是比较三个无关风格。

## 12. 开发边界与复用原则

- 后端桥优先使用官方 [`@factory/droid-sdk`](https://github.com/Factory-AI/droid-sdk-typescript)，不解析 Droid TUI 屏幕文本。
- 可参考 [`vscode-acp`](https://github.com/formulahendry/vscode-acp) 的 VS Code 进程与协议桥接方式。
- Cline、Continue 等项目只用于研究 Tool、审批、Diff、Mention 等交互，不复制其 Agent Runtime。
- 官方 Factory VS Code 扩展可作为安装检测、终端上下文和编辑器集成参考，但 DroidVisX 的目标是完整 Chat UI。
- 任何借用代码在进入实现前单独核查许可证与 attribution；无清晰许可证的代码不复制。

## 13. 已确定的产品决策

1. 主界面选择 Cursor/Codex 式聊天，不选择 Mission Control 仪表盘作为首页。
2. Skill、MCP 等能力可以从底部进入，但不永久挤占 Composer。
3. `＋` 与 `/` 使用统一动态能力目录，动作面板借鉴 Claude。
4. 点击旧用户消息直接原地变成 Composer，没有 Edit/Fork/Copy 菜单。
5. 发送旧消息使用 Droid 原生 rewind，并保留原分支。
6. 涉及历史文件变化时不默认回滚，必须显式选择。
7. Diff、文件、终端和 SCM 优先复用 VS Code 原生界面。
8. 所有能力名称和可用状态服从 Droid 运行时，设计稿只是表达布局。

## 14. 原型前需要重点确认的三处

1. Composer 的常驻密度是否合适：模式、Autonomy、模型/推理是否都应直接可见。
2. 历史消息重发遇到文件变化时，安全选择的文案是否足够直观。
3. `Manage Droid` 是否应在 V1 就包含 Plugin/Marketplace，还是先只做 Skills 与 MCP。
