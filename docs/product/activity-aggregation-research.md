# Cursor 工具调用聚合展示调研

> 状态：**已经由 [`streaming-experience-design.md`](./streaming-experience-design.md)
> 合成实施并落地，仅存档**。保留价值：Cursor 分组规则/CSS/动效的
> 一手证据，后续打磨时查证据用。文末"建议并入 V1 #7"为旧排序
> （最终落位 V1 #6）。

调研日期：2026-08-12。目标：实证 Cursor IDE 聊天界面如何把连续的
同类型工具调用聚合成摘要行，作为 DroidVisX activity 行改造依据。

姊妹文档：`docs/product/cursor-streaming-ux-research.md`（流式正文
/Thinking/Todo/状态行动画）。本文只覆盖工具调用聚合专题，动效
token（`--cursor-duration-*`、make-shine 参数）以姊妹文档为准。

证据来源与置信度标注：

- **[本机]** 本机 Cursor 3.15.6（`D:\cursor\resources\app\out\vs\
  workbench\workbench.glass.main.js` / `workbench.desktop.main.js`
  反编译产物；stylex CSS 内嵌在 JS 中而非独立 css 文件）。完整的
  `step-grouping.js` / `step-group-display.js` /
  `StepGroupSummaryView.js` / `GroupedSteps.js` 模块源码已还原，
  逻辑与 CSS 均为高置信。
- **[Web]** forum.cursor.com 官方回复（thread 165292，聚合行为的
  产品级确认），高置信。
- 实证不了的条目明确标注"未能证实"。

中间产物（原始提取文本）在 `artifacts/`：
`cursor-step-group-display.txt`（分组+摘要文案+摘要视图完整源码）、
`cursor-step-grouping-region.txt` / `cursor-uistep-grouped-region.txt`
（周边区域）、`cursor-collapsible-see.txt`（See 折叠组件）、
`cursor-conversation-density.txt`（密度设置）、
`cursor-legacy-group-config.txt`（旧版分组配置）、
`cursor-ydc-shimmer.txt`（节流 hook + NumberRoll）、
`cursor-shimmer-numberroll-css.txt` 与 `aggregation-group-css.txt`
（CSS 类定义与关键帧）。

## 结论速览

Cursor 对每个回合的步骤序列做**顺序扫描分组**：读文件、搜索、glob、
ls、web 检索、fetch、lint、MCP 工具枚举等"探索类"工具在**任何密度
设置下都会聚合**，纯读/ls 组需 ≥3 个调用才成组，浏览器操作与后台
等待各自成组（≥2）；穿插其间的 thinking 与短文本（≤100 字符、≤2
行、无代码块/列表）会被吞进组里，长文本、待审批编辑等不可分组步骤
则切断当前组。**运行中**，只有最后一个组处于 loading 态：组头显示
进行时动词（Exploring/Running）套 shimmer，其下是一个 max-height
144px、自动滚到底的实时预览窗（旧条目从顶部 32px 渐隐蒙版下滑出
视野）——既不是"替换显示"也不是纯计数，而是有界的滚动直播。**完成
后**预览消失，收成一行可展开的折叠行："过去式动词 + 量化明细"
（如 "Explored 3 files, 2 searches"，+A/−D 数字带 300ms 数字滚动
动画），点 chevron 以 150ms height 过渡展开逐条明细。

## 一、实证结论（逐条标证据与置信度）

### 1. 分组规则

**扫描模型（高置信，[本机] `step-grouping.js` 主函数完整还原）**

对回合内步骤（thinking / assistant-message / tool-call 混合序列）
做一次顺序扫描，维护三个并行缓冲：普通组、浏览器组、等待组。遇到
不可分组步骤即冲刷（flush）当前缓冲成组或散行。没有时间窗口概念，
**纯粹按序列连续性分组**。

**什么算"同类"（高置信）**

不是"完全相同的工具"，而是"同属可分组集合"：

- **始终可分组**（任何密度）：`readToolCall, grepToolCall,
  globToolCall, lsToolCall, semSearchToolCall,
  searchConversationsToolCall, readLintsToolCall, readTodosToolCall,
  fetchToolCall, webFetchToolCall, webSearchToolCall,
  getMcpToolsToolCall, generateImageToolCall`（源码集合 `MRc`）。
- **仅 compact-grouped / compact-all-grouped 密度可分组**：
  shell、delete、edit（edit 还要求已有结果）。
