# 穿插式 Thinking（Interleaved Thinking）调研与设计

调研日期：2026-08-12。状态：**设计完成，待排期实施**。

用户观察：Cursor 的 Thinking 是穿插式的——思考一段 → 执行命令 →
又一段新 Thinking，各段独立出现在转录时间线的对应位置。DroidVisX
的 GUI 目前一个回合只有一个 Thinking 块，所有思考归并一处，时间线
顺序感丢失。本文查清归并发生的位置、实证 SDK 事件形态、对齐 Cursor
的呈现语言，并给出分层改动方案与第一切片定义。

证据来源与置信度：

- **[代码]** 本仓库生产代码逐层追读（file:line 精确标注），最高
  置信。
- **[探针]** `artifacts/probe-interleaved-thinking.mjs`（process
  模式私有 droid 实例，未触碰共享 daemon；输出仅事件类型/id/长度/
  时长，无内容），原始捕获在
  `artifacts/probe-interleaved-thinking.out.json`。最高置信。
- **[Cursor]** 既有存档调研
  `cursor-streaming-ux-research.md`（Thinking 呈现）与
  `activity-aggregation-research.md`（step 分组把 thinking 当独立
  步骤），本机 Cursor 3.15.6 反编译产物一手证据，高置信。

## 结论速览

**SDK 是分段到达的，归并是我们 Webview store 自己做的。**
`thinking_text_delta` / `thinking_text_complete` 事件原生携带
`messageId` + `blockIndex` 段落身份；一个 think→tool→think 回合
实测产生两个独立段（不同 messageId），各有自己的 complete 和
durationMs，与 tool_call/tool_result 在时间线上严格交错。我们的
Runtime 投影丢弃了段落身份，Bridge 契约没有段落字段，最终
Webview store 按 `turnId` 单键归并成唯一一个 thinking 项。历史
回放路径反而是对的——`projectSessionHistory` 按消息块逐个投影，
天然保位。因此**可行性判定：可做穿插渲染**，且 UI 渲染层
（Thread.tsx 逐 part 渲染 + activityGrouping）已经具备多段能力，
改动集中在 Runtime→Host→Bridge→store 的身份传递上。

## 一、现状：Thinking 从 SDK 到 UI 的流动与归并点

### 1. 流动链路

| 层 | 位置 | 行为 | 段落身份 |
| --- | --- | --- | --- |
| SDK 事件 | `@factory/droid-sdk` `ThinkingTextDelta` / `ThinkingTextComplete`（dist 类型声明 105915-105926 行） | 每段思考一个 `messageId`+`blockIndex`，complete 携带 `durationMs` | **有** |
| Runtime 投影 | `src/runtime/normalizeSdkEvent.ts:47-57` | 投影成 `thinking-delta { text }` / `thinking-complete { durationMs }`，**丢弃 messageId/blockIndex** | 丢失 |
| Runtime 事件类型 | `src/runtime/runtimeEvents.ts:35-42` | 无段落字段 | 无 |
| Host 投影 | `src/extension/ChatController.ts:1269-1297` + `src/extension/turnActivityState.ts:134-158`（`projectThinkingDelta`） | 逐 delta 转发；只维护**回合级累计**长度上限（`MAX_THINKING_TEXT_LENGTH`，32k）与一次性截断标记 | 无 |
| Bridge 契约 | `src/shared/bridgeMessages.ts:1700-1714`（`ThinkingDeltaMessage` / `ThinkingCompleteMessage`） | `sessionId`/`turnId`/`delta`/`truncated`/`durationMs`，无段落字段 | 无 |
| **Webview store（归并点）** | `src/webview/assistant/store.ts:1058-1087`（`appendThinkingDelta`） | `findIndex(kind==='thinking' && turnId===turnId)`——**按 turnId 单键查找，全部 delta 追加进 id 为 `thinking:${turnId}` 的唯一一项** | 归并发生处 |
| Webview store（complete） | `src/webview/assistant/store.ts:648-665` | 把该 turn 的所有 thinking 项标 complete 并覆写 durationMs | 无区分 |
| 适配层 | `src/webview/assistant/runtimeAdapter.ts:372-382`（`mapItemToPart`） | 每个 thinking 项 1:1 映射为一个 assistant-ui `reasoning` part，顺序保持 | 已具备多段能力 |
| 渲染层 | `src/webview/assistant/Thread.tsx:1213-1246`（`ThinkingRow`） | 每个 reasoning part 一个独立可折叠行（shimmer/Thought for Xs/per-row 展开态） | 已具备多段能力 |
| 分组层 | `src/webview/assistant/activityGrouping.ts:73-123` | 短 reasoning（≤200 字符/≤2 行）吞入探索组，长 reasoning 独立成行并切断组 | 已具备多段能力 |

