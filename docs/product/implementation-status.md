# DroidVisX 实现状态

> 本文档是 DroidVisX 当前实现范围的持续更新台账，用来区分“已经接入产品的功能”“部分实现”“仅能力声明/探测”以及“尚未实现”。
>
> 最后核对日期：2026-08-12
>
> 核对对象：当前工作区源码、Bridge、Extension Host、Droid Runtime 适配、Webview、测试、VSIX 与 Cursor 安装状态

## 状态定义

| 状态            | 判定标准                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------- |
| **生产已接通**  | 用户界面、Bridge、Extension Host 和 Droid Runtime 之间存在完整生产链路，并有相应测试证据 |
| **部分完成**    | 只实现了规格中的一部分，或者当前行为是临时替代方案                                       |
| **仅探测/声明** | SDK、daemon、CLI 或配置中存在能力证据，但 Extension 和 UI 没有消费该能力                 |
| **未实现**      | 没有完整的 UI、Bridge、Host 和 Runtime 适配链路                                          |

能力声明或 smoke probe **不等于产品功能已经实现**。

## 当前结论

DroidVisX 当前完成的是一个可靠的本地 Droid 文本聊天内核，以及基础
Session、历史记录、权限交互和恢复安全能力。Module 1 的 Session
Settings、Context、隐私安全 Tool 活动、消息 Copy/Reuse、本地诊断、
Bridge v2 和暖色 assistant-ui Webview 已形成完整源码链路。

Module 1 仍等待用户在真实 Cursor Secondary Sidebar 中完成最终可见验收。
本次 Figma Design 还原已经重新打包、验证并安装 VSIX，但现有 Cursor 窗口
仍需 Reload Window 才会加载同版本号下的新 Bundle；当前尚未形成完成提交。

2026-08-11 产品化打磨轮已完成源码与测试：Production Build（minify +
production React）、长会话渲染优化（消息身份缓存、Thinking 展开局部化、
默认 200 条尾部窗口渲染与 “Show earlier messages”）、styles.css 去重、
权限/Plan/AskUser 拍平为对话流内的扁平内联交互块（移除底部浮层）、
Tool/Thinking 行内联真实耗时（Runtime 计时经 Bridge 可选 `durationMs`
到 UI），以及 Composer 常驻 Mode 触发器与 Context 百分比。该轮已通过
完整 typecheck、445 项测试、重新打包（`.vscodeignore` 排除
`.cursor/**`，VSIX 回到 8 个入口）并安装到 Cursor；仍等待用户
Reload Window 后的最终可见验收。

2026-08-11 追加交互修复与“编辑并重问”切片：待处理交互不再禁用
Composer 附件/控件、发送后自动滚到底部、Assistant 消息 Hover Copy、
代码块 highlight.js 语法高亮 + 单独复制按钮，以及双击历史用户消息
内联编辑并经 SDK `session.rewind` 分支重问（Bridge `turn.editResend` /
`user.message-meta`、Runtime `rewind`、Host 转录截断与
Session 目录切换、Webview 内联编辑器）。该切片已通过 typecheck、
460 项测试、构建与浏览器冒烟（双击开编辑器、Resend 发出正确
`turn.editResend`、Fork 快照后 UI 正确截断切换）。

同日追加 Session Rename：会话抽屉中活跃会话行提供 Rename 铅笔按钮，
内联输入 Enter 提交、Escape 取消；Bridge `session.rename`（标题
1..256 字符、去空白校验）经 Host 调用 SDK `session.rename` 并回发
更新后的目录快照。仅支持当前活跃 Session；Archive/Delete/Favorite
无公开 SDK 来源，保持未实现。

同日追加 Skills 浏览与启停：Composer `+` 面板中的 Skills 行现在进入
真实技能列表视图（懒加载，`skills.refresh` / `skill.toggle` Bridge
消息），Runtime 经 SDK `listSkills` / `setSkillDisabled` 投影安全字段
（name、description ≤512、location、enabled、userInvocable；不投影
filePath/content/resources），Host 无状态转发并以 `session.skills`
消息回发 loading/ready/error/unsupported 状态。切换开关后 Host 重新
list 并回发；Webview 在 loading 期间保留旧列表并禁用开关。

同日追加 MCP Server 浏览与启停：`+` 面板中的 MCP servers 行进入真实
服务器列表视图（懒加载，`mcp.refresh` / `mcp.server.toggle` Bridge
消息）。Runtime 并行调用 SDK `listMcpServers` / `listMcpTools`，按
serverName 分组并投影安全字段（name、status、toolCount、requiresAuth，
Tool 的 name、description ≤512、enabled、readOnly；不投影连接错误、
authUrl、inputSchema、配置来源），服务器与工具均去重限量。Host 以
`session.mcp` 消息回发 loading/ready/error/unsupported 状态；启停经
SDK `toggleMcpServer`（settingsLevel: user）后重新 list 回发。UI 显示
状态圆点（connected/connecting/failed/disabled）、needs auth 徽标，
Tool 列表可展开并带 read-only/off 徽标。MCP 认证流程后续已实现，
见下文 MCP 浏览器认证段落。

同日追加 Session Compact：Context 浮层新增 “Compact conversation”
动作（`session.compact` Bridge 消息）。Runtime 经 SDK `session.compact()`
让 Droid 把较早消息总结进一个延续 Session 并就地收养（与 Rewind 相同的
Session 替换机制，保留 BYOK 目录视图）。Host 校验新 Session ID、把被
替代的 Session 从目录中移除、重新加载延续 Session 的摘要转录（读取失败
时保留原转录并降级 historyStatus 为 partial）、写入恢复存储、发出
info 级 `session-compacted` 诊断（含被总结的消息数）并自动刷新 Context
用量。运行中的 Turn、待处理交互或其他 Session 操作期间会拒绝压缩。

同日追加消息操作 UI 打磨：消息级 Copy 按钮在 Turn 运行期间整条隐藏
（`ActionBarPrimitive.Root hideWhenRunning`，不再出现灰色不可点按钮），
无可复制内容时按钮不渲染；复制成功后 1.5 秒内显示绿色对勾 “Copied”
（基于 `data-copied` 属性的纯 CSS 切换）。编辑并重问的内联编辑框
`resize: none` 不可拉伸；点击 Resend 后立即进入乐观 “Resending from
here…” 状态（气泡淡化 + 脉冲圆点），成功路径由 Fork 快照替换整段转录，
失败路径（Host 仅回发诊断）8 秒后自动恢复常规展示。已通过浏览器冒烟
验证以上全部路径。

同日追加 Context 附件（Module 2 切片）：Composer `+` 面板顶部新增
“Attach files… / Attach active editor / Attach selection” 三个入口
（Bridge `attachment.pick` / `attachment.addEditor` /
`attachment.addSelection` / `attachment.remove`，Host 以
`session.attachments` 回发仅含元数据的暂存列表）。Host 侧
`AttachmentSources` 抽象由 VS Code 实现提供：文件对话框读取
图片（jpg/png/gif/webp ≤4MB）、PDF（≤6MB）与文本文件（≤256K 字符，
超长截断并打 truncated 标记，含 NUL 的二进制拒绝）；活动编辑器与
选区捕获为文本附件（选区名带行号范围）。暂存上限 8 个，附件内容
只留在 Host/Runtime，Webview 仅渲染 chips（种类徽标、名称、
truncated 徽标、移除按钮）。发送时 Host 把暂存附件经
`sendTurn(text, attachments)` 投影为 SDK MessageOptions 的
`images` / `files` 并清空暂存；Rewind、Compact 与 Session 切换会
丢弃暂存附件。限额、空编辑器/空选区、读取失败均以 warning 诊断
回报。已知边界：已发送消息在转录中暂不回显附件；`droid exec`
风格的目录级 context 源无公开 SDK 渠道，保持未实现。

同日追加 Session Fork：会话抽屉活跃行新增 Fork 分叉按钮（Bridge
`session.fork` 消息）。Runtime 经 SDK `session.fork({ title })` 复制
整段对话为新 Session 并就地收养（与 Compact 相同的 Session 替换机制，
标题为原标题加 “(fork)” 后缀）。与 Compact 不同的是原 Session 保留在
目录中可随时切回。Host 重新加载副本转录、写入恢复存储、丢弃暂存附件、
发出 info 级 `session-forked` 诊断。运行中的 Turn、待处理交互或其他
Session 操作期间会拒绝分叉。

同日追加文件 Diff 入口：文件修改类 Tool（Edit/Create/Write/
ApplyPatch）的行内新增工作区相对路径 chip。Runtime 从 SDK tool_call
输入提取 `file_path`/`filePath`/`path`，实时流与历史投影都会把绝对或
相对路径归一化为有界的正斜杠工作区相对路径（越界、超长或含控制字符的
路径直接丢弃，不进 Bridge）。Webview 点击 chip 发送 `file.openDiff`
消息，Host 复验路径包含关系后经 `vscode.diff` 打开 git HEAD ↔ Working
原生对比，无 git 或无 HEAD 版本时回退为直接打开文件，失败发出 warning
诊断。原始 Tool 参数与输出仍然不进 Webview。

同日追加每轮 Changes 摘要：回合成功或被中断后，Host 收集该回合工具
触碰的工作区相对路径（去重、首见顺序、上限 24 个），经
`git diff --numstat --relative` 对 HEAD 异步读取增删行数，然后向转录
追加 `changes` 项并广播 `turn.changes` 消息。Webview 在回合末尾渲染
扁平 “Changes · N files” 行，chip 显示文件名与 +A/−D（untracked、
二进制或无 git 时省略计数），点击复用 `file.openDiff` 打开原生对比。
历史加载按回合合成同样的摘要行（无行数）。恢复存储同步支持
`changes` 项，并修复了上一切片引入的回归：持久化 checkpoint 中带
`filePath` 的 Tool 项此前会被恢复校验整体拒绝；同时修复 Webview
store 在实时 `tool.activity` 更新中丢失 `filePath` 的问题。
下一轮严格两小时实现窗口的证据、范围、执行顺序、验收和回滚已经固化到
`docs/preflight/`。该预研确认 Context 的累计 `used`、Breakdown
`usedTokens`、`freeTokens` 和 Category Sum 都不能表示当前窗口；只有公开
Schema 中最新 Provider Call 的 `lastCallTokenUsage` /
`lastCallCompactionTokens` 可以作为当前 Compaction Meter 分子。该正确 Meter
尚未接入当前生产包，当前包继续使用不会伪造百分比的 Unavailable 降级。
公开高层 Node Session 没有模型目录方法，
但公开的 `initializeSession()` / `loadSession()` 响应包含经过 SDK Schema
验证的 `availableModels`。生产 Runtime 现在只投影其中由 SDK 标记为
`isCustom: true` 的 BYOK Model，Model 和对应 Reasoning 选项可以安全选择；
目录缺失或非法时仍然 fail closed，不会使用硬编码模型。历史用户消息
现在支持双击内联编辑并通过 SDK Rewind 从该消息分支重新提问。
Skills 浏览与启停、MCP Server 浏览与启停、消息附件（文件/编辑器/
选区/Problems/Git changes）、文件修改类 Tool 的路径 chip 与原生
Diff 入口已生产接通。
Changes 页面、daemon 主运行路径、
Mission 和 Manage Droid 等主要功能仍未实现。

同日追加三个消息与 Composer 切片：（1）Assistant 消息 Regenerate——
最后一条回答的操作栏新增 Regenerate 按钮，锚定其前一条带 SDK
Message ID 的用户消息，复用编辑重问的 Rewind 分支机制按原文重发；
（2）Composer `@` 文件提及——输入 `@` 触发防抖的
`workspace.searchFiles` 搜索（VS Code `findFiles`，排除
node_modules/.git/dist/out，结果限量），弹出可键盘导航
（↑/↓/Enter/Tab/Escape）的文件列表，选中后经 `attachment.addPath`
把该文件按工作区相对路径暂存为附件并在文本中保留 `@相对路径`；
（3）Rewind 文件安全检查——打开内联编辑器时经 `rewind.info` 调用
SDK `getRewindInfo`，有受影响文件时编辑器内显示恢复勾选项
（默认保留当前工作区），勾选后 Rewind 以 SDK 报告的
`filesToRestore`/`filesToDelete` 恢复文件。三个切片均已通过
typecheck 与全量 615 项测试。

同日追加 MCP 浏览器认证：MCP 面板中 needs auth 的服务器行新增
“Authenticate in browser” 按钮（Bridge `mcp.server.authenticate` /
`mcp.auth` 消息）。Runtime 经 SDK `session.authenticateMcpServer`
发起认证，并订阅 `mcp_auth_required` / `mcp_auth_completed` 通知：
前者带出经校验的 http(s) OAuth URL（≤2048 字符），后者一次性回报
success/cancelled/failed 结果（订阅 10 分钟后自动释放）。Host 打开
系统浏览器（`vscode.env.openExternal`）、以
started/browser/终态阶段广播 `mcp.auth`、同一时间只允许一个认证流、
10 分钟无结果则以超时错误收尾；success 后自动重新拉取 MCP 目录。
Webview 在服务器行内显示按钮、进行中状态与结果文案。OAuth URL 只在
Host/Runtime 流转，不进 Webview。

同日追加 MCP Server 添加与移除：MCP 面板顶部新增 Add 按钮展开内联
表单（名称、stdio/http/sse 类型选择、stdio 命令行或 http(s) URL），
提交经 `mcp.server.add` 消息（Bridge 双向校验：stdio 必须带命令且
不得带 URL，http/sse 必须带 http(s) URL 且不得带命令，args 有界）
调用 SDK `session.addMcpServer`；每个 Server 行新增两段式
Remove/Confirm remove 按钮（4 秒未确认自动复位），经
`mcp.server.remove` 调用 SDK `session.removeMcpServer`
（user settings 级）。任一变更成功后 Host 重新拉取并广播 MCP
目录，失败以安全 error 状态回报不泄露内部错误。stdio 命令行按
空白拆分为 command+args，不支持带引号参数。

同日追加 Problems / Git changes 附件源：Composer `+` 面板新增
“Attach problems”（工作区诊断，`路径:行 [严重级] (来源) 消息` 文本，
上限 200 条超出截断）与 “Attach git changes”（`git diff HEAD
--no-color --no-ext-diff` 未提交差异）两个入口（Bridge
`attachment.addProblems` / `attachment.addGitChanges`）。两者复用
既有捕获流程暂存为文本附件（≤256K 字符截断），无诊断或无未提交
变更时发出 warning 诊断说明，无 git/无工作区时按读取失败处理。

同日追加活动可观测性打磨（“看得见在干活”）：（1）运行中 Tool 与
Thinking 行的动作文字带从左到右的 shimmer 动画，收起/展开的详情
体带 220ms 淡入位移过渡，`prefers-reduced-motion` 下全部退化为静态。
（2）execute 类 Tool 在行内以 code chip 显示命令首行，展开显示完整
命令；task-plan 类 Tool（TodoWrite）把计划文本解析为带进度
（`已完成/总数`）的清单，含 pending/in_progress/completed 三态标记与
完成项删除线，plan 行默认展开。命令与计划文本经 Runtime
`extractToolDetail` 有界提取（≤4000 字符，保留换行/制表符），随
`tool.activity` 与 Tool transcript 项（新增 `detailKind`/`detail`
字段，双向校验）下发，历史投影与恢复存储同样解析。（3）Runtime 流
循环为每个 tool-start / tool-result / stream error 追加带时间戳的
结构化诊断（`runtime.tool.started` / `runtime.tool.finished` /
`runtime.stream.error`），在 DroidVisX Logs 输出通道形成实时步骤
时间线（2026-08-11 全保真改造后按 toolUseId 去重并携带
tool/toolUseId/命令原文，见第 10 节）。Tool 行的
`<details>` 改为受控 open 状态（每行 `useState`，plan 默认开），
修复复用 DOM 节点时 `open` 残留的 React 非受控 details 缺陷。
（4）修复 Context 弹层中 Compact 区块相对其余内容左缩进不齐
（补齐 16px 水平内边距）。

同日深夜追加 Session Favorite 与列表分组（V1 #1）：会话抽屉每行
星标按钮切换收藏（Bridge `session.favorite` 双侧校验），收藏状态
持久化到 CLI 私有 `~/.factory/sessions/.favorites` JSON 数组
（**非官方契约**，逆向 CLI 行为所得；临时文件 + rename 原子写，
文件内容损坏时拒绝写入以免破坏 CLI 自身数据）。目录投影为每条
`SessionSummary` 附带 `isFavorite`，抽屉列表按 Favorites/Recent
两组渲染（无收藏时不显示组标签）。Session Delete 无任何 API 保持
不做；Archive 留待 daemon 路径。

2026-08-12 凌晨追加 daemon Phase 1 只读 sidecar（归档/取消归档/
内容搜索）：Extension 激活后按需懒启动一个私有 `droid daemon`
（`--parent-pid` 绑定扩展宿主进程、OS 动态分配端口、退出时
Windows `taskkill /T /F` 结束进程树），凭据只经公开函数
`readFactoryAccessCredential()` 读取并直接传给 SDK
`connectToDaemon`，token 不落盘、不进日志、不进 Bridge。新增
Bridge 消息 `session.archive` / `session.unarchive` /
`sessions.archivedRefresh` / `session.search`（双侧校验对称，含
敌对输入用例）与回发状态 `session.archived` /
`session.searchResults`。会话抽屉：非活跃行新增归档按钮（活跃
Session 在 Host 侧拒绝归档）、底部新增可折叠 “Archived” 区
（首次展开懒加载，行内 Restore 按钮取消归档）、搜索框回车触发
daemon 全量内容搜索（`Content matches` 区显示标题/片段/时间，
本工作区目录内的结果可点击切换，异工作区结果只读展示）。
`DaemonSessionCatalog` 客户端按 cwd/repoRoot 过滤归档列表、
标题与片段经共享 sanitize 有界投影。执行链路完全不变，daemon
连接失败（未登录/凭据不可读/连接失败）只影响归档与搜索并以
安全诊断回报。daemon 作为执行路径（Phase 2/3）仍未实现。

2026-08-12 凌晨追加恢复提速（快照先行，V1 #2）：`ChatController.startup()`
现在在等待会话目录/历史/Runtime 初始化之前，先加载本地
`SessionRecoveryStore` 检查点并把选中会话的转录立即作为早期
`host.snapshot` 推给 Webview（连接状态保持 `connecting`，全部
可变操作 handler 仍被既有守卫拒绝），随后权威激活快照整体替换。
新增 `host.perf.early-snapshot` 埋点（sessionId/items），应先于
`runtime.initialize.finished` 出现；P6/P7 既有埋点保留对照。无
选中会话或检查点为空时跳过早期快照，行为与原先一致。Webview 无
改动（`connecting` 状态既有处理）。

