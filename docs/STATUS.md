# 当前状态

最后更新：2026-09-05
包版本：`0.8.0`

## 总结

主聊天、新版 Mission Control、实时子代理只读对话、真实浏览器联调和统一
Diff 审查链路已经接通。`0.8.0` 把本地恢复升级为 Conversation canonical
Store：Reload 先精确恢复最后 durable 可见状态，daemon history 只追加或补全；
Cursor 内真实行为和视觉仍以用户验收为准。

### 过程区与有界工具结果（设计已确认，正式文档待审阅，尚未实施）

- 用户已分段确认：答案优先，思考与相邻探索按连续过程分段；以中性 Activity 摘要
  表达真实状态，展开后按原顺序区分思考与工具，仅有有效详情才提供二级展开
- 新增结果片段限定 Read、Grep、Glob、LS，采用现有工具记录内的可选小型数据，
  随本地 Conversation 有界保存；单条 8,000 文本单位/120 行、总量 128,000 文本单位
  是已确认的初始预算，尚无动态性能结论；优先裁剪片段，不额外挤掉答案
- 状态与详情可用性分开：等待确认不能误写为等待模型，单个工具失败不代表整轮失败；
  历史缺失、截断、预算淘汰不伪装成空结果，主动淘汰的片段不得被历史反复填回
- 静态检查确认现有普通成功 tool_result 文本在 Runtime 归一化时未保留，历史投影
  同样主要保留完成状态；命令 outputTail 的恢复剥离是现有明确规则，本设计不改变它
- 生产 filePath 主要表示修改文件，Read 目标通常在 target；读取来源需明确提取，
  不能直接以模拟场景字段或自由文本摘要替代。待确认交互已有独立状态来源，当前
  过程标题尚未接入有关事实；这些都是未实施设计要解决的边界
- 本设计只更新 DESIGN、PLAN、STATUS，没有修改本功能的产品代码、测试、场景或配置，
  没有运行本功能验证。用户随后授权将已有 UI 改动与设计文档一并做本地 checkpoint
  提交，不包含远端推送或安装；已有 UI 验证结果不能作为本设计已完成的证据
- 下一步仅为用户审阅正式文档；代码实施及验证范围仍需另行批准。网页/MCP 结果、
  完整日志仓库、SDK 升级及两份报告的其他整改不在本次范围

### 主聊天体验改造（已安装，待真实交互验收）

- Thinking 与相邻探索从第一项稳定成组，不再因字数、行数或工具数量突然拆分；
  展开选择保存在当前消息列表范围，详情按需挂载，虚拟列表返回后保留选择
- 组内直接显示思考正文，保留超长内容分块限制；当前活动、并发数量、失败、中断和
  推理截断使用真实状态，停止后不继续循环，也不显示伪造的累计墙钟耗时
- 过程区展开/收起使用连续高度过渡；查看详情暂停尾部跟随，虚拟列表只为视口上方
  的完整回合补偿高度，避免可见回合内部展开造成阅读位置跳动
- 正文和展开中的思考采用新增普通文字轻淡入；复用原 Markdown、安全链接、高亮与
  defer，不增加打字队列；代码、公式、表格等保留原来的呈现方式
- Composer 底部控件统一为 26px 高，模型名和 effort 在同一文本区域截断；Effort
  改为在模型菜单内切换，保留返回入口，不向窄侧栏外再叠加子菜单
- 次要文字操作 hover 不再统一铺底色，Copy 成功预留宽度，Regenerate 的 busy
  状态保持标签尺寸；权限区域、普通诊断和 AskUser 结果减少重复容器，授权范围不变
- 正文引用保留语义与正常字号，移除默认竖线和灰字；代码块标题栏与内容共享表面
- Light 改为近白中性色，Dark 改为 charcoal；Auto 继续使用编辑器变量，并补齐
  深色回退、输入表面及高对比边界，保留主题更新与 Portal 同步链路
