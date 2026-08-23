# 长会话 transcript 卡顿治理方案

状态：档位 3b 已在 v0.7.67 落地（主聊天 DOM 真虚拟化，数据窗口仍为 60/+120）；v0.7.68 把同一套虚拟列表接到 Session viewer。档位 1 / 2 / 3a 仍未开工。触发问题：恢复超长历史会话后整个面板滚动卡顿，拖动侧边栏宽度（"拉伸"）时几乎卡死。

本文是诊断与分档记录。档位 3b 已实现；其余档位仍待选定后开工。

---

## 1. 现象

| 场景 | 表现 |
| --- | --- |
| 恢复一个消息量很大的会话，并点过若干次"显示更早" | 滚动明显掉帧，输入框输入有延迟 |
| 拖动 Cursor 次级侧边栏宽度 | 主线程锁死，拖动过程中界面不刷新，松手后才恢复 |
| 会话消息量小（默认窗口内） | 无感知问题 |

关键区别：拉伸比滚动严重一个量级。这不是"随便哪里慢"，而是特定的一类每帧工作在宽度变化时被放大。

---

## 2. 现状链路

### 2.1 消息挂载策略（无虚拟化）

`src/webview/assistant/runtimeAdapter.ts:57-58`

```ts
export const DEFAULT_MESSAGE_WINDOW = 60;
export const MESSAGE_WINDOW_STEP = 120;
```

窗口内的消息**全部真实 mount**：markdown 正文、代码块、工具行、diff 卡片、活动行。文件里已有的注释记录过一次实测结论（同文件 :49-55）：

> at a 200-message window each streamed delta cost ~50ms of main-thread work and session recovery blocked for seconds

也就是说 200 条窗口在流式期就已经是 50ms/delta。用户点过几次"显示更早"（每次 +120）之后，DOM 节点量到万级是常态。这是**基础负担**，后面两条都是在这个基础上做乘法。

### 2.2 每帧测量链 A：sticky pin

`src/webview/assistant/Thread.tsx:566-624` `updatePins()`

```ts
const messages = [...column.querySelectorAll<HTMLElement>(".dvx-message-user")];
const rects = messages.map((element) => element.getBoundingClientRect()); // O(n) 强制布局
...
messages.forEach((element, index) => {
  element.toggleAttribute("data-pinned", ...);
  element.toggleAttribute("data-covered", ...);
  element.toggleAttribute("data-sticky-compact", ...);
  element.style.transform = ...;                                          // O(n) 写，使布局失效
});
```

触发源（均经 `requestAnimationFrame` 合帧，即**每帧最多一次，但只要触发源持续就每帧都跑**）：

- `Thread.tsx:677` `scroller.addEventListener("scroll", onScroll)`
- `Thread.tsx:679-687` `ResizeObserver` 观察 reading column 与 `.dvx-thread-footer`
- `Thread.tsx:690-694` `MutationObserver(column, { childList: true })`

`computeStickyLayout`（`stickyLayout.ts`）本身是 O(n) 纯函数，不是瓶颈；瓶颈是它的**输入采集方式**。

### 2.3 每帧测量链 B：问题导航

`src/webview/assistant/useQuestionNavigation.ts:112-146` `measure()`

```ts
const elements = Array.from(column.querySelectorAll<HTMLElement>(".dvx-question-anchor"));
const scrollerTop = layoutTop(scroller);
const activeIndex = findActiveQuestionIndex(
  elements.map((element) => layoutTop(element) - scrollerTop),  // 每个锚点一次 offsetParent 链爬升
  scroller.scrollTop,
);
```

`layoutTop()`（同文件 :69-79）逐层累加 `offsetTop` 直到 `offsetParent` 为空。`offsetTop` 是 layout-inducing 属性，整批读取会强制一次完整布局。

触发源：

- 滚动（:159）
- `ResizeObserver` 观察 scroller **和** column（:163-166）
- `MutationObserver(column, { subtree: true, childList: true })`（:171-172）——注意是 **subtree**，流式输出期间每一次 DOM 插入都会排队一次 measure

### 2.4 不在这条路径上的模块

- `useSmoothFollowScroll.ts` 只被 `SideChatSheet.tsx:45` 使用，不参与主 transcript。
- React 重渲染基本可以排除：`DroidThread`、`AssistantMessage`、`DroidMarkdownText`、`DroidMarkdownContent`、`MermaidBlock`、`InteractionPanel`、`SubagentSummaryRow` 均已 `memo()` 包裹；`updatePins` 的 `setAwayFromBottom` 与 `measure` 的 `setState` 都做了同值 bail-out。

---

## 3. 根因分层

