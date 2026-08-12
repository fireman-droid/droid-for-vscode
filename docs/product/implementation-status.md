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

**更正（2026-08-12 下午）：上述恢复提速自发布以来从未实际生效。**
日志实证：全天 16+ 次 `host.perf.early-snapshot`（items>0）成功发出，
但每个激活实例的 `webview.render-ok` 都等于全量快照时刻
（+9.1s~+15.2s），从未等于早期快照时刻（+0.2s~+4.4s）。根因：早期
快照发出时 catalog 仍为 `{status:'loading', items:[]}` 且
activeRuntimeCwd 为 null，快照中无 catalog 项被标 active，Webview
`validateHostMessage.ts` 的 `parseSessionCatalog` 硬不变量
`activeItemId !== activeSessionId` 静默拒收整条快照。本批修复：校验
器在 `connection.status !== 'connected'`（connecting / unavailable）
时允许 activeItemId 为 null 而 sessionId 非空（Host 侧确实无法在无
Runtime 归属时标 active，属合法过渡态）；active 行与 sessionId 矛盾
时仍拒收。见下方「启动/切换性能与可靠性修复批次」。

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
私有 daemon 做归档/搜索 sidecar，不受影响。重连对账 UI（A4 基础档：
in-flight 回合的生成中占位 + 完成后历史重载替换 + pending 权限重弹）
已于 2026-08-12 晚接线，见"验证状态"「活流重连基础档（A4）」条目；
逐 token 续流仍未做（超出基础档，SDK 无断点续流通道）。

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

2026-08-12 下午追加 V2 切片「会话导出 Markdown」：命令面板新增
`DroidVisX: Export Session as Markdown`
（`droidvisx.exportSessionMarkdown`），把当前活动会话（恢复存储的
selectedSessionId；恢复存储未加载时回读 workspaceState 持久值）
导出为 Markdown 文档。数据源复用既有 `FactorySessionHistoryLoader`
历史管线，不新增 Bridge 消息、不动 Webview。文档头含标题 /
Session ID / 创建与导出时间 / 工作区，并声明导出约定：Thinking 块
省略、工具调用折叠为一行记录（工具名 + 摘要 + 可选详情引用块）、
图片以占位符表示、用户附件按文件名列出；助手 Markdown 原样保留；
全文经 `scrubCredentials` 扫除凭据后落盘（`showSaveDialog`，默认
文件名含标题 slug 与日期，成功后通知 + Open File）。新增
`src/extension/sessionExporter.ts` 与 18 项单测（消息序列化、工具
折叠、凭据扫除、文件名生成、持久 selectedSessionId 回读）；
`extension.ts` / `package.json` 仅做最小命令注册。已通过
typecheck、shared+extension 485 项测试与 build；**本切片未打包
安装，已提交待随下一批次包一起可见验证**。

2026-08-12 下午追加 V2 切片「Mermaid 图渲染」：助手 Markdown 中的
```` ```mermaid ```` 代码块渲染为图形。行为：流式期间保持代码块形态
（不解析、不加载库），该消息回合完成并等 180ms 平滑排空后再渲染；
历史回放直接出图、无动画；解析失败安静回退为普通代码块 + 一行细字
提示（`.dvx-mermaid-note`）；图容器沿用卡片语言（1px 边框、圆角、
软阴影），超宽时容器内横向滚动，不撑破阅读列；提供"View source /
Hide source"细字切换。懒加载路线（关键决策）：Webview CSP 为
nonce-only `script-src` + 无 `unsafe-inline` 的 `style-src`，原生动态
`import()` 的 module chunk 无法带 nonce，会被 CSP 拦截，故 esbuild
产出独立 IIFE 包 `dist/webview/mermaid.js`（3.3MB，minified），主包
首次需要渲染时注入 `<script>` 并复制页面 nonce（`mermaidRenderer.ts`
`createMermaidScript`），通过 `window.__dvxMermaid` 交接；mermaid SVG
内嵌的 `<style>` 抽出后经 Constructable Stylesheets 采纳、行内
`style=""` 经 CSSOM `cssText` 程序化重放（两者均豁免于 CSP）。主包
首屏增量仅 3,442 字节（MermaidBlock 1,448 + mermaidRenderer 1,994，
metafile 实测），`esbuild.mjs` 新增 `assertMermaidStaysLazy` 断言防止
未来把 mermaid 静态打进主包。`securityLevel: 'strict'`、
`startOnLoad: false`、警温色主题变量（base theme + `#f7f5f1` 节点填充
等项目色板）。新增 `src/webview/mermaidGlobal.ts` /
`src/webview/mermaidRuntime.ts` / `assistant/mermaidRenderer.ts`(+7 测)
/ `assistant/MermaidBlock.tsx`(+6 测)，`MarkdownText.tsx` 经
`componentsByLanguage` 接入（仅生产转录渲染器；`DroidMarkdownContent`
预览保持普通代码块），`styles.css` 增 `.dvx-mermaid*` 卡片样式（已随
早前批次提交）。门禁：webview 项目 tsc 干净；全量 vitest 1355 过 /
3 失败（均为并行批次 protocolVersion 2→3 的既有断言滞后，与本切片
无关；聚焦 13/13 过）；build 过（webview.js 898.8KB、mermaid.js
3.3MB）；`artifacts/smoke-mermaid.mjs` headless Chrome 冒烟（生产等价
严格 CSP）全过：回放两图直出无动画、失败块回退带细字提示、节点填充
`#f7f5f1` 证明样式在无 `unsafe-inline` 下存活、流式中保持代码块且
mermaid.js 未加载、完成后出图且脚本经 nonce 注入成功、浅色主题同样
通过、图不超阅读列宽、无横向溢出。**本切片未打包安装，待随下一批次
包一起可见验证**。

2026-08-12 下午追加 V1 主线切片「子代理摘要层级 + Mission 只读展示」
（设计 `spec-mission-design.md` §3/§2 最小档）：Droid 经 Task 工具委派
子代理时，对应工具行下挂出一条一级缩进的安静摘要行——主标签
「Delegated to `<subagentType>` subagent」、副行 description（≤512）、
右侧状态字（pending/running/completed/failed/cancelled），终态且 SDK
报告计数时行内补「N tool uses · 时长」。只做一层，不伪造更深层级；
子会话内部事件不进父转录（SDK 不提供）；`childSessionId` 留在
Runtime/Host，不进 Webview。数据源三路合一：Runtime 会话级订阅
`child_session_available` 通知，仅活跃回合投影 `subagent-started`
事件（回合外丢弃）；回合结束后从 `loadSession().subagentInvocations`
台账按（type, description）身份对已达终态的行做结算（interrupted 的
仍在跑的行不复活）；历史加载用同一台账按 FIFO 队列配对 Task 行。
Mission 只读展示（控制面不做）：header 连接状态旁追加静字
「· Mission · running」等（`loadSession().mission.state` +
`decompSessionType`），会话抽屉行沿用 worktree 注记样式加
「mission / mission · worker」细字。Bridge 新增
`ToolSubagentSummary`（type ≤64 / description ≤512 / 状态枚举 /
计数安全整数，exact-key 双侧校验）与快照 `mission` 字段、目录
`missionRole` 字段；恢复检查点 round-trip 同规格校验。动画纪律：
子行永远静态，父 Task 行的 shimmer 是回合内唯一动画（计算样式
断言 `animationName` 全 none）。harness 三场景
（`artifacts/subagent-harness.html` + `run-smoke-subagent.mjs`）：
历史回放四种终态 + 无台账 Task 行不出子行 + 抽屉角色注记、流式
升级→台账结算、120 回合 stress（默认 60 消息窗口 + Show earlier
两次点开全量 124 子行）。stress 首测发现窗口内 29 条已结算子行会把
新消息 append 长任务推到 53–92ms（对照组 plain/plainpad 均为 0），
`SubagentSummaryRow` 改原始值 props + `memo` 后连续三轮复测流式期间
50ms+ 长任务为 0。门禁：typecheck 三项目全净、vitest 64 文件
1494 项全过、build 过（webview.js 908.7KB）、
`vsce package` 出 `dist/droidvisx.vsix`（10 文件 1.54MB，SHA256
`8283338286f62c3ccda670eeff44da15bd82d8d72b7c0713e4775d6c24191610`）、
`verify:vsix` 过、`cursor --install-extension --force` 安装成功。
注：打包时工作区含并行代理未提交的 Mermaid/TranscriptImage 等
在制品（typecheck 与全量测试均绿）。

2026-08-12 下午追加 V2 切片「会话/回合 token 明细」：Context 浮层内
新增一段 quiet「Token usage」账目（复用既有 hairline 分隔与细字标签
语言，无图表库），显示 SDK 真实提供的五项 token 分解（Input /
Output / Cache read / Cache write / Thinking），双列 Last turn（本回
合）与 Session（会话累计）。取证（`docs/product/token-usage-design.md`，
活体探针 `artifacts/probe-token-usage*.mjs`，CLI 协议 1.155.0）：
`token_usage_update` 流事件给**累计**五字段（SDK 转换丢弃
`factoryCredits`）、`result.tokenUsage` 给**本回合**全字段、
`loadSession().result.tokenUsage` 给历史累计；SDK 全程**无 USD 成本
字段**，故 UI 不显示金额、不做本地单价换算（fail-closed）；
`factoryCredits` 仅在 >0 时显示 Credits 行；历史会话只有累计
（loadSession 消息级无 usage），浮层以一行细字注明
「Per-turn detail appears after the next completed turn.」；无任何
usage 数据时整段不渲染（fail-quiet）。链路：Runtime
`normalizeSdkEvent` 新增 `token-usage` 事件并在 `turn-complete` 上
投影 `turnUsage`，`projectSessionHistory` 读信封顶层 `tokenUsage`；
共享 `src/shared/tokenUsage.ts` 严校验投影（五项非负安全整数，
credits 无效按缺席处理）；Bridge 新增 `session.tokenUsage` 消息与
快照可选 `tokenUsage` 字段（`validateHostMessage` 双侧严校验）；
Host `ChatController` 会话级状态（历史种子、live 覆盖累计、
turn-complete 写 lastTurn、compact/fork/切换重置）；Webview store +
`ContextPopover` 账目组件。门禁：typecheck 三项目干净；全量 vitest
61 文件 1478 项全过（新增 shared 投影、Bridge 校验、store 会话
隔离/重置、controller 发布与历史种子、popover 三态渲染）；build 过
（webview.js 910.5KB）。**本切片未打包安装，待随下一批次包一起
可见验证**。

2026-08-12 下午追加 V2 切片「原生 Terminal 第一切片（只读终端镜像）」
（设计 `native-terminal-design.md`，接管路线已判 fail-closed，本切片
只做镜像）：运行中的 Execute 工具 activity 展开区出现 quiet 细字入口
「在终端中查看」（沿用 commit-entry 触发语言，无图标无色块；历史/
回放命令不出现）→ 打开 VS Code 真终端面板的只读镜像终端
「DroidVisX: 命令输出」，实时追加命令输出；键盘输入丢弃并一次性提示
「只读镜像：输入已忽略」；命令结束后终端保留输出可回看；重复点击
复用同一终端不重开，终端被用户关闭后下次点击重建。数据源与 V1 #6
「流式命令输出预览」共用同一 Runtime 透传（`tool-progress` 的
`outputTail`，凭据扫除与 ANSI 剥离已在共享层完成，Host 不再实现第二
条透传）：`outputTail` 是有界尾部快照而非增量块，Host 侧
`computeTailDelta` 以后缀重叠探测把快照序列还原为追加流，`\r` 进度行
原地重写，输出超出快照窗口时插入一行「…（部分输出未捕获）」缺口
注记；无输出命令结算时补「（无输出）」。分层：Host 新增
`terminalMirror.ts`（依赖注入 `createTerminal`，懒建 pty、打开前缓冲
+ 512K 背压丢弃注记、会话/工具调用绑定、turn 结束 settleAll）；
Bridge 新增 `terminal.openMirror`（仅 sessionId，exact-key 校验）；
`ChatController` 只对已连接活跃会话转发 execute 三事件与打开请求；
Webview `ExecuteMirrorEntry` 仅 running + command 详情时渲染。门禁：
typecheck 三项目干净；全量 vitest 68 文件 1578 项全过（新增 pty 输入
丢弃、输出追加/重叠拼接/缺口、终端复用与重建、缓冲上限、Bridge 双侧
校验、controller 转发与门禁、入口可见性）；build 过。**本切片未打包
安装，待随下一批次包一起可见验证**。

2026-08-12 下午追加「用户验收反馈十项 UI 打磨批次」（提交
07be2c3 / 79c83c6 / 8b2a4ed / ace39c0 / 87d88a0）：① @ 与 / 弹窗滚动
不再外泄到转录（新共享组件 `ComposerPopup.tsx`：
`overscroll-behavior: contain` + wheel 边界拦截）；② / 弹窗 Skills 行
重做为 Cursor 式单行（名称常规字重 + 同行暗色截断描述、统一行高、
小字大写分组头），激活行描述以 portal 锚定的暖白 tooltip 卡展示
（1px 边框 + 软阴影，portal 在 `.dvx-shell` 变量作用域外故用字面色
值）；③ @ 空查询列出打开的编辑器标签页（复用 `workspace.searchFiles`
通道空查询语义，Host `vscode.window.tabGroups` 经新纯函数
`openEditorTabs.ts` 去重限 20 条，行样式改为文件名主体 + 同行暗色目
录后缀，删除 hover 目录树）；④ 弹窗点击卡片外任意处关闭 + Esc 关闭
（`ComposerPopup` 统一光销毁）；⑤ Context 卡重排：`Context usage`
升节标题层级（13px + 分隔线），tokens 超上限时保留满格进度条 + 右端
溢出记号 + Estimated 徽标（不再空掉），底部 Compact 按钮左、灰字说
明右两端同行；与并行落地的 token 明细账目共存；⑥⑦ Skills 与 MCP 共
用新面板头规范 `.dvx-panel-head`（返回箭头 + 13px 标题 + 右侧动作组
+ 1px 分隔线），MCP 的 Add 从居中移入头部右侧动作组；⑧ 设置搜索砍
掉 description 全文匹配（对齐 Cursor：搜 figma 不再出 agent-browser），
`rankNameMatches` 名称前缀命中排子串命中前；⑨ 顶部标题 DroidVisX →
Droid（仅 UI 文案，扩展 ID/包名/命令不动）；⑩ Mermaid 图点击进全屏
查看器（`Lightbox.tsx` 通用 `MediaLightbox`/`DiagramLightbox`，SVG 缩
放拖拽），图片查看器补右上角 Reset 与 1:1 显式控件（双击复位保留）。
门禁：typecheck 三项目干净；HEAD 干净 worktree 全量 vitest 64 文件
1532 项中 1530 过 1 跳过、唯一失败（MermaidBlock drain 假时钟超时）
为 worktree node_modules junction 环境伪影，主工作区同文件 7/7 全
过；十项冒烟 `artifacts/ui-polish-harness.html` +
`artifacts/smoke-ui-polish.mjs` 全部 PASS（截图
`artifacts/shots/ui-polish-*.png`）。**本批次未打包安装（完成时工作
区含并行代理未提交在制品），待随下一批次包一起可见验证**。

2026-08-12 傍晚追加「Thinking 穿插渲染第一切片」（设计
`interleaved-thinking-design.md`，提交 9e57203）：think→tool→think
回合现在渲染为工具行前后**两个独立 Thinking 行**，各自显示自己的
"Thought for Xs"，live 流式与历史回放一致。端到端段身份透传：
Runtime `normalizeSdkEvent` 转发 SDK `thinking_text_delta/complete`
的 `messageId`/`blockIndex`（畸形段身份丢弃）→ Host
`turnActivityState` 把 `messageId:blockIndex` 折算为回合内单调
`segmentIndex`（空段——只有 complete 没有可见文本——继续抑制，32k
累计上限语义不变），`hostTranscriptState` 快照按段拆 Thinking 项
（段 0 沿用旧 id 形状，旧检查点单块项兼容、形状不变）→ Bridge
`thinking.delta`/`thinking.complete` 新增 `segmentIndex` 字段（webview
侧校验安全非负整数）→ store 拆键 `thinking:${turnId}:${segmentIndex}`
且 complete 只定向命中自己的段。顺带钉死设计文档记录的两个现状
bug 的回归测试：已 complete 的 Thinking 项不再被后续 delta 增长、
`durationMs` 不再被末段覆写。**协议版本 3→5**：版本 4 为本切片
segmentIndex 字段；版本 5 为并行 plugins 面板切片（共用同一常量、
随本提交一起 bump，plugins 消息随其批次落地）；全仓硬编码
`protocolVersion: 3` 断言（`App.test.tsx`、`vscode.test.ts`）改用
`BRIDGE_PROTOCOL_VERSION` 常量。门禁：主工作区全量 vitest 75 文件
1707 项全过；build 过；120 回合 stress 复测（harness live 流新增
8 段穿插 thinking delta/complete）流式窗口 0 个 50ms+ 长任务；
`artifacts/verify-interleaved.mjs` headless Chrome 可见验证：live 回合
渲染 8 个独立 Thinking 行、各带独立耗时标签。提交树 typecheck 此刻
被并行批次半扫入的 plugins 接线（dd81d92 带入 `ChatController.ts`
的用点而契约未落）与未入库的 `slashBuiltins.ts`（HEAD `App.tsx`/
`Thread.tsx` 已引用）压红，均非本切片文件，待其批次落地转绿。
**本切片未打包安装（完成时工作区含并行代理未提交在制品），待随
下一批次包一起可见验证 think→tool→think 分段渲染**。

2026-08-12 傍晚追加「日志实证四项修复：Skills/MCP 面板会话切换死锁 +
daemon sidecar 可观测性」（提交 7894eb6 / 56a67bd / cdbbec8 /
771919a / c6ee117）：① 面板死锁（Webview）：会话切换把 store 的
skills/MCP 目录重置为 `idle` 后无人重查，而面板把 `idle` 也算 busy——
Refresh 永久禁用、卡死在 "Loading skills…"。现 SkillsPanel/McpPanel
在目录转 `idle` 时自动触发一次 refresh，Refresh 仅在 `loading` 时禁
用，面板内 "Start a new session" 点击后退回根视图（新会话收敛交给
④ 的激活推送）。② sidecar 失败可观测（Host+Runtime）：
`ensurePrivateDaemon`/`start()` 失败现记 `daemon.sidecar.start-failed`
（error 级，消息经 scrubCredentials 扫除），归档列表加载失败记
`host.ui.diagnostic`（archived-load-failed），私有 daemon spawn 的
stderr 改 pipe 并缓存最后 2KB 尾部拼入失败消息。③ spawn 换端口重试
（Runtime）：私有 daemon spawn/连接失败自动换新端口重试一次（日志
判定为 pickFreePort TOCTOU 端口竞争），重试前 `killProcessTree` 收割
未监听的残孤进程，两次都失败才聚合两个错误显示既有 unavailable 文
案。④ 激活补推（Host）：会话 available 后（`loadSessionMetadata`）
经现有 `session.skills`/`session.mcp` 通道主动补推目录，作为 ① 的服
务端兜底——面板跨会话切换保持打开也能收敛。复现路径 harness 验证
（App.test.tsx 全装配）：打开 Skills 面板 → 面板内点 Start a new
session → 新会话可用后面板自动重查、脱离 Loading；另覆盖会话切换时
面板保持打开的自动刷新路径。门禁：typecheck 三项目干净；全量 vitest
75 文件 1709 项全过（新增 11 项：spawn 重试/放弃聚合/stderr 尾部/
残孤收割、双面板 idle 恢复与根视图回退、App 级两条恢复路径、激活补
推、archived 失败落日志）；build 过。**本批次未打包安装（完成时工作
区含并行代理未提交在制品），待随下一批次包一起可见验证**。

