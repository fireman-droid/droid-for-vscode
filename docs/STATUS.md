# 当前状态

核对日期：2026-10-22。本文区分当前源码、实际验证与安装状态，不再追加逐次施工日志。
功能边界见 [CAPABILITIES](CAPABILITIES.md)，待办见 [PLAN](PLAN.md)，交互约定见 [DESIGN](DESIGN.md)。
旧构建哈希、调查和性能数字从 Git 历史查阅，不能充当当前版本验收。

## Diff 文件加载优化（未发布）

- `codex/review-file-loading` 从 `main` 独立开发。Git 文件列表同时读取大小，正文前不再另启一次大小查询；
  新增文件的父目录用一次批量元数据读取核对，省去重复 `show` 和逐层 `ls-tree`。忽略规则、符号链接、子模块与字节上限仍生效。
- 同一真实历史轮次的三文件只读重放，两组首次读取由 2.32／2.80 秒降至 1.26／1.28 秒，
  快照 Git 调用由 24 次降至 10 次，三份补丁 SHA256 逐一一致。已有重复读取缓存保持不变。
  这是本机后台读取结果，不含页面渲染时间，也不代表所有工作区的端到端速度。
- 五个定向测试文件、类型检查及文件预算通过。未追加浏览器验收，未安装本分支包；
  本机 VS Code 保留上一轮 `d0d1ec6` 聊天／换行试用包，本分支没有合入 PR #14 的界面改动。

## 版本与交付

- `0.8.16` 已通过 [PR #14](https://github.com/fireman-droid/droid-for-vscode/pull/14) 合入 `main`（提交 `c6e8c8fa`），[GitHub v0.8.16](https://github.com/fireman-droid/droid-for-vscode/releases/tag/v0.8.16) 与 [Open VSX 0.8.16](https://open-vsx.org/extension/droidvisx/droidvisx/0.8.16) 均已正式公开（同一产物 `droid-0.8.16.vsix`，14,313,474 字节，SHA256 `8fa29f8a97a5014e945919d28309ad6a921f01fc6f7a40b2186c258249b99814`，172 项内容与入口校验通过），并已同步安装到本机 Microsoft VS Code 与 Cursor。包含「已探索」活动折叠与底部 Composer 输入框内运行状态提示、多步历史回合合并与尾部预算保留、工作区基线哈希缓存、当前目录启动隔离与租约冲突处理、Script 结果解包与关联去重、长 Thinking 分块与收起终端卸载、代码块自动换行、界面提示复制过滤，以及纯本地前端统计。
- 恢复文件等 composer 回执、附件／引用提示及临时诊断继续保留在消息列表底部状态区域；「Droid 正在工作／回答」等运行状态移入底部 Composer 输入框的「继续提问」占位位置，发送后旋转显示、输入时隐藏、停止后恢复占位文字。
- Microsoft Marketplace 管理页在 2026-10-18 仍返回 429／Azure DevOps VSID 并发限流，此前还存在 `The extension 'droidvisx' already exists in the Marketplace`、Owner 列表为空的问题；未改名或覆盖既有产物，微软自动发布保持关闭，未配置 `VSCE_PAT`。
- Microsoft VS Code 与 Cursor 当前均已安装 `54c74e06` 本地试用包（在 `0.8.16` 基础上包含下拉框右对齐／中性灰／BTW 发送按钮修复与 Cloudflare Worker GA4 性能统计转发），尚未正式发布。
  包 SHA256 为 `b60361fe541301b8ab5f6eb3a8feaa7ab93593a32717468ef9b8a05d6f023fbb`；已核对 Microsoft VS Code 与 Cursor CLI 产品身份并安装成功，需在各自编辑器执行 Reload Window。
- 官方 Droid CLI 当前为 `0.241.1`；文档站为 https://fireman-droid.github.io/droid-for-vscode/ 。
- 已清理 21 个已合入主线的历史无用本地分支，保留未合入 PR 分支与 WIP 分支。

## 当前源码

| 范围 | 当前实现与边界 |
| --- | --- |
| 聊天 | 最新活动独立成行，更早活动归入“执行过程”；正文按时间顺序穿插，历史数量紧随标题。单条工具与 thinking 独立折叠，Edit 默认显示精简 Diff，可在原卡片展开全部，没有 thinking 中间分组；长 thinking 原文分块合并更新并限高滚动。正文与折叠箭头左边缘对齐，失败操作收起时仍可查看。队列预览最多三行；常规设置提供等待／引导，默认等待；daemon 引导不停止当前任务，消费确认后移入聊天，投递不明时暂停保留内容。其余流式、附件、权限／问答、引用和 BTW 保留 |
| 管理页 | 常规、模型、补全、会话、任务；共享设置行、搜索筛选、分页和滚动条，Select 弹层不少于触发器宽度并随单行选项内容扩展，列表刷新保留已有内容 |
| Mission 创建 | 说明型开关行保持背景稳定，操作按钮随内容收紧；调度／执行／验证代理模型支持搜索，保留来源筛选与现有推理等级 |
| 设置模型 | 搜索、来源分组、继承、模型与强度子菜单；下拉选项悬停与选中态统一使用中性灰背景与正文色勾选，菜单随单行内容扩展并受视口约束；等级来自 SDK；纯模型场景直接选择，主聊天尚未整体迁移 |
| 多语言 | 简体中文、繁体中文、英语；默认跟随编辑器，消息与代码保持原文 |
| 主题 | Light／Dark／Auto；真实浏览器刷新先恢复最近主题，深色导航使用可辨识的共享选中背景；正文、BTW、Diff 和输入框共用用户选定的半透明石墨灰文字选区，保留原有字色 |
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

- `codex/ga4-diagnostics` 分支已将 Cloudflare Worker GA4 遥测从 5 类前端事件扩充至 18 类全链路白名单事件（新增 `frontend_render`、`runtime_init`、`session_history`、`session_switch`、`session_recovery`、`daemon_health`、`ide_relay`、`turn_lifecycle`、`context_window`、`subagent_lifecycle`、`tool_execution`、`review_activity`、`autocomplete_activity`），并完成 100MB+ 大会话「对话转不回来」四项修复：`connectPublicDaemon.ts` 将 RPC `requestTimeout` 从 `30000ms` 提升至 `120000ms` 并注入 `loadAllMessages: false` 启用压缩锚点反向快读；`routedDaemon.ts`／`persistentIdeRelay.ts` 在同 Daemon 尚未打开 Worker 或前次 `resume` 失败时重置 Relay 根会话握手，消除 `rebindIdleAttachment` 误杀刚加载完成的 Daemon；`daemonLifecycle.ts` 在端口未监听且旧 PID 已退出时跳过 `powershell.exe` 进程查询；`runtimeLifecycle.ts` 在断线自动重连重试期间复用当前已加载的历史 transcript，避免重复读取百兆 JSONL 与重复推送快照。`lint:budgets`、全仓 `typecheck` 与生产构建通过。
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