| 层 | 内容 | 单独存在时的后果 |
| --- | --- | --- |
| A | 无虚拟化，DOM 节点上万 | 浏览器每次布局本身就贵（十几到几十 ms） |
| B | 两条每帧 O(n) 的**强制同步布局**测量链 | 每帧额外 2 次全量布局 |
| C | 触发源过密：resize / mutation 与 scroll 同等待遇，都按帧跑 | 拖动与流式期间 B 被持续拉满 |

### 为什么拉伸比滚动严重

滚动时：浏览器不需要重新排版文本，一帧内的布局主要是"重新计算位置"。我们额外强制 2 次。

拉伸时：宽度变化让**几百条 markdown 全部重新折行**，这是最贵的一类布局；同时 `ResizeObserver` 每帧触发 → 链 A、链 B 各强制一次全量布局。于是每帧至少三次万节点级布局，其中两次是我们自找的。帧预算 16ms，实际耗时可能是它的十几倍，表现就是"拖动时界面冻住"。

结论：**A 决定了单次布局的价格，B+C 决定了每帧买几次。** 只砍 B+C 就能让拉伸从"卡死"回到"能用"；要让长会话滚动彻底顺滑，还得动 A。

---

## 4. 方案分档

三档可叠加，风险与工作量递增。建议按顺序落地，每档单独打包让用户实测后再决定是否继续。

### 档位 1：触发源分级（解决"拉伸卡死"）

**做什么**

1. 把 `Thread.tsx` 的 `ResizeObserver` 回调拆成两件事：
   - 粘底（`followBottom` 里写 `scroller.scrollTop`）保持即时——它便宜且必须跟手；
   - `updatePins` 的调度改为 resize 专用节流：拖动过程中最多每 ~200ms 一次，最后一次 resize 之后 ~120ms 补跑一次。
2. `useQuestionNavigation` 的 `ResizeObserver` 与 `MutationObserver` 同样改为 ~150ms 防抖。导航列表不需要逐帧精度；滚动路径保持原样（仍按帧）。

**改动面**：`Thread.tsx`（约 15 行）、`useQuestionNavigation.ts`（约 15 行）。不触碰 `computeStickyLayout` 与 pin 判定逻辑。

**风险**：拖动过程中 sticky 头部的位置/压缩态短暂失准，松手后归位。属于可接受的过渡态；如果用户觉得难看，可把节流窗口调到 ~80ms。

**预期收益**：拉伸时每帧的自找布局从 2 次降到 0，只剩浏览器自身必须做的重新折行。拉伸从"卡死"变为"有点重但连续"。滚动卡顿**不解决**。

**失效场景**：如果用户的会话大到浏览器自身单次重排就超过 100ms，拉伸依然会顿——那需要档位 3。

### 档位 2：坐标缓存（解决"平时滚动也卡"）

**做什么**

把两条链的输入从"每帧向 DOM 要坐标"改成"缓存文档坐标 + 每帧纯算术"。

```ts
interface PinMetrics {
  readonly elements: readonly HTMLElement[]; // .dvx-message-user，文档序
  readonly tops: readonly number[];          // 相对 scroller 内容坐标
  readonly heights: readonly number[];
  readonly scrollerViewportTop: number;      // scroller 的 getBoundingClientRect().top
  readonly scrollHeight: number;             // 失效信号
  readonly clientHeight: number;             // 失效信号
}
```

滚动帧只做：

```ts
const top_i = metrics.tops[i] - scroller.scrollTop + metrics.scrollerViewportTop;
```

即每帧只读一次 `scroller.scrollTop` / `scrollHeight`，其余全是数组算术，n=500 也是微秒级。

**缓存失效必须覆盖的时机**（漏掉任意一条都会导致 pin 错位，这是本档位的主要风险）：

| 时机 | 信号 |
| --- | --- |
| 流式输出让 assistant 消息长高 | 每帧比对 `scroller.scrollHeight`，变化即置脏 |
| 图片 / mermaid / 代码高亮异步加载完 | 同上（都会改变 scrollHeight） |
| 卡片展开折叠、编辑卡打开 | 同上 |
| 宽度变化导致重新折行但总高恰好不变 | `ResizeObserver` 显式置脏 |
| 消息增删、"显示更早"预置历史 | `MutationObserver` 显式置脏 |

即：**scrollHeight/clientHeight 逐帧比对 + 两个 observer 显式置脏**，置脏后的下一帧重新做一次 O(n) 测量。稳态滚动（内容不变）时零布局读取。

`useQuestionNavigation` 用同一套缓存思路：缓存 anchor tops，滚动帧只跑已有的纯函数 `findActiveQuestionIndex(cachedTops, scrollTop)`。

**改动面**：新建 `src/webview/assistant/pinMetrics.ts`（测量与失效判定的纯逻辑 + 单测），`Thread.tsx` 改为调用它，`useQuestionNavigation.ts` 同步改造。

> 预算约束：`Thread.tsx` 现有 996 行，ratchet 记录 1041（`scripts/checkFileBudgets.mjs:31`），只应变小。本档位的新逻辑必须落在新模块里，顺带把 `updatePins` 的采集部分搬出去，Thread.tsx 应当净减行。