**归并的确切位置只有一处**：`store.ts:1064-1065` 的
`transcript.findIndex((item) => item.kind === 'thinking' &&
item.turnId === turnId)`。第二段思考的 delta 到达时，会命中第一段
创建的 `thinking:${turnId}` 项并把文本追加进去——该项停留在首段
delta 到达时的位置（工具行之前），穿插顺序就此丢失。

### 2. 归并顺带引入的两个正确性瑕疵（现状 bug）

1. **完成态追加**：第一段的 `thinking.complete` 把唯一项标为
   `complete`（`store.ts:654-663`）；第二段 delta 继续追加文本时
   `appendThinkingDelta` 不复位 status（`store.ts:1080-1087`），
   于是"已完成"的行在无 shimmer 的静止状态下继续变长，违反
   "动画只属于正在发生的事"的既有纪律（反向违反：正在发生的事
   没有动画）。
2. **durationMs 覆写**：每段的 complete 都覆写同一项的
   durationMs，最终标签"Thought for Xs"只反映**最后一段**的时长，
   而不是全部思考时间。

### 3. 回放/历史加载路径：已经是穿插的

`src/runtime/history/projectSessionHistory.ts:290-302 + 455-496`
（`appendThinking`）按 `messageIndex`/`blockIndex` 顺序逐块投影，
**每个 thinking 块一个独立 transcript 项**，id 由
`uniqueTranscriptId('thinking', messageIdentity, messageIndex,
blockIndex)` 生成，`durationMs` 逐块保留。也就是说：同一个会话，
关掉重新加载（历史路径）反而能看到穿插的多段 Thinking，live 流式
（store 路径）却是归并的单块——两条路径行为不一致，本切片落地后
将自然对齐。

恢复存储（`src/extension/SessionRecoveryStore.ts:670-…`
`parseThinking`）按项形状解析，id 是不透明字符串，对"每 turn 一项"
没有任何假设——多段项与旧的单块项都能通过同一解析器。

## 二、SDK 事件形态实证（探针）

探针：`artifacts/probe-interleaved-thinking.mjs`。process 模式
（`createSession` + 自有 ProcessTransport 私有 droid 进程，session
用完 `close()`，临时目录删除，全程不触碰共享 daemon）。提示词强制
"先想（谜语推理）→ Read notes.txt → 再想（逐行字母序比较）→ 回复
done"。模型 `custom:GPT-5.6-Sol-0`，`reasoningEffort: high`。

实测事件时序（`probe-interleaved-thinking.out.json`，t 为毫秒）：

```text
t=6015  thinking_text_delta     messageId=39d933d1… blockIndex=0 (33 chars)
t=6169  thinking_text_complete  messageId=39d933d1… blockIndex=0 durationMs=154
t=6235  tool_call               Read (call_fAWZ…)
t=6235  assistant（完成消息）    blocks=[thinking, tool_use]   ← 块级保位
t=6267  tool_result             Read isError=false
t=13981 thinking_text_delta     messageId=861c54b6… blockIndex=0 (29 chars)
t=14149 thinking_text_complete  messageId=861c54b6… blockIndex=0 durationMs=168
t=14150 assistant_text_delta    messageId=861c54b6… blockIndex=1
t=14268 assistant（完成消息）    blocks=[thinking, text]
t=14345 result                  success
```

结论（判定"能不能做"的关键证据）：

1. **分段到达**：两段思考各自以独立的 delta→complete 序列到达，
   与 tool_call/tool_result 严格交错，顺序即真实时间线。
2. **段落身份**：段 = `messageId`（+ 块内 `blockIndex`）。本例两段
   分属两条 assistant 消息；同一消息内 thinking 与 text 用
   blockIndex 区分（0/1）。类型声明与运行时实测一致。
3. **每段独立 complete + durationMs**（154ms / 168ms）——支撑每段
   独立的"Thought for Xs"标签。
4. **完成消息保位**：流内的完成 `assistant` 消息 content 为
   `[thinking, tool_use]`、`[thinking, text]`——历史投影读到的就是
   这个形状，解释了历史路径为何天然穿插。
5. 默认模型（auto 路由）另一次运行同样给出
   `thinking#0 → tool → thinking#1` 的 SEGMENTED 判定；其中出现过
   **无 delta 只有 complete** 的空段（deltas=0），设计需容忍。
6. 边界注记：本账号 pin Factory 托管 Claude 模型
   （claude-sonnet-4-6 / 4-5）时回合以 `error_during_execution`
   结束（推断为账号无该模型直连额度，BYOK 环境），故"单段内多次
   delta 的长流式思考"未在本账号实测到——但这不影响判定：分段
   身份与交错时序已经成立，单段内 delta 多少只是模型差异。

