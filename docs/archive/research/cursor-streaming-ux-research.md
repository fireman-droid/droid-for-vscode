# Cursor 流式呈现模式调研

> 状态：**已经由 [`streaming-experience-design.md`](./streaming-experience-design.md)
> 合成实施并落地，仅存档**。保留价值：Cursor 动效 token / WordStreamer /
> shimmer 参数的一手证据，后续打磨（如 tier1 §1 流式输出预览）时查
> 证据用。

调研日期：2026-08-12。目标：系统整理 Cursor IDE 聊天界面在 AI 输出
期间的呈现模式，作为 DroidVisX 打磨参考。

证据来源与置信度标注：

- **[本机]** 本机安装的 Cursor 3.15.6（`D:\cursor\resources\app\out\`，
  `workbench.glass.main.css/js` 与 `workbench.desktop.main.css/js`
  反编译产物）。CSS 关键帧/规则为最高置信；minified JS 的逻辑还原为
  高置信；由类名推断的交互流为中置信。
- **[Web]** Cursor 官方 changelog 与 forum.cursor.com（2026）——行为
  与产品意图的佐证，高置信。
- 实证不了的条目明确标注"未能证实"。

中间产物（原始提取文本）在 `artifacts/wordstreamer-raw.txt`、
`artifacts/wordstreamer-class.txt`、`artifacts/autoscroll-raw.txt`。

**分工边界**：连续同类工具调用的聚合/折叠展示是独立专题，见
`docs/product/activity-aggregation-research.md`（另一调研代理产出），
本文不重复覆盖。

## 结论速览

Cursor 流式输出的核心设计语言可以概括为：**"动画只属于正在发生的
事"**。活跃流式内容用统一的 shimmer 文字（`make-shine`，2s 线性循环
渐变）标记"正在进行"，文本增量经 WordStreamer 平滑铺开（每个网络
delta 在 200ms 内按 ≥16 字符的词块逐块提交）；一旦完成，动画全部停
止，行标签从进行时动词（Thinking/Running/Reading）切换为过去式 +
量化摘要（Thought for 3s / Ran 4 browser actions），形态切换本身就
是收尾信号，没有额外的完成动画。历史回放/云端恢复（
`cloud-no-entry-animations`）禁用一切入场动画。所有微交互统一走
50/100/150/200/300ms 的时长 token 与少量强缓动曲线，入场动画一律是
"淡入 + 2-4px 上移"的小位移，从不大开大合。

## 一、模式目录

### 1. 流式正文动画

**Cursor 的做法**

- **词块级平滑流出（高置信，[本机] JS 还原）**：thinking 文本增量经
  `WordStreamer` 类处理——每个到达的 delta 按空白边界切成 ≥16 字符
  的词块（常量 `yGu=16`），全部词块均匀铺在 200ms 内（常量
  `_Gu=200`）逐块回调提交；若新 delta 在播放中到达，立即 flush 剩余
  词块再播新 delta，保证展示永不落后于真实流。`flush()` 在
  thinking 完成、回合结束、dispose 时强制清空。
- **token 淡入（中高置信，[本机] CSS）**：CSS 存在
  `.word-stream-token{opacity:1}` 与
  `.fade-in-fast{animation:fade-in .1s ease-in-out}`，并有总开关
  `.composer-messages-container.cloud-no-entry-animations
  .word-stream-token{animation:none!important}`。据此推断：活跃流式
  时新出现的词块带淡入动画（具体时长由内联样式/JS 赋值，**数值未能
  证实**）；云端回放与历史恢复禁用全部入场动画。
- **无生成光标（未能证实为"有"）**：未发现聊天正文的打字光标类
  （`monaco-cursor-*`、`nb-cursor-*` 均属编辑器/notebook）。判断
  Cursor 聊天正文不渲染生成中光标，用 shimmer 状态行代替"在写"的
  信号。
- **滚动跟随（高置信，[本机] JS 还原）**：虚拟化转录列表有三态滚动
  模型——`pinned-bottom`（贴底跟随，滚动 motion 为 `"instant"`，
  不做平滑滚动动画）、`anchored`（离底后锚定某可见行保持阅读位置）、
  `free`。判定贴底的阈值极小：`distanceFromBottom <= 2px`
  （常量 `cMa=2`）。用户滚动输入（`msSinceUserScrollInput`）与程序
  化滚动分开跟踪，用户上滚即释放锁定（released）。
- **[Web] 佐证**：changelog 3.4（2026-05）专门提到 "Improved
  long-chat scrolling … improved behavior while streaming"；论坛
  2026-06 官方回复承认"终端/代码块中途展开导致丢失贴底锁"是长期
  多因 bug——贴底 + 内容高度突变是 Cursor 自己也没完全解决的难点。

**DroidVisX 现状**

- 正文/思考文本用 assistant-ui `useSmooth` 逐字符 typewriter：
  正文 `TEXT_SMOOTH_OPTIONS`（drainMs 360 / maxCharIntervalMs 10 /
  maxCharsPerFrame 18 / minCommitMs 40，`MarkdownText.tsx:20-25`），
  思考 `THINKING_SMOOTH_OPTIONS`（480/12/12/48，`Thread.tsx:45-50`）。
  库内建：`prefers-reduced-motion` 自动直出全文；非 running 状态
  （历史）不动画——已经等价于 Cursor 的 no-entry-animations 原则。
- 视口用 assistant-ui Viewport 的 `scrollToBottomOnRunStart /
  OnInitialize / OnThreadSwitch`（`Thread.tsx:206-208`）。
- 无 token 级淡入。

**差距**

- 粒度差异（字符 vs 词块）观感相近，不必改造引擎；assistant-ui 的
  smooth 是能力边界内的正确选择。
- 缺 token/块级淡入（Cursor 的 `fade-in-fast` .1s）。
- 滚动跟随缺"离底锚定阅读位置"的精细模型，但 assistant-ui 的
  auto-scroll 行为已覆盖主场景；Cursor 的教训是**高度突变（展开的
  工具输出、代码块）最容易打断贴底**——tier1 §1 的流式输出预览实现
  时要注意固定高度或滚动容器内滚动，避免重蹈。

### 2. Thinking / 推理过程展示

**Cursor 的做法**

- **运行中（高置信，[本机]）**：折叠行标签为进行时动词
  `loadingAction:"Thinking"`，标签文字套 `.make-shine` shimmer：
  90° 渐变，底色为 60% 前景色（`color-mix(... 60%,transparent)`），
  中段 60% 处一条 100% 亮色，`background-size:200% 100%`，
  `animation:shine 2s linear infinite`（背景位从 200% 扫到 -200%）。
  思考正文经 WordStreamer 词块流出（见 §1）。
- **完成后文案（高置信，[本机] JS 函数原文）**：`completedAction`
  变为 `"Thought"`，时长格式化规则：
  - `durationMs < 500` → `"briefly"`（合成 "Thought briefly"）；
  - 取整秒数 > 0 → `"for ${t}s"`（"Thought for 3s"）；
  - 取整为 0 但有毫秒 → `"for ${(ms/1000).toFixed(1)}s"`；
  - 若思考内容首行解析出标题（parseHeaders），行标题直接用该标题
    文本，时长只显示 "3s"。
  时长来源是流事件 `thinkingCompleted` 携带的 `thinkingDurationMs`。
- **流结束自动折叠（高置信，[Web] 官方确认）**：thinking 块在该块
  流式结束时收起为一行；连手动展开也会被收起（官方回复承认后者是
  bug，但"结束即折叠"本身是设计意图）。
- **chevron 渐显（高置信，[本机]）**：折叠行 chevron 默认
  `opacity:0`，hover 行时过渡显现（transition transform/color/
  opacity，时长用 `--cursor-duration-normal/fast` token）。
- 完成行 hover 有 tooltip（`.composer-thinking-hover-tooltip`）。

**DroidVisX 现状**

- `ThinkingRow`（`Thread.tsx:641-676`）：`<details>` 行，标签固定
  "Thinking" + `formatPartStatus` 状态 + 完成后 `· 3.2s`；正文
  `<pre>` + smooth 流出；展开动画 `dvx-disclose-in` 220ms。
- 标签本身不 shimmer（shimmer 只在工具行 action 与 pending 状态行）。
- 用户展开状态自持（per-row state），流结束不强制折叠。

**差距**

- 运行中 "Thinking" 标签缺 shimmer——这是 Cursor"进行中"语言里最
  显眼的一环。
- 完成文案可对齐 "Thought for 3s / Thought briefly" 的自然语序
  （现为 "Done · 3.2s" 风格）。
- 结束自动折叠：Cursor 的做法（强制收起）伤害了手动展开的用户且被
  投诉，DroidVisX 保持用户展开状态**不必跟进**，保留现状即可；只需
  保证默认（未手动展开）时完成后是收起形态——已满足。

### 3. 子代理 / 任务行

**Cursor 的做法**（CSS 高置信，交互流中置信）

- **嵌套视觉**：父行是可点击的 agent 标题
  （`.composer-async-subagent-task-notification__agent-title`，次级
  文字色，hover 过渡到主文字色，`transition:color .12s ease`）；其
  下用 L 形连接线（`__quote-connector`：1.5px 边框、左+上边、
  圆角 6px、`opacity:.5`、10×10px）挂出灰色引用气泡
  （`__quote-bubble`：1px 三级描边、次级文字色、两行
  `-webkit-line-clamp` 截断）显示派发给子代理的任务文本——即用户
  截图中"父行 + 灰色子行"的结构。
- **运行中**：行标签同样走 loadingAction + `make-shine` shimmer 体
  系；状态字符串证据有 "Queued" / "Running in cloud" /
  "Completed task" 等。
- **完成收纳**：结果收为响应卡（`__response-card`：1px 三级描边、
  透明底、6×8px 内边距），右侧 "open-hint" 提示默认 `opacity:0`、
  卡片 hover 时 `.12s ease` 渐显，点击进入子代理详情（"Subagent
  Editor" / "Subagent details" 字符串佐证存在专门视图）。
- **云端动作胶囊**：`__cloud-action-pill`——22px 高、999px 圆角、
  三级底色，内含 +A/−D diff 数字分别用 git 增/删色。

**DroidVisX 现状**

- 无子代理概念：`src/` 内无 subagent 相关代码。Droid CLI 是否暴露
  子任务/子代理事件未验证，不得发明能力。

**差距**

- 全新能力，且依赖 Runtime 侧确认 Droid 有无对应事件。若 Droid 无
  此能力，本模式仅作视觉词汇储备（连接线 + 引用气泡 + hover 渐显
  open-hint 的组合也适用于其他"父子结构"展示，如 Task 工具嵌套）。

### 4. Todo / 任务计划展示

**Cursor 的做法**（高置信，[本机] CSS 全量）

- **sticky 摘要容器**（`.todo-summary-sticky-container`）：todo 摘
  要吸附在转录一侧，hover 时描边过渡显现。
- **摘要行 → 展开**：`.todo-summary-expanded-content` 从
  `max-height:0/opacity:0` 过渡到 `max-height:500px/opacity:1`，
  `max-height .25s ease-in-out + opacity .2s ease-in-out`。
- **逐项淡入**：每个 `.todo-summary-item` 挂
  `animation:todoFadeIn .2s ease-out forwards`（opacity 0→1 +
  translateY 2px→0）。
- **状态语义**：进行中项 `todo-in-progress` 用主文字色 + bullet
  旋转 90°（箭头指向当前项）；完成项 `opacity:.5 + line-through`；
  取消项同样删除线。列表 gap 10px。
- **chevron**：`chevronFadeIn .1s ease-in`（渐显到 opacity .4），
  展开翻转 `transform .15s ease-in-out`。
- [Web] 佐证：plan mode 的 todos 是 changelog/onboarding 里的一等
  公民（`.onboarding-v2-quick-start-plan-mode-todos*`）。

**DroidVisX 现状**

- `.dvx-plan`（`styles.css:1282-1364`）：圆点 marker；in_progress
  径向填充 + `dvx-plan-pulse` 1.4s 呼吸；completed 填充 + 删除线；
  顶部进度文案。始终全量平铺，无折叠摘要、无逐项入场动画。

**差距**

- 缺折叠摘要形态（长计划占满转录）与展开过渡。
- 缺逐项 `todoFadeIn`；新项出现是瞬显。
- "当前项"语义可从呼吸圆点升级为方向性指示（Cursor 用旋转箭头）。

### 5. 状态提示行

**Cursor 的做法**

- **动词体系（高置信，[本机]）**：进行中 `loadingAction` 动词集：
  Thinking / Generating / Reading / Running / Using / Deleting；完
  成后转过去式 `completedAction`：Thought / Generated / Read / Ran /
  Used / Delete，并带量化 `completedDetails`（如 "4 browser
  actions"）。同一行完成时只是文案 + shimmer 停止，没有额外动画。
- **shimmer 承载**（高置信）：进行中标签统一 `make-shine`（§2 参数
  同）；工具卡头部由 `topHeaderLoadingShimmer` 布尔切换 shimmer。
  等待类文案（"Waiting for environment…"、"Loading conversation"）
  也直接套 make-shine。
- **让位细节**（高置信）：`.generating-spinner` 在所在行 hover 时
  `opacity:0`（.1s），让位给行内操作按钮。
- **性能细节**（高置信）：加载动画在文档隐藏/离屏时
  `animation-play-state:paused!important`。
- **Stop 关系（中置信，产品行为观察）**：生成期间输入框发送按钮变
  为 Stop；状态行本身不承载停止操作。代码内 "Stop" 字符串多而分散，
  未逐一定位主聊天 Stop 按钮的实现，标注为观察结论。

**DroidVisX 现状**

- `PendingResponse`（`Thread.tsx:777-796`）："Droid is working /
  Droid is responding" + `dvx-runtime-pulse` 圆点 +
  `dvx-shimmer-text`（1.6s linear）。interaction 等待时隐藏、批量
  运行时只有最新行 shimmer（activity-shimmer-fix 已实现）。
- Stop 在 Composer（`dvx-stop-action`），与 Cursor 结构一致。

**差距**

- 状态基本对齐。可借鉴：完成时的"过去式 + 量化"文案（与 §2 联
  动）；离屏暂停动画的性能细节；hover 让位。

### 6. 回合级过渡

**Cursor 的做法**

- **间距节奏（高置信）**：`--conversation-block-gap:10px`、
  `--conversation-list-item-gap:6px`、
  `--conversation-tool-card-gap:6px`；会话字号 token 13px 系。
- **入场动画（高置信）**：通用小位移淡入——`fade-in-fast`
  .1s ease-in-out（纯淡入）；块级 `fadeInSlideUp .3s ease-out`
  （opacity 0→1 + translateY 4px→0，`will-change:opacity,transform`）。
- **回放静默（高置信）**：`cloud-no-entry-animations` 容器类一刀切
  `animation:none!important`——恢复/回放的历史内容不重播任何入场
  动画，动画只属于活跃流式。
- **完成收尾（未能证实）**：未找到回合完成的专门动画；证据链指向
  "shimmer 停止 + 文案切过去式"即收尾。存在
  `composer-action-notification-fade-in`（操作通知淡入），非回合级。
- [Web]：changelog 3.4 引入 Compact chat responses 与工具调用密度
  （Compact/Balanced/Detailed）设置，说明回合内密度是用户可调维度。

**DroidVisX 现状**

- 消息无入场动画（`dvx-rise-in` 仅用于弹层/交互面板）；tier1 §4 已
  排期"首条 assistant 文本块 160ms 淡入 + 4px 上移、action bar 淡
  入"。间距节奏已有自有体系。

**差距**

- §4 的参数方向与 Cursor 一致（4px 上移吻合；Cursor 块级用 .3s
  ease-out，比 §4 的 160ms 更缓）。
- §4 未覆盖"历史恢复不重播入场动画"的边界——DroidVisX 有恢复快照
  + reconcile 流程，恢复渲染的转录必须静默，需要在切片中显式加上
  （等价于 Cursor 的 no-entry-animations 开关）。

### 7. 动效设计 token

**Cursor 的 token 系统**（高置信，[本机] JS 内 CSS-in-JS 定义 +
CSS 使用处）

时长：

| token | 值 |
| --- | --- |
| `--cursor-duration-instant` | 50ms |
| `--cursor-duration-fast` | 100ms |
| `--cursor-duration-normal` | 150ms |
| `--cursor-duration-slow` | 200ms |
| `--cursor-duration-slower` | 300ms |

缓动：

| token | 值 |
| --- | --- |
| `--cursor-easing-default` | ease |
| `--cursor-easing-in/out/in-out` | ease-in / ease-out / ease-in-out |
| `--cursor-easing-in-out-strong` | cubic-bezier(.77, 0, .175, 1) |
| `--cursor-easing-out-strong` | cubic-bezier(.165, .84, .44, 1) |
| `--cursor-easing-out-quint` | cubic-bezier(.16, 1, .3, 1) |
| `--cursor-easing-in-strong` | cubic-bezier(.895, .03, .685, .22) |

高频实测值（CSS 使用处直接提取）：

- 微交互 hover（颜色/透明度）：`.12s ease`（出现十余处，事实标准）。
- shimmer：`2s linear infinite`，`background-size:200% 100%`，背景
  位 `200% 0 → -200% 0`；渐变 stop 结构 0/25%/60%/75%/100%，底色
  60% 前景 + 60% 处全亮。
- 入场：淡入 .1s；列表项 .2s ease-out + 2px 上移；块级 .3s
  ease-out + 4px 上移。
- 折叠展开：max-height .25s ease-in-out + opacity .2s；chevron
  transform .15s。
- 间距基准 4px（`--cursor-spacing-1:4px` 等差到 56px+）。

**DroidVisX 现状**：数值散落（1.6s shimmer / 220ms disclose /
240ms rise-in / 180ms fade-in），量级与 Cursor 接近但无 token 变量。

**差距**：可引入 `--dvx-duration-*` / `--dvx-easing-*` 小型 token
表统一管理；shimmer 周期 1.6s vs 2s 属风格差异，不必对齐。

## 二、改造建议总表

| # | 模式 | 具体方案 | 工作量级 | 归属 |
| --- | --- | --- | --- | --- |
| A | Thinking 标签运行中 shimmer | `ThinkingRow` summary 标签复用 `.dvx-shimmer-text`（running 时），与既有"单 shimmer/暂停"规则组合 | 纯 CSS + Thread.tsx 一行 | 新增微切片，可随 §4 走 |
| B | Thinking 完成文案 | "Thought for 3s"/"Thought briefly"（<500ms）替代 "· 3.2s" 后缀；数据已有 durationMs | Webview 组件（格式函数） | 同上，与 A 同切片 |
| C | 消息/块入场动画 | 首块 fadeInSlideUp 式淡入+4px 上移（160-300ms ease-out）；action bar 淡入 | 纯 CSS | tier1 §4 既有范围 |
| D | 回放静默开关 | 恢复快照/reconcile 渲染的转录加根类（如 `dvx-no-entry-anim`）禁用全部入场动画 | Webview 组件 + CSS | §4 需新增的边界 |
| E | 流式输出预览的滚动稳定 | §1 实现时 `dvx-tool-output` 用固定 max-height 内部滚动，避免高度突变打断贴底（Cursor 的已知痛点） | Webview 组件 | tier1 §1 的实现约束 |
| F | Todo 折叠摘要 + 逐项淡入 | `.dvx-plan` 增加收起摘要形态（当前项 + 进度），展开 max-height/opacity 过渡；新项 todoFadeIn .2s；当前项方向性指示 | Webview 组件 + CSS | 新增切片 |
| G | 状态动词体系 | 工具行完成时"过去式 + 数量"摘要（Read 3 files 等）；依赖 activity detail 已有字段，不动 Bridge | Webview 组件 | 新增，可与聚合切片（见 activity-aggregation-research.md）合并设计 |
| H | 动效 token 化 | styles.css 顶部定义 `--dvx-duration-instant/fast/normal/slow/slower` + `--dvx-easing-*`，存量动画改引用 | 纯 CSS | 新增微切片 |
| I | 子代理行 | 先在 Runtime 侧验证 Droid 是否暴露子任务事件；若有，按"标题行 + L 连接线 + 引用气泡 + hover open-hint"结构做全链切片 | Runtime+Bridge+Webview | 新增大切片，暂缓 |
| J | 离屏暂停动画 | shimmer/pulse 补 `animation-play-state:paused`（document hidden 时由根类控制） | 纯 CSS + 一个 visibilitychange 监听 | 新增微切片，低优先 |

不建议跟进的 Cursor 行为：thinking 流结束强制折叠用户手动展开的块
（Cursor 官方已确认为缺陷且被用户投诉）；聊天正文生成光标（Cursor
自己也不用）。

## 三、优先级建议（用户感知提升 / 实现成本）

1. **A+B（Thinking shimmer + 完成文案）**——成本最低（一个类名 +
   一个格式函数），直接补齐"进行中"视觉语言里最显眼的缺口，且与已
   实现的 activity shimmer 体系天然一致。
2. **C+D（入场动画 + 回放静默）**——即 tier1 §4 扩充版；"只有活跃
   流式才动画"是 Cursor 设计语言的核心原则，D 的边界必须与 C 同时
   落地，否则重开窗口时整屏历史一起播动画会适得其反。
3. **F（Todo 折叠摘要 + 逐项淡入）**——长计划当前占满转录，收起
   摘要 + 展开过渡的感知提升大；纯 Webview，无协议改动。

H（token 化）建议作为 C 的实现前置顺手完成；E 是 §1 的实现约束而
非独立切片；G 与工具聚合专题合并设计；I 需先做能力验证；J 随缘。

## 四、prefers-reduced-motion 降级要求

仓库惯例：全部动效必须有静态降级（现有全局块
`styles.css:3854-3877`）。本调研新增动效的降级矩阵：

- **A（Thinking shimmer）**：已被 `.dvx-shimmer-text` 的既有
  reduce 规则覆盖（`styles.css:3870`），无需新规则，验证即可。
- **C（入场动画）**：reduce 下 `animation:none`，内容直接就位；这
  也是 assistant-ui `useSmooth` 的内建行为（reduce 时全文直出），
  两层降级一致。
- **F（Todo）**：`todoFadeIn` 与 max-height 过渡 reduce 下均
  `animation:none / transition:none`，展开收起瞬时切换；勾选态、
  删除线等静态语义不受影响（本就是无动画信息通道）。
- **J（离屏暂停）**：与 reduce 正交，无需处理。
- 参考：Cursor 自身对 `prefers-reduced-motion` 覆盖很稀疏（全量
  CSS 仅 3 处），DroidVisX 的全局 kill-switch 惯例严于 Cursor，
  保持不退。

## 附录：置信度最高的三条实证

1. **WordStreamer 流式引擎**（`workbench.desktop.main.js`，完整类
   还原于 `artifacts/wordstreamer-class.txt`）：delta 按空白切
   ≥16 字符词块、200ms 均匀铺开、新 delta 到达即 flush。
2. **Thinking 时长文案函数**（`workbench.glass.main.js` `G0o`）：
   `<500ms → "briefly"`；`for ${t}s`；0 秒但有毫秒 →
   `for ${(ms/1000).toFixed(1)}s`——"Thought for 3s" 的精确来源。
3. **make-shine shimmer 定义**（两份 workbench CSS 一致）：60% 前
   景底 + 60% 位置全亮的 90° 渐变、`background-size:200% 100%`、
   `shine 2s linear infinite`（200%→-200%），配套
   `cloud-no-entry-animations` 回放静默总开关。