2026-08-12 晚追加「日志实证两项修复：ApplyPatch 路径提取 + Webview
首屏闪白」（提交 5e601d8 / 94c9451）：① ApplyPatch 文件路径
（Runtime+Host，P0）：真实 CLI 的 ApplyPatch 输入只有一个 `input`
键，值为整段 patch 文本，而路径提取只认 `file_path`/`filePath`/
`path` 三个键——`filePath` 恒 undefined → `collectToolFilePaths`
恒空 → Changes 卡、Preview chip、卡尾 Git 提交入口、±行数统计对
真实使用全部死路（两日日志 ApplyPatch 68 次、Create/Edit/Write
0 次）。现 `extractToolFilePaths`（复数化）在标准键缺失时解析
patch 文本的 `*** Add/Update File:` 头：多文件全部提取、去重、
上限 24（`MAX_CHANGED_FILES_PER_TURN`）、畸形头/超长行/控制字符/
非字符串 input 一律安静返回空。**取舍：Delete File 头不提取**——
真实 CLI 重写文件固定发 Delete+Add 同路径对（Add 头已覆盖），纯
删除文件的 Preview chip 会指向不存在的文件；纯删除回合因此不出
Changes 卡，接受此边界。多文件经 tool-start 运行时事件新增的可选
`filePaths` 流入 Host 活动状态；单数 `filePath` 保持首路径语义，
工具行 chip 与 Bridge 契约形状不变（未触碰 bridgeMessages）。历史
重载走同一提取器，多文件 patch 的历史 Changes 摘要列出全部文件。
顺带把 `collectToolFilePaths` 按 24 上限截断（此前多工具可超出
Bridge 校验上限导致 `turn.changes` 整条被拒的潜在缺陷）。
② Webview 首屏闪白（Extension，小）：模板 head 只有外链
stylesheet，CSS 加载 + React 挂载前（~1s）裸露默认白底。现 head 在
stylesheet 前注入 nonce 内联 `<style>` 钉住 `html,body` 背景
`#f5f3ef`（与 styles.css 根底色核对一致），CSP `style-src` 追加
`'nonce-…'`（复用既有 script nonce）。门禁：修改文件所在的
extension typecheck 干净（工作区 webview typecheck 此刻被并行在制
品压红，非本切片文件）；因主工作区含并行在制品，全量验证在 HEAD
临时 worktree + 仅本批次文件上执行：typecheck extension 段过、全量
vitest 74 文件 1731 过 1 跳过 0 败（验证后 worktree 已删）。聚焦
测试新增：`toolFilePath.test.ts`（真实形状单文件/多文件/Delete+Add
同文件/畸形头/敌对输入/上限）、normalizeSdkEvent ApplyPatch 三态、
turnActivityState 多路径收集与截断、SessionHistory 多文件摘要、
webviewHtml 首屏背景与 CSP。**本批次未打包安装（dist 锁被并行占
用），待随下一批次包一起真机验收：让 Droid 用 ApplyPatch 改一个
html → 应出现 Changes 卡 + Preview chip + 卡尾 Git 提交入口；重开
窗口闪白应显著减轻**。

2026-08-12 晚追加 V1 主线切片「流式命令输出预览」（tier1 §1，V1 #6
最后遗留项，生产已接通并随包安装）：Execute/Bash 类工具运行中，
activity 展开区命令行下方出现实时输出预览窗——尾部有界快照、自动
钉底滚动，读者上滚即解钉、回到底部重新钉住；完成后预览定格为最终
尾部；回放/历史与恢复检查点从不携带（`SessionRecoveryStore` 读入
即丢弃 `outputTail`，敏感命令输出不落盘不重播）。数据源探针实证
（`artifacts/probe-tool-progress-output.mjs` +
`probe-tool-progress-raw.mjs`）：`tool_progress` 仅在
`includePartialMessages: true` 时从 `session.stream()` 可见，
`fullOutput` 为单调累积快照而非增量块。共享层
`src/shared/toolOutput.ts` 统一 ANSI 剥离、行尾归一、`\r` 原地重
写、凭据扫除与 8K 尾部截断（行边界保尾）；Runtime
`normalizeSdkEvent` 透传 `outputTail`，与只读终端镜像共用同一条
Runtime 透传（一份数据源两个视图）。Bridge `tool.activity` 与
transcript tool 项新增可选 `outputTail` 双侧校验；Host
`turnActivityState` 在 `progressCount` 封顶后仍继续更新尾部（长
命令不断流）。视觉按用户反馈整改为轻奢窗：`--dvx-code` 暖面 +
顶部微渐层、1px `--dvx-border`、8px 圆角、极轻内阴影、9–12px 内
边距、编辑器 mono 栈 11px/1.65 行距、muted 前景低于正文层级、顶
部渐隐 mask 消解尾部截断、thin 标准滚动条（帧容器承载边框故 mask
只裁内容）。门禁（干净 worktree @7f95587）：typecheck 三项目全
过；全量 vitest 80 文件 1803 过 1 跳过；build 过；`vsce package
-o dist/droidvisx.vsix`（1.56 MB / 1,635,961 字节，SHA256
`a4602cb7…30df7ed`）+ `cursor --install-extension --force` 成功。
冒烟 `artifacts/smoke-output-preview.mjs` 三场景（running 钉底/
解钉/重钉/完成定格 + 视觉断言暖面/边框/mono/渐隐，completed 定
格尾部，replay 零预览节点）全 PASS，截图
`artifacts/output-preview-visual.png`；120 回合 stress
（`artifacts/run-stress-output.mjs`）流式期间 50ms+ 长任务 0 个。
真机验收：让 Droid 跑一条长输出命令（如 `npm install`），展开该
活动行应见暖色预览窗实时滚动，完成后定格；重开窗口回放同一会话
不应出现预览窗。

2026-08-12 晚追加「用户实测反馈五项修复批次」（提交 fba6523 /
c7d9ea0 / 7007cba / e9d2266 / bd8f10a / e6e883c / af483f2，不单独
打包，随收尾统一发版包验收）：① 流式工具输入被首个部分解析钉死
（Host，P0 根因）：CLI 随输入 JSON 累积重发 tool_call_delta，部分
解析可能把字符串值截在半途（实测 Create 路径停在
"Canvas-API-学习"，实际文件为 `Canvas-API-学习文档.md`），而
`turnActivityState.projectToolEvent` 只在字段 undefined 时写入
filePath/filePaths/detail——首个截断值永久生效，连锁导致 chip 死
链（点击报 moved or deleted）、Changes 卡路径错、commit 面板
inTurn 匹配为 0（草稿 "0 files"、默认全不勾、Commit 灰死）。现输
入派生字段改为后到者胜（backgroundHint 保持单调）；该状态机与昨日
ApplyPatch 提取修复（5e601d8）同管线，本缺陷在其下游。面板默认勾
选本回合文件与草稿计数逻辑本就正确，根因修复后恢复工作。② 文件未
就绪文案（Host）：`FileDiffOutcome` 新增 not-found（`fs.stat` 失
败与打开失败分开），Turn 活跃期点击未落盘文件回 "That file does
not exist yet. Droid is still working on it."（file-not-ready），
已结算转录维持 moved-or-deleted 文案。③ 诊断卡去重（Host+Webview
双侧）：转录尾部连续诊断段内完全相同的条目（turnId+severity+
code+message）不再追加，连点 6 次只留 1 张；其间有其他内容时允许
重现。④ 视觉整改：诊断卡由浅底红点裸条改为 fit-content 暖底渐层
卡（1px 边框、双层软阴影、光环严重度圆点、warning/error 同步染色
边框/底/字）；"Commit these changes…" 入口改为 preview-chip 同语
言的安静动作 chip（hairline 边框、hover 暖色）；commit 面板动作
右下角停靠（Cancel 左、Commit 主按钮右）；Preview 面板顶栏换暖色
渐层底、文件名 ink 字重、细分隔线 muted 沙箱注记、Reload/Open in
editor 用 quiet 1px 边框按钮 + hover/focus 态。⑤ resize 断根（用
户第二次报）：`.dvx-shell textarea { resize: none }` 单点规则，删
除 commit 消息框与权限编辑器的逐元素 resize 覆盖。门禁（当前树，
含并行代理已落提交）：typecheck 三段全过；全量 vitest 80 文件
1810 全过；聚焦新增截断路径替换/多路径 ApplyPatch 后到者胜、
not-found 双态文案、host/webview 诊断去重、commit 动作顺序用例。
冒烟 `artifacts/smoke-diagnostic-dedup.mjs`（配
diagnostic-harness.html，真实 webview bundle）实测连点 5 次仅 1
张卡、异文案正常追加；五处 UI 截图留档 `artifacts/fixes-*.png`
（artifacts 目录不入库）。随包验收：让 Droid 创建一个中文名文件，
写入中途点 chip 应只出现一张 "does not exist yet" 卡且连点不叠
加，完成后 chip 显示完整文件名且点击能打开；Changes 卡尾 commit
入口为 chip 样式，展开面板本回合文件默认勾选、草稿 "N files" 计
数正确、按钮在右下、消息框不可拖拽拉伸；Preview 面板顶栏为暖色
成品样式。

2026-08-12 晚追加「用户验收反馈批次二·六项修复」（v0.1.0 发版
后第一个修复批次，提交 d9bf2b9 / 499edae / 5a89586 / 29f324f /
9d0986b+2517e73 / f93f5df）：① 全局细滚动条：`* { scrollbar-width:
thin }` + 半透明暖中性 thumb（hover 加深、track 透明），webkit 6px
规则兜底非标引擎，删除 `.dvx-tool-output`/`.dvx-model-list`/
`.dvx-plan-preview` 的逐处定义；刻意隐藏滚动条的表面
（thread-viewport、session-nav）维持 none。② 已发送图片缩略图：用
户消息卡内图片与 Composer 待发送区同形态——48px cover 圆角缩略
图、多图横排（user-block 改 row wrap，文本/附件 chip 各占整行）、
点击开 Lightbox 逻辑复用。③ Task plan 钉条视觉重做（位置与交互结
构不变）：暖色渐层卡面 + 1px 边框 + 浮起软阴影与 Composer 解耦；
展开态头部并入 `dvx-btw-title` 字阶家族；完成项纯变淡降噪（灰勾 +
0.62 透明度，无删除线）；当前项暖橙点 + 6% 底色微高亮；行距放
宽；右上进度改 36px hairline 分数进度条（完成转绿）；展开/收起用
grid-rows 平滑过渡，reduced-motion 降级。④ Execute 行运行中默认展
开输出预览（实时滚动），完成自动收起；用户手动收起/展开一次即接
管（openOverride），不再自动弹动。⑤ Explored 聚合收起态改垂直跑
马灯：运行中头部行下方仅显示当前活跃一条子行，成员推进时旧条
translateY 上滑出、新条从下滑入（240ms、overflow hidden 裁切，
`activeTickerIndex` 纯函数选活跃成员，GroupedParts Fragment 解包
后索引），突发快进不排队；全部完成后收起态只留头部行，点击展开完
整列表；reduced-motion 直接替换。⑥ 回合内多段回复操作条唯一化：
runtimeAdapter 识别 reply run（相邻 assistant 描述符至下一条用户
消息为一 run），只给尾段标 `replyTail` 并聚合全 run 文本作
`replyCopyText`；中间段不渲染操作条（`dvx-message-cont` 收紧
margin 至 12px 正文节奏），尾段 Copy 复制整回合拼接文本（段间空
行）；单段回合形态不变，历史回放与 live 同构。门禁（当前树，含并
行代理在途文件）：typecheck 三段全过；全量 vitest 80 文件 1822 全
过（含新增 ticker 选择、auto-open/手动收起、reply-run 唯一操作
条 + 全文复制、钉条 data-open 用例）；build 过；两项 stress
（`run-stress-ticker.mjs` 120 回合、`run-stress-output.mjs` 120
回合）流式期间 50ms+ 长任务均 0 个；六处 harness 截图留档
`artifacts/tmp/`（ticker-live、exec-auto-open、pin-collapsed/
expanded、sent-image-thumbs、reply-run、smoke-scrollbar）。**本批
次未打包安装（完成时工作区含并行代理未提交在制品：
ChatController/ComposerControls/ComposerPopup），待随下一批次包一
起真机验收**：跑一条多工具探索回合应见 Explored 下单行跑马灯上滑
切换、Execute 行自动展开输出并在完成后收起；含 AskUser/计划批准
的多段回复应只在末段见一份操作条且 Copy 得全文；发一张图片应显示
48px 缩略图；进行中任务钉条应为独立暖卡面带 hairline 进度；全局
滚动条应为 6px 细样式。

2026-08-12 晚追加「P0：MCP Add server 死机修复 + 弹窗键盘跟滚」
（用户 v0.1.0 实测报告，提交 adf12c2 / fde72b3 / 50aef0f）。
真根因（headless Chrome 逐层事件跟踪实证，非猜测）：Add server
内联表单是嵌在 assistant-ui Composer `<form>` 里的**嵌套
`<form>`**，Chromium 不会让内层表单的 submit 事件传播越过外层
form 元素，挂在 React 根上的委托 `onSubmit`（及其
`preventDefault`）从未执行，任意一次点击（不只空表单）都触发浏
览器原生 GET 提交 → webview 整页导航 → 永久白屏（用户所称"死
机"）；jsdom 不模拟该截断，故既有测试一直全绿。修复：① 卡片改
`role="form"` 容器（不再有嵌套 form），提交走按钮 click + 输入框
Enter（`preventDefault` 同时挡住外层 Composer 的隐式提交，否则
Enter 会把草稿消息发出去）；名称与命令/URL 形状合法前 Add server
按钮禁用（沿用既有 `:disabled` 灰态），URL 非空但形状错时显示唯
一一条 quiet 提示，空提交兜底直接忽略。② Host 侧 fail-closed：
`withMcpTimeout`（30s）包住全部 MCP 目录读取与增删启停
RPC——stdio 命令可 spawn 但握手永不完成时，daemon RPC 原本永不
resolve，面板会卡 'loading' 全禁用；现在超时走既有失败路径（error
态 + 重拉目录 + retry 文案），面板保持可交互；Remove/Toggle/
Refresh 同 helper 一次覆盖。③ 同族修复：`/` 斜杠与 `@` 提及弹窗
键盘导航高亮滚出可视区不跟随——共享壳 `ComposerPopup` 以
MutationObserver 监听 `aria-selected` 移动并对高亮行
`scrollIntoView({ block: 'nearest' })`，环绕跳转与过滤重排一并跟
随，一处修生效于全部列表弹窗（模型弹层无键盘导航，不在此列）；
jsdom 无 scrollIntoView，vitest setup 补惰性桩。门禁：typecheck
三段全过；全量 vitest 80 文件 1825 全过（新增：嵌套表单回归断言 +
空/非法表单禁用与 Enter 用例、Host 挂起超时回错误态用例、弹窗高
亮跟滚用例）；headless Chrome 回归（`artifacts/smoke-mcp-add.mjs`
+ `mcp-add-harness.html`，真实 bundle）pass：空表单按钮禁用且点
击后页面未导航、消息零发送；非法提交显示 quiet 错误后 Add/
Refresh 立即可用；120px 限高下按住 ArrowDown/ArrowUp 走 30 步高
亮全程可见含环绕。**本批次未打包，随下一修复包一起真机验收**：
MCP 面板空表单点 Add server 应点不动（灰态）无任何反应；填一个
不存在的命令提交应在面板内看到 "Droid could not add that MCP
server..." 且面板可继续操作（≤30s）；`/` 弹窗按住向下键走到列表
底部之外高亮行应始终可见。

2026-08-12 深夜追加「已发送图片巨图路径修复 + 引用块降噪」（提交
f7f9b24 / 56bae56，blockquote 样式 hunk 因共有文件并发被卷入并行
代理的 62e0e1c，内容无损）：① 用户 v0.1.1 真机仍见巨幅已发送图
片，排查结论为**漏路径**而非旧 bundle：0.1.1 bundle 内 48px 规则
在（解包 vsix 验证），但它只覆盖 live 回显顺序（user 文本→image
项）；历史回放投影按原始消息 content 块序产出，CLI 会话文件里图
片块**永远在文本块之前**（探针扫描真实会话带图用户消息全部
`image,…,text`），前置 image 项挂不上 user 气泡、落入回合组按基
础样式独立渲染成 240px 大图。runtimeAdapter 现缓冲前置的
user-origin 图片项、由紧邻的 user 项收养，两种顺序同构；缩略图排
在文本上方（与 Composer 待发送区一致，Cursor 形态）；无相邻
prompt 的悬空图片仍独立渲染。AI 回复内生成图/工具结果图不受影
响。② Markdown 引用块降噪：A/B 两版 harness 对比后选 A（全中
性）——2px 暖灰 hairline（`rgb(38 33 27 / 18%)`）+ 次级暖墨
`#6b6259`，理由：引用是内容不是强调，且橙色左竖线在本项目已是通
知类表面（history-notice、empty-mark）的语言，引用继续用橙线会
语义混淆；嵌套引用、引用内 code/链接配色核对无恙；live 与历史共
用 `.dvx-markdown` 一处改全生效。门禁：typecheck 三段过；全量
vitest 80 文件 1826 全过（含新增历史序收养 + 悬空回退用例）；
build 过；截图留档 `artifacts/tmp/`（sent-image-order 双路径、
blockquote-current/-a/-b/-final）。**未打包，随下一批次包验收**：
重开带图历史会话应见 48px 横排缩略图在消息文本上方，点击开
Lightbox；含 `>` 引用的回复应为灰线灰字安静形态。

2026-08-12 深夜追加「会话抽屉运行指示 + 点击记录即回聊天」：①
先核实真实行为：daemon 模式关会话走 `session.detach()`，后端回合
继续跑（切回时经既有 `reconcileDaemonTurn` 收养）；进程模式
dispose 会 `interrupt()` 杀回合——指示器因此只覆盖 daemon 路径，
进程模式切换仍被 `canReplaceSession` 阻塞，行为差异以此为准。
Runtime 新增可选能力 `supportsBackgroundTurns()`（daemon true、
进程 false）与 `dispose({ preserveBackendTurn })`（daemon 只
detach 不 interrupt）；`DaemonSessionCatalog.readOpenedWorkingStates()`
读 daemon opened-session registry 的 workingState。Bridge：
`SessionSummary` 增可选 `running`；新增增量消息 `session.running`
（sessionId + running，状态变化才推，不整表刷新）；`host.snapshot`
增可选 `backgroundTurnsAvailable`（省略即 false），双侧校验闭合。
Host：`ChatController` 维护 running 注册表——活跃 daemon 回合切走
时 detach 并保旗；目录加载（启动/刷新/收藏与归档回读）后从 daemon
registry 播种，另一窗口或 CLI 占用的会话同样亮旗；1s 轮询 daemon
报 idle 即清旗（连续 3 次读失败 fail closed 全清）；本地回合终态
（完成/中断/出错）即时清旗；`canReplaceSession` 对可后台的 daemon
回合放开切换。Webview：抽屉行标题前 muted 色 1px 描边小圆环
（`dvx-spin` CSS 动画，不改行高，"Turn still running." 进可访问
名），`session.running` 增量进 store；App 在
`backgroundTurnsAvailable` 时不再因回合运行禁用会话行。② 点击
会话记录（含内容搜索命中）选中即关抽屉直接回聊天视图（Cursor
行为）；归档区展开、收藏、改名、归档等行内操作不关抽屉。门禁：
typecheck 三段过；聚焦 vitest 6 文件 580 全过。自验收（Delivery
loop 第 8 步）：scratch esbuild
（`artifacts/build-session-drawer-dist.mjs`，镜像 esbuild.mjs 的
webview 段、产物进 `artifacts/session-drawer-dist/`，不碰共享
dist/）+ 装置页 `artifacts/session-drawer-harness.html` + 无头
Chrome 冒烟 `artifacts/smoke-session-drawer.mjs` 全过：运行行
转圈（dvx-spin、muted、行高 35.5px 与普通行一致、悬停不变形）、
点第三条记录抽屉关闭且恰发一条 `session.select`、
`session.running:false` 后转圈原位消失、空列表安静文案、归档区
展开不关抽屉。截图：`artifacts/session-drawer-running.png`、
`-running-hover.png`、`-select-closes.png`、`-running-cleared.png`、
`-empty.png`、`-archived.png`。**未打包，随下一批次包验收**。遗留：
后台旗轮询仅在有旗时运转（无旗零开销）；空列表装置图中
「Earlier CLI messages…」通知与搜索框轻微叠压为既有形态问题，
与本切片无关。