## 三、Cursor 的做法（存档调研要点）

两份存档调研已覆盖 thinking 分段呈现的一手证据，无需再翻安装目录：

- **thinking 是时间线上的独立步骤**：Cursor 的 step-grouping 对
  回合内 "thinking / assistant-message / tool-call 混合序列"做顺序
  扫描（`activity-aggregation-research.md` §一.1，源码级还原）；
  thinking 步骤出现在序列中的真实位置，短 thinking 被吞入探索组、
  长 thinking 独立成行并切断组（`groupThinking` 默认 true）。
- **每段独立折叠**：thinking 块在**该块**流式结束时收起为一行
  （官方确认，`cursor-streaming-ux-research.md` §一.2）——"每段
  一个可折叠行"是产品意图；强制收起用户手动展开的块被官方认定为
  缺陷，我们不跟进。
- **流式中 shimmer**：进行中标签 "Thinking" 套 `make-shine`
  shimmer（2s linear），思考正文经 WordStreamer 平滑流出；完成即
  shimmer 停 + 文案切过去式，无收尾动画。
- **完成摘要行**："Thought for Xs" / "Thought briefly"（<500ms），
  时长来自流事件 `thinkingCompleted.thinkingDurationMs`——**逐段
  携带**，与 Droid SDK 每段 complete 携带 durationMs 同构。
- **回放静默**：`cloud-no-entry-animations` 一刀切禁用历史入场
  动画。
- **与工具行的排版关系**：thinking 行与工具行同属一个 step 序列，
  共享 `--conversation-list-item-gap:6px` 的行节奏；分组时 thinking
  时长累加进组摘要。

DroidVisX 已移植的对应资产：`ThinkingRow` 的 per-row 折叠 +
running shimmer + `formatThinkingLabel`（"Thought for Xs" /
"Thought briefly"，`Thread.tsx:3236-3261`）、activityGrouping 的
短思考吞组。**缺的只是上游分段**。

## 四、可行性判定

**可做（SDK 分段到达 → 穿插渲染成立）。**不需要 fail-closed 降级
方案；但设计保持退化友好：若某模型/某回合只产生一段思考，行为与
今天完全一致（单个 Thinking 行）。

## 五、目标行为规格

1. **穿插时间线**：live 转录中每个思考段是独立的 Thinking 行，
   出现在它相对工具行/文本的真实到达位置：
   `Thinking → Read → Thinking → 正文`。与历史加载路径的既有行为
   对齐（同会话两条路径渲染一致）。
2. **每段独立折叠**：沿用 `ThinkingRow` 的 per-row `<details>`
   展开态；不引入任何跨段联动，不强制收起用户展开的段。
3. **每段独立完成标签**：各段用自己的 durationMs 显示
   "Thought for Xs" / "Thought briefly"；修复现状"最后一段覆写
   全部"的瑕疵。
4. **流式动画纪律**（既有纪律，不新增视觉元素）：任一时刻至多
   一个活跃段——新段 delta 到达时该段 status=active（shimmer +
   smooth 流出），前段已被自己的 complete 标 complete（静止）。
   完成段不再变化，不再追加文本。
5. **回放静默**：历史投影与恢复快照的段全部 status='complete'，
   assistant-ui `useSmooth` 对非 running 状态不动画（既有行为），
   无入场动画。
6. **分组交互**：多段短思考各自可被 activityGrouping 吞入相邻
   探索组；长思考段独立成行并切断组——纯下游行为，分段后自动
   生效，无需改分组代码。
7. **视觉零新增**（UI restraint / Visual bar）：不加任何新样式、
   横幅、徽标；复用现有 `dvx-thinking-row` 的全套精加工（1px 描边
   行、shimmer、chevron、间距），只是行数从 1 变 N。

## 六、分层改动面

### Runtime（身份透传）

- `src/runtime/normalizeSdkEvent.ts:47-57`：`thinking_text_delta`
  / `thinking_text_complete` 投影时携带
  `messageId`（`MAX_BRIDGE_ID_LENGTH` 截断）与 `blockIndex`
  （非负安全整数校验，非法则丢整条，沿用仓库的 fail-closed 惯例）。
- `src/runtime/runtimeEvents.ts:35-42`：`thinking-delta` /
  `thinking-complete` 增加 `messageId: string` /
  `blockIndex: number` 字段。

### Host（段序号投影 + 上限策略不变）

- `src/extension/turnActivityState.ts`：`TurnActivityState` 增加
  `thinkingSegmentKey: string | null` 与
  `thinkingSegmentIndex: number`；`projectThinkingDelta` 见到新的
  `messageId:blockIndex` 键时段序号 +1。**回合级累计 32k 上限与
  一次性截断标记维持现状**（安全边界不放宽；截断落在命中段，其后
  段被抑制，与现状单块行为同构）。
