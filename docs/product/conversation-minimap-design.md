# 会话小地图（Minimap Scrubber）设计调研

状态：调研完成，未实施（用户明确"不急着做，先把方案调研清楚"）。
日期：2026-08-12。本文基于当日 `src/webview/assistant/Thread.tsx`
（约 4040 行）与 `styles.css`（约 6100 行）的实际代码。

## 0. 需求回顾与参考对象

用户看到 Grok 网页版会话右侧的刻度栏（短线 = 用户消息、长线 = AI
回复）想要同款。硬性要求：

1. 点击刻度跳转到对应消息；
2. 按住上下拖动可滑览（scrub）；
3. 未交互时必须极不显眼（细、低透明度）；
4. 绝不影响正文布局（overlay 定位）。

外部先例（2026-08 检索）：

- **Grok**：网页版右侧 tick rail；CLI 侧也有 `/timeline`（"clickable
  tick rail for fast navigation between conversation turns"，见 x.ai
  build changelog）。说明该模式已是 Grok 的一级导航。
- **LibreChat PR #12657**（"Message Navigation Strip"）：右缘浮动条，
  用户消息窄线、助手消息宽线，当前可见消息高亮；hover 出
  HoverCard 截断预览；用 `IntersectionObserver` 追踪当前消息，
  `scroll-margin-top` 处理吸顶 header 遮挡。
- **octo-agent PR #1661**（DeepSeek 式 user-message rail）：刻度按
  消息**真实渲染 offset** 定位（不均匀分布）；重算由"消息列表变化
  的 effect + 节流"驱动，`ResizeObserver` 只作补充触发器——实测
  Chrome 会在标签页后台时延迟 RO 回调，只靠 RO 会导致后台收到消息
  后刻度陈旧。hover 预览取消息前 80 字符。
- **shadcn/HeroUI MessageScroller**：滚动热路径不走 React state，
  用 data attribute / 直接 DOM 写入，避免流式期间连带重渲染。

这些先例与本仓库现状高度吻合，下面逐条落到本仓库的结构上。

## 1. 现有转录 DOM 与滚动基础设施（可复用清单）

### 1.1 DOM 结构（Thread.tsx 663-830 行附近）

```text
ThreadPrimitive.Root            .dvx-thread
└─ ThreadPrimitive.Viewport     .dvx-thread-viewport   ← 滚动容器，position:relative
   ├─ div.dvx-reading-column    （readingColumnRef，未定位，max-width 860 居中）
   │  ├─ button.dvx-show-earlier          （hiddenMessageCount>0 时）
   │  ├─ MessagePrimitive.Root .dvx-message.dvx-message-user     （sticky top:0）
   │  ├─ MessagePrimitive.Root .dvx-message.dvx-message-assistant（每 turnId 一条）
   │  └─ …（PendingResponse、inlineInteraction）
   └─ ThreadPrimitive.ViewportFooter .dvx-thread-footer （sticky bottom, z-index:4）
      ├─ .dvx-scroll-bottom-dock（absolute bottom:100%，滚动箭头）
      ├─ TaskPlanPin
      └─ Composer
```

对 minimap 直接有用的事实：

- **消息可枚举**：一次 `column.querySelectorAll(".dvx-message")` 即
  得全部已挂载消息，`dvx-message-user` / `dvx-message-assistant`
  类名区分长短刻度。现有钉住协调器已经用同款查询
  （`querySelectorAll(".dvx-message-user")`，Thread.tsx 483 行）。
- **offsetTop 即滚动坐标**：`.dvx-reading-column` 没有 `position`，
  消息元素的 `offsetParent` 就是 `position:relative` 的
  `.dvx-thread-viewport`，因此 `msg.offsetTop` 直接是该消息在滚动
  内容里的 y 坐标，无需 rect 换算。这一点还顺带绕开了用户消息
  `position:sticky` 的坑：`getBoundingClientRect()` 返回的是吸附后
  的视觉位置，而 `offsetTop` 返回的是文档流位置——刻度必须用后者。