2026-08-12 凌晨追加 daemon Phase 2 执行链路迁移（可选、默认关闭）：
新增 `src/runtime/daemon/createDaemonDroidSession.ts`，通过
`FactoryDroidRuntime` 既有的 `createSdkSession` 注入 seam 提供
daemon 版会话工厂——会话在共享的持久 daemon 连接上
create/resume，`FactoryDroidRuntime` 及其上层完全不变。新增
`package.json` 配置 `droidvisx.runtime.mode`（enum
`process`|`daemon`，默认 `process`），激活时读取一次并记
`runtime.mode` 诊断；daemon 模式复用 Phase 1 sidecar 的懒启动
私有 daemon 与断线重连，凭据路径不变。已知 Phase 2 差异（均
fail closed）：daemon 门面不报 `supportedReasoningEfforts`，
模型目录保持 `unavailable`（下拉降级为只显示当前模型）；无会话
通知订阅，浏览器 MCP OAuth（`mcp.auth`）不可用（列表/启停/增删
正常）。替换型操作（rewind/compact/fork）按 §2.2 语义 resume
`newSessionId` 后 detach 旧句柄，失败时保留旧句柄；
`close()` 映射为 `detach()`（会话在 daemon 中存活，daemon 本身
仍 parent-pid 绑定，Reload 存活属 Phase 3）。切回 `process` 即
完全回退，默认行为零变化。

2026-08-12 凌晨追加 daemon Phase 3 Reload 存活基础设施（daemon
模式下生效）：`droidvisx.runtime.mode = daemon` 现在改用**脱管
共享 daemon**——`startDetachedDaemon`（`detached:true` + `unref()`、
不带 `--parent-pid`）配合自建服务发现 `~/.droidvisx/daemon.json`
（`wx` 独占创建处理并发拉起竞争，输家杀掉自己多起的 daemon 改连
赢家；健康检查 = 连接 + 一次 `sessions.list({limit:1})` 认证探活；
记录 CLI 版本供漂移提示，值为 unknown 时不误报）。跨窗口会话租约
`~/.droidvisx/sessions-attached.json`（`{sessionId:{pid,ts}}`，
死 pid 的租约可抢占）经 `SessionLeaseHooks` 注入 daemon 会话工厂，
resume 前必须拿到租约（被别的存活窗口占用则拒绝并提示），替换型
操作把租约从旧会话迁到新会话，`close` 释放租约。新增命令
`droidvisx.shutdownDaemon`（无 shutdown RPC，直接 taskkill 发现
文件里的 pid 并删文件）。凭据仍只经 `readFactoryAccessCredential()`，
发现文件/租约文件均不含 token。进程模式（默认）继续用 parent-pid
私有 daemon 做归档/搜索 sidecar，不受影响。Webview 重连对账 UI
（in-flight 回合的活流重接、面板内 pending 权限重弹）尚未接线——
详见"验证状态"遗留说明。

同日追加长会话性能与卡死修复（用户反馈"页面一点击就卡死、无法
发话、恢复对话慢"）：（1）Thinking 行展开从全局共享状态改为每行
独立 `useState`——旧行为点一次会同时展开会话内全部 Thinking 行
（stress harness 实测 120 回合下一次点击展开 201 个 `<details>`，
主线程阻塞 150ms+，真实长会话为秒级），现在只切换被点击的行。
（2）plan 行默认展开改为仅当所在消息处于 running（活跃回合）时
生效，恢复的历史回合全部折叠挂载，降低首屏 DOM 与布局成本。
（3）Host→Webview 桥接消息在 webview 侧按动画帧合批（rAF +
50ms 隐藏兜底），流式 delta 高频到达时每帧只做一次 reducer 批量
派发；此前每条消息单独渲染，120 回合会话下每条 delta 约 50ms
长任务、40ms 间隔到达即主线程饱和。（4）默认消息窗口从 200 条
收窄到 60 条（`Show earlier messages` 步长 120），首屏渲染阻塞
从约 1.46s 降到约 0.57s，流式期间 50ms+ 长任务从连续出现降为 0
（`artifacts/stress-harness.html` 120 回合复测）。相应更新
App 测试：host 消息现在异步落地，断言改用 `findByRole`/`waitFor`，
Thinking 断言改为逐行独立展开。

### 当前 Figma Design 还原边界

当前生产 Webview 以 Figma Design 文件
`Jelb6rz1qdLl5uko9ETjqH` 的页面 `0:1` 为视觉来源。实现依据是通过 Figma
MCP 读取的节点结构、尺寸和样式，而不是旧 Make 导出或截图估算。默认
430×850.25 参考面板中的 60px Header、Transcript/Composer 留白、默认
Composer、待处理请求 Composer、History、Settings、Context、Model、
Permission、Plan、AskUser 和 Mission 状态均已映射到生产组件；生产 Shell
不再保留 Figma 演示画布的固定 430px 外框、圆角和居中灰色背景，而是填满
Cursor 提供的整个 Webview 容器。
Inter Latin 字形随 Webview 本地打包，CJK 字形继续使用系统回退字体。
Composer 的 Send、Thinking 和 Tool 箭头使用自身坐标系居中的 SVG；Plus、
Context 和 Model 浮层固定在 Composer 上方约 7px。
本轮再次按 Conversation、History、Permission 和 Plan 的节点级结构核对
生产实现。Webview 使用 Figma 的 `#f5f3ef` Surface、`#262626` Ink、
`#a1a1a1` Subtle、`#e5e5e5` Border、`#f2612e` Accent 和
`#ec003f` Danger。2026-08-11 起，权限、Plan 和 AskUser 不再使用 Figma
演示画布的固定宽度卡片或底部浮层，而是作为对话流内与阅读列同宽的扁平
内联交互块呈现：单一表面、上下细分隔线、行内动作按钮。真实数据超过
示例时正文在块内滚动，长按钮标签换行或在窄栏分行，不扩大 Webview 或
产生横向溢出。

`design/prototypes/Restore Droid for VSCode GUI` 和旧 Make 导出仅保留为历史
参考。所有真实 Session、Turn、模型、Context、权限和 AskUser 数据仍只
来自已校验的 Bridge，Figma 中的示例数据不会进入生产 Runtime。

为了不把原型样例误作 Droid 产品能力，以下原型控件不会显示为可用功能：

- 固定模型清单与 “Add Models”，生产 UI 仅显示 Runtime 返回且 SDK 标记为
  `isCustom: true` 的 BYOK `availableModels`；
- 全局或永久权限（文件附件、Skills 与 MCP 浏览启停已生产接通）；
- 完整 Mission 管理、Worker、阶段和进度界面。

Mission 目前只会在 Droid 发出真实确认请求时，作为普通权限卡片显示和
结算。ExitSpec 的计划则只在真实权限选项允许时显示和编辑。

## 生产已接通

### 1. 基础文本聊天

- assistant-ui 聊天界面
- 使用本地 Droid SDK `ProcessTransport`
- 新建和恢复 Droid Session
- 发送纯文本消息
- Assistant 文本流式输出
- Stop 中断当前轮次
- Markdown/GFM 安全渲染
- Webview 草稿保存与恢复
- 空闲时 Enter 发送、Shift+Enter 换行；Turn 运行时不支持排队，因此
  Composer 明确提示先 Stop，而不是继续显示错误的 “Enter to send”
- Turn 运行期间持续显示真实工作状态；即使 Droid 没有发送可选的
  `tool_progress`，界面也不会在长 Tool/Thinking 间隔中表现为静止

主要实现：

- `src/webview/assistant/App.tsx`
- `src/webview/assistant/Thread.tsx`
- `src/webview/assistant/runtimeAdapter.ts`
- `src/extension/ChatController.ts`
- `src/runtime/FactoryDroidRuntime.ts`

### 2. Thinking 和 Tool 生命周期

- Thinking 流式内容和折叠展示
- 所有 Thinking 默认收起；用户切换任意一个 Thinking 时，同一 Thread
  中的全部 Thinking 同步展开或收起
- 同一 Turn 内交错到达的 Thinking、Tool 和 Assistant Text 保留真实事件
  顺序，不再把后续正文合并回最早的 Assistant Text 段
- Thinking 正文使用 Figma 的 Inter 12.5px / 20.313px 和
  `#a1a1a1`，Chevron 使用 14×14 SVG
- Thinking 和 Assistant Markdown 使用 assistant-ui 有界平滑提交，避免
  原始大块文本直接刷新造成的可见分块和不必要布局抖动
- Tool 开始、运行、完成和失败状态
- Tool 在同一 Turn 内实时观察到开始与结束时，行内显示真实耗时
  （Runtime 计时，经 Bridge 可选 `durationMs` 投影）；仅有终态的历史或
  恢复数据不伪造耗时
- Thinking 完成后行内显示 SDK 报告的真实思考耗时
- 以 “Read workspace files”“Ran a local command” 等语义动作作为主标签
- Droid SDK 的 `tool_progress` 是可选事件；只有真实收到进度事件时才显示
  有界计数和最新通用更新类别，没有进度事件时只显示真实生命周期，不伪造
  “缺少进度”告警
- Stop、刷新和 Runtime 重建后的状态收敛
- Tool 数量和文本长度限制

安全限制：

- UI 只接收 Tool 名称、语义动作、关联 ID、生命周期、有界进度计数和通用
  更新类别；关联 ID 仅用于内部关联，不再作为 Tool 行主内容显示
- 命令、路径、参数、Snippet、原始输出、完整结果、详细错误、Terminal/
  Subagent ID 和其他 SDK Payload 不进入 Webview

### 3. 用户消息操作

- assistant-ui 原生 Copy
- “Reuse” 把历史用户文本非破坏性填入当前 Composer
- 双击带 SDK Message ID 的历史用户消息在原位打开内联编辑器，可修改后
  Resend；Host 通过 SDK `session.rewind` 建立分支 Session、截断转录并以
  编辑后的文本重新提问
- 没有 SDK Message ID 的用户消息（例如刚发送、Host 尚未回传
  `user.message-meta` 的乐观消息）双击仍执行非破坏性 Reuse
- Resend 会在有活跃 Turn 或待处理交互时被拒绝
- 打开内联编辑器时经 Bridge `rewind.info` 向 SDK `getRewindInfo`
  查询文件影响；有受影响文件时编辑器内显示 “Restore N files
  changed after this message” 勾选项（默认不勾选）。勾选后 Rewind
  以 SDK 报告的 `filesToRestore`/`filesToDelete` 恢复文件，否则
  保持当前工作区文件不变
- 最后一条 Assistant 回答提供 Regenerate 按钮，锚定其前一条带
  SDK Message ID 的用户消息经同一 Rewind 分支按原文重发
- Copy 和 Reuse 不会自动发送、修改历史、回退文件或创建分支

### 4. 权限请求

- 投影 Droid SDK 返回的真实权限选项
- Edit、Execute、Create、Patch、MCP Tool、Sandbox、Spec 和 Mission 等确认类别
- 权限、Plan 和 AskUser 全部作为对话流内的扁平内联交互块显示（单一表面、
  细分隔线、行内动作），不再使用底部浮层或嵌套卡片；不把每个 Tool 再绘制
  成独立大卡片
- 拒绝操作与主要允许操作始终可见；额外 Session/Always Allow 范围只在
  真实 SDK 选项存在时进入 14px Chevron 的 Split Button 菜单
- Split Button 使用统一 32px 高按钮体、32px Chevron 分段、单一外轮廓和
  内部分隔线；窄栏时操作区换行而不产生横向溢出
- 有界的标题、详情和风险说明
- 防止重复响应
- 请求与精确的 Workspace、Session、Turn 和 Runtime Generation 绑定
- 过期或非法响应安全取消

主要实现：

- `src/runtime/runtimeInteractions.ts`
- `src/extension/pendingInteractionCoordinator.ts`
- `src/webview/assistant/Interactions.tsx`

### 5. AskUser

- 单选
- 多选
- 无预设选项的开放文本问题（SDK `options: []`）
- SDK 若把 Factory 问卷标记文本放进单个 Question，UI 会把字面量 `\n`、
  `[topic]` 和 `[option]` 格式化为可读问卷，并改为单个开放文本回答，不再
  显示无关的 Yes/No 选项
- 自定义答案
- 一次处理多个问题
- Submit 和 Cancel
- 按原问题索引精确返回答案

### 6. 完整 Spec Mode 闭环（2026-08-12 中午切片④）

- 显示 `ExitSpecMode` 返回的计划
- 通过安全 GFM Markdown 显示标题、列表和代码，不暴露原始 `####` 标记
- 在 SDK 提供可编辑选项时编辑计划；编辑器带 Edit/Preview 双视图
  （Preview 用同一 Markdown 渲染器实时预览草稿）
- 可见操作遵循 Figma 的 Deny、Edit、Approve 层级；额外审批范围进入
  Split Button 菜单
- 返回 Droid SDK 提供的审批结果
- SDK 发出 `settings_updated` 后，Host 重新读取当前 Session 的权威
  Settings；ExitSpec 审批继续执行时 Mode 不再停留在旧的 Spec 显示
- **32K 静默取消 bug 已修**：ExitSpec 计划文本改用专属上限
  `MAX_SPEC_PLAN_LENGTH = 262,144`（Bridge 双向校验按
  `confirmationKind` 区分），超限计划在 Runtime 截断显示而非取消
  整个审批；回归测试构造超 32K 与超 256K 计划过桥
  （`runtimeInteractions.test.ts`、`validateHostMessage.test.ts`）
- 长计划卡默认折叠预览 + “View full spec” 展开/收起（阈值
  1,200 字符或 24 行）
- Spec 模式可视化（2026-08-12 下午按 UI restraint / Visual bar 收敛）：
  Composer 上方徽标横幅已删除，Spec 态改由 Composer placeholder
  （“Describe what to plan…”）与 Mode 触发器纯文字强调色（无填充底）
  表达；同批次收敛：Spec 起草 “Use session model” 选中态去填充改
  描边、Compact conversation 按钮恢复暖色描边+强调字、Approve plan
  上拉菜单与危险按钮按轻奢基准打磨（柔和阴影/暖色 hover/克制红
  `--dvx-danger: #c93a4a`）、转录诊断提示改为随内容自适应的精致浅底卡
  （1px 边框+severity 圆点，替代通栏橙线条）
- Spec 起草模型/推理力度覆盖：Model 弹窗在 Spec 模式下出现
  Session / Spec drafting 双 Scope，Spec Scope 可选独立起草模型与
  推理力度，或重置回 Session 模型 / 模型默认（Bridge
  `specModeModelId` / `specModeReasoningEffort`，null 表示重置；
  SDK `UpdateSessionSettings` 同名字段）
- `proceed_new_session*` 批准后 Runtime 监听 session 通知
  （`agent_turn_completed` reason `spec_handoff` + 不同 sessionId
  的通知信封双信号），在 `turn-complete` 前发出 `spec-handoff`
  Runtime 事件；Host 在回合结束时按 Compact/Fork 同款替换机制收养
  实现 Session。信号缺失时降级为可见 warning（提示从 History 打开），
  不静默
- 历史加载/恢复回放：Spec 起草文本走 assistant 转录、ExitSpecMode
  工具记录走既有 reconcile 管线（真实会话 fixture 已含该工具），
  无需新增路径

Spec 起草期间的流式渲染与普通回合共享既有 `assistant.delta` 链路；
“动画只属于正在发生的事”约定不变。

### 7. 基础 Session 导航

- 列出当前工作区的本地 Session
- 刷新列表
- 新建 Session
- 选择和恢复 Session
- 本地按标题或 ID 过滤
- 显示更新时间和消息数量
- History 搜索使用单一 33px 外框，原生 Search Input 不再叠加第二层边框
  或 Focus Outline
- History 使用内部列表作为唯一纵向滚动容器，隐藏浏览器 Scrollbar，
  右边缘保持 `#f5f3ef` Surface，不再出现黑色边条

主要实现：

- `src/runtime/FactorySessionCatalog.ts`
- `src/webview/assistant/SessionDrawer.tsx`
- `src/extension/ChatController.ts`

### 8. 旧 Session 历史加载

- 使用公开低层接口 `DroidClient.loadSession()`
- 加载 CLI 创建的已有 Session
- 投影用户文本、助手文本、Thinking 和 Tool 生命周期
- 过滤隐藏内容、Hook 内容和 SDK 系统标记
- 对过长内容进行截断
- 对不支持的内容显示 partial/unavailable 状态
- 最多检查公开响应末尾 10,000 条 Message，并以 20,000 个 Block、2,000
  个可见 Transcript Item 和 1,000,000 UTF-16 Text Unit 作为独立安全上限；
  普通历史不再受旧 200 Item 窗口限制

主要实现：

- `src/runtime/history/FactorySessionHistoryLoader.ts`
- `src/runtime/history/projectSessionHistory.ts`

### 9. Session 和 Webview 恢复

- 保存选中的 Session
- 保存有界的 Transcript 恢复缓存
- Webview 刷新后恢复快照
- 恢复未处理的权限交互
- Host 重启后把未完成活动归一为停止状态
- 恢复旧 Session 时对公开 SDK 历史与本地安全缓存按 user 消息锚点
  （SDK `messageId` 优先，唯一文本兜底）分段对齐：loaded 为权威主体，
  本地缓存仅补 SDK 不再返回的前缀（rewind 分支/压缩）与 CLI 未持久化
  的尾段，中段差异（thinking 漂移、合成 changes 行）一律以 loaded 为准
  不再拼接重复；无共同锚点时退回顺序重叠核对
- 公开历史或合并后的时间线不完整时独立标记 `partial`；只有来源或本地安全
  预算确实裁剪了内容时才标记 `truncated`，不把本地缓存冒充 Droid 的完整
  权威历史

边界：如果 CLI/SDK 在 DroidVisX 首次观察前已不再通过公开接口返回较早内容，
或本地 2,000 Item / 1,000,000 Text Unit 安全预算也已用尽，DroidVisX
无法从私有 CLI 文件恢复这些内容。

主要实现：

- `src/extension/SessionRecoveryStore.ts`
- `src/extension/ChatController.ts`

### 10. 本地结构化诊断（2026-08-11 全保真改造）

存储与格式：

