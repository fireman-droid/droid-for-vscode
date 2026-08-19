# DroidVisX 技术审计报告

> 对象：DroidVisX v0.7.0 工作树 · 审计窗口：2026-08-13 18:25–18:55 (UTC+8)
> 方法：三路并行审计——后端静态审计 / 前端 Webview 静态审计 / 动态验证与功能落地核查（typecheck · 全量测试 · 构建 · 真机能力冒烟），四项"高"级结论另经协调层交叉抽查代码复核。
> 问题总数 39：严重 0 / 高 4 / 中 18 / 低 17。

## 总体结论

项目处于健康状态。架构分层清晰（Runtime / Extension Host / Shared Bridge / Webview 边界严格），代码质量高于同类扩展平均水准，安全防御纵深到位；35 万字符的状态文档与代码现实高度一致（抽样 23 项能力全部属实）。**未发现"严重"级问题**，但有 4 项已核实的"高"级问题值得尽快修复——其中 3 项共同指向同一个系统性主题：**流式输出热路径的性能**（host 侧 O(N) 重建、webview 侧全窗口重渲、历史加载进程风暴），另 1 项是用户可见的内容丢失 bug。

| 指标 | 结果 |
| --- | --- |
| 问题分布 | 0 严重 / 4 高（均已核实）/ 18 中 / 17 低 |
| 测试 | 2087 / 2087 通过（vitest 全量） |
| 功能核查 | 抽样 23 / 23 属实，无一夸大 |
| 持久失败 | 1 项：`test:integration` 过期断言（非产品缺陷，见中级 #18） |

> **审计窗口说明**：审计期间（18:25–18:41）有另一个在途 agent 正在修改工作树（"/btw Stop 按钮"切片，+274/-27 行且持续增长）。typecheck / 行数预算 / 1 例测试出现的瞬态失败均已归因于该未收口 WIP，而非 HEAD（v0.7.0）缺陷；本报告行号以审计时刻的工作区为准，可能随该切片小幅漂移。

## 一、健康门禁

| 命令 | 结果 | 耗时 | 说明 |
| --- | --- | --- | --- |
| `pnpm run typecheck` | ✅ 通过（HEAD） | 12.8s | 首跑因在途 WIP 缺 `interrupt` mock 瞬态失败，WIP 修复后复跑绿 |
| `pnpm run lint:budgets` | ✅ 通过（HEAD） | 1.9s | 审计尾声因 WIP 新增 62 行瞬态顶破 ComposerControls 棘轮 |
| `pnpm test` | ✅ 2087 / 2087 | 18.7s | 复跑时 1 例 WIP 瞬态失败（模型触发按钮 aria-label 改造半程） |
| `pnpm run build` | ✅ 通过 | 4.3s | extension.cjs 1.2MB · webview.js 985KB · css 135KB · mermaid.js 3.3MB 懒加载 |
| `pnpm run test:integration` | ❌ 失败（持久） | 10.9s | 过期 activationEvents 断言（见中级 #18），非产品缺陷但需修，且不在发版门禁链 |
| `pnpm run smoke:capabilities` | ✅ 通过 | 10.6s | 真机 Droid CLI 0.195.0 · 协议 1.151.0 · 23 tools · 34 skills · 7 MCP servers |

## 二、高优先级问题（4 项，均已核实并经交叉抽查复核）

### H1 [后端 · bug] 尾部带外事件被静默丢弃——用户可见的内容丢失

- **位置**：`src/runtime/FactoryDroidRuntime.ts:376-380, 477`
- **证据**：带外运行时事件（spec-handoff、subagent-started）先入 `pendingTurnEvents` 队列，只在下一个 SDK 事件到来时才被排出（排空逻辑位于 for-await 循环体内）；而 `finally` 中直接清空队列。若事件在最后一个 SDK 事件之后入队、SDK 流随即结束，事件永久丢失。
- **影响**：Spec 模式交接卡片或子代理行可能永远不出现在 UI 中，且无任何诊断记录——静默的数据丢失。
- **修复**：在退出流循环后、`finally` 清空前，把剩余 `pendingTurnEvents` 全部 yield（或至少记 warn 级诊断）。