2026-08-12 深夜追加「终端命令卡重做（对标 Cursor 档次）」：Execute
工具行升级为命令卡（提交 c7f9245）。① 卡头一行式：标题优先用
Execute 输入自带的 `summary`（Runtime `extractExecuteSummary` 消毒
限长后经既有 `action` 字段透传，live `normalizeSdkEvent` 与历史回
放 `projectSessionHistory` 双路等价；模型没写 summary 就用规则标题
——`commandCard.ts` 分词器取首个非 `cd/pushd/Set-Location` 前导的
命令名 + 至多两个裸词参数，上限 64 字符，绝不发明数据）；标题右侧
muted 等宽芯片列出解析出的命令名（去重、最多 4 个、逗号分隔、空间
不足先于标题让位省略）；右端 "…" 溢出菜单（仅 Copy Command——
Cursor 的 Auto-Run/Allowlist 属其权限体系不抄；点击复制显示
"Copied" 900ms 后自收，菜单开合不触发卡片折叠）+ 既有 chevron。
② 展开命令区：暖暗琥珀终端井（#262019，色温与暖白壳一致，非
Cursor 冷蓝），`$` 前缀 + 规则分词语法高亮（command 杏色加粗 /
flag 沙 / string 橄榄 / path 米白 / variable 陶土 / operator 暖灰 /
comment 斜体；token 逐字拼接即原命令），软换行 hanging indent
（`$` 列自持首列）。③ 输出区：等宽、贴井下方深一档色 + 暖发丝线
分隔，沿用既有 outputTail 截断、pinned 滚动与顶端渐隐；行号放弃
——outputTail 是滑动窗口无稳定行结构，不做假行号。④ 面板：白底
1px 边框圆角软阴影与消息流卡片家族一致，折叠态只剩卡头一行；运行
中沿用 shimmer/auto-open 不加新动画。CSS 用
`.dvx-activity-row.dvx-command-card` 双类压过后段扁平化层，标题色
限 `:not(.dvx-activity-running)` 保运行 shimmer。既有功能全通路保
留：流式追加、stop、后台命令提示行、终端镜像入口、Preview chip。
门禁：typecheck 三段过；聚焦 vitest（toolDetail /
normalizeSdkEvent / Thread / commandCard）过；全量 86 文件 1915
全过。自验收（Delivery loop 第 8 步）：真实构建 dist + 装置页
`artifacts/command-card-harness.html` + 无头 Chrome 冒烟
`artifacts/smoke-command-card.mjs`（gallery + running 两模式断言全
过：卡片家族外观、chips、暖暗井、$ 分色命令、长输出截断渐隐、菜单
复制、失败退出码摘录、后台提示、360px 无横向溢出、直播 tail 钉底、
完成自收）。截图：`artifacts/command-card-collapsed.png`、
`-expanded-short.png`、`-long-truncated.png`、`-menu.png`、
`-failed.png`、`-running.png`、`-narrow.png`。**未打包，随下一批次
包验收**。遗留：极窄宽度卡头芯片省略截断（by design）；无
summary 的链式命令规则标题取首个实义命令名（如 `Write-Output`），
不如模型 summary 可读，属数据上限而非缺陷。

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
- think→tool→think 回合按 SDK 段身份（`messageId:blockIndex` 折算
  回合内 `segmentIndex`）渲染为多个独立 Thinking 行，各自显示自己的
  真实思考耗时；已完成的段不再被后续 delta 增长
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

### 12. Canvas / 原型预览（2026-08-12 下午切片⑤，V1 #7）

- 转录里 Droid 产出的 `.html` / `.htm` 原型可在扩展内独立
  `WebviewPanel`（`ViewColumn.Beside`，单实例复用）中安全预览
- 预览入口是既有安静视觉语言里的克制 “Preview” 文字 chip：出现在
  Changes 卡的可预览文件行与工具活动行（仅 `completed` 且路径经
  `isPreviewableFilePath` 判定为可预览时），未新造横幅/填充徽标/彩条
- 工具栏提供 **Reload**（重读磁盘、重渲染）与 **Open in editor**
  （在编辑器打开原文件）两枚控制，均为暖中性描边按钮
- 安全模型（预研风险项逐条落实，Chromium 实证）：
  - **方案偏移（预研结论优先于设计推测）**：VS Code 自 1.56 起嵌套
    iframe 无法导航到 `asWebviewUri` 资源（microsoft/vscode#121479、
    #123766，官方 as-designed），故不采用设计文档推测的
    `asWebviewUri` 载入，改为 Host 侧读取原型 HTML 内联进
    `sandbox="allow-scripts"` 的 `srcdoc` iframe；面板
    `localResourceRoots: []`（零本地文件可读，比原计划父目录根更紧）
  - **R1 网络出口**：Shell 文档 CSP + 注入原型的 `<meta>` CSP 双点
    执行，`default-src 'none'`、`connect-src 'none'`、`img-src`
    仅 `data: blob:`——fetch/XHR/WebSocket、CDN 脚本、外链图片全部
    构造性阻断（Chromium 探针 fetch→TypeError、websocket→error、
    图片信标→blocked，ALL-PASS）
  - **同源逃逸 / vscode API / 存储**：`allow-scripts` 不带
    `allow-same-origin` ⇒ 原型为 opaque origin；探针实证父
    `contentDocument` 读取为 `null`、`contentWindow` 属性读取抛
    `SecurityError`、`acquireVsCodeApi` 不存在、`localStorage` 拒绝
    （ALL-PASS）
  - **原型→Host 通道**：Shell 不注册任何 `window` message 监听；
    沙箱子帧向 `parent.postMessage` 无消费者。Shell 工具栏只向 Host
    发两条固定、无 payload 的命令（`preview.reload` /
    `preview.openInEditor`）
  - **CSP 收紧的有意偏移**：Shell 脚本不加 nonce（nonce/hash 会让
    浏览器忽略 `'unsafe-inline'`，而 srcdoc 继承策略需要它跑原型内联
    脚本）；`'unsafe-eval'` 在 opaque origin 且零出口下不引入新面，
    保留以兼容 eval 型原型。Shell 模板每处插值均 HTML 转义
- **fail-closed 记录**：同目录相对资源（外链 CSS/JS/图片）在 opaque
  origin + 无 service worker 下不可加载，工具栏如实标注
  “Sandboxed · inline code only · no network”；仅自包含 HTML 可完整
  渲染。文件缺失/被移动/超 4MB（`MAX_PREVIEW_SOURCE_BYTES`）时面板内
  显示克制 notice 并回报 `preview-failed` 诊断，不静默
- Bridge 新增 `file.preview` 消息（`PREVIEWABLE_FILE_EXTENSIONS`
  白名单 + `isSafeWorkspaceRelativePath` 双侧校验，拒空/错扩展/越界/
  路径穿越/绝对路径/控制字符/超长）

主要实现：

- `src/shared/bridgeMessages.ts`、`src/shared/validateMessage.ts`
  （Bridge 契约 + 校验，`e8a0a37`）
- `src/extension/previewHtml.ts`、`src/extension/PreviewPanelController.ts`、
  `src/extension/prototypePreview.ts`（Host 面板与沙箱 shell，`baab0dc`）
- `src/extension/ChatController.ts`、`src/extension/extension.ts`
  （路由与注入，`6e8fad3`）
- `src/webview/assistant/Thread.tsx`、`src/webview/assistant/App.tsx`、
  `src/webview/assistant/styles.css`（Preview chip 与样式，`6369e96`）

### 13. 子代理摘要层级 + Mission 只读展示（2026-08-12 下午，V1 主线切片⑤）

- Task 委派行下挂一级缩进安静子行：「Delegated to `<type>` subagent」
  + description 副行 + 状态字；终态且 SDK 报告时行内
  「N tool uses · 时长」。只做一层；~~子行永远静态（父行 shimmer 为
  回合唯一动画）~~（**决策变更 2026-08-12 深夜**：用户真机遇到委派
  跑出回合外后全界面无动效、无法判断是否还活着，拍板 running 子行
  加安静小转圈；见 §23）；`childSessionId` 不进 Webview
- 流式：Runtime 会话级 `onNotification('child_session_available')`
  → `subagent-started` 事件（仅活跃回合；`toolUseId` 缺失时回落到
  最近运行中的 Task 行）→ Host `projectSubagentStarted` 行升级
- 结算：回合成功/中断后 `loadSubagentSummaries()`（fail-soft 回
  null）按（type, description）身份从台账取最新条目，只结算已达
  终态的行；无委派的回合不加载台账
- 历史：`loadSession().subagentInvocations` 建 FIFO 身份队列配对
  Task 行；`mission.state` + `decompSessionType` 投影快照 `mission`
  与目录 `missionRole`
- Mission 只读最小档：header 静字「· Mission · running」等，抽屉行
  「mission / mission · worker」注记（沿用 worktree 注记样式）；
  控制面（启动/暂停/恢复/Worker 重试）按设计判定不做
- Bridge `ToolSubagentSummary`（type ≤64 / description ≤512 / 状态
  枚举 / 计数安全整数）exact-key 双侧校验；恢复检查点 round-trip
  同规格（畸形条目整卡拒绝）

主要实现：

- `src/shared/bridgeMessages.ts`、`src/shared/transcriptLimits.ts`、
  `src/webview/bridge/validateHostMessage.ts`（Bridge 契约 + 校验，
  `c492c5d`）
- `src/runtime/subagentSummary.ts`、`src/runtime/FactoryDroidRuntime.ts`、
  `src/runtime/history/*`、`src/runtime/FactorySessionCatalog.ts`
  （通知订阅、台账投影、历史配对、目录角色，`07195d0` `95ca7e2`
  `3ccdb25` `63069ee`）
- `src/extension/turnActivityState.ts`、`src/extension/hostTranscriptState.ts`、
  `src/extension/SessionRecoveryStore.ts`、`src/extension/ChatController.ts`
  （行升级、结算、恢复、编排，`e854d9f` `0203c0e` `b8d7f3d`）
- `src/webview/assistant/store.ts`、`App.tsx`、`SessionDrawer.tsx`、
  `runtimeAdapter.ts`、`Thread.tsx`、`styles.css`（子行渲染与
  mission 静字，`4dcee12` `d1011f7` `9788c20`）

### 14. 三项体验补全：回到底部箭头 / 待答空隙 / 代码块 Preview（2026-08-12 傍晚）

- **回到底部箭头**：转录距底部超过 48px（`SCROLL_BOTTOM_SHOW_PX`）
  时，Composer 上方水平居中浮现圆形箭头（暖白底 `--dvx-raised`、
  1px `--dvx-border`、软阴影、hover 微反馈；160ms fade+4px lift，
  60ms 出现延迟吞掉一次性回放滚动的闪现帧；`prefers-reduced-motion`
  下无过渡）。可见性在滚动协调器同一 rAF pass（`updatePins`）里计
  算，与跟随态永不脱节；点击先置 `follow.following = true` 并标记
  `pendingProgrammaticTop` 再 `scrollTo`（平滑，reduced-motion 降
  级瞬时）——流式期间点击即恢复自动跟随，上滑断开为既有行为。隐藏
  态 `visibility: hidden` + `tabIndex -1` + `aria-hidden`，不占
  hit-test 与焦点序
- **待答空隙修复**：根因是 assistant-ui 发送后即挂载的乐观 assistant
  消息——空根元素零高度但仍消费 `.dvx-message` 的 20px 槽位 margin，
  与用户消息自身 20px 叠成 40px 假空隙，把 “Droid is responding”
  推远（截图 image-7446de06）。修复为 `.dvx-message-assistant:empty
  { display: none; }`，首个 part 到达该规则自然失效；headless 实测
  行距回到标准 20px。指示行本就在内容流内（无底部锚定 flex 规则），
  内容超一屏行为不变