- 日志写入 `context.globalStorageUri/logs/`（Windows 实际路径
  `C:\Users\<user>\AppData\Roaming\Cursor\User\globalStorage\droidvisx.droidvisx\logs\`），
  按 UTC 日期分文件 `droidvisx-YYYYMMDD.jsonl`，所有窗口汇聚写同一份
  当日文件；总量上限 200 MB，超限删除最旧整天文件（当天永不删除）
- 每条记录带 `act`（激活实例 id，6 hex，生命周期分段锚点）、
  `workspace`（工作区路径）、可选 `turn`（回合关联 id，见下）
- `DroidVisX Logs` Output Channel 镜像保留；Logger、File 和 Output
  Channel Sink 失败不改变 Runtime 或 Extension 行为

全保真策略（用户明确决定，本地个人工具）：

- **默认记录原文**：prompt/消息文本（`runtime.turn.started` /
  `host.turn.accepted` 的 `detail`）、工具输入命令
  （`runtime.tool.started.detail`）、路径、会话/回合/工具 ID、
  原始错误与堆栈、SDK 原始日志消息与 CLI stderr
- **唯一过滤是凭据扫除**（`scrubCredentials`）：Bearer/JWT/`sk-`/
  `gh?_`/`github_pat_`/`xox?-`/`AKIA` 及 `key[:=]value` 赋值模式
  替换为 `[REDACTED]`；这是密钥安全，不是隐私脱敏
- 原 `projectAttributes` 白名单投影与 `safeCode` 值域限制已移除；
  保留结构约束（name 字符集 ≤128、attributes ≤32 键、字符串值
  ≤8192、detail ≤16384）
- SDK observability 转投同样全保真（message + error 堆栈入
  `detail`，attributes 原样通过）；SDK 内部自行 redact 的部分不可控

回合关联与骨架事件：

- `RuntimeDiagnosticSink` 增加可选 `beginTurnScope`/`endTurnScope`；
  `ChatController` 在接受回合时开启、终态（completed/interrupted/
  failed）时关闭，期间全部记录（Runtime/SDK/Webview 信标）自动带
  顶层 `turn` 字段（Bridge turnId 明文）
- 新增 Host 事件：`host.turn.accepted`（kind: send/edit-resend +
  prompt 全文）、`host.turn.state`（每次状态推送）、
  `host.interaction.opened/closed`（含 `pendingMs` 用户思考时长）、
  `host.bridge.rejected`（入站消息校验拒绝，原始 JSON ≤2048）
- **`emitSessionDiagnostic` 全部镜像入盘**（`host.ui.diagnostic`，
  code + 用户可见消息），约 40 个业务失败调用点不再只发 Webview
- `runtime.tool.started` 按 `toolUseId` 去重（每个真实工具一条，
  带 tool/toolUseId/action/detail）；`runtime.turn.finished` 新增
  `toolUniqueCount`（真实工具数，区别于含 delta 虚计的
  `toolStartCount`）

性能埋点（P1–P9）：

- P1 首屏：`webview.boot-ok` 带 `bootMs`，`webview.render-ok` 带
  `renderMs`（timeOrigin 起算）
- P2 长任务：Webview `PerformanceObserver('longtask')` 聚合，每 30s
  窗口最多一条 `webview.perf-longtask`（count/maxMs/totalMs）
- P3 合批：rAF 消息合批统计，回合终态发 `webview.perf-batch`
  （flushes/messages/maxBatch/maxFlushMs）
- P4 快照大小：每次 host.snapshot 记 `host.perf.snapshot`
  （bytes/items）
- P5 回合出站总账：终态记 `host.perf.turn-io`（bytesOut/
  messagesOut/每消息类型计数）
- P6 历史加载：`runtime.history.finished`（durationMs/outcome/
  items，激活恢复、compact、fork 三处复用）
- P7 恢复对账：`host.perf.recovery`（recovered/loaded/reconciled/
  reconcileMs；`reconciled ≈ recovered + loaded` 即重复 toolUseId
  类 bug 特征）
- P8 = tool.started 去重（见上）；P9 = 既有 `durationMs` 全保留

导出：

- 新命令 `DroidVisX: Export Diagnostics Bundle`
  （`droidvisx.exportDiagnostics`）：`showSaveDialog` 选位置，打包
  全部日志文件 + `metadata.json`（扩展/SDK/VS Code 版本、OS、
  工作区）+ `log-analysis-playbook.md`（随 VSIX 分发）为一个 zip
  （yazl）

Webview 启动信标（既有能力保留）：资源加载失败、未捕获异常、未处理
Promise 拒绝、10 秒启动看门狗、`boot-ok` 构建号识别陈旧缓存。

主要实现：

- `src/extension/LocalDiagnostics.ts`（全保真 sink + 凭据扫除 +
  按日轮换 + 200MB 容量）
- `src/runtime/runtimeDiagnostics.ts`（turn 作用域接口）
- `src/runtime/FactoryDroidRuntime.ts`（tool 去重、prompt/错误原文）
- `src/extension/ChatController.ts`（turn 作用域、骨架事件、镜像、
  P4–P7）
- `src/extension/exportDiagnostics.ts`（导出命令）
- `src/extension/extension.ts`、`src/extension/DroidViewProvider.ts`、
  `src/extension/webviewHtml.ts`
- `src/webview/bridge/vscode.ts`、`src/webview/assistant/App.tsx`
  （P1–P3 信标）
- 分析手册：`docs/product/log-analysis-playbook.md`（事件词典与
  schema 的当前真相）

### 11. Workspace 与安全边界

- 没有工作区时阻止 Runtime 启动
- Workspace 未信任时阻止 Runtime 启动
- Workspace 或 Trust 改变时关闭旧 Runtime
- 拒绝旧 Runtime、旧 Session 和旧 Turn 的迟到事件
- Webview 到 Host 使用严格消息校验
- Host 到 Webview 使用严格消息校验
- Webview Bundle 不包含 Droid SDK、Host Runtime 或云端 Runtime
- CSP 禁止 Webview 网络连接
- Markdown 禁止原始 HTML 和非 HTTP(S) 链接

主要实现：

- `src/shared/strictValidation.ts`
- `src/shared/validateMessage.ts`
- `src/webview/bridge/validateHostMessage.ts`
- `src/extension/webviewHtml.ts`
- `esbuild.mjs`

## 部分完成

### Session Settings、Context 与模型选择

- 读取并显示真实 Interaction Mode、Model、Reasoning Effort 和 Autonomy
- 更新 Mode、Autonomy、Model 和所选 Model 支持的 Reasoning Effort
- 使用 `getContextStats()` 读取并校验 SDK 返回字段；当前只把可信范围内的
  旧 DTO 显示为比例，累计值超过 Model Limit 时不会显示比例
- Context 对每个公开数值独立执行安全整数和非负校验，不再增加 SDK Schema
  没有要求的跨字段约束；`estimated` 统计可有舍入差
- 只有 `used`、`remaining` 和 `limit` 能形成有效窗口比例时才显示百分比；
  SDK 通过 Schema 但报告值超过 Model Limit 时，UI 显示原始报告量和
  “Current window unavailable”，不会把累计/压缩相关统计误报为 100%
- 最新无 Prompt 公开 SDK Probe 进一步证明 `getContextStats().used`、
  `getContextBreakdown().usedTokens`、`freeTokens` 和 Category Sum 均可能是
  累计值；正确实现必须使用
  `inputTokens + cacheReadTokens + (outputTokens ?? 0)`，该和已与
  `lastCallCompactionTokens` 实测一致，并以 `contextBudget` / `limit` 为分母
- 正确的 Last-call Meter 仍属于下一实现切片；在接通前不得把当前
  Unavailable 降级改回累计百分比
- Context 刷新失败时保留最后一次已确认数值并提供 Retry；加载期间的重复
  Refresh 会被合并，失败提示指向 `DroidVisX Logs`
- 使用公开初始化/加载响应及公开 SDK Schema 捕获真实 `availableModels`
- 只显示 SDK `isCustom` 字段确认的 BYOK Model；不会按 Model ID 猜测
  Provider 或自定义状态
- 模型目录缺失、超限、重复、非法或包含未知 Reasoning 值时 fail closed
- Plus 和 Context 面板按 Composer 宽度显示；Model 使用 228px 设计宽度
- Model 列表在固定高度内独立纵向滚动，不会把浮层推出 Webview
- 当前 Model 行在编辑前显示已确认的 Reasoning Effort
- Reasoning 选项只显示所选 Model 真实声明的值，包括 SDK 的 `xhigh`
  （Extra High）和 `max`
- Reasoning 浮层的 “Options” 是不可选择的 `h3` 标题，不再承担返回或关闭
  操作
- Plus 面板提供本地动作搜索；Mode/Autonomy 在原卡片内展开选项列表，
  Skills/MCP 行进入真实的浏览与启停视图，数据只来自已校验的 Bridge，
  不会伪造管理动作或 Runtime 能力
- Turn 流式运行时仍可打开 Plus、Context 和 Model 面板，并可更新 Mode、
  Autonomy、Model 和 Reasoning；待处理 Permission/AskUser、重复更新和
  Session 替换期间仍阻止写入
- Composer 输入由 assistant-ui `ComposerPrimitive` 提供，输入焦点只显示
  Composer 外层状态，不再绘制内部矩形边框
- 长会话只由 assistant-ui Viewport 的 `autoScroll` 和 Initialize/
  Thread Switch 策略管理跟随；已关闭会在内容增长期间保持意图的
  `scrollToBottomOnRunStart`，并移除第二套每次 Message 更新都执行
  `scrollTo(scrollHeight)` 的手工滚动，避免阅读上方内容时被拉回底部
- Runtime Diagnostic 使用紧凑行展示；同一轮终止
  `runtime-execution-failed` 会替换之前的错误 Diagnostic
- Context 失败时只渲染一个 Alert，不再同时显示重复普通错误文本
- Plan 文本和 AskUser 的问题、选项、自定义输入支持多行换行并在请求卡片内
  纵向滚动，不再使用固定选项区高度
- 已移除可见的 `ThreadPrimitive.ScrollToBottom` 控件

主要实现：

- `src/runtime/modelCatalogCaptureTransport.ts`
- `src/runtime/FactoryDroidRuntime.ts`
- `src/extension/ChatController.ts`
- `src/webview/assistant/ComposerControls.tsx`
- `src/webview/assistant/Thread.tsx`

### 其他部分完成项

| 功能                        | 当前实现                                                                                                                     | 尚缺内容                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Session Settings 与 Context | Runtime、Host、Bridge v2、Mode/Autonomy/Model/Reasoning 更新、Context 使用进度、固定暖色响应式 UI、测试、VSIX 和安装均已完成 | 用户在真实 Cursor 中最终可见验收                                 |
| Retry                       | 关闭并重新创建或恢复 Runtime                                                                                                 | 不会重新发送失败 Prompt，也不是消息级 Regenerate/Reload          |
| CLI/连接诊断                | CLI 不存在、工作区无效、未信任和初始化失败提示                                                                               | 实际登录状态、登录操作、版本兼容 UI、账户状态、升级入口          |
| Session 搜索                | 本地按标题或 ID 过滤；回车触发 daemon 全量内容搜索（≤20 条结果，标题/片段/时间投影，工作区内结果可点击切换）                 | 分页、排序和筛选                                                 |
| Session 生命周期            | List、Refresh、New、Select、Resume、活跃 Session Rename、编辑重问触发的 Rewind Fork、显式 Fork、Compact、任意行 Favorite（CLI 私有 `.favorites` 文件契约，非官方 API）、非活跃行 Archive/Unarchive（daemon 只读 sidecar） | Delete（无任何 API，fail closed）                                |
| Session 历史                | 文本、Thinking、Tool 生命周期、user/assistant/tool_result 三源 Image（有界投影，超预算降级占位行）                           | Document 和未知 Block 会被省略并标记为 partial                   |
| Tool 展示                   | 语义动作、技术 Tool 名、有界进度计数/类别、生命周期和实时观察到的真实耗时、文件修改类 Tool 的工作区相对路径 chip（点击打开原生 Diff）；不显示原始 Call ID | 参数、输出、结果、增删行统计、Apply/Open 操作                    |
| 消息操作                    | Copy、Reuse in Composer、单击卡片（或 Edit 按钮）原地展开编辑卡（文本 + 编辑暂存 chips + 第二实例 ComposerControls + 圆形发送按钮）并从该消息 Rewind 重问、已发送消息回显附件 chips、结构化 `turn.editResendRejected` 拒绝即时回编辑态、最后一条回答 Regenerate、编辑器内 `getRewindInfo` 文件影响提示与可选文件恢复 | Rewind 冲突检测、Turn Envelope、非图片附件的纯 loadSession 历史 chips（不可辨识，如实缺省） |
| 本地诊断                    | SDK Observability、Host 生命周期/耗时、Output Channel、Open Logs、轮换 JSONL                                                 | 用户可配置级别、导出诊断包、遥测或远程上传                       |
| Spec                        | ExitSpecMode 计划显示、编辑和审批；审批后的 `settings_updated` 会触发权威 Mode 回读                                          | 主动进入 Spec Mode、完整计划生命周期、实施交接                   |
| Mission                     | Mission 相关确认可以显示为通用权限卡片                                                                                       | Mission 状态、事件、阶段、Worker、控制和独立 UI                  |
| Diff                        | 权限详情可以显示原始文本或 Patch；Tool 行文件 chip 经 `vscode.diff` 打开 HEAD ↔ Working 原生对比（无 HEAD 版本回退打开文件） | Hunk 操作、增删行统计、Changes 页面、每轮 Changes 摘要           |
| Workspace                   | 使用 `workspaceFolders[0]`                                                                                                   | 多根工作区选择                                                   |
| Extension 入口              | 当前贡献 Activity Bar Webview                                                                                                | 与“Secondary Sidebar 为主界面”的当前项目要求仍需统一             |

## 仅探测/声明，没有接入产品

### Capability Gate 0.1

源码中存在独立的 Host-only 能力清单、探测器和 opt-in smoke：

- `src/runtime/capabilities/capabilityContract.ts`
- `src/runtime/capabilities/FactoryDroidCapabilityProbe.ts`
- `src/runtime/capabilities/capabilitySmoke.ts`
- `docs/engineering/droid-capability-matrix.md`

已经完成的探测能力包括：

- CLI、SDK 和协议版本
- Settings 字段结构
- CWD 和 Context 字段结构
- Tool 数量
- Skill 数量
- MCP Server 和 Tool 数量
- 已有 Session 的只读 Resume
- 超时、Abort、清理和 malformed Session Handle 防护
- 无 Prompt、无新建 Session、结构化隐私安全输出

但是：

- `src/extension/extension.ts` 没有实例化或消费 Capability Gate
- 没有对应 Bridge DTO
- 没有 Host 产品控制器
- 没有 Webview UI
- 不会启用任何产品功能

Module 1 已直接通过生产 `DroidRuntime` 接通 Live Settings 和 Context
Stats，并通过公开初始化/加载响应接通模型目录，因此这些能力不再只是
Capability Probe。Capability Gate 本身仍未接入 Extension。以下能力目前
仍然只是探测结果或声明：

- 目录级 Context 源与 `@`/Symbol 引用（图片/PDF/文本附件、编辑器与
  选区附件、Skills 与 MCP 浏览启停已生产接通）
- Mission Mode 和 Events
- Worktree Session Creation

## MVP 未完成

### 运行架构

- [x] daemon 作为可选运行路径（执行链路，Phase 2：
      `droidvisx.runtime.mode = daemon` 时经 `createSdkSession` seam
      注入 daemon 会话工厂；默认 `process` 不变；模型目录与浏览器
      MCP OAuth 在 daemon 模式 fail closed）
- [x] daemon 连接和认证（Phase 1 只读 sidecar：`readFactoryAccessCredential()`
      + SDK `connectToDaemon`，认证失败分类为安全诊断）
- [x] daemon 生命周期管理（Phase 1 私有 `--parent-pid` 模式 +
      Phase 3 脱管共享模式：`detached`/`unref`、`~/.droidvisx/daemon.json`
      发现文件 `wx` 竞争、`droidvisx.shutdownDaemon` 手动回收；
      daemon 模式下会话 reload 存活已由 `probe-reload-survival.mjs`
      实证）
- [x] 跨窗口会话租约（Phase 3：`~/.droidvisx/sessions-attached.json`，
      替换型操作前持租约，死 pid 可抢占）
- [ ] daemon 失败时回退 Node subprocess（当前为配置级回退：切回
      `process` + Reload Window；无运行时自动回退）
- [ ] Webview 重连对账 UI（Phase 3 §3.5：in-flight 回合活流重接与
      面板内 pending 权限重弹尚未接线；daemon 侧存活已实证，见验证
      状态遗留说明）
- [ ] Capability Gate 接入 Extension 的安全产品门控

默认（`process`）生产执行链路只使用 Node SDK `ProcessTransport`，
daemon 作为归档/取消归档/内容搜索的只读 sidecar；设置
`droidvisx.runtime.mode = daemon` 后执行链路整体走同一 daemon
连接（实验性，默认关闭）。

### 动态 Composer

- [x] Auto / Spec / Mission 模式选择
- [x] Autonomy 选择
- [x] Model 选择
- [x] Reasoning Effort 选择
- [x] 当前 Model 和 Reasoning Effort 显示
- [x] Context 安全读取、刷新和不可信比例降级
- [ ] Last-call Current-window Meter
- [ ] 经过语义确认的 Context Category 明细
- [x] `＋` 动作面板中的 Mode 和 Autonomy
- [x] Composer 常驻 Mode 触发器（Auto/Spec/Mission 一键切换弹层）
- [x] Context 圆环旁常驻百分比（仅在窗口比例可信时显示）
- [x] `＋` 动作面板本地搜索、Skills 列表浏览与启停、MCP Server 浏览与启停
- [x] `＋` 面板附件入口（文件对话框、活动编辑器、编辑器选区）
- [x] 已附加内容标签（Composer 附件 chips，含种类/截断徽标与移除）
- [x] `@` 文件引用（Composer 输入 `@` 触发工作区文件搜索弹窗，
      键盘/鼠标选择后按路径附加为附件；Symbol 引用未实现）
- [ ] `@` Symbol 引用
- [x] `/` 动态命令（行首 `/` 弹出自定义 Droid Commands 列表，本地
      过滤、最近使用优先、选中补全 `/name ` 不自动发送；执行由 CLI
      后端展开，已实测验证）

当前 Composer 保留 assistant-ui 的 Input、Send、Stop 和 Runtime Retry，
并增加真实 Mode、Autonomy、Model/Reasoning 和 Context 控件。模型选项
只来自当前 Session 初始化或加载响应中公开 `availableModels` 的
`isCustom: true` 子集，不会使用原型数据、旧列表、ID 猜测或人工维护列表。
如果当前 Session 使用内置 Model，该当前值仍显示在 Trigger 中，但不会被
加入 BYOK 列表，也不会伪造该 Model 的 Reasoning 选项。Skills 行进入真实
技能列表（SDK `listSkills` / `setSkillDisabled`）；MCP servers 行进入真实
服务器列表（SDK `listMcpServers` / `listMcpTools` / `toggleMcpServer`），
但这不代表 Capability Gate 已接入。普通流式响应期间仍可提交
Mode、Autonomy、Model 和 Reasoning 更新，并以 SDK 回读的 Session Settings
为最终显示值；待处理 Permission/AskUser、重复更新、Session 替换和非法目录值
仍会阻止更新。

### Context 与附件

- [x] 文件附件（文本文件 ≤256K 字符，超长截断）
- [x] 图片附件（jpg/png/gif/webp ≤4MB）
- [x] 文档附件（PDF ≤6MB）
- [x] 当前编辑器
- [x] 编辑器选区
- [ ] Open Editors
- [x] Problems（`+` 面板 “Attach problems”，工作区诊断文本，≤200 条）
- [x] Git Changes（`+` 面板 “Attach git changes”，未提交差异文本）
- [ ] Terminal Output
- [x] 项目文件选择（Composer `@` 提及经 `workspace.searchFiles`
      搜索工作区文件并按相对路径附加）
- [ ] Symbol 引用

### Edit、Resend 和 Rewind

- [x] Copy 历史用户消息
- [x] 非破坏性 Reuse in Composer
- [x] 编辑历史用户消息（双击内联编辑器）
- [x] 消息级重新发送（经 SDK Rewind 分支）
- [x] Assistant 消息 Regenerate（仅最后一条回答，锚定其前一条用户
      消息经同一 Rewind 分支原文重发）
- [ ] Turn Envelope
- [x] `getRewindInfo`（打开内联编辑器时经 `rewind.info` 查询）
- [x] 文件变化安全检查（编辑器内显示受影响/新建文件计数提示）
- [x] 保留当前工作区或恢复文件的选择（默认保留，勾选后 Rewind 以
      SDK 报告的 `filesToRestore`/`filesToDelete` 恢复）
- [ ] 冲突检测
- [x] Rewind 后建立分支 Session（Fork 自动接管为当前 Session）

### Changes 与 Diff

- [x] 每轮 Changes 摘要（回合完成后转录内追加 `changes` 项，历史
      加载按回合合成；文件 chip 点击打开原生 Diff）
- [x] 文件增删行统计（回合完成时 `git diff --numstat` 对 HEAD 测量，
      untracked/二进制/无 git 显示无计数 chip，历史摘要不带计数）
- [ ] Changes 页面
- [x] 使用 `vscode.diff`（Tool 行文件 chip 点击打开 HEAD ↔ Working
      原生对比，无 git HEAD 版本时回退打开文件）
- [x] 文件修改类 Tool（Edit/Create/Write/ApplyPatch）行显示工作区
      相对路径 chip（实时流与历史投影均覆盖，越界路径不显示）
- [ ] Diff Hunk 操作
- [ ] 文件恢复确认
- [ ] SCM 集成

## V1 未完成

- [x] Skills 列表浏览与启停（`+` 面板 Skills 视图）
- [x] Droid Commands 列表（Composer `/` 弹窗，SDK `droid.list_commands`
      自定义命令；`isExecutable` shell 命令与内置命令不暴露）
- [x] 动态 Slash Commands（选中补全 `/name `，发送后 CLI 后端展开
      模板与 `$ARGUMENTS`，已用真实 turn 验证）
- [x] 最近使用命令（`workspaceState` 持久化上限 8 个，弹窗置顶）
- [x] MCP Server 列表（`+` 面板 MCP servers 视图，状态与 needs auth 徽标）
- [x] MCP Tool 浏览（服务器行内展开，read-only/off 徽标）
- [x] MCP Server 启用与禁用（SDK `toggleMcpServer`，user 级设置）
- [x] MCP 认证（MCP 面板 “Authenticate in browser”，SDK
      `authenticateMcpServer` + auth 通知，系统浏览器完成 OAuth）
- [ ] Custom Droids
- [x] Session Rename（活跃 Session 内联重命名）
- [x] Session Archive / Unarchive（daemon 只读 sidecar：非活跃行
      归档按钮 + 抽屉底部 “Archived” 折叠区懒加载与 Restore；
      活跃 Session 拒绝归档）
- [ ] Session Delete
- [x] Session Favorite（任意行星标切换 + Favorites/Recent 分组；
      持久化为 CLI 私有 `~/.factory/sessions/.favorites` JSON 数组，
      **非官方契约**，文件损坏时 fail closed 不写入）
- [x] Session Fork（会话抽屉活跃行 Fork 按钮，SDK `session.fork()`，
      收养副本 Session，原 Session 保留在目录中）
- [x] Session Compact（Context 浮层 “Compact conversation”，SDK
      `session.compact()`，收养延续 Session 并重载摘要转录）
- [x] Session Rewind（经编辑重问触发，建立分支 Session）
- [ ] Session 分支关系
- [x] 完整 Spec Mode（切片④：32K 计划修复 + 长计划卡 + Spec 起草
      模型覆盖 + `proceed_new_session*` 实现 Session 收养；见
      「生产已接通 §6」）
- [ ] Mission 启动
- [ ] Mission 阶段和 Worker 摘要

## V2 未完成

> **用户排除（近期不做）**：跨设备 Session、界面中文化、个人体验基线、
> 账号用量 —— 见 [`HANDOVER.md`](../HANDOVER.md) 第 3 节。下列清单
> 含历史台账项；与 HANDOVER「V2 远期」索引对照，排除项勿开工。

- [ ] Mission Control
- [ ] Worker 详情
- [ ] Plugins
- [ ] Marketplaces
- [ ] Hooks 管理
- [ ] Automations
- [ ] Custom Models 的创建、编辑和 Provider 管理（已配置 BYOK Model 的选择
      已接通）
- [ ] 组织策略
- [ ] Account Profile
- [ ] Account Usage
- [ ] Git Commit / Push / Pull Request
- [ ] 原生 Terminal 工作流
- [ ] Background Processes
- [ ] Worktree 生命周期
- [ ] 远程环境
- [ ] 跨设备 Session
- [ ] Help 和 Feedback
- [ ] 诊断导出
- [ ] 更新管理

## 当前安装包状态

最后核对结果：

- Cursor 已安装：`droidvisx.droidvisx@0.0.0`
- `dist/droidvisx.vsix` 大小：636,573 字节（9 files, 621.65 KB）
- VSIX 修改时间：2026-08-12T13:04（本地）
- VSIX SHA-256：
  `6CCE471DDBBA7595B72E2FE2ACC382F746D83BCFBFDD8765F2D45E735015629E`
- VSIX 在此前功能之上追加 2026-08-12 中午的 V1 切片④「完整 Spec
  Mode 闭环」（32K 计划静默取消修复、长计划卡、Spec 徽标、Spec
  起草模型覆盖、`proceed_new_session*` 实现 Session 收养）
- 本轮门禁按仓库惯例分步执行：typecheck + 全量 vitest（44 files /
  1067 通过，基线 1050 +17）+ Production Build + vsce package +
  cursor --install-extension
- 最终 VSIX 已成功安装到 Cursor
- 已安装的 Extension Bundle、Webview JS 和 CSS 哈希均与本次 Build
  完全一致
- Extension Bundle SHA-256：
  `4EE802BB4823EDD0004E4D3EFAA72BAFAB938A29106F19CA4C9971AAE0A6B089`
- Webview JS SHA-256：
  `C22761F9BC4E82F700BED187EBF3917CA4FE35959FA9E6F3BBAEFE96A3921A24`
- Webview CSS SHA-256：
  `C17EFB800FCE96D5B7EEBE84BF57597E4536C549DAF932163D7F2CD4DFAC73A5`
- 用户尚未在真实 Cursor 中完成最终可见验收
- 由于版本号仍为 `0.0.0`，现有 Cursor 窗口需要 Reload Window 才会换到
  新 Bundle
- 2026-08-11 晚间已重新打包并安装含 webview 启动信标的构建
  （`droidvisx-0.0.0.vsix`，512.43 KB）；因怀疑 webview service worker
  缓存陈旧，本次验收要求完整退出并重启 Cursor，而非仅 Reload Window
- 2026-08-11 深夜再次打包并安装含 `/` 动态命令切片的构建：
  `dist/droidvisx.vsix` 528,379 字节，修改时间
  2026-08-11T14:22:43Z，SHA-256
  `9AE18D5EBAD326F2C01A53A25414A7619A5FACB5F0D380B435ED3247C577DEF5`，
  `cursor --install-extension --force` 安装成功；版本号仍为
  `0.0.0`，现有窗口需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-11 深夜再次打包并安装含历史对齐修复切片（user messageId
  锚点分段对齐）的构建：`droidvisx-0.0.0.vsix` 528,156 字节，修改
  时间 2026-08-11T14:38:53Z，SHA-256
  `0D1166F6EF9054E9485ABAC83FC440FC8EEEC92919F16E7160BAEDD685F11CEF`，
  `cursor --install-extension --force` 安装成功；版本号仍为 `0.0.0`，
  现有窗口需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-11 深夜再次打包并安装含活动 shimmer 打磨切片（单行闪烁、
  交互挂起停闪、状态文字 shimmer）的构建：`droidvisx-0.0.0.vsix`
  （8 files, 515.87 KB），`npx vsce package --no-dependencies` 与
  `cursor --install-extension --force` 均成功；版本号仍为 `0.0.0`，
  现有窗口需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-11 深夜再次打包并安装含**全保真日志改造切片**的构建：
  `droidvisx-0.0.0.vsix` 546,041 字节（9 files，新增 VSIX 内
  `docs/product/log-analysis-playbook.md` 供导出命令打包），修改
  时间 2026-08-11T15:24:06Z，SHA-256
  `C8FD511C244E51C7D41A6B762FADA1EBC5FB9C74349487ABC062BFEC213FB82F`，
  `cursor --install-extension --force` 安装成功；安装后已在新日志
  位置 `%APPDATA%\Cursor\User\globalStorage\droidvisx.droidvisx\logs\droidvisx-20260811.jsonl`
  确认真实激活记录落盘（含 `act`/`workspace`/全保真 attributes、
  `bootMs`、`runtime.history.finished`、`host.perf.recovery`）
- 2026-08-11 深夜再次打包并安装含**静态复查修复轮**（P1 污染检查点
  尾段复活 + `/` 目录 in-flight 世代化 + boot 看门狗残留清理 +
  `/` 弹窗断连重试）的构建：`droidvisx-0.0.0.vsix` 546,249 字节
  （9 files），修改时间 2026-08-11T15:45:35Z，SHA-256
  `36D4CD99D9777C89A30ED2F9E0AC6CD018E4258A252A1A2C43874559B4BFDD99`，
  `cursor --install-extension --force` 安装成功；版本号仍为
  `0.0.0`，现有窗口需 Reload Window（或完整重启）后加载新 Bundle；
  受影响的 ai-drawing 会话在重载后应显示 75 条而非 134 条
- 2026-08-11 深夜再次打包并安装含**收藏与分组切片**（Session
  Favorite 星标 + Favorites/Recent 分组）的构建：
  `dist/droidvisx.vsix` 547,484 字节，修改时间
  2026-08-11T16:39:34Z，SHA-256
  `82D63DC4042F143085FBCDC612B2314DC916678D04D584143D409E024C60CDA8`，
  `verify:vsix` 与 `cursor --install-extension --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含**恢复提速切片**（快照先行）的构建：
  `dist/droidvisx.vsix` 617,286 字节（9 files, 602.82 KB），SHA-256
  `ACCAAF3619A426D27EDDF7F2011AF5ADFCA54A0AA2250BF94A1949FB9E9AD108`，
  `npx vsce package --no-dependencies --out dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **daemon Phase 1 只读 sidecar 切片**
  （归档/取消归档/内容搜索）的构建：`dist/droidvisx.vsix`
  617,098 字节（9 files, 602.63 KB），SHA-256
  `9AE097FCB0E185CA544CDC5A7D65A90649DCCBF75CF6A83A9B5EC046FAFD3840`，
  `npx vsce package --no-dependencies` 与
  `cursor --install-extension --force` 均成功；Extension Bundle
  因引入 SDK daemon 客户端增至约 1.0 MB（`ws` 的可选原生加速器
  `bufferutil` / `utf-8-validate` 保持 external，`ws` 运行时以
  try/catch 回退 JS 实现）；版本号仍为 `0.0.0`，现有窗口需
  Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **daemon Phase 2 执行链路迁移切片**
  （可选 `droidvisx.runtime.mode` 配置）的构建：`dist/droidvisx.vsix`
  618,248 字节（9 files, 603.76 KB），SHA-256
  `9DDBBE0CB826E2560091D7542FD538F32F6157EAED9582FB6A85B81F6A849726`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **daemon Phase 3 Reload 存活基础设施
  切片**（脱管共享 daemon + 发现文件 + 租约 + shutdown 命令）的
  构建：`dist/droidvisx.vsix` 620,350 字节（9 files, 605.81 KB），
  SHA-256
  `DD706C7A2D97E6900C142839E04728E15689F569B32878B27AC66D393F81BBA1`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **切片③第一段：对话内图片显示** 的
  构建：`dist/droidvisx.vsix` 623,042 字节（9 files, 608.44 KB），
  SHA-256
  `7F5D77613812AE90826758DF88545F3BE2AFBA76C2E4360204E0DBF855C823FC`，
  `npx vsce package --no-dependencies` 与
  `cursor --install-extension dist/droidvisx.vsix --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **切片③第二段：Composer 拖拽/粘贴
  图片** 的构建：`dist/droidvisx.vsix` 623,826 字节（9 files,
  609.21 KB），SHA-256
  `49AB4B430594D80039491BAA425D5E18AB44BF2B46814CA56A22BEF089053AC4`，
  `npx vsce package --no-dependencies` 与
  `cursor --install-extension dist/droidvisx.vsix --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **切片 3+：消息卡片编辑重发** 的
  构建：`dist/droidvisx.vsix` 626,797 字节（9 files, 612.11 KB），
  SHA-256
  `6F50DE1326BCA76020D388CA7A55F013BB27A2F7278F110622BEBF90BE9E43EE`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force` 均成功；
  版本号仍为 `0.0.0`，现有窗口需 Reload Window（或完整重启）后
  加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **Streaming 批次一：Thinking
  shimmer + 过去式文案** 的构建：`dist/droidvisx.vsix` 626,967
  字节（9 files, 612.27 KB），SHA-256
  `2E322F4BFB18E33365CD967CD0833F3AB377B44D52A3B5D2C996293C5D2ED244`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 凌晨打包并安装含 **Streaming 批次二：工具活动聚合**
  的构建：`dist/droidvisx.vsix` 628,666 字节（9 files,
  613.93 KB），SHA-256
  `A430A1295CF239CF9B49298F1F02CA951607FF6CA258FD609F49DCAB847C0B82`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 上午打包并安装含 **Streaming 批次三：入场动画 +
  Todo 折叠** 的构建：`dist/droidvisx.vsix` 629,047 字节
  （9 files, 614.3 KB），SHA-256
  `01E62CB849D9AFCBDA38055D062D389E9321A0683FC6D94F6DB2E21F5486C9C0`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 上午打包并安装含 **消息卡片编辑态白卡片化** 的构建：
  `dist/droidvisx.vsix` 629,099 字节（9 files, 614.35 KB），SHA-256
  `08A690D33279BF7607ADD7F8AEEBAC9674A487386D2A048F92335B3EE69316BF`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 上午打包并安装含 **用户消息全宽块 + 吸顶 + 附件体验
  三项 + slash/mention 反馈 + 单一活跃指示** 的构建：
  `dist/droidvisx.vsix` 631,024 字节（9 files, 616.23 KB），SHA-256
  `7CEFD87B4802EAF2155F9DADE2CC9B0F08ABE243A968A15453C43942C7D0C0B2`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 上午打包并安装含 **滚动/吸顶/编辑卡/可选中/Compact
  十项修复批次** 的构建：`dist/droidvisx.vsix` 633,462 字节
  （9 files, 618.62 KB），SHA-256
  `6ED5D5626E4C2B98044752FE3A5BB95E36B0C800ECCBEE52936BFF34498B1BD1`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 中午打包并安装含 **验收后续三项修复批次（编辑卡随
  新消息自动关闭 + 行内代码样式调轻 + 编辑态吸顶豁免推挤）** 的
  构建：`dist/droidvisx.vsix` 634,337 字节（9 files, 619.47 KB），
  SHA-256
  `FCC70EB2CF5D6812FCFFE8655EDA175CFD82D9A37FFE3D352445FF648913B416`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 中午打包并安装含 **V1 切片④：完整 Spec Mode 闭环**
  的构建：`dist/droidvisx.vsix` 636,573 字节（9 files,
  621.65 KB），SHA-256
  `6CCE471DDBBA7595B72E2FE2ACC382F746D83BCFBFDD8765F2D45E735015629E`，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；版本号仍为 `0.0.0`，现有窗口
  需 Reload Window（或完整重启）后加载新 Bundle