- **原生滚动条已隐藏**：`.dvx-thread-viewport` 是
  `scrollbar-width: none` + `::-webkit-scrollbar{width:0}`。即当前
  转录**没有任何空间位置指示**，minimap 不是锦上添花，是把被藏掉
  的空间感还回来，产品理由充分。
- **消息分批挂载**：`runtimeAdapter.ts` 只挂载尾部
  `DEFAULT_MESSAGE_WINDOW = 60` 条，`Show earlier` 每次 +120
  （`MESSAGE_WINDOW_STEP`）。未挂载消息不在 DOM（见 §4）。

### 1.2 滚动协调器（Thread.tsx 453-600 行）——直接搭车

现有一个统一的滚动协调器 effect，minimap 应作为它的第四个客户接入
（前三个：sticky 钉住、stick-to-bottom、滚动箭头），而不是另起
observer：

- **单一 rAF 通道**：`schedule()` → `updatePins()`，同帧内完成所有
  读写。minimap 的视口区间高亮与刻度重算挂进同一个
  `updatePins`，天然与钉住/箭头状态一致，不会各转各的。
- **已有的失效触发器全套**：`scroll`（passive）、`wheel`、
  `ResizeObserver`（观察 reading column **和** footer）、
  `MutationObserver`（column 的 childList）。消息增删、流式长高、
  Composer 长高、编辑卡展开——全部已经会触发 `schedule()`。
  minimap 不需要新增任何 observer。
- **follow 锁存器**（`createFollowState` / `applyFollowScroll`，
  3941-4002 行，已导出、有测试）：程序化写 scrollTop 要标记
  `pendingProgrammaticTop`，否则会被误判成用户滚动。minimap 的
  点击跳转与拖动 scrub 的交互语义见 §3。
- **滚动箭头的成熟范式**：`scrollToBottomRef` + `awayFromBottom`
  state（`SCROLL_BOTTOM_SHOW_PX = 48`）演示了"协调器算、React 只收
  布尔值"的分工。minimap 照抄：刻度几何与视口带条用直接 DOM 写入
  （style/transform/data-attribute），React 只负责挂载 rail 容器。
- **一次性滚动仍归 assistant-ui**：`scrollToBottomOnRunStart /
  Initialize / ThreadSwitch` 保持不动，minimap 不接管。

### 1.3 层叠上下文现状（与 §5 共存分析对应）

| 元素 | z-index | 备注 |
| --- | --- | --- |
| `.dvx-header`（顶栏） | 6 | 在 `.dvx-thread` 之外（shell 的第一 grid 行），与 rail 无重叠 |
| `.dvx-thread-footer` | 4 | sticky bottom，含 Composer |
| `.dvx-message-user[data-pinned]` | 3 | 吸顶的用户消息 |
| `.dvx-scroll-bottom-dock` | 3 | footer 上缘居中 |

## 2. 位置测量方案

### 2.1 采集

一次测量 pass（在协调器 rAF 里）：

```ts
// 读阶段（不与写交错，单次 reflow）
const messages = column.querySelectorAll<HTMLElement>(".dvx-message");
const scrollHeight = scroller.scrollHeight;   // 总高，含 footer
const ticks = [...messages].map((el) => ({
  kind: el.classList.contains("dvx-message-user") ? "user" : "assistant",
  y: el.offsetTop / scrollHeight,             // 0..1 归一化
}));
// 写阶段：一次性更新 rail DOM
```

- `offsetTop` 而非 `getBoundingClientRect()`：见 §1.1（sticky 坑 +
  更便宜，不生成 DOMRect 对象）。
- 归一化到 `scrollHeight`，rail 高度变化（窗口 resize）不需要重测
  消息，只有内容几何变化才需要。

### 2.2 失效与重算分层

关键：把"每帧都要做的"与"几何变化才做的"分开。