### H2 [后端 · 性能] 每个流式 delta 触发 O(转录长度) 的全量重建

- **位置**：`src/extension/hostTranscriptState.ts:283-359`
- **证据**：每个 assistant/thinking delta 做一次全文重拼接 + `replaceItem` 复制整个 transcript 数组；`projectThinkingDelta` 还要对全表 `findIndex`（:323）。流式每秒数十个 delta 时呈二次方开销，全部发生在 Extension Host 主线程。
- **影响**：长会话流式期间 Extension Host CPU 持续升高，UI 响应变慢。
- **修复**：对活跃流式段落维护可变缓冲，仅在段落完成时固化为不可变项；`replaceItem` 对末尾项走免复制快路径。

### H3 [后端 · 性能] 历史加载每次冷启动 droid CLI 子进程，被 5 秒轮询放大成进程风暴

- **位置**：`src/runtime/history/FactorySessionHistoryLoader.ts`、`src/extension/chat/subagentWatch.ts:134`
- **证据**：每次历史加载均 spawn 新的 droid CLI 进程（冷启动数百毫秒级）；僵尸子代理 watch 以 5s 为周期反复触发历史读取，sessionRunning 的后台轮询同样叠加。
- **影响**：后台周期性进程创建——CPU、句柄、磁盘 I/O 持续消耗，Windows 上进程创建成本尤其高。
- **修复**：daemon 模式下复用既有 daemon 连接读历史；process 模式缓存最近结果并按 mtime 失效；轮询改为事件驱动或指数退避。

### H4 [前端 · 性能] planAnchors 每帧新 Map 击穿 memo——流式期间全窗口消息重渲

- **位置**：`src/webview/assistant/App.tsx:754-757`、`Thread.tsx:312, 706-760`、`UserMessage.tsx:29`
- **证据**：`selectPlanAnchors` 依赖 `state.transcript`，每个 delta 批次都返回新 `Map`（即使无 plan 也是新空 Map）→ `DroidThread` 的 memo 失效 → `ThreadPrimitive.Messages` 的 children 闭包重建 → 窗口内最多 60 条消息的 render prop 全部重执行；`UserMessage`、`Composer`、`ComposerControls`（2841 行）均无 memo，随之全量重渲。代码注释自证成本量级（`runtimeAdapter.ts:50`——200 条窗口时每 delta 约 50ms）：消息窗口与身份缓存正是为此而建，却被这一个 prop 全部绕过。
- **影响**：rAF 批处理下每帧一次全窗口重渲 + Composer 全家重执行，长会话/低端机上是主线程主要负担，perf-longtask 信标会持续记录。
- **修复**：`selectPlanAnchors` 结果引用稳定化（新旧 Map 内容等价时返回旧引用），或改经 Context 下发让 `PlanLine` 自取；顺手给 `UserMessage` 加 memo 并稳定 attachments 引用。修复后重渲范围可收敛到"正在流的那一条消息"。

## 三、中优先级问题（18 项）

