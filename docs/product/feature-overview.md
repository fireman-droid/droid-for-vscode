# DroidVisX 功能总览

> 本文介绍 DroidVisX **当前已实现并可使用**的功能，面向想了解"它现在能做什么"的读者。
>
> 版本：v0.7.9（更新于 2026-08-14；以 `package.json` 与功能台账为准）
>
> 能力状态（生产已接通 / 部分完成 / 仅探测 / 未实现）的权威台账见
> [`implementation-status.md`](./implementation-status.md)；本文只覆盖前三类，未实现的路线图项一律不写。

## 总览

DroidVisX 是一个 VS Code / Cursor 扩展，为 Factory **Droid CLI/SDK** 提供一个安全的图形聊天界面。核心理念：

- **Droid CLI/SDK 是唯一的运行时权威**。会话、模型、工具、权限、认证全部来自本机 Droid；界面绝不发明 Droid 没有的能力，数据拿不到时宁可显示 Unavailable（fail-closed），也不伪造。
- **分层与安全边界**。Runtime（Droid SDK 适配）、Extension Host、共享 Bridge、Webview 四层之间的每条消息都经过双侧严格校验；命令原始输出、凭据、OAuth URL、子会话 ID 等敏感内容不进入 Webview。
- **安静的视觉语言**。暖色中性底、细边框、软阴影、克制的文字入口；动画只属于"正在发生的事"。

主要交互面是一个 Webview 聊天视图（推荐放在 Cursor 的 Secondary Sidebar），包含 Header（连接状态、Mission 注记、New session、会话历史抽屉）、消息转录区和 Composer 输入区。

## 目录