- **浏览器工具**（providerIdentifier 含 `cursor-ide-browser` /
  `cursor-browser-extension` 或 `browser_` 前缀）走独立的
  browser-group 缓冲，≥2 个才成组。
- **awaitToolCall**（后台任务轮询）走独立的 waiting-group 缓冲，
  ≥2 个才成组（常量 `RRc=2`）。
- **thinking**：有组在开时被吞入组（`groupThinking` 默认 true），
  时长累加进组摘要。
- **短 assistant 文本**：≤100 字符、≤2 行、且不含代码围栏/标题/
  列表/表格时被吞入组（`groupText` 默认 true）。
- **永不分组**：待审批（approval pending）的 edit/delete；回合完成
  时的最后一条 assistant 文本（最终回答永远独立成行）。

**成组门槛（高置信）**

- 纯 read/ls 组：`Math.max(minGroupSize, 3)` —— 至少 3 个调用。
  这就是"单次 Read 是独立行、连读三个文件折成 Explored"的原因。
- 组内含 thinking 时按总步骤数比对门槛；其余按 tool-call 计数。
- 组的切分：混入 edit/delete 或 shell 与其它类型混合时，非
  compact-all-grouped 密度下会拆成不同组（`separateShellGroups`
  等开关）；compact-all-grouped（**默认值**）下全部合并。

**密度设置（高置信，[本机] `conversation-density.js` + [Web]）**

五档：`detailed / compact-shells / compact-ungrouped /
compact-grouped / compact-all-grouped`，默认 `compact-all-grouped`；
旧值 verbose→detailed、minimal→compact-all-grouped。[Web] 官方论坛
（thread 165292）确认：Detailed 只把 edit/命令拉出组外，读/搜索/
MCP 调用**在所有密度下都折进 "Explored N tools"**，且这是设计意图
（自 3.10.20 起），团队在跟踪"完全展开"的用户诉求。

**旧版佐证（高置信，[本机] `cursor-legacy-group-config.txt`）**：
存在一份更老的按工具枚举的分组配置——RIPGREP_RAW_SEARCH /
SEMANTIC_SEARCH_FULL / FILE_SEARCH / READ_SEMSEARCH_FILES 互相
`groupWithTools`、`minGroupSize:2`、`groupType:"searching"`——
说明"搜索类互相聚合、最小 2 条"是延续多个版本的设计。

**非浏览器 MCP 调用的分组（中置信）**：共享组件的默认可分组集合不
含 `mcpToolCall`，但组摘要统计里有 mcpToolCalls/mcpServers 计数、
[Web] 论坛官方确认 MCP 调用会折进 Explored 组——判断实际调用方传入
了扩展的 `isToolGroupable`。分组事实成立，注入点未逐一定位。

### 2. 摘要文案生成

**组头文案 cascade（高置信，[本机] `step-group-display.js` 原文）**

按优先级依次尝试，取第一个命中：

| 组构成 | 运行中 action | 完成后 action + details |
| --- | --- | --- |
| 纯 thinking | Thinking | Thought + 时长（规则同姊妹文档 §2） |
| 全是浏览器操作 | Running | Ran `N browser action(s)` |
| 含 await 轮询 | Monitoring background task(s) | Monitored `background tasks, X complete, Y active` |
| 全是 shell | Running | Ran `N command(s)`；仅 1 条时直接用命令描述文本 |
| 全是生成图片 | Generating | Generated `N image(s)` |
| 含 edit/delete | 文件变更动词（Editing/Deleting…） | 过去式 + 文件数 + `+A -D` 变更统计 |
| 其余（默认） | **Exploring** | **Explored** + 计数列表 |

**Explored 明细列表（高置信）**：按类别计数逗号拼接——目录
（`N director(y/ies)`）、文件（恰好 1 个且居首时直接显示文件名，
否则 `N file(s)`）、`N search(es)`（glob/grep/semSearch/webSearch/
getMcpTools 都计入 searches）、`N fetch(es)`、`lints`、
`N tool(s)`（MCP）、`N browser action(s)`。文件列表取自 read 路径
的文件名去重。即 "Explored 3 files, 2 searches" 的精确来源。

**占位思考行（高置信）**：loading 组尾部可附一条模拟状态行，默认
文案 `"Planning next moves"`，另有 `"Wrapping up"`；若 thinking
末行已有等价标题则不重复显示。

### 3. 运行中形态

**只有最后一个组是 loading 态（高置信，[本机] `GroupedSteps.js`）**：
`loading = 回合运行中 && index === 最后一个分组`。之前的组已经是
完成形态（收起的摘要行）。