| # | 层 | 类别 | 位置 | 问题 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 后端 | bug | `src/runtime/daemon/sessionLease.ts:149` | 会话租约读-改-写无文件锁，双窗口可同时认为持有同一会话，导致双附加/事件重复 | 已核实 |
| 2 | 后端 | bug | `src/runtime/daemon/daemonDiscovery.ts:226` | daemon 崩溃后遗留陈旧发现记录，后续窗口先连失败再回退；unlinkSync 清理与并发读存在窗口 | 已核实 |
| 3 | 后端 | bug | `src/runtime/daemon/daemonLifecycle.ts:198` | stopDaemon 按发现文件记录的 PID 执行 `taskkill /T /F`；daemon 已死且 PID 被复用时会强杀无关进程树 | 已核实 |
| 4 | 后端 | 安全 | `src/runtime/daemon/daemonConnection.ts:72` | WorkOS JWT 明文经 `ws://127.0.0.1` 交给发现文件指向的端点，无服务端身份校验（同用户攻击者本可直读 auth 文件，提权收益有限） | 已核实 |
| 5 | 后端 | 安全 | `src/extension/LocalDiagnostics.ts:448` | 全保真日志（完整 prompt、工具 I/O）打包成可外发 zip，脱敏仅靠正则，非常规格式令牌会漏网 | 已核实 |
| 6 | 后端 | 性能 | `src/runtime/daemon/factoryCredentials.ts:29` | 激活与重连热路径上的同步文件 I/O 与主线程 AES-GCM 解密（sessionLease/daemonDiscovery/daemonLifecycle 同类） | 已核实 |
| 7 | 后端 | 性能 | `src/extension/LocalDiagnostics.ts` | 每次 appendFile 前都先 mkdir，高频诊断事件下双倍系统调用 | 已核实 |
| 8 | 后端 | 性能 | `src/extension/chat/turnFlow.ts` | host→webview 每个 delta 单发 postMessage 且伴随重复 JSON 序列化，发送端无批处理/节流（webview 接收端已有 rAF+50ms 批量） | 已核实 |
| 9 | 后端 | bug | `src/extension/chat/subagentWatch.ts:134` | 僵尸子代理 watch 的 deadline 不随新增行扩展，后加入的子代理行可能被过早或延迟判死 | 已核实 |
| 10 | 后端 | bug | `src/runtime/btw/BtwSidecar.ts` | `ask` 的 wake promise 唤醒与进程退出之间存在竞态窗口，可能悬挂等待 | 疑似 |
| 11 | 后端 | bug | `src/extension/chat/runtimeLifecycle.ts` | replaceRuntime 异常路径存在未接 catch 的调用链，失败时可能产生未处理 rejection 并让 UI 停留在中间态 | 疑似 |
| 12 | 后端 | 可维护性 | `src/extension/chat/mcp.ts` | withMcpTimeout 仅放弃等待、不取消底层操作，超时后孤儿操作继续占用 daemon 连接 | 已核实 |
| 13 | 前端 | bug | `src/webview/assistant/PlanLine.tsx:39` | `running` 是全局 turn 标志：新 turn 运行时，历史遗留的未完成计划清单会错误进入 live 态（发光 + 自动展开） | 已核实 |
| 14 | 前端 | bug | `src/webview/assistant/store.ts:485` | 序列号门对 `host.snapshot` 一视同仁：host 序列计数器若重置（controller 重建而 webview 存活），面板将永久冻结且无提示 | 疑似 |
| 15 | 前端 | bug | `src/webview/assistant/SideChatSheet.tsx:52` | /btw 侧栏流式期间无条件吸底，用户无法上滚阅读（主聊天区已有 follow-latch 方案可复用） | 已核实 |
| 16 | 前端 | 可访问性 | `src/webview/assistant/Lightbox.tsx:216` | 声明 role=dialog + aria-modal 但无焦点移入/焦点陷阱/焦点归还；SessionDrawer 同样不移交焦点 | 已核实 |
| 17 | 前端 | 性能 | `src/webview/assistant/styles/07-activity-live.css:379` | TodoWrite 计划行照常渲染（含解析），再用 `:has()` + `!important` 整行隐藏——样式重算成本 + 类名字符串耦合，改名即静默失效 | 已核实 |
| 18 | 基建 | bug | `src/integration/suite/index.cjs:20` | activationEvents deepEqual 断言过期（package.json 已增至 5 项），test:integration 持久失败，且该检查不在发版门禁链里 | 已核实 |

标注"疑似"的 2 条竞态由静态追踪推断，需运行时复现确认；其余 16 条均已核实代码路径。