1. [界面形态与安全模型](#1-界面形态与安全模型)
2. [会话与流式输出](#2-会话与流式输出)
3. [工具活动与权限审批](#3-工具活动与权限审批)
4. [计划与任务（TodoWrite）](#4-计划与任务todowrite)
5. [消息与富内容渲染](#5-消息与富内容渲染)
6. [Composer 与输入能力](#6-composer-与输入能力)
7. [会话管理](#7-会话管理)
8. [运行模式与可靠性](#8-运行模式与可靠性)
9. [模型与设置](#9-模型与设置)
10. [MCP、Skills 与扩展能力](#10-mcpskills-与扩展能力)
11. [子代理与 Mission](#11-子代理与-mission)
12. [IDE 集成](#12-ide-集成)
13. [诊断与可观测性](#13-诊断与可观测性)
14. [探测中能力（非用户可用功能）](#14-探测中能力非用户可用功能)

## 1. 界面形态与安全模型

**入口**。扩展在 Activity Bar 注册 "DroidVisX" 视图容器（可拖入 Secondary Sidebar 使用，这是本项目的主用形态）；命令面板 `DroidVisX: Open Chat` 直接聚焦聊天视图。
*当前限制（部分完成）*：contributes 仍是 Activity Bar Webview，"Secondary Sidebar 为默认落位"尚未内置，需要用户手动拖放一次。

**工作区边界**。没有打开工作区、或工作区未被 VS Code 信任时，Runtime 不会启动；工作区或信任状态变化时旧 Runtime 会被关闭，旧 Runtime/Session/Turn 的迟到事件一律拒绝。
*当前限制（部分完成）*：多根工作区只使用 `workspaceFolders[0]`，没有选择器。

**安全模型**（贯穿全部功能）：

- Webview ↔ Host 双向消息全部经过严格校验（exact-key、长度、枚举、越界拒收），非法消息整条拒绝；
- Webview Bundle 不包含 Droid SDK 或任何 Runtime 代码；CSP 禁止 Webview 发起网络连接；
- Markdown 渲染禁止原始 HTML 和非 HTTP(S) 链接；
- 命令原始参数/输出、文件内容、凭据、MCP OAuth URL、子代理会话 ID 等只在 Host/Runtime 流转，不过桥。

## 2. 会话与流式输出

**基础文本聊天**。新建或恢复 Droid Session 后发送纯文本消息，助手回复逐 token 流式输出（assistant-ui 平滑提交，无大块闪跳）：

- Stop 按钮中断当前回合；发送后自动滚到底部；
- 回合运行期间界面持续显示真实工作状态，即使 Droid 长时间不发可选的进度事件也不会显得"死了"；
- 空闲时 Enter 发送、Shift+Enter 换行；回合运行中 Enter 会把消息排入队列（见 §6.5）；
- Composer 草稿在 Webview 重建后保留。

**Thinking 思考过程**。Droid 的思考内容以可折叠行流式呈现：

- 每行独立展开/收起；完成后行内显示 SDK 报告的真实思考耗时；
- think→tool→think 交错回合按 SDK 段身份拆成多个独立 Thinking 行，各自计自己的耗时；已完成的段不会被后续增量"复活"；
- Thinking、工具与正文保留真实事件顺序，不会把后续正文合并回最早的文本段。

**助手消息操作条**。每条助手回复带悬浮操作条（较早消息 hover 淡入，最后一条常显；流式中不显示）：

- 细字相对时间：仅对本窗口亲见完成的回合显示，不伪造历史消息的时间；
- **Copy**：复制该回复；同一回合被 AskUser/审批切成多段回复时，操作条只出现在末段，Copy 复制整回合拼接文本；
- **Regenerate**：仅最后一条回答；锚定其前一条用户消息，经 SDK Rewind 分支按原文重发；
- **Fork chat**：仅最后一条助手消息，且仅连接态、无活动回合、无待答交互时可用；SDK `forkSession` 只支持从会话当前态分叉，故不提供"从任意消息分叉"。

**阅读辅助**。转录距底部超过约 48px 时 Composer 上方浮现"回到底部"圆形箭头，点击回底并恢复自动跟随；上滑阅读时内容增长不会把视口拽回底部。长会话默认只渲染尾部约 60 条消息，顶部提供 "Show earlier messages" 分批展开；高频流式消息按动画帧合批渲染，保证长会话不卡顿。

## 3. 工具活动与权限审批

**工具活动行**。每次工具调用渲染为一行安静的活动行：语义动作主标签（如 "Read workspace files"）、生命周期状态（运行中 shimmer 动画，完成/失败静态），同回合内实时观察到起止时显示真实耗时（历史数据不伪造耗时）；失败行以危险色标注。进度计数与更新类别只在真实收到 SDK 可选进度事件时显示，没有进度事件时只显示真实生命周期，不伪造"缺少进度"告警。文件修改类工具（Edit/Create/Write/ApplyPatch，含从 patch 文本提取多文件路径）在行内显示工作区相对路径 chip，点击打开原生 Diff（见 §12.3）。普通工具行采用 quiet ruled 形态：小标记点 + 过去时动词 + 等宽对象名，低频动作（Preview 等）hover 才浮现。
*当前限制（部分完成）*：工具行不展示原始参数与完整结果（Execute 命令与输出、计划清单、路径等结构化摘要除外），也没有逐工具的 Apply/Open 操作。

**探索聚合与跑马灯**。连续的只读探索类工具聚合为一组，收起态在头部行下方以"垂直跑马灯"轮播当前活跃的一条子行（旧行上滑渐隐、新行下方淡入，280ms/26px，打断接续不重置；reduced-motion 直接替换），全部完成后收起态只留头部行，点击展开完整列表。

**命令卡与实时输出**。Execute/Bash 类工具升级为命令卡：

- 卡头一行：命令摘要标题（优先用模型自带 summary，否则规则提取命令名，绝不发明数据）+ 等宽命令名芯片（≤4 个）+ "…" 菜单（Copy Command）；
- 展开区是主题化"终端井"（浅色暖白井 / 暗色深井），`$` 前缀 + 规则分词语法高亮，失败时摘录退出码；
- 运行中卡片自动展开实时输出预览窗：有界尾部快照，自动钉底、上滚解钉、回底重钉；ANSI 剥离、凭据扫除、8K 尾部截断；完成后定格最终尾部并自动收起（用户手动开合一次即接管）；
- 历史回放与恢复检查点从不携带命令输出（敏感输出不落盘、不重播）；
- 展开区提供 "在终端中查看" 入口打开只读终端镜像（见 §12.7）。

**后台进程提示**。CLI 把命令标记为 `fireAndForget: true`（真实后台化）时，活动行下出现一行细字 "Background process · Keeps running until you stop it manually"。GUI 没有进程句柄，刻意不提供假的 kill 按钮（fail-closed）。

**权限请求**。Droid 请求授权时，转录内出现扁平内联审批块（非弹窗、非浮层）：

- 有界的标题、详情与风险说明，投影 SDK 返回的**真实**权限选项；覆盖 Edit、Execute、Create、Patch、MCP Tool、Sandbox、Spec、Mission 等确认类别；
- 拒绝与主要允许操作始终可见；Session/Always Allow 等额外范围只在 SDK 真实提供时进入 Split Button 菜单（不提供 SDK 没有的"全局/永久允许"）；
- 请求与精确的 Workspace/Session/Turn/Runtime 世代绑定，过期或非法响应安全取消，不会重复响应；
- 权限详情可以显示原始文本或 Patch；待处理审批期间 Composer 附件与控件不被禁用。

**AskUser 问答**。Droid 主动提问时支持单选、多选、无预设选项的开放文本问题与自定义答案，可一次处理多个问题，Submit/Cancel 按原问题索引精确回传；Factory 问卷标记文本（字面 `\n`、`[topic]`、`[option]`）会被格式化为可读问卷并转为开放文本回答。

## 4. 计划与任务（TodoWrite）

**计划细条**。Droid 用 TodoWrite 建立任务计划时，触发该回合的用户消息下方出现一条细计划条（无边框底色、6px 状态点 + 动态标题 + `n/m` 计数 + chevron）：

- **动态标题**：显示当前 `in_progress` 步；更新间隙显示下一个 pending 步；全部完成后显示最后一步。TodoWrite 数据面没有标题字段，界面不用 LLM 编造标题（短板与修复路径见 `plan-title-limitation.md`）。
- **展开清单**：每步一个圈圈——未到空心、当前实心橙点（呼吸微光，运行中唯一动画）、已完成实心灰 + 白勾。构建期（回合运行且未全完成）清单自动展开、逐步打钩可见，完成后自动收起；用户手动开合永远优先。
- **暂时吸顶**：随所属用户消息一起吸附在视口顶部（加可读性底盘），吸顶时展开为浮层不挤压布局；下一条用户消息自然接管。
- **原地更新**：同一计划谱系的后续 TodoWrite 原地更新这一条（步骤文本有交集即视为同谱系），完全不相交的新清单另开一条；live 与历史回放同构。
- 转录中的 TodoWrite 工具行本身不再重复渲染（计划条已承载同一清单）。

演进注：早期的 Composer 上方"计划钉条"（台账 §17）与消息流内 "Created Plan" 锚卡（§20）均已被本形态取代。

## 5. 消息与富内容渲染

**Markdown / GFM**。助手回复经安全 GFM Markdown 渲染（表格、列表、任务清单等），禁止原始 HTML 与非 HTTP(S) 链接；引用块为安静的灰 hairline + 次级墨色。消息中的工作区文件路径渲染为链接，点击在编辑器打开；工作区内的 `.html/.htm` 路径链接旁带 quiet "Preview" chip，点击打开沙箱预览（见 §12.6）。

**代码块**。highlight.js 语法高亮（暗色主题为 VS Code Dark+ 系配色）+ 独立复制按钮。```` ```html ```` 或以 `<!DOCTYPE`/`<html` 开头的代码块在工具条上提供 "Preview" 入口（消息流式中不显示；超过 512K 字符禁用并注明），点击在沙箱面板中渲染这段内联 HTML。

**Mermaid 图**。```` ```mermaid ```` 代码块渲染为图形：流式期间保持代码块形态，回合完成并平滑排空后再渲染；历史回放直接出图无动画；解析失败安静回退为代码块 + 一行细字提示。图容器沿用卡片语言、超宽时容器内横向滚动；提供 "View source / Hide source" 切换；点击进入全屏查看器（SVG 缩放拖拽）。渲染库为 3.3MB 独立懒加载包，首次需要时才注入，`securityLevel: 'strict'`。

**图片**。发送的图片在用户消息卡内显示 48px 缩略图（多图横排，历史回放中"图片在文本前"的 CLI 顺序会被正确收养到同一气泡）；助手/工具结果中的图片有界投影展示，超预算降级为占位行。点击任意图片打开 Lightbox（缩放、拖拽、双击复位、Reset 与 1:1 控件）。消息已含内联图片预览时不再重复渲染 IMAGE 附件 chip（其他类型 chips 保留）。

## 6. Composer 与输入能力

### 6.1 常驻控件

Composer 底部一排常驻控件：**`+` 设置面板**（"Session controls"，本地搜索 + 附件入口 + Mode/Autonomy/Theme + Skills/MCP/Plugins 视图）、**Mode 触发器**（Auto/Spec/Mission 一键切换弹层）、**Model 触发器**（当前模型 + 推理力度后缀）、**Context 圆环**（用量可信时显示百分比）。流式期间面板仍可打开、设置仍可更新；待处理审批/问答与会话替换期间阻止写入。

### 6.2 附件

`+` 面板与 `@` 提及提供多路附件源，暂存为 Composer chips（种类徽标、名称、truncated 徽标、× 移除），上限 8 个；附件内容只留在 Host/Runtime，Webview 只见元数据。发送时投影为 SDK 的 `images`/`files` 并清空暂存；Rewind、Compact、切换会话会丢弃暂存附件。已发送消息回显附件 chips（图片显示缩略图）。

| 附件源 | 入口 | 边界 |
| --- | --- | --- |
| 文件对话框 | `+` → Attach files… | 图片 jpg/png/gif/webp ≤4MB；PDF ≤6MB；文本 ≤256K 字符（超长截断、二进制拒绝） |
| 活动编辑器 | `+` → Attach active editor | 捕获为文本附件 |
| 编辑器选区 | `+` → Attach selection；或编辑器右键（§12.2） | 名称带行号范围；payload 为带 `起:迄:相对路径` 头的代码块 |
| Problems | `+` → Attach problems | 工作区诊断文本，≤200 条超出截断 |
| Git changes | `+` → Attach git changes | `git diff HEAD` 未提交差异文本 |
| `@` 文件提及 | 输入 `@` | 防抖搜索工作区文件（排除 node_modules/.git/dist/out）；空查询列出打开的编辑器标签页（≤20）；选中即按相对路径附加，文本保留 `@相对路径` |

### 6.3 `/` 斜杠命令

行首输入 `/` 弹出命令列表（本地过滤、键盘导航、高亮跟滚）：

- **自定义 Droid Commands**：来自 SDK `droid.list_commands` 的用户自定义命令（shell 可执行命令与 CLI 内置命令不在列），选中补全 `/name ` 不自动发送，发送后由 CLI 后端展开模板与 `$ARGUMENTS`；最近使用的 8 条持久化置顶。
- **内置组**：

| 命令 | 行为 |
| --- | --- |
| `/btw <问题>` | 打开侧问面板并立即提问（见 §6.4） |
| `/compress` | 等价 Context 面板的 Compact conversation |
| `/clear`、`/handoff` | 新建会话 |
| `/model` `/mcp` `/skills` `/sessions` `/context` | 打开对应弹层/面板/抽屉 |

### 6.4 /btw 侧聊

`/btw <问题>`（或选中 `/` 弹窗中的 `/btw` 行）在聊天右侧分出一块共生的 Side question 栏（双栏布局，非抽屉遮罩；两栏同时可交互、各自滚动；窄视口也保持分栏）：

- 在其中提问得到流式 Markdown 答案，可同卡连续追问；主回合流式期间照常可用；
- 技术上它是 CLI 原生 btw 语义的**隐藏 fork**（落在 `sessions/btw/`，不进任何会话列表、不产生主转录行；也没有把侧聊内容"升格"进主会话的通道）；
- fork 内的工具权限请求一律拒绝并提示"去主聊天问"（deny-all）；
- 流式中输入框可继续打字，Enter 在 Host 权威状态里保留**至多一个**
  待发追问；再次 Enter 替换它，侧栏以 quiet "Next" 行显示最新内容，
  当前答案正常完成或报错后自动发送。发送键同时变为 ■ Stop；Stop
  会清掉按下时已有的待发项，部分答案按完成收尾、不标失败；
- 关闭（×/Esc/切换会话）即弃 fork；daemon 与 process 两种运行模式均可用。

### 6.5 回合运行中排队消息

回合运行中 Composer 不禁用：Enter 直接把消息送进 FIFO 队列（上限 10 条，满员时发送禁用并提示）。Composer 上方出现收纳条："N Queued · ⏎ to Send" 收起头，点击展开逐条显示，行内三键：

- 铅笔 = **编辑回 Composer**：文本装回输入框，Enter 原位替换保存 / Esc 取消；编辑期间附件留在队列条目上原样保留，保存只替换文本；
- ↑ = **立即发送**：运行中只重排到队首不打断（运行时协议不支持回合中注入）；暂停态下兼作恢复，空闲立即派发；
- 垃圾桶 = 删除该条。

派发规则：当前回合正常完成后队首自动派发为下一回合并链式排空；**Stop 或回合失败后队列转暂停**（绝不自动派发），展开区提供 Send now / Clear。边界：队列驻留 Host 内存，Reload 即失（条上有细字注明）；切换/新建会话、fork、compact 会丢弃队列并出诊断；有排队消息时编辑重发被阻断（互斥，提示先清队）。

### 6.6 编辑重发（Rewind 分支）

**单击**任意带 SDK Message ID 的历史用户消息卡（卡面提示 "Click to edit and resend from here"）原地展开编辑卡：

- 编辑卡 = 文本编辑区 + 可重发附件 chips（不可恢复的附件标注 "re-add to include"）+ 完整的第二实例 Composer 控件 + 圆形发送按钮；
- 点击卡外任意处或 Escape 即静默取消，无确认弹窗（卡内 Mode/Model 弹出层打开时，第一次外点只收弹出层）；
- 打开时自动经 SDK `getRewindInfo` 查询文件影响，有受影响文件时显示 "Restore N files changed after this point" 勾选项（默认不勾选，勾选后 Rewind 以 SDK 报告的清单恢复/删除文件，否则保持当前工作区不变）；
- Resend 经 SDK `session.rewind` 建立分支 Session、截断转录并以新文本重问；被拒绝（忙碌/不可锚定/失败）时以明确文案回到编辑态；
- 有活跃回合或待处理交互时 Resend 被拒绝。

*当前限制（部分完成）*：无 Rewind 冲突检测与 Turn Envelope；非图片附件在纯历史加载的会话里无法辨识，历史消息如实缺省附件 chips。
演进注：早期的用户消息 Copy/Reuse 操作条与"双击编辑"已撤下，单击卡片是当前唯一编辑入口。

## 7. 会话管理

**会话抽屉**。Header 的会话历史入口打开抽屉：列出当前工作区的本地 Session（标题、更新时间、消息数），按 Favorites/Recent 分组、组内最新排前；本地输入即时按标题/ID 过滤。点击记录立即切换并关闭抽屉直接回聊天；daemon 模式下正在后台运行回合的会话行带转圈指示。顶部 "New session" 新建会话。普通目录与 daemon 归档目录都只根据 Droid 的父会话字段、Session tags 或有界 settings sidecar 等权威元数据过滤子代理/Mission worker，会话标题不参与判定；元数据缺失时普通会话 fail-open 保留。

**生命周期操作**（行内按钮）：

- **Rename**：活跃会话行铅笔按钮，内联输入 Enter 提交（1–256 字符）。
- **Fork**：活跃行分叉按钮，SDK `session.fork` 复制整段对话为新 Session 并接管；原 Session 保留可切回。
- **Compact**：Context 面板 "Compact conversation"，SDK `session.compact()` 把较早消息总结进延续 Session 并就地接管，自动刷新 Context 用量。
- **Favorite**：任意行星标切换收藏；持久化到 CLI 私有 `~/.factory/sessions/.favorites`（非官方契约，文件损坏时拒写保护 CLI 数据）。
- **Archive / Unarchive**：非活跃行归档按钮（活跃 Session 拒绝归档）；抽屉底部 "Archived" 折叠区懒加载归档列表，行内 Restore 取消归档。经 daemon 通道实现。
- 运行中的回合、待处理交互或其他会话操作期间，替换型操作（Rewind/Compact/Fork）会被拒绝。

*当前限制（部分完成）*：Session **Delete** 无任何公开 API，保持不做（fail-closed）。

**内容搜索**。抽屉搜索框回车触发 daemon 全量内容搜索（≤20 条结果，显示标题/片段/时间）；本工作区的结果可点击切换，异工作区结果只读展示。
*当前限制（部分完成）*：无分页、排序与筛选。

**历史加载**。打开 CLI 创建的旧 Session 时经公开 `loadSession()` 投影用户文本、助手文本、Thinking、工具生命周期与三源图片；过滤隐藏/Hook/系统内容，超长截断；安全上限为末尾 10,000 条消息、20,000 个 Block、2,000 个可见条目、1,000,000 文本单元。
*当前限制（部分完成）*：Document 与未知 Block 类型会被省略并把该会话标记为 `partial`。

**恢复与对账**。选中会话与有界转录缓存持久化；Webview 刷新后恢复快照，未处理的权限交互一并恢复；Host 重启后把未完成活动归一为停止状态。启动时先推早期快照（秒级可见），权威数据就绪后整体替换。恢复旧会话时对公开 SDK 历史与本地缓存按用户消息锚点分段对齐：SDK 数据为权威主体，本地缓存只补 SDK 不再返回的前缀与 CLI 未持久化的尾段；时间线不完整时如实标记 `partial`/`truncated`，不把本地缓存冒充完整权威历史。

**Worktree 会话**。抽屉内 "New session in a worktree…"（仅 daemon 模式且 git 工作区时可见）经 daemon `sessions.create({ worktree: true })` 在独立 git worktree 中开新会话，适合并行任务互不踩工作区；分支由 daemon 自主命名（`<分支>-wt`），会话行标注 `worktree · <分支名>`，tooltip 显示完整路径。process 模式入口隐藏、请求 fail-closed。worktree 的清理（`git worktree remove`）不在当前范围。

**导出 Markdown**。命令面板 `DroidVisX: Export Session as Markdown` 把当前活动会话导出为 Markdown 文档（文档头含标题/Session ID/时间/工作区；Thinking 省略、工具折叠为一行、图片占位、附件按文件名列出；全文凭据扫除后经保存对话框落盘）。

## 8. 运行模式与可靠性

### 8.1 双模式与默认行为

设置项 `droidvisx.runtime.mode`（改动需 Reload Window）：

| 模式 | 行为 |
| --- | --- |
| `daemon`（默认） | 会话运行在共享的本地 `droid daemon` 连接上，**任务跨窗口 Reload 存活**。未显式设置时走 daemon 并在 daemon 起不来时**静默粘性回退**到 process（记一条 `runtime.mode.fallback` 诊断，不打断使用；显式选择永不回退）。daemon 起不来时首个会话建立约慢 1 分钟（端口等待 + 重试），之后正常 |
| `process` | 每个窗口自己的 droid 子进程（SDK ProcessTransport）；daemon 降级为归档/搜索等只读 sidecar |

用户不需要感知模式差异：聊天、权限、队列、Rewind/Compact/Fork、终端镜像、/btw、模型选择在两种模式下一致。差异仅在（均 fail-closed，不出假入口）：

- **daemon 独有**：任务跨 Reload 存活、Worktree 会话创建；
- **process 独有**：浏览器 MCP OAuth（daemon 门面无会话通知通道，MCP 面板的 list/启停/增删不受影响）、Spec 交接与子代理 started 的**实时**通知（daemon 下走降级路径：Spec 交接降级为可见 warning，子代理身份由工具输入直出）。

### 8.2 Reload 存活与重连对账

daemon 模式使用脱管共享 daemon（服务发现文件 `~/.droidvisx/daemon.json`）。并发窗口的会话租约在同级独占锁内完成整段 read-check-write，避免双方同时认领；死进程租约可抢占。并发拉起时只在拿到真实 pid 后原子独占发布发现记录，竞争者仅接纳 pid 存活且健康检查通过的赢家，并回收自己多起的副本。窗口 Reload 后：进行中的回合显示生成中占位，回合完成后自动以权威历史替换，待处理的权限请求重新弹出（逐 token 续流 SDK 无通道，不做）。

私有 daemon 在连接失败或窗口退出时只会在当前 pid 的命令行仍匹配预期可执行文件与精确 `daemon` 动词后回收进程树，避免 pid 被系统复用后误杀无关进程。命令面板 `DroidVisX: Shut Down Background Daemon` 是另一条手动共享-daemon 路径：当前仍直接信任发现文件中的 pid，不受上述私有生命周期身份校验保护。凭据只经公开 `readFactoryAccessCredential()` 读取并直传 SDK，不落盘、不进日志、不过桥。

### 8.3 连接诊断与 Retry

CLI 不存在、工作区无效/未信任、初始化失败时给出明确提示；Retry 关闭并重建/恢复 Runtime。
*当前限制（部分完成）*：Retry 不会重发失败的 prompt；没有登录状态展示、登录操作、版本兼容与账户界面。

## 9. 模型与设置

### 9.1 模型选择

Composer 的 Model 触发器（显示当前模型 + 灰色推理档位后缀）打开 Cursor 风格模型弹层（264px 单卡：搜索框、模型行单行截断、选中行细勾、hover 浮现铅笔）。列表**只显示 SDK 标记 `isCustom: true` 的 BYOK 模型**（目录来自会话初始化/加载响应；daemon 模式经 `settings.getDefaults()` 读同形目录）；当前会话若在用内置模型，触发器如实显示但不将其加入列表、不伪造其推理选项。目录缺失、超限或含未知值时 fail-closed 显示 Unavailable，绝不使用硬编码清单。铅笔打开 Effort 侧卡，推理力度只列所选模型真实声明的档位（含 `xhigh`、`max`）。点选后触发器标签立即乐观更新，以 SDK 回读结果对账（被拒绝则弹回）。

### 9.2 BYOK 自定义模型管理

模型弹层底部 "Add model…" 进入 Custom Models 面板：列出已配置的自定义模型，支持**创建、编辑、删除**（内联删除确认）。表单含 Provider 选择（含 `generic-chat-completion-api`；Bedrock 等高级字段只读提示）、密码型 API key 字段（编辑时留空 = 保留原值）。API key 明文只在保存消息中出现一次，状态回读经脱敏投影；保存/删除后自动刷新模型目录（会话空闲时经重载生效，忙碌时面板文案说明）。

### 9.3 Mode 与 Autonomy

Mode 触发器一键切换 **Auto / Spec / Mission**；Autonomy 在 `+` 设置面板内展开选择。流式期间可更新，以 SDK 回读的 Session Settings 为最终显示值；待处理审批/问答、重复更新与会话替换期间阻止写入。

### 9.4 Spec Mode（计划模式闭环）

Spec 态由 Composer placeholder（"Describe what to plan…"）与 Mode 触发器强调色表达。Droid 产出计划（`ExitSpecMode`）时：

- 计划以安全 GFM 渲染；长计划（>1,200 字符或 24 行）默认折叠预览 + "View full spec" 展开；计划文本上限 256K，超限截断显示而非静默取消审批；
- SDK 提供可编辑选项时可**编辑计划**（Edit/Preview 双视图实时预览）；操作遵循 Deny / Edit / Approve 层级，额外审批范围进 Split Button 菜单；
- 审批后 SDK 发 `settings_updated` 时 Host 重读权威 Settings，Mode 不会停留在旧 Spec 显示；`proceed_new_session*` 类批准后自动收养实施 Session（信号缺失时降级为可见 warning 提示从 History 打开，不静默）；
- Model 弹层在 Spec 模式提供 Session / Spec drafting 双 Scope，可为**起草**单独选模型与推理力度或重置回会话默认。

*当前限制（部分完成）*：完整的计划生命周期形态（超出上述闭环的部分）以 SDK 能力为准，尚未扩展。

### 9.5 Context 用量与 Compact

Context 圆环打开用量面板：**只有 `used`/`remaining`/`limit` 能构成可信窗口比例时才显示百分比**；SDK 报告值异常（如累计值超过模型上限）时显示原始报告量与 "Current window unavailable"，不把累计/压缩统计误报成百分比（fail-closed）。刷新失败保留最后确认值并提供 Retry。面板底部 "Compact conversation" 触发会话压缩（§7）。
*当前限制（部分完成）*：正确的 Last-call 当前窗口 Meter（基于最新 Provider Call 的 token 用量）已取证但尚未接入，接入前保持 Unavailable 降级；Context 分类明细未做语义确认。

### 9.6 Token 用量

Context 面板内 "Token usage" 账目显示 SDK 真实提供的五项分解（Input / Output / Cache read / Cache write / Thinking），双列 Last turn / Session 累计；Credits 行仅在 >0 时出现。SDK 全程无 USD 成本字段，界面不显示金额、不做本地单价换算；历史会话只有累计值，面板注明 "Per-turn detail appears after the next completed turn."；无任何数据时整段不渲染。

### 9.7 主题

设置项 `droidvisx.theme`（auto/light/dark，默认 auto）或 `+` 设置面板内 Theme 下拉，切换即时生效不需 Reload：暖白浅色主题与炭黑暗色主题（Cursor 灰阶、品牌橙退场、代码高亮切 Dark+ 系）；Auto 跟随编辑器主题自动切换。首帧背景按启动主题内联，避免白闪。已知边界：文件/HTML 预览面板是独立 Webview，暂未随主题切换（保持暖白）。

### 9.8 设置项清单

| 设置项 | 取值（默认） | 说明 |
| --- | --- | --- |
| `droidvisx.runtime.mode` | `process` \| `daemon`（`daemon`） | 运行模式，改动需 Reload Window；未显式设置时 daemon 失败静默回退 process，显式选择永不回退 |
| `droidvisx.theme` | `auto` \| `light` \| `dark`（`auto`） | 面板配色，立即生效 |

## 10. MCP、Skills 与扩展能力

**Skills 浏览与启停**。`+` 面板 Skills 行进入真实技能列表（SDK `listSkills`），逐项开关启停（`setSkillDisabled`）；只投影安全字段（名称、描述、位置、启用态），不投影文件路径与内容；刷新期间保留旧列表并禁用开关。

**MCP 服务器面板**。`+` 面板 MCP servers 行进入服务器列表（SDK `listMcpServers`/`listMcpTools` 按服务器分组）：

- 状态圆点（connected/connecting/failed/disabled）、needs auth 徽标；工具列表可展开，带 read-only/off 徽标；
- **启停**：`toggleMcpServer`（user 设置级）；
- **添加/移除**：面板头部 Add 展开内联表单（名称 + stdio/http/sse 类型 + 命令行或 URL，双侧校验）；每行两段式 Remove/Confirm remove（4 秒未确认复位）；
- **浏览器认证**：needs auth 的服务器行提供 "Authenticate in browser"，经 SDK 发起 OAuth 并打开系统浏览器，同一时间只允许一个认证流、Host 等待 2 分钟后超时，成功后自动刷新目录。OAuth URL 只在 Host/Runtime 流转，不进 Webview。**daemon 模式下浏览器 OAuth 刻意 fail-closed 不可用**（daemon 门面无通知通道；列表/启停/增删不受影响）；
- Host 最多等待每个 MCP RPC 30 秒，超时后面板进入正常失败/重试路径；
  Droid SDK 目前没有 `AbortSignal`，因此底层 RPC 不会被取消，仍可能占用
  daemon 槽直到返回或断线。迟到的 resolve/reject 已被放弃，且所有消费者
  在投影前重验 runtime、generation、session 与 cwd，不会让旧结果改写当前面板。

**Plugins 只读面板**。`+` 设置面板 Plugins 分区列出已安装插件（id + scope 徽记 + 版本哈希 + Active/Off 只读状态）与 marketplace 计数，尾注 "Manage plugins with the droid CLI"；daemon 不可用/未登录时显式 error 态（含登录指引），不静默空列表。安装/卸载/启停写操作不在当前范围。

**自定义 Droid Commands**。见 §6.3——`/` 弹窗中的用户自定义命令目录即来自 CLI/SDK。

## 11. 子代理与 Mission

**委派摘要行**。Droid 经 Task 工具委派子代理时，工具行下挂一条一级缩进摘要行：

- 「Delegated to `<type>` subagent」+ 描述副行 + 状态字；派发瞬间即从 Task 输入直出身份（不用等 SDK 通知），运行中带安静转圈；
- 终态且 SDK 报告时行内补「N tool uses · 时长」；只做一层层级，不伪造更深结构；子会话内部事件不进父转录；
- 回合结束后仍在跑的委派诚实降级显示 "running in background"，由后台台账轮询结清（5s 间隔、10 分钟上限）；窗口 Reload 后自动重挂轮询，僵尸行不会永久冻结；
- 子会话 ID 永不过桥（隐私不变量）。

**"N Working" 徽标与活动弹层**。本窗口活跃回合派发的委派仍在运行时，Composer 左上浮现 "N Working" 药丸；Host 明确投影为 running 的后台委派在 Webview Reload 后也会继续显示，直到权威轮询结清，不会因前端 `liveTurnIds` 重建而消失。点开的是克制、紧凑的单列表层：

- 逐行显示类型、描述、实时走秒时长，以及**实时活动字幕**（子会话当前所用工具名，面板打开时 2.5s 轮询，关闭即停）；
- 当前不提供单行 Stop 或 Stop All：子代理取消的单行/批量语义尚不能
  可靠保证，活动弹层保持纯观察，不发送 `subagent.stop` 或 `turn.stop`；
  父聊天 Composer 自身的 Stop 不受影响；
- 非运行的历史委派不出徽标；后台委派只展示 Host 权威状态，不按父回合
  是否结束猜测控制能力。

**只读转录回放**。运行中与已终态的委派行都提供 quiet "View transcript" 入口，在右侧分栏（/btw 同族视觉）只读回放该子会话的转录；运行中每 3 秒原地刷新，结清时再补一次尾部读取。消息、Markdown、Thinking、命令卡、Tool 行与 Exploring/Explored 组直接复用主聊天组件（不再维护近似副本）；Read 显示安全工作区相对路径，Grep 显示查询与范围，Glob 显示模式与目录。内容增长与 disclosure 高度变化采用平滑跟随；读者滚动阅读即脱离，到底自然重入。点主聊天空白处会播放收拢动画，选择其他会话时立即关闭；面板内交互不会误关，关闭过程中打开另一条记录也不会被旧计时器带走。无 Composer、Regenerate、Commit 或终端写入口；子会话文件无法解析时 fail-closed 显示 "Transcript unavailable"。会话抽屉与归档列表按元数据过滤子代理子会话，转录回放是它们唯一的入口。

**Mission 只读展示**。会话属于 Mission 时 Header 追加静字（如 "· Mission · running"），抽屉行带 "mission / mission · worker" 细字注记；Mission 相关确认作为普通权限卡显示与结算。
*当前限制（部分完成）*：没有 Mission 控制面（启动/暂停/恢复、阶段流水、Worker 详情界面）。

## 12. IDE 集成

### 12.1 命令面板命令

| 命令 | 作用 |
| --- | --- |
| `DroidVisX: Open Chat` | 聚焦聊天视图 |
| `DroidVisX: Open Logs` | 打开 DroidVisX Logs 输出通道 |
| `DroidVisX: Export Diagnostics Bundle` | 导出诊断包（§13） |
| `DroidVisX: Shut Down Background Daemon` | 手动回收共享 daemon（§8.2） |
| `DroidVisX: Export Session as Markdown` | 导出当前会话为 Markdown（§7） |
| `DroidVisX: Add Selection to Chat` | 编辑器选区入 Composer（§12.2） |

### 12.2 Add Selection to Chat

编辑器选中文本后，右键菜单（`editorHasSelection` 时显示）或命令面板执行：**触发瞬间**捕获选区（冷启动也不丢），最长持有 60 秒等待视图连接，期间状态栏提示 "Selection will be added when Droid connects…"，超时给出警告而非静默丢弃。选区作为 selection 附件进入 Composer 暂存 chips，payload 带 `起:迄:相对路径` 头的代码块；连点去重。文件右键与转录内选区引用两个入口未实现。

### 12.3 文件 Diff 入口

文件修改类工具行的路径 chip、Changes 账本的文件行点击后，经 `vscode.diff` 打开 git HEAD ↔ Working 原生对比（无 git 或无 HEAD 版本时回退直接打开文件）；回合进行中点击尚未落盘的文件给出 "does not exist yet" 明确提示。
*当前限制（部分完成）*：无 Diff Hunk 级操作、无独立 Changes 页面。

### 12.4 Changes 实时账本

回合中 Droid 每写一个文件，转录内的 Changes 账本立即出现/追加一行（钉在首现位置）：header 运行中显示 "writing · N files" 实时跳数，回合结束经 `git diff --numstat` 对账后原地翻为 "N files · settled"；每行显示等宽文件名 + `+A/−D` 行数（untracked/二进制/无 git 时无计数）。行尾动作 hover 浮现（HTML 文件带 Preview）；footer 提供 **Review**（逐个打开全部文件 Diff）与 **Commit…**（见下）。历史加载按回合合成同样的摘要（无行数）。

### 12.5 Git 提交

账本 footer 的 Commit… 展开内联提交面板：显示分支名、勾选文件（默认勾选本回合触碰的文件）、以 prompt 首行本地拼出草稿消息（不调 LLM），经 VS Code Git 扩展 `add + commit` 提交，回显短哈希 + subject，失败原样显示 git 错误；无 git 扩展/无仓库/多根工作区时 fail-soft 隐藏入口。分支创建、Push 与 Pull Request 不在当前范围。

### 12.6 Canvas / 原型预览（沙箱）

Droid 产出的 `.html/.htm` 文件（Changes 账本行、已完成的工具行、消息中的路径链接）与消息中的内联 HTML 代码块，可在编辑器旁的独立面板（单实例复用）中安全预览：

- **安全模型**：Host 读取内容内联进 `sandbox="allow-scripts"`（无 same-origin）的 srcdoc iframe，opaque origin + 双层 CSP，**零网络出口**（fetch/XHR/WebSocket/CDN/外链图片全部阻断）、零本地文件可读、无 vscode API、无存储；工具栏如实标注 "Sandboxed · inline code only · no network"，即同目录外链资源不可加载，仅自包含 HTML 可完整渲染；
- 工具栏提供 **Reload**（重读磁盘/重渲染）与 **Open in editor**（内联内容无背景文件时隐藏）；文件缺失或超 4MB 时面板内显示克制提示，不静默。

### 12.7 只读终端镜像

运行中的 Execute 工具展开区提供 "在终端中查看"：打开 VS Code 真终端面板中的只读镜像终端 "DroidVisX: 命令输出"，实时追加命令输出（`\r` 进度行原地重写，超出快照窗口插入缺口注记）；键盘输入丢弃并一次性提示"只读镜像"；命令结束后输出保留可回看，重复点击复用同一终端。接管/双向交互已判 fail-closed 不做。

## 13. 诊断与可观测性

**结构化日志**。所有窗口的诊断按 UTC 日期写入 `globalStorage/droidvisx.droidvisx/logs/droidvisx-YYYYMMDD.jsonl`（总量上限 200MB，超限删最旧整天）。本地个人工具采用**全保真策略**：默认记录 prompt 原文、工具命令、路径、原始错误堆栈与 SDK 日志；**唯一过滤是凭据扫除**（Bearer/JWT/API key 等模式替换为 `[REDACTED]`）。每条记录带激活实例锚点与回合关联 ID，形成完整的回合时间线（接受回合、每个工具起止、交互开合与用户思考时长、Bridge 拒收、性能埋点 P1–P9 等）。`DroidVisX Logs` 输出通道实时镜像（`DroidVisX: Open Logs` 打开）。

**导出诊断包**。`DroidVisX: Export Diagnostics Bundle` 把全部日志文件 + `metadata.json`（扩展/SDK/VS Code 版本、OS、工作区）+ 日志分析手册打包为一个 zip，经保存对话框落盘。

**转录内诊断卡**。业务失败（附件超限、Diff 失败、会话操作被拒等）以随内容自适应的浅底诊断卡出现在转录中（severity 圆点、warning/error 染色），完全相同的连续诊断自动去重；同时全部镜像入日志。

**启动信标**。Webview 资源加载失败、未捕获异常、10 秒启动看门狗、构建号识别陈旧缓存等信标帮助定位"面板空白"类问题。

**会话切换阶段计时**。每次替换 Runtime 的终态
`host.perf.session-switch` 记录在同一个关联事件里给出总
`durationMs` 与 `initializeMs`、`historyMs`、`contextMs`。initialize
与 history 保持并行，context 在激活后读取；这些数据只用于先量化真实
Cursor 路径，v0.7.8 没有据此预改调度或宣称提速。

*当前限制（部分完成）*：日志无用户可配置级别，无遥测或远程上传（这也是刻意的本地边界）。

## 14. 探测中能力（非用户可用功能）

以下条目只有探针/调研证据或未接线的源码，**不是用户当前可用的功能**：

- **Mission 控制面与 Task 子代理控制探针**（2026-08-13）：实机证明 mission 可经 daemon 启动/暂停/恢复、严格串行 worker、Task 子代理可单独停止等。其中"子代理面板 + 单停 + 转录回放"部分已随台账 §37 落地为产品（见 §11）；Mission 观察台本身技术可行但未开工。
- **子代理转录只读回放探针**（2026-08-12）：文件尾随与终态读取的可行性调研。其"保底档"（终态只读回放 + 抽屉过滤）已随 §37 落地为产品；直播级回放（观察者连接）证实不可行。
- **Capability Gate 0.1**：源码中存在独立的能力探测器与 opt-in smoke（CLI/SDK 版本、Settings/Context 结构、Tool/Skill/MCP 计数等），但 Extension 未实例化、无 Bridge DTO、无 UI，不启用任何产品功能。

---

能力状态的权威记录见 [`implementation-status.md`](./implementation-status.md)。