**loading 组 = shimmer 组头 + 实时预览窗（高置信，
[本机] `StepGroupSummaryView.js`）**：

- 组头 action（Exploring/Running…）经 See 折叠组件的 `loading`
  态渲染，文字套 shimmer（与 make-shine 同参数：60% 前景底 + 60%
  位置全亮渐变、`background-size:200% 100%`、关键帧
  `200% 0 → -200% 0`、2s linear infinite）。
- 组头下方渲染实时预览：`max-height:144px`（常量 `G7r=144`）滚动
  容器、`autoScrollToBottom`、内容变化触发滚动（`scrollTrigger`
  按步骤数+thinking 字符数累计）；顶部蒙版
  `mask-image:linear-gradient(to bottom, rgba(0,0,0,.15) 0px,
  black 32px)`——旧条目上滑时在顶部 32px 内渐隐。步骤行以次级色
  （dim）渲染。点击预览任意处 = 展开为完整明细。
- **新工具调用到达时既不是"替换旧行"也不是计数递增**：新行追加到
  预览底部，自动滚动把旧行推出蒙版——视觉上是"正在运行的顶上来、
  旧的收进上方"的滚动直播。
- **组头文案节流（高置信，[本机] `useThrottledValue`）**：loading
  期间 action/details 文本更新最快 200ms 一次，防止步骤密集到达时
  标签闪烁。
- chevron 默认 `opacity:0`，hover 组时渐显（transition
  transform/color/opacity，时长 normal/fast/fast = 150/100/100ms）；
  **loading 态 hover 时瞬显**（`transition-property:none`），保证
  运行中也能立即抓到展开入口。

### 4. 完成后形态

**收成一行可展开折叠行（高置信）**：预览窗消失（`showLoadingPreview`
只在 loading 且未手动展开时渲染），只剩 See 折叠行：过去式动词 +
量化明细，数字用 `tabular-nums`。点击/chevron 展开后逐条渲染组内
每个步骤（与散行完全相同的渲染器 `renderStep`），可嵌套展开单个
工具的详情。展开状态是组件内部 state——用户手动展开的组在流结束后
保持展开（`loading` 变化不重置 open）。

**+A/−D 数字滚动（高置信，[本机] NumberRoll 完整源码 + CSS）**：
文件变更统计的增删数字变化时逐位滚动——旧字符
`translateY(0)→translateY(±(100%+1px))` 淡出、新字符反向滑入，
时长 `--cursor-duration-slower`（300ms）、
`cubic-bezier(.215,.61,.355,1)`、`animation-fill-mode:both`，方向
随数值增减翻转，容器带上下渐隐蒙版。增/删分别用 git added/removed
语义色。

**没有"收纳动画"（未能证实为"有"）**：从 loading 到完成没有专门的
transition——预览窗是条件渲染直接移除，组头文字直接换。与姊妹文档
"完成即 shimmer 停 + 文案切过去式，无额外动画"的结论一致。

### 5. 动画细节（CSS 证据，最高置信）

| 动效 | 参数 |
| --- | --- |
| 组头 shimmer | keyframes `background-position:200% 0 → -200% 0`，2s linear infinite |
| 折叠展开/收起 | `transition-property:height`，`--cursor-duration-normal`（150ms），`cubic-bezier(.215,.61,.355,1)`；base-ui Collapsible 量测 scrollHeight 写入 `--collapsible-panel-height`，`[data-starting-style]/[data-ending-style]{height:0}` |
| chevron | hover 渐显 opacity 0→1，transform rotate(0→90deg)，时长 150/100/100ms；loading 态 hover 瞬显 |
| 预览窗蒙版 | `mask-image:linear-gradient(to bottom, rgba(0,0,0,.15) 0px, black 32px)` |
| NumberRoll | 300ms，`cubic-bezier(.215,.61,.355,1)`，translateY ±(100%+1px) + opacity |
| 组间距 | `--step-gap:6px`（组内步骤 gap 与折叠内容 gap 同源） |
| reduced-motion | `@media (prefers-reduced-motion: reduce)` 下折叠 height 过渡 `transition-property:none`（Cursor 少见的 reduce 覆盖之一） |

## 二、与 DroidVisX 现状差距

现状（`src/webview/assistant/Thread.tsx`）：

- `AssistantMessage` 用 `MessagePrimitive.Parts` 逐 part 渲染，每个
  `tool-call` part 一个 `ToolActivityRow`——20+ 次探索就是 20+ 行
  "Read workspace files · Completed · 0.2s"，无任何聚合。