- 2026-08-12 下午打包并安装含 **Spec/Compact/审批菜单/诊断卡样式
  收敛批次**（UI restraint + Visual bar 落地，见上文切片④可视化
  条目）的构建：`dist/droidvisx.vsix` 636,689 字节（9 files,
  621.77 KB），SHA-256
  `7A19D43D7D5408DBA103D8EE671E8AE57DBCCD8BACDAAFE6A049D011ACF7B9BD`，
  typecheck 三 tsconfig 全过、vitest 44 files / 1067 tests 全绿，
  `pnpm run package:vsix` 与
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功；现有窗口需 Reload Window 后
  加载新 Bundle

## 验证状态

最近记录的验证结果：

- V1 切片④「完整 Spec Mode 闭环」（2026-08-12 中午）：
  ① **32K 静默取消修复**：`ExitSpecMode` 计划改用
  `MAX_SPEC_PLAN_LENGTH = 262,144` 专属上限，Runtime 对超限计划
  截断显示而非取消审批；`runtimeInteractions.test.ts` 回归构造
  65K 与超 256K 计划、`validateHostMessage.test.ts` 回归构造超
  32K 计划过桥且按 kind 区分上限。② **Spec 起草覆盖**：
  Bridge/Runtime/Host/Webview 全链路 `specModeModelId` /
  `specModeReasoningEffort`（null 重置），Host 按起草模型（而非
  Session 模型）校验 Spec 推理力度（`ChatController.test.ts`）。
  ③ **实现 Session 收养**：`proceed_new_session*` 批准后 Runtime
  监听通知双信号发 `spec-handoff` 事件，Host 回合结束按替换机制
  收养实现 Session；信号缺失降级可见 warning
  （`spec-handoff-not-detected`），两条路径均有 Host 测试。
  ④ **headless 冒烟**（`artifacts/smoke-spec-flow.mjs` +
  `spec-flow-harness.html`，pass=true）：Spec 徽标可见 → 发送起草
  提示 → 流式 Markdown 渲染 → 34,002 字符计划卡渲染（未被吞）→
  View full spec 展开可见第 299 节 → Approve plan 发出
  `permission.respond proceed_new_session` → 卡片关闭 +
  `spec-handoff-detected` info 诊断入流。⑤ **120 回合 stress 复测**
  （`run-stress-batch3.mjs`，stress-harness 补齐新 settings 字段）：
  快照后流式期间 0 个 50ms+ 长任务（仅初始 paint 3 个，与基线
  一致）。⑥ 门禁：typecheck 通过、44 files / 1067 tests 通过
  （+17）、build/package/install 成功；截图
  `artifacts/spec-flow-card.png`。