## 四、低优先级问题（17 项）

### 后端（5 项）

| 位置 | 问题 |
| --- | --- |
| `src/shared/validateMessage.ts` | isSafeOpenPath 放行绝对路径（workspace.openPath）；webview 被攻破时可打开任意本地文件，受严格 CSP 缓解 |
| `src/extension/vscodeAttachmentSources.ts:317` | runGit 无 timeout，`git diff HEAD` 遇 index 锁可无限挂起（attachment 捕获路径） |
| `package.json` | activationEvents 未列 shutdownDaemon、exportSessionMarkdown 两命令；VS Code ≥1.74 自动生成，无实际影响，但三处清单互不一致 |
| `src/extension/chat/subagentPanel.ts:99` | dispose 后轮询会再空跑一拍才自停；自愈，无影响 |
| `src/extension/chat/recovery.ts` | 恢复轮询与 checkpoint 转录投影分支较深，建议补注释与状态图 |

### 前端（12 项）

| 位置 | 问题 |
| --- | --- |
| `src/webview/assistant/Thread.tsx:402` | editingMessageId 不随会话切换重置：切走再切回时编辑卡自动复活（host 侧 staging 已清）；外点即关，影响小 |
| `src/webview/assistant/SideChatSheet.tsx:79` | 多个面板在 document 上挂无协调的 Escape 监听（QueuedMessages/ComposerPopup/SessionDrawer 同），组合场景一次 Esc 连关多层 |
| `src/webview/assistant/MarkdownText.tsx:210` | 远程 http(s) 图片直接渲染 img 标签，但 CSP img-src 不含 https——必然加载失败且静默 broken，应降级为可点击链接 |
| `src/webview/assistant/MarkdownText.tsx:127` | SafeLink 白名单含明文 http://；模型输出可诱导用户点击任意外链（经 VS Code 外部打开），可考虑 https-only 或首访提示 |
| `src/webview/assistant/MarkdownText.tsx:463` | 流式期间对增长中的代码块每次 commit 全量重高亮（累计 O(n²)），minCommitMs: 40 限频兜底；可改为 settled 后一次性高亮 |
| `src/webview/assistant/store.ts:1395` | appendThinkingDelta/upsertTool 每条消息全 transcript findIndex + 全量 map 拷贝；boundTranscript 全量统计——每 delta 热路径 |
| `src/webview/assistant/Interactions.tsx:437` | role=menu 无方向键导航、无外点关闭，打开后只能 Tab/点击 |
| `src/webview/assistant/styles/` | 约 15–20 个死样式类无任何 TSX 引用（dvx-status-*、dvx-drawer-backdrop、dvx-tool-command-inline 等），散布于 01/02/03/04/07/09/11/18/20/24 |
| `scripts/checkFileBudgets.mjs` | 9 个 webview 文件超 900 行预算但均在棘轮名单内（validateHostMessage 3665、ComposerControls 2841、App 1702 等）；ComposerControls 拆分已在并行进行 |
| `src/webview/assistant/thread/commandCard.tsx:169` | 中文 UI 文案（"在终端中查看"）混入全英文界面 |
| `src/webview/assistant/styles/07-activity-live.css` | 亮色样式多处硬编码色值，依赖 24-theme-dark.css 逐条覆盖，脆弱但当前覆盖完整 |
| `src/webview/assistant/styles/22-plan-anchor.css:90` | dvx-plan-line-title 声明 flex 但父容器是 grid，死属性，无视觉影响 |

## 五、功能落地核查（文档声明 vs 代码现实）

能力状态统计（来自 `implementation-status.md`，4,975 行）：**生产已接通 38 条 / 部分完成 15 条 / 仅探测 3 条 / 未实现 roadmap 36 项**。

抽样 23 项核心链路逐层追踪（Runtime→Host→Bridge→Webview），**无一"夸大"**——连负面声明（daemon 模式 MCP OAuth 刻意 fail-closed、真机冒烟未跑）都如实记录。