- **代码块 Preview**：转录内 ```` ```html ```` 或以 `<!DOCTYPE` /
  `<html` 开头的代码块（宽松启发 `isInlineHtmlPreviewCandidate`），
  工具条 Copy 旁出现同视觉语言的安静 “Preview” 入口。消息仍在流式
  （aui `message.status.type === 'running'`，MermaidBlock 同款判定，
  transcript-only 的 `TranscriptCodeBlock` 包装）时不显示；超过
  `MAX_INLINE_PREVIEW_HTML_LENGTH`（512K UTF-16 单元）时入口禁用并
  带 tooltip 说明（转录侧 `MAX_ASSISTANT_TEXT_LENGTH` 200K 实际到不
  了上限，双侧校验属纵深防御）。点击经新 Bridge 消息
  `preview.inlineHtml`（exact-key + 空串/超限拒绝，双侧校验）到
  Host，`PreviewPanelController.openInlineHtml` 复用 Canvas 切片的
  `srcdoc` 沙箱路径（`sandbox="allow-scripts"` 无 same-origin、双点
  CSP 零网络原样），面板标题标注 “inline” 来源，Reload 对内联内容
  = 重渲染同一份存储的 HTML，Open in editor 对无背景文件的内联内容
  隐藏；单面板实例在文件/内联来源间复用
- 门禁（本切片完成时点）：typecheck 三段全绿；全量 vitest 68 files
  / 1586 通过；build 正常；headless Chromium harness 冒烟全绿
  （箭头：底部隐藏不闪现→上滑出现→未跟随时增长不动视口→点击回底部
  并恢复跟随→增长重新贴底；空隙：20px + 空根隐藏；Preview：入口在
  Copy 旁、点击恰好发一条 `preview.inlineHtml` 且 payload 与围栏源
  码逐字一致）

主要实现：

- `src/shared/bridgeMessages.ts`、`src/shared/validateMessage.ts`
  （`preview.inlineHtml` 契约 + 512K 上限 + 双侧校验；随并行代理提
  交并入 `3e7da6b`/`62b6f1b`）
- `src/extension/PreviewPanelController.ts`、`previewHtml.ts`、
  `prototypePreview.ts`（内联 srcdoc 渲染、inline 标题、Reload 语
  义、Open-in-editor 隐藏，`8739fd2`）；`src/extension/
  ChatController.ts` 路由（随 `3e7da6b` 并入）
- `src/webview/assistant/MarkdownText.tsx`（启发判定、流式门、超限
  禁用、`InlineHtmlPreviewContext`，`cae4890`）
- `src/webview/assistant/Thread.tsx`、`App.tsx`（协调器接线的箭头、
  webview 侧尺寸守卫与 `preview.inlineHtml` 发送，`cd7a74f`）；
  `styles.css`（箭头/空隙/工具条动作组样式，随 `62b6f1b` 并入）

### 15. 三项消息区/Composer 打磨：编辑卡免 Cancel / 悬浮操作条 + Fork / + 菜单过渡（2026-08-12 傍晚）

- **编辑卡去掉 Cancel 按钮**：用户消息编辑态的控制条只剩圆形发送
  按钮；点击卡外任意空白（document 级 `pointerdown`，卡内 ref 包含
  判定）或 Escape 即静默取消（`editStage.cancel`，无确认弹窗）。
  卡内弹出层（Mode/Model 选择）打开时，第一次外点只收弹出层
  （识别 `.dvx-composer-popover` 存在且未带 `data-popover-closing`）
  ，编辑器保持；下一次外点才收编辑器
- **Assistant 消息悬浮操作条（学 Cursor，无拇指）**：常驻
  “Copy Regenerate” 行改为 quiet 操作条——细字相对时间（“just
  now”/“2m ago”，hover title 显示绝对时间）+ Copy + Regenerate +
  Fork chat。较早消息 hover/focus-within 淡入（120ms），最后一条
  常显（`dvx-message-last`），流式中 `hideWhenRunning` 不显示、回
  合结束后出现。**Fork 能力如实边界**：SDK `forkSession` 只支持从
  会话当前态分叉（无逐消息锚点，见
  `docs/product/session-management-design.md`），因此 Fork chat 只
  出现在最后一条助手消息上，且仅连接态、无活动回合、无待答交互时
  可用（复用 Session 列表的 `session.fork` → Host 采纳 fork 会话
  路径）；不伪造“从任意消息分叉”
- **相对时间的如实边界**：完成时间由 webview 侧
  `runtimeAdapter` 的 completion clock 落章——只有本 webview 亲见
  从 streaming 转入终态的回合才有时间戳；历史/恢复重建的消息不伪
  造时间（操作条不显示年龄）。Bridge/Host 传输 `completedAt`（含
  恢复持久化）因 `bridgeMessages.ts`/`validateHostMessage.ts`/
  `hostTranscriptState.ts`/`store.ts` 被并行代理占用而**未接入**，
  随后续切片补；补齐前时间戳不跨 webview 重载存活（Tab 切换保留
  webview 后已可跨切换存活）
- **+ 菜单过渡动画**：+ 弹出层入场改用动效 token
  （`dvx-rise-in` + `--dvx-duration-slow`/`--dvx-easing-out-strong`
  ），退场新增 `dvx-rise-out`（`data-popover-closing` 期间延迟卸载
  播放，`pointer-events: none` 防吞点击）；Skills/MCP 钻入/返回经
  keyed `dvx-settings-view` 包装做方向性滑动
  （`data-direction='forward'/'back'`，12px + 淡入）。
  `prefers-reduced-motion` 全部豁免。TSX 侧逻辑
  （closingPanel/openSeq/方向 ref）随并行代理提交并入 `cdbbec8`
- 门禁（本切片完成时点）：typecheck 仅剩并行代理在途 `store.ts`
  一处错误（非本切片文件）；全量 vitest 73 files / 1691 tests，
  1678 通过、13 失败——全部源于并行代理在途的 ComposerControls
  plugins 切片（`SettingsPopover` 读未传入的 `plugins` prop 崩
  溃），与本切片无关；本切片聚焦测试 25/25 通过
  （messageActions 4 + MessageTimestamp/relativeTime 13 +
  runtimeAdapter 8）；build 正常；headless Chrome harness 冒烟三
  场景全绿（replay：早期消息 hover 淡入/最后一条常显/无伪造时间/
  Fork 仅最后一条且发 `session.fork`/编辑卡无 Cancel/卡内点击不
  关/弹出层外点两段式/Escape；stream：流式中无操作条、回合完成后
  “just now”；menu：入场 keyframe/方向属性/closing 态/卸载）
- **打包**：未打包。当前 `dist/` 含并行代理半落地的 plugins 切片
  （装入会使 + 菜单崩溃），本切片随下一个安全包一并安装

主要实现（`4ae602f`）：

- `src/webview/assistant/Thread.tsx`（外点取消 + 弹出层守卫、
  `ForkContext`/`ForkAction`/`ForkIcon`、`dvx-message-last`、
  时间戳接线）；`App.tsx`（`handleForkCurrentSession` 门控接线）
- `src/webview/assistant/runtimeAdapter.ts`（completion clock：
  streaming→settled 落章、首见即终态标记 settled 永不伪造、随
  转录修剪）
- `src/webview/assistant/relativeTime.ts`、`MessageTimestamp.tsx`
  （“just now/2m ago/3h ago/2d ago/日期”分级 + 按粒度自刷新）
- `src/webview/assistant/styles.css`（操作条 hover/常显/时间细字、
  `dvx-rise-out`、`dvx-settings-view` 方向滑动）
- 测试：`messageActions.test.tsx`（外点取消、Fork 仅最后一条、
  活动回合隐藏 Fork、时间戳只落亲见完成的回合）、
  `MessageTimestamp.test.tsx`、`relativeTime.test.ts`

### 16. 消息文本路径链接的 Preview 入口（2026-08-12 傍晚）

- **场景**：Droid 前一回合把 HTML 写盘，后一回合只在消息文本里以
  内联代码路径提到它（写盘回合的 Changes 卡不在视野）。现在路径
  链接（`dvx-path-link`）后紧跟一个 quiet 的 Preview chip（复用
  `dvx-preview-chip` 视觉 + `dvx-path-preview-chip` 行内微调），
  点击走现有 `file.preview` 消息打开 srcdoc 沙箱面板
- **工作区折算是前提**：webview 原本不知道工作区根，无法把
  `D:\...\烟花.html` 折算成 `file.preview` 要求的工作区相对路径。
  本切片给 `host.snapshot` 增加可选 `workspaceRoot`（Host 侧取
  `getWorkspaceContext().cwd`，无可用工作区时省略；webview 校验
  有界 + 控制字符拒收，整条快照 fail closed）。`file.preview` 的
  严格相对路径契约**零改动**
- **折算逻辑**：`pathLink.ts` 新增 `toWorkspaceRelativePath`
  （镜像 Host `handleWorkspaceReadImage` 的 inside-root rebase：
  相对路径归一化直通、盘符根大小写不敏感前缀匹配、POSIX 根大小写
  敏感、越界/等于根返回 null）；`MarkdownText.tsx` 的
  `previewablePathOf` 再叠 `isSafeWorkspaceRelativePath` +
  `isPreviewableFilePath`（与 Bridge 解析器、Host 同一套谓词）。
  **工作区外路径不出入口**（安全边界不破），非 .html/.htm 不出，
  无 root（rootless 工作区/独立渲染）不出；历史回放纯由
  转录 + 快照 root 渲染，天然可用
- 门禁：typecheck 绿（含 HEAD 干净检出的独立 worktree 复验）；
  全量 vitest 76 files / 1740 tests 全绿；build 正常；headless
  Chrome harness 冒烟（`artifacts/tmp/pathpreview-harness.html` +
  `probe-pathpreview.mjs`）：同一消息里工作区内路径恰好 1 个
  Preview chip、工作区外路径 0 个、两个路径链接都在、点击恰好发
  一条 `file.preview` 且 path 为 `artifacts/烟花.html`
- **打包**：本切片完成时点树绿、锁空闲，`package:vsix` 已启动，
  但流水线跑到 typecheck 时并行代理恰好落下 `9bc7a13`
  （/btw Bridge 契约半切片：新消息类型入 union、store reducer
  尚未消费 → TS2366），树转红打包中止。按约定**标注随下包**；
  等 /btw 切片补齐 store 消费后由下一个打包代理携带
- 并发说明：`7a8e33a` 提交时不慎并入并行代理在途的 /btw 弹层
  样式与 Thread/App 的 btw/计划钉条接线（工作树内容一致、门禁
  全绿）；其引用的 `planPin.ts`/`TaskPlanPin.tsx` 以
  `fab92da`（chore）落地保持 HEAD 干净检出可编译，SideChatSheet
  仍未被 HEAD 引用、留给原代理提交

主要实现：

- `src/shared/bridgeMessages.ts`、`src/webview/bridge/
  validateHostMessage.ts`（快照 `workspaceRoot` 可选字段 + 有界
  校验，`6196007`）
- `src/extension/ChatController.ts`（`emitSnapshot` 携带
  cwd、rootless 省略，`cf343a9`）
- `src/webview/assistant/pathLink.ts`
  （`toWorkspaceRelativePath`）、`MarkdownText.tsx`
  （`PathPreviewContext`/`previewablePathOf`/行内 chip）、
  `Thread.tsx`（`workspaceRoot` prop + provider）、`App.tsx`
  （`state.workspaceRoot` 接线）、`store.ts`（快照留存）、
  `styles.css`（`dvx-path-preview-chip`），`7a8e33a`
- 测试：`pathLink.test.ts`（折算 10 例：CJK/大小写/尾分隔符/
  前缀陷阱/POSIX/越界）、`MarkdownText.test.tsx`（chip 出现/点击
  发相对路径/编辑器链接不受影响/工作区外与非 HTML 不出/无 root
  不出）、`validateHostMessage.test.ts`（root 收发 + 4 类敌意
  形状拒收）、`store.test.ts`（快照留存/缺席回落 null）、
  `ChatController.test.ts`（快照携带 root、rootless 省略）

### 17. 任务计划钉条：Composer 上方固定当前计划（2026-08-12 傍晚；已被 §20 计划锚卡取代）

> 用户真机使用后拍板（2026-08-12 深夜）：钉条撤下，计划改为
> Cursor 式 "Created Plan" 锚卡进消息流（见 §20），底部空间让给
> 排队收纳条。本节保留为历史记录。

- **行为**（对齐 Cursor 双呈现：转录内计划渲染原样保留）：会话
  存在活跃任务计划（有未完成项）时 Composer 上方出现钉条。收起态
  一行 = 状态圆点（脉动）+ 当前 in-progress 项文本（无 in-progress
  回退首个 pending，ellipsis 截断）+ `完成数/总数` 计数 + 上向
  chevron；点击向上展开完整清单（已完成绿勾 + 删除线、进行中实心
  橙点脉动 + 加粗、待办空圈），再点/外部 pointerdown/Escape 收起。
  流式期间计划更新实时跟随（逐项 `dvx-todo-fade-in` 过渡）；全部
  完成→绿勾 "Plan complete" 完成态停留 1.6s 后 320ms 淡出。无
  活跃计划、纯历史回放已完成计划、切到无计划会话不显示；恢复
  会话若计划仍有未完成项则恢复显示（收起态）
- **数据链路零新增**：纯 Webview 投影。`planPin.ts` 从
  `Thread.tsx` 抽出 `parsePlanSteps` 作为转录清单与钉条共用的
  规范解析器；`selectTaskPlanPin` 从转录尾部扫最新
  `detailKind: 'plan'` 工具行（后写覆盖先写），产出
  `TaskPlanPinState`（sessionKey/planKey/steps/计数/当前项/
  allCompleted）。**live 完成 vs 回放的判别按会话记忆**：Droid 把
  最终全完成更新写成新 todowrite 调用（新 toolUseId），故组件以
  sessionKey 维度记住"本会话曾见过未完成计划"，live 完成庆祝后
  淡出，历史/跨会话已完成计划永不挂载
- **与回到底部箭头共存**（§14 切片先落）：钉条是
  `ViewportFooter` 内 Composer 上方的常规流内容；箭头
  `.dvx-scroll-bottom` 绝对定位 `bottom: 100%` 锚在 footer 上缘，
  钉条长高只会把箭头一起上推，冒烟实证两者矩形零重叠
- **视觉**：暖白卡语言（`--dvx-raised` 白底、`--dvx-border` 1px、
  12px 圆角、双层软阴影）；收起条细字低对比（`--dvx-muted`，
  计数 `--dvx-subtle` tabular-nums）；展开头退为 11px 节标签；
  入场动画仅 live 回合（复用 `dvx-anim-live` 门控），
  reduced-motion 全部动画/过渡关停，forced-colors 补 CanvasText
  边框
- 门禁：钉条单测 24 个全绿；中途基线（HEAD 干净检出独立
  worktree `dvx-plan-pin-gate`）vitest 76 files / 1760 tests +
  build 绿；队列/btw 切片落地后主树终态（`8e6f989`）typecheck
  三 tsconfig 全过、全量 vitest 80 files / 1804 tests 全绿、
  build 绿。headless Chrome harness 冒烟
  （`artifacts/plan-pin-harness.html` + `smoke-plan-pin.mjs`，
  对最终 dist 产物复跑）四场景 PASS：replay-open 恢复显示
  （2/3 + 当前项 + Composer 上方）、replay-done 不显示、stream
  全链（出现 1/3→更新 2/3 与当前项切换→展开三项状态图标各就位→
  外点收起→完成态 3/3→leaving→淡出→回合结束不复活）、arrow
  共存（箭头存在且零重叠）
- **打包**：完成时点等到队列/btw 切片全部落地、树绿锁空闲，
  `npx vsce package --no-dependencies -o dist/droidvisx.vsix`
  （10 files, 1.56 MB，含队列卡 + btw 修复 + 本切片）、
  `cursor --install-extension dist/droidvisx.vsix --force`
  successfully installed；待用户 Reload 后真机验收
- 提交：`fab92da`（chore：钉条模块 + Thread/App 接线随
  `7a8e33a` 落地）、`5d2c2cb`（fix：完成淡出改为会话感知）、
  `8e6f989`（fix：App 传入 session id 实参，selector 撤掉
  过渡默认值）

主要实现：

- `src/webview/assistant/planPin.ts`（`parsePlanSteps` 抽出 +
  `selectTaskPlanPin` 投影）、`TaskPlanPin.tsx`（收起/展开/完成
  淡出组件）、`Thread.tsx`（`taskPlanPin` prop + ViewportFooter
  挂载）、`App.tsx`（selector 接线）、`styles.css`
  （`dvx-plan-pin*` 样式族）
- 测试：`planPin.test.ts`（解析 + 投影 + 会话戳）、
  `TaskPlanPin.test.tsx`（展开收起/外点/Escape/live 完成淡出/
  新 todowrite 完成淡出/跨会话不庆祝/回放不挂载）

### 18. /btw 侧聊 + `/` 弹窗内置组扩充（2026-08-12 晚，斜杠对齐 S1+S2）

设计权威：[`side-question-design.md`](./side-question-design.md)（S1）
与 [`slash-parity-assessment.md`](./slash-parity-assessment.md)（S2），
均按第一切片定义交付。

- **S1 行为**：`/` 弹窗 Built-in 组末尾出现 `/btw` 行（仅当 Host 在
  快照上广播 `btwAvailable`；本切片时为 process 模式 only、daemon
  fail-closed 隐藏，§21 已移植 daemon 后该门变为模式无关）；
  选中行或直接发送 `/btw <问题>` 打开 Composer 上方 Side chat 卡片
  （复用 ComposerPopup 壳、窄栏适配，`/btw <问题>` 同时立即提问）；
  卡片内提问 → 流式答案（Markdown 渲染）→ 同卡连续追问；主 turn
  流式期间卡片可用；关卡（× 或切会话）即弃 fork。无 Promote、
  fork 不进任何会话列表、主转录零新增行、无 `turn.send` 泄漏
- **探针结论**（`artifacts/probe-btw-sidecar.mjs`，实现按此定型）：
  ① 链路选型——公开 `DroidClient` + 私有 `ProcessTransport`（与
  FactoryCommandCatalog 同通道）可完成 load→fork→ask 全链，
  `forkSession` 带 `btw-fork` tag 即获 CLI 原生 btw 语义（fork 点
  `lastCompletedTurn`、会话文件落 `sessions/btw/`、不建 cloud
  session），主会话 Runtime 绑定零接触；② fork 内权限行为——工具
  权限请求在 fork 内正常触发，故 sidecar 全部 deny
  （`outcome: 'cancel'`），该条目以引导文案报错（"去主聊天问"）
  而非渲染权限 UI；③ 泄漏验证——`sessions/btw/` 下的 fork 不进
  `listSessions`，会话抽屉零改动即免疫；`closeSession` 会终结
  子进程（生命周期按"一卡一 sidecar、弃后不复用"设计）
- **S2 行为**（纯 Webview）：修复 CLI 本命/别名漏发模型——
  `/compress`→ 既有 compact、`/clear`/`/handoff`→ 既有 new 会话，
  拦截在 `App.handleSend`（`slashBuiltins.ts` 单模块判定）；
  5 条导航行 `/model` `/mcp` `/skills` `/sessions` `/context`
  仍在 Built-in 组内（沿用现有行样式），选中打开对应既有
  popover/面板/抽屉（`navSignal` 信号链 + SessionDrawer 打开接线）
- **分层**：Bridge `btwProtocol.ts`（`btw.ask`/`btw.dismiss`/
  `session.btw` 三消息 + 卡片投影类型 + 双侧校验，长度/条数上限，
  `message: null` 与省略等价）；Runtime `btw/BtwSidecar.ts`
  （隐藏 fork + 流式 ask 生成器 + deny-all 权限 + dispose）；Host
  `btwSideChat.ts` + `btwCardState.ts`（卡片状态机投影、每会话
  单 sidecar、`resetSessionMetadata`/dispose 挂钩即弃）+
  `ChatController` 接线（快照 `btwAvailable` 广播）+
  `extension.ts` 仅 process 模式注入工厂；Webview `store.ts` btw
  切片、`SideChatSheet.tsx` 卡片、`Thread.tsx` `/btw` 行与
  `sideChat` 挂载、`App.tsx` 路由与生命周期
- 门禁（最终 HEAD `90b3c9c`）：typecheck 三 tsconfig 全过、全量
  vitest 80 files / 1804 tests 全绿（新增：btwProtocol 双侧校验、
  BtwSidecar 生命周期/权限 deny/中断、btwSideChat 状态机、
  ChatController btw 接线与换会话即弃、SideChatSheet 组件、
  store btw 切片、slashBuiltins 别名判定）、build 绿。headless
  Chrome harness 冒烟（`artifacts/btw-harness.html` +
  `smoke-btw.mjs`，对最终 dist 产物三连跑全 PASS）六场景：
  popup（/btw + 5 导航行在列）、card（开卡→提问→流式答案→追问→
  主转录零新增→零 turn.send→关卡发 dismiss）、slashText
  （`/btw <问题>` 直发开卡即问）、running（主 turn 流式中可用）、
  daemon（fail-closed：无行、文本直发模型）、aliases
  （/compress→compact、/clear→new、/model 开 popover、零漏发）
- 提交：`9bc7a13`（Bridge 契约）、`f0b6b2c`（Runtime sidecar）、
  `8f3a3f1`（Host 接线）、`f0aa775`（SideChatSheet 组件）、
  `2a0e763`（null message 校验修复）、`613a5fa` + `ddfa0dc`
  （S2 别名/导航 + slashBuiltins 模块）；S1 的 Thread/App/store
  接线与 `store.btw.test.ts` 在热点文件并发下随 `7a8e33a`/
  `7f95587` 入库（工作树内容一致、门禁全绿）
- **形态重做（2026-08-12 晚，用户拍板，提交 `aaaca96`）**：首版
  Composer 上方卡片被用户真机否决（"我都说做成 claude 那样，右边
  出现一个 side question"）。展现层重做为 Claude Code 同款**右缘
  滑入全高面板**：宽 `min(420px, 82%)`、左侧留主对话可见窄边 +
  暖色半透明遮罩（点击可关）、左缘 1px 边框 + 双层左投影、滑入
  220ms/滑出 200ms（reduced-motion 全禁）；结构 = 安静标题行
  （Side question + ×）→ muted 斜体提示语（对照 Claude 原文）→
  Q&A 转录区（内部滚动）→ 底部钉输入行（框式输入 + accent 发送
  按钮，Enter/点击发送）；空态 = 提示语 + 输入框。挂载从 Composer
  `sideChat` 槽迁到 App 根级（Thread.tsx 槽位管线拆除）；隐藏
  fork/deny-all 权限/关闭即弃/会话切换清理/Bridge 契约零改动，
  新增遮罩点击关闭。设计文档 §4.2 已重写为决策记录。门禁：
  typecheck 三 tsconfig 过、全量 vitest 80 files / 1818 tests
  全绿、build 绿；冒烟升级为七场景（新增 narrow：320px 仿真下
  面板 262px + 左边条可见 + 遮罩关闭发 dismiss）对新产物全 PASS，
  新形态截图目检（空态/问答态/320px）通过。冒烟脚本加预热导航：
  重建后首跑的冷缓存加载（懒加载 markdown/mermaid 分包）会拖垮
  等待窗口造成假失败——即此前记录的"20:00 瞬态失败"的真实成因。
  伴生 `9d0986b`（chore）：`aaaca96` 的共享文件 hunk 不可避免带入
  并行代理在途的 ActivityGroup 跑马灯接线，将其引用的
  `activityGrouping` 助手（18 测试绿）落地保 HEAD 可编译，跑马灯
  切片仍归原代理。**本次重做未打包，随下一个修复包**（当前安装包
  仍是旧卡片形态）
- **形态二次纠正（2026-08-12 晚，用户拍板，提交 `62e0e1c`）**：
  `aaaca96` 的右缘抽屉 + 遮罩被用户对照 Claude Code 截图再次否决
  ——"btw 并不是抽屉组件，他就是右边分了一块区域给 btw，它是共生
  的"。布局模型改为**双栏分栏**：打开时 shell 加
  `dvx-shell-split`（`grid-template-columns: minmax(0,1fr)
  auto`），Header/握手提示/`.dvx-thread` 显式放第 1 列，
  `.dvx-btw-panel` 占第 2 列跨全高（含 Header 行）；右栏宽
  `min(max(42vw, 200px), 420px, calc(100vw - 110px))`，左缘 1px
  分隔线，去掉遮罩、去投影、去"点外面关闭"（关闭只剩 ×/Esc/会话
  切换），两栏同时可交互、各自独立滚动，开合改为宽度 0↔稳态的
  200ms 展开/收合（子元素 min-width 锁稳态宽防中途换行，
  reduced-motion 禁用），窄视口分栏不回退浮层（320px 实测右栏
  200px/主栏 120px）。面板结构、空态、隐藏 fork 语义零改动。
  设计文档 §4.2 追加第二条决策记录。门禁：全量 vitest 80 files /
  1826 tests 全绿、build 绿；冒烟升级为八场景（narrow 改为分栏断
  言 + × 关闭，新增 mid 420px 分栏 + 主 Composer 可编辑断言）全
  PASS；三档截图目检（全宽 520 / 420 / 320）通过。typecheck 三段
  全绿（开发中曾撞上并行图片代理在途提交的 `typecheck:webview`
  瞬态红——runtimeAdapter 用 `item.turnId` 而 `UserTranscriptItem`
  无此字段；对方收回该提交后在 HEAD `e3d3ac5` 复验全绿）。
  **未打包，随下一个修复包**

### 19. Turn 运行中排队消息（2026-08-12 晚，V1 主线收官切片；UI 展现层已被 §22 收纳条取代）

设计权威 [`queued-messages-design.md`](./queued-messages-design.md)，
三切片（Bridge+Host 状态机 / Webview 路由 / 队列卡 UI）一次交付。
队列语义/状态机/协议至今有效；quiet 虚线卡、就地编辑、暂停横幅等
UI 描述见 §22 重做记录。

- **行为**：回合运行中 Composer 不再禁用——Enter 直接把消息送进
  Host 层 FIFO 队列（上限 10 条，满时 Composer hint 提示且发送键
  禁用）；排队消息以 quiet 虚线卡显示在转录尾部 / Composer 上方，
  单条可删、点击文本可就地编辑（Enter 保存 / Escape 放弃）；当前
  回合 **completed → 队首自动派发**为下一回合（turnId 即 queueId，
  附件在入队时从暂存区取走、随派发回合发送）；**Stop 或回合
  failed → 队列转暂停态**（横幅 + Send now / Clear，绝不自动派发，
  queue.resume 后恢复自动链式排空）；派发被 handleSend 残余守卫
  拒绝时转 `dispatch-blocked` 暂停而非丢消息。**边界**（照设计
  §5）：队列驻留 Host 内存，Reload 即失（卡上有细字注明）；换会话
  /新会话/fork/compact 丢弃队列并出 info 诊断；有排队消息时
  edit-resend 被阻断（互斥，诊断提示先清队）
- **Bridge**（协议 v6）：`queue.add/update/remove/resume/clear`
  （W→H）+ `queue.state`（H→W，权威快照）+ `host.snapshot` 可选
  `queue` 字段；`queueProtocol.ts` sidecar 模块双侧共用解析器，
  exact-key/长度/枚举/一致性（paused 非空队列）全量校验
- **Host**：`queuedPromptsState.ts` 纯函数状态机（入队去重/上限/
  编辑/删除/清空/暂停/恢复/派发决策 `evaluateQueueDispatch` 七守卫
  （turnActive/connected/runtime/session/pendingInteractions/
  sessionOp/settingsUpdate 任一不满足即 wait））；ChatController
  在 turn.state 终态处 settle：completed 微任务派发、interrupted/
  failed 暂停；**修复（`531049a`，真机冒烟揪出）**：完成 settle
  原在 runtime 流循环体内排微任务，抢在生成器 finally 释放
  active-turn 槽之前调 sendTurn，队首派发即刻 failed——改为先
  break 关闭流再 settle，回归测试用带真实槽语义的 mock 复现（旧序
  必红）
- **Webview**：store 乐观入队/编辑/删除 + `queue.state`/snapshot
  权威回填；`shouldQueueMessage`（回合活跃或暂停队列非空即入队）；
  Thread 的 Composer Input 自定义 onKeyDown 在 running 时把 Enter
  路由到 send（assistant-ui 对无原生 queue 能力的外部 store 默认
  吞掉该键）；重入闩仅锁直发路径，连发入队不受限；Composer hint
  随状态切换（Enter queues for after this turn / Queue is full…）
- **与 A4 恢复回合共存**：恢复占位（`recovery-*`）期间
  `isTurnActive` 为真→照常入队不派发；占位收口走同一 turn.state
  终态 settle 按状态机派发/暂停
- 门禁：typecheck 三段过；全量 vitest **80 files / 1805 tests**
  全绿（队列状态机全路径：入队/满/去重/派发/暂停/恢复/删除/编辑/
  互斥/会话丢弃/dispatch-blocked/流关闭时序回归）；build 过；
  `package:vsix` + `cursor --install-extension --force` 成功
- **真机验收**（`artifacts/probe-queue-smoke.mjs`，真实 CLI 登录 +
  生产 ChatController + FactoryDroidRuntime process transport，
  Bridge 消息流实测）：长回合流式中连发 3 条入队（FIFO 序确认）→
  completed 自动派发队首（turnId=queueId，队列 3→2）→ 派发回合
  Stop → interrupted + `paused=stopped`（2 条保留，6 秒无自动
  派发）→ `queue.resume` 派发队首 → 完成后队尾自动跟上 → 排空
  `items=0, paused=null`，**VERDICT: PASS**（输出仅布尔/计数，
  结果 `artifacts/probe-queue-smoke.out.json`）。面板内可视核对
  （排队卡样式/编辑交互）待用户 Reload Window 后验收
- 提交：`df8e5e2`（Bridge 契约）、`9de41ec`（Host 状态机）、
  `7f95587`（Webview 路由 + 队列卡 UI，含共居文件里 /btw 切片的
  store/App 接线一并落地）、`531049a`（派发时序修复）

主要实现：

- `src/shared/queueProtocol.ts`（契约 + 双侧解析）、
  `src/extension/queuedPromptsState.ts`（纯状态机）、
  `ChatController.ts`（queue.* 路由 + settle + 派发 + 丢弃点）、
  `store.ts`/`runtimeAdapter.ts`/`App.tsx`/`Thread.tsx`（乐观入队 +
  权威回填 + Enter 路由）、`QueuedMessages.tsx` + `queuedMessages.css`
  （队列卡/暂停横幅/就地编辑）
- 测试：`queueProtocol.test.ts`、`queuedPromptsState.test.ts`、
  `ChatController.test.ts`（队列 11 例 + 时序回归）、`store.test.ts`、
  `runtimeAdapter.test.ts`、`App.test.tsx`

### 20. 计划锚卡：Created Plan 卡锚进消息流（2026-08-12 深夜，取代 §17 钉条）

- **用户拍板**（真机用过 §17 钉条后，2026-08-12 深夜）：任务计划
  改成 Cursor 模式——计划锚进消息流，撤掉 Composer 上方的
  TaskPlanPin，把底部空间让给返工中的排队收纳条。§17 保留为
  历史记录，其行为/组件/样式均已被本节取代
- **形态**：计划创建的转录位置渲染一张 "Created Plan" 锚卡——
  安静眉标（uppercase 10px）+ 计划标题 + 一行摘要；卡底左侧
  "View Plan"/"Hide Plan" 文字入口，右侧状态控件：运行中暖色
  胶囊 "Building… n/m"（accent 混色边框/底/字 + chevron），
  回合结束未完成退为安静 "n/m"，全部完成转 "✓ Completed n/n"
  （灰勾，不淡出、不消失——与钉条语义不同，锚卡是转录的永久
  成员）。两个控件都在卡内展开/收起完整步骤清单（grid-rows
  0fr↔1fr 动画；步骤行沿用 5a89586 轻奢语言：完成灰勾退淡、
  当前步暖点 + 微高亮、待办空圈）。**数据边界**：Droid 的
  TodoWrite 只有 `todos` 步骤文本、没有 Cursor 那种计划标题/
  描述字段，故标题=创建版首步（静态）、摘要=最新当前步（与
  标题重复时退为 "n steps"），不发明 Droid 能力
- **计划更新原地改卡**：`selectPlanAnchors` 把 todowrite 按
  "步骤文本有交集=同一计划谱系" 聚为 lineage，每条谱系的最新
  状态投影到其创建行（完全不相交的新清单开新谱系、出新卡）；
  转录里原有 "Updated the task plan" 流水行原样保留（历史演化
  记录，Cursor 同款双呈现）。渲染走普通 tool-part 路径
  （`PlanAnchorSlot` 按 toolUseId 命中创建行），live 与历史
  回放天然同构；锚卡是普通流成员跟随滚动（用户明确不要吸底）
- **撤钉条**：`TaskPlanPin.tsx`/`planPin.ts` 及其测试删除，
  Thread/App 钉条状态清理干净（`taskPlanPin` prop →
  `planAnchors` map），`dvx-plan-pin*` 样式族整体替换为
  `dvx-plan-anchor*`
- 门禁（HEAD `5f9ed5c` 干净 worktree）：typecheck 三 tsconfig
  全过；全量 vitest 80 files / 1825 tests（1824 passed +
  1 skipped）；build 绿；120 回合 stress
  `run-stress-batch3.mjs` PASS（流式期间零 ≥50ms 长任务）。
  headless Chrome harness（`artifacts/plan-anchor-harness.html`
  + `smoke-plan-anchor.mjs`，对 dist 产物）三场景 PASS：
  replay-open（单卡、创建位在工具行正上方、安静 1/3、不
  Building）、replay-done（同位 "Completed 3/3" 终态）、stream
  全链（首个 todowrite 出卡 Building… 0/3 → 更新原地改卡
  2/3 且不出第二张 → View Plan 展开三态步骤 → 收起 → 全完成 +
  回合结束转 Completed 3/3 且不消失）。四态截图：
  `artifacts/plan-anchor-collapsed.png` / `-expanded.png` /
  `-building.png` / `-completed.png`
- **打包**：按用户指示不打包，随下个修复包
- 提交：`5f9ed5c`（feat：锚卡替代钉条，单提交含删钉条）

主要实现：

- `src/webview/assistant/planAnchor.ts`（`parsePlanSteps` 规范
  解析器迁入 + `selectPlanAnchors` 谱系投影）、
  `PlanAnchorCard.tsx`（卡组件）、`Thread.tsx`
  （`PlanAnchorContext` + `PlanAnchorSlot` 挂载、撤钉条）、
  `App.tsx`（selector 接线）、`styles.css`（`dvx-plan-anchor*`
  样式族）
- 测试：`planAnchor.test.ts`（解析 + 谱系锚定/原地更新/不相交
  开新谱系/标题摘要派生）、`PlanAnchorCard.test.tsx`（四态 +
  双控件展开收起）

### 21. 双模式归一：/btw 进 daemon + 默认 daemon + 能力×模式审计（2026-08-12 深夜）

目标（用户拍板）：**用户不再感知 process/daemon 模式差异**。三个
交付物均落地；本切片不打包（随统一修复包）。

- **交付物 1：/btw 移植进 daemon 模式**。探针
  `artifacts/probe-btw-daemon.mjs` 实证 daemon `sessions.fork`
  RPC 具备完整 btw 语义：ATTACHED 主会话上 fork 带 `btw-fork`
  tag → `newSessionId` 返回、fork jsonl 落 `sessions/<proj>/btw/`、
  `sessions.resume(forkId)` **不**触发 promote（不泄进磁盘目录）、
  fork 点 `lastCompletedTurn` 上下文继承、流式 delta、不进
  `sessions.list`、`close_session` 后 daemon 健康、主会话中途
  fork+ask（/btw 卖点）单连接可行。实现：
  `src/runtime/btw/DaemonBtwSidecar.ts`（`ConnectedDroid`
  fork→resume→stream，deny-all permissionHandler + askUser
  取消，投影复用 `BtwAnswerEvent` 契约），`extension.ts` 按
  `daemonSessionsActive()` 每次开卡时选 Daemon/Process sidecar
  工厂，Host `btwAvailable` 门从此模式无关（§18 的
  "process only" 限制已解除）
  - 已知残差（探针 `probe-btw-daemon2.mjs` 实证）：daemon 路径
    下主/fork 会话 autonomy 均为 low 时，工作区内文件创建仍
    **不触发**权限请求（process 路径会触发）——deny-all 引导
    文案只在 daemon 真的发请求时出现。语义仍 fail-safe（fork
    是隐藏分支、弃卡即弃），但与 process 的权限表现存在上游
    差异，记录待上游确认
- **交付物 2：默认模式切 daemon + 自动无感回退**。
  `package.json` 默认值 `process`→`daemon`；`extension.ts` 经
  `inspect('runtime.mode')` 区分显式设置与默认——显式选择永不
  回退，默认路径经
  `src/runtime/daemon/daemonFirstSessionFactory.ts`：首次建会话
  时 daemon 获取失败 → 记一条 `runtime.mode.fallback` 本地诊断
  （quiet，不打断用户）→ 粘性回退 process 工厂（不再重试
  daemon）。会话级错误（如跨窗口租约冲突）原样上抛不触发回退
- **交付物 3：能力×模式实测表**（探针/测试/真机冒烟佐证）：

  | 能力 | 门 | process（显式） | daemon（默认/显式） | 回退后（默认→process） |
  | --- | --- | --- | --- | --- |
  | 聊天/会话创建/恢复 | 无 | ✓ ProcessTransport | ✓ daemon 工厂 | ✓ process 工厂（`smoke-mode-fallback-live.mts` 6/6） |
  | 任务跨 Reload 存活 + 活流重连（A4） | 模式本身 | ✗（子进程随窗口死） | ✓（共享 daemon，`probe-reload-survival.mjs` + A4 真机） | ✗（回退即失去，符合预期） |
  | /btw 侧聊 | `btwAvailable` | ✓ `BtwSidecar`（`probe-btw-sidecar.mjs`） | ✓ `DaemonBtwSidecar`（`smoke-btw-daemon-live.mts` 9/9） | ✓ 开卡时动态回落 `BtwSidecar` |
  | 归档/取消归档/归档列表 + 内容搜索 | `daemonSessions` sidecar | ✓（Phase 1 私有只读 daemon） | ✓（同一共享连接） | 按需报错态（daemon 起不来时 `DAEMON_UNAVAILABLE` 诊断，与既有 process 失败路径一致，无假可用入口） |
  | Worktree 会话创建 | `worktreeCreateAvailable` | ✗（门恒 false） | ✓（daemon 原生 create 通道） | ✗（`withDaemonGate` 每次读时重估，fail closed） |
  | Plugins 面板（只读） | daemon sidecar | ✓（私有 daemon RPC） | ✓ | 按需报错态（同归档） |
  | 模型目录（BYOK reasoning） | 会话能力 | ✓ | ✗（daemon facade 无 `supportedReasoningEfforts`，显示 unavailable） | ✓ |
  | 浏览器 MCP OAuth（`authenticateMcpServer`） | 会话能力 | ✓ | ✗（daemon facade 无 `onNotification` 通道，fail closed；list/toggle/add/remove 均可用） | ✓ |
  | Spec 交接/子代理 started 通知 | `onNotification` | ✓ | ✗（同上，静默无害降级） | ✓ |
  | 终端镜像 / 权限 / AskUser / 队列 / rewind / compact | 无 | ✓ | ✓ | ✓ |

  process 独有能力盘点（供后续移植评估，不在本切片做）：模型
  目录、浏览器 MCP OAuth、spec 交接与子代理通知——三者同根
  （daemon facade 缺会话通知订阅与完整模型元数据），移植成本
  在上游 SDK/daemon 面，扩展侧无解法
- 真机冒烟（生产模块直驱，非 mock）：
  `artifacts/smoke-btw-daemon-live.mts` **9/9 PASS**（production
  daemon 生命周期 + `BtwSideChat` Host 驱动 + 真模型：开卡
  forking→ready、流式答、追问同 fork、fork 落 btw/、弃卡不
  promote、双列表零泄漏、主会话全程无恙）；
  `artifacts/smoke-mode-fallback-live.mts` **6/6 PASS**（坏
  daemon 二进制走真实 spawn/端口等待/换端口重试 → 回退记录
  恰一次 → process 会话真答 → 第二会话粘性不再碰 daemon）。
  注意：daemon 起不来时端口等待 + 一次重试合计约 64s，首个
  会话建立会慢这一拍，之后恢复正常
- 测试：`DaemonBtwSidecar.test.ts`（fork 参数/attach/流式/
  权限拒答文案/追问/dispose/无效 fork 响应）、
  `daemonFirstSessionFactory.test.ts`（daemon 正常路径/获取失败
  粘性回退/会话级错误不回退/回退观察者抛错不伤会话）

### 22. 排队收纳条：队列折叠 + 行内三键 + Edit Queued 回 Composer（2026-08-12 深夜，重做 §19 展现层）

- **用户拍板**（真机用过 §19 摊开卡后，附 Cursor 截图两轮）：
  排队消息改为 Cursor 式收纳条 + 行内动作 + "编辑回 Composer"。
  队列语义、Host 状态机、入队/派发协议不动，§19 的行为与真机
  验收仍有效；本节取代其 UI 描述（quiet 虚线卡/就地编辑/暂停
  横幅均撤下）。设计权威已同步（`queued-messages-design.md`
  §4.7/§4.8/§5.1）
- **形态**：`ViewportFooter` 内 Composer 正上方一条收纳条，暖卡
  语言与 §20 计划锚卡同族（1px 边框 + 12px 圆角 + 暖渐变 + 双层
  软阴影，≥900px 与 Composer 同宽 860px）。收起态一行
  "N Queued · ⏎ to Send" + chevron（数量实时）；暂停/满员语义
  折进头部行（"paused after stop / paused after a failed turn /
  sending is blocked right now / queue full"）。点击展开
  （grid-rows 0fr↔1fr，reduced-motion 直落；外点/Escape 收起）：
  每行单行截断 + 附件 "[image]" 类小标记 + hover 显影的行内三键
  （铅笔=编辑、↑=立即发送、垃圾桶=删除，常驻 0.45 透明度）；
  展开区底部注脚常态为持久化说明，暂停态换 "Automatic sending
  is paused" + Send now / Clear quiet 动作，新进入暂停态自动
  展开一次。原与 Task Plan 钉条的兄弟堆叠需求因 §20 撤钉条
  自然消解——footer 只剩队列条一层，与流内计划卡同框呈现
- **立即发送 = `queue.promote`**（Bridge 协议 v6→**v7**，W→H 第
  6 条消息）：状态机 `promotePrompt` 纯重排提队首；控制器语义
  ——turn 运行中**只重排不打断**（运行时协议无 mid-turn 注入，
  完成后优先派发，如实取舍）；暂停态下显式发送意图兼作
  resume，空闲立即派发该条后按既有链式规则继续
- **Edit Queued（编辑回 Composer，替代就地 textarea）**：点铅笔
  → 文本装回 Composer（`DraftSynchronizer` 命令通道复用）、
  Composer footer 出 "Edit Queued ×" quiet chip、hint 换
  "Editing a queued message · Enter saves · Esc cancels"；队列行
  原位保留、三键隐去、右侧斜体 "Editing"。Enter = `queue.update`
  原位替换（**满队不阻塞**——`SendEligibility.queueEditing` 豁免
  full-queue 守卫，替换不是新增）；×/Escape 取消 = Composer 清空
  复原；编辑期间该条被派发/删除（权威回声）→ 编辑态自动结束、
  Composer 文字保留为普通草稿。**与 edit-resend 互斥双向**：进
  Edit Queued 关闭打开中的编辑卡（sendSignal 关卡），打开编辑卡
  取消 Edit Queued。store 新增 `queueEditing` 状态（begin/end +
  promote 乐观重排 + snapshot/echo/会话切换对账清理）
- **附件边界（V1 取舍，如实记录）**：附件负载在 Host、Webview 仅
  元数据投影，无法随文本回 Composer 暂存区——编辑时附件留在队列
  条目上原样保留，保存只替换文本；负载回传暂存契约登记为后续
  增强
- 门禁：typecheck 三 tsconfig 全过；全量 vitest **85 files /
  1865 tests 全绿**（新增 promote 状态机/协议/控制器派发序 +
  store 编辑态/promote + `QueuedMessages.test.tsx` 组件 7 例 +
  App 集成编辑全流程；一并首跑中 `Thread.test.tsx` 计时器伪钟
  用例偶发红 2 例，复跑两次全绿，与本切片无关）；build 绿。
  headless Chrome harness（`artifacts/queued-bar-harness.html` +
  `smoke-queued-bar.mjs`，对 dist 产物）全链 PASS：空队不渲染 →
  收起态（footer 内、Composer 上方、头部文案）→ 展开三行三键 +
  [image] 标记 → 编辑态（Composer 预填 + chip + hint + 行
  Editing + 该行三键禁用）→ Enter 保存 `queue.update` 原位替换 +
  chip 退场 + Composer 清空 → Stop 转暂停（头部 paused 文案 +
  自动展开 + foot Send now/Clear）→ foot Send now 发
  `queue.resume`、行内 ↑ 发 `queue.promote`。五张截图：
  `artifacts/queued-bar-collapsed.png` / `-expanded.png` /
  `-with-plan.png`（与计划锚卡同框）/ `-paused.png` /
  `-editing.png`（Composer 带 Edit Queued 徽标 + 行 Editing）
- **打包**：按用户指示不打包，随下个修复包；真机可视验收待下个
  包安装后进行
- 提交：`aedbb64`（Bridge/Host promote）、`d478925`（store 编辑
  态）、`afb30bb`（收纳条 + Composer 编辑路由）

主要实现：

- `src/shared/queueProtocol.ts` + `bridgeMessages.ts` +
  `validateMessage.ts`（`queue.promote`、协议 v7）、
  `queuedPromptsState.ts`（`promotePrompt`）、`ChatController.ts`
  （promote 路由：重排 + resume + maybeDispatchQueue）、
  `store.ts`（`queueEditing` + promote 乐观）、
  `runtimeAdapter.ts`（`SendEligibility.queueEditing` 豁免）、
  `App.tsx`（编辑路由/预填/取消 + promote 接线）、`Thread.tsx`
  （队列条入 footer、Edit Queued chip、Enter/Escape 路由、互斥）、
  `QueuedMessages.tsx` + `queuedMessages.css`（收纳条重写）
- 测试：`queuedPromptsState.test.ts`、`queueProtocol.test.ts`、
  `validateMessage.test.ts`、`ChatController.test.ts`（promote
  两例）、`store.test.ts`（promote/编辑态两例）、
  `QueuedMessages.test.tsx`（新建 7 例）、`App.test.tsx`（编辑
  全流程集成）、`runtimeAdapter.test.ts`（满队编辑豁免）

### 23. 子代理 "N Working" 徽标 + 活动弹层 + 僵尸 running 治理（2026-08-12 深夜）

- **背景（用户真机缺陷）**：Droid 异步派发子代理后父回合先结束，
  子行僵在 "· running" 且全界面无动效（"我都不知道是不是结束了"）。
  对照 Cursor 形态拍板本切片：Composer 上方左侧 "N Working" 药丸 +
  点开活动列表 + Stop All；running 子行加安静转圈（推翻 §13
  "子行永远静态" 决策，原句已划改）
- **探针结论**（`artifacts/probe-zombie-subagent.mjs`，两问两答）：
  - **回合外事件不到达**：父回合终态后，子会话状态/终态不再产生
    任何会话订阅通知（facade `onNotification` 与 raw observer 均
    无 task 身份事件，仅一条无身份的父级 token_usage 变更）；但
    `task-invocations` 台账持续如实更新，轮询 `loadSubagentSummaries`
    可在终态后 2–10s 读到
  - **回合外 Stop 不可行**：无活跃回合时 `session.interrupt()`
    正常 resolve 但**不会**终止后台子代理（台账保持 running 直到
    子代理自然完成）——弹层对回合外条目禁用 Stop All 并给 muted
    说明，不做假控件
- **僵尸治理（Host）**：既有回合末结算保持；结算后仍 running 的
  行进入 `zombieSubagentWatch`（5s 轮询台账、10min 上限、会话切换
  /dispose 即撤；同会话新回合的僵尸行并入同一 watch）。身份配对
  按（type, description）计数防误配：台账中同身份 live 条目数 ≥
  待结算行数时不结算（防旧终态条目吞掉真 running 行），live 减少
  才最新行配最新终态条目。结算走新 Bridge 消息
  **`subagent.update`**（exact-key 双侧校验；Host 转录同步投影，
  快照/恢复一致）
- **顺带修复的既有缺口**：回合末结算原走 `tool.activity`，但该
  消息在回合终态后被 Webview `acceptsActiveTurn` 丢弃——正是真机
  截图里"台账已终态、界面仍 running 直到重载"的直接原因；现改发
  `subagent.update`（`ChatController.test.ts` 断言已更新为新通道）
- **徽标 + 弹层（Webview 纯推导，无新增数据消息）**：
  `selectWorkingSubagents(transcript, liveTurnIds)` 数 running 委派
  行；`liveTurnIds` 为本连接在 `state.turn` 上见过的回合 id（App
  累积、切会话清空）——历史回放永远不出徽标，回合结束后委派仍
  running 时徽标持续（正是用户最需要它的时刻），全部终态即消失。
  药丸悬浮 Composer 左上缘（`dvx-working-dock` 0 高锚 + 绝对定位，
  不与队列条/锚卡堆叠），小转圈 + "N Working"；点开
  `ComposerPopup` 壳弹层：每行 类型 + 描述（单行截断）+ 实时走秒
  时长（弹层开着才走 interval），右上 Stop All = 现有
  `turn.stop` 通道（无二次确认）；~~回合外 Stop All 禁用 + 注脚~~
  （**决策修正 2026-08-12 深夜**，用户拍板"停不掉的就不画控件"：
  回合外无可停条目时 Stop All 与注脚整个不渲染——不是禁用，是不
  存在，状态本身已说明一切）；每行留 View 挂点注释（回放切片
  §6.1 接入，本切片不渲染）
- **子行动效与诚实降级**：running 子行加 8px CSS 转圈
  （`dvx-spin`，compositor-only，reduced-motion 静止、
  forced-colors 适配）；父 Task 行已终态而子行仍 running 时状态字
  降级为 **"running in background"**（真机缺陷形态的诚实表达）
- 门禁：typecheck 三 tsconfig 全过；全量 vitest **85 files /
  1887 tests 全绿**（新增 `subagentWorking.test.ts` 选择/走秒、
  `WorkingBadge.test.tsx` 徽标/弹层/Stop All/回合外禁用 9 例、
  store `subagent.update` 两例、`turnActivityState` 僵尸配对 5 例、
  `ChatController` 后台委派持续结算 + 转录快照落地、Thread 子行
  转圈/降级 3 例、validateHostMessage 校验例）；build 绿。
  headless Chrome harness（`artifacts/working-badge-harness.html` +
  `run-smoke-working-badge.mjs`，对 dist 产物）live + zombie 双
  场景 PASS：live——徽标 "2 Working" 转圈 → 弹层两行走秒 +
  Stop All 可用 → Stop All 后弹层与徽标齐退、子行 cancelled；
  zombie——回合终态后徽标仍在、子行 "running in background" 带
  转圈、无任何 Stop 控件与注脚（决策修正后复验重截）、
  `subagent.update` 逐条结算徽标 2→1→消失。四张截图：`artifacts/working-badge-active.png` /
  `-popup.png` / `-stopped.png` / `-zombie.png`。120 回合 stress
  （`run-smoke-subagent.mjs` 更新断言后）复跑三次，两次
  streamingLongTasks 为零（首次一条 74ms 属启动噪声，复跑均绿），
  子行断言已随决策变更更新（running 行恰一个 `dvx-spin`、僵尸行
  "running in background"）
- **打包**：按用户指示不打包，随下个修复包；真机可视验收待下个
  包安装后进行
- 提交：`e115754`（Bridge subagent.update）、`a8e6eb9`（Host 僵尸
  结算 + 轮询 watch）、`f6ed385`（store 接收结算）、`60e0b6e`
  （徽标/弹层/转圈/降级）

主要实现：

- `src/shared/bridgeMessages.ts` + `src/webview/bridge/validateHostMessage.ts`
  （`subagent.update` 消息 + 双侧校验）
- `src/extension/turnActivityState.ts`（`collectRunningSubagentRows` /
  `settleZombieSubagents` 计数配对 / `applySubagentSettlement`）、
  `ChatController.ts`（`zombieSubagentWatch` 轮询 + 回合末结算改道
  `subagent.update`）、`hostTranscriptState.ts`（转录投影）
- `src/webview/assistant/subagentWorking.ts`（running 委派选择 +
  走秒格式）、`WorkingBadge.tsx`（药丸 + 弹层）、`App.tsx`
  （liveTurnIds 累积 + 接线）、`Thread.tsx`（footer 插槽、子行
  转圈、"running in background" 降级）、`styles.css`（dock/药丸/
  弹层/转圈全套 + reduced-motion/forced-colors）

### 24. 子代理体验审计：派发身份直出 + Reload 后僵尸 watch 重挂 + 子行即时动效（2026-08-13 凌晨）

- **背景（端到端审计两根因）**：真实会话探针（2026-08-13，process
  传输）证实 `child_session_available` 通知直到 Task 自己的
  tool_result 才随流面世（实测滞后 39s）——整个可见运行期用户只看到
  一条裸 "Delegated focused work · Working" 行，不知道派了什么、
  子行转圈（§23）实际从不出现在直播期；且 Reload Window 后
  `zombieSubagentWatch` 随旧窗口死亡、resume 不重挂，回放出的
  running 子行永远冻结（台账无推送通道）——即用户报的"刷新之后
  子代理没了/僵住"。另：通知身份与 Task input 可不一致（input
  `explore`，通知报 `explorer`），通知保持权威
- **修复 1（Runtime）**：`normalizeSdkEvent` 在 tool_call 即用
  `readTaskDelegation` 从 Task input（`subagent_type` +
  `description`）读出委派身份，挂 `tool-start.subagent`（无
  status——生命周期仍归通知/台账权威；prompt 正文不过桥）
- **修复 2（Host）**：`turnActivityState.projectToolEvent` 首次投影
  即带身份；`projectSubagentStarted` 改"无 status 才升级"（通知
  身份覆盖 input 猜测），fallback 目标解析同步放宽到"无 status 的
  Task 行"。回放路径：`collectTranscriptSubagentRows` 从回放转录
  收 running/pending 委派行，`activateRuntime` 的 resume 分支经
  `armReplayedSubagentWatch` 重挂同一台账轮询（5s/10min 上限），
  结清走既有 `subagent.update`（Host 转录同步投影，快照一致）
- **修复 3（Webview）**：`SubagentSummaryRow` 新增 `parentRunning`；
  父 Task 行 running 而子行尚无 status 时按构造即"活干"——转圈 +
  "running"，通知到达后同视觉无缝接续，不再整个直播期呆滞
- 点击死区核实（今晚只核实不实现）：子行为纯 div，无 cursor/hover
  可点击暗示，无假 affordance；父行 `<details>` 展开正常。子代理
  转录细节回放仍在明日 backlog
- 门禁：extension/webview tsconfig typecheck 过；全量 vitest
  **85 files / 1893 tests 全绿**（--maxWorkers=4 末尾单跑一次；
  新增 normalizeSdkEvent 委派身份例、turnActivityState 身份升级/
  fallback/转录收集 3 例、ChatController 回放重挂轮询例、Thread
  identity-phase 转圈 2 例）；worktree dist headless 冒烟
  `run-smoke-subagent.mjs`（harness 步骤与断言已更新为新 emit
  次序：identityPhase===1 时子行已在场转圈）replay/stream/stress
  三场景 PASS（stress streamingLongTasks 为零）；
  `shot-journey.mjs` 前后对比截图：`subagent-before-dispatch.png`
  （修前直播期裸行）vs `subagent-smoke-streaming.png`（修后身份+
  转圈直出）、`subagent-reload-before-settle.png`（"running in
  background"）vs `subagent-reload-after-settle.png`（台账结清
  "completed · 9 tool uses · 2m 3s"）
- 边界（不修，上游/后续）：回合外实时事件不存在（台账轮询是唯一
  通道）；回合外 Stop 不可行（§23 决策：不画控件）；回放会话不出
  "N Working" 徽标（liveTurnIds 设计保留，行内状态仍会被重挂的
  watch 结清）；子行点击看细节 = 明日转录回放切片

主要实现：

- `src/runtime/runtimeEvents.ts` + `normalizeSdkEvent.ts`
  （tool-start 委派身份直出）
- `src/extension/turnActivityState.ts`（身份投影/升级 +
  `collectTranscriptSubagentRows`）、`ChatController.ts`
  （`armReplayedSubagentWatch` resume 重挂）
- `src/webview/assistant/Thread.tsx`（`parentRunning` 即时动效）

### 25. Add Selection to Chat：编辑器右键选区入 Composer（2026-08-13 凌晨）

- **切片范围**（[`add-to-chat-design.md`](./add-to-chat-design.md)
  入口 a；入口 b/c 未做）：编辑器选中文本后经右键菜单项或命令面板
  "DroidVisX: Add Selection to Chat"（`droidvisx.addSelectionToChat`，
  菜单 `when: editorHasSelection`）把选区作为 selection 附件送入
  Composer 暂存 chips。**Bridge/Webview 零改动**：走既有
  `attachment.*` 暂存管线与 `session.attachments` 广播，chip 家族
  （SELECTION 标签 + 名称 + truncated 标记 + × 移除）现成。
- **Host**：`ChatController.addEditorSelectionToChat()` 公开入口复用
  `handleAttachmentCapture('selection')`（互斥、8 条上限、diagnostic
  语义全继承）；`extension.ts` 命令先 focusView reveal 再暂存，视图
  首次打开未连接时 250ms×20 重试，超时记
  `attachment.add-selection-command.dropped` 诊断（安静降级，
  无新错误面）。
- **选区 payload 升级**（`selectionAttachmentPayload`，
  `attachmentSources.ts` 纯函数；webview `+` 菜单 Attach selection
  同步受益）：内容从裸文本变为带 `起:迄:相对路径` 头的 fenced
  代码块（围栏长度超过选区内最长反引号串），chip 名保持
  `<basename>:<起>-<迄>`；包装与截断注明
  `[selection truncated at the attachment size limit]` 一并计入
  256K 字符上限，不会触发 runtime 侧文本附件超限抛错；选区终点在
  行首（列 0）时行号回退一行，与编辑器高亮一致。
- **门禁与自验收**：聚焦 vitest 2 文件 17 用例过（payload 三态 +
  命令入口暂存/发送全链，`attachmentSources.test.ts` +
  `ChatController.attachments.test.ts`）；全量 vitest 96/97 文件
  1943/1950 过——7 败全在并行主题代理在制品
  `DroidViewProvider.test.ts`；typecheck 3 错、lint:budgets 1 超限
  同为并行在制品（`UiThemeMessage` / `App.tsx`），本切片文件全绿；
  build 过。活体探针 `artifacts/probe-add-selection.ts`（生产
  payload 函数 + 真实 FactoryDroidRuntime + BYOK
  `custom:GPT-5.6-Luna-0`）：真实回答准确引用
  `src/extension/chat/attachments.ts` 与 746–754 行号，15.5s，
  turn success，录制 `add-selection-probe-data.js`。视觉自验收
  `artifacts/add-selection-harness.html`（真实 dist bundle 回放
  探针真实数据）三态截图：`add-selection-chip.png`（暂存 chip，
  含相邻 truncated 态）、`add-selection-sent.png`（发送后 sent
  chip）、`add-selection-answer.png`（真实 Luna 应答）。
- **遗留**：真实 Cursor 里右键菜单行与命令注册未做真机验证（本
  切片按纪律不打包安装，待下次打包随包验收）；`ctrl+alt+l`
  快捷键待真机冲突验证后另行贡献；入口 b（文件右键）/入口 c
  （转录选中引用）未实现。

### 26. 主题切换：炭黑暗色主题 + Auto 跟随（2026-08-13 凌晨）

- **切片范围**（[`theme-switching-design.md`](./theme-switching-design.md)
  §0 用户拍板方向；实施基准 `artifacts/theme-proto-dark.png` v2
  灰阶原型）：`droidvisx.theme` 三态设置项（auto/light/dark，默认
  auto），切换即时生效不需 Reload；暗色盘 = Cursor 灰阶
  （surface `#1a1a1a` / raised `#242425` / code `#1e1e1f`、半透明白
  边框 9%/16%、正文 `#e8e8e8`≈13.6:1、muted `#9a9a9a`≈5.5:1），
  品牌橙全退场（accent 族在暗色落到浅灰，发送键 = 浅色填充
  `#1a1a1a` 图标），hljs 整组换 VS Code Dark+ 系。