| 层 | 触发 | 频率 | 工作 |
| --- | --- | --- | --- |
| 视口带条 + 当前刻度高亮 | scroll（已有监听） | 每滚动帧 | 只读 `scrollTop/clientHeight/scrollHeight`（协调器本来就读），写一个 `transform: translateY() scaleY()` 到带条元素。O(1)，零布局读 |
| 刻度几何重算 | MutationObserver childList（消息增删）、ResizeObserver（流式长高、窗口 resize）、`hiddenMessageCount` 变化 | 内容变化时，rAF 合并 + 节流 | §2.1 的测量 pass，O(n) |

节流策略：几何重算在 rAF 合并之上再加"每 250ms 至多一次 + 尾随"
（流式期间内容每帧都在长高，刻度位置以 250ms 粒度追随完全够用，
视口带条仍每帧更新所以手感不受影响）。octo-agent PR #1661 的教训
（后台标签页 RO 延迟）在本仓库不构成额外风险：MutationObserver 与
消息驱动的 React 提交仍在，且 webview 隐藏时 App.tsx 的消息泵有
50ms setTimeout 兜底，恢复可见后首个 rAF 会补算。

### 2.3 性能预算（500+ 消息）

- 测量 pass：500 次 `offsetTop` 读，同帧无写入交错 → 一次布局
  flush，实测同类代码 <2ms；预算上限 4ms。
- rail 渲染：**不要 500 个 React 元素**。两个可选实现：
  1. 单个 `<canvas>`（宽 ~14px），一次 `clearRect` + 500 次
     `fillRect`，<1ms；hover 命中用 y 坐标反查刻度数组。
  2. 500 个绝对定位 `<div>`（直接 DOM 建，不走 React diff）。
     DOM 数量可控（消息窗未展开时只有 ≤60 条），展开后 500 条
     2px 高的 div 也在预算内，但 canvas 上限更稳。
  推荐第 1 切片用 div（简单、可 CSS 过渡、可 a11y），转录 >300 条
  时自动切 canvas 可以留作后续优化，不预做。
- **与 P1-P9 信标的关系**：不新增信标。minimap 的成本会自然落进
  既有观测面——测量 pass 若失控会出现在 `webview.perf-longtask`
  （P2，50ms 阈值聚合），流式期间的重算若拖慢消息泵会恶化
  `webview.perf-batch`（P3）的 `maxFlushMs`。验收标准直接沿用：
  接入 minimap 前后跑一次既有的 stress harness
  （`artifacts/run-stress-*.mjs` 系），P2 长任务计数与 P3
  `maxFlushMs` 不得回归。测量 pass 自身 <4ms，远低于 P2 的 50ms
  长任务阈值，正常情况下完全不可见。

## 3. 交互细节

### 3.1 点击跳转

- 命中刻度 → `scroller.scrollTo({ top: tick.y * scrollHeight - 吸顶补偿, behavior })`；
  `behavior` 沿用现有约定：`prefers-reduced-motion: reduce` 时
  `auto`，否则 `smooth`（Thread.tsx 563-569 行已有同款判断）。
- 吸顶补偿：跳到用户消息时目标位置本身会吸顶（sticky top:0），无
  需 `scroll-margin-top`；跳到助手消息时应减去"当时会钉住的那条
  用户消息高度"（现成数据：钉住协调器每帧都在算 `layout.pinnedIndex`
  与高度），第 1 切片可以简化为固定补偿 0——助手消息顶端被钉住卡
  遮住一截并不影响理解，后续切片再精确化。
- follow 语义：跳转是用户导航，**不标记** `pendingProgrammaticTop`
  ——让 `applyFollowScroll` 按用户滚动处理：向上跳自然解锁
  stick-to-bottom，跳回底部自然重新锁存（4 px 容差）。零新增状态。

### 3.2 拖动 scrub

- `pointerdown` 在 rail 上 → `setPointerCapture`，`pointermove` 把
  指针 y 映射为 `scrollTop = ratio * (scrollHeight - clientHeight)`，
  直接赋值（不 smooth——scrub 要求即时跟手）。
- 同样不标记程序化写：scrub 途中向上即解锁 follow，scrub 到底部即
  重锁，语义与滚轮一致，free。