- 验收后续三项修复批次（2026-08-12 中午，用户验收报告的编辑卡不
  自动关闭、灰色方框观感、吸顶块被顶出屏幕三项，一批修复）：
  ① **编辑卡不自动关闭**根因：`editingMessageId` 编辑态只在
  Cancel/Escape/切换编辑目标/提交 resend 时清除，底部 Composer
  发送新消息（`handleSend`）与它没有任何联动，上方打开的编辑卡
  会一直保持展开。修复：App.tsx 每次 `turn.send` 成功提交时递增
  `sendSignal` 计数器传入 DroidThread；thread 侧 effect 检测到
  变化即丢弃编辑草稿、`editStage.cancel` 回收 host 编辑暂存区并
  把卡退回静止态（发新消息是用户放弃该编辑的明确信号）。
  App.test.tsx 新增回归：打开编辑卡 → Composer 发送 → 编辑
  textarea 消失 + `editStage.cancel` 已发出 + 原文回显。
  ② **灰色方框观感**根因：Droid 回复正文里成列的 `[0:73]` 式
  行内代码引用标记（逐段一个 inline code）命中通用行内代码样式
  `.dvx-markdown :not(pre) > code` 的 1px #ded6cc 边框 + 不透明
  底色 + 纵向 padding；而 `--dvx-code`(#f7f5f1) 与表面色
  (#f5f3ef) 几乎同色，"灰方框"观感几乎全部来自边框，成列堆叠
  非常刺眼。修复（按原则只调通用样式、不做语义特判）：去边框、
  换 6.5% 墨色半透明衬底、去纵向 padding（不再撑破行盒）、圆角
  5→4px；forced-colors 下补 1px CanvasText 边框保留高对比辨识；
  `.dvx-path-link` 点击 affordance（点状下划线）不受影响。
  harness 同内容截图回归
  （artifacts/verify-inline-code-markers.png）。
  ③ **吸顶块被顶出屏幕**根因：`computeStickyLayout` 的推挤手交
  （pushPx = 视口顶 + pinned 高度 − 下一条 top，cap 于自身
  高度）是为 line-clamp 6 行的静止块设计的，推挤窗口只有几十
  px；编辑态白卡高数百 px 时，下一条用户消息接近的整段滚动区间
  里卡片被 `translateY` 上移到只剩底部控制行 + hint（用户附图
  现场）。修复：编辑态豁免推挤——UserMessage 编辑时根元素挂
  `.dvx-message-editing`，吸顶协调器把该索引作为新参
  `editingIndex` 传入 `computeStickyLayout`：pinnedIndex ≥
  editingIndex 时编辑卡独占 pinned 槽（pushPx 恒 0，完整吸顶
  可见），其他到达视口顶的条目一律 covered 隐藏、不接管吸顶；
  编辑器仍在 pinned 之下时行为完全不变。Thread.test.tsx 新增
  4 个边界测试（手交中不推挤、深滚动仍由编辑卡持有 pin、编辑器
  在下方时照常推挤、全部在视口下方时无 pin）。新增
  artifacts/sticky-edit-harness.html（长会话 + 顶部消息编辑态 +
  滚动）headless 截图验证：手交与深滚动场景编辑卡均完整吸顶
  可见（artifacts/verify-sticky-edit-handoff.png /
  verify-sticky-edit-deep-scroll.png）。
  门禁：typecheck 通过；vitest 44 files / 1050 tests 全绿（基线
  1045 +5）；build 成功；vsce package 9 files, 619.47 KB；
  cursor --install-extension successfully installed。遗留：三项
  以用户在真实 Cursor Reload 后的可见验收为准。
- 滚动/吸顶/编辑卡/可选中/Compact 十项修复批次（2026-08-12 上午，
  用户 Reload 验收后连续报告的十个问题，一批修复）：
  ① **空转录可滚**根因：`.dvx-reading-column` 的
  `min-height: calc(100% - 126px)`（及 `.dvx-thread-pending` 变体
  `calc(100% - 99px)`）硬编码 footer 高度假设，多行草稿把 footer
  撑过 126px 时列高 + footer 超出视口（headless 实测幽灵溢出
  141px）。修复：视口改 flex column（阅读列 `flex: 1 1 auto`、
  footer `flex: 0 0 auto`、空态 `flex: 1`），删除两处 min-height
  hack；复测空态与多行草稿 overflow 均为 0。
  ② **自动跟底断**根因：assistant-ui
  `useThreadViewportAutoScroll` 的 isAtBottom 记账存在竞态——它
  自己的粘底 scrollTo 产生的异步 scroll 事件晚于下一波内容增长
  到达时，事件里 scrollTop 未变而 scrollHeight 已涨，被记为
  "用户上滚"，永久关闭跟随（trace 复现：二次导航场景 dist 持续
  增长到 700+）。修复：`autoScroll={false}` 停用库的连续跟随，
  跟随权移交 Thread.tsx 吸顶协调器——新增纯函数
  `createFollowState`/`applyFollowScroll`：仅"真实上滚"
  （scrollTop 下降且非内容收缩 clamp）解除跟随；协调器自己的
  粘底写入打 `pendingProgrammaticTop` 标记、事件到达即消费，
  永不误判；回底重挂 = 距底 ≤4px（FOLLOW_REJOIN_PX）或
  "下滚到达上一次底部"（后者对回底途中又有内容流入的竞态免疫）；
  wheel deltaY<0 兜底解除。增长粘底由 ResizeObserver（阅读列 +
  footer，覆盖 150ms 高度过渡与 Composer 变高）驱动。复测：
  untouched 全 0、上滚暂停（距离持续增长）、回底重挂
  （21→0…0）、二次导航流式全程距底 0。
  ③ **吸顶文字透叠**根因：pinned 块浅色底 + 下一条用户消息顶上
  来时无推挤逻辑，两条文字直接层叠。修复：协调器改
  `computeStickyLayout`（pinned 索引 + covered 集合 + pushPx），
  下一条顶到 pinned 底边时对 pinned 施加 `translateY(-pushPx)`
  干净推出（cap 于自身高度），配合 ⑦ 的不透明白底与
  `[data-pinned] z-index: 3`（sticky 恒建层叠上下文，保证吸顶
  编辑卡的弹出层不被后续 sticky 行盖住）；截图验证推挤无透叠。
  ④ **编辑卡去圆环**：`ComposerControls` 新增 `showContext`
  prop（默认 true），编辑卡传 false，环形指示与 context 面板仅
  留在底部 Composer。
  ⑤ **编辑卡橙色丢失**根因：styles.css 后段共享块
  `.dvx-context-ring-track, .dvx-context-ring-value
  { stroke: #e4d7cf }` 覆盖了前段 `.dvx-context-ring-value
  { stroke: var(--dvx-accent) }`（同特异性、后者居后生效），
  全局（含底部 Composer）环弧都变灰米色；展开面板发灰是 ⑥ 的
  裁剪表象。修复：共享块只留 fill/stroke-width，value 的 accent
  描边在其后重申；截图确认橙色弧恢复。
  ⑥ **吸顶时弹出层向上飞出**根因：`.dvx-composer-popover` 为底部
  Composer 写死 `bottom: calc(100% + 8px)` 向上展开，编辑卡吸顶
  在视口顶部时整个面板超出滚动容器上缘被裁掉。修复：开面板时
  量测控制行 rect，`shouldOpenPopoverDown(spaceAbove,
  spaceBelow)`（上方 <340px 且下方更宽裕）时给控制行挂
  `.dvx-controls-down`，弹出层翻转为 `top: calc(100% + 8px)` 向下
  展开；截图确认模型面板完整可见。
  ⑦ **静止态用户块白底**：`.dvx-user-block` 改 `#fff` 底 +
  `var(--dvx-border)` 边框（与底部 Composer 同基调），hover/
  focus-visible 以 border-strong + 阴影保留可点击 affordance；
  pinned 态外层仍为 surface 底 + 分隔阴影，无透叠回归。
  ⑧ **user-select 治理**：容器级 `user-select: none` 覆盖 UI
  骨架（header、thread-footer、会话抽屉、弹出层、command/mention
  popup、空态、pending 状态行、活动行 summary、聚合组头、plan
  折叠头、changes 条、交互 eyebrow/queue/actions、permission
  菜单、hint、编辑卡 footer/附件行/驳回行、已发送附件 chips、
  compact 分隔卡，外加 `.dvx-shell button` 全局禁选），白名单
  恢复 `user-select: text`（Composer/编辑 textarea、工具行内联
  命令详情）；消息正文、代码块、工具输出保持默认可选。headless
  计算样式抽查 13 处（hint/状态行/模式触发器/context %/正文/
  命令详情等）全部符合预期。
  ⑨ **restore 勾选框重设计**：自绘 14px 圆角勾选控件（选中态
  `--dvx-accent` 底 + 白勾，hover 边框转 accent，原生 input 视觉
  隐藏但保留焦点与键盘切换，focus-visible 描边），11px muted
  文案缩短为 "Restore N files changed after this point"，完整
  解释移入 title tooltip，行内 hover 背景反馈；位置仍在控制行
  上方贴近处、与卡内边距对齐，`affectedFiles > 0` 出现条件不变。
  ⑩ **Compact 三项**：10a 按钮反馈——`App.tsx` 新增
  `compactPending` latch（两个入口共用：点击即置位并忽略重复
  点击；会话切换（成功路径 adopt continuation session）、任一
  `session-compact*` 诊断（blocked/unsupported/failed/成功
  通知）或 30s 超时清除；断连也清除），按钮 pending 态
  disabled + spinner + "Compacting…"（aria-busy）。10b 链路
  结论——`/compact` 此前作为普通 `turn.send` 文本发给 Droid
  CLI：CLI 以对话口吻确认"压缩成功"，但我们扩展从不 adopt
  continuation session、也不刷新 context 统计，而按钮路径走
  `session.compact` RPC → `performCompact` → 换会话 + 重载
  转录 + `refreshContextAfterTurn`，因此"命令报成功但 % 不变、
  按钮才真生效"；修复在 Webview 侧：`handleSend` 拦截
  `^/compact$`（大小写不敏感、允许空白）改走与按钮完全相同的
  `session.compact` RPC 并清空草稿，两条路径行为一致；
  `ChatController.ts` 无需改动（该文件当前有另一代理的未提交
  改动，本批次未触碰）。10c 压缩提示条——`session-compacted`
  诊断不再渲染灰底通知条，改为 Cursor 风格居中分隔卡
  `.dvx-compact-divider`（两侧细线 + 小图标 + "Summarized N
  earlier messages"，单复数与无计数回退处理），历史加载走同一
  渲染路径自动生效；截图验证分隔卡与 Compacting… 态。
  新增聚焦测试：`applyFollowScroll`（增长竞态保持、真实上滚
  解除、收缩 clamp 不解除、回底重挂、回底竞态重挂、程序化标记
  消费）、`computeStickyLayout`（covered/推挤/cap/远离不推）、
  `formatCompactDividerLabel`、`shouldOpenPopoverDown`、
  ComposerControls compactPending 态与 showContext=false、App
  `/compact` 路由（posts session.compact、零 turn.send、草稿
  清空、pending 去重）。门禁：typecheck 三 tsconfig 全过，
  vitest 44 files / 1040 tests 全绿，build + package + install
  成功（同批打包条目）；headless Chrome 视觉复测七组截图/度量
  留存 `artifacts/tmp/`（复现与验证脚本
  `artifacts/repro-scroll-bugs.mjs`、`repro-scroll-trace.mjs`、
  `shot.mjs`、`eval-page.mjs`）。用户尚未在真实 Cursor 中完成
  Reload 后的最终可见验收
- slash/mention 弹窗可见性修复 + 活跃指示去重（2026-08-12 上午，
  用户实测 `/` 与 `@` "完全没反应"、"Droid is working" 与活跃工具
  行双重 shimmer；只读调查确认 Bridge/Host/Runtime 链路健在，
  问题全在 `Thread.tsx` UI 判定）：① `/` 弹窗在 ready 且目录为空
  时不再整体隐藏——`slashVisible` 只要求状态非 idle/unsupported，
  空列表显示单行空态 "No custom commands (.factory/commands)"
  （query 非空时为 "No matching commands"，loading 时为
  "Loading commands…"，与 slash-commands-design.md §3 一致）；
  ② `findMentionToken` 放宽 preceding 判定为"前一字符非
  `[A-Za-z0-9_@.-]` 即可触发"，中文句子后直接 `@`（如
  "帮我看看@src"）正常出 token，email（`user@host`）与 `@@`
  仍不触发；③ `@` 弹窗补 "Searching files…"（从首个查询字符到
  host 应答，覆盖 150ms 防抖窗口）与 "No matching files" 空态；
  ④ 活跃指示去重——`App.tsx` 由转录派生 `activityLive`（存在
  running 工具行或 active thinking 块），传入 `PendingResponse`：
  活跃行在 shimmer 时底部状态行静态显示（`.dvx-pending-label`
  纯色文字 + 圆点停止脉动），无活跃行时恢复 shimmer，保证每回合
  最多一个活跃指示。单测：CJK/email/`@@` mention 触发用例、
  PendingResponse 静态/发光两态、App 集成（slash 空态、mention
  搜索中→无匹配、running 工具行时状态行不带 shimmer 类、完成后
  恢复）。门禁：typecheck 三 tsconfig 全过、vitest 43 files /
  969 tests 全绿、build + package + install 成功（与下条同批）
- 用户消息 Cursor 式全宽块 + 吸顶 + 附件体验三项（2026-08-12
  上午，用户验收规格：静止态改为撑满阅读列、左对齐、浅底色的
  全宽块，点击整块进入编辑，Copy/Reuse/Edit 动作条删除；滚动时
  用户消息吸附在转录视口顶部；附件 chip 排布自然化、图片缩略图
  预览、非图片文件可拖入）：**全宽三态**——静止态
  `.dvx-user-block`（width 100%、`--dvx-user` 底色、8px 圆角、
  左对齐，可编辑时 role=button + hover/focus-visible affordance，
  点击/Enter/Space 进入编辑；文本 `.dvx-user-text` 非编辑态
  line-clamp 6 行防超长吸顶占半屏）；编辑态沿用全宽白卡
  `.dvx-user-edit-card`（与底部 Composer 同规格同宽）；resending
  态同为全宽块 + 卡外左下 "Resending from here…" note。旧的
  `.dvx-user-bubble` 靠右气泡 CSS（`align-items: flex-end`、
  `max-width` 85%、`padding-left` 9%/12%）与 `.dvx-user-actions`
  动作条（Copy/Reuse/Edit 按钮、双击复用逻辑）全部移除。
  **吸顶**——`.dvx-message-user` 挂 `position: sticky; top: 0`
  （滚动容器 `.dvx-thread-viewport` 是唯一 overflow 链，入场动画
  transform 挂在内层消息块不破坏 sticky）；`Thread.tsx` 吸顶
  协调器（rAF 节流 scroll/resize + ResizeObserver +
  MutationObserver）按 `computePinnedUserIndex`（最后一条 top 达
  视口顶的用户消息）给吸顶行挂 `data-pinned`（不透明底色 +
  底部细阴影盖住下方滚动正文）、被顶走的行挂 `data-covered`
  （visibility hidden 防层叠堆积）。**附件三项**——① chips 行
  移入输入区上方独立行（8px gap、卡内边距对齐 Cursor 排布）；
  ② 图片缩略图：新模块 `imagePreviewCache.ts`（Webview 端
  LRU≤24，键 name+size；drop/paste 时暂存 dataUrl，不过 Bridge）
  供 `AttachmentChip` 渲染 44px 圆角缩略图 + hover × 移除，
  host 侧 file picker 来源无字节则回退文字 chip；③ 文件拖入：
  Composer drop 按 `text/uri-list`/`application/vnd.code.uri-list`
  （编辑器资源管理器拖拽，走新 Bridge 消息 `attachment.addUris`，
  host 端 `fileURLToPath` + 工作区内校验后复用
  `readWorkspaceFile` staging 链，工作区外 URI 发
  attachment-outside-workspace 诊断）与 `DataTransfer.files`
  （系统资源管理器拖拽：图片走既有 addImage，非图片 Webview 端
  读文本、null 字节判二进制、262,144 字符截断后走新 Bridge 消息
  `attachment.addTextFile`）分流；不支持类型/超限/暂存区满均有
  `.dvx-composer-notice` 短暂提示（4s），不再无声无息。Bridge
  两条新消息双向校验齐备（uris ≤8 条、≤2048 字符、仅 file://、
  控制字符拒收；text ≤262,144 字符、拒 null 字节，validator
  正反用例 +17）。测试：App.test 动作条测试改写为"点击块发
  editStage.begin"、readDroppedFileUris（CRLF/注释/JSON 回退/
  过滤非 file 与超长）、computePinnedUserIndex、AttachmentChip
  缩略图/回退/移除、imagePreviewCache 键与 LRU 驱逐、
  ChatController addUris 工作区内外分流与 addTextFile staging→
  sendTurn 透传。门禁：typecheck 三 tsconfig 全过；vitest 43
  files / 969 tests 全绿（933→969，+36）；build 成功；
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix`
  631,024 字节（9 files, 616.23 KB）SHA-256
  `7CEFD87B4802EAF2155F9DADE2CC9B0F08ABE243A968A15453C43942C7D0C0B2`；
  `cursor --install-extension dist/droidvisx.vsix --force`
  successfully installed。吸顶后长任务复测（2026-08-12，
  `artifacts/run-stress-sticky.mjs`，headless Chrome 对 7c37acc
  构建跑 ?turns=120）：流式 8 秒期间 50ms+ 长任务 0 个（仅首屏
  bundle 解析/快照绘制既有 3 个，同批次三基线）；吸顶特有滚动
  场景（scrollTop 程序化扫全转录 2 个来回 ×800 帧，默认 60 条
  窗口 30 条用户消息与 Show earlier 全量展开 120 条各跑一遍）
  长任务均为 0，协调器单次测量成本 0.04–0.18ms——红线守住。
  附带观察：Show earlier 展开点击本身有 309/404ms 两个渲染长
  任务，属既有窗口展开挂载成本，与吸顶协调器无关。遗留：编辑态
  吸顶的视觉细节以 Cursor 内实际打开验证为准
- 消息卡片编辑态白卡片化（2026-08-12 上午，用户验收反馈：编辑态
  应与底部 Composer 同为白卡片而非灰气泡）：纯 Webview 视觉修正，
  零 Bridge 改动。`Thread.tsx` 编辑态 JSX 加 `.dvx-user-edit-card`
  卡片壳（textarea、附件 chips、拒绝提示、restore 勾选、
  ComposerControls + Cancel/Send footer 全部收进卡内），
  "Resending starts a new conversation branch" 提示移到卡片外
  下方（对应底部 Composer 的 "Enter to send" 提示位置，居中
  灰字）。`styles.css` 中卡片壳复用 `.dvx-composer` 同规格
  （白底 / `--dvx-border` 1px 边框 / 12px 圆角 / 同款阴影 /
  10px 内边距 / focus-within 边框加深），textarea 改为卡内
  无边框透明输入区。门禁：typecheck 三 tsconfig 全过、vitest
  43 files / 933 tests 全绿、build + package + install 成功
- Streaming 体验批次三：入场动画 + 回放静默 + Todo 折叠摘要
  （2026-08-12 上午，按 `docs/product/streaming-experience-design.md`
  D 项与 E 项，纯 Webview 零 Bridge 改动；本条为前任代理中断工作
  的收尾——其 4 个未提交 src 改动经评估结构完整、直接续用，本轮
  补齐 `formatPlanSummary` 单测并跑通全部门禁）：**D 入场动画**
  双重门控——`App.tsx` 仅当 `connection.status === 'connected'`
  且 `isTurnActive(state.turn)` 时在 `.dvx-shell` 挂根类
  `dvx-anim-live`（opt-in，等价 Cursor no-entry-animations 反相
  开关）；`AssistantMessage` 以 `useAuiState` 的
  `message.status?.type === 'running'` 给唯一流式消息挂
  `dvx-message-live`，入场 CSS 全部要求两类同时命中：正文块
  `dvx-entry-rise`（淡入 + 4px 上移，200ms ease-out）、工具行/
  聚合组 `dvx-entry-fade`（100ms）。恢复快照（connecting 不挂
  类）、权威快照替换与 reconcile（无活跃 turn）、会话切换 /
  Show earlier、以及活跃 turn 中挂类瞬间的既有历史（无
  message-live）一律静默。action bar（hideWhenRunning，挂载时
  根类可能已摘除）改用消息级 `wasRunningRef`"本次挂载曾流式"
  门控淡入 `dvx-actions-entry`（150ms），历史恢复永不满足。
  **E Todo 折叠**——task-plan 行收起态 summary 追加
  `formatPlanSummary`：`3/7 · <当前 in_progress 项>`（无
  in_progress 时退到首个 pending，全完成只显计数，firstLine
  120 字符截断，`.dvx-plan-summary` ellipsis）；展开由
  `dvx-disclose-in` 改为 `dvx-plan-open`（max-height 0→500px
  300ms strong-out + opacity 200ms）；`.dvx-plan-step` 挂
  `dvx-todo-fade-in`（淡入 + 2px 上移 200ms），key 沿用 index，
  计划更新仅新增尾项重播。新增动效全为 animation，被既有
  reduced-motion 全局 kill（`animation-duration: 0.001ms`）
  覆盖，无新增 transition 故无需 `transition-property` 补丁。
  单测 +5（`formatPlanSummary`：进行中项、pending 回退、全完成、
  120 字符截断、空输入 null）。**无头冒烟**
  `node artifacts/smoke-entry-anim.mjs`（配
  `artifacts/entry-anim-harness.html`，双回合转录：turn-1 历史
  含计划行，turn-2 流式；`#idle` 变体同转录 turn: null）：live
  态 shell 挂 `dvx-anim-live`、流式消息正文 animationName
  `dvx-entry-rise`、工具行 `dvx-entry-fade`，历史消息两者均
  `none`；历史计划行收起摘要 `1/3 · Design the API`，展开后
  animationName 含 `dvx-plan-open` + 步骤 `dvx-todo-fade-in` 且
  摘要消失；`window.__completeTurn()` 后根类摘除、action bar
  `dvx-entry-fade`；reduced-motion 仿真步骤 animationDuration
  1e-06s（=0.001ms，冒烟脚本原断言字符串 `0.001ms` 与 Chrome
  序列化不符，改为数值比较）；`#idle` 变体根类不挂、零
  live 消息、正文 `none`，**PASS**。**长会话性能红线复测**
  `node artifacts/run-stress-batch3.mjs`（stress-harness
  ?turns=120 流式 8 秒）：流式期间 50ms+ 长任务 0 个（仅初始
  bundle 解析与首屏快照绘制各 1 次，为既有行为），**PASS**。
  门禁：typecheck 三 tsconfig 全过；test 43 files / 933 tests
  全绿；build、`npx vsce package --no-dependencies -o
  dist/droidvisx.vsix`（614.3 KB）、
  `cursor --install-extension dist/droidvisx.vsix --force`
  （successfully installed）均成功。已知边界（照设计如实记录）：
  reconcile 恰在活跃 turn 中途整体替换转录时，running 消息的新块
  会重播一次入场动画，V1 接受。streaming-experience-design 三批
  至此全部落地；tier1 §1（流式命令输出预览）为独立保留项未开工。
- Streaming 体验批次二：工具活动聚合（2026-08-12 凌晨，按
  `docs/product/streaming-experience-design.md` A 项与
  `activity-aggregation-research.md` 证据，纯 Webview 零 Bridge
  改动）：新增纯函数模块
  `src/webview/assistant/activityGrouping.ts`——探索类工具语义
  分类（read→file、grep/glob/websearch→search、ls→folder、
  fetchurl→fetch、taskoutput→task-check、skill→skill；execute/
  edit/todowrite/交互/未知工具一律不可分组），复用
  `toolActivity.ts` 新抽出的 `toolNameCandidates`（全名 + 命名
  空间叶名归一化）保证与动作摘要分类永不漂移；
  `activityGroupBy` 供 `MessagePrimitive.GroupedParts`（core
  0.3.11 邻接聚合原语，组树按消息 `useMemo`、组节点 key 取首
  成员 toolCallId 流式追加稳定）做序列连续性分组；**穿插短
  Thinking（≤200 字符且 ≤2 行）吞入组、长 reasoning 与全部
  text/data/交互块切组（决策：设计文档 V1 原本不吞 thinking，
  按用户 2026-08-12 凌晨点名的"短 Thinking 吞组"实施，上限贴近
  Cursor 短文本规则）**；成组门槛 = 总成员 ≥3 且真实工具 ≥2
  （纯读 3 条即成组，纯 thinking 永不成组）。
  `summarizeActivityGroup` 输出真实语义计数摘要（
  `"3 files, 2 searches"`，file 类按 filePath 去重、唯一已知
  文件显示文件名），耗时求和、failed/stopped 计数。`Thread.tsx`
  `AssistantMessage` 由 `MessagePrimitive.Parts` 迁移到
  `GroupedParts`（`indicator="never"` 保持现状），新增
  `ActivityGroup` 两态组件：running 态组头 `Exploring` 套既有
  `.dvx-shimmer-text` shimmer + 有界预览窗（max-height 144px、
  顶部 28px 渐隐蒙版、scroll-behavior smooth 自动滚到最新，
  reduced-motion 下全局规则已强制 auto）；完成态收成
  `Explored 3 files, 2 searches · 3.6s` 按钮行（aria-expanded），
  点击经 grid-template-rows 0fr→1fr 的
  `var(--dvx-duration-normal)`（150ms）过渡展开明细，明细行
  复用既有 `ToolActivityRow`/`ThinkingRow`（耗时/detail/filePath
  chip 全保留）；低于门槛的组原样渲染普通行。shimmer 不变式
  扩展：预览窗内成员行与吞入 thinking 全部静默（每回合至多组头
  一个 shimmer），`.dvx-thread-pending` 抑制组头 shimmer，
  reduced-motion 显式 `transition-property: none` 覆盖新增过渡。
  恢复历史直接挂载为收起摘要态（不播动画，冒烟实证）。单测
  +15（`activityGrouping.test.ts`：分类、吞组阈值、成组门槛、
  running/failed/stopped 汇总、filePath 去重与单文件名）；
  `toolActivity.ts` 重构后既有套件全绿。**无头冒烟**
  `node artifacts/smoke-activity-group.mjs`（配
  `artifacts/activity-group-harness.html`，三回合转录：5 工具
  完成组 / 2 工具低于门槛 / 2 完成 + 短 thinking + 1 running）：
  历史组挂载即收起摘要 `Explored 3 files, 2 searches` + `3.6s`
  且 grid-rows 为 0px；点击展开 aria-expanded=true 且 grid-rows
  变化；running 组组头 animationName `dvx-activity-shimmer` 而
  预览窗内 shimmer 计数 0、max-height 144px；`dvx-thread-pending`
  加类后组头 `none`、移除恢复；reduced-motion 仿真下组头 `none`
  且明细过渡 transition-property `none`；低门槛回合 2 行普通行
  无组壳，**PASS**。长会话性能：分组由原语按消息 `useMemo`
  （依赖 parts 数组身份），完成组明细 DOM 与既有逐行渲染等量，
  未引入整树重算。门禁：typecheck 三 tsconfig 全过；test
  43 files / 928 tests 全绿；build、`npx vsce package`
  （613.93 KB）、`cursor --install-extension --force`
  （successfully installed）均成功。批次三（入场动画 + Todo
  折叠）见上方条目。
- Streaming 体验批次一：Thinking shimmer + 过去式文案 + 动效
  token（2026-08-12 凌晨，按
  `docs/product/streaming-experience-design.md` §2-B 与统一前置
  H 项，纯 Webview）：`styles.css` `.dvx-shell` 变量块新增动效
  token 表（`--dvx-duration-instant/fast/normal/slow/slower` +
  `--dvx-easing-out-strong`），`.dvx-activity-chevron` 过渡迁移为
  token 引用（300ms ease-out → 150ms strong-out）；`ThinkingRow`
  running 态标签包 `.dvx-shimmer-text` 复用既有 1.6s 暖色 shimmer
  （风格差异不对齐 Cursor 2s，照设计判定），完成态由
  `Thinking` + `complete · 3.2s` 改为一体过去式
  `formatThinkingLabel`——`<500ms → "Thought briefly"`、
  `<1s → "Thought for 0.7s"`（一位小数）、`≥1s` 取整秒
  `"Thought for 3s"` / `"Thought for 1m 12s"`、durationMs 缺失
  降级 `"Thought"`、incomplete → `"Thinking stopped"`（决策：
  设计文字说复用 `formatDuration`，但其 <10s 输出一位小数与验收
  标准的 `"Thought for 3s"` 冲突，按验收标准自实现取整，<1s
  分支与 Cursor 参考行为一致）；`formatPartStatus` 唯一调用点
  消失随之删除；交互等待抑制规则扩展
  `.dvx-thread-pending .dvx-thinking-row .dvx-shimmer-text`，
  reduced-motion 由既有 `.dvx-shimmer-text` 规则天然覆盖。单测
  +3（`formatThinkingLabel` 边界）并修正 `App.test.tsx` 对完成
  态标签的旧断言（42 files / 913 tests 全绿）。**无头冒烟**
  `node artifacts/smoke-thinking-shimmer.mjs`（配
  `artifacts/thinking-shimmer-harness.html`，三条 thinking 转录：
  3240ms 完成 / 320ms 完成 / active）：标签
  `["Thought for 3s","Thought briefly","Thinking"]`；running 标签
  `getComputedStyle().animationName === 'dvx-activity-shimmer'`；
  加 `dvx-thread-pending` 类后 animationName `none`、移除后恢复；
  `prefers-reduced-motion: reduce` 仿真下 `none`，**PASS**。
  门禁：typecheck 三 tsconfig 全过；test 42/913 全过；build、
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix`
  （612.27 KB）、`cursor --install-extension --force`
  （successfully installed）均成功。批次二/三（活动聚合、入场
  动画与回放静默）未开工。
- 切片 3+：消息卡片编辑重发（2026-08-12 凌晨，按
  `docs/product/message-card-design.md` §5 分层实施）：**Bridge**
  先冻结——`UserTranscriptItem` 扩展有界 `attachments`
  元数据（`SentAttachmentSummary { kind, name, sizeBytes }`，
  ≤8 项、名 ≤128、图片不占条目由 image 转录项承担）；七种
  `attachment.*` W→H 消息加可选 `stage:'edit'` 字面量；新增
  `editStage.begin/cancel`、`session.editAttachments`
  （`EditAttachmentSummary.restorable`）与结构化拒绝
  `turn.editResendRejected`（reason 白名单
  busy/unsupported/failed）；双侧校验器同一变更补齐 + 敌对输入
  单测（`validateMessage.test.ts` 187 tests、
  `validateHostMessage.test.ts` 206 tests，非法 stage、restorable
  非布尔、reason 越权、chips 超长/带载荷/空名均整条拒绝）。
  **Host**（`ChatController.ts`）——`handleSend` 在消费暂存时把
  非图片附件元数据投影进用户转录项；`sentAttachments` 原附件
  保留区 `Map<messageId, PendingAttachment[]>`（`user.message-meta`
  到达时入库，总载荷字节 ≤32MB 按插入序驱逐，仅内存不进恢复
  检查点）；`editStage` 编辑暂存区与 Composer 暂存并存互不读写，
  `editStage.begin` 从保留区预填（驱逐/重启后由 chips 元数据 +
  转录中仍带完整 base64 的 user-echo 图片重建，缺载荷者标
  `restorable:false` 只可删除）；`turn.editResend` 消费编辑暂存中
  可复原条目经 `handleSend` 附件覆盖入口随 fork 发送，三个拒绝点 +
  rewind 失败点补发结构化拒绝（失败不清编辑暂存）；
  `SessionRecoveryStore` 与 `reconcileSessionHistory` 让 chips
  元数据跨重启存活（锚点匹配时 recovered 侧元数据合并到 loaded
  权威项）。聚焦单测 +5（chips 回显/编辑暂存/edit 移除/结构化
  拒绝 busy+unsupported/32MB 驱逐 restorable 降级，
  `ChatController.test.ts` 96 tests）。**Webview**——
  `runtimeAdapter.ts` 把 attachments 挂进消息 metadata；
  `Thread.tsx` `UserMessage` 重做为卡片状态机
  viewing→editing→resending（单击卡片展开编辑、选中文本不触发、
  无 messageId 保持双击 Reuse 退化；编辑卡 = textarea + 编辑暂存
  chips 行（restorable:false 弱化虚线 + "re-add to include"）+
  restoreFiles 勾选 + 第二实例 `ComposerControls`（attach 类回调
  注入 `stage:'edit'`，settings 即时提交与底部同源）+ 圆形
  `dvx-send-action` 发送按钮；旧裸 textarea 编辑分支同变更删除，
  Enter/Escape/Copy/Reuse 保留）；thread 级 `editingMessageId`
  单编辑态互斥（切换目标先 `editStage.cancel`）；收到
  `turn.editResendRejected` 即时回编辑态并显示原因文案、编辑草稿
  与暂存不丢，8 秒定时器降级为兜底。**无头冒烟**
  `node artifacts/smoke-edit-resend.mjs`（配
  `artifacts/edit-resend-harness.html`，mock host 回发编辑暂存与
  busy 拒绝）：sent chips ×2 渲染 → 单击卡片发出
  `editStage.begin` → 编辑 chips ×2（1 条 unrestorable）→ 删除
  发 `attachment.remove stage:'edit'` → 改稿点发送发出
  `turn.editResend`（文本为改后稿）→ busy 拒绝后编辑器重开、
  原因行显示、草稿保留，**PASS**。门禁：`pnpm run typecheck`
  三 tsconfig 全过；`pnpm run test` 42 files / 910 tests 全过
  （较切片③第二段 +22）；build、
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix`
  （612.11 KB）、`cursor --install-extension --force` 均成功。
  设计权衡照 §6 如实接受：编辑态换 Mode/Model 为会话级即时提交
  （拒绝后不自动回退）；纯 loadSession 重建的旧消息无非图片
  chips；原附件跨重启显示"需重新添加"。真实 Cursor 可见验收待
  用户 Reload Window 后进行。
- V1 切片③第二段：Composer 拖拽/粘贴图片（2026-08-12 凌晨）：预研
  证实设计期望的 `attachment.addBlob` 不存在，按预研新增
  `attachment.addImage { sessionId, name, mediaType, dataBase64 }`
  Webview→Host 消息（唯一携带二进制内容的上行消息）：
  `validateMessage.ts` 解析器 exact-keys、mediaType 白名单 4 值、
  name ≤128 无控制字符、base64 字符集正则 + 补位（len%4==0）+
  长度 ≤ 5,592,408（4MB 原文件对应的 base64 上限），敌对输入单测
  8 例（SVG 伪装、data URI 整串、错误补位、空载荷、超限、控制字符
  名、空名、多余键）加入 `validateMessage.test.ts`（206 tests 过）。
  Host：`ChatController.handleAttachmentAddImage` 复用
  `canStageAttachments` / 8 个暂存槽上限 / `stageAttachmentPayloads`
  管道，解码尺寸二次校验 > 4MB 发 `attachment-rejected` 结构化
  诊断；发送经既有 `sendTurn(text, attachments)` 投影 `images`，
  聚焦单测 1 例（暂存→拒绝超限→随回合发送→清空）。Webview：
  Composer（`Thread.tsx`）在 `ComposerPrimitive.Root` 加
  onDragOver/onDragLeave/onDrop（仅 Files 拖拽激活
  `dvx-composer-dragover` 虚线高亮），Input 加 onPaste（仅剪贴板
  含图片文件时接管，纯文本粘贴不受影响；assistant-ui 内建
  `addAttachmentOnPaste` 保持关闭）；非图片 MIME 与 >4MB 文件
  静默跳过，多文件按剩余暂存槽截断；FileReader 读 dataURL 后只取
  逗号后 base64 段上送。**无头冒烟**
  `node artifacts/smoke-image-drop.mjs`（配
  `artifacts/image-drop-harness.html`，mock host 回发
  session.attachments 元数据）：真实 ClipboardEvent 粘贴 PNG +
  DragEvent dragover/drop（PNG+txt 混合）实测——2 条
  `attachment.addImage` 消息 base64 与源文件逐字节一致、txt 被
  忽略、dragover 高亮出现且 drop 后清除、2 个 chips 渲染，
  **PASS**。门禁：`pnpm run typecheck` 三 tsconfig 全过；
  `pnpm run test` 42 files / 888 tests 全过（较第一段 +10）；
  build、`npx vsce package --no-dependencies`（609.21 KB）、
  `cursor --install-extension --force` 均成功。真实 Cursor 中
  拖入 png / Win+Shift+S 截图粘贴的可见验收待用户 Reload Window
  后进行。
- V1 切片③第一段：对话内图片显示（2026-08-12 凌晨）：Bridge 新增
  `image` 转录项（媒体类型白名单 jpeg/png/gif/webp、单图 base64
  ≤ 2,796,203 字符≈2MB、每回合/每 tool_result ≤ 8 张、会话级渲染
  预算 300 张 / 24M base64 单位超限降级为占位行保留元数据）与
  `transcript.image` 宿主消息，双侧校验器同一变更补齐并含敌对输入
  单测（`validateHostMessage.test.ts` +9、`bridgeMessages` 侧由
  `hostTranscriptState.test.ts`/`store.test.ts` 覆盖）。Runtime：
  `normalizeSdkEvent.ts` 新增两条实时图片通道——`assistant` 完成
  消息的 image block（含 `generated` 标记）与 `tool_result` 内容数组
  中的 image（截图类），各自 8 张/事件上限；`projectSessionHistory.ts`
  历史投影 user/assistant/tool_result 三源图片为有界转录项，超预算
  仅置空 `data` 保留占位（不再把图片计入 partial 省略）。Host：
  `hostTranscriptState.ts` 消费 `transcript.image` 并执行会话图片
  预算；`ChatController.ts` 发送后回显用户附件图片（超限发占位）；
  恢复存储 `SessionRecoveryStore` 检查点仅存图片元数据+空 data
  占位。Webview：`TranscriptImage.tsx` 渲染缩略图（高度有界）+
  点开面板内 lightbox（Escape/点击关闭）+ Generated 徽标 + 占位行，
  data URI 仅由白名单 mediaType + 校验过的 base64 在渲染边界拼装；
  CSP 最小改动：`img-src` 追加 `data:`（`webviewHtml.ts` 一处）。
  **真实会话只读冒烟** `npx tsx artifacts/smoke-image-history.mts`：
  会话 `4e6de24c`（预研锚点）loadSession 3455ms、投影 4ms、
  `historyStatus: complete`、`truncated: false`、图片 14 张
  （user 5 + tool-result 9）全部渲染无占位，与预研磁盘统计完全一致。
  **决策记录**：(1) 历史 tool_result 图片按 `turnId#tool-result:块序`
  计数（镜像实时流按事件计数），否则同一 tool 消息携带 9 个单图
  tool_result 会被整回合 8 张上限误伤；(2) 297 图样本会话
  `3d2ac816` 经原始 RPC 探针证实 `loadSession()` 只返回尾部 100 条
  消息且该窗口内无图片块（0 图非投影丢失，是 SDK RPC 窗口行为），
  性能上限证据改为锚点会话投影 4ms + 预算单测。门禁：
  `pnpm run typecheck` 三 tsconfig 全过；`pnpm run test` 42 files /
  878 tests 全过（较基线 +16）；build、`npx vsce package
  --no-dependencies`（608.44 KB）、`cursor --install-extension
  --force` 均成功。真实 Cursor 中图片会话的可见验收待用户 Reload
  Window 后进行。
- daemon Phase 3 Reload 存活基础设施切片（2026-08-12 凌晨）：
  Runtime 新增 `startDetachedDaemon`（`detached`/`unref`、无
  `--parent-pid`，注入式 spawn 单测 2 例）、`daemonDiscovery.ts`
  （发现文件严格校验、健康复用、版本漂移提示、`wx` 竞争输赢两路、
  stale 记录替换、shutdown，共 16 单测）、`sessionLease.ts`
  （获取/抢占死 pid/拒绝存活外来占用/释放/恶意文件降级，12 单测）；
  daemon 会话工厂新增租约接线（拒绝被占用会话、resume 失败释放、
  替换迁移租约、close 释放，4 新单测）；Host `extension.ts` 按
  `runtime.mode` 选择脱管共享或私有 daemon 策略并注册
  `droidvisx.shutdownDaemon`。`pnpm run typecheck` 三个 tsconfig
  全过；`pnpm run test` 42 files / 862 tests 全过；`pnpm run build`、
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix`
  （605.81 KB）、`cursor --install-extension --force` 均成功。
  **真实两代客户端存活验收**：`npx tsx artifacts/probe-reload-survival.mjs`
  在真实登录态下跑通——脱管 daemon 起（pid 已知）；gen-A 新进程
  create 会话、起长回合、见到首个 tool 事件后 `process.exit`；等
  3 秒后 gen-B 新进程 resume：`survived reconnect: true`、
  `saw turn running (post-A): true`、`ran to idle after running: true`，
  **VERDICT: PASS**（回合在 gen-A 死后于 daemon 内继续跑到完成）。
  探针只输出布尔/计数，token 只经 `readFactoryAccessCredential()`
  内存读取、不落盘不打印。
  **遗留（如实标注）**：(1) 探针里 `droid.sessions.getMessages()`
  两次返回异常（记为 -1），未据此判定；存活/进度证据取自
  `listOpened().workingState` 的 running→idle 迁移（§3.8(a)/(b)），
  该路径可靠；getMessages 取数方式待后续核对。(2) Webview 重连对账
  UI（§3.5：reload 后 in-flight 回合的活流重接与面板内 pending 权限
  重弹）尚未接线——`FactoryDroidRuntime` 现有 seam 只能新起回合、
  无法重接已在跑的回合流，属超出本切片 seam 的更大改动；daemon 侧
  存活已实证，真实 Cursor 手动 reload 面板体验待该 UI 接线后完整。
  (3) 版本漂移仅记录不强制（`cliVersion` 未探测，值为 unknown 时
  不提示）。真实 Cursor `Developer: Reload Window` 手动验收留待用户。
- daemon Phase 2 执行链路迁移切片（2026-08-12 凌晨）：新增
  `src/runtime/daemon/createDaemonDroidSession.test.ts` 11 个
  mock 单测（create 带 cwd 与交互回调 / resume 不带 cwd /
  permission+askUser 回调接线 / 经 `FactoryDroidRuntime` +
  daemon 工厂流式跑通一轮 / skills+MCP 能力方法带 sessionId
  资源化委托 / `getContextBreakdown` 推导 estimated 上下文
  统计 / updateSettings 本地 overlay 至快照追平 / compact 与
  rewind 替换会话后 detach 旧句柄 / fork 替换 resume 失败时保留
  旧句柄 / close 映射 detach），聚焦运行 1 file / 11 tests 通过；
  daemon 模式下 fail closed 断言：`availableModels` /
  `onNotification` / `authenticateMcpServer` 均为 undefined。
  `pnpm run typecheck` 三个 tsconfig 全部通过；`pnpm run test`
  40 files / 828 tests 全部通过（含既有 `FactoryDroidRuntime`
  33 测试不改动通过，即 process 工厂行为不变）；
  `pnpm run build`、`npx vsce package --no-dependencies -o
  dist/droidvisx.vsix`（9 files, 603.76 KB）、
  `cursor --install-extension dist/droidvisx.vsix --force` 均
  成功。真实 daemon 模式端到端（设置 `droidvisx.runtime.mode =
  daemon` 后发消息/权限弹窗/rewind）等待用户 Reload Window 后
  手动验收
- 恢复提速切片（2026-08-12 凌晨，V1 #2）：`ChatController` 新增
  2 个测试（早期快照在 runtime.initialize 完成前到达且连接为
  `connecting`、早期快照期间 `turn.send` 被拒绝且不产生
  turn.state；无检查点时首个快照即为 connected 不发早期快照），
  聚焦测试 1 file / 92 tests 通过；`pnpm run typecheck` 三个
  tsconfig 全部通过；`pnpm run test` 39 files / 817 tests 全部
  通过；`pnpm run build`、`npx vsce package --no-dependencies
  --out dist/droidvisx.vsix`（9 files, 602.82 KB）、
  `cursor --install-extension dist/droidvisx.vsix --force` 均
  成功。真实窗口的"重开秒出内容"由日志验收：Reload 后
  `host.perf.early-snapshot` 应先于 `runtime.initialize.finished`
  出现（等待用户 Reload Window 后核对）
- daemon Phase 1 只读 sidecar 切片（2026-08-12 凌晨）：Bridge 新增
  `session.archive` / `session.unarchive` / `sessions.archivedRefresh`
  / `session.search` 入站消息与 `session.archived` /
  `session.searchResults` 回发状态（双侧校验对称，查询长度/控制
  字符/条目上限/ISO 时间敌对输入用例齐备）；Runtime 新增
  `daemonLifecycle.ts`（注入式 spawn/端口/等待/杀树依赖单测）、
  `daemonConnection.ts`（not-logged-in / credentials-unreadable /
  connect-failed 分类、auth 错误回调置 unhealthy、dispose 断连
  单测）、`DaemonSessionCatalog.ts`（archive/unarchive 委托、
  listArchived 的 cwd/repoRoot 过滤与标题 sanitize、search 的
  片段截断与标题兜底单测）；Host `ChatController` 新增四个
  handler 单测（成功路径、活跃 Session 拒绝归档、目录外
  Session 拒绝、runtime 不支持、daemon 不可用诊断、错误文案
  不外泄内部细节）；Webview store reducer 的 archived /
  sessionSearch 状态跨 host.snapshot 保留用例、SessionDrawer
  归档/懒加载/恢复/回车搜索/本地目录过滤用例。
  `pnpm run typecheck` 三个 tsconfig 全部通过；`pnpm run test`
  39 files / 815 tests 全部通过；`pnpm run build`（esbuild 外部
  依赖断言更新为允许 `bufferutil` / `utf-8-validate`）、
  `npx vsce package --no-dependencies`（602.63 KB）、
  `cursor --install-extension --force` 均成功；无头 Chrome 冒烟
  `artifacts/smoke-daemon-drawer.mjs`（配
  `daemon-drawer-harness.html` 假 Host 回应真实 Bundle）实测：
  展开 “Archived” 首次懒加载发出 1 次 `sessions.archivedRefresh`
  并渲染 1 条归档行（含 Restore 按钮）；搜索框输入回车发出
  `{type:'session.search', query:'daemon'}` 并渲染 2 条
  Content matches（目录内命中为可点击 button、异工作区命中为
  只读 div 带提示）；点击非活跃行归档按钮发出
  `{type:'session.archive', sessionId:'session-3'}`，该行从
  Recent 组消失并出现在 Archived (2) 中；全程无横向溢出，
  verdict pass。真实 daemon 端到端（真实 CLI 登录态下归档往返）
  与真实 Cursor 可见验收等待用户 Reload Window 后完成
- 收藏与分组切片（2026-08-11 深夜，V1 #1）：Bridge 新增
  `session.favorite` 消息（双侧校验对称，含敌对输入用例）与
  `SessionSummary.isFavorite` 字段（缺省安全默认 false）；Runtime 新增
  `sessionFavorites.ts`（读 `~/.factory/sessions/.favorites` JSON
  数组、临时文件 + rename 原子写、文件损坏/IO 失败 fail closed）并经
  `SessionCatalog.writeFavorite` 可选方法接入 `FactorySessionCatalog`；
  Host 校验目标 Session 在目录内后写文件、成功则就地更新
  `isFavorite` 并静默重载目录，失败发 warning 诊断；Webview 会话
  抽屉按 Favorites/Recent 分组渲染（无收藏时不显示组标签）、每行
  星标按钮（已收藏常显、未收藏 hover 显示）。聚焦测试 4 files /
  337 tests 通过；`pnpm run typecheck` 三个 tsconfig 全部通过；
  `pnpm run test` 36 files / 745 tests 全部通过；`pnpm run build`、
  `npx vsce package --no-dependencies`、`pnpm run verify:vsix`、
  `cursor --install-extension --force` 均成功；无头 Chrome 冒烟
  `artifacts/smoke-favorites.mjs`（配 `favorites-harness.html`）
  实测：3 条会话渲染为 Favorites(1)/Recent(2) 两组、收藏行星标
  `aria-pressed=true` 且常显、未收藏行星标默认隐藏、无横向溢出、
  点击星标发出正确 `{type:'session.favorite', sessionId, favorite:true}`
  出站消息，verdict pass。真实 Cursor 可见验收等待用户 Reload
  Window 后完成
- 静态复查修复轮（2026-08-11 深夜，P1 污染检查点 + 3×P2）：
  `reconcileSessionHistory` 新增 2 个回归用例（陈旧重复尾回合跳过、
  151/75 污染形态 fixture）；聚焦测试 4 files / 113 tests 通过；
  全量 `vitest` 34 files / 716 tests 全部通过；三个 tsconfig
  `typecheck` 通过（曾实证 assistant-ui tool-call part 的
  `toolCallId` 为可选，故保留 undefined 收窄）；build +
  `npx vsce package --no-dependencies` + `cursor --install-extension
  --force` 成功；真实数据复验两条：污染会话 `4adeb11f…`
  （checkpoint 134 条、15/29 唯一 messageId）reconcile 输出 75 条
  （= loaded，零重复，修复前日志实录 134 条），旧崩溃会话
  `40ebe83d…` 维持 80/130 条不变
  （`artifacts/probe-reconcile-poisoned.mts` /
  `probe-reconcile-verify.mts`）
- 全保真日志改造切片（2026-08-11 深夜）：`LocalDiagnostics` 单测
  重写为 8 tests（全保真字段/turn 作用域、SDK 透传、凭据扫除、
  按日分文件、200MB 最旧整天清理、Sink Failure 隔离、
  `scrubCredentials` 正反例），`FactoryDroidRuntime` 新增
  tool.started 按 toolUseId 去重测试；全量 `vitest`
  34 files / 714 tests 全部通过；三个 tsconfig `typecheck` 通过；
  build + `npx vsce package --no-dependencies` + 安装成功；真实
  激活记录已在 globalStorage 新日志位置确认（含另一窗口的完整
  resume 链路：boot-ok bootMs、history.finished、perf.recovery）
- Capability Contract/Probe 聚焦测试：28/28
- Capability 实机无提示 smoke：通过
- 最新 Runtime/Composer/Store/Interaction/App 聚焦测试：40/40 通过
- 最新长会话跟随修正后的 App/Store 聚焦测试：8/8 通过
- 本轮 Activity/Privacy/Runtime/Host/Webview 聚焦测试：
  15 files / 273 tests 全部通过
- 本轮 UI/History/Recovery/Bridge 聚焦测试：
  10 files / 195 tests 全部通过
- 本地 JSONL 轮换、SDK/Host 隐私过滤和 Sink Failure：
  3/3 tests 通过
- Webview 测试：120/120 通过
- Runtime 模型目录投影测试包含 SDK `isCustom` BYOK 过滤，以及真实
  `AutonomyLevel.High` 更新参数验证
- 本轮 AskUser/Tool/Settings/History 集成聚焦测试：
  9 files / 207 tests 全部通过
- 本轮内容顺序/AskUser/Thinking 聚焦测试：
  3 files / 17 tests 全部通过
- 本轮 Context/Settings/Composer/Thinking/Scroll/Markdown 修复聚焦测试：
  8 files / 220 tests 全部通过
- 最后 Context 诊断分类补丁聚焦测试：1 file / 28 tests 全部通过
- Context 真实 `out-of-range` 日志修复聚焦测试：
  4 files / 174 tests 全部通过
- 最新完整测试套件（2026-08-11 产品化打磨轮 `package:prepare`）：
  29 files / 445 tests 全部通过
- 最新 Extension 与 Webview TypeScript 检查：全部通过（同一
  `package:prepare` 流水线）
- Production Build：通过，包含本地 Inter Variable Latin WOFF2
- 自动化回归已证明 SDK `options: []` 可以穿过 Runtime 和 Bridge 并提交
  开放文本答案；普通流式响应期间 Webview、Host 和 Runtime 可以完成一次
  权威 Settings 更新；零 `tool_progress` 只显示生命周期；History 只渲染
  一个与 `partial` / `truncated` 状态一致的提示
- 以下浏览器核对记录来自本轮前一个 Module 1 包。当前包按用户要求不再启动
  浏览器，最终可见验收由用户在 Reload Window 后于真实 Cursor 中完成
- 720×900 Activity 核对：Tool 主标签为 `Read workspace files`，原始
  `private-tool-call-id` 不可见；Hover 显示 Copy/Reuse，Root 横向溢出为
  0px
- 320×760 Activity 核对：展开详情为 `Read` 和
  `3 updates · Latest: tool result`；Tool Summary、User Bubble 和 Root
  横向溢出均为 0px，Composer 右边缘保持在 Viewport 内
- 双击 Reuse 核对：历史文本进入 Composer，`dvx-prompt` 获得焦点，
  `aria-live` 报告 “Message added to Composer.”，没有发送 Turn
- Context Error 核对：可见错误文本和 `[role=alert]` 均只有一个
- 生产 Shell 全屏核对：900×700 和 320×700 均从 `(0, 0)` 精确填满
  Viewport，无外层 Padding、圆角或阴影；Figma 的 Header、Composer 和
  Request 卡片内部规格继续保留
- BYOK Model 浏览器核对：18 个目录行；196px 列表
  `overflow-y: auto`，可滚动至 `scrollTop: 538`；面板完全位于 430px
  Viewport 内
- 长会话浏览器核对：从顶部发送后流式阶段距底部 `0px`；主动向上滚动后
  生成结束仍保留 `924px` 距离，没有重新抢回底部
- Plan 数值核对：430px Viewport 中 Inline Request 为 398px、Card Shell
  为 368px、正文列为 336px；Markdown 为 12.5px / 20.313px；
  Action Gap 为 8px，Ghost Button 为 34px，Primary Button 为 32px，
  Split Button 为 32px 高、Chevron 分段为 32px 宽、图标为 14px
- 320×760 Plan 核对：Split Button 为 134.17×32px，操作区两行显示，
  Root、Card 和 Action 区横向溢出均为 0px
- 320×700 Plan 核对：请求卡片位于 60px Header 下方和 Composer 上方，
  正文在 300px 高区域内滚动，操作区分为两行且无横向溢出
- 多行 AskUser 浏览器核对：六个 52px 高选项均无相互重叠，自定义输入与
  选项区无重叠；长请求卡片在自身内部纵向滚动
- 紧凑 Diagnostic 浏览器核对：Info、Warning、Error 均为 26px 高；终止
  Runtime Error 的同轮去重由 Store 测试覆盖
- 1417×895、DPR 2 浏览器核对：Conversation、History、Settings、
  Context、Model、Permission、Plan、AskUser、Queued 和 Mission 已捕获
- 最新 1417×895 浏览器核对：Send 图标中心偏差为 0px；Thinking/Tool
  Chevron 为 14×14、旋转原点 7px 7px；Plus、Context、Model 浮层与
  Composer 的可见间隔均为 7px；Model 搜索聚焦时无可见 Outline 或阴影
- Model 当前行显示 Medium；真实目录声明时 Reasoning 编辑器显示 Low、
  Medium、High、Extra High 和 Max
- 420×820 Reasoning 核对：“Options” 暴露为 Level 3 Heading，匹配文本的
  Button 数量为 0，`user-select: none`，Root 无横向溢出
- 最新 Settings 浏览器核对：Mode/Autonomy 在原卡片内展开，Mode 的
  Auto/Spec/Mission 同屏显示；展开后面板仍与 Composer 保持 7px 间隔
- Session History 的 “All chats” 仅为静态标签，已移除无功能的 Chevron
- 420×820 History 核对：搜索 Shell 为 388×33px、单一 1px Border；
  内部 Search Input 为 0px Border/Outline/Shadow，Root 与搜索框均无横向溢出
- 738×1024 History 核对：Drawer 右边缘与 Viewport 的差值为 0px，
  `elementFromPoint()` 命中 `dvx-session-drawer` Surface；Root 横向溢出
  为 0px，内部 Session Nav 使用 `scrollbar-width: none`
- 当前包 Thinking 改为默认收起；同步展开/收起由组件回归测试覆盖，真实
  Cursor 可见表现等待用户本轮验收
- 320×850 窄栏核对：无横向溢出，Conversation 与 AskUser 仍在 Shell 内
- 最新 320×850 Reasoning 编辑器核对：改为 Model 面板上方显示，完整位于
  Viewport 内且页面宽度保持 320px
- 键盘 Focus ring 与 Reduced Motion：通过
- 第二轮浏览器视觉检查：320px、575px，Plus、Context、Model、Composer
  焦点和已删除的滚动按钮；面板与 Composer 边框对齐
- 第一轮浏览器视觉检查：320px、575px、900px，Settings、Context、Model
  和 Session Drawer
- VSIX 打包和 `verify:vsix`：通过
- VS Code 1.108.2 Integration：通过，验证 Focus/Open Logs Command 注册和
  Extension 激活
- Cursor CLI 安装：通过
- 已安装 Extension、Webview JS、CSS 和 Inter Font 的 SHA-256 均与本次
  Build 一致
- `/` 动态命令切片（2026-08-11 深夜）：执行假设验证——真实 turn 发送
  `/dvx-probe purple-elephant-42`（临时 `.factory/commands/dvx-probe.md`）
  经 SDK `session.stream` 完成，助手返回
  `EXPANDED-OK purple-elephant-42`，证明 stream-jsonrpc 后端在服务端
  展开自定义命令与 `$ARGUMENTS`（探测后已删除临时命令文件与探测
  会话）；`pnpm run typecheck` 三个 tsconfig 全部通过；
  `pnpm run test` 33 files / 693 tests 全部通过（含本切片新增的
  Bridge 双向校验、FactoryCommandCatalog 投影、FactoryDroidRuntime
  listCommands、ChatController refresh/recents、RecentCommandsStore、
  Webview store reducer 与 findSlashToken/filterSlashCommands 测试）；
  `pnpm run build`、`vsce package --no-dependencies` 与
  `cursor --install-extension` 均成功
- 历史对齐修复切片（2026-08-11 深夜）：真实崩溃会话
  `40ebe83d…`（recovered 检查点 72 条）经生产 `reconcileSessionHistory`
  复验——对崩溃当时形态（loaded 78 条）输出 80 条（loaded 主体 + 2 条
  分支前缀，修复前为 150 条整段拼接），对今日增长形态（loaded 128 条）
  输出 130 条；两种形态下 user `messageId` 与 `toolUseId` 均无重复
  （`artifacts/probe-reconcile-verify.mts` 实测输出 +
  `src/extension/probeRealSession.test.ts` 断言，后者在真实数据文件
  缺失的机器上自动跳过）；`pnpm run typecheck` 三个 tsconfig 全部
  通过；  `pnpm run test` 34 files / 703 tests 全部通过（含本切片新增的
  锚点对齐用例与脱敏 72/78 回归 fixture）；`pnpm run build`、
  `npx vsce package --no-dependencies` 与
  `cursor --install-extension --force` 均成功
- 活动 shimmer 打磨切片（2026-08-11 深夜）：`npx vitest run` 34
  files / 705 tests 全部通过（含本切片新增的 `PendingResponse`
  shimmer 文案两个用例）；`pnpm run typecheck` 三个 tsconfig 全部
  通过；`pnpm run build` 成功；`artifacts/smoke-shimmer.mjs` 无头
  Chrome 冒烟两种模式 + `--force-prefers-reduced-motion` 复跑均
  pass（running 模式仅最新 running 行与 "Droid is working" 文字
  animationName 为 `dvx-activity-shimmer`，其余 `none`；permission
  模式全部 `none` 且根节点带 `dvx-thread-pending`；reduced-motion
  下全部 `none` 静态色 `#6b6259`）；
  `npx vsce package --no-dependencies` 与
  `cursor --install-extension --force` 均成功

本轮已完成完整自动化门禁、VSIX 打包/内容验证和 Cursor CLI 安装，并核对
安装目录中的 Extension、Webview JS、CSS 和 Inter Font 哈希与 Build 一致。
按用户要求未对当前包继续启动浏览器；真实 Secondary Sidebar 的最后可见
检查由用户在现有 Cursor 中 Reload Window 后完成。

## 仓库状态

基础聊天实现在提交 `0fb5e5c` 中形成可复现检查点。当前 Module 1 变更仍在
工作区等待 Cursor 可见验收：

- `src/`、测试、构建配置、依赖锁文件和工程文档已纳入 Git
- Module 1 保留一个经用户确认的主界面视觉参考
- 旧 `.codex` 多 Agent 工作流已删除
- 项目专用 `backend-writer`、`frontend-writer` 和委派工作流已删除
- 仓库默认由当前实现 Agent 独立完成全部层级
- `artifacts/`、本地 `.factory/skills/`、`.workflow/`、`dist/` 和 `node_modules/` 已忽略

后续交付顺序和完成标准见
`[delivery-plan.md](./delivery-plan.md)`。

## 下一步

按用户决定（2026-08-11）：第一档 UI/观察性打磨大部分暂缓，方案已写入
[`tier1-polish-plan.md`](./tier1-polish-plan.md)；路线索引与排除项见
[`HANDOVER.md`](../HANDOVER.md) 第 3 节（本节的顺序须与其保持一致）。

### V1 剩余（按执行顺序）

1. ~~**收藏与分组**~~ — 已完成（2026-08-11 深夜，见验证状态
   「收藏与分组切片」；[`session-management-design.md`](./session-management-design.md) §1）。
2. ~~**恢复提速**~~ — 已完成（2026-08-12 凌晨，见验证状态
   「恢复提速切片」；[`tier1-polish-plan.md`](./tier1-polish-plan.md) §3；从第一档提前）。
3. ~~**对话内图片 + Composer 拖拽/粘贴**~~ — 两段均已完成
   （2026-08-12 凌晨，见验证状态「V1 切片③第一段/第二段」；
   [`rich-content-design.md`](./rich-content-design.md) §1、§1.5）。
4. ~~**完整 Spec Mode 闭环**~~ — 已完成（2026-08-12 中午，见验证
   状态「V1 切片④」与生产已接通 §6；
   [`spec-mission-design.md`](./spec-mission-design.md) §1）。
5. **Canvas / 原型预览**
   （[`rich-content-design.md`](./rich-content-design.md) §2）。
6. **子代理摘要层级 + Mission 只读展示**
   （[`spec-mission-design.md`](./spec-mission-design.md) §3、§2）。
7. **第一档打磨剩余** — 流式命令输出预览 → 收起播报 → 回复动画
   （[`tier1-polish-plan.md`](./tier1-polish-plan.md) §1、§2、§4）。
8. **发版卫生** — 版本号脱离 0.0.0、CHANGELOG、正式 VSIX（做前与用户确认）。

### 用户明确排除（近期不做）

跨设备 Session、界面中文化（i18n）、个人体验基线（首次引导/通知/设置页/
快捷键）、账号用量 —— 详见 [`HANDOVER.md`](../HANDOVER.md) 第 3 节
「用户明确排除」。勿自行加回。

### V1 前已完成（勿重复）

`/` 动态命令（含最近使用）、Assistant Regenerate、Composer `@` 提及、
Rewind 文件安全检查、MCP 浏览器认证与增删、Problems/Git changes 附件、
全保真日志与诊断导出、活动 shimmer 打磨、历史 messageId 锚点对齐、
toolCallId 重复白屏修复与 AppErrorBoundary、污染检查点尾段复活修复等
（正文各节有记录）。

### 架构专项（独立于 V1，插队位置用户定）

daemon 化 —— [`daemon-architecture-design.md`](./daemon-architecture-design.md)
+ [`daemon-implementation-plan.md`](./daemon-implementation-plan.md)。
见 HANDOVER 第 7 节。Phase 1（只读 sidecar：归档/取消归档/内容
搜索）、Phase 2（执行链路迁移，`droidvisx.runtime.mode` 可选
daemon、默认 process）与 Phase 3（Reload 存活：脱管共享 daemon +
发现文件 + 跨窗口租约 + shutdown 命令，daemon 侧存活由
`probe-reload-survival.mjs` 实证 PASS）均已于 2026-08-12 凌晨
完成（见验证状态）；Phase 3 的 Webview 重连对账 UI（in-flight
回合活流重接、面板内 pending 权限重弹）尚未接线（见验证状态遗留
说明）。

### 第一档与恢复提速的关系

「恢复提速」已从第一档提前到 V1 #2；第一档剩余三项（§1 流式输出、
§2 收起播报、§4 回复动画）排在 V1 #7。

空白"卡死"已定位并修复（2026-08-11 晚）：启动信标捕获到
`Duplicate key toolCallId-... in useResources`——恢复检查点与重新加载
的历史对同一会话合成相同的 `toolUseId`，重叠匹配失败后合并保留两份，
assistant-ui 渲染时抛异常导致整棵 React 树卸载（即"白屏"）。修复：

1. `reconcileSessionHistory` 合并输出对 `toolUseId` 与 `id` 一样去重；
2. `runtimeAdapter` 在每条 assistant 消息内对 toolCallId 兜底去重
   （治愈修复前已持久化的脏检查点）；
3. 新增 `AppErrorBoundary`：任何渲染崩溃显示可读错误 + Try again，
   并经信标写入日志，不再白屏。

已用真实崩溃会话（recovered 72 + loaded 78 → reconciled 150 条）
经生产代码路径复验：修复前 10+ 处重复、崩溃 id 出现 2 次；修复后
重复为 0。当时遗留的"重叠匹配完全失败导致对话内容重复展示（72+78
直接拼接）"问题已在同日深夜的历史对齐切片修复（见下）。

2026-08-11 深夜完成历史对齐重复显示修复（设计见
`session-management-design.md` §3）：`reconcileSessionHistory` 的匹配
核心改为 user 消息锚点分段对齐——锚点主键为 SDK `messageId`，无
messageId 的锚点退化为两侧唯一的 `text.trim()`（重复文本不作锚），
按顺序单调匹配。存在共同锚点时 loaded 为唯一权威主体：recovered 仅
前置第一个共同锚点之前的段（rewind 分支/压缩丢失的前缀）、必要时
追加 CLI 未持久化的尾段（崩溃发生在持久化前），中段整体丢弃（重复
显示的根治点）；前置/追加段按"相邻 loaded 区域内容键"过滤重发残留。
无共同锚点时维持原 suffix/prefix 重叠逻辑。`toolUseId`/`id` 去重与
`trimTranscriptToLimits` 收尾保持不变。真实崩溃会话复验：崩溃形态
72+78 由 150 条降为 80 条（loaded 78 + 2 条分支前缀），今日形态
72+128 输出 130 条，均无重复 `messageId`/`toolUseId`。回归防线：
脱敏 72/78 fixture（`src/extension/__fixtures__/reconcileRealSession.ts`，
由 `artifacts/gen-reconcile-fixture.mjs` 从真实数据等价脱敏生成）+
8 个锚点对齐用例；真实数据探针 `src/extension/probeRealSession.test.ts`
在本机数据存在时额外复验。

2026-08-11 深夜静态复查修复轮（P1 + 3×P2 + 1 处防御清理）：

1. **P1 污染检查点尾段复活**：旧"整段拼接"合并期间持久化的检查点把
   对话重复了两份；锚点对齐的尾段扫描把重复副本当成"CLI 未持久化的
   新回合"整段追加（新日志实锤：真实会话 `4adeb11f…` 恢复对账
   recovered:151 / loaded:75 → reconciled:134）。修复：尾段起点扫描
   跳过所有 loaded 已认识其锚点（messageId 或 loaded 侧唯一文本）的
   user 回合（`reconcileSessionHistory.ts` `trailingRecoveredItems`
   + `loadedKnowsAnchor`）。真实数据复验
   （`artifacts/probe-reconcile-poisoned.mts`）：该污染检查点（现
   持久化为 134 条、29 个 user 仅 15 个唯一 messageId）reconcile
   输出恰为 loaded 的 75 条且 `complete`，messageId/toolUseId 零
   重复；旧崩溃会话 `40ebe83d…` 复验输出维持 80/130 条不变。回归
   测试新增 2 个：陈旧重复尾回合跳过 + 真正新回合保留、151/75 污染
   形态 fixture（15 回合 ×2 副本 + 分支前缀 → 输出 77 条）。
2. **P2 `/` 命令目录 in-flight 标志**：布尔标志改为记录发起时的
   `runtimeGeneration`（`commandsRefreshGeneration`），短生命周期
   目录进程挂起时切换会话/工作区即自动失效，不再永久卡死目录加载。
3. **P2 boot 看门狗残留竞态**：`main.tsx` 挂载前 `replaceChildren()`
   清空看门狗可能已写入的兜底文案并立即置位 `__dvxBooted`，>10s 的
   慢启动不再出现兜底文字与真实 UI 并存或误报 `boot-timeout`。
4. **P2 `/` 弹窗断连重试**：目录懒加载 effect 依赖加入
   `controlsDisabled`（与 Host 侧吞掉 refresh 的守卫同源），连接
   恢复且弹窗仍开着时自动补发 `commands.refresh`。
5. `runtimeAdapter.uniqueToolCallIds` 的 `toolCallId === undefined`
   检查复核后**保留**：assistant-ui `ThreadMessageLike` 的 tool-call
   part 类型将 `toolCallId` 声明为可选（typecheck 实证，删除即
   TS2345），该收窄是类型边界要求而非撒防御；补充注释说明。

恢复尾段的窄边界丢弃（loaded 有更新回合时整尾段按陈旧丢弃、极端
三条件叠加下可能误丢一个未持久化回合）按复查结论接受为已知边界，
记录于 `session-management-design.md` §3.2，不改代码。

2026-08-11 晚间完成第二档第一切片 `/` 动态命令（Droid Commands 列表）：
Composer 草稿以 `/` 开头且光标仍在命令名内时弹出命令列表（复用 `@`
提及弹窗骨架，↑/↓/Enter/Tab/Escape 键盘导航、鼠标选择），选中后把
草稿补全为 `/name ` 并保持焦点，不自动发送。目录懒加载：首次触发
发送 `commands.refresh`，Host 经 Runtime `listCommands()` 调用 SDK
`droid.list_commands`（`FactoryCommandCatalog` 以短生命周期公开
`DroidClient` + `ProcessTransport` loadSession 后查询，同会话历史
加载器同一公开通道），投影安全字段（name ≤64 slug 校验、
description ≤512、argumentHint ≤128 折叠空白截断、isExecutable），
Host 按会话缓存并以 `session.commands` 回发
loading/ready/error/unsupported（loading/error 保留缓存列表；
error 文案提示重开弹窗重试）。`isExecutable: true` 的 shell 类命令
本切片不在弹窗中暴露。过滤在 Webview 本地按名称子串完成；最近使用
（`workspaceState` 持久化，上限 8 个）排在最前，其余按字母序。发送
以 `/名称` 开头且命中缓存目录的消息时（大小写不敏感）记录最近使用
并即时重排。执行语义已用真实 turn 验证：CLI 后端（stream-jsonrpc）
在服务端展开自定义命令——发送 `/dvx-probe purple-elephant-42` 后
助手准确返回模板要求的 `EXPANDED-OK purple-elephant-42`，因此发送
路径保持普通 `turn.send` 文本，无 Host 侧展开回退。已知边界：
`list_commands` 只返回自定义命令（`.factory/commands`），内置
命令（/model /compact 等）不出现在弹窗中（GUI 已有等价物）；
CLI 持久化历史把该轮用户行记为 `/name is running`，重载会话后
显示该文案而非原始输入（实时乐观消息不受影响）。

2026-08-11 深夜完成活动 shimmer 打磨切片（设计与诊断见
`activity-shimmer-fix-design.md`）：诊断确认同批多个 `tool_use` 的
结果由 CLI 整批回传、权限请求按批阻塞（SDK
`RequestPermissionRequestParamsSchema.toolUses` 为数组；本机真实
会话 9/9 个多工具 assistant 消息的 `tool_result` 全部落在同一条
后续 user 消息），因此权限挂起时同批已启动行都停留在 `running`
是状态机正确行为，修复只在呈现层：（1）同回合最多一行闪烁——
`.dvx-activity-running:has(~ .dvx-activity-running)` 把非最新的
running 行退化为静态 `#6b6259` "Working" 文字，仅最新行保留
shimmer；（2）权限/提问交互挂起时全部停闪——复用线程根节点既有
`dvx-thread-pending` class 追加同样的静态覆盖；（3）
"Droid is working / responding" 状态文字加同款渐变 shimmer——
渐变文字样式抽为共享 `.dvx-shimmer-text`（与
`.dvx-activity-running .dvx-tool-action` 同一声明块），
`PendingResponse` 的文案包进该 class 的 span。
`prefers-reduced-motion` 既有覆盖块同步扩展到 `.dvx-shimmer-text`，
全部退化为静态。纯 CSS 行为经无头 Chrome 冒烟脚本
`artifacts/smoke-shimmer.mjs`（配 `artifacts/shimmer-harness.html`，
真实 Bridge 消息驱动 3 个 running 行 + 可选权限交互）用
`getComputedStyle().animationName` 实测：running 模式仅最后一行与
状态文字为 `dvx-activity-shimmer`、其余为 `none`；permission 模式
全部为 `none` 且根节点带 `dvx-thread-pending`；
`--force-prefers-reduced-motion` 下全部为 `none`。

2026-08-12 完成转录路径点击跳转切片（生产已接通）：assistant 消息
Markdown 的行内代码内容若是一条路径，渲染为保留代码样式的可点击按钮
（`.dvx-path-link`，虚线下划线 + hover 主题色），点击发送新 Bridge
消息 `workspace.openPath { sessionId, path(≤1024), line?, column? }`。
识别规则第一版求稳，仅行内代码、整串匹配（`pathLink.ts`
`detectPathLink`）：Windows 绝对路径（盘符开头，允许空格/中文，拒绝
`<>"|?*`、控制字符与 `..` 段）；带文件扩展名且含分隔符的工作区相对
路径（存在性由 Host 判定）；裸文件名仅在带 `:line[:col]` 后缀（如
`foo.ts:12:3`）时识别，行列上限 1e6。围栏代码块内、普通代码、URL、
POSIX 绝对路径一律不识别。识别纯在渲染层，历史消息同样可点。双向
校验照 closed enum 模式：`parseWorkspaceOpenPath` 拒绝控制字符、
`..` 段、越界行列（column 必须伴随 line）。Host 新增 `PathOpener`
端口（`vscodePathOpener.ts`，经 ChatController 构造注入）：相对路径
对工作区根解析；绝对路径放行工作区外（仅用户显式点击可触发）；
`fs.stat` 复验存在后目录经 `revealFileInOS` 在系统文件管理器定位，
已知非文本扩展名（pdf/图片/压缩/Office 等）直接 `vscode.open` 交给
关联编辑器，其余先 `showTextDocument`（带行列则定位光标）、编辑器
拒绝二进制时回退 `vscode.open`；失败经既有 `emitSessionDiagnostic`
发 `open-path-failed` warning。未连接或会话 id 不匹配时忽略。
Webview 接线经 React context（`OpenPathContext`，App 根部提供），
`MarkdownText.tsx` 以 `InsidePreContext` 区分行内/块级代码。新增
测试：detectPathLink 33 例、校验器正反 20 例、MarkdownText 渲染与
点击 5 例、ChatController 端到端 1 例（行列透传、错会话拦截、失败
诊断）。可见验证经无头 Chrome 冒烟
`artifacts/smoke-path-link.mjs`（配 `artifacts/path-link-harness.html`
驱动真实 webview bundle）实测通过：中文/空格 Windows 绝对路径与
`App.tsx:42:7` 各成一个 `.dvx-path-link`（dotted underline +
pointer），`pnpm run build` 与围栏代码块不受影响，点击产生的两条
`workspace.openPath` 载荷逐字段匹配；截图
`artifacts/path-link-verify.png`。

每个切片保持完整测试、打包、安装和 Cursor 可见验收。

## 维护规则

以后每完成一个功能，必须在同一个变更中更新本文档：

1. 只有 UI、Bridge、Host 和 Runtime 链路全部接通后，才能标记为“生产已接通”。
2. 只有 Capability Contract、Probe 或测试证据时，必须保持“仅探测/声明”。
3. 临时替代行为必须标记为“部分完成”，并写明与规格的差距。
4. 打包或安装后必须更新“当前安装包状态”。
5. 验证章节只记录实际执行过的命令和结果，不得根据源码推测通过。
6. 不得把通用权限卡片误报为完整 Spec 或 Mission 产品功能。