- 最终版本已通过 `pnpm run typecheck`、`pnpm run lint:budgets`、`pnpm run build`
  和 `git diff --check`。未运行测试套件、浏览器 smoke、截图或真实 Cursor 动态验收；
  用户随后授权安装，`package:vsix` 与 `verify:vsix` 通过（75 项），Cursor 已确认
  安装 `droidvisx.droidvisx@0.8.0`；待 Reload Window 后验收，未远端发布

### AskUser 问答记录（已实现与静态验证，尚未安装）

- 结果改为单层 1px 中性边框，每组依次显示 `AI`、完整问题、`我`、回答；
  多组细线分隔，移除 Answers 标题及圆点，正文保留换行并自然折行
- 完整问题已接通 Host 实时回执、Bridge 校验、历史 questionnaire 解析、
  assistant-ui data part 与恢复持久化，并计入 transcript 文本预算
- 旧记录继续可读；主题与回答匹配时由原始历史补齐缺失问题，不覆盖已有原文；
  确实缺失时显示说明，不用主题冒充完整问题
- Studio 新增 `Answers` 场景，可通过 `?scenario=ask-user-result` 刷新复现；
  已检查 Light 480px、Dark 320px、Auto 400px 的边框、角色顺序、纵向排版、
  换行和横向溢出，截图使用模拟数据；Auto 只验证 Studio 模拟的编辑器深色变量
- 7 个相关测试文件、96 项测试通过；首轮两处旧预期未包含问题字段，更新后复跑通过。
  `pnpm run typecheck`、`pnpm run lint:budgets`、`pnpm run build` 与
  `git diff --check` 通过；未跑全量测试、未重新安装扩展，真实 Cursor 待验收。
  后续干净目录打包验证见下节

### 本轮 UI checkpoint（源码保留，尚未推送或安装）

- 普通权限请求合并为单层卡片，统一操作区；更多授权选项保留原始值与范围，并支持
  键盘导航和关闭。PermissionAllowGroup 单独承载菜单，不改变授权决定
- 终端摘要缩至 30px，命令菜单采用紧凑行高和主题表面，右边缘对齐终端卡；复制使用
  固定图标反馈，成功后显示勾号，不切换可见标签宽度
- 历史提示恢复细边框与信息图标，纯诊断不显示回复工具栏；队列暂停改用暂停图标，
  Composer 聚焦边框降低对比变化。回复图标及设置动效见下节
- 用户授权整批本地 checkpoint，不作为视觉已验收或可发布安装的声明。整批源码在
  设置动效完成时已通过类型与文件预算检查；最终批次未跑测试、生产构建或自动浏览器验证，
  提交前不额外运行这些检查

### 回复操作栏调整（源码实现，待用户验收）

- 正常回复结束后操作栏常驻，Copy、Regenerate、Fork 改为固定 24px 的纯图标按钮；
  保留悬停说明、键盘焦点和可访问名称，复制成功以原位勾号反馈 1.5 秒，
  Regenerate/Fork 等待期间使用同尺寸转圈并禁用重复点击
- 整段回复复制等待剪贴板写入成功后才显示勾号；仅最新回复提供 Regenerate/Fork，
  纯诊断与只读子代理对话仍不显示回复操作栏
- 本轮 UI 归入用户授权的本地 checkpoint，尚未推送或安装；用户自行检查预览，
  未运行最终批次测试、构建或自动浏览器验证；设置动效调整时类型与文件预算检查通过

### 设置选项动效（源码实现，待用户验收）

- Mode、Autonomy、Theme 统一使用 180ms 的高度与透明度过渡，箭头同步旋转；
  保持原有尺寸、颜色与选择逻辑，不添加弹跳或逐项延迟
- 选项保留挂载以支持收起过渡，关闭时通过 inert 与 aria-hidden 排除交互和辅助技术访问；
  系统开启减少动态效果时关闭过渡
- `pnpm run typecheck` 与 `pnpm run lint:budgets` 通过；未运行测试、构建或浏览器验证，
  随本轮 checkpoint 保留，尚未推送或安装，实际视觉由用户检查