- **机制**：Bridge 协议 v7→v8，新增 `ui.theme.set`（W→H）/
  `ui.theme`（H→W，**刻意无 sequence**——它是 DroidViewProvider 直发
  的视图层推送，不过 ChatController 的 sequence 戳章器，也不进
  webview store；为此收窄 `ControllerHostMessage` /
  `StoreHostMessage` 两个类型口）。Host 侧偏好 = VS Code 用户设置
  （`ConfigurationTarget.Global`），`onDidChangeConfiguration` 与每次
  `webview.ready` 重推；Auto 由 webview 侧 MutationObserver 盯 body
  的 `vscode-dark`/`vscode-high-contrast(-light)` class，零轮询零
  Bridge 流量。防白闪：`getWebviewHtml` 按启动主题给内联首帧背景
  （light `#f5f3ef` / dark `#1a1a1a`）并在 `<html>` 上印
  `data-dvx-theme` + `data-dvx-theme-preference`，App 启动时读回，
  首条 `ui.theme` 到达前不会误翻转。
- **样式层**：`00-tokens.css` 增 `.dvx-shell[data-theme='dark']`
  token 块（含 color-scheme: dark、暗色阴影、语义色提亮
  diff-add/del、`--dvx-focus` 新 token——焦点环按 theme 文档 §1.3 与
  编辑器解耦，光标橙/暗色半透明白）；token 作用域并入两个 body
  portal 根（`.dvx-image-lightbox`、`.dvx-slash-tooltip`，顺带修复
  slash tooltip 在 shell 外 var() 失效的隐性 bug）。新增
  `24-theme-dark.css`（约 460 行，import 链末位）逐条覆写各分区
  残留暖白字面量：页面底色/滚动条（`html[data-dvx-theme='dark']`
  键）、markdown 链接换亮铜色、命令卡暖琥珀井重校准
  （`#262019`→`#16120e`，比暗色卡面再暗一档保住"凹陷终端"层级，
  暖色命令高亮原样保留）、计划锚卡/排队条暗色渐变卡面、shimmer
  灰底金闪等。Mermaid 增暗色 themeVariables 组，主题切换时
  re-initialize 并重渲已挂载图表。
