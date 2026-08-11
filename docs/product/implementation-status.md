# DroidVisX 实现状态

> 本文档是 DroidVisX 当前实现范围的持续更新台账，用来区分“已经接入产品的功能”“部分实现”“仅能力声明/探测”以及“尚未实现”。
>
> 最后核对日期：2026-08-11
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
Tool 列表可展开并带 read-only/off 徽标。MCP 认证流程（OAuth URL 跳转）
无安全公开渠道，保持未实现。

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
Skills 浏览与启停、MCP Server 浏览与启停已生产接通。Changes/Diff、
daemon 主运行路径、Commands、Mission 和 Manage Droid 等主要功能仍未
实现。

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
- 文件附件、全局或永久权限（Skills 与 MCP 浏览启停已生产接通）；
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
- Resend 会在有活跃 Turn 或待处理交互时被拒绝；Rewind 不恢复或删除
  工作区文件（`filesToRestore`/`filesToDelete` 恒为空）
- Copy 和 Reuse 不会自动发送、修改历史、回退文件或创建分支

Assistant 消息 Regenerate 与文件级 Rewind 安全检查仍未实现。

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

### 6. Exit Spec 审批子集

- 显示 `ExitSpecMode` 返回的计划
- 通过安全 GFM Markdown 显示标题、列表和代码，不暴露原始 `####` 标记
- 在 SDK 提供可编辑选项时编辑计划
- 可见操作遵循 Figma 的 Deny、Edit、Approve 层级；额外审批范围进入
  Split Button 菜单
- 返回 Droid SDK 提供的审批结果
- SDK 发出 `settings_updated` 后，Host 重新读取当前 Session 的权威
  Settings；ExitSpec 审批继续执行时 Mode 不再停留在旧的 Spec 显示

这只是 Exit Spec 权限交互，不代表完整 Spec Mode 已实现。

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
- 恢复旧 Session 时对公开 SDK 历史与本地安全缓存做顺序重叠核对；若 SDK
  只返回已压缩的后缀，保留本地已观察到的较早前缀，而不是用较短结果覆盖
- 公开历史或合并后的时间线不完整时独立标记 `partial`；只有来源或本地安全
  预算确实裁剪了内容时才标记 `truncated`，不把本地缓存冒充 Droid 的完整
  权威历史

边界：如果 CLI/SDK 在 DroidVisX 首次观察前已不再通过公开接口返回较早内容，
或本地 2,000 Item / 1,000,000 Text Unit 安全预算也已用尽，DroidVisX
无法从私有 CLI 文件恢复这些内容。

主要实现：

- `src/extension/SessionRecoveryStore.ts`
- `src/extension/ChatController.ts`

### 10. 本地结构化诊断

- 把同一个隐私安全 SDK Observability Bundle 注入 `ProcessTransport` 和
  `createSession()` / `resumeSession()`
- 记录 Runtime 初始化和 Turn 的结果、耗时、文本长度和投影事件数量
- Turn 结束诊断分别记录隐私安全的 Tool Start、Progress 和 Result 事件计数，
  用于区分“SDK 未发送可选进度”和“Bridge 丢失进度”
- Context 读取记录开始、耗时以及 `success`、`sdk-error` 或
  `invalid-stats` 结果；非法值只记录 `non-integer`、`negative`、
  `invalid-accuracy` 或 `projection-error` 等安全分类，不记录原始响应或错误
- 使用 `DroidVisX Logs` Output Channel，并贡献 `DroidVisX: Open Logs`
  Command
- 在 VS Code Extension Log 目录写入 JSONL；当前文件上限 512 KiB，保留
  两个轮换备份
- Logger、File 和 Output Channel Sink 失败不会改变 Runtime 或 Extension
  行为

安全限制：

- 不记录 Prompt/Message 文本、Tool 输入或输出、命令、路径、Session/
  Request/Tool/Terminal/Subagent ID、原始错误、凭据、Token 或 Stack Trace
- 字符串 Attribute 只保留短的 Code-like 值；未知 SDK Message 不进入日志

主要实现：