### 审查与跨电脑接续

- 两个 heavy worker 均正常完成报告：`ARCHITECTURE_SDK_REVIEW.md` 与
  `RUNTIME_CORRECTNESS_REVIEW.md`。没有生产代码整改；合并去重后列出 9 个静态
  判定缺陷（2 P1、7 P2），候选与架构建议另计，尚未动态复现。审查基线为 `a29dec1`
- 官方 SDK 已对照安装版 0.7.0 的公开声明、关键发布实现和文档；未取得完整原始
  TypeScript 实现源码，最新 npm 版本未确认，不能宣称全仓/SDK 全量审计通过
- 为换电脑接续，已仅从 Git 提交 `0d49192` 导出源码到不同路径的空目录，使用
  Windows、Node 24.13.1、pnpm 10.2.0 执行 `pnpm install --frozen-lockfile`，
  类型/预算检查、生产构建、VSIX 打包及 75 项 inventory 校验全部通过；未安装扩展
- 首次干净目录 VSIX 校验发现本次导出的临时 source.tar 被额外打包，移除该测试产物
  后复验通过，未修改业务代码。pnpm 安装脚本提示、package.json 缺 repository 字段及
  缺 LICENSE 文件的打包警告仍存在，本次未阻断验证
- 根 README 已包含新电脑配置、安装、静态预览和 Git 不迁移的数据范围；
  锁文件、源码和开发入口可重建，不上传 node_modules、dist、VSIX、凭据、真实历史或缓存。
  本机认证、个人路由/工具和 Cursor/Droid 本地数据仍需在新电脑另行处理；未验证其他操作系统

### 可靠性、安全与维护性

- 共享 Daemon 在解析并校验真实 listener PID 与 Droid daemon 命令身份后，才允许
  读取凭据并执行认证连接；Session Lease 仅把缺失文件视为空表，损坏或不可读状态
  fail closed
- Daemon 模式在扩展激活时预热共享 Sidecar；子进程提前退出会立即停止 listener
  等待，失败后最多后台重试一次，复用 daemon 的健康检查连接直接交给 Runtime
- Recovery Store V2 以产品 Conversation 为 owner，显式保存 root、fork、rewind、
  compact 和 handoff lineage；Compact/Handoff 更换 backend Session 时不拆分可见对话
- Display Snapshot、active logical Turn 和 managed image artifacts 在 early paint 前
  恢复；缺失图片保留原行和顺序并把 history 标记为 partial
- settled changed files 由 logical Turn ledger 独立持久化；Review、Restore、Git
  status、commit 和 Webview draft 不再依赖 transcript 中是否保留 Changes row
- Recovery Store 与 Turn Snapshot Store 只在 durable write 成功后确认 revision；
  同步 throw、异步 rejection、flush、dispose 和后续重试使用一致失败语义
- recovered turn 只有最终 history 可用且 reconcile 完成后才进入 completed；Process、
  Daemon replacement/close 和 Browser Dev startup 都有明确的临时所有权、取消与回滚
- Review queue 的共享 tail 始终可继续；Watcher 最多一个 running 和一个 pending
  refresh，按 affected path 选择性刷新，baseline 变化时以最多 6 并发全量重算，
  Branch open/replay/explicit refresh 保持一次 Runtime diff 语义
- 用户面板、session replacement 和 turn dispatch 使用语义化 operation eligibility；
  两个 Bridge 方向使用 union discriminant 约束的 typed parser registry，未知、
  prototype-named 和 inherited type 均在信任边界拒绝
- Navigator 与 Sticky Question 共用 1px question-entry helper；bottom ownership、
  overflow、push-off、follow 和编辑固定行为保持独立
- `package:vsix` 只调用 vsce；`vscode:prepublish` 只调用一次
  `package:prepare`，后者依次执行 typecheck、budgets 和 production build；
  `verify:vsix` 同时校验精确 inventory 与 manifest name/publisher/version