- **入口 UI**：设置弹层 Mode/Autonomy 之后一行 Theme 三态下拉
  （复用 `SettingsDropdown` 行样式，UI 零新样式元素；不随 turn
  禁用）；经 `ThemeContext` 注入（App 提供，`useThemeController`
  hook 承载全部接线，守住 App.tsx 行数棘轮）。
- **门禁**：聚焦 vitest（webviewHtml/DroidViewProvider/双向校验器/
  theme 单元/App 主题/弹层行/Mermaid）全绿后，全量 vitest 一次
  `--maxWorkers=4`：**100 文件 1993 用例全过**；`lint:budgets` 绿
  （ChatController/App 棘轮内）；`tsc -p tsconfig.webview.json` 绿，
  全量 typecheck 剩余 4 错**全部在并行 BYOK 代理未跟踪在制品**
  （`chat/customModels.ts`、`ChatController.customModels.test.ts`、
  `CustomModelsPanel.tsx`——其 `customModels.*` 联合类型成员尚未
  落进 bridgeMessages），本切片文件全绿；build 过（webview.css
  125.7kb）。
- **视觉自验收**（真实 dist bundle，`artifacts/shot.mjs` +
  visual/command-card/queue-bar 装置，截图存 `artifacts/`）：
  `theme-light-conversation.png`（暖白基准零回归）、
  `theme-dark-conversation.png`、`theme-auto-follow-dark.png`
  （body class 翻转即跟随）、`theme-dark-markdown-top.png`
  （Dark+ 语法色/内联码/引用块/链接）、`theme-dark-plan-anchor.png`
  （锚卡渐变 + 运行中命令卡暗井 + 历史通知）、
  `theme-dark-command-card-open.png`（井重校准 + 输出尾）、
  `theme-dark-queue-bar.png`（排队条 + Stop 危险态）、
  `theme-dark-session-drawer.png`、`theme-dark-settings-popover.png`
  / `theme-light-settings-popover.png`（Theme 行两主题）、
  `theme-dark-permission.png`（Deny 红 / Approve 浅填充）、
  `theme-dark-empty.png`、`theme-dark-lightbox.png`。逐面核对与
  `theme-proto-dark.png` 基调一致：黑灰层次、无橙、更亮 = 更浮起。
- **遗留**：① 未打包未装真机（按纪律不动 dist 安装位；VS Code
  设置 UI 改 `droidvisx.theme` 的活体路径待随包验收）；② 文件/HTML
  预览面板（`previewHtml.ts`）是独立 webview，仍暖白固定，未纳入
  本切片；③ forced-colors 高对比分支未随暗色回归截图（规则未动，
  理论不受影响）；④ 设计文档 §2.2 曾建议 globalState 持久化，实施
  改走 VS Code 设置项（用户任务书点名 `droidvisx.theme`），文档
  该节未回写。

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

### 子代理转录只读回放（2026-08-12 探针，未接入产品）

调研 + 探针任务，零 `src/` 改动。探针
`artifacts/probe-child-observer.mjs`（私有 sidecar daemon + 真实
委派回合，结果 `artifacts/probe-child-observer.out.json`）实证：

- **观察者连接不通**：第二条连接可 `load_session`/`resume` 附加到
  运行中的子会话且父回合不受扰，附加到父会话能收全量细粒度事件，
  但 daemon 内部驱动的子会话零 `create_message`/delta 广播——
  观察者连接做不了转录直播。
- **文件尾随可行**：子会话 JSONL 边跑边写、整行 flush、并发读
  0 错误 0 半行（落盘滞后台账 ~4s）。
- **终态读取零适配**：子会话信封原样过生产 `projectSessionHistory`
  投影成功；格式与主会话仅差 `session_start` 的
  `callingSessionId`/`callingToolUseId`。
- **抽屉泄漏属实**：`listSessions` 返回子会话；`.settings.json` 带
  `subagent` 标签，SDK `hasSubagentSessionTag` 可判别。

分档设计与第一切片（保底档终态回放 + 抽屉过滤）见
[`subagent-transcript-playback-design.md`](./subagent-transcript-playback-design.md)。

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

- [x] daemon 作为默认运行路径（执行链路，Phase 2 + §21：
      `droidvisx.runtime.mode` 默认 `daemon`，经 `createSdkSession`
      seam 注入 daemon 会话工厂；显式设 `process` 仍走
      ProcessTransport；模型目录与浏览器 MCP OAuth 在 daemon 模式
      fail closed）
- [x] daemon 连接和认证（Phase 1 只读 sidecar：`readFactoryAccessCredential()`
      + SDK `connectToDaemon`，认证失败分类为安全诊断）
- [x] daemon 生命周期管理（Phase 1 私有 `--parent-pid` 模式 +
      Phase 3 脱管共享模式：`detached`/`unref`、`~/.droidvisx/daemon.json`
      发现文件 `wx` 竞争、`droidvisx.shutdownDaemon` 手动回收；
      daemon 模式下会话 reload 存活已由 `probe-reload-survival.mjs`
      实证）
- [x] 跨窗口会话租约（Phase 3：`~/.droidvisx/sessions-attached.json`，
      替换型操作前持租约，死 pid 可抢占）
- [x] daemon 失败时回退 Node subprocess（§21：默认模式下首次建
      会话 daemon 获取失败 → `runtime.mode.fallback` quiet 诊断 +
      粘性回退 process 工厂；显式设置不回退；daemon 依赖门
      （worktree 创建等）回退后 fail closed；
      `smoke-mode-fallback-live.mts` 6/6 实证）
- [x] Webview 重连对账基础档（A4，2026-08-12 晚：Reload 后 in-flight
      回合生成中占位 + 完成后历史重载替换 + pending 权限重弹，生产
      Host 栈两代进程真机 PASS，见验证状态「活流重连基础档（A4）」；
      逐 token 续流不做，SDK 无断点续流通道）
- [ ] Capability Gate 接入 Extension 的安全产品门控

默认（`daemon`，§21 起）生产执行链路走共享 daemon 连接，任务跨
Reload 存活；daemon 起不来时默认路径自动无感回退
`ProcessTransport`（显式设置除外）。显式设 `process` 时执行链路
只使用 Node SDK `ProcessTransport`，daemon 降为归档/取消归档/
内容搜索的只读 sidecar。

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
- [x] 编辑器选区（`+` 面板与编辑器右键/命令面板
      `droidvisx.addSelectionToChat` 双入口；payload 为带
      `起:迄:相对路径` 头的代码块，见生产已接通 §25）
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
- [x] 子代理摘要层级 + Mission 只读展示（切片⑤：Task 委派行的
      一级子代理摘要行 + header/抽屉 mission 静字；见
      「生产已接通 §13」）
- [ ] Mission 阶段流水和 Worker 详情界面（SDK 只读子集之外的部分，
      含控制面，按 `spec-mission-design.md` §2 判定暂不做；控制面
      可行性修正见 `mission-control-feasibility.md`，属后续切片）

## V2 未完成

> **用户排除（近期不做）**：跨设备 Session、界面中文化、个人体验基线、
> 账号用量 —— 见 [`HANDOVER.md`](../HANDOVER.md) 第 3 节。下列清单
> 含历史台账项；与 HANDOVER「V2 远期」索引对照，排除项勿开工。

- [ ] Mission Control
- [ ] Worker 详情
- [x] Plugins 只读第一切片（设计 `plugins-hooks-design.md` 切片 1）：
      Composer 设置弹层新增 Plugins 只读分区（Skills/MCP 同族面板），
      `plugins.refresh` → Host 经 daemon sidecar 并发
      `plugins.listInstalled` + `marketplaces.list`（探针实证免活跃
      会话可查，`artifacts/probe-plugins-daemon.mjs`；process 运行
      模式同样可用）→ Bridge 协议 v5 `session.plugins` 四态
      （loading/ready/error/unsupported）双侧校验（上限、scope 白名单、
      重复 id 丢弃）→ 面板行展示插件 id + scope 徽记 + 版本哈希 +
      Active/Off 只读状态，尾注 marketplace 计数与「Manage plugins
      with the droid CLI」。daemon 不可用/未登录显式 error 态
      （sign-in 指引，不静默空列表）；会话切换重置 idle 并由可见
      面板自动重查（沿用 Skills 死锁修复约定）。install/uninstall/
      enable 写操作与 Marketplaces 管理为后续切片
- [ ] Plugins 后续切片（install/uninstall/enable 写操作）
- [ ] Marketplaces
- [ ] Hooks 管理
- [ ] Automations
- [ ] Custom Models 的创建、编辑和 Provider 管理（已配置 BYOK Model 的选择
      已接通）
- [ ] 组织策略
- [ ] Account Profile
- [ ] Account Usage
- [x] 会话/回合 token 明细（V2 成本/token 切片，取证与设计
      `token-usage-design.md`）：Context 浮层 quiet「Token usage」
      账目，Last turn / Session 双列五项 token 分解 + 仅 >0 时的
      Credits 行；SDK 无 USD 成本字段，金额展示 fail-closed 不做；
      历史会话仅累计并如实注明。已提交待随下一批次包可见验证
- [x] Git 提交闭环（Git/PR 工作流切片 A，设计
      `git-pr-workflow-design.md` §3.1/§4）：changes 卡片尾部 quiet
      入口「Commit these changes…」→ 内联提交区（分支名、勾选文件
      默认本回合、prompt 首行本地拼草稿不调 LLM）→ Host 经
      `vscode.git` `repository.add + commit` → 回显短哈希 + subject，
      失败原样显示 git 错误。Bridge 协议 v3 新增
      `git.requestStatus` / `git.status` / `git.commit` /
      `git.commitResult` 双侧校验；`vscode.git` 缺失、无仓库或多根
      工作区 fail-soft 隐藏入口。浏览器 harness 冒烟三场景
      （成功回显 / hook 失败 / git 不可用）通过
      （`artifacts/git-commit-harness.html` +
      `artifacts/smoke-git-commit.mjs`）；已提交待随包验证
