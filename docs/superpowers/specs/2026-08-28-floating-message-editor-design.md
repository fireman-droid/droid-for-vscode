# Floating historical-message editor

**Status:** Proposed
**Date:** 2026-08-28

## Context

DroidVisX 的 transcript 使用 TanStack Virtual 管理 turn 行高。历史用户问题在接近
viewport 顶部时需要保持可见，并允许点击后编辑和 resend。

当前实现同时维护文档流 placeholder、viewport 内 pinned layer、浮层高度测量和
assistant margin 补偿。它把视觉层的尺寸变化重新传回虚拟列表，导致职责耦合。真实
浏览器验收发现，编辑卡打开后继续滚动到 `scrollTop=420`，assistant 内容会进入
浮层矩形，重叠约 `124.8px`。

目标交互已确定为：

- 浏览时显示当前历史问题的悬浮摘要。
- 点击后编辑器真正悬浮，不改变 transcript 的文档高度。
- 编辑目标在编辑期间锁定，不因继续滚动而切换。
- 编辑时允许底层正文从浮层下面经过。
- 取消、发送和失败重开沿用现有编辑、rewind 和 resend 业务语义。

Cursor 的公开资料可以确认“历史消息编辑 + checkpoint/rewind”的产品语义，但没有
公开其内部 DOM 或 CSS，不能把 `position: fixed` 视为已证实实现。本方案只复用可
观察的交互结果，不复制未公开的内部实现。

参考：