## 已接通

### 聊天与会话

- 新建、恢复、切换、重命名、Fork、Compact 和 Rewind
- New、Fork、Rewind 创建独立 Conversation；Compact 和 Spec Handoff 在同一
  Conversation 内采用 successor backend Session，Sessions 目录按 Conversation 去重
- Reload 首屏直接使用 canonical Display Snapshot；daemon history 只能 enrich
  已有行或追加可信的新 Turn，不能删除、替换或重排关闭前可见内容
- 顶部 Header 仅显示 `Droid` 和连接状态点；完整 Runtime 与 Mission 状态通过
  tooltip 和无障碍文本保留，不再占用可见工具栏空间
- 初始化、Reload 和 Sessions 目录中的已有 Conversation 切换使用同一套 Droid
  3×3 循环信号：快恢复不闪屏，checkpoint 可先更新过场后的真实 Transcript，但
  完整过场持续到 Runtime connected 且 Composer 具备发送前置条件
- 完整过场只覆盖 Conversation 区域，保留旧 Transcript 作为切换背景；失败后停止循环
  并保留最后可信 Conversation 与草稿；New、Fork、Rewind、Compact/Handoff 不触发
  本过场，Reduced Motion 使用静态点阵
- daemon 历史加载、本地恢复检查点和长会话虚拟化；问题导航与顶部吸附问题使用
  同一像素边界判定
- 下一条用户问题接近顶部时，会在自然滚动中逐像素推走旧吸顶问题，再接管为新的
  吸顶副本；吸顶卡与正常消息复用同一 760px 内容宽度，列表占位、Navigator
  边界和编辑中的固定问题保持不变
- 流式文本、Thinking、Tool 生命周期、Stop 和排队消息
- `Droid is working/responding` 使用紧凑的 3×3 点阵，按中心、十字、四角向外
  扩散并淡出；静默活动和减少动态效果模式显示静态点阵
- 草稿恢复、历史消息复用、编辑重问和回答重新生成

### 交互与输入

- 权限请求、AskUser 和 ExitSpecMode Plan
- 文件、图片、PDF、活动编辑器、选区、Problems 和 Git changes 附件
- 主 Composer 与历史编辑卡支持选择、粘贴和拖入图片、PDF、可读文本、编辑器 URI
  及公开 HTTPS 图片；落点决定进入主附件区或编辑重发附件区
- 待发送图片支持缩放、平移和红色自由笔标注，保存后原位替换 Host 持有的发送字节；
  GIF 和动态 WebP 只预览、发送，不进入标注
- Slash commands、文件提及和选区加入聊天

### BTW 旁问

- 右侧使用可拖拽宽度的轻量旁注流，回答继续支持 Markdown、代码和长文本
- 输入框自动增长到三行，Enter 发送、Shift+Enter 换行，排队问题贴近输入区；聚焦时
  使用输入容器的中性边线，不继承编辑器主题的彩色 textarea 轮廓
- 主对话正文选区提供 `Add to Chat` 和 `By the Way`，均只预填引用、不自动发送
- 同一主对话内关闭只隐藏并保留旁问上下文；切换主对话或 Reload 后清空

### 展示与 IDE 集成

- 安全 Markdown、代码高亮、KaTeX、Mermaid 和图片预览
- Tool 文件路径、原生 Diff、Changes ReviewDock 和 Git commit
- Canvas HTML 预览、代码、Diff、元素选择和反馈回 Composer
- 只读终端镜像和 Session Viewer
- 子代理 Task 卡实时摘要，整卡打开每 child 独立只读 Editor
- 子代理完整文本、Thinking、Tool 进度/结果、图片和明确生命周期

### Diff Review

- Latest Turn、Workspace 和 Branch 只在 ReviewDock 内切换文件列表；点击 Review
  直接打开当前待审文件并复用一个 Cursor 原生 preview Diff，文件行或 Previous /
  Next 继续切换当前 Diff