- scrub 期间给 rail 加 `data-scrubbing`，保持展开态（见 §3.4），
  `pointerup` 后回落。

### 3.3 hover 放大 / 预览

- **hover 刻度**：目标刻度 `scaleX` 加宽 + 透明度升满；同排显示
  一个小预览浮层（用户消息取 `.dvx-user-text` 前 ~60 字符；助手
  消息取该 turn 首个文本 part 前 ~60 字符，流式中的取"回复中"）。
  预览数据在测量 pass 顺带采（`textContent.slice`），不存 React。
- 预览浮层复用现有 popover 视觉（`.dvx-composer-popover` 的卡片
  语言：raised 面、1px 边框、`--dvx-shadow`），左侧弹出。
- 第 1 切片**不做预览**，只做 hover 加宽 + rail 整体透明度过渡
  （见 §6 切片）。

### 3.4 视口区间高亮 + 未交互时隐身

- 一个绝对定位带条元素表示当前视口区间：
  `top = scrollTop/scrollHeight`、`height = clientHeight/scrollHeight`，
  用 `transform: translateY(...) scaleY(...)` 写（合成层，无重排）。
- 静默态（默认）：rail 宽 3px 命中区 / 视觉刻度 2px 高、颜色
  `--dvx-subtle` 且 `opacity: 0.28`，视口带条 `opacity: 0.10`。
  hover rail 或 scrub 时整体过渡到 `opacity: 1`、刻度加宽（见 §5
  token 表）。过渡时长走 `--dvx-duration-normal`（150ms）。
- 不做任何常驻高亮、不做当前消息追踪高亮（LibreChat 用 IO 做了，
  我们的"视口带条"已经承载同一信息，且成本为零——刻度落在带条内
  即"当前可见"）。

### 3.5 与 "Show earlier messages" 的冲突（未挂载消息表示）

未挂载消息不在 DOM、无真实几何，**不伪造位置**（与"不发明 Droid
能力"同一条纪律）。处理：

- rail 顶部留一个固定高度（~18px）的"更早区"帽子：一段
  2px 宽的竖向虚线（或 3 个渐隐小点），语义是"上面还有
  N 条未加载"。hover 显示 "N earlier messages"，点击直接调用现有
  `onShowEarlier`（等价于点 `.dvx-show-earlier` 按钮）。
- 挂载窗口内的刻度把 rail 剩余高度当 100% 用（归一化分母是当前
  `scrollHeight`，本来就只含已挂载内容，自洽）。
- 点"更早区"后消息批量挂载 → MutationObserver 触发重算 → 刻度
  整体重排。可接受：这与用户点 `Show earlier` 后正文本身的跳动是
  同一次视觉事件。
- `hiddenMessageCount` 需要从 React 传给 rail：作为 prop 传入
  minimap 组件即可（它已经作为 prop 传给 DroidThread）。

## 4. 视觉规格（轻奢标准）

遵守 UI 铁律：静默、细、无平涂色块；全部用既有 token。

| 项 | 值 |
| --- | --- |
| rail 容器 | `position:absolute; right:3px;`，宽 14px（命中区），`pointer-events:auto` 仅限自身；垂直范围见 §5 |
| 用户消息刻度 | 宽 7px、高 2px、`border-radius:1px`、`background: var(--dvx-subtle)`（#a1a1a1） |
| 助手消息刻度 | 宽 12px、高 2px，同色；右对齐（与 Grok 一致，长短对比即角色区分） |
| 静默态 | 刻度 `opacity:0.28`；视口带条 `background: var(--dvx-ink)`、`opacity:0.10` |
| hover/scrub 态 | rail 整体 `opacity:1`；hover 中的刻度 `background: var(--dvx-muted)`（#737373）、宽 +3px；过渡 `var(--dvx-duration-normal) var(--dvx-easing-out-strong)` |
| 更早区帽子 | `border-left: 2px dotted var(--dvx-border-strong)` 渐隐，或 3 点渐隐；hover 同上加深 |
| 预览浮层（后续切片） | raised 面 `var(--dvx-raised)`、`1px solid var(--dvx-border)`、`box-shadow: var(--dvx-shadow)`、11px `var(--dvx-muted)` 文本，最大宽 220px 单行截断 |
| 禁用动效 | `prefers-reduced-motion: reduce` 下去掉透明度/宽度过渡（仓库已有同款 media 块可挂） |

