# Cursor 风格流式体验统一实施设计

Status: **已实现，仅存档**（2026-08-12 三批全部落地，实现与验证记录
见 `implementation-status.md`；tier1 §1 流式命令输出预览为独立保留项
未开工）。撰写日期 2026-08-12，基于当日两份调研与当日工作树代码
（行号引用该状态）。文中"V1 #7"为撰写时旧排序，最终落位 V1 #6。

本文合成两份调研为一份可直接开工的实施设计，占用 V1 #7 的排期位：

- [`cursor-streaming-ux-research.md`](./cursor-streaming-ux-research.md)
  —— 流式正文 / Thinking / Todo / 状态行 / 入场动画 / 动效 token。
- [`activity-aggregation-research.md`](./activity-aggregation-research.md)
  —— 工具调用聚合专题（分组规则、运行中预览窗、完成态摘要行）。

与 [`tier1-polish-plan.md`](./tier1-polish-plan.md) 的替代关系见
第 3 节（该文档保持原样不改，替代关系只在本文与 HANDOVER 记录）。

## 1. 目标与用户确认记录

**一句话目标**：AI 输出期间的呈现全面对齐 Cursor 的设计语言——
"动画只属于正在发生的事"：连续探索类工具折成聚合组（运行中滚动
预览、完成后量化摘要行），Thinking 运行中 shimmer、完成切过去式
文案，入场动画只给活跃流式内容、历史回放全静默。

**用户诉求出处**：用户于 2026-08-12 凌晨明确要求"AI 输出时的呈现
全面参考 Cursor 的实现"，直接起因是一张 20+ 行同类工具行（Read /
Grep 等）平铺堆叠的截图。两份调研即为此立项，本文是其实施合成。

## 2. 实施分项

五个分项按依赖顺序排列。每项给出：Cursor 参考行为（引调研文档
章节）、DroidVisX 适配设计、改动文件与层、工作量级、验收标准。

统一前置（原姊妹文档 H 项）：在 `styles.css` 顶部定义小型动效
token 表，本文全部新增动效引用它，存量动画不强制迁移：

```css
--dvx-duration-instant: 50ms;   /* hover 让位、瞬时反馈 */
--dvx-duration-fast: 100ms;     /* 淡入 */
--dvx-duration-normal: 150ms;   /* 折叠展开、chevron */
--dvx-duration-slow: 200ms;     /* 逐项淡入、块级入场 */
--dvx-duration-slower: 300ms;   /* 大块入场上限 */
--dvx-easing-out-strong: cubic-bezier(0.215, 0.61, 0.355, 1);
```

### A. 工具活动聚合（主体）

**Cursor 参考行为**（activity-aggregation-research 全篇，尤其
§1 分组规则、§3 运行中形态、§4 完成后形态）：

- 对回合内步骤做顺序扫描，13 种探索类工具按**序列连续性**分组，
  纯读/ls 组门槛 ≥3 条；待审批编辑与回合末文本永不入组。
- 运行中只有最后一个组是 loading 态：组头进行时动词
  （Exploring）套 shimmer，其下 `max-height:144px` 自动滚到底的
  实时预览窗，顶部 32px `mask-image` 渐隐，旧条目上滑出视野；
  组头文案更新节流 200ms。
- 完成后预览消失，收成一行"过去式 + 量化明细"
  （"Explored 3 files, 2 searches"），chevron 以 150ms height
  过渡展开逐条明细；用户手动展开状态自持。

**DroidVisX 适配设计**（纯 Webview，零 Bridge/Host/Runtime 改动
——调研已证实分组只需 `toolName` + parts 顺序 + status，全部已在
`tool.activity` 投影与 transcript 字段中传输）：

分组规则（按 `summarizeToolAction` 的归一化 toolName 分类，
`src/shared/toolActivity.ts:35-46`）：

- **可分组（探索类）**：read / grep / glob / ls / websearch /
  fetchurl / taskoutput / skill。
- **不分组**：execute（保持平铺，tier1 §1 输出预览按原行实现）、
  edit / write / create / applypatch（文件变更行有独立价值，
  filePath 按钮保留）、askuser / todowrite / exitspecmode / task
  及一切带 interaction 的步骤。
- 只聚合**连续**的可分组 tool-call parts；text / reasoning /
  data part 切断分组（V1 不做 Cursor 的"吞 thinking/短文本"，
  降低复杂度，效果差异小）。
- 成组门槛 ≥3（对齐 Cursor 纯读组门槛）；1-2 条保持现有散行。
- 回合最后一条文本天然不入组（parts 顺序保证）。

两态形态：