- `src/extension/ChatController.ts:1269-1297`：`thinking.delta` /
  `thinking.complete` 发射时带上 `segmentIndex`。complete 只在
  该段确有投影过 delta 时发射（吞掉探针观察到的"无 delta 空段"，
  避免空行）。

### Bridge（契约扩展）

- `src/shared/bridgeMessages.ts:1700-1714`：
  `ThinkingDeltaMessage` / `ThinkingCompleteMessage` 增加
  `segmentIndex: number`（0 基，回合内单调递增）。选择回合内
  序号而非透传 SDK messageId：字段更小、不向 Webview 泄漏多余
  会话内部 id、天然可排序。
- `BRIDGE_PROTOCOL_VERSION` 3 → 4（Host 与 Webview 同包发布，
  版本号用于拒绝陈旧 webview 缓存）。

### Webview store（拆键）

- `src/webview/assistant/store.ts:1058-1087`
  （`appendThinkingDelta`）：查找/创建键从 `thinking:${turnId}`
  改为 `thinking:${turnId}:${segmentIndex}`；新段自然追加在
  transcript 末尾 = 到达顺序位置。
- `store.ts:648-665`（`thinking.complete`）：只匹配
  `id === thinking:${turnId}:${segmentIndex}` 的那一段，修复
  durationMs 覆写与完成态追加两个瑕疵。
- `markActivitiesStopping` / turn 收尾（`store.ts:1188-…`）按
  turnId 扫全部 thinking 项的现状逻辑不变（中断时全部段落收口，
  语义正确）。

### 不需要改的层（验证即可）

- `runtimeAdapter.ts` `mapItemToPart`：已逐项映射 reasoning part。
- `Thread.tsx` `ThinkingRow` / `formatThinkingLabel`：已 per-part
  渲染 + per-row 折叠 + running shimmer。
- `activityGrouping.ts`：已处理多 reasoning part。
- `projectSessionHistory.ts`：历史路径已分段保位。
- `SessionRecoveryStore.ts`：thinking 项形状不变（id 是不透明
  字符串，不新增字段），解析器零改动。

### 恢复存储兼容性（旧检查点的单块 thinking）

新方案**不改变 `ThinkingTranscriptItem` 的形状**，段身份只编码在
`id` 字符串里。因此：

- 旧检查点里的 `thinking:${turnId}` 单块项照常通过 `parseThinking`
  并渲染为一个 Thinking 行（内容是当时归并的文本）——如实呈现
  历史快照，不做迁移、不做拆分（拆分所需的段边界信息当时已丢失，
  fail-closed 如实记录）。
- 恢复后若同一 turn 继续流式（重连场景），新段以
  `thinking:${turnId}:${n}` 追加为新行，与旧单块项 id 不冲突。
- 新检查点自然携带多段项，旧版本代码不会再读到它（版本门槛在
  `SESSION_RECOVERY_VERSION`，无需变更——形状未变）。

## 七、第一切片定义与改动面预估

**切片：per-segment 穿插 Thinking（端到端）**

范围：上节 Runtime/Host/Bridge/store 四处改动 + 各层测试 + 打包
可见验证。不含任何视觉调整（渲染层零改动）。

可观察完成判据：

1. 打包扩展中跑一个 think→tool→think 回合（可复用探针提示词），
   转录出现两个独立 Thinking 行，分列工具行前后，顺序与到达一致；
2. 各段完成后独立显示 "Thought for Xs"（时长互不覆写）；流式中
   任一时刻至多一段 shimmer，完成段静止；
3. 同一会话重新加载（历史路径）与 live 呈现一致；
4. 含旧单块 thinking 项的恢复检查点加载无错、正常渲染；
5. 全部既有 thinking 相关测试 + 新增分段测试通过。

改动面预估：

| 文件 | 预估 |
| --- | --- |
| `normalizeSdkEvent.ts` + test | ~15 行 + 断言更新 |
| `runtimeEvents.ts` | 2 字段 |
| `turnActivityState.ts` + test | ~30 行（段键跟踪） |
| `ChatController.ts` + test | ~20 行（segmentIndex 透传 + 空段抑制） |
| `bridgeMessages.ts` | 2 字段 + 版本号 |
| `store.ts` + test | ~30 行（拆键 + 定向 complete） |
| 合计 | 约 100-150 行生产代码，6 个生产文件 |

风险与后续：

- 单段多 delta 的长思考流（Anthropic 直连模型）未在本账号实测，
  但该维度不影响分段协议——段内 delta 追加逻辑与现状相同。
- 若后续要做"回合总思考时长"汇总（Cursor 组摘要的时长累加），
  各段 durationMs 已在 transcript 内，纯 Webview 可加，不入本
  切片。
