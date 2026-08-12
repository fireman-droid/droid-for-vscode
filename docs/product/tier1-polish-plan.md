# 第一档打磨改造计划（暂缓执行）

> 状态（2026-08-12 更新）：**分节状态**——§3 恢复提速已实现（提前为
> V1 #2）；§2 收起播报被
> [`streaming-experience-design.md`](./streaming-experience-design.md)
> 替代、§4 回复动画并入其中（均已落地）；**只有 §1 流式命令输出预览
> 仍是现行设计待实现**（保留原设计、另行开片，见 HANDOVER §3 #6 注）。

按用户决定，本档在第二/第三档功能完成并验收后最后执行。本文档只定
方案，不代表已实现。

## 1. 终端命令流式输出预览

用户结果：execute 类 Tool 运行时，展开行内能看到命令的实时输出尾部，
像 Cursor 一样知道"正在跑什么、跑到哪了"。

- Runtime：`normalizeSdkEvent` 已经收到 `tool_progress` 类事件；为
  Execute 类工具从进度负载中提取 stdout/stderr 文本增量，经有界环形
  缓冲（尾部 ≤8K 字符，按行截断）聚合。
- Bridge：`tool.activity` 增加可选 `outputTail?: string`（与
  `detailKind`/`detail` 同样的双向校验和长度上限）；不新增消息类型。
- Host：`turnActivityState` 保留每个 toolUseId 的输出尾部并随
  activity 投影下发；transcript 中的 tool 项在完成时保留最后尾部
  （历史投影不合成输出，保持无输出状态）。
- Webview：`ToolActivityRow` 展开时在命令文本下方渲染
  `<pre class="dvx-tool-output">`，运行中自动滚动到底部，完成后静态。
- 脱敏边界：输出属于用户本机命令产物，仅进 Webview 展示，不进
  diagnostics 日志。
- 验收：harness 模拟 outputTail 更新；真实 Cursor 中跑一个多行输出
  命令可见滚动尾部。

## 2. 收起状态滚动播报最近操作

用户结果：activity 行收起时，摘要行内以单行滚动方式播报最近一条
进度（类似 Cursor 的"单行电报"效果）。

- 数据已存在（`latestUpdateKind` + `progressCount` + `outputTail`
  末行）；纯 Webview 改动。
- 摘要行状态区加一个 `dvx-activity-ticker`：显示最近一行输出或最近
  进度类别，切换时用 240ms 上滑淡入动画；`prefers-reduced-motion`
  退化为直接替换。
- 验收：harness 中连续投递进度更新可见逐条播报。

## 3. 恢复体验提速（快照先行）

用户结果：重开窗口后转录立即可见（来自本地恢复快照），CLI resume
在后台完成后无缝对齐；不再等约 10s 白屏。

- 现状：`startup()` 等 runtime.initialize（load_session ~4s）+
  context stats（1-7s）后才 emitSnapshot。
- 改造：startup 先从 `SessionRecoveryStore` 读选中会话的 checkpoint
  并立即 emitSnapshot（connection 标记 `connecting`、composer 禁用、
  顶部显示"Reconnecting to Droid…"）；runtime ready 后按现有
  reconcile 逻辑对齐真实历史并解锁。
- 风险：恢复快照与 resume 后历史的 reconcile 已存在
  （reconcileSessionHistory），主要工作是把 emit 时机提前并保证
  乱序快照被 sequence 规则拒绝。
- 验收：重开窗口 <1s 可见转录；日志中 render-ok 在
  runtime.initialize.finished 之前出现。

## 4. AI 回复动画整体打磨

用户结果：回复出现/流式增长有连贯的淡入与平滑滚动，不"大开大合"。

- 首条 assistant 文本块挂载时 160ms 淡入+4px 上移；流式期间沿用现有
  smooth 参数，只调 `minCommitMs` 与视口跟随的滚动缓动。
- 消息完成时 action bar 淡入（当前是瞬显）。
- 全部动画走 CSS class，`prefers-reduced-motion` 全量退化。
- 验收：harness 视觉核对 + 真实会话观感确认。

## 顺序与边界

执行顺序：1 → 3 → 2 → 4（输出预览价值最大，恢复提速次之）。
每项独立切片：完整测试、打包、安装、Cursor 可见验收后提交。
不引入新的 SDK 私有接口；输出文本永不进入 diagnostics 日志。