- **运行中**（组内含 running 步骤、且是消息最后一个组、且消息
  running）：组头 `Exploring…` 套 `.dvx-shimmer-text`（合并语义
  见第 4 节）；组体 `max-height:144px` 滚动容器 + 内容变化时
  `scrollTop = scrollHeight` 瞬时置底（Cursor 贴底 motion 也是
  instant）+ 顶部 32px mask 渐隐；组内行复用现有
  `ToolActivityRow`，加 dim 类（次级文字色、抑制行级 shimmer）。
  点击预览任意处切换为完整展开。组头文案更新节流 200ms（一个
  `useThrottledValue` 等价 hook）。
- **完成后**：预览移除（无收纳动画，对齐 Cursor"shimmer 停 +
  文案切换即收尾"），收成一行
  `Explored 3 files, 2 searches · 4.1s`。chevron 展开完整
  `ToolActivityRow` 列表，height 过渡
  `var(--dvx-duration-normal)` + `--dvx-easing-out-strong`。
  用户手动展开状态自持，不因完成重置。

完成文案（我们的语义分类计数，英文 UI 与现有行文案一致）：

| 类别 | 计数来源 | 文案片段 |
| --- | --- | --- |
| 文件 | read 的 filePath 文件名去重 | `N files`；恰好 1 个且居首时直接显示文件名 |
| 搜索 | grep / glob / websearch | `N searches` |
| 目录 | ls | `N folders` |
| 抓取 | fetchurl | `N fetches` |
| 委托检查 | taskoutput | `N task checks` |
| 技能 | skill | `N skills` |

时长为组内步骤 durationMs 之和（缺失项跳过）；组内任一步骤
failed/stopped 时组头附 `· 1 failed` 类后缀并保持可展开定位。

**改动文件与层**（全部 Webview）：

- 新增 `src/webview/assistant/activityGrouping.ts`：纯函数
  （parts 数组 → 组/散行序列）+ 摘要文案函数；vitest 单测。
- `src/webview/assistant/Thread.tsx`：`AssistantMessage`
  （`Thread.tsx:518-574`）从 `MessagePrimitive.Parts` 逐 part
  渲染改为读取消息 parts 数组、经 `useMemo` 分组后渲染；新增
  `ToolActivityGroup` 组件（两态 + 节流 + 自动滚动）。
- `src/webview/assistant/styles.css`：组样式、预览窗 mask、
  height 过渡、dim 规则、shimmer 合并规则（第 4 节）。
- store / runtimeAdapter / Bridge / Host / Runtime：**零改动**。

**工作量级**：大（本设计的主体切片）。

**验收标准**：

- harness 连续投递 ≥5 个 read/grep activity：组头 shimmer +
  预览窗自动滚动可见，旧条目从顶部蒙版渐隐。
- 完成后收成 "Explored N files, M searches"，点开可见逐条
  `ToolActivityRow` 明细，height 过渡 150ms。
- 1-2 条探索调用、execute、edit、todowrite 保持现有散行形态。
- 历史恢复的转录走同一分组逻辑，直接呈现完成态（无 loading
  组、无入场动画，联动 D 项验证）。
- 真实 Cursor 中跑一次多文件探索任务做可见核对。

### B. Thinking / 状态行打磨（最小）

**Cursor 参考行为**（cursor-streaming-ux-research §2、§5）：
运行中 "Thinking" 标签套 make-shine shimmer；完成后切过去式
"Thought for 3s"（`<500ms → "Thought briefly"`；取整 0 秒但有
毫秒 → 一位小数）；完成时只是文案切换 + shimmer 停止，无额外
动画。流结束强制折叠用户手动展开的块被官方确认为缺陷，
**不跟进**。

**DroidVisX 适配设计**：

- `ThinkingRow`（`Thread.tsx:641-676`）running 时给标签文本包
  `<span className="dvx-shimmer-text">`，复用既有类
  （`styles.css:1223-1238`，1.6s 周期暖色渐变，不对齐 Cursor 的
  2s——风格差异，调研已判不必对齐）。
- 完成后标签由 `Thinking` + `complete · 3.2s` 改为过去式一体
  文案：新增 `formatThinkingLabel(durationMs)` ——
  `<500ms → "Thought briefly"`；`<1s → "Thought for 0.7s"`；
  其余复用现有 `formatDuration`（`Thread.tsx:1758-1771`）拼
  `Thought for 3s` / `Thought for 1m 12s`。真实思考耗时已有：
  `readReasoningDuration`（`Thread.tsx:1748-1751`）。
  durationMs 缺失时降级为 `Thought`。stopped（incomplete）态
  显示 `Thinking stopped`。