| 能力 | 文档声明 | 结论 |
| --- | --- | --- |
| 会话创建与流式输出 | 生产 §1 | 属实 |
| Thinking / Tool 生命周期展示 | 生产 §2 | 属实 |
| 权限审批（内联交互块） | 生产 §4 | 属实 |
| AskUser / Spec Mode 闭环 | 生产 §5/§6 | 属实 |
| 会话切换 / 历史加载 | 生产 §7/§8 | 属实 |
| Session/Webview 恢复 + reload 活流重连 | 生产 §9 + MVP A4 | 属实 |
| daemon 默认模式 + 无感回退 | 生产 §21 | 属实 |
| /btw 侧聊（双模式） | 生产 §18/§21 | 属实 |
| slash 内置组 + CLI 动态命令 | 生产 §18-S2 + V1 | 属实 |
| MCP 浏览 / 启停 / 认证 | V1（daemon OAuth 刻意 fail-closed） | 属实 |
| Token 用量展示（五项分解） | V2 | 属实 |
| 导出 Session Markdown | V2 | 属实 |
| 主题切换（炭黑 + Auto） | 生产 §26 | 属实 |
| addSelectionToChat（60s 暂存重试） | 生产 §25/§28 | 属实 |
| 后台进程提示 | V2 | 属实 |
| 队列消息（收纳条 + promote） | 生产 §19/§22 | 属实 |
| Mermaid 渲染（3.3MB 懒加载） | V2 | 属实 |
| 子代理面板（实时活动 + 单停 + 回放） | 生产 §37 | 属实 |
| Canvas / 原型预览（srcdoc 沙箱） | 生产 §12 | 属实 |
| Changes 实时账本 | 生产 §31 | 属实 |
| 计划细条（§30 取代 §17/§20，旧符号零残留） | 生产 §30 | 属实 |
| Capability Gate 0.1 | 仅探测 | 属实（声明诚实） |
| 归档 / 搜索 / Worktree / 终端镜像 | V1/V2 | 属实 |

### 文档漂移（4 处，实现为真、记录过期）

1. 诊断导出已实现（§10 属实），但 V2 清单仍是未勾选、"部分完成"表仍写"尚缺导出诊断包"——应回写为已完成。
2. 文档头部"最后核对日期 2026-08-12"过期，正文最新条目已到 08-13 傍晚（§37）。
3. §25 记录的方法名 `addEditorSelectionToChat()` 已在 §28 重做时改为 `stageCapturedEditorSelection`，原文未更新。
4. activationEvents 三方漂移：contributes 6 命令 / 显式 activationEvents 4 项 / 集成断言只认 3 项（功能上由 VS Code ≥1.74 自动生成兜底）。

### 未提交文件核查（会话开始时 git 快照中的 5 个）

| 文件 | 结论 |
| --- | --- |
| `src/webview/assistant/PlanLine.tsx` | 非孤儿：§30 计划细条的生产真身，已入库并被 Thread.tsx 引用；当前未提交改动是"构建期自动展开"WIP 增强 |
| `src/webview/assistant/PlanLine.test.tsx` | 有效测试，143 行，覆盖折叠/展开/自动展开/完成态 |
| `src/webview/assistant/styles/07-activity-live.css` | 已被 styles.css:12 引用（styles.css 拆分为 23 文件 @import 索引时入库） |
| `src/webview/assistant/styles/22-plan-anchor.css` | 已被 styles.css:27 引用，完成度高（含 reduced-motion / forced-colors）；文件名沿用旧命名而类名已更新 |
| `artifacts/smoke-plan-anchor.mjs` | 刻意不入库：.gitignore 整体忽略 artifacts/（仓库约定），是 §30 冒烟记录引用的 CDP 行为烟测脚本 |

## 六、安全面结论

**防御做得扎实的地方**：