- 行内已有：action 文案、状态、时长、detail（command/plan）、
  filePath、最新行 shimmer（activity-shimmer-fix：批量运行时只有
  最新行动画）。
- Bridge `tool.activity` 与 transcript tool 项均携带 `toolName` +
  预格式化 `action`（`summarizeToolAction`，
  `src/shared/toolActivity.ts`）+ status/progressCount/
  latestUpdateKind/durationMs/filePath/detailKind/detail。

差距对照：

| Cursor | DroidVisX |
| --- | --- |
| 探索类连续调用折成 "Explored N files, M searches" 一行 | 每调用一行，无折叠 |
| 运行中：组头 shimmer + 144px 自动滚动预览 | 每行独立出现，最新行 shimmer |
| 完成后：过去式 + 量化摘要，chevron 展开明细 | 行永久平铺，"Read workspace files · Completed · 0.2s" 无量化汇总 |
| 折叠 150ms height 过渡、数字滚动、蒙版渐隐 | 无对应动效（现有 `dvx-disclose-in` 220ms 仅用于单行展开） |

**聚合可以纯 Webview 实现，不动 Bridge**：分组只需要 `toolName`
（已传输）+ 序列顺序（parts 顺序即到达顺序）+ status。Webview 侧
把 `MessagePrimitive.Parts` 的逐 part 渲染改为先取整条消息的 parts
数组做分组变换再渲染即可（assistant-ui 支持自定义消息级渲染）。
Cursor 的量化明细（文件名列表、搜索计数）同样能从现有字段导出
（filePath、toolName 分类计数）。唯一取不到的是 Cursor 式
"+A −D" 组级变更统计——DroidVisX 的变更统计在回合级
（`turn.changes`），组级不必做。

## 三、与 tier1-polish-plan §2 的关系

tier1 §2（"收起状态滚动播报最近操作"）设计的是**单个工具行**收起时
用单行 ticker 播报最近一条进度——它假设的仍是"每工具一行"的世界。
本调研证实 Cursor 满足同一用户诉求（收起时仍知道在干什么）的实际
形态是**组级实时预览窗**（多行、有界高度、自动滚动、蒙版渐隐），
而非单行电报。

**建议：§2 被本专题替代（superseded），不再单独实现。**理由：

1. 聚合落地后"收起的 activity 行"这个宿主形态本身改变了——探索类
   行大多不再独立存在，ticker 无处安放。
2. 组级预览窗提供严格超集的信息量（最近数条 vs 最近一条），且有
   Cursor 实证背书。
3. §2 里唯一独立有价值的部分（单个 execute 工具的 outputTail 尾行
   展示）已被 tier1 §1 覆盖。

姊妹文档改造建议表中的 G 项（完成时"过去式 + 数量"文案）与本专题
是同一实现的两个面（组头完成文案），应合并为一个切片。

## 四、改造设计建议

### 分组规则（Webview 纯前端）

- 按 `toolName` 分类（复用 `summarizeToolAction` 的归一化逻辑）：
  - **探索类（可分组）**：read / grep / glob / ls / websearch /
    fetchurl / taskoutput / skill；
  - **命令类**：execute（独立成组，V1 可先不分组保持平铺）；
  - **编辑类**：edit / write / create / applypatch（V1 不分组——
    文件变更行有独立价值且已有 filePath 展示）；
  - **永不分组**：askuser / todowrite / exitspecmode / task 及一切
    带 interaction 的步骤。
- 只聚合**连续**的可分组 tool-call parts；text/reasoning/
  interaction part 切断分组（V1 不做 Cursor 的"吞 thinking/短文本"，
  降低复杂度；效果差异小）。
- 成组门槛：≥3（对齐 Cursor 纯读组门槛，避免两个调用也折叠显得
  过度收纳）。
- 回合最后一条文本永不入组（assistant-ui parts 顺序天然保证）。

### 两态形态

- **运行中**（组内有 running 步骤且是消息最后一个组）：
  - 组头：`Exploring…` + `dvx-shimmer-text`（复用既有单 shimmer
    规则：组头 shimmer 时组内行不再 shimmer）。
  - 组体：`max-height:144px` 容器 + 自动滚到底 + 顶部 32px
    mask-image 渐隐，逐条渲染现有 `ToolActivityRow`（加 dim 类，
    次级文字色）。点击任意处切换为完整展开。
  - 组头文案更新节流 200ms（一个 `useThrottledValue` 等价 hook）。