**风险**：中。sticky 交接（`PIN_ENTER_PX` / `PIN_RETAIN_PX` 死区、`pushPx` 推出动画）对 top 的精度敏感，缓存过期一帧就可能看到跳动。缓解：置脏后立即在同帧重测而不是延后；保留一个"每 N 帧强制重测一次"的兜底开关便于对拍。

**预期收益**：长会话滚动从"每帧 2 次全量布局"降到 0 次，滚动手感与短会话基本一致。

### 档位 3：降低浏览器自身的布局量（解决 A）

三条路线，按性价比排序：

**3a. 屏幕外消息 `content-visibility`（推荐先试）**

```css
.dvx-message-assistant:not([data-pinned]) {
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}
```

浏览器跳过屏幕外子树的布局与绘制，拉伸时不再重新折行几百条 markdown，单次布局成本可能降一个数量级。VS Code webview 是 Chromium，`content-visibility: auto` 与 `contain-intrinsic-size: auto <len>`（记忆实际尺寸）均可用。

- 只给 assistant 消息加，**不要**给 `.dvx-message-user` 加——它们参与 sticky pin、`getBoundingClientRect` 与 transform。
- 已知副作用：向上滚动时若 intrinsic 尺寸估算与实际不符，滚动条与滚动位置会抖动；与"显示更早"的 `scrollTop` 补偿逻辑（`Thread.tsx:533-546`）可能互相干扰。
- 另需回归：webview 内查找（Ctrl+F）无法命中被跳过的内容；问题导航 `scrollQuestionToTop` 依赖 `offsetTop`，有 intrinsic size 时仍然可用但可能不精确。

**必须由用户实测决定去留**，这是本方案里唯一一条"可能引入新体感问题"的改动。

**3b. 真正的虚拟化（v0.7.67 已落地）**

只渲染视口附近的回合：`ThreadPrimitive.Unstable_MessageById` +
`@tanstack/react-virtual`，spacer 用 padding 以保留 sticky CSS。
`rangeExtractor` 强制挂上当前 pin、下一条 user、最后一回合。问题导航
走 runtime user 消息 + `scrollToIndex`。数据窗口（60/+120 Show earlier）
本轮保留，避免把整段恢复历史一次性推进 assistant-ui。
Session viewer 的 `ReadOnlyTranscript` 在 v0.7.68 套用同一套
虚拟列表（无 sticky / 问题导航 / Show earlier）。未挂载正文
Ctrl+F 搜不到；单条极长 assistant 仍整回合挂载。

**3c. 窗口策略微调**

`MESSAGE_WINDOW_STEP` 从 120 降到 40，或提供"收起历史"回到默认窗口。成本几乎为零，但只是把问题推迟——用户主动展开后照样卡。可作为 3a/3b 落地前的止血。

---

## 5. 建议顺序

1. **档位 1** 单独打包 → 用户实测拉伸。如果拉伸恢复可用，主诉解决一半。
2. **档位 2** 单独打包 → 用户实测长会话滚动与流式输出。重点看 sticky 头部有没有跳动。
3. 若前两档之后仍嫌重，再上 **3a**，并准备好一键回退（纯 CSS，回退成本低）。3c 可在任何时候作为止血手段单独发。

每档之间不要合并发布：三档修改的是同一条链路的不同环节，合并后一旦出现 sticky 跳动或滚动位置异常，无法判断是谁引入的。

---

## 6. 验证方式

遵循项目既定 delivery loop（`AGENTS.md`）：只跑 `tsc --noEmit`、`pnpm run lint:budgets`、被改文件的单测，其余交给用户在真实 UI 验收。

- 单测：档位 2 的 `pinMetrics.ts` 用纯函数单测覆盖 tops 换算与失效判定；`stickyLayout.ts`、`findActiveQuestionIndex` 已有的单测不得回归。
- 用户实测清单（每档发版时附给用户）：
  1. 恢复一个大会话并点满"显示更早"，拖动侧边栏宽度 3 秒——是否连续；
  2. 快速滚动到顶再到底——sticky 用户消息是否有跳动、覆盖态是否正确；
  3. 大历史下发起一轮新对话——流式输出期间是否掉帧、是否仍能粘底；
  4. 点击问题导航条目——是否精确跳到对应问题顶部。

---

## 7. 明确不做

- 不改 `computeStickyLayout` 的交接语义与死区常量（那是已调好的手感）。
- 不并入档位 1 的 resize 节流或档位 3a 的 `content-visibility`（3b 已单独发版）。
- 不在本轮取消 `runtimeAdapter` 的 60/+120 数据窗口。
- 不为性能删除 `memo` 之外的现有结构；React 重渲染已被排除，不在这条链路上花时间。