- 后续纯聊天回合不会清空最近一次实际改动的 Latest Turn Dock；新的 settled 回合
  仍会替换它；Commit 只在当前查看该 Latest Turn 时出现，失败后重新读取 Git
  状态并移除已不存在的选中文件，Conversation 切换按各自 Turn ledger 隔离
- 实时 Changes 继续投影到 Host transcript；已打开的 writing Review scope 会随新增文件
  在同一 scope 身份内刷新。turn 结束后，包含空文件集的 logical Turn settlement
  必须 durable 才发布 settled Review 和 Changes；Host snapshot 通过 `latestChanges`
  只暴露最新 canonical DTO，不暴露完整 ledger
- Latest Turn 缺少完整 before/after snapshot 时，使用已记录的文件清单回退到
  HEAD ↔ Working Diff；该回退只读，不提供 Restore
- 历史 Changes、Workspace 和 Branch 使用同一 ReviewDock；Branch 明确显示
  base branch 和相对该基线的 commit 数，无法建立可靠基线的文件降级为 Open only
- Scope 切换会立即选中目标并显示 Loading，直到匹配的 Review state 或打开失败结果抵达；
  Scope 标签只切换文件列表，不自动打开原生 Diff。点击 Review、历史 Changes、文件行
  或 Previous / Next 才会显式打开当前 Diff；Host 以最多 6 个并发文件版本读取投影
  Review state，Branch commit 数随该 state 一次读取，不再触发重复 Git diff 请求
- reviewed 只由明确按钮产生，按文件版本持久化；当前 Session 最近打开的 scope
  在 Reload 后重建并验证版本，文件再次变化时显示 changed-after-review，不计入完成率
- Review 的 More 菜单作为按钮上方的悬浮层打开，不改变 Dock 或控制栏高度
- Turn 提供 Restore file / Restore turn 双重预检；展开的文件清单保持路径和
  created 标记可读。Canonical settlement 决定 Review 和 Restore 的路径/统计，
  before/after tree 及 snapshot path metadata 决定 Restore 是否可用；未保存编辑、after-state
  不匹配或快照缺失都会阻止写入，整 Turn 任一冲突则全部不写；操作成功或 preview
  已失效后会清除旧确认状态
- Tool 明确命名的 Git ignored 文件也会进入 before / after 精确快照，可正常
  Diff 和 Restore，不再被误判为快照缺失
- ApplyPatch 的 Add、Update 和 Delete 路径都参与实时 ledger 与 pre-tool baseline
- 整 Turn 恢复使用恢复日志和失败回滚；扩展启动时会继续处理未完成恢复日志
- 原生 Diff 左右两侧选区均可通过 `Add Selection to Chat` 回主 Composer，
  引用携带 before/current、文件和 Review scope 身份；历史 Session 的 Diff
  选区不会附加到当前聊天
- Agent Review 仅用于 Workspace / Branch Git scope，通过独立公开 `/review`
  Session 运行；结果使用只读 Session Viewer，不混入主 Session transcript，
  也不改变 reviewed 状态

### 设置与扩展能力

- Mode、Model、Reasoning、Autonomy、Context
- Skills 浏览与启停
- MCP Server 浏览、启停、添加、删除和认证
- 自定义 Provider 与模型
- Light、Dark、Auto 三主题
- 本地日志与诊断导出

### Mission Control