- [ ] Git 分支创建 / Push / Pull Request（切片 B/C 未开工）
- [x] 原生 Terminal 第一切片（只读终端镜像：运行中 Execute 行
      「在终端中查看」→ createTerminal({pty}) 只读镜像实时追加
      `outputTail`（与流式预览共用 Runtime 透传），输入丢弃、
      结束保留、重复点击复用；已提交待随包验证）
- [ ] 原生 Terminal 后续（接管/双向交互已判 fail-closed，除非
      SDK 提供外部执行契约）
- [x] Background Processes 第一切片（切片 A，设计
      `background-process-design.md` §3.1/§3.2 强信号检测 + 转录
      quiet 提示行）：探针实证 CLI 0.193.0 真实发出
      `fireAndForget: true`（`artifacts/probe-fire-and-forget.mjs`
      三回合对照：前台无键、显式后台与自然语气 dev server 均
      boolean true，tool_result 确认 `Background process started
      (PID…)` 真实后台化未阻塞；结论
      `artifacts/probe-fire-and-forget-conclusions.md`）→ Runtime
      fail-soft 读取（仅 execute 类且字面 true 命中；键缺失/形态
      异常零行为变化；历史投影同源提取）→ Bridge
      `backgroundHint?: { fireAndForget }` 可选字段 exact-key 双侧
      校验 → Host 单调锁定（流式 input 后到的标记补齐、result 不
      清除）+ 恢复检查点 round-trip → activity 行下一行 quiet 细字
      「Background process · Keeps running until you stop it
      manually」（无图标无色块，沿用 subagent 子行的缩进语言）。
      GUI kill 维持 fail-closed（设计 §2.3，无进程句柄）；尽力而为
      列表与复制停止命令为切片 B。已提交待随下一批 VSIX 包验证
      （本切片未打包未安装，可见验证随包补做）
- [ ] Background Processes 切片 B（尽力而为列表 + 复制停止命令）/
      切片 C（弱信号启发式 + 设置开关）未开工
- [x] Worktree 并行任务第一切片（SessionDrawer「New session in a
      worktree…」入口 → daemon `sessions.create({ worktree: true })` →
      会话行 `worktree · <branch>` 标注 + 完整路径 tooltip。仅
      daemon 模式且 git 工作区时入口可见；process 模式入口隐藏、
      请求 fail-closed 返回诊断。探针实证
      `artifacts/probe-worktree-create.out.json`：分支名由 daemon
      自主命名（`<branch>-wt`），SDK facade 只回 `session.cwd`，
      分支由 Host 用 git 反查；worktree 会话不进主工作区目录的
      catalog，由 Host 注册表（Memento）增补列出。已提交待随包
      验证）
- [ ] Worktree 生命周期（清理 `git worktree remove`、脏检查防呆，
      第一切片未含）
- [ ] 远程环境
- [ ] 跨设备 Session
- [ ] Help 和 Feedback
- [ ] 诊断导出
- [x] 会话导出 Markdown（`DroidVisX: Export Session as Markdown`，
      Host 层 `sessionExporter.ts` 复用历史管线与凭据扫除；
      已随 2026-08-12 晚流式输出预览批次包（@7f95587，SHA256
      `a4602cb7…30df7ed`）安装）
- [x] Mermaid 图渲染（```mermaid 代码块流式完成后渲染为图，独立
      3.3MB 懒加载 bundle 经 nonce 脚本注入，首屏仅 +3.4KB，
      失败安静回退；已提交待随包验证）
- [ ] 更新管理

## 当前安装包状态

最后核对结果：

- **2026-08-13 凌晨功能发版 v0.2.0**：版本号 `0.1.1 → 0.2.0`，
  `CHANGELOG.md` 顶部新增 0.2.0 小节（发布提交 `1076241`，仅动
  版本号与 CHANGELOG），覆盖今晚全部切片：daemon 默认运行 + 静默
  回退 + 回合跨 Reload 存活、Working 徽标与子代理弹层（含"停不掉
  不画控件"决策）、派发身份直出 / Reload 结清 / 无 status 子行转
  圈（dvx/subagent-audit 四提交）、排队收纳条（queue.promote、
  Edit Queued、协议 v6→v7）、计划锚点卡、/btw 双模式、终端命令卡
  （c7f9245）、会话抽屉运行转圈与点击直返、归档 limit schema 上限
  修复（4f2c1c3）。产出 `dist/droidvisx.vsix` 1,651,586 字节
  （2026-08-13 01:01），SHA-256
  `1A50CDCDE34148D37AC5E279C8E1AB504CAB6B6321172A743A8BF060E1723B24`，
  `cursor --install-extension --force` 安装成功，
  `cursor --list-extensions --show-versions` 确认
  `droidvisx.droidvisx@0.2.0`。收官回归（01:45）在包内
  `dist/webview` 上复跑 harness 冒烟七套（plan-anchor / queue-bar
  / queued-bar / working-badge / command-card / session-drawer /
  subagent）**全 PASS**，截图刷新进 `artifacts/`。验收入口：
  `docs/product/acceptance-checklist-v0.2.md`（含 Bridge v7 需
  Reload 提醒、已知残留风险、明确不在本版清单）
- **2026-08-12 晚修复版发版 v0.1.1**：版本号 `0.1.0 → 0.1.1`，
  `CHANGELOG.md` 顶部新增 0.1.1 小节 13 条（Fixed 12 / Changed 1），
  覆盖 v0.1.0 后四批修复：验收批次一（中文路径流式截断 fba6523、
  错误卡叠加去重、提交面板计数与按钮、Preview 顶栏成品化）、验收
  批次二（跑马灯、钉条重做、细滚动条、图片缩略图、运行行自动展开、
  操作条唯一化 d9bf2b9…f93f5df）、/btw 右侧全高面板重做（aaaca96，
  Changed）、MCP 添加表单死机 + 守护进程超时 + 弹窗键盘跟滚
  （adf12c2/fde72b3/50aef0f）。`verifyVsix.mjs` 期望无需变动（v0.1.0
  已含 changelog 条目）。发版提交 `9c44d7c`（仅 CHANGELOG.md +
  package.json），本地 tag `v0.1.1 -> 9c44d7c`（无远端，未 push）。
  门禁在临时干净 worktree（detached HEAD @9c44d7c，用后已删）跑通：
  typecheck 三段 + 全量 vitest 80 files（79 过/1 跳过）/ 1825 tests
  （1824 过/1 跳过）+ build + `vsce package` + `verify:vsix` 11 条目
  校验全绿。主工作区（打包时 `src/` 无未提交改动）产出
  `dist/droidvisx-0.1.1.vsix` 1,642,331 字节（11 files, 1.57 MB），
  SHA-256
  `35F9D251CD9ACEF8A62B5B641957CA2E5095C6C867A4E56AEB9D31AB331FB52B`，
  `verify:vsix` 复验通过，`cursor --install-extension --force`
  successfully installed。现有窗口 Reload Window 即加载 0.1.1 Bundle
- **2026-08-12 晚首个正式发版 v0.1.0**：版本号 `0.0.0 → 0.1.0`，新增
  能力级 `CHANGELOG.md`（34 条：Added 22 / Fixed 8 / Changed 4，覆盖
  自 2026-08-11 20:00 起 178 个提交）并随包发布（vsce 在包内规范化为
  `extension/changelog.md`，`verifyVsix.mjs` 期望已同步，VSIX 变为
  11 条目）。发版提交 `eed2df0` + 大小写修正 `f82ce46`，本地 tag
  `v0.1.0 -> f82ce46`（无远端，未 push）。门禁在临时干净 worktree
  （detached HEAD，用后已删）跑通：typecheck 三段 + 全量 vitest
  80 files（79 过/1 跳过）/ 1810 tests（1809 过/1 跳过）+ build +
  `vsce package` + `verify:vsix` 11 条目校验全绿。主工作区（打包时
  `src/` 无未提交改动）产出 `dist/droidvisx-0.1.0.vsix` 1,639,449
  字节（11 files, 1.56 MB），SHA-256
  `8BB63972BDE4F332556FC9446511CAA3195BD8DBD1B9DB04E57DFE69C65733E9`，
  `cursor --install-extension --force` successfully installed。首次
  脱离 0.0.0，现有窗口 Reload Window 即加载 0.1.0 Bundle
- 2026-08-12 晚「Turn 运行中排队消息」收官切片打包并安装：
  `pnpm run package:vsix`（内含 typecheck 三段 + 全量 vitest
  80 files / 1805 tests 全绿 + build）产出 `dist/droidvisx.vsix`
  1,635,958 字节（10 files, 1.56 MB），SHA-256
  `CFFC497861819AF48EDB695A71383EF75403CB5C47FA537EE11C4B2245C2F118`，
  `cursor --install-extension --force` successfully installed。该包
  同时携带此前"随下包"的各切片（任务计划钉条、ApplyPatch 路径修复、
  首屏闪白修复、/btw 侧聊 S1+S2 等——打包时点工作树除文档外干净，
  全部为已提交内容）。现有窗口需 Reload Window 后加载新 Bundle
- 2026-08-12 傍晚 Plugins 只读第一切片已提交（`c7d3911` Bridge 契约 +
  `d8a9826` Host/Runtime + `7db8664` Webview；Thread/App 接线部分随
  并行代理并入 `4ae602f`），门禁全绿（typecheck 三段 + vitest
  74 files/1701 全过），并已 `vsce package`（dist/droidvisx.vsix，
  1.55 MB）+ `cursor --install-extension` 安装。注意该包含打包时
  工作区内其他并行切片的未提交改动（btw/side-chat 等在途文件），
  面板可见冒烟（真实 `core@factory-plugins` 行 + 杀 daemon 后
  error 态）待用户 Reload Window 后核对。
- 2026-08-12 傍晚「消息文本路径链接 Preview 入口」切片（§16）已全部
  提交（`6196007` Bridge + `cf343a9` Host + `7a8e33a` Webview +
  `fab92da` chore），门禁全绿（typecheck 三段 + vitest 76 files/
  1740 + build + headless 冒烟 + HEAD 干净检出复验）。完成时点锁
  空闲即启动 `package:vsix`，流水线中并行代理落下 `9bc7a13`
  （/btw 契约半切片，store reducer 未消费新消息类型）树转红，
  打包中止，**随下包**
- 2026-08-12 傍晚「三项体验补全」切片（回到底部箭头 / 待答空隙修复 /
  代码块 Preview，§14）已全部提交（`8739fd2` `cae4890` `cd7a74f`
  `3c8570f`，Bridge/CSS 部分随并行代理并入 `3e7da6b`/`62b6f1b`），
  切片自身门禁全绿（typecheck 三段 + vitest 68 files/1586 +
  build + headless 冒烟三组）。完成时 vsce/dist 锁空闲，但共享工作
  树与 HEAD 均因另一代理进行中的 plugins/thinking-segment 契约改造
  （`ChatController.ts` 已提交一半、`turnActivityState.ts`/
  `bridgeMessages.ts` 依赖未提交）过不了 `package:prepare`，等待
  25 分钟未释放，按约定**标注随下包**：下一个打包代理的 VSIX 将自动
  携带本切片，可见验证随包补做
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
- 2026-08-12 下午打包并安装含 **MCP/Skills 面板与 Composer 调查
  修复批次 + P0 权限截断修复 + 图片查看器/本地图片渲染 + 工具失败
  原因透出** 的构建：仓库根 `droidvisx.vsix` 1,600,188 字节
  （10 files, 1.53 MB；VSIX 含另一代理同期落地的 mermaid.js
  bundle），SHA-256
  `13404868CF74A0159E72B5FB8B933AB79289F06D9BB2EA603861EBA22E8CAB8A`，
  typecheck 三 tsconfig 全过、vitest 56 files / 1276 tests 全绿，
  `pnpm exec vsce package --no-dependencies` 与
  `cursor --install-extension droidvisx.vsix`
  （successfully installed）均成功；现有窗口需 Reload Window 后
  加载新 Bundle
- 2026-08-12 晚打包并安装含 **/btw 侧聊 + `/` 内置组扩充（斜杠
  对齐 S1+S2）** 的构建：`dist/droidvisx.vsix` 1,635,935 字节
  （10 files, 1.56 MB），SHA-256
  `842015C686B19A9C06212306D96E4C87F87BACDA2058864B21B154524A9DC9B5`，
  typecheck 三 tsconfig 全过、vitest 80 files / 1804 tests 全绿、
  build 后 `pnpm exec vsce package --no-dependencies` 与
  `cursor --install-extension dist/droidvisx.vsix`
  （successfully installed）均成功；vsix 已解包核对 webview
  bundle 含 btw 代码，`smoke-btw.mjs` 对同一产物六场景三连
  PASS（此前 20:00 时点产物上冒烟曾现 `btwAvailable` 未生效的
  瞬态失败，与并行打包窗口重叠，20:06 重建后不可复现）；本包
  取代同日稍早的计划钉条包，现有窗口需 Reload Window 后加载新
  Bundle

## 验证状态

最近记录的验证结果：

- 大文件分解重构（2026-08-13 凌晨，`refactor-plan.md` 批次①–④全量
  落地，31 个 commit：`c339cba`…`645eba6`，纯结构移动、行为零变化）：
  **①** `styles.css` 7148 行拆为 `@import` 索引 + `styles/` 23 段
  （字节级守恒比对全等），色彩 token 集中进 `styles/00-tokens.css`
  且逐值相等（`scripts/styleAudit.mjs` headless-Chrome 计算样式
  前后 diff 为空；唯一例外是 `html/body/#root` 处于 `.dvx-shell`
  作用域外，按 theme 文档 §2.1 保持字面量）。**②**
  `ChatController.ts` 8287→1122 行，拆出 `chat/` 14 模块
  （internals/queue/mcp/capabilityPanels/attachments/settings/
  workspaceActions/editResend/sessionRunning/subagentWatch/
  recovery/sessionDirectory/runtimeLifecycle/turnFlow，自由函数 +
  `ChatControllerInternals` 接口模式）；`ChatController.test.ts`
  9125 行拆为共享 `controllerTestHarness.ts` + 10 个主题文件，
  用例名集合守恒（157 个一个不少），套件耗时 27s→10s。**③**
  `Thread.tsx` 4499→1020 行，拆出 `thread/` 9 模块（readers/
  composerCommands/icons/commandCard/activityRows/transcriptRows/
  Composer/UserMessage/AssistantMessage），Context 与滚动/粘性族
  留根，`Thread.test.tsx` 直接改 import、不留重导出。**④** 去重：
  `isSafeModelId` ×4、`isSafeDisplayName` ×2 合并入
  `shared/validateMessage.ts`；`sanitizeSessionTitle` ×2 合并为
  shared 单实现（调用方各自保留 200/256 信任边界上限传参）；删除
  零引用的 `store.ts hasTurnContent`、`MAX_INTERACTION_TEXT_LENGTH`
  别名；`MAX_SENT_ATTACHMENT_RETENTION_BYTES` 去 export。防回潮：
  `scripts/checkFileBudgets.mjs` + `pnpm run lint:budgets` 上线
  （TS/TSX 900、CSS 800、测试 2000 行；20 个存量超标文件按现行数
  +2% 棘轮登记，只降不升），挂入 `package:prepare` 与 HANDOVER
  完成门禁。**门禁**（全部在最终 HEAD 真实执行）：typecheck 三段
  PASS、`vitest --maxWorkers=4` 全量 95 文件 / 1922 用例 PASS、
  `pnpm run build` PASS、`lint:budgets` PASS。**冒烟**（build 后
  跑 `artifacts/` 25 个无头脚本）：11 个 PASS（plan-anchor、
  queue-bar、queued-bar、working-badge、command-card、
  session-drawer、subagent、btw、message-polish、output-preview、
  mermaid，截图已存 `artifacts/`，目检正常）；其余 14 个在重构前
  基线 `dbe484d` 上重建实测**同样失败**（脚本过期，非重构回归，
  已按"仅基线 PASS 才算门禁"规则排除）。verify:vsix 未跑（重构
  窗口禁止 `vsce package`）。为后续波次留的接口位：深色主题——
  全部颜色已收敛为 `00-tokens.css` 单文件 `--dvx-*` 变量（含
  hljs 语法色），换肤即换 token 块；BYOK——模型目录/设置域已
  隔离在 `chat/capabilityPanels.ts` + `chat/settings.ts`，模型
  校验唯一实现在 `shared/validateMessage.ts`；Add to Chat——
  附件域已隔离在 `chat/attachments.ts`（Host）与
  `thread/Composer.tsx`（UI），staging 入口互不纠缠
- Turn 运行中排队消息（2026-08-12 晚，V1 主线收官）：真机冒烟
  `artifacts/probe-queue-smoke.mjs`（真实 CLI 登录 + 生产
  `ChatController` + `FactoryDroidRuntime` process transport）全链
  **VERDICT: PASS**——流式回合中连发 3 条入队（FIFO）→ completed
  自动派发队首 → 派发回合 Stop → `paused=stopped` 两条保留且 6 秒
  无自动派发 → `queue.resume` → 链式排空 `items=0`。该冒烟第一轮
  即揪出真实缺陷：完成 settle 的派发微任务抢在 runtime 生成器
  finally 释放 active-turn 槽前调 `sendTurn`，队首派发即刻
  failed + 队列误转 `turn-failed` 暂停（单测 mock 无槽语义故漏
  网）；修复 `531049a` 先 break 关流再 settle，回归测试带真实槽
  语义。面板内排队卡可视核对待用户 Reload Window
- 活流重连基础档 A4（2026-08-12 晚，V1 主线）：daemon 模式 Reload
  后，绑定会话若有 in-flight 回合，重连即显示生成中占位、重弹
  pending 权限，回合完成后以持久化历史整体替换占位；process 模式
  行为不变。**前置探针**（`artifacts/probe-get-messages.mjs`，
  真实登录 + 私有 daemon）：`sessions.getMessages` 的 -1 异常实为
  客户端 Zod `limit ≤ 100` 拒绝（`limit:200` 必抛、默认/100 正常、
  窗口锚定列表首端），门面还剥离 `hasMore`/`nextCursor`（裸
  DaemonClient 可见），不适合长会话全量取数——占位替换取数走
  既有 `FactorySessionHistoryLoader`；两代客户端实证 gen-a 死后
  权限在 daemon 侧保持 pending，gen-b resume 时经 SDK 自动补投，
  `listOpened().workingState` 阻塞期为
  `waiting_for_tool_confirmation`。**Runtime 层**（提交 4bd30ad）：
  `DroidRuntime` 新增可选 `readSessionWorkingState()`（投影
  `idle`/`running`/`waiting-for-user`/`unknown`，未列出/未知态
  fail closed 到 `unknown`）与 `interruptSession()`（无本地流式
  回合也可打断 daemon 侧回合）；daemon 会话从 `listOpened()` 注
  册表读原始态，process 会话读取即抛（行为不变）。**Host 层**
  （提交 dd81d92）：`createInitializedRuntime` 对 resume 目标在
  `initialize()` 前 `interactions.beginTurn(合成 recovery-<gen>
  回合)`，SDK 补投的权限被持有而非被自动取消，失败路径逐一释放；
  `activateRuntime` 尾部对 resume 目标启动 `reconcileDaemonTurn`：
  探测工作态，`running`/`waiting-for-user`（或 `unknown` 且有补投
  交互）投影为 `streaming` 恢复回合（快照公告，webview 复用既有
  生成中指示语言与权限卡，零新 UI 元素），`replayPending` 重发
  交互卡，500ms 轮询至 `idle` 后 `FactorySessionHistoryLoader`
  重载历史、`reconcileSessionHistory` 对账覆盖占位并终态
  completed（Stop 中按下则 interrupted）；连续 3 次 `unknown` 以
  `recovered-turn-lost` fail closed；恢复回合的 Stop 走
  `interruptSession()`。不做（基础档边界）：逐 token 续流、跨窗口
  多客户端仲裁（租约现状）。**测试**：`ChatController.test.ts`
  新增 5 个（占位出现与完成替换、权限补投重弹且可应答、Stop 走
  interruptSession、process 读态抛错零变化、连续 unknown 判失败），
  全文件 129/129；runtime 侧 `FactoryDroidRuntime.test.ts` +
  `createDaemonDroidSession.test.ts` + 协调器共 80/80。**门禁**
  （等两批并行代理落地后全仓绿再跑）：`pnpm run typecheck` 三个
  tsconfig 全过；`pnpm test` 73 files / 1691 tests 全过；
  `pnpm run build` 成功；`vsce package` 10 files / 1.55 MB，
  SHA256 `AD096E127C4FC7042D6B5EE8349D7B18759DD3126600FF2BFC79B41DB80FB18D`，
  `cursor --install-extension --force` 成功。**真机验收**
  （`artifacts/probe-a4-reload-controller.mjs`，真实登录 + 真实
  daemon + 生产 Host 栈两代进程）：gen-a 起回合、权限 pending 时
  硬退（模拟 Reload 窗口死亡）；gen-b 用生产
  `ChatController`+`FactoryDroidRuntime`+daemon 工厂+
  `FactorySessionHistoryLoader` 走正常启动 resume，Bridge 消息流
  实测 `connected:true → 占位快照 turn={recovery-1, streaming} →
  interaction.request 权限重弹（turnId 与占位一致）→ 应答
  proceed_once → turn.state completed → 终快照转录 5 项
  （user/thinking/tool/assistant）`，**VERDICT: PASS**；探针只输出
  布尔/计数，token 仅经 `readFactoryAccessCredential()` 内存读取。
  面板内的字面 `Developer: Reload Window` 手动复核留待用户（代理
  无法在不杀死自身会话的情况下重载本窗口；webview 占位/权限卡
  渲染路径为既有行为，有 App/store 单测覆盖）。