- 用户展开状态保持每行自持（现状），流结束不强制折叠。
- `PendingResponse`（`Thread.tsx:777-796`）已是 shimmer +
  交互等待隐藏，不动。

**改动文件与层**：`Thread.tsx`（ThinkingRow + 格式函数）、
`styles.css`（如需微调状态区排版）。纯 Webview。

**工作量级**：小（一个类名 + 一个格式函数）。

**验收标准**：harness 触发含 thinking 的回合——运行中标签
shimmer（`getComputedStyle` 验 animationName，非类名）；完成后
显示 "Thought for Xs"；<500ms 场景显示 "Thought briefly"；
交互等待时 shimmer 静默（第 4 节规则）；reduced-motion 下静态。

### C. 流式正文平滑（结论项，不排工作量）

**Cursor 参考行为**（cursor-streaming-ux-research §1）：
WordStreamer 把每个 delta 按空白切 ≥16 字符词块、200ms 内均匀
铺开，新 delta 到达即 flush，保证展示永不落后于真实流。

**结论：现状够用，不做 WordStreamer 式增强。**

- assistant-ui `useSmooth` 逐字符 typewriter（正文
  `TEXT_SMOOTH_OPTIONS`，`MarkdownText.tsx:20-25`；思考
  `THINKING_SMOOTH_OPTIONS`，`Thread.tsx:45-50`）与 WordStreamer
  目标一致（平滑 + 有界追赶），粒度差异（字符 vs 词块）观感
  相近——调研原文判定"不必改造引擎，assistant-ui 的 smooth 是
  能力边界内的正确选择"。
- 库内建 `prefers-reduced-motion` 直出全文、非 running 历史不
  动画，已等价于 Cursor 的回放静默原则（文本层）。
- Cursor 的 token 级淡入（fade-in-fast .1s）不单独跟进：字符级
  流出下逐 token 淡入无对应锚点，块级入场淡入由 D 项覆盖。

若后续用户反馈正文"卡顿感"，调参入口是 `minCommitMs` /
`maxCharsPerFrame`，不引入新引擎。

### D. 入场动画与回放静默

**Cursor 参考行为**（cursor-streaming-ux-research §6、§7）：
块级入场统一"淡入 + 2-4px 上移"小位移（`fadeInSlideUp` .3s
ease-out；列表项 .2s + 2px），从不大开大合；
`cloud-no-entry-animations` 容器类一刀切禁用全部入场动画——
恢复/回放的历史内容不重播，动画只属于活跃流式。

**DroidVisX 适配设计**：

入场动画（并入原 tier1 §4 范围）：

- 首个 assistant 文本块挂载：淡入 + 4px 上移，
  `var(--dvx-duration-slow)`（200ms）`ease-out`。
- 新工具行 / 聚合组行入场：纯淡入 `var(--dvx-duration-fast)`
  （100ms）。
- 消息完成时 action bar（`dvx-assistant-actions`）淡入
  `var(--dvx-duration-normal)`（当前瞬显）。

回放静默边界（**本项的核心，必须与入场动画同批落地**）：

- 入场动画 CSS 全部以根类 `dvx-anim-live` 为前缀（opt-in，等价
  Cursor 的 no-entry-animations 反相开关）。`App.tsx` 仅当
  `connection.status === 'connected'` **且**存在活跃 turn
  （既有 `running` 派生值）时在 shell 根挂该类。
- 由此天然静默的路径（全部不重播入场动画）：
  1. **切片②早期快照**：恢复检查点渲染时 connection 为
     `connecting`（implementation-status 2026-08-12 记录：早期
     `host.snapshot` 先于 runtime ready 到达，连接保持
     connecting）——类不挂，静默；
  2. **权威激活快照整体替换**与 **reconcileSessionHistory**
     对齐：发生在无活跃 turn 时，类不挂；
  3. **历史加载 / 会话切换 / Show earlier**（窗口扩展重渲染）：
     无活跃 turn，静默；
  4. **Reload Window 后恢复**：同 1。
- 已知边界风险（如实记录）：若 reconcile 恰在活跃 turn 中途整体
  替换转录，running 消息的新块会重播一次入场动画。该路径罕见且
  仅影响单条消息，V1 接受；若实测刺眼，追加消息级门控（复用
  `useAuiState` 的 `message.status?.type === 'running'`，
  `Thread.tsx:1644-1646` 已有同款用法）。
- 文本层无需处理：`useSmooth` 对非 running 内容本就直出。