- [Cursor Checkpoints](https://cursor.com/docs/agent/chat/checkpoints)
- [Cursor Prompting](https://cursor.com/docs/agent/prompting)
- [Cursor 历史消息编辑的公开讨论](https://github.com/microsoft/vscode-copilot-release/issues/9391)

## Goals

1. 将 pinned 视觉层从 transcript 布局树中隔离。
2. 让编辑器、附件和 restore dock 的尺寸变化只影响浮层自身。
3. 保持虚拟列表的行高、滚动位置和 follow-to-bottom 逻辑稳定。
4. 继续使用现有消息渲染器和 edit/resend 回调，避免第二套业务流程。
5. 保持键盘、屏幕阅读器和只读 transcript 的现有边界。

## Non-goals

- 不改变 Runtime、Extension Host、Bridge 或消息数据模型。
- 不重新设计 checkpoint、rewind、附件上传或 resend 业务。
- 不让正文为浮层动态增加顶部 inset；编辑时正文经过浮层是明确的交互契约。
- 不推断或复制 Cursor 未公开的实现细节。

## Architecture

`Thread` 负责提供一个与 viewport 同级的浮层宿主：

```text
Thread
├── Floating message overlay host
├── Thread viewport
│   └── Reading column
│       └── Virtualized transcript
└── Footer / Composer
```

浮层宿主位于 `.dvx-thread` 的布局范围内，但位于
`.dvx-thread-viewport` 之外。它使用 `position: absolute` 锚定到 thread 的内容
顶部，因此：

- 不属于可滚动内容；
- 不参与 transcript 的 `scrollHeight`；
- 不需要 sticky 的父边界 hand-off；
- 不需要以浮层高度修改任何虚拟行或 assistant margin。

浮层仍由 `VirtualizedMessages` 根据同一个滚动快照选择消息，但通过 Portal 渲染
到宿主。这样 pinned message 的选择逻辑和视觉定位解耦。

## State model

只保留两个概念：

```text
naturalPinnedMessageId
editingMessageId
```

显示目标为：

```text
displayedMessageId = editingMessageId ?? naturalPinnedMessageId
```

行为：

1. 未编辑时，`naturalPinnedMessageId` 随滚动变化。
2. 点击当前浮层消息后，现有 `onBeginEdit(messageId)` 设置
   `editingMessageId`。
3. 编辑期间显示目标固定为 `editingMessageId`，滚动不会替换浮层内容。
4. 取消时清除 `editingMessageId`，下一次渲染恢复自然 pinned 消息。
5. 提交时沿用现有 `onSubmitEdit` 和 `onEditResend`，不新增发送状态。
6. 结构化 resend rejection 继续调用现有 reopen 流程，目标仍为原 message id。

文档流中的消息只在它是 `displayedMessageId` 时作为不可见布局副本保留。该副本
只承担原始 transcript 的自然高度，不接收编辑状态，不接收点击，不产生重复的
无障碍入口。

## Component responsibilities

### `Thread.tsx`

- 在 `.dvx-thread` 内创建 overlay host。
- 保持 viewport 和 footer 的现有结构及滚动监听。
- 不持有新的编辑状态；继续把现有 `ThreadMessageChromeContext` 传给消息。

### `VirtualizedMessages.tsx`

- 继续订阅真实 scroller 并通过 virtualizer offset 选择
  `naturalPinnedMessageId`。
- 从 `ThreadMessageChromeContext` 读取 `editingMessageId`，计算
  `displayedMessageId`。
- 将 pinned message 通过 Portal 渲染到 overlay host。
- 保留虚拟行的自然测量。
- 删除 pinned layer 的 `ResizeObserver`、高度 state、CSS custom property 和
  assistant inset 计算。

### `messageChrome.tsx`

- 保留 flow/pinned surface context，用于区分布局副本和交互副本。
- pinned surface 承载现有 `UserMessage`，不复制消息读取、附件或 edit handler。
- flow surface 只标记 displayed message 为 placeholder。

### `UserMessage.tsx`

- 保留现有编辑、附件、restore、rejection 和 resend 控件。
- placeholder 只影响可见性、交互性和无障碍属性。
- 删除 `pinnedHeight` 以及通过 pinned 高度设置 `minHeight` 的逻辑。
- 编辑器高度继续由自身的 textarea 和内部 dock 管理，不向虚拟列表回传。

### `10-shell-frame.css`

- 新增与 viewport 同级的 overlay host 定位规则。
- pinned message 使用不透明背景和现有层级，浮层内部允许滚动。
- 删除 sticky layer、pinned height 和 assistant margin 规则。
- overlay host 不设置会制造水平滚动的宽度或 transform。

### `11-user-edit.css`

- 保留现有编辑卡视觉和控件规则。
- 为浮层编辑卡设置最大可视高度和内部滚动边界，避免在窄面板中超出 thread
  内容区域。
- 不引入新的动画或独立的编辑业务状态。

## Interaction details

### Browse mode

- 当前 pinned 问题卡显示在 thread 内容顶部。
- transcript 正文继续正常滚动。
- pinned 卡与正文允许发生几何覆盖，这是浮层交互的预期结果。
- 浮层仅在有自然 pinned message 时显示。

### Edit mode

- 点击 pinned 卡不修改 `scrollTop`。
- 编辑目标固定为被点击的 message。
- 文本输入、附件、restore dock 和 rejection 都在浮层内部展开。
- 浮层高度变化不修改 transcript `scrollHeight`，不触发虚拟行补偿。
- 底层正文可以经过浮层，浮层自身使用不透明背景保证编辑内容可读。
- 若编辑卡内容超过可用面板高度，编辑卡内部滚动，不推动 footer。

### Cancel and resend

- Escape、外部 pointer down 和现有取消入口清除编辑状态。
- resend 成功后的 transcript 更新沿用现有 runtime 行为。
- resend rejection 只恢复现有编辑状态，不创建新的 overlay state machine。

## Accessibility

- flow placeholder 设置 `aria-hidden` 并禁用 pointer interaction。
- pinned surface 是唯一可访问、可聚焦的编辑入口。
- 编辑 textarea 继续使用现有 `aria-label="Edit message and resend"`。
- 浮层出现和销毁不得产生两个相同 label 的可访问控件。
- ReadOnlyTranscript 继续关闭 pinned surface，避免只读视图出现重复消息。

## Virtualization constraints

- overlay host 不放在 `.dvx-thread-viewport` 内，避免随 scroll content 移动。
- `scrollHeight` 只由 transcript 和 footer 的既有布局决定。
- pinned message lookup 使用现有 virtualizer 坐标，不重新计算问题的绝对位置。
- 编辑期间使用固定 `editingMessageId`，避免 virtualizer hand-off 改写编辑目标。
- 不通过 margin、negative margin、transform 或动态 placeholder 高度修正视觉位置。

## Failure and edge behavior

- 同时没有自然 pinned message 和编辑目标时不创建浮层；编辑期间由
  `editingMessageId` 继续提供浮层目标。
- 编辑目标因 transcript 更新暂时不可见时，浮层仍按 message id 渲染；取消或提交后
  由现有消息生命周期决定是否销毁。
- overlay host 尚未挂载时不渲染 Portal；首次挂载后由正常 React 更新显示。
- 只读 transcript 不创建 overlay host 或 pinned surface。
- 不改变现有消息不存在、编辑不可用和 resend rejection 的处理。

## Validation

实现后使用完整 Browser Dev Client 验收以下事实：

1. `scrollTop=0` 时没有 pinned overlay。
2. 快速滚到 `180px` 时 overlay 在 thread 内容顶部出现，不延迟一拍。
3. 点击 overlay 后 `scrollTop` 保持不变，textarea 出现。
4. 编辑期间从 `180px` 滚到 `420px` 和 `900px`：
   - overlay 顶部保持在内容顶部；
   - message id 不变；
   - transcript `scrollHeight` 不因编辑卡尺寸变化而改变；
   - 底层正文允许经过 overlay，不出现额外 reflow 或滚动跳跃。
5. 添加多行文本、附件和 restore dock 后，变化只出现在 overlay 内部。
6. Escape 取消后恢复一个普通消息入口，无重复按钮或 textarea。
7. 运行：

```text
pnpm run typecheck
pnpm run lint:budgets
```

不新增针对 CSS 类名、静态布局或 getter 的测试；消息业务行为继续由已有测试和
真实浏览器验收覆盖。