- **完成后**：预览移除，收成一行：
  `Explored 3 files, 2 searches · 4.1s`（文件恰好 1 个时直接显示
  文件名；时长为组内步骤时长之和，可选）。chevron 展开完整
  `ToolActivityRow` 列表。用户手动展开状态自持，不因完成重置。

### 动画参数

- 折叠展开/收起：height 过渡 150ms `cubic-bezier(.215,.61,.355,1)`
  （测量 scrollHeight 写 CSS 变量，或简化用现有
  `dvx-disclose-in` 体系但把时长对齐 150ms token——配合姊妹文档
  H 项的 `--dvx-duration-*` token 化一起做）。
- chevron：默认 opacity 0，hover 渐显 150ms；运行中 hover 瞬显。
- 预览窗滚动：`scrollTop = scrollHeight` 直接置底（Cursor 的贴底
  motion 也是 instant，见姊妹文档 §1），不做 smooth scroll。
- 完成收纳：不做专门动画（对齐 Cursor："shimmer 停 + 文案切换"
  即收尾）。
- NumberRoll 数字滚动：**不建议 V1 跟进**（DroidVisX 无组级 +A/−D
  数据源，且属锦上添花）。

### reduced-motion 降级

- height 过渡、chevron 过渡 → `transition-property:none`（Cursor
  自身也这么做，本机 CSS 实证）；展开收起瞬时切换。
- 组头 shimmer → 已被 `.dvx-shimmer-text` 既有 reduce 规则覆盖。
- 预览窗自动滚动本身是瞬时 scrollTop 赋值，与 reduce 正交；蒙版是
  静态样式，保留。

### Bridge / Host

**零改动。**分组、计数、文案全部由 Webview 从既有
`tool.activity` / transcript 字段导出。历史恢复的转录走同一分组
逻辑，天然呈现完成态（无 loading 组），且不播任何入场动画（与姊妹
文档 D 项"回放静默"共用同一根类开关）。

## 五、排期建议

**建议并入 V1 #7 第一档打磨，作为独立切片"activity 聚合"，替代
tier1 §2 的排期位。**

- 切片边界：Webview（Thread.tsx 消息级分组渲染 + styles.css 组
  样式/动效）+ 完成文案格式函数；不动 Runtime/Host/Bridge。
- 与姊妹文档切片的依赖关系：
  - 建议先做 H 项（动效 token 化），本切片的 150ms/200ms 直接引用
    token；
  - G 项（过去式 + 量化文案）合并进本切片；
  - D 项（回放静默）与本切片同步验证历史恢复路径；
  - tier1 §1（outputTail 预览）独立不冲突——组展开后 execute 行内
    的输出预览仍按 §1 实现。
- 顺序建议：tier1 §1 → 本切片（含 G）→ tier1 §4（含 C/D）。§2 从
  计划中移除。
- 验收：harness 连续投递 ≥5 个 read/grep activity 可见组头 shimmer
  + 预览滚动；完成后收成 "Explored N files, M searches"；点开可见
  逐条明细；reduced-motion 下无过渡；真实 Cursor 中跑一次多文件
  探索任务做可见核对。

## 附录：置信度最高的三条实证

1. **分组主函数**（`workbench.glass.main.js`，完整还原于
   `artifacts/cursor-step-group-display.txt` 行 110 附近）：顺序
   扫描 + 三缓冲（普通/浏览器/等待）；始终可分组集合 `MRc` 13 种
   探索类工具；纯 read/ls 组门槛 `Math.max(minGroupSize,3)`；
   browser/waiting 组门槛 2；待审批编辑与回合末文本永不入组。
2. **组摘要文案函数**（同上，`Crm`/`arm`/`Srm` 原文）：默认组
   loading "Exploring"、完成 "Explored" + 按类别计数逗号列表
   （单文件显示文件名、`N file(s)`、`N search(es)`、`N fetch(es)`、
   `lints`、`N tool(s)`、`N browser action(s)`）；全 shell 组
   "Ran N commands"；浏览器组 "Ran N browser actions"。
3. **运行中预览与折叠动效 CSS**（stylex 类定义提取于
   `artifacts/aggregation-group-css.txt`）：预览窗 max-height
   144px + 顶部 32px mask 渐隐 + autoScrollToBottom；折叠展开
   `transition-property:height`、150ms、
   `cubic-bezier(.215,.61,.355,1)`，reduced-motion 下
   `transition-property:none`；组头文案 200ms 节流
   （`useThrottledValue` 源码）。