- `src/extension/LocalDiagnostics.ts`
- `src/runtime/runtimeDiagnostics.ts`
- `src/runtime/FactoryDroidRuntime.ts`
- `src/extension/extension.ts`

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
| Session 搜索                | 在最多 50 条本地结果中按标题或 ID 过滤                                                                                       | daemon 全量搜索、内容搜索、分页、排序和筛选                      |
| Session 生命周期            | List、Refresh、New、Select、Resume、活跃 Session Rename、编辑重问触发的 Rewind Fork                                          | Archive、Delete、Favorite、显式 Fork、Compact                    |
| Session 历史                | 文本、Thinking、Tool 生命周期                                                                                                | 历史 Image、Document 和未知 Block 会被省略并标记为 partial       |
| Tool 展示                   | 语义动作、技术 Tool 名、有界进度计数/类别、生命周期和实时观察到的真实耗时；不显示原始 Call ID                                | 参数、输出、结果、文件变更、Apply/Open 操作                      |
| 消息操作                    | Copy、Reuse in Composer、双击内联编辑并从该消息 Rewind 重问                                                                  | Assistant Regenerate、`getRewindInfo` 文件安全检查、文件恢复选择 |
| 本地诊断                    | SDK Observability、Host 生命周期/耗时、Output Channel、Open Logs、轮换 JSONL                                                 | 用户可配置级别、导出诊断包、遥测或远程上传                       |
| Spec                        | ExitSpecMode 计划显示、编辑和审批；审批后的 `settings_updated` 会触发权威 Mode 回读                                          | 主动进入 Spec Mode、完整计划生命周期、实施交接                   |
| Mission                     | Mission 相关确认可以显示为通用权限卡片                                                                                       | Mission 状态、事件、阶段、Worker、控制和独立 UI                  |
| Diff                        | 权限详情可以显示原始文本或 Patch                                                                                             | 原生 Diff 模型、Hunk 操作、`vscode.diff`、Changes 页面           |
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

- 图片和文档附件能力（Skills 与 MCP 浏览启停已生产接通）
- Session Archive、显式 Fork（Rename、编辑重问 Rewind 和 Compact
  已生产接通）
- Mission Mode 和 Events
- Worktree Session Creation

## MVP 未完成

### 运行架构

- [ ] daemon 作为主要运行路径
- [ ] daemon 连接和认证
- [ ] daemon 生命周期管理
- [ ] daemon 失败时回退 Node subprocess
- [ ] Capability Gate 接入 Extension 的安全产品门控

当前生产代码只使用 Node SDK `ProcessTransport`。

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
- [ ] `@` 文件和 Symbol 引用
- [ ] `/` 动态命令
- [ ] 已附加内容标签

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

- [ ] 文件附件
- [ ] 图片附件
- [ ] 文档附件
- [ ] 当前编辑器
- [ ] 编辑器选区
- [ ] Open Editors
- [ ] Problems
- [ ] Git Changes
- [ ] Terminal Output
- [ ] 项目文件选择
- [ ] Symbol 引用

### Edit、Resend 和 Rewind

- [x] Copy 历史用户消息
- [x] 非破坏性 Reuse in Composer
- [x] 编辑历史用户消息（双击内联编辑器）
- [x] 消息级重新发送（经 SDK Rewind 分支）
- [ ] Assistant 消息 Regenerate
- [ ] Turn Envelope
- [ ] `getRewindInfo`
- [ ] 文件变化安全检查
- [ ] 保留当前工作区或恢复文件的选择
- [ ] 冲突检测
- [x] Rewind 后建立分支 Session（Fork 自动接管为当前 Session）

### Changes 与 Diff

- [ ] 每轮 Changes 摘要
- [ ] 文件增删行统计
- [ ] Changes 页面
- [ ] 使用 `vscode.diff`
- [ ] Diff Hunk 操作
- [ ] 文件恢复确认
- [ ] SCM 集成

## V1 未完成