**改动文件与层**：`App.tsx`（根类一行）、`styles.css`（入场
动画 + token 引用）、`Thread.tsx`（如需给首块/新行挂动画类）。
纯 Webview。

**工作量级**：中。

**验收标准**：

- 活跃回合中首个文本块、新工具行、action bar 可见入场动画。
- 重开窗口（早期快照 + 权威快照两个阶段）、切换会话、
  Show earlier：整屏历史零入场动画（DOM 验证无动画类生效或
  `getComputedStyle` animationName 为 none）。
- reduced-motion 下全部静态就位。

### E. Todo / 计划行折叠摘要与逐项淡入

**Cursor 参考行为**（cursor-streaming-ux-research §4）：todo
摘要行展开走 `max-height 0→500px .25s ease-in-out + opacity
.2s`；每项 `todoFadeIn .2s ease-out`（淡入 + 2px 上移）；进行中
项 bullet 旋转指向当前项，完成项 `opacity:.5 + line-through`。

**DroidVisX 适配设计**（对接现有 task-plan detailKind）：

- 宿主不变：todowrite 的 `ToolActivityRow`
  （detailKind === 'plan'，`Thread.tsx:1632-1718`）。**收起**时
  summary 行在现有 action 文案后追加计划摘要
  `3/7 · <当前 in_progress 项文本>`（截断同
  `firstLine`）——长计划收起后仍知道进行到哪，替代"占满转录"。
- **展开过渡**：`.dvx-plan` 容器由现有 `dvx-disclose-in`
  220ms 改走 `max-height + opacity` 过渡
  （`--dvx-duration-slower` 300ms 内完成，opacity
  `--dvx-duration-slow`），与 A 项折叠体系同 easing。
- **逐项淡入**：`.dvx-plan-step` 挂 `dvx-todo-fade-in`
  （opacity 0→1 + translateY 2px→0，`--dvx-duration-slow`
  ease-out）。key 沿用列表 index：计划更新时既有 index 的节点被
  React 复用不重播，仅新增尾项播放淡入——正好是"新项出现"语义。
- 当前项标记保留暖色呼吸圆点（`dvx-plan-pulse`，
  `styles.css:1325-1334`）；Cursor 的旋转箭头指示不跟进（呼吸点
  是既有视觉语言，方向指示收益不明确）。
- 现有"运行中默认展开、历史默认收起"逻辑（`Thread.tsx:1639-1649`）
  保持不变。

**改动文件与层**：`Thread.tsx`（summary 摘要 + TaskPlan）、
`styles.css`。纯 Webview。

**工作量级**：小到中。

**验收标准**：harness 投递多步计划——收起态可见 `3/7 · 当前项`
摘要；展开有过渡；计划更新新增项淡入、既有项不闪；
reduced-motion 下过渡与淡入全静态；历史恢复的计划行收起且无
动画（联动 D）。

## 3. 与 tier1-polish-plan 的替代关系

`tier1-polish-plan.md` 本身**不修改**（实现流水线代理正读取其
§3），替代关系以本节为准：

| tier1 条目 | 处置 | 说明 |
| --- | --- | --- |
| §1 流式命令输出预览 | **保留原设计，独立切片，不并入 A** | execute 在 A 的分组规则里明确不分组，行形态不变，§1 的 Runtime/Bridge/Host `outputTail` 通道是 A 无法替代的独立能力。实现时须遵守本文约束：输出区固定 max-height 内部滚动，避免高度突变打断贴底（调研 §1 记录的 Cursor 已知痛点）；排期在本设计三批之后或与批次三并行 |
| §2 收起状态滚动播报 | **被 A 替代（superseded），不再实现** | A 的组级预览窗是其严格超集（最近数条 vs 最近一条），且聚合落地后"收起的探索行"宿主形态本身消失；§2 中唯一独立有价值的 outputTail 尾行展示已被 §1 覆盖。论证详见 activity-aggregation-research 第 3 节 |
| §3 恢复提速 | 已由切片②实施（2026-08-12 凌晨），不在本设计范围 | 本设计 D 项的回放静默边界对接其早期快照机制 |
| §4 AI 回复动画 | **并入本设计 D 项** | §4 的 160ms 淡入 + 4px 上移方向与 Cursor 一致；D 在其上补齐了 §4 未覆盖的"历史恢复不重播"边界与动效 token |

## 4. 全局约束

### prefers-reduced-motion 全量静态降级（仓库既有惯例）

- 既有全局 kill-switch（`styles.css:3854-3877`）只压制
  **animation**（`animation-duration:0.001ms`）；本设计新增的
  **transition**（A 的 height 过渡、E 的 max-height/opacity
  过渡、chevron 过渡）不被它覆盖，必须在 reduce 块内显式补
  `transition-property: none`（Cursor 本机 CSS 对折叠过渡也是
  这么做的）。