刻意不用 `--dvx-accent`：rail 是环境信息，不是行动号召；accent 在
本 UI 里保留给发送键、上下文环等一级操作（UI-restraint 决定，
2026-08-12）。

## 5. 与吸顶元素的共存

- **顶栏 header（z-6）**：在 shell grid 的独立行，`.dvx-thread` 不
  与之重叠，rail 放在 `.dvx-thread` 内（`ThreadPrimitive.Root` 加
  `position:relative`，纯增量）自然从 header 下缘开始。无冲突。
- **吸顶用户消息（data-pinned，z-3）**：钉住卡全宽，rail 覆盖其右
  缘上方。rail z-index 取 5（钉住卡 3 之上、footer 4 之上、header
  6 之下）。视觉上 2px 的低透明度刻度浮在钉住卡右缘可接受；若实测
  刺眼，备选方案是 rail 顶部随 `layout.pinnedIndex` 的卡高做
  `clip-path` 避让——协调器每帧已有该数据，成本 O(1)。第 1 切片
  不做，视觉验收后定。
- **编辑卡（dvx-message-editing）**：编辑态钉住卡免除推出，可能较
  高；同上，rail 只占右缘 14px，编辑卡内容区 padding 已避开。低
  风险，视觉验收覆盖。
- **滚动箭头（scroll-bottom-dock，居中）**：水平方向不冲突。
- **footer/Composer（z-4）**：rail 垂直范围必须止于 footer 上缘。
  footer 在滚动容器内 sticky，其高度已被协调器的 ResizeObserver
  观察——同一 rAF pass 里把 `rail.style.bottom = footerHeight + 8px`
  写掉即可，Composer 长高（多行输入、附件条）时 rail 自动缩短。

## 6. 实施切片建议与工作量

全部改动限于 Webview 层（Thread.tsx + styles.css + 测试），不碰
Runtime/Host/Bridge——minimap 消费的全部是已在 DOM 里的数据。

### 切片 1（最小可用，建议范围）

- rail 容器 + 刻度渲染（div 实现，直接 DOM 写入，挂进现有协调器
  rAF）；
- 用户/助手长短刻度、真实 offset 定位；
- 视口带条（每滚动帧 transform 更新）；
- 点击跳转（smooth/reduced-motion 分支，简化吸顶补偿为 0）；
- 静默/hover 两态透明度与宽度过渡；
- 更早区帽子（点击 = onShowEarlier）；
- 纯函数抽取 + 单测（刻度归一化、命中反查、follow 语义不回归——
  `applyFollowScroll` 已有测试文件可挂）；
- stress harness 跑 P2/P3 无回归 + 截图验收。

估计：**1–1.5 个 agent 工作日**（其中约三分之一是视觉调优与
harness 验证）。风险点：与钉住协调器同帧读写的顺序（读全部集中在
pass 开头即可）；860px 宽屏下 reading column 居中而 rail 靠视口右
缘的视觉关系（预期可接受，rail 本来就是视口级控件）。

### 切片 2

拖动 scrub（pointer capture + 即时 scrollTop 映射 + data-scrubbing
展开态）。~0.5 天。

### 切片 3

hover 预览浮层（文本采集、popover 复用、边缘翻转）+ 跳转的精确
吸顶补偿 + （如需要）>300 消息切 canvas。~1 天。

### 明确不做

- 未挂载消息的伪造刻度位置；
- 常驻"当前消息"高亮（视口带条已覆盖）；
- 每消息 IntersectionObserver（协调器 rAF 已有全部所需数据）；
- 新性能信标（P2/P3 已覆盖观测需求）。