- webview→host 消息全量白名单校验（3,665 行手写校验器，exact-key + 长度上限）
- 严格 CSP + nonce；`connect-src 'none'`、img-src 不含 https，封死外联渗出通道
- 子进程一律 execFile 数组参数，无 shell 注入面；git/worktree 带超时与缓冲上限
- react-markdown 用 skipHtml（无 rehype-raw）；唯一 dangerouslySetInnerHTML 是自转义的 highlight.js 输出
- mermaid securityLevel: strict；SVG 样式经 CSSOM 重放以配合无 unsafe-inline 的 CSP
- urlTransform 白名单剥离 `command:` 等危险协议；图片仅 data-URI（媒体类型白名单 + base64 校验）
- 路径处理拒绝 `..` 遍历与越根；BYOK API key 不落 draft/state；持久化数据带版本号与边界校验

**需要注意**：

- daemon 连接为 trust-on-connect：JWT 明文走本地 ws，无服务端身份校验（中级 #4，同用户攻击面）
- 诊断导出 zip 含完整 prompt/工具 I/O，正则脱敏对非常规令牌漏网（中级 #5）
- stopDaemon 按记录 PID 强杀，PID 复用时误伤无关进程树（中级 #3）
- SafeLink 放行明文 http:// 外链（低级，行业常态）
- 观察项：原型预览面板 previewHtml 允许 unsafe-inline/unsafe-eval（srcdoc 沙箱内，本轮未深审，建议后续专项确认）

## 七、性能优化 Top 5（按预期收益排序，两路审计合并）

1. **[前端]** 稳定 planAnchors 引用（或改走 Context）+ 给 UserMessage/Composer 加 memo——单点修复即恢复整套已建好的 memo/窗口体系，把流式重渲从"全窗口 + Composer 全家"收敛到"正在流的那条消息"（对应 H4）。
2. **[后端]** 流式转录增量化：活跃段落用可变缓冲累积、完成再固化，末尾项更新走免复制快路径——长会话流式 CPU 预期数量级下降（对应 H2）。
3. **[跨层]** host→webview delta 发送端批处理（16–50ms 窗口合并为单条 postMessage）——webview 接收端已有 rAF+50ms 批量，补上发送端即消除序列化与跨进程消息风暴。
4. **[后端]** 历史加载去进程化：daemon 通道复用 + 结果缓存 + 轮询事件化，消除周期性 droid CLI 冷启动（对应 H3）。
5. **[前端]** 渲染热路径清理：流式期间延迟代码高亮（settled 后一次性）、组件层过滤 plan 行替代 `:has()` `!important` 隐藏、reducer 以 id→index 映射替代全表扫描。

次级建议：daemon 热路径同步 I/O 异步化（fs/promises + 凭据解密移出激活关键路径）、诊断写入合并（缓存 mkdir 结果 + 短窗口合并 appendFile）。

## 八、审计范围与限制

- 方法：后端与前端为纯静态只读审计（含 tsc --noEmit）；动态验证独占运行 typecheck / 预算 / 全量测试 / 构建 / 真机能力冒烟；四项"高"级结论另经协调层交叉抽查代码复核。
- 未做：真实流式压测、内存泄漏实测、vsce 打包与装机可视验收；两条"疑似"竞态未运行时复现。
- @factory/droid-sdk 内部为黑盒——daemon 服务端是否校验客户端身份未能核实，仅审计了调用面契约。
- ComposerControls 中段面板 JSX（626–2841 行）与 validateHostMessage（3,665 行）仅做骨架级 / 抽样审查（前者正被并行拆分，后者有 4,575 行专属测试）。
- 测试文件本身（约 1.2 万行）未逐行审计；已确认的覆盖空洞：SubagentTranscriptSheet、AppErrorBoundary、imagePreviewCache、useSubagentPanelFlow 窗口监听。
- 文档"验证状态"章（约 1,150 行）未逐条核对，按抽样策略覆盖。