- shimmer（B、A 组头）已被既有 `.dvx-shimmer-text` reduce 规则
  覆盖（`styles.css:3869-3876`），验证即可。
- D 的入场动画、E 的逐项淡入是 animation，被全局块覆盖，内容
  直接就位；`useSmooth` reduce 时直出全文，两层降级一致。
- A 的预览窗自动滚动是瞬时 scrollTop 赋值、蒙版是静态样式，与
  reduce 正交，保留。

### 长会话性能

- 分组计算只在渲染窗口内发生：`DEFAULT_MESSAGE_WINDOW = 60`
  （`runtimeAdapter.ts:48`），每条 assistant 消息的分组经
  `useMemo` 以 parts 数组为依赖缓存——窗口外消息不参与，单条
  消息 parts 变化只重算该消息。
- `AssistantMessage` 保持 `memo`（`Thread.tsx:518`）；分组渲染
  不得引入跨消息共享 state 导致整树重渲染（Thinking 行全局展开
  状态曾造成卡死，implementation-status 2026-08-12 有案）。
- 组头文案 200ms 节流，防止步骤密集到达时标签闪烁与高频重渲。
- 预览窗自动滚动在 effect 中按"步骤数"触发，不逐帧监听。
- 离屏暂停动画（调研 J 项）不入本设计范围，随缘。

### 与既有 shimmer 单行规则的合并语义

activity-shimmer-fix-design（已实现）确立的不变式：**每回合至多
一个 shimmer；交互等待时全静默**。本设计新增两个 shimmer 载体
（Thinking 标签、聚合组头），不变式保持并扩展：

| 场景 | shimmer 归属 |
| --- | --- |
| 聚合组 loading（消息最后一个组） | 仅组头 shimmer；组内预览行挂 dim 类抑制行级 shimmer（替代原 `:has(~)` 兄弟规则在组内的作用） |
| 组外散行 running | 既有规则不变：`:has(~ .dvx-activity-running)` 只留最新行（`styles.css:1244`） |
| Thinking running | 标签 shimmer；reasoning part 与 tool-call part 不同时 running（顺序流），无并发冲突 |
| 交互等待（`dvx-thread-pending`） | 既有抑制规则（`styles.css:1245`）扩展选择器，把 Thinking 标签与组头 shimmer 一并静默；`PendingResponse` 本就随 `showPending` 隐藏 |
| 历史 / 恢复渲染 | 无 running 状态，天然无 shimmer；叠加 D 的入场静默 |

实现上将三类载体统一为 `.dvx-shimmer-text` + 场景抑制规则，
CSS 集中一处，避免规则漂移。

## 5. 实施顺序与切片划分建议

**建议拆 3 个切片分批交付**（一个切片做完 A-E 体量过大，且 B 可
先行独立见效）。每批独立走完 HANDOVER 第 4 节完成门禁
（typecheck / test / build / package / install / 可见验收）并
更新 `implementation-status.md`。

| 批次 | 内容 | 可观察完成标准 |
| --- | --- | --- |
| 批次一：B + 动效 token | Thinking shimmer、"Thought for Xs" 文案、`--dvx-duration/easing-*` token 表 | 真实会话中 thinking 运行时标签 shimmer、完成显示 "Thought for 3s"；token 在 styles.css 顶部就位并被 B 引用；reduce 验证通过 |
| 批次二：A（含过去式量化文案，即原调研 G 项） | activityGrouping 纯函数 + 单测、ToolActivityGroup 两态、预览窗、摘要文案、折叠过渡、shimmer 合并规则 | harness ≥5 连续探索调用可见组头 shimmer + 滚动预览；完成收成 "Explored N files, M searches" 可展开；散行/execute/edit 形态不变；真实 Cursor 多文件探索任务核对 |
| 批次三：D + E | `dvx-anim-live` 根类、入场动画、回放静默验证、Todo 折叠摘要 + 展开过渡 + 逐项淡入 | 活跃回合有入场动画；重开窗口/切会话/Show earlier 整屏静默；计划行收起显示 `3/7 · 当前项`、新增项淡入；reduce 全静态 |

依赖关系：批次一的 token 是批次二/三动效参数的引用源；批次二的
组完成态与批次三的回放静默共享"历史渲染呈现完成态且无动画"的
验证路径，批次三收尾时对批次二做一次回归核对。C 为结论项，无
排期。tier1 §1（保留项）在三批之后另行开片。