- Mission Control Editor 只保留目录、筛选和刷新
- Mode 菜单、New Mission 和目录项把内容带回原 DroidVisX 聊天区；`/mission` 不触发
- Auto 等普通模式不会因后台 Mission 状态投影自动展开右栏
- 产品状态分为普通 Session、Mission Draft 和 Mission Active，底层复用单一 ChatController
- Mission 有自己的 Orchestrator 对话且不进入普通 Sessions 目录，task 是第一条消息
- Start、当前 Mission 和历史 Mission 都会打开对应对话与运行详情
- 关闭 Mission 优先恢复进入前的普通 Session；选择普通 Session 会关闭右栏但不停止后台 Mission
- 原聊天区复用完整聊天和 Composer，右侧复用 BTW 分栏外壳
- 右栏在 280–320px 宽度使用单列配置、纵向执行摘要和明确文字状态
- 完整角色、模型、推理、质量设置与官方 readiness 警告确认
- Mission 目录恢复、真实进度、Feature、Worker Viewer 和 Validator 状态
- Pause activity 中断当前 Orchestrator 活动，Resume 发送恢复指令
- Stop feature 使用官方 `sessions.killWorker()`，不虚构控制能力
- Mission 内容不再创建第二个聊天 App 或第二套交互表面

### 子代理只读对话

- daemon 复用同一 SDK controller 的原始通知事件，不创建第二条连接或第二个 ChatController
- process 模式从当前 Session 原始通知接收 child 事件
- child Session ID、Registry 和 Transcript Store 始终留在 Runtime/Host
- 历史用于初始化、Reload 恢复和 terminal 最终对齐；运行更新不依赖 2.5 秒轮询
- Task 卡与 Viewer 消费同一 Store，多个 child 使用独立 Editor 标签页
- resumed Task 可共享同一 child transcript，每张父 Task 卡仍保留独立打开映射
- Viewer 复用主聊天消息、Thinking、Tool 和图片组件，无 Composer、Diff、Stop 或写操作
- Viewer 使用与主聊天一致的 Cursor 版心；每条实时 Task Invocation 都立即显示委派摘要并可展开原文，且按真实消息边界拆分探索活动
- Webview 只能按父 Session、Turn 和 Task `toolUseId` 请求打开，Host 校验后解析 child

### 真实浏览器联调

- `DroidVisX: Start Browser Dev Client` 从机器级
  `droidvisx.browserDev.sourceRoot`（开发 Host 可回退到扩展源码目录）启动
  Vite 和本机 Bridge；当前 workspace 独立作为真实 Runtime cwd，`/live`
  一次性连接 URL 写入剪贴板供隔离的 `agent-browser` 会话打开
- `/live` 直接渲染生产 `App`，与 Cursor 侧栏共享唯一 `ChatController`、当前
  Session、真实 Runtime 和全部现有操作
- Host 增量同步给浏览器和侧栏；每个客户端 Reload 使用定向 Snapshot，不让另一端
  重复重放
- Browser transport 继续使用共享 Bridge DTO 和 Host 校验，不包含 Droid SDK、
  Runtime 或 Extension Host 代码
- Bridge 只监听 `127.0.0.1`，使用每次启动生成的临时令牌并限制固定 Vite Origin
- `DroidVisX: Stop Browser Dev Client`、扩展停用或 Cursor 窗口关闭时停止 Bridge
  与本次启动的 Vite
- 原有 `pnpm run dev:webview` Studio 继续提供 fake scenario 视觉预览，与真实
  `/live` transport 分离

### 能力展示

- 插件面板目前以读取状态为主
- 子代理只展示公开通知和持久化历史能证明的内容，不构造团队树
- Context 使用 daemon 官方 Context Breakdown 的 `usedTokens`、`freeTokens` 和
  `contextBudget`，百分比与 Droid CLI 状态栏一致；Process 模式没有同等来源时显示不可用

## 不可用或受限

- Session Delete，没有稳定公开 API
- Undo All，没有安全的统一语义
- 完整账号、用量、组织策略和更新管理
- MCP resources / prompts 的稳定发现接口
- 后台进程和 Worktree 的完整生命周期控制
- 跨设备会话和远程环境
- Mission 目录只恢复当前工作区会话目录中可验证的 Session

## 当前工作区

- Mission、实时子代理和 Viewer 基线已建立本地 checkpoint
- 测试套件已删除纯 UI、样式、格式化和自证型用例
- 打包不再自动运行测试
- 真实浏览器联调通过本机 Bridge 与 Vite 启停、双客户端 boot 和定向 replay 验证
