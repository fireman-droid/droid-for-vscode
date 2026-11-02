# 当前状态

核对日期：2026-11-02。本文区分当前源码、实际验证与安装状态，不再追加逐次施工日志。
功能边界见 [CAPABILITIES](CAPABILITIES.md)，待办见 [PLAN](PLAN.md)，交互约定见 [DESIGN](DESIGN.md)。
旧构建哈希、调查和性能数字从 Git 历史查阅，不能充当当前版本验收。

## 版本与交付

- 当前发布版本为 `0.8.19`，在 `0.8.18` 基础上合并了混合增量流式 Markdown 渲染与 Shiki `GrammarState` 按行增量高亮、Kilo 风格 AI 回复排版与流式渐显防跳闪、新提问置顶与动态留白跑道（含流式上滑「回到底部」按钮恢复）、BTW 按序过程穿插与气泡重构、会话恢复与子代理详情页提速、子任务三档模型／推理强度独立直选、补全设置即时保存、深色模式呼吸星空背景及引用胶囊精简。
- `0.8.18` 已通过 [PR #18](https://github.com/fireman-droid/droid-for-vscode/pull/18) 合入 `main`（提交 `e9dfb6f0`），并同步发布至 GitHub Release 与 Open VSX。
- `0.8.17` 已通过 [PR #17](https://github.com/fireman-droid/droid-for-vscode/pull/17) 合入 `main`（提交 `1639c2f2`），并同步发布至 GitHub Release 与 Open VSX。
- `0.8.16` 已通过 [PR #14](https://github.com/fireman-droid/droid-for-vscode/pull/14) 合入 `main`（提交 `c6e8c8fa`），[GitHub v0.8.16](https://github.com/fireman-droid/droid-for-vscode/releases/tag/v0.8.16) 与 [Open VSX 0.8.16](https://open-vsx.org/extension/droidvisx/droidvisx/0.8.16) 均已正式公开（同一产物 `droid-0.8.16.vsix`，14,313,474 字节，SHA256 `8fa29f8a97a5014e945919d28309ad6a921f01fc6f7a40b2186c258249b99814`，172 项内容与入口校验通过）。
- 恢复文件等 composer 回执、附件／引用提示及临时诊断继续保留在消息列表底部状态区域；「Droid 正在工作／回答」、停止中（`Stopping…`）、压缩与等待子代理等运行状态统一移入底部 Composer 输入框的「继续提问」占位位置，未输入草稿时旋转显示、输入时隐藏、结束后恢复占位文字。
- Microsoft Marketplace 管理页在 2026-10-18 仍返回 429／Azure DevOps VSID 并发限流，此前还存在 `The extension 'droidvisx' already exists in the Marketplace`、Owner 列表为空的问题；未改名或覆盖既有产物，微软自动发布保持关闭，未配置 `VSCE_PAT`。
- 官方 Droid CLI 当前为 `0.242.0`；文档站为 https://fireman-droid.github.io/droid-for-vscode/ 。

## 当前源码

| 范围 | 当前实现与边界 |
| --- | --- |
| 聊天 | 新提问直接切换置顶，底部动态留白跑道承载首屏静止生长的回复，超出一屏后自动向下跟随，短回复结束时保持留白不回弹；最新活动独立成行，更早活动归入“执行过程”；正文按时间顺序穿插，历史数量紧随标题。单条工具与 thinking 独立折叠，Edit 默认显示精简 Diff，可在原卡片展开全部，没有 thinking 中间分组；长 thinking 原文分块合并更新并限高滚动。正文与折叠箭头左边缘对齐，失败操作收起时仍可查看。队列预览最多三行；常规设置提供等待／引导，默认等待；daemon 引导不停止当前任务，消费确认后移入聊天，投递不明时暂停保留内容。其余流式、附件、权限／问答、引用和 BTW 保留 |
| 管理页 | 常规、模型、补全、会话、任务；共享设置行、搜索筛选、分页和滚动条，Select 弹层不少于触发器宽度并随单行选项内容扩展，列表刷新保留已有内容 |
| Factory 账户与额度 | 设置页侧栏底部显示 CLI 登录的邮箱与姓名，折叠后只留首字母头像，读取走独立非阻塞通道不锁页面忙碌态；`/limits`（Usage Limits）提供 `Standard`／`Droid Core` 分段切换与 `5-hour`、`Weekly`、`Monthly` 三条独立进度条及重置时间。身份取自本地 access token 载荷，额度读取 `GET /api/billing/limits`（EU 账户与 `FACTORY_API_BASE_URL` 走各自主机），结果按窗口缓存 20 秒；token 只留在 Extension Host，未登录或读取失败给出对应提示 |
| Mission 创建 | 说明型开关行保持背景稳定，操作按钮随内容收紧；调度／执行／验证代理模型支持搜索，保留来源筛选与现有推理等级 |
| 设置模型 | 搜索、来源分组、继承、模型与强度子菜单；下拉选项悬停与选中态统一使用中性灰背景与正文色勾选，菜单随单行内容扩展并受视口约束；等级来自 SDK；纯模型场景直接选择，主聊天尚未整体迁移 |
| 多语言 | 简体中文、繁体中文、英语；默认跟随编辑器，消息与代码保持原文 |
| 主题 | Light／Dark／Auto；真实浏览器刷新先恢复最近主题，深色导航使用可辨识的共享选中背景；深色模式下主聊天提供可开关的透明层夜空呼吸繁星背景（`droidvisx.chat.starfield`，不改变原有背景色，浅色模式与隐藏态自动停用）；正文、BTW、Diff 和输入框共用用户选定的半透明石墨灰文字选区，保留原有字色 |
| Review | 操作与整轮改动、Git 比较、全文／片段、行内问答、受限的操作 Undo 和 SDK Restore；真实浏览器复用同一 Host 控制器，工具栏、滚动和问答沿用共享 UI |
| 恢复 | 打开的会话在 SDK 快速重连结束后每 30 秒继续恢复原连接；Host 自动恢复已知会话及空闲 IDE，回到窗口／侧栏时检查；不重发消息，不中断运行中的后台。失联后台仅在确认旧进程退出后允许替代，身份无法核实不另起任务 |
| 补全 | 独立 FIM 与 Next Edit；自动续写允许较长词尾、条件右括号和语言候选扩展，共享防抖／上下文／请求，短负缓存及可关联诊断；多行建议的嵌套闭合括号不再因相邻同形括号被整段拒绝；默认关闭，模型费用独立于聊天 |

## 开发与测试结构

- 旧 Figma 原型工程与过期设计截图已移出当前源码；生产页面、文档截图和第三方许可保留。
- 22 个公共 UI 测试及两份 DOM/输入辅助文件归入 `packages/chat-ui/test/`；应用业务测试仍就近存放。
  默认 Vitest 收集范围包含公共包，文件预算覆盖测试目录；两份无消费者的旧组件转导出已移除。
- 根命令统一提供 `test:extension`、`test:runtime`、`test:webview`、`test:chat-ui`、`test:quality` 与性能入口，详见 DEVELOPMENT。
  5 个补全评估器 Node 测试文件通过 `test:quality` 接入必需 PR 检查；Node 26 / Python / Go 与 Node 24 构建阶段分开。
  常规测试不调用模型，真实模型评估与 smoke 保持显式运行。
- 编辑器集成测试按必需激活事件逐项断言，允许增加其他合法入口，不再固定旧的三项完整清单。

## 最近验证

- `codex/ui-style-fixes`（新提问直接置顶、动态留白跑道防抖、吸顶提问卡回滚与中文标点加粗修复、BTW 工具折叠与准备占位重构、智能补全自动保存与平滑折叠、`/limits` 悬停态修正、Skill 补全光标归位、Worker 多步运行态防闪烁、深色模式星空背景与遥测噪音治理）：`TranscriptView.tsx` 与 `useTranscriptScroll.ts` 在新用户提问进入消息列表时直接将其切换置顶（`PINNED_QUESTION_GAP = 12`），通过列表容器 `min-height`（仅在值变化时写入，排除 `data-pin-runway` 观察）与动态留白跑道使首屏回复静止向下生长、过程卡片展开／收起零抖动、短回复结束保持留白不回弹；`TranscriptView.tsx` 将吸顶选区锁定范围收窄至 `pin.current`（仅置顶卡片自身存在文字选区时保留旧候选，新提问越界或跑道重贴合时直接切换）、在 `resolvePinOffset` 中结合留白跑道阈值与真实 DOM 行顶对齐最新提问 `start`，并配合 `useTranscriptScroll.ts` 仅在列表高度收缩或滚到底部时重置 `userScrolling`，修复向上查看历史再滚回底部时错锁上一条提问卡遮挡最新回复、需点击屏幕才恢复的问题；`transcriptStatus.ts`、`Transcript.tsx` 与 `ReadOnlyTranscript.tsx` 抽出 `replyOperationsLive`，只在停止仍在进行（`stopping`）时隐藏改动摘要，中断（`interrupted`）回合结束后恢复显示「N 个文件已修改／Review」卡片，修复回复中途暂停后已修改文件不出现改动摘要的问题；`turnFlow.ts` 在停止期间（`stopping`）继续接收已执行工具的 `tool-result`，其余事件照旧丢弃，避免暂停前已完成的 Edit 回执被丢弃而漏计改动；`parseMarkdown.ts` 在 `remarkGfm`／`remarkMath` 之后对非代码／非公式文本节点中被 CommonMark 标点侧翼规则漏解析的成对 `**…**`（如中文引号 `“…”`、方头括号 `【…】` 紧邻加粗）补齐 `strong` AST 节点；`webviewHtml.ts` 与 `projectFrontendEvent.ts` 过滤 Chromium 良性 `ResizeObserver loop` 提示，消除 `frontend_error` 误报；`routedDaemon.ts`、`createDaemonDroidSession.ts` 与 `extension.ts` 新增按会话直连归属 Daemon 的 `listOpenedForSession` 探针，避免回合看门狗与会话查看器每 5s／2.5s 触发跨池全量发现，且 `ga4Config.ts` 仅上报异常／重连类 `daemon_health` 事件；`statusMessage.ts` 消除中断轮次重复 `Stopped` 提示；`SideToolRecords.tsx`、`SideReply.tsx`、`SideChatSheet.tsx` 与 `btw.css` 将 BTW 工具折叠标题固定为「已探索」分类统计摘要并与思考折叠左箭头对齐，展开列表改为单行省略且移除已完成勾选列，用户提问改为右对齐自适应中性灰聊天气泡（`14px 14px 3px 14px` 圆角、`--soft-surface` 底色与 `--chat-edge` 细描边，移除 `You` 前缀），并将 `Preparing`、`Waiting for reply…`、`Thinking…`、`Using tools…`、`Receiving reply…`、`Stopping…` 等运行状态统一收进底部 Composer 输入占位位置；`btwThinking.ts`、`btwProtocol.ts` 与 `btwCardState.ts` 将 BTW 回答改为按到达顺序的 `parts`（思考段／工具／正文偏移，思考最多 64 段），`SideReply.tsx` 复用主聊天 `ActivityGroupView`／`ActivityItem`／`ThinkingView`，把相邻思考与工具合并为「已探索」折叠组并让正文穿插在原位置，修复多轮思考被拼成一段、工具与正文先后顺序丢失的问题；`CompletionSettings.tsx` 与 `ManagementBinding.ts` 改为开关／下拉即时保存、输入框失焦／回车保存、API Key 独立按钮设置，移除底部 Save／Saved 栏，并为 Next Edit 与 Advanced 接入 `AnimatedCollapsibleContent` 平滑高度与透明度过渡；`composer-panels.css` 移除 `/limits` 与 Context 面板关闭／刷新按钮的边框与灰色悬停底色，并保持激活分段页签悬停对比度；`inline-input.tsx`、`useCodeReferenceDraft.ts` 与 `ComposerSuggestions.tsx` 在通过回车／Tab／点击选择 `/skill`、`/command` 或 `@mention` 替换草稿后，将光标精准定位到插入前缀末尾（如 `Use the "…" skill: ` 之后），修复光标停留在原 `/query` 字符长度处的错位；`transcriptStatus.ts`、`Transcript.tsx` 与 `ReadOnlyTranscript.tsx` 按分组内全部条目匹配当前运行 `turnId` 并保持尾部在途回复的 `replyPending`，消除子代理／Worker 在多轮工具间隙暂停时提前闪现 `just now` 与复制按钮；`AgentNavigation.tsx` 与 `composer-changes.css` 在 Agent 列表行存在 `Stop`／`Stopping…` 操作时省略重复的 `Running` 状态文案并将操作按钮贴齐最右侧；`TranscriptView.tsx` 的置顶跑道改按「读者离开的旧 `pinTop`」判定释放，不再依赖会随每条流式文本变化的 `nextHeight`／`layoutShifted`，释放只停止吸附、不写 `scrollTop`，并对 `domTurnStart` 取整及为 `< pinTop` 预留 1px 亚像素量化容差，`useTranscriptScroll.ts` 记录滚轮脱离底部的手势并让其在随后那次 `scroll` 事件中优先于布局启发式、直接按脱离跟随且距当前 `bottom` 超过 `FOLLOW_REJOIN_PX` 判定 `away`（不再扣除 `runway` 导致置顶流式回复向上滑动时不显示「回到底部」向下箭头），`ActivityGroupView.tsx` 将运行态 `.v2-running-latest` 纳入反向同步的 `AnimatedCollapsibleContent` 200ms 过渡且 `processPresentation.tsx` 在展开／收起时同步调用 `stopFollowing` 清理滚动动画，修复发送提问后向上滚被拉回底部以及流式过程组展开／收起的高度跳变与亚像素抖动；`StarfieldBackdrop.tsx`、`ChatLayout.tsx` 与管理页常规设置新增深色模式专属透明层呼吸繁星背景（`droidvisx.chat.starfield` 开关控制，以右下角为天极、主聊天长为半径在左上 1/4 象限内顺时针缓慢旋转，离屏精灵缓存 + 空闲帧率节流 + 隐藏自动休眠，不改变原有 `--surface` 底色）；`projectSessionHistory.ts` 将工具结果预算裁剪移至全量消息投影尾部执行一次（消除大历史文件逐个 `tool_result` 的 $O(N^2)$ 扫描），`FactorySessionCatalog.ts` 与 `worktreeSessions.ts` 收敛目录侧车读取与并发 Worktree 目录查询，`persistentIdeRelay.ts` 在等待 IDE 握手期间加密轮询至 50ms 且 `windowDaemonPool.ts` 按每次状态切换重置 `ide.native.relay-state` 计时；`SessionViewerPanelController.ts`、`ReadOnlyTranscript.tsx`、`ReadOnlyTranscriptView.tsx`、`ActivityGroup.tsx` 与 `planAnchor.ts` 为子代理只读详情页接入 80ms 实时刷新合并与未变更快照去重、稳定虚拟行 `renderMessage` 引用、60 条消息／过程项窗口分页与增量 Plan 锚点缓存；`DefaultsSettings.tsx`、`DefaultsFields.tsx`、`ManagementDefaultsService.ts` 与 `model-picker.tsx` 将默认设置中 Spec 与子任务自主等级／三档模型的默认继承项统一为「跟随主聊天」（`Follow main chat`，子任务重置映射为 `subagentInheritTiers`），并将子任务三档拆分为独立的 `Model` 与 `Reasoning effort` 两行直选（继承状态下推理强度锁定显示对应档位的 `Inherit (Low / Medium / High)`，`selection.tsx` 与 `DefaultsFields.tsx` 过滤表单内受控 `Select` 切换选项时 `SelectBubbleInput` 冒泡的空值事件）；`markdownStream.ts`、`parseMarkdown.ts`、`streamingTree.ts`、`markdownWorkerProtocol.ts`、`syntaxWorker.ts`、`syntaxQueue.ts` 与 `CodeSyntax.tsx` 完成 Markdown 混合增量流式渲染与代码高亮改造（未闭合代码围栏 $O(1)$ 直通投影、顶层稳定块 LRU 缓存与 `[id]: url` 引用定义整篇回退、尾部 `live` 块未闭合行内语法补齐、Worker 树比对引用相等零序列化快路径、Shiki `GrammarState` 按行增量染色与同 `streamKey` 队列合并、移除 150ms 轮询并改为 `CodeLine` 按行 memo 化保选区渲染），并参照 Kilo 打磨 `chat-region.css`、`theme.css`、`webview-host.css`、`Markdown.tsx` 与 `streamingText.tsx` 的 AI 回复排版与流式渐显（修正宿主 `body.vscode-dark code` 预格式化绿字渗透，统一 `21px` 行高、段落／列表间距、弱化列表序号与引用块、行内代码微描边及文件引用虚线下划线，且 `FadingText` 保持在途渐显跨度直至 `onAnimationEnd` 消除高频 token 跳闪）。`typecheck`、`lint:budgets` 与定向测试全部通过。
- `codex/telemetry-and-daemon-fixes`：GA4 媒体资源 `properties/560369275` 已注册全部 21 个 EVENT 级自定义维度与 17 个自定义指标；`daemonLifecycle.ts` 的 Windows `Win32_Process` 查询限定 `-Property ProcessId,CommandLine`；`windowDaemonPool.ts` 复用在途 `verifyRecords` 批次避免并发重复拉起 `powershell.exe`，并在发现阶段与 `retireEmpty` 中自动回收旧窗口退出后遗留的无会话孤儿 `window-daemon`；`webviewStateDelivery.ts` 在侧栏隐藏期间仅标记待重放快照，不再每 30 秒刷写 `host.view.state-delivery` 警告；`webviewHtml.ts` 忽略内联无 `src`/`href` 的 `<style>` 捕获期错误事件，消除 Mermaid 离屏测量触发的 `resource failed: STYLE` 误报；`ga4Config.ts` 补齐初始化失败、历史读取失败、前端资源错误与 `daemon_health` 细分维度。
- `codex/ui-style-fixes` 与 `codex/runtime-fixes`：完成设置侧栏宽度补全、Review 代码问答引用芯片防跳动、Quote 芯片图标实心旋转、`Ask for input` 移出「已探索」分组，以及跨会话／孤儿工作区快照租约自动结清、`window-daemon` 受保护复用 PID `kill EPERM` 处理（#16）和 `AskUser` 多选兜底识别／无前缀编号历史解析（#9）。`lint:budgets`、类型检查与受影响单元测试（63 项）全部通过。
- Factory 账户与 `/limits`：本机真实凭据读取 `GET https://api.factory.ai/api/billing/limits` 返回 200，字段与 Factory 应用截图一致（`Standard`／`Droid Core` 分段切换与三窗口独立进度条 + `extraUsageBalanceCents`）；token 载荷确认含 email、first/last name 与 org；设置页 `account.read` 走独立非阻塞请求通道，不占用 `busy` 或阻塞其他设置。类型检查、文件预算通过；`factoryAccount` 9 项定向测试覆盖身份解析、窗口投影、epoch 毫秒、EU 主机与未登录路径。
- `codex/ga4-diagnostics` 分支已将 Cloudflare Worker GA4 遥测从 5 类前端事件扩充至 18 类全链路白名单事件（新增 `frontend_render`、`runtime_init`、`session_history`、`session_switch`、`session_recovery`、`daemon_health`、`ide_relay`、`turn_lifecycle`、`context_window`、`subagent_lifecycle`、`tool_execution`、`review_activity`、`autocomplete_activity`），并完成 100MB+ 大会话「对话转不回来」四项修复：`connectPublicDaemon.ts` 将 RPC `requestTimeout` 从 `30000ms` 提升至 `120000ms` 并注入 `loadAllMessages: false` 启用压缩锚点反向快读；`routedDaemon.ts`／`persistentIdeRelay.ts` 在同 Daemon 尚未打开 Worker 或前次 `resume` 失败时重置 Relay 根会话握手，消除 `rebindIdleAttachment` 误杀刚加载完成的 Daemon；`daemonLifecycle.ts` 在端口未监听且旧 PID 已退出时跳过 `powershell.exe` 进程查询；`runtimeLifecycle.ts` 在断线自动重连重试期间复用当前已加载的历史 transcript，避免重复读取百兆 JSONL 与重复推送快照。主聊天顶部历史裁剪说明与展开入口已合并为渐隐细分割线与胶囊缓动触发器，前后端捆绑文件变更均支持自动热重载。`lint:budgets`、全仓 `typecheck` 与生产构建通过。
- `codex/ui-style-refinements` 分支已完成设置页下拉框（`ModelPicker` 勾选／选中背景、`ScrollArea` 拖动滑块、模型发现列表选中行）由橙色回归中性灰、`Select` 与 `ModelPicker` 弹层按单行内容自适应扩展宽度并与未展开触发框右边缘对齐，以及 BTW 发送／停止按钮与主聊天发送按钮样式对齐；Node 24／pnpm 10.2.0 下 `typecheck`、`lint:budgets`、生产构建与 VSIX 172 项校验通过。
- 长草稿输入修复：粘贴及继续输入后让光标在编辑区内可见，受控内容重建保留内部滚动位置；单条输入容量扩至 2,000,000 字符，发送、队列、历史恢复同步使用新预算，移除新增超限提示。
- 消息卡片编辑期间持续暂停主聊天自动跟随，避免向下滚到底部后被流式回复再次拉走。
- 目录与测试整理：迁移相关的 26 个 Vitest 文件 / 150 项测试、5 个评估器文件 / 20 项 Node 测试通过，默认 Vitest 覆盖公共包测试目录，文件预算与类型检查通过。
- 本轮以真实原生会话和 VS Code `globalStorage/droidvisx.droidvisx/logs` 交叉核对，展开测量实际写入 `webview.perf-batch/activity.expand`。新连接上的 13／15／20／43 条记录组可展开，收起终端正文未挂载，完成态 thinking 从顶部阅读，所见 Script 不再有外层转义包装；跨段复制实测排除执行提示。未重现用户报告的整个编辑器无响应，启动／历史定位仍观察到 205–274ms 长任务，不能将局部展开修复描述成全面性能达标。源码复制按钮通过 Host 路径处理，浏览器剪贴板未提供该路径的有效验证；对应内容／Diff 复制由针对性测试覆盖。
- 本轮 12 个定向测试文件共 186 项通过，涵盖实时／历史失败状态、Script 解包与去重、长 Thinking 分块排版和滚动、紧凑缺失状态及既有 Edit／快照恢复。
  同一真实会话读取 2442 条消息、保留 2000 条记录后重放：原错误命令为 failed、对应重复汇总消失，剩余 14 条有内容的 Script 均无外层 part/result 传输包装直接展示。
  后续空白思考修复的 6 项定向测试通过，并在用户指定的真实页面位置核对空正文与无效箭头已移除；最终包已安装，安装后未重载编辑器验收。用户指出的 Diff 方法提取行配对已按要求推后，见 PLAN。
- 自动换行完成类型检查、文件预算、一次最终构建及 172 项 VSIX 内容／入口校验；按用户要求未追加页面验收或样式测试。
- [PR #14 上一提交的 CI](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39113891055) 有 2505 项测试通过，
  `ReviewFiles.large.test.tsx` 的清空筛选后滚动复位断言失败（31720／预期 0）。相关文件不在本轮改动中，尚未确定根因；PR 保持草稿，未因本地安装绕过合并检查。
- 本轮运行状态、最新活动组合、Edit 归属、长 thinking 与聊天快照恢复的定向测试通过；
  类型检查、文件预算通过。长文本测试验证原文完整、增量合并、旧文本节点复用与滚动恢复，不作为编辑器帧率结论。
  未追加真实页面验收，旧卡住会话与新界面留待用户在本轮试用包中核对。
- Node 24／pnpm 10.2.0 下类型检查、文件预算、生产构建与 172 项 VSIX 内容及入口加载校验通过。
  [0.8.15 远端 CI](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39093967549) 的 354 个文件、3951 项测试全部通过。
  [正式标签构建](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39094350617) 成功，各渠道复用其同一附件。
- 本次 Activity 独立折叠修正的 2 个针对性测试文件、24 项通过，覆盖外层与单条各自收起、没有中间思考分组、
  新增思考不重新打开旧条目、手动选择跨虚拟重挂载保留，以及命令输出与失败操作仍可查看。
  ChatApp 转录恢复的 5 项测试通过，明确区分过程摘要与实际命令卡片，并保留命令与后续正文不重复的断言。
  Node 24／pnpm 10.2.0 下类型检查、文件预算、最终构建与 172 项 VSIX 校验通过。
  当前 VS Code Browser Dev Client 已确认外层展开、单条思考收起同时成立，且没有中间“思考记录”入口；没有添加 CSS 文本测试。
- 自动恢复以模拟时钟覆盖长时间断线、订阅恢复失败、进程退出、并发重试、认证阻塞和关闭清理。
  未做真实整日挂机／休眠验收，未调用付费模型；真实 daemon 中途引导及断线组合场景仍待实测。
## 未完成与使用限制

- 自动恢复不能代替 CLI 登录、安装或协议升级；这些明确的不可用状态保留人工处理入口。没有已知会话 ID 时不自动新建聊天；后台身份不确定、仍有待答权限或正在执行的任务时，不强制迁移 IDE。
- 常规问答 BYOK 目录的未提交修改仍暂停，未进入本次包。
- 同一工作区目前只允许一条执行；多聊天可以打开，等待状态提示与并发架构没有在本次改变。
- SDK 0.9.1 没有独立压缩推理强度。能力是否可配置应按具体操作契约核对。
- 当前局部回归和浏览器验证不代表全仓、跨平台、长期运行或全部模型服务已验收。
  Restore／Undo、管理写操作、完整 Mission 生命周期等按具体任务验证。
- 历史原文和任务状态以 Droid 为权威；本地元数据、快照、UI ACK 或工具路径不能替代
  真实终态、完整绘制和文件作者证据。其他未接入能力集中在能力矩阵。

## 文档与规则

- 用户／项目规则已去除逐次测试审批与无效 skill 依赖；保留范围、用户改动和安装发布边界。
- 设置页认可的共用样式写入 DESIGN；项目级 skill 由统一入口 `droid-dev-pipeline` 串联 `practical-ui-refinement`（界面整改）、`vsix-packaging`（构建打包与安装校验）与 `git-branch-release`（分支提交、PR 合并与单产物发版）。
- STATUS 保留当前快照，PLAN 保留待办，DESIGN 保留稳定约定；历史材料由 Git 保存。
- 文档站构建及仓库内文档文件链接检查通过；构建仍提示已有的大体积前端 chunk，未影响产出。
- 宣传首页按 Factory 首页结构重做：首屏、三列支柱、模型展示、八项功能、Mission、
  工作流、安装步骤和文档入口使用 Droid 内容；本地字体附带 OFL 许可。
  首页与 README 统一定位为“开源 AI 编码助手”；参考 Kilo 的任务导向表达，按 Droid
  实际能力重写介绍、功能与使用场景，页面标题和摘要同步更新。
  桌面及 390px 窄屏已检查，下载菜单、导航和安装步骤切换正常，未见横向溢出或坏图。
  网站构建与文件预算此前通过；本轮发行在独立工作目录中保留主工作区的暂停改动。
  参考取证包含 HTML 双抓、527 个资产的哈希账本、运行时补录与源码模块定位；
  403 个源站 404 和 1 个基址 400 逐 URL 登记后镜像校验通过，抽样回源 3/3 一致。
  未完成 skill 的整站断网、像素等价和 Next/RSC 重构门，不宣称全流程或整站 1:1 验收。
  [官网](https://fireman-droid.github.io/droid-for-vscode/) 与
  [文档站](https://fireman-droid.github.io/droid-for-vscode/GUIDE.html) 已部署至 GitHub Pages；
  [部署流水线](https://github.com/fireman-droid/droid-for-vscode/actions/runs/38380860041) 构建及发布通过。
  线上首页与文档页均返回 200，新文案已生效，首页已移除 noindex；README 和仓库主页已接入正式地址。
  本次部署仅更新网站，没有重复发布扩展。
