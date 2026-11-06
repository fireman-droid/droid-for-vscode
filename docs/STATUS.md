# 当前状态

核对日期：2026-11-06。本文区分当前源码、实际验证与安装状态，不再追加逐次施工日志。
功能边界见 [CAPABILITIES](CAPABILITIES.md)，待办见 [PLAN](PLAN.md)，交互约定见 [DESIGN](DESIGN.md)。
旧构建哈希、调查和性能数字从 Git 历史查阅，不能充当当前版本验收。

## 版本与交付

- 当前源码版本为 `0.8.20`，在 `0.8.19` 基础上加入繁星／三体／关闭三种深色聊天背景，并修复 AskUser 多选识别、勾选状态与单选填空互斥切换。
- 正式版 `0.8.20` 以 [GitHub Release](https://github.com/fireman-droid/droid-for-vscode/releases/tag/v0.8.20) 与 [Open VSX](https://open-vsx.org/extension/droidvisx/droidvisx/0.8.20) 为准。SDK／分页、Automations、诊断／Review 滚动与双编辑器热更新分别经 PR #22–25 合入 main。遥测覆盖及 `codex/style-fix` UI 修复经 PR #26 合入，聊天间距归零与补全详细诊断经 PR #27 合入 main；对应完整试用包已成功安装到 Microsoft VS Code，未更新 Cursor。版本仍为 `0.8.20`，未覆盖正式发布产物。Composer 菜单对齐已修复并通过定向检查，本轮授权合并 main 并安装完整 Microsoft VS Code 试用包；构建、合并与安装结果以本次交付回执为准，不更新 Cursor、不正式发版。
- 恢复文件等 composer 回执、附件／引用提示及临时诊断继续保留在消息列表底部状态区域；「Droid 正在工作／回答」、停止中（`Stopping…`）、压缩与等待子代理等运行状态统一移入底部 Composer 输入框的「继续提问」占位位置，未输入草稿时旋转显示、输入时隐藏、结束后恢复占位文字。
- Microsoft Marketplace 管理页在 2026-10-18 仍返回 429／Azure DevOps VSID 并发限流，此前还存在 `The extension 'droidvisx' already exists in the Marketplace`、Owner 列表为空的问题；未改名或覆盖既有产物，微软自动发布保持关闭，未配置 `VSCE_PAT`。
- 本机实测 daemon 自报版本为 `1.2.0`；文档站为 https://fireman-droid.github.io/droid-for-vscode/ 。

## 当前源码

本轮同源 UI 整改已接入当前任务分支，未更新已安装插件：启动入口、BTW／Review 问答、
选区工具栏、权限／Agent 焦点、过程命令、无时间占位、模型菜单定位、代码独立工具行与 Models
编辑流程使用生产共享源码。底部 Task 支持内嵌只读子对话；Bridge v60 复用现有子会话读取与订阅，
不创建新子代理，关闭／切会话／销毁取消旧查看；显式外部查看保留。

| 范围 | 当前实现与边界 |
| --- | --- |
| SDK 0.10.0 | 对象 transport、Script 批量权限与 RecommendMission 已适配；普通压缩保留原身份和租约，`/handoff` 显式创建后继，Spec 使用正式交接事件。文件浏览与自定义模型 revision 接口同步新版；默认设置保留已有开放字段，daemon 分页及 IDE 私有兼容补丁保留 |
| 本机 Automations | 已接通独立详情（`SettingsSection`／`SettingsRow` 概览卡片、运行与投递历史、原生四格指标与最近运行结果看板）、三步创建、每天／每周 24 小时制主题化 Select 与 UTC cron、固定会话或每次新建会话、会话查看／显式继续。创建暂停并跳过首次运行；配置写后回读，无法确认时阻止运行并请求暂停。已移除“立即运行”二次确认，保留执行校验与启用／删除确认；UI 修复已随 PR #26 完整试用包安装到 Microsoft VS Code。云端、事件触发与 Workstream 配置不在范围内；未改现有每日问候任务 |
| AskUser 问答卡片 | Runtime 与 Webview 共用多选提示识别，支持题目／主题中的括号说明和单选／多选混合表述；单选预设选项与自定义填空互斥，再次点击已选项可取消，多选保留全部已选项并合并补充填空 |
| 历史分页（已合并，未发布） | daemon 默认只读最近一页，向上滚动自动续页；三页阅读窗口与实时尾部分离，卸载页可重读，保留跨页工具结果与压缩前驱；查看器复用分页，子任务按调用消息 ID 隔离，导出显式遍历全部页。移除聊天 JSONL 优先读取、自动 Process 回退及专用历史 Worker；保留独立 Process 模式和操作证据的本地读取 |
| 聊天 | 新提问直接切换置顶，底部动态留白跑道承载首屏静止生长的回复，超出一屏后自动向下跟随，短回复结束时保持留白不回弹；最新活动独立成行，更早活动归入“执行过程”；正文按时间顺序穿插，历史数量紧随标题。单条工具与 thinking 独立折叠，Edit 默认显示精简 Diff，可在原卡片展开全部，没有 thinking 中间分组；长 thinking 原文分块合并更新并限高滚动。正文与折叠箭头左边缘对齐，失败操作收起时仍可查看。每条队列正文预览最多一行，含附件前缀，超长省略且操作区不收缩；常规设置提供等待／引导，默认等待；daemon 引导不停止当前任务，消费确认后移入聊天，投递不明时暂停保留内容。其余流式、附件、权限／问答、引用和 BTW 保留 |
| 管理页 | 常规、模型、补全、会话、任务、自动化；共享设置行、搜索筛选、列表表格（统一列宽、60px 行高、主标题 + 下方弱化副文案层级与尾列靠右操作）、底部分页（始终显示范围计数、每页条数与翻页控件）、24 小时制主题化时间 Select 和滚动条，Select 弹层按左起／右起位置分别左对齐或右对齐且不少于触发器宽度，列表刷新保留已有内容 |
| Factory 账户与额度 | 设置页侧栏底部显示 CLI 登录的邮箱与姓名，折叠后只留首字母头像，读取走独立非阻塞通道不锁页面忙碌态；`/limits`（Usage Limits）提供 `Standard`／`Droid Core` 分段切换与 `5-hour`、`Weekly`、`Monthly` 三条独立进度条及重置时间。身份取自本地 access token 载荷，额度读取 `GET /api/billing/limits`（EU 账户与 `FACTORY_API_BASE_URL` 走各自主机），结果按窗口缓存 20 秒；token 只留在 Extension Host，未登录或读取失败给出对应提示 |
| Mission 侧栏 | 从聊天模式选择打开，创建／详情及模型菜单使用共享 ScrollArea、紧凑页头和 28px 控件；开关／功能行不整片悬停铺色，保留模型搜索、来源筛选、推理等级、验证配置及所有原操作；状态文案与任务／计划正文的复制边界分开。创建及接管期间 Host 排他阻止普通发送，释放后才提交 Mission 首条任务；准备失败或候选过期释放排他，不自动重发被拒绝消息 |
| 设置模型 | 搜索、来源分组、继承、模型与强度子菜单；下拉选项悬停与选中态统一使用中性灰背景与正文色勾选，菜单随单行内容扩展并受视口约束；等级来自 SDK；纯模型场景直接选择，主聊天尚未整体迁移 |
| 多语言 | 简体中文、繁体中文、英语；默认跟随编辑器，消息与代码保持原文 |
| 主题 | Light／Dark／Auto；真实浏览器刷新先恢复最近主题，深色导航使用可辨识的共享选中背景；深色模式下主聊天提供可选的透明层深色背景（`droidvisx.chat.starfield`，支持 `starfield` 繁星、`three-body` 三体与 `off` 关闭，兼容旧布尔值，不改变原有背景色，浅色模式与隐藏态自动停用）；正文、BTW、Diff 和输入框共用用户选定的半透明石墨灰文字选区，保留原有字色 |
| Review | 操作与整轮改动、Git 比较、全文／片段、受限的操作 Undo 和 SDK Restore；问答为选区下方撑开单双栏 Diff 布局的行间 AI 批注，整体限高 `min(60vh, 480px)`，正文内滚动，保留流式、停止、追问及折叠草稿，有内容时 Escape 只折叠、显式关闭结束问答。选择其他代码后点击“在这里继续”才移动同一问答并追加源码引用，保留回复与草稿、不新建线程；首发基础上下文固定，新增引用随提问文本送往 Host。离线预览默认模型有效，约 4.1 秒本地回复始终基于固定示例，不读取新文件或调用真实模型。真实入口仍复用同一 Host 控制器；文件列表筛选缩短时清空旧虚拟滚动偏移，恢复长列表不跳回旧底部 |
| 工作区回合准备 | 切会话取消尚未提交 Runtime 的准备，释放该轮工作区租约且不伪造 after；已提交的后台回合继续保留租约，等待真实结束后收尾 |
| 恢复存储 | 主聊天使用工作区独立文件，原子写入后 Memento 只留标记；正文预算优先将可信旧操作转为原会话／工具／文件摘要引用，无可信来源标为 evicted，不按正文体积删除会话身份、谱系或待发队列；结构数量和字段上限保留 |
| 恢复 | 首次恢复读取失败显示不可用，同一控制器后续 ready／Retry 可重新读取，不把失败当空恢复；打开的会话在 SDK 快速重连结束后每 30 秒继续恢复原连接；Host 自动恢复已知会话及空闲 IDE，回到窗口／侧栏时检查；不重发消息，不中断运行中的后台。失联后台仅在确认旧进程退出后允许替代，身份无法核实不另起任务 |
| 回合终态核对 | 流结束但未收到完成事件时，按本次提交的后台回合 ID 读取持久化结果；确认成功／中断／失败后使用对应终态。未知结果不推断成功，查询期间已切换会话或回合则丢弃迟到结果，不重发请求 |
| 热更新重启反馈 | 后端更新请求重启后，旧激活实例仍存活或命令失败时显示三语言提示与“重试”。未重启时不推进后端基线、不自动反复重试，也不把新页面加载到旧后端；不强制关闭编辑器或停止进程 |
| 遥测覆盖与投递 | 同时遵守插件与编辑器遥测开关；有界队列、批量串行、有限重试、停用取消与仅本地投递记录。补齐激活／初始化阶段、发送接受／拒绝、首次响应与核对后的最终结果，流错误不再默认标记成功。模型／管理／Review 启动诊断及非聊天页渲染异常已接线；模型、管理、自动化派发与 Review 操作结果区分失败、取消、部分完成和无法确认。自动化 accepted 仅表示派发受理，不观察编辑器关闭期间的后台调度。继续使用既有 18 类远程事件；Worker 回执修复与新增环境字段仍待部署，未将本地测试视为线上送达证明 |
| 补全 | 独立 FIM 与 Next Edit；自动续写允许较长词尾、条件右括号和语言候选扩展，共享防抖／上下文／请求，短负缓存；多行建议的嵌套闭合括号不再因相邻同形括号被整段拒绝。模型返回与处理后候选按请求编号分片留在本地，仅清除凭据；具体过滤规则、已输入前缀不匹配、状态失效及 Next Edit 两条采纳路径可关联。远程不传正文，无替换／取消／上下文超时不再默认标为成功；候选返回不等于编辑器实际展示。默认关闭，模型费用独立于聊天 |

## 开发与测试结构

- 独立离线 UI 预览通过 `dev:preview` 在 `127.0.0.1:4178` 使用生产 Chat、Settings、Models、Mission、Viewer、Review 与 BTW 组件和样式。默认固定对话可直接发送；生产 Send／Stop／Queue 和既有 Permission／AskUser 卡片驱动本地 12 秒回复回放，包含工具、子代理和长代码续文，重置／切页会取消旧调度；静态 `full-workflow` 仍可选。模拟事件通过生产协议与 reducer，全部局限在 dev 入口；未连接模型、真实后台或工作区，设置保存、模型验证及文件／Git 操作仍明确未执行。公共 UI 直接解析源码；修改启动预览的同一目录可刷新浏览器，其他 worktree 和已安装插件不会自动同步。静态产物使用 `build:preview`／`serve:preview`，不打包或安装 VSIX，说明见 DEVELOPMENT。
  Chat 的模式菜单可打开真实 Mission 创建侧栏，固定能力与草稿只留在本标签页，可取消关闭；
  Start Mission 明确返回关联拒绝，不模拟创建或执行成功。
- 旧 Figma 原型工程与过期设计截图已移出当前源码；生产页面、文档截图和第三方许可保留。
- 22 个公共 UI 测试及两份 DOM/输入辅助文件归入 `packages/chat-ui/test/`；应用业务测试仍就近存放。
  默认 Vitest 收集范围包含公共包，文件预算覆盖测试目录；两份无消费者的旧组件转导出已移除。
- 根命令统一提供 `test:extension`、`test:runtime`、`test:webview`、`test:chat-ui`、`test:quality` 与性能入口，详见 DEVELOPMENT。
  PR 配置已将 `test:quality` 拆为按补全相关改动触发的独立任务，与 Node 24 构建并行；
  同名 `PR checks` 汇总所选任务，保留失败门禁，支持仅重试失败任务；已在 PR #23 远端运行通过。
  常规测试不调用模型，真实模型评估与 smoke 保持显式运行。
- 编辑器集成测试按必需激活事件逐项断言，允许增加其他合法入口，不再固定旧的三项完整清单。
- 热更新脚本已分开前端／后端／全部入口，修正前端构建与同步目录不一致，并仅同步 VS Code / Cursor 登记的当前同版本安装。3 项脚本检查、语法、类型、文件预算及前后端构建与双编辑器目标预演通过；后端单独构建未改写页面产物。复用已有页面刷新与扩展宿主重启监听，不重装 VSIX；本轮未写入安装目录，实际打开编辑器的自动刷新效果仍待确认。
- `daemon_health` 的 sidecar 启动／预热失败明确标记 `outcome=failed`，缺失原因使用 `unknown`，并保留已有 spawn／connect 阶段；不把失败默认标为 `ok`，不上传原始错误内容。

## 最近验证

- 会话生命周期与恢复的定向回归使用 mock 和临时目录，当前通过集合如下；集合分别列出，不累计复跑次数。

  | 范围 | 通过的测试文件与用例数 |
  | --- | --- |
  | 未提交准备回收 | `ChatController.preparation.test.ts` 3、`changes/snapshotCapture.test.ts` 6、`turnSnapshots.test.ts` 18、`ChatController.sessions.test.ts` 26 |
  | 恢复正文预算 | `SessionRecoveryStore.budget.test.ts` 2、`SessionRecoveryStore.test.ts` 22、`createPersistentSessionRecoveryStore.test.ts` 9、`operationEvidenceState.test.ts` 4、`runtime/tools/operationBody.test.ts` 9 |
  | 初始化失败重试 | `ChatController.initializationRetry.test.ts` 3、`ChatController.startupSelection.test.ts` 3、`ChatController.childStartup.test.ts` 2、`ChatController.retryRecovery.test.ts` 7、`ChatController.workspaceSwitch.test.ts` 16 |
  | Mission 创建排他 | `ChatController.missionStart.test.ts` 3、`mission/controller.test.ts` 5、`mission/setupProjection.test.ts` 1、`ChatController.sendRejection.test.ts` 2 |

  `typecheck` 通过；`lint:budgets` 首次发现快照文件超限，复用局部清理函数后通过，并通过受影响的扩展类型检查及准备／快照回归。
  未改真实恢复文件或锁，未做真实 daemon／模型验收，未打包安装。

- 恢复预算回归连续写入 31 轮合法大 Create 正文，并逐轮 flush／重新加载，确认选择、谱系、队列和后台回合身份保留。
  有来源的正文引用仍校验原会话／工具／文件与正文摘要，无来源证据保持 evicted；重复合并不复活已回收正文。
  文件迁移覆盖写失败保旧值／旧文件、读失败禁止空覆盖、工作区隔离和无存储目录兼容。
  未改真实数据库；更新后正常加载与持久化时才迁移，未以历史体积告警推断当前写入失败或卡顿。

- Mission 侧栏整改沿聊天模式选择 → `MissionWorkspace` → `MissionSetup`／`MissionDetails`，未重做独立 Mission 列表。
  3 个定向文件的 14 项行为已通过：首轮 12 项通过，新增预览测试误用聊天消息解析器、长模型选择用例超过 5 秒；
  测试改用生产 Mission 面板解析器，仅重跑这 2 项（15 秒上限）通过，选择用例实际约 2.3 秒。
  `typecheck:webview`、`lint:budgets`、一次 `build:preview`（2717 模块）通过。
  未做浏览器／真实后台验收、VSIX 或安装；从 Chat 模式菜单选择 Mission 可由用户体验创建侧栏，详情视觉仍待实际任务验收。

- Queued 每条正文预览改为单行省略，保留所有队列项、完整正文、既有悬停提示与发送／编辑／删除操作。
  仅修改共享生产 CSS；`build:preview` 通过（2717 模块），未追加测试、类型检查或浏览器验收，待用户体验。

- 直接发送新消息时，公共 Transcript 滚动层使用同一 RAF 做约 200ms 向上让位过渡，目标与留白跑道计算不变；
  确认替换不重播，仅排队／切会话不触发，减少动态效果时立即落位，滚轮／键盘／触摸可接管。
  滚动动效 13 项、原导航 1 项测试通过；首跑发现末尾不足 1px 时提前停止，修正后只重跑受影响的滚动文件。
  `typecheck:webview`、`lint:budgets` 与 `build:preview`（2717 模块）通过。未做浏览器或真实后台验收，
  未打包安装，实际动效待用户体验；此前 UI 验收不包含本次增强。

- Composer `@` 文件补全不再将中文句读后的普通文本持续当作查询；光标移出查询、选择文字、删除 `@`
  或 Escape 关闭菜单，同查询内移动保留结果和选中项。中文／连字符／盘符路径和带空格结果的插入保留。
  `Composer.test.tsx` 首跑 13 项通过、1 项因 jsdom 未反射 contentEditable 属性失败，补齐测试环境属性后
  仅重跑该光标回归并通过；覆盖截图原句、迟到响应、IME、合法路径及既有 Slash／发送行为。
  `typecheck:webview`、`lint:budgets`、`build:preview`（2717 模块）通过；未做浏览器或真实后台验收，
  仅更新源码预览，未打包安装，仍待用户体验。

- 聊天消息定位条使用公共 `QuestionNavigator` 的低对比短刻度和当前项小胶囊，保留上下跳转箭头、
  20px 宽透明命中区、消息预览、键盘焦点及原定位逻辑；只做 150ms 颜色／透明度过渡，不铺整条底色。
  定位参照已移到 `ChatLayout` 局部外框槽，底部 Agent／Queue／Composer 高度变化不再改变刻度的居中点和高度上限；
  无槽回退原位，移层后的滚轮、按键和触摸转交原处理器，保留主聊天滚动控制与子代理覆盖层的层级。
  定向导航／滚动测试 2 文件 18 项、`typecheck:webview`、`lint:budgets`、`build:preview`（2717 模块）通过。
  未做浏览器或真实后台验收，未打包安装；稳定位置和视觉效果仍待用户体验确认。

- Models 使用连接摘要列表与单个配置窗口，基础信息、现有模型操作、发现／手填及编辑集中在窗口内，
  连接摘要与聊天启动建议不再悬停整块铺色，改为 160ms 文字／图标反馈；连接箭头仅轻移 2–3px，
  保留键盘焦点和禁用状态，减少动态效果时关闭位移／过渡。本轮纯 CSS 续改的 `build:preview` 通过
  （2717 模块），未追加类型检查、测试或自动化浏览器验收；下述行为测试为配置工作区改动时的通过结果。
  复用生产管理页外壳与公共 Dialog／ScrollArea；来源偏好和本地筛选分开，各区原保存边界不变，
  外层关闭不撤销已生效操作，打开窗口不自动获取模型。Node 24.20.0／pnpm 10.2.0 下
  `ModelsApp.test.tsx` 4 项行为测试、`typecheck:webview` 与 `build:preview` 均通过，
  覆盖失败保稿、取消、保存后验证、发现选择及同窗继续配置；构建转换 2717 模块，保留大 chunk 与插件耗时提示。
  编译覆盖当前含 Review 续改的 Webview 源码；此前浏览器预览 UI 已由用户验收通过，未做真实模型调用。
  后续紧凑菜单修复将高亮色改为基于弹层底色计算，消除深色／Auto 下与菜单底色相同或接近的问题，
  管理页 Select 与共享模型菜单复用 Radix 高亮和 150ms 反馈，保留勾选、禁用及大连接行原样式。
  本次纯 CSS 的 `build:preview` 通过（2717 模块）；未追加测试、类型检查或浏览器验收，此项尚未经用户确认。
  Host 密钥复用已独立修复：旧保存／发现路径及批量导入首个成功项将收到的密钥写入 SecretStorage，
  后续按协议和规范化地址复用；密码框与异步存储共享同一在途请求，重复点击不再重复弹框，
  取消不覆盖既有密钥，单个等待者取消不影响其他等待者，HTTP 失败不循环索取密钥。
  模型发现允许不同连接并行，同连接去重，配置写入仍与发现互斥；密钥不回传 Webview。
  修复前经旧扩展路径或外部 CLI 仅存入 Droid、尚未进入 SecretStorage 的历史密钥，
  仍可能首次补输一次，之后同一接口地址可复用；公开列表只有掩码，未新增读取私有配置的回退。
  Host 首轮 4 文件／54 项测试通过；两处持久化与并发审查修正后，仅重跑受影响 2 文件／45 项并通过，
  `tsc -p tsconfig.extension.json --noEmit` 与 `lint:budgets` 通过，其余未受影响检查复用。
  未做真实密钥复用、Extension Host／daemon 或编辑器验收，未打包安装、推送、远端 CI 或发布。

- 同源 UI／离线模拟：Review 行间批注及默认模型／约 4.1 秒模拟回复续改后，由用户接管视觉验收；用户反馈主要结构可用，随后修正标题边线与重复引用、将思考反馈移入正文三点动画，并按后续反馈加入整体限高和“在这里继续”的同问答跨选区引用。这些续改未追加测试或自动化浏览器检查，本轮浏览器预览 UI 已由用户验收通过；当前 Webview 类型与预览构建结果见上项 Models。续改前修正 Vitest 的 worktree 源码解析后，15 文件／73 项测试通过（含 Timestamp 7 项），另有 Host 子代理 8 项通过；此前各层类型、文件预算与公共 UI 包构建结果均不能背书当前续改。早期依赖 junction 指向旧公共包产物的组件结果无效。预览服务保留供用户体验，模拟不代表真实 Host 或模型验收，未打包 VSIX、安装或连接真实后台。

- Composer 菜单对齐：主输入框左侧模式菜单改为左对齐，右侧模型／上下文菜单右对齐；消息编辑栏右侧模式菜单保持右对齐。未改变菜单内容、宽度或选择行为；`typecheck`、`lint:budgets` 与现有 ComposerControls 1 项交互测试通过，未新增样式断言，未进行真实页面验收。

- 补全诊断：9 个文件共 208 项定向测试有通过结果，覆盖返回正文分片、具体过滤规则、请求复用不匹配、Next Edit 结果／采纳／失效与远程投影；`typecheck`、`lint:budgets` 通过，最后映射调整仅重跑受影响的 2 文件／29 项及扩展类型与预算检查。未调用真实模型、发送线上测试遥测或进行编辑器验收。主工作区其他未提交补全改动保留，诊断修复使用独立任务分支；本轮合并与安装见交付说明。
- 聊天间距：主聊天与 BTW 的消息区底部及输入框外层顶部固定留白归零，主聊天末条消息的分隔间距与状态区外层底部留白一并移除；保留输入框内部边距、虚拟列表占位和新提问置顶的动态留白跑道。`typecheck`、`lint:budgets` 与滚动／阅读锚点／历史分页 3 个测试文件共 13 项通过；未进行真实页面验收，本轮合并与安装见交付说明。

- 遥测与完整 UI 集成：核心 5 个文件／32 项、页面与业务操作 15 个文件／95 项均有通过结果。页面初跑两个失败来自缺失 connectionId 及泄漏的测试夹具，已修正并仅重跑受影响文件；队列聚合与分类表调整后仅重跑对应 2 文件／18 项。打包内类型检查首次发现测试夹具类型断言，修正后复用已通过的公共 UI 类型检查，续跑其余类型、预算与生产构建，再由同一 vsce 归档器生成完整包；171 个 VSIX 条目、依赖与入口校验通过。UI 修复分支已集成至 `c2156f6f`（9 个提交，含逐题 AskUser）。没有真实模型调用、自动化执行、线上测试遥测或本轮浏览器验收。

- 本轮诊断修复：回合终态核对 7 项、热更新 4 项、GA4 失败分类 4 项，共 3 个文件／15 项定向测试，以及类型检查和文件预算通过。首次类型检查中的测试枚举类型问题已修正，复用已通过的测试结果。未打包安装，未进行真实模型调用、线上遥测发送或编辑器验收。

- Browser Dev Client 设置／模型管理入口已接入浏览器内导航，管理页按 URL 选择初始子页，不再由 Host 默认的 Missions 覆盖。5 项入口回归、`typecheck` 与 `lint:budgets` 通过；本次 browser-use 连接超时，尚未完成真实 Host 页面点击验证。只改调试端源码，未重新打包或安装。

- 本机 Automations 详情迭代：最终 `package:vsix` 内的类型检查、文件预算、公共 UI 与生产构建通过；`verify:vsix` 通过 171 个归档条目、依赖与扩展入口校验，Microsoft VS Code CLI 安装成功。定向检查曾因公共包未构建、配置快照引用及旧提示／UI 查询断言失败，修正后追加了定向重跑，最终 UI 复查 5 项通过；此前“未复跑测试”的记录不准确。不将旧版 403 项通过套用于本轮；未追加真实页面验收，真实调度、权限接管与页面行为留给用户体验，本轮未运行真实任务或调用模型。

- SDK 升级：`typecheck`、`lint:budgets` 与 14 个定向测试文件／570 项通过，覆盖权限、压缩／交接、历史证据、Bridge 及 daemon 连接／恢复。最终 VSIX 171 项内容／入口校验与 PR #22 的必需 CI 已通过。未运行真实模型调用、重启 daemon 或追加浏览器验收。

- 历史分页：main 已固定顶部加载提示的最小高度，避免出现／消失改变列表布局；导航动画期间不自动抢占分页，顶部上滑手势仍能加载历史。分页优先按已挂载消息一次对齐，加载期间继续滚动会更新阅读锚点，稳定回调依赖避免补偿被无关渲染取消。本轮 3 个文件／8 项定向检查、`typecheck`、`lint:budgets` 通过；本地试用 VSIX 已构建、通过 171 个归档条目及入口校验，已安装到 VS Code 和 Cursor。尚未在真实页面确认闪屏消失，未正式发布。此前分页的真实 daemon 1.2.0 读取覆盖 129 MiB、121 页／12,090 条，原始 ID 和顺序一致，新增消息后旧游标续读亦一致；该历史证据不作为本轮界面验收。

- `0.8.20` AskUser 修复：2 个定向测试文件共 28 项、`typecheck` 与 `lint:budgets` 已通过；真实页面点击验收留给用户，未将单元测试视为编辑器验收。发布构建与渠道结果以该版本 Actions 记录为准。

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
- Review 长列表：已修复 PR #24 CI 再次暴露的旧滚动复位故障；原有 2 项长列表用例、公共 UI 类型检查及文件预算通过，未放宽断言。PR #24 必要 CI 已通过并合入 main，真实页面效果尚未验收。
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

- Factory CLI 的 FileLockTimeout 与 Factory Desktop 的 SpaceSync EPERM 属于上游客户端，当前本仓未修复；
  锁触发客户端及同步文件占用者未确定，不能将恢复存储修复当作这些告警已解决。
- 自动恢复不能代替 CLI 登录、安装或协议升级；这些明确的不可用状态保留人工处理入口。没有已知会话 ID 时不自动新建聊天；后台身份不确定、仍有待答权限或正在执行的任务时，不强制迁移 IDE。
- 常规问答 BYOK 目录的未提交修改仍暂停，未进入本次包。
- 同一工作区目前只允许一条执行；多聊天可以打开，等待状态提示与并发架构没有在本次改变。
- SDK 0.10.0 没有独立压缩推理强度。能力是否可配置应按具体操作契约核对。
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