- [x] Skills 列表浏览与启停（`+` 面板 Skills 视图）
- [ ] Droid Commands 列表
- [ ] 动态 Slash Commands
- [ ] 最近使用命令
- [x] MCP Server 列表（`+` 面板 MCP servers 视图，状态与 needs auth 徽标）
- [x] MCP Tool 浏览（服务器行内展开，read-only/off 徽标）
- [x] MCP Server 启用与禁用（SDK `toggleMcpServer`，user 级设置）
- [ ] MCP 认证（OAuth 跳转无安全公开渠道）
- [ ] Custom Droids
- [x] Session Rename（活跃 Session 内联重命名）
- [ ] Session Archive / Unarchive
- [ ] Session Delete
- [ ] Session Favorite
- [ ] Session Fork
- [x] Session Compact（Context 浮层 “Compact conversation”，SDK
      `session.compact()`，收养延续 Session 并重载摘要转录）
- [x] Session Rewind（经编辑重问触发，建立分支 Session）
- [ ] Session 分支关系
- [ ] 完整 Spec Mode
- [ ] Mission 启动
- [ ] Mission 阶段和 Worker 摘要

## V2 未完成

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
- `dist/droidvisx.vsix` 大小：462,883 字节（Production Build minify 后，
  且 `.vscodeignore` 排除 `.cursor/**`）
- VSIX 修改时间：2026-08-11T04:42:32.5730102Z
- VSIX SHA-256：
  `4CA220F64EAE1D580009CFD54402E5BA63D900C6C3032362E56C0CB6E38A1308`
- VSIX 包含最终 Module 1 Runtime、Host、Bridge v2、隐私安全活动/日志和
  暖色 Webview Bundle，以及 2026-08-11 产品化打磨轮：Production Build、
  长会话渲染优化（消息身份缓存、尾部窗口）、styles.css 去重、扁平内联
  交互块、Tool/Thinking 内联真实耗时、Composer 常驻 Mode/Context
- `verify:vsix` 已验证 8 个入口和 Bundle 外部依赖
- 最终 VSIX 已成功安装到 Cursor
- 已安装的 Extension Bundle、Webview JS 和 CSS 哈希均与本次 Build
  完全一致
- Extension Bundle SHA-256：
  `5CFC52E6CE1AE5CC0853F035918C13834B3DE74FF4D5A83CEFA8EF0CBE26A419`
- Webview JS SHA-256：
  `EF2CEDE32BED60C068518FAAEA85562AF8C7378BD65AA43DE8FAA976BEC24A7A`
- Webview CSS SHA-256：
  `72D8781BFF9670E0718140EFCDC9CEF3D31ABE749E1D7C46A15E3A5BF5FC0D3E`
- 用户尚未在真实 Cursor 中完成最终可见验收
- 由于版本号仍为 `0.0.0`，现有 Cursor 窗口需要 Reload Window 才会换到
  新 Bundle

## 验证状态

最近记录的验证结果：

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

1. 按 `[docs/preflight/00-two-hour-runbook.md](../preflight/00-two-hour-runbook.md)`
   执行严格两小时垂直切片，不在窗口内继续调研。
2. 首先接通 Last-call Context Meter；如果公开事件/加载响应无法安全接通，
   保留 Unavailable 状态，不使用私有 `_client` 或累计 Token 推断。
3. Webview 改为 Production React 和 Minified Bundle。
4. 在不泄露 Command、Path、Output、Terminal ID 或 Subagent ID 的前提下，
   增加 Tool 耗时和更清楚的 Long-running 状态。
5. 完成自动化、VSIX、Hash、安装和真实 Cursor Secondary Sidebar 可见验收。
6. Module 2 继续暂停，直到该切片通过全部 Gate。

## 维护规则

以后每完成一个功能，必须在同一个变更中更新本文档：

1. 只有 UI、Bridge、Host 和 Runtime 链路全部接通后，才能标记为“生产已接通”。
2. 只有 Capability Contract、Probe 或测试证据时，必须保持“仅探测/声明”。
3. 临时替代行为必须标记为“部分完成”，并写明与规格的差距。
4. 打包或安装后必须更新“当前安装包状态”。
5. 验证章节只记录实际执行过的命令和结果，不得根据源码推测通过。
6. 不得把通用权限卡片误报为完整 Spec 或 Mission 产品功能。