- Tab 切换驻留（2026-08-12 下午，续启动/切换性能批次）：
  **根因**——`extension.ts` 的 `registerWebviewViewProvider` 未传
  options，VS Code 默认在视图隐藏时销毁 webview iframe、重新显示
  时整套重建。日志实证（当日真实窗口）：单个扩展宿主实例内
  `webview.boot-ok` 反复出现（act b3e33c 4 次、ea772c/cab005/
  50b4da 各 3 次），每次切回付出 boot 1,022~1,185ms + 重渲染
  1,101~1,355ms ≈ **2.2~2.5s 体感时延**（例：act ea772c 08:33:45
  与 08:33:49 相隔 4 秒两次完整重启）。早期快照修复只能把重建后的
  首屏提前，驻留才是根治。
  **API 取证**——本地 `@types/vscode` `index.d.ts`（11728~11751
  行）：`registerWebviewViewProvider(viewId, provider, options?)`
  的 `webviewOptions.retainContextWhenHidden` 对 WebviewView
  **受支持**（隐藏时保留 iframe、脚本挂起、显示时原状恢复）；
  `Webview.postMessage` 文档（10004 行）明确 retained 隐藏
  webview 属于 live、可继续投递消息。代价为文档标注的高内存
  开销——聊天面板转录/Composer/滚动状态无法快速保存重建，正是
  该选项的适用场景（参照 Claude for VSCode 的秒切换行为）。
  **实现**——注册处传
  `{ webviewOptions: { retainContextWhenHidden: true } }`；
  `DroidViewProvider` 新增 `onDidChangeVisibility` 监听：打
  `host.view.visibility` 埋点（visible 布尔），重新可见时向
  controller 重发 `webview.ready` 做防御性对账（已初始化的
  controller 对重复 ready 仅重发快照 + 重放 pending 交互，
  Webview store 按 requestId 去重，全幂等）。
  **测试**——`DroidViewProvider.test.ts` 新增 2 个（重新可见触发
  幂等 resync + 埋点、被替换/已 dispose 的视图不再驱动），全文件
  7/7 绿。
  **修前/修后**——修前：每次切回一整套 boot-ok（~1.1s）+
  render-ok（~1.2s）；修后预期：切回零重建，日志中只出现
  `host.view.visibility {visible:true}` 且**无**新 boot-ok（待下
  次打包安装 + Reload 后核对）。
  门禁：`DroidViewProvider.test.ts` 7/7 通过；全局 typecheck 与
  全量 vitest 此刻被另一并行代理未提交的 interleaved thinking
  改动（`runtimeEvents.ts` / `normalizeSdkEvent.ts` 的
  `thinking-delta` 增字段）压红（7 个文件失败均为 thinking 形状
  断言，与本切片无关；本切片文件聚焦全绿），打包/安装随树恢复
  绿后的下一个包一并出（真机切换验证同时遗留）。协调说明：
  `extension.ts` 的注册改动被并行代理在 56a67bd 一并提交，
  provider 与测试由本切片单独提交（0f483cc）。
- 启动/切换性能与可靠性修复批次（2026-08-12 下午，日志调查实证
  三项）：
  **修复 1（P1）握手版本失配静默死亡兜底**——Webview：`App.tsx`
  在 `webview.ready` 后 5s 内未收到任何 host 消息时显示复用
  history-notice 视觉语言的克制提示行「DroidVisX was updated
  behind this window. Run "Developer: Reload Window" to reconnect
  the panel.」并发 `handshake-timeout` 诊断信标（新增
  `WEBVIEW_DIAGNOSTIC_KINDS` 项 + `announceHandshakeTimeout`）；
  Host：`DroidViewProvider` 对 `webview.ready` 的协议版本失配单独
  打 `host.bridge.protocol-mismatch`（error 级，expected/received），
  不再混入泛化 `host.bridge.rejected`。测试：`App.test.tsx` 2 个
  （fake timers 超时出卡/快照到达即消、快照先到不出卡）、
  `DroidViewProvider.test.ts` 1 个（失配走专门事件不走泛化拒收）。
  **修复 2（P1）早期恢复快照 100% 被拒**——根因与更正记录见上文
  「生产已接通 §9」的更正段；`validateHostMessage.ts` 的
  `parseSessionCatalog` 增加 `allowPendingActive`（连接非
  `connected` 时允许 activeItemId 为 null 而 sessionId 非空；
  active 行与 sessionId 矛盾仍拒收）。测试：
  `validateHostMessage.test.ts` 3 个（connecting 无 active 行接受、
  unavailable 失败激活快照接受、connecting 但 active 行矛盾拒收）。
  **修复 3（P2）会话切换/激活串行跑两遍 droid CLI**——
  `ChatController.replaceRuntime` / `activateInitialRuntime` 的
  `prepareActivationTranscript`（history 进程）与
  `createInitializedRuntime`（runtime 进程）改为 `Promise.all`
  并行；转录侧判废时新增对已就绪 runtime 候选的 close 回收；新增
  `host.perf.session-switch`（kind/durationMs）端到端切换埋点与
  `runtime.history.spawn`（loader 每次 CLI spawn 计时，
  `FactorySessionHistoryLoader` 注入 diagnostics）。测试：
  `ChatController.test.ts` 重写 2 个串行时代契约（并行启动、
  stale 后候选必须 dispose 且不持久化）+ 新增 1 个切换埋点；
  `FactorySessionHistoryLoader.test.ts` 3 个 spawn 观测。
  **日志实证（修前基线，当日真实窗口日志 16 个激活实例）**：
  `host.perf.early-snapshot` 于 +0.2s~+4.4s 发出（items>0）但每个
  实例 `webview.render-ok` 均等于全量快照时刻 +9.1s~+15.2s，从未
  等于早期快照时刻；`runtime.history.finished` 4,974~7,874ms 与
  `runtime.initialize.finished` 3,243~6,495ms 纯串行。
  **修后实证（`artifacts/probe-perf-fixes.mts`：生产
  ChatController + FactoryDroidRuntime + FactorySessionCatalog +
  FactorySessionHistoryLoader 真实 droid CLI + 生产
  `readHostMessage` 校验器全链路）**：早期快照 +114ms 被生产校验
  器**接受**（activeRows=0、connecting，修前该形状 100% 拒收）；
  全程 0 条快照被拒；启动激活 history（11.9s）与 initialize
  （10.2s）完全并行重叠，connected 于 +12.0s（同机串行应
  ~22s）；真实会话切换 `host.perf.session-switch
  durationMs=8741`，history 7,284ms ∥ initialize 5,695ms（同一
  次运行若串行 ≈ 12,979ms + 开销，砍掉整段串行 ~5.7s；绝对值高于
  6s 目标是因探针与门禁/构建同机并发、两段 CLI 本身偏慢，结构上
  已是 max 而非 sum）。
  门禁：typecheck 三 tsconfig 全过；全量 vitest 66 files /
  1552 tests 全过；build、`pnpm vsce package --no-dependencies`
  （10 files, 1.55 MB, `artifacts/droidvisx-perf-fixes.vsix`）、
  `cursor --install-extension` 均成功。遗留：真实 Cursor 窗口
  Reload 后的 `render-ok ≈ early-snapshot` 与真实 UI 切换的
  `host.perf.session-switch` 数字待用户 Reload 现有窗口后从
  DroidVisX Logs 核对（新包已安装；尝试用 `cursor -n` 开新窗验证
  未成功——DroidVisX 视图未随新窗恢复可见，扩展未激活）。协调
  说明：本批 `ChatController.ts` / `ChatController.test.ts` /
  `extension.ts` / `bridgeMessages.ts` / `App.tsx` / `styles.css`
  的改动被并行的终端镜像代理在 3e7da6b / 733faa3 / 62b6f1b 一并
  提交（工作树共享所致），其余文件由本批单独提交。
- V1 切片⑤「Canvas / 原型预览」（2026-08-12 下午，V1 #7）：
  ① **契约**：Bridge 新增 `file.preview`（`PREVIEWABLE_FILE_EXTENSIONS`
  白名单 + `isSafeWorkspaceRelativePath` 双侧校验），
  `validateMessage.test.ts` 覆盖合法 `.html/.htm` 与敌意路径
  （空/错扩展/越界/路径穿越/绝对路径/控制字符/超长）反例。
  ② **Host 沙箱面板**：`previewHtml.ts` 生成 `srcdoc` 内联 shell，
  `previewHtml.test.ts` 断言 CSP 精确串（`connect-src 'none'`、
  无 nonce、允许 `unsafe-inline`）、`sandbox="allow-scripts"` 且无
  `allow-same-origin`、CSP `<meta>` 注入点与 HTML 转义、shell 不注册
  message 监听；`PreviewPanelController.test.ts` 覆盖开/复用面板、
  路径重校验、缺失/超 4MB 降级 notice、Reload、Open in editor、
  工具栏命令严格校验。
  ③ **路由**：`ChatController.test.ts` 断言 `file.preview` 仅在
  connected + 匹配 sessionId 时经注入的 `PrototypePreviewOpener`
  执行，失败回报 `preview-failed` 诊断。
  ④ **Webview**：`Thread.test.tsx` 覆盖 Changes 卡可预览文件行的
  Preview chip 条件渲染与点击。
  **Chromium 冒烟**（`artifacts/preview-harness/`，从生产
  `previewHtml.ts` 生成，headless `--dump-dom` 实证）：sandbox 隔离
  探针 ALL-PASS（`prototype.contentDocument`=null、`contentWindow`
  读取抛 `SecurityError`、sandbox 恰为 `allow-scripts`）；网络 CSP
  探针 ALL-PASS（fetch→TypeError、websocket→error、图片信标→blocked）；
  shell 结构冒烟：Reload/Open-in-editor 按钮、沙箱帧、注入 CSP 均在。
  **fail-closed**：预研方案 b 的 `asWebviewUri` 载入因
  microsoft/vscode#121479 嵌套 iframe 限制不可行，偏移为 `srcdoc`
  内联沙箱并如实标注“inline code only · no network”（同目录外链资源
  不可加载）。
  门禁：typecheck 三 tsconfig 全过；全量 vitest 1395 passed /
  1 skipped / 1 failed（唯一失败为另一代理 mermaid 切片的
  `MermaidBlock.test.tsx` fake-timers 超时，与本切片无关，本切片
  5 个测试文件 494/494 全绿）；build（禁运入断言保持）+ vsce package
  + cursor --install-extension --force 成功（见安装包状态）。遗留：
  真实 Cursor 中打开真实原型的可见验收待用户完成；`verify:vsix`
  因 mermaid 切片新增 `dist/webview/mermaid.js` 未同步更新
  `verifyVsix.mjs` 期望清单而失败，与本切片无关（本切片不新增打包
  文件）。
- MCP/Skills/Composer 调查修复批次 + P0 权限截断（2026-08-12 下午，
  依据 `mcp-skills-panel-findings.md` 6 项 + 横向诊断日志、
  `composer-transcript-findings.md` 4 项、用户追加的图片查看器/
  本地图片渲染/ApplyPatch 静默取消三项）：
  **P0 Runtime 权限截断修复（第 15 项，用户等待的答案）**——
  `runtimeInteractions.ts` 的 `boundedDetail` 语义由"超长返回
  null → 整个投影判空 → 自动 Cancel"改为**截断显示**
  （`truncateForDisplay` + `… (truncated)` 标注，选项与工具身份
  校验保持严格）；ExitSpecMode 的 262,144 专用上限保持；
  `handlePermissionRequest` 两个 Cancel 兜底路径现在必发
  `runtime.permission.auto-cancelled` 诊断（带 reason 字段，经
  `FactoryDroidRuntime.onAutoCancelled` 落日志）。回归测试构造
  >32K ApplyPatch 权限请求断言正常投影出卡片且 detail 带截断
  标注、`onAutoCancelled` 不触发（`runtimeInteractions.test.ts`）。
  **Bridge/Runtime/Host（另见各 findings 项）**——
  `McpServerSummary.hasAuthTokens`（认证徽标条件）、
  `workspace.files` 带 `status: ok|no-workspace`、诊断消息可选
  `relatedSessionId`；`setMcpServerEnabled` 自设超时、MCP 认证
  快速失败 + 超时降 2 分钟 + 认证流日志；mutation 失败不清列表 +
  成功后主动刷新，add/remove/toggle 守卫与失败补
  `host.ui.diagnostic`；`workspace.searchFiles` 无工作区回
  no-workspace 空包；`performCompact` 不再从目录过滤原会话，
  `session-compacted` 诊断带 `relatedSessionId`。
  **Webview**——MCP 行级 pending（Enabling…/Disabling…/
  Removing…）+ needs auth / authenticated 徽标；面板打开必刷新、
  error 保留列表、Add 表单显式校验提示；Skills 行级 pending +
  "changes take effect in new sessions" 注记 + 变更后
  "Start a new session" 快捷动作；`+` 菜单搜索接入真实
  skills/MCP 条目；裸 `@` 即弹弹窗（"Type to search workspace
  files"，无工作区显示 "No folder is open in this window."）；
  `/` 弹窗新增 Built-in 节（/compact、/new，GUI 拦截执行）与
  Skills 分组（选中插入引导提示文本，不直接执行——SDK 无
  斜杠执行技能的原生通道，`userInvocable` 仅为列表元数据）、
  统一键盘导航；`handleSend` 拦截 `/new`；编辑卡提示行删除；
  CompactDivider 追加 "View full history" 链接（经
  `relatedSessionId` 切回压缩前会话）。
  **图片查看器（第 13 项）**——lightbox 重做：可见 × 关闭按钮
  （Esc 直接关）、滚轮缩放 0.25×–8×（鼠标锚定、ctrl+wheel 触控板
  捏合同路）、放大后拖拽平移（grab/grabbing 光标）、双击在
  适配/100% 间切换、缩放百分比指示；纯 Webview CSS transform +
  rAF，reduced-motion 关过渡；`createPortal` 到 body 防裁剪
  （`TranscriptImage.test.tsx` 8 例交互测试）。
  **Markdown 本地图片（第 14 项）**——新 Bridge 往返
  `workspace.readImage` / `workspace.imageData`（路径长度/控制
  字符/base64/状态一致性双侧校验），Host 复用
  `readWorkspaceFile` 安全读取（绝对路径 rebase 工作区内、越界
  拒绝、非图片 unsupported、超限 too-large），Webview
  `LocalImageContext` 请求去重 + store LRU 缓存，成功渲染为
  `TranscriptImage`（进 lightbox），失败降级为可点击路径链接。
  **工具失败原因透出（第 15 项 GUI 部分）**——失败 tool_result
  的文本摘录（≤1000 字符截断）经全链路新字段 `errorMessage`
  （RuntimeEvent errorText → turnActivityState → `tool.activity`
  / Tool transcript 项 → 恢复存储 → 历史投影 → runtimeAdapter
  metadata）在工具行展开详情内以克制的 `--dvx-danger` 小字
  段落显示（如 "Tool execution cancelled by user"）；成功结果
  永不携带摘录，隐私测试相应更新为"失败摘录属有意透出"。
  门禁：typecheck 三 tsconfig 全过（顺手修复另一代理
  `mermaidRenderer.ts` 的 NodeList 迭代 TS2488，一行
  `Array.from`）；vitest 56 files / 1276 tests 全绿（含本批次
  新增的 normalizeSdkEvent 错误摘录 4 例、turnActivityState
  投影 3 例、validateHostMessage 正反例、store 持久化例、
  TranscriptImage 8 例、MarkdownText 本地图片 5 例、
  ChatController readImage 端到端）；build + vsce package +
  cursor --install-extension 成功（见安装包状态）。遗留：真实
  Cursor Reload 后的可见验收待用户完成。
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
  至此全部落地；tier1 §1（流式命令输出预览）已于 2026-08-12 晚
  作为独立切片落地随包安装（见前文日期条目）。
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
2. ~~**恢复提速**~~ — 已完成（2026-08-12 凌晨交付但因校验器拒收
   从未生效，2026-08-12 下午修复并实证，见验证状态「启动/切换
   性能与可靠性修复批次」与「恢复提速切片」；
   [`tier1-polish-plan.md`](./tier1-polish-plan.md) §3；从第一档提前）。
3. ~~**对话内图片 + Composer 拖拽/粘贴**~~ — 两段均已完成
   （2026-08-12 凌晨，见验证状态「V1 切片③第一段/第二段」；
   [`rich-content-design.md`](./rich-content-design.md) §1、§1.5）。
4. ~~**完整 Spec Mode 闭环**~~ — 已完成（2026-08-12 中午，见验证
   状态「V1 切片④」与生产已接通 §6；
   [`spec-mission-design.md`](./spec-mission-design.md) §1）。
5. ~~**Canvas / 原型预览**~~ — 已完成（2026-08-12 下午，见验证状态
   「V1 切片⑤ Canvas / 原型预览」与生产已接通 §12；预研方案 b 因
   VS Code 嵌套 iframe 限制偏移为 `srcdoc` 内联沙箱，网络出口/同源
   逃逸经 Chromium 探针实证阻断；[`rich-content-design.md`](./rich-content-design.md) §2、
   [`slice-prep-canvas.md`](./slice-prep-canvas.md)）。
6. ~~**子代理摘要层级 + Mission 只读展示**~~ — 已完成（2026-08-12
   下午，见生产已接通 §13 与验证状态对应条目；
   [`spec-mission-design.md`](./spec-mission-design.md) §3、§2）。
7. ~~**第一档打磨剩余**~~ — 已完成（收起播报与回复动画由
   streaming-experience 三批落地并入 V1 #6；流式命令输出预览
   2026-08-12 晚落地，见验证状态「流式命令输出预览」；
   [`tier1-polish-plan.md`](./tier1-polish-plan.md) §1、§2、§4）。
8. ~~**发版卫生**~~ — 已完成（2026-08-12 晚，v0.1.0：版本号脱离
   0.0.0、`CHANGELOG.md` 随包发布、tag `v0.1.0`、正式 VSIX
   `dist/droidvisx-0.1.0.vsix` 已安装；门禁与包指纹见「当前安装包
   状态」首条）。

### 设计调研完成、未排期（2026-08-12 傍晚，零生产代码改动）

- **会话小地图（minimap scrubber）** —
  [`conversation-minimap-design.md`](./conversation-minimap-design.md)。
  Grok 式右缘刻度栏：offsetTop 归一化定位、接入现有滚动协调器 rAF、
  未挂载消息用"更早区"帽子表示。第一切片估 1–1.5 天，用户明确
  "不急着做"。
- **主题切换（暗色主题）** — **已实施（2026-08-13，见「生产已
  接通」§26）**。[`theme-switching-design.md`](./theme-switching-design.md)
  为设计底稿；实施走 token 暗色块 + `24-theme-dark.css` 暗色皮肤
  覆写残留字面量（全量硬编码收敛未做完，皮肤文件即覆写清单），
  持久化按用户任务书走 `droidvisx.theme` 设置项而非文档 §2.2 的
  globalState。
- **结构债重构计划（三巨型文件拆分 + 重复实现合并）** —
  [`refactor-plan.md`](../engineering/refactor-plan.md)（2026-08-12 晚，
  规划产物、零生产代码改动）。四批次：① styles.css 拆 18 文件 +
  token 收敛（与暗色主题地基捆绑，用户已拍板）② ChatController 拆
  薄路由 + 12 个 chat/ 模块（含 148 用例测试同步拆）③ Thread.tsx 拆
  9 个 thread/ 子组件 ④ isSafeModelId 等重复实现合并 + 孤儿导出清理。
  双代理并行约 4 个窗口；含成员级映射表、行为等价门禁与行数护栏方案。

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
说明）。2026-08-12 深夜 §21 完成双模式归一：默认切 daemon +
自动回退、/btw 移植 daemon、能力×模式实测表（见 §21）。

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
