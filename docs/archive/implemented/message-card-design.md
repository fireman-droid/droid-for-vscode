# 用户消息卡片编辑重发设计（切片③+）

> 状态：**已实现，仅存档**（2026-08-12 切片 3+ 落地，后续"编辑态
> 白卡片化"视觉修正亦已落地；实现与验证记录见
> `implementation-status.md`）。以下为定稿时设计原文。
>
> 2026-08-12 傍晚修订（用户反馈，`4ae602f`）：编辑态**不再有
> Cancel 按钮**——点击卡外任意空白或 Escape 即静默取消
> （`editStage.cancel` 语义不变，无确认弹窗）；卡内弹出层
> （Mode/Model）打开时第一次外点只收弹出层，编辑器保持。下文
> 所有 "Cancel/Escape" 的 Cancel 均按此理解。
>
> 原始状态：设计文档（未实现）。基于 2026-08-12 用户确认的交互需求与当前
> 工作区源码的只读核实（文中标注文件与符号名；行号会漂移，定位以符号
> 为准）。本切片依赖切片③（[`rich-content-design.md`](./rich-content-design.md)
> §1/§1.5，预研结论见
> [`slice-prep-rich-content.md`](./slice-prep-rich-content.md)）落地的
> 图片转录项与缩略图渲染，与③同批或紧随其后实施。
> Bridge 改动全部受
> [`architecture-overview.md`](../engineering/architecture-overview.md)
> 第 3 节不变式约束（双向校验对称、上限共享常量、内容白名单）。

---

## 1. 需求与用户确认记录（2026-08-12）

用户于 2026-08-12 确认以下交互，照此设计、不换交互：

1. **平时形态**：已发送的用户消息显示为卡片——文字 + 附件回显在卡片
   内（图片附件显示缩略图、其他附件显示 chip）。当前
   implementation-status 的已知边界"已发送消息不回显附件"在本切片
   解除。
2. **点开编辑态**：点击历史用户消息，卡片原地展开为编辑器：
   - 文本多行可编辑；
   - 卡片底部内嵌一条**与底部 Composer 完全相同的控制条**：`+` 附件
     按钮、Context 圆环+百分比、Mode 触发器（Auto/Spec/Mission）、
     Model 选择器、橙色圆形发送按钮。复用现有
     `ComposerControls` 组件（`src/webview/assistant/ComposerControls.tsx`），
     不另造一套；
   - 编辑态中可换 Mode/Model、增删附件，点发送 = 从该消息 Rewind
     分支重发（复用现有 `turn.editResend` 机制）。Mode/Model 是
     **会话级语义**：先提交 settings 更新、再 Rewind 重发（时序与
     失败处理见 §5.5）；
   - Cancel/Escape 收回为普通消息卡片。
3. **视觉**：保留 DroidVisX 暖色体系（`#f5f3ef` 底色、`#f2612e`
   accent 等既有 `--dvx-*` token，`src/webview/assistant/styles.css`），
   只借鉴 Cursor 的卡片布局结构，不换配色。
4. **范围外**（详见 §6）：语音输入；"仅对单条消息生效的模型切换"。

## 2. 现状与差距

现有双击内联编辑器（`src/webview/assistant/Thread.tsx` 的
`UserMessage` 组件）vs 目标卡片，逐条：

| # | 维度 | 现状（源码实证） | 目标 | 差距 |
| --- | --- | --- | --- | --- |
| 1 | 触发方式 | 双击气泡或 hover 出现的 Edit 按钮（`openEditor`）；无 `messageId` 的消息双击退化为 Reuse | 单击卡片原地展开为编辑器；无 `messageId` 时保持 Reuse 退化 | 触发改为单击（需避开文本选择手势），Edit 按钮保留 |
| 2 | 平时形态 | 纯文本气泡 `dvx-user-bubble`；`UserTranscriptItem` 只有 `text` + `messageId?`（`src/shared/bridgeMessages.ts`），附件发送后不回显 | 卡片内回显文字 + 附件（图片缩略图 / 其他 chip） | 需扩展 `UserTranscriptItem` 携带附件元数据；图片缩略图由切片③的 image 转录项承担（见 §7） |
| 3 | 编辑器形态 | 裸 `textarea` + 提示文案 + restoreFiles 勾选 + Cancel/Resend 两个文字按钮 | 文本区 + 附件 chips 行 + 完整 `ComposerControls` 控制条 + 橙色圆形发送按钮 | 编辑器整体重做为卡片布局；rewind.info 文件恢复勾选**保留**（`RewindFileInfo`、`onRequestRewindInfo` 链路不变） |
| 4 | 编辑态能力 | 只能改文本 | 可换 Mode/Model、增删附件 | 需要编辑态附件暂存（§4/§5.3）与 settings 时序（§5.5） |
| 5 | 重发中状态 | `resending` 局部 state + **8 秒定时器兜底恢复**（Host 拒绝时只发 diagnostic 转录项，组件无从得知） | 明确的状态机：查看/编辑中/重发中/失败恢复 | 新增结构化拒绝消息 `turn.editResendRejected`（§4.4），定时器降级为兜底 |
| 6 | 迁移策略 | —— | 本切片是旧编辑器的**升级替代** | 同一变更内删除旧 textarea 编辑分支，不留双入口共存；Reuse、Copy 动作与键盘行为（Enter 发送 / Escape 取消）原样保留 |

## 3. SDK / 代码证据

### 3.1 Rewind 重发链路（已生产接通，本切片复用）

- Bridge：`TurnEditResendMessage`（`turn.editResend`，
  `src/shared/bridgeMessages.ts`）携带
  `{ sessionId, turnId, messageId, text, restoreFiles? }`；
  `rewind.info` 双向消息回答"回退会影响多少文件"
  （`RewindInfoRequestMessage` / `RewindInfoStateMessage`）。
- Host：`ChatController.handleEditResend`
  （`src/extension/ChatController.ts`）拒绝条件为
  `isTurnActive || interactions.hasPending() ||
  sessionOperationInProgress || refreshInProgress ||
  settingsUpdate !== null`，拒绝时发
  `edit-resend-blocked` 会话诊断；通过后
  `performEditResend` 调 `runtime.rewind({ messageId, forkTitle,
  restoreFiles })` 得到 fork 会话 id，采纳 fork（截断转录、
  `clearPendingAttachments()`、写恢复检查点），再
  `handleSend(forkedSessionId, turnId, text, 'edit-resend')` +
  `emitSnapshot()`——快照原子携带 fork 会话与 submitting 回合。
- 锚点 id：`user.message-meta`（`UserMessageMetaMessage`）在回合内
  回传 SDK `messageId`，`attachUserMessageId`
  （`src/extension/hostTranscriptState.ts`）挂到用户转录项上；历史
  加载路径由 `projectSessionHistory.ts` 投影。无 `messageId` 的
  消息不可作 rewind 锚点（现状即如此，保持）。

### 3.2 Settings 更新链路

`ChatController.handleSettingUpdate`：拒绝条件为
`interactions.hasPending() || sessionOperationInProgress ||
settingsUpdate !== null || settings.status ∈ {loading, updating} ||
settings.value === null`，拒绝发 `settings-update-blocked` 诊断；
通过后 `settings = { status: 'updating' }` → `runtime.updateSessionSetting`
→ 成功回 `ready`+confirmed、失败回 `error`+旧值（**Host 已自带
失败回滚到旧确认值**）。`settingsUpdate` 互斥符号保证同时只有一个
更新在途。Webview 侧 `ComposerControls` 的 `SettingsStatus` 已渲染
updating/error 状态。

关键互斥关系（本设计时序的地基）：**`handleEditResend` 在
`settingsUpdate !== null` 时拒绝；`handleSettingUpdate` 在
`sessionOperationInProgress`（editResend 执行中为 true）时拒绝**。
二者天然串行，不存在竞态窗口。

### 3.3 附件暂存链路

- Host 单一暂存区：`ChatController.pendingAttachments`
  （`PendingAttachment[]`，上限 `MAX_PENDING_ATTACHMENTS = 8`），
  `attachmentOperationInProgress` 互斥一次只跑一个读取操作；
  变更后广播 `session.attachments`（只含 `AttachmentSummary`
  元数据，字节不过桥）。
- 消费点：`handleSend` 里 `takePendingRuntimeAttachments()` 一次性
  取走并清空，交给 `runtime.sendTurn(text, attachments)`；
  `FactoryDroidRuntime.projectStreamAttachments` 投影为 SDK
  `MessageOptions` 的 `{ images, files }`。
- 清空点：`performEditResend`（fork 采纳时）、新建会话、切换会话、
  工作区变更均 `clearPendingAttachments()`。**现状：编辑重发前
  Composer 暂存被清空、重发不带任何附件**——这就是编辑态需要独立
  暂存的直接原因（§5.3）。
- 附件来源：`attachment.pick / addEditor / addSelection /
  addProblems / addGitChanges / addPath / remove` 七种 W→H 消息，
  全部"Host 拉取"模式；4MB 上限与类型守卫在
  `src/extension/attachmentSources.ts` / `vscodeAttachmentSources.ts`。

### 3.4 依赖切片③的结论（`slice-prep-rich-content.md`）

- 图片在 SDK 协议里只有 base64 一种形态（`ImageBlock`，d.ts
  L1198–1239）；切片③新增 `ImageTranscriptItem`、
  `attachment.addImage` 消息、CSP `img-src` 加 `data:`、缩略图/
  lightbox 渲染，并在发送成功处把 Host 暂存的 image 附件投影为
  image 转录项回显。
- 本切片的"图片附件缩略图回显"**直接消费③的 image 转录项**，不再
  另建图片通道；"其他附件 chip 回显"是本切片新增（§4.1）。
- ③已实证 `MAX_IMAGE_DATA_LENGTH = 2_800_000`、每回合 8 张等上限，
  编辑态重新附加图片沿用同一组常量。

## 4. Bridge 契约变更

全部遵循不变式：新增/扩展消息在 `src/shared/validateMessage.ts`
（W→H）与 `src/webview/bridge/validateHostMessage.ts`（H→W）
**同一变更**补齐 exact-keys 解析器 + 双向敌对输入测试；上限一律取
`src/shared/bridgeMessages.ts` 共享常量。

### 4.1 扩展 `UserTranscriptItem`：附件元数据回显

```ts
export interface SentAttachmentSummary {
  readonly kind: AttachmentKind;        // 现有 ATTACHMENT_KINDS 枚举
  readonly name: string;                // ≤ MAX_ATTACHMENT_NAME_LENGTH
  readonly sizeBytes: number;
}

export interface UserTranscriptItem {
  readonly id: string;
  readonly kind: 'user';
  readonly text: string;
  readonly messageId?: string;
  /** 本消息发送时携带的附件元数据；仅元数据，字节不过桥。 */
  readonly attachments?: readonly SentAttachmentSummary[];  // ≤ MAX_PENDING_ATTACHMENTS
}
```

校验：数组长度 ≤ `MAX_PENDING_ATTACHMENTS`、`kind` 白名单、`name`
长度上限、`sizeBytes` 非负整数。图片附件**不进**该数组重复表达
（缩略图由③的 image 转录项承担，避免同图双份）；`kind: 'image'`
仅在③未接通或图片超限降级时作 chip 兜底出现。

### 4.2 编辑暂存消息（新增）

```ts
/** 进入编辑态：Host 为该消息初始化编辑暂存区。 */
export interface EditStageBeginMessage {
  readonly type: 'editStage.begin';
  readonly sessionId: string;
  readonly messageId: string;
}

/** 退出编辑态（Cancel/Escape/切换消息）：清空编辑暂存区。 */
export interface EditStageCancelMessage {
  readonly type: 'editStage.cancel';
  readonly sessionId: string;
}

/** H→W：编辑暂存区当前内容（对应 session.attachments 的编辑态版本）。 */
export interface SessionEditAttachmentsStateMessage {
  readonly type: 'session.editAttachments';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly attachments: readonly EditAttachmentSummary[];
}

/** AttachmentSummary + 原附件是否仍可随重发保留。 */
export interface EditAttachmentSummary extends AttachmentSummary {
  /** false = 原附件载荷已不可用（Host 保留区驱逐），需重新添加。 */
  readonly restorable: boolean;
}
```

### 4.3 扩展现有附件消息：`stage` 字段

七种 `attachment.*` W→H 消息各加可选字段
`readonly stage?: 'edit'`（缺省 = Composer 暂存，行为不变）。带
`stage: 'edit'` 时路由到编辑暂存区，共享同一
`MAX_PENDING_ATTACHMENTS`、4MB、`attachmentOperationInProgress`
互斥。exact-keys 校验器把 `stage` 收窄为字面量 `'edit'` 或缺席。

`turn.editResend` **形状不变**：Host 侧凭"编辑暂存区是否已 begin"
决定重发附件来源，不在消息里重复携带。

### 4.4 结构化拒绝消息（新增，替代 8 秒定时器）

```ts
export const EDIT_RESEND_REJECT_REASONS = [
  'busy',          // 回合/交互/会话操作/settings 更新在途
  'unsupported',   // runtime 无 rewind 或锚点不在转录中
  'failed',        // rewind RPC 失败或 fork id 非法
] as const;

export interface TurnEditResendRejectedMessage {
  readonly type: 'turn.editResendRejected';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly reason: (typeof EDIT_RESEND_REJECT_REASONS)[number];
}
```

Host 在现有三个诊断发射点（`edit-resend-blocked` /
`edit-resend-unsupported` / `edit-resend-failed`）同时发出该消息；
既有会话诊断转录项保留（日志与转录内可见性不变）。Webview 据此
确定性地从"重发中"回到"编辑中"；现有 8 秒定时器保留为兜底（防
消息丢失后卡死），不再是主恢复路径。

### 4.5 协议版本

以上均为**增量新增/可选字段扩展**，旧 Webview 不会收到未知消息
（同一 VSIX 内两端同版发布），不构成破坏性变更；
`BRIDGE_PROTOCOL_VERSION` 维持 2。

## 5. 分层实现方案

实现顺序 Bridge → Runtime → Host → Webview；Runtime 层本切片
**零改动**（rewind、sendTurn 附件投影均已具备）。

### 5.1 Bridge（先冻结）

§4 全部类型/常量/双侧解析器/敌对输入测试一次落地。测试要点：
`stage` 非 `'edit'` 字面量整条拒绝、`attachments` 超长/超名长拒绝、
`turn.editResendRejected` 的 reason 枚举白名单、多余字段拒绝。

### 5.2 Host：附件回显

- `appendAcceptedUserPrompt`（`src/extension/hostTranscriptState.ts`）
  增加可选参数携带本次消费的附件元数据；`handleSend` 在
  `takePendingRuntimeAttachments()` 处把非图片附件投影为
  `SentAttachmentSummary[]` 写入用户项（图片附件走③的 image 项
  回显）。
- `SessionRecoveryStore` 检查点自然携带该元数据（体积可忽略）。
- `reconcileSessionHistory.ts`：loaded 历史的用户项没有附件元数据
  （公开历史里非图片附件不可辨识，见 §6），锚点匹配时把
  recovered 侧同锚用户项的 `attachments` 元数据**合并**到 loaded
  权威项上，避免重启后 chips 消失。补聚焦测试。

### 5.3 Host：编辑暂存与原附件保留

- 新增 `editStage: { messageId: string; attachments: PendingAttachment[] } | null`
  字段，与 `pendingAttachments`（Composer 暂存）**并存但互不读写**。
  两个暂存的冲突处理：
  - 附件读取互斥沿用同一个 `attachmentOperationInProgress`——同时
    只有一个文件选择器/读取在跑，无论目标是哪个暂存区；
  - `handleSend`（普通发送）只消费 Composer 暂存；编辑重发只消费
    编辑暂存；
  - fork 采纳（`performEditResend`）时**两个暂存都清空**（现有
    `clearPendingAttachments()` 行为保持，编辑暂存已在消费时取走）；
  - 会话切换/新建/工作区变更清空两者。
- **原附件保留区**：`sentAttachments: Map<messageId, PendingAttachment[]>`，
  发送成功（拿到 `user.message-meta` 的 messageId）时把本次消费的
  附件载荷存入。上界：总字节 ≤ 32MB，超限按插入序驱逐最旧条目
  （8 × 4MB 恰好一条满额消息，覆盖常见编辑最近消息的场景）。
  仅存于内存，不进恢复检查点（重启后 `restorable: false`）。
- `editStage.begin` 处理：从保留区取该 `messageId` 的载荷预填编辑
  暂存；保留区没有的原附件（驱逐/重启/历史消息）以
  `restorable: false` 的 chip 形式包含在 `session.editAttachments`
  里（凭 `UserTranscriptItem.attachments` 元数据构造，只能删除
  不能保留）。图片附件若③的 image 转录项仍有完整 base64，Host 可
  据此重建载荷标记 `restorable: true`。
- `turn.editResend` 消费：编辑暂存中 `restorable: true` 且未被用户
  删除的条目 + 编辑态新增条目 → `RuntimeAttachment[]` 交给
  `handleSend` 路径；`restorable: false` 条目静默丢弃（UI 已提示）。
  需要给 `handleSend` 增加"显式附件覆盖"入口（当前它无条件取
  Composer 暂存）。

### 5.4 Host：结构化拒绝

三个既有拒绝/失败点各补发 `turn.editResendRejected`（§4.4）。
`performEditResend` 失败路径同样清理 `editStage`？——**不清理**：
失败后用户仍在编辑态，暂存必须还在；只有成功消费、显式 cancel、
会话级清空三种情况清理。

### 5.5 时序：Mode/Model 变更 + Rewind 重发

采用**即时提交**语义（与底部 Composer 完全一致，这正是"完全相同的
控制条"的含义）：

1. 用户在编辑卡控制条里选新 Mode/Model → 立即发
   `session.setting-update`（会话级，等同于在底部控制条操作）；
2. `settings.status === 'updating'` 期间编辑卡发送按钮禁用
   （Host 侧 `handleEditResend` 的 `settingsUpdate !== null` 拒绝
   条件是同一约束的服务端兜底）；
3. settings 确认（`session.settings` ready）后用户点发送 →
   `turn.editResend` → rewind fork → fork 会话继承刚更新的会话
   settings → 重发。

失败处理：

- **settings 更新失败**：Host 已回滚到旧确认值并发 error 状态，
  编辑卡内嵌 `SettingsStatus` 原样显示错误；停留编辑态，文本与
  附件暂存不丢，用户可重试或放弃。无需额外回滚机制。
- **settings 成功但 editResend 失败/被拒**：收
  `turn.editResendRejected` 回编辑态。已提交的 Mode/Model 变更
  **不自动回退**——它是会话级语义，与从底部控制条改设置后不发消息
  是同一状态，底部控制条同步显示新值，无一致性破绽。设计上明确
  接受，不做"补偿性反向更新"（反向更新自身也可能失败，引入更差的
  中间态）。
- **Cancel/Escape**：只收起编辑器并 `editStage.cancel`，不回退已
  提交的 settings（同上）。

### 5.6 Webview：卡片与编辑态状态机

`Thread.tsx` 的 `UserMessage` 重做，状态机（每消息局部）：

```text
viewing ──单击卡片/Edit 按钮（messageId 存在）──▶ editing
   ▲   ◀─Cancel/Escape（editStage.cancel）────────┘   │
   │                                                  │点发送（文本非空、
   │                                                  │ settings 非 updating）
   │◀──8s 兜底超时────── resending ◀──────────────────┘
   │◀─turn.editResendRejected─┘│
 （成功：host.snapshot 携带 fork 会话整体替换，组件随旧转录卸载）
```

- **viewing**：卡片容器（借鉴 Cursor 布局：圆角卡片、hover 提升），
  内容 = 文本 + ③的图片缩略图 + `attachments` chips（复用现有
  `AttachmentChip` 视觉，无删除按钮）。单击展开编辑（`mouseup` 时
  `window.getSelection()` 非空则视为选择文本、不展开）；无
  `messageId` 的消息保持现状退化为 Reuse。Copy/Reuse 动作栏保留。
- **editing**：展开为编辑器——多行 `textarea`（沿用
  `MAX_TURN_TEXT_LENGTH`，Enter 发送、Shift+Enter 换行、Escape
  取消）；chips 行显示 `session.editAttachments`（`restorable:
  false` 的 chip 加"需重新添加"标注与弱化样式，可删除）；
  rewind.info 文件恢复勾选保留（`openEditor` 时照旧
  `onRequestRewindInfo(messageId)`）；底部内嵌第二实例
  `ComposerControls`（其 props 自包含、不依赖 assistant-ui
  context，可直接复用）+ 橙色圆形发送按钮。发送按钮不能用
  `ComposerPrimitive.Send`（那是底部 Composer 的 assistant-ui
  绑定），用普通 `<button>` 复用 `dvx-composer-action
  dvx-send-action` 类与 `SendIcon`。
  - 传给编辑卡 `ComposerControls` 的回调由父组件注入**编辑暂存
    作用域**：attach 类回调发 `stage: 'edit'` 的附件消息；
    settings/context/skills/MCP 回调与底部完全同源（会话级）。
    `ComposerControls` 组件本身零改动。
  - 同时只允许一个消息处于编辑态（thread 级 state 持有
    `editingMessageId`；切换目标时先对旧目标 `editStage.cancel`）。
- **resending**：文本冻结显示 + "Resending from here…" 状态行
  （现有 `dvx-user-resending` 视觉保留）；收
  `turn.editResendRejected`（messageId 匹配）→ 回 editing 并显示
  原因文案；8 秒定时器仅兜底。成功时 `host.snapshot` 整体替换
  转录，无需本地转移状态。
- `store.ts` / `App.tsx`：新增 `session.editAttachments`、
  `turn.editResendRejected` 的 reducer 分支（沿 sequence 规则）；
  `runtimeAdapter.ts` 把 `UserTranscriptItem.attachments` 元数据
  挂进 assistant-ui 消息 metadata（与现有 `messageId` 同途）。
- `styles.css`：卡片/编辑态样式全部使用既有 `--dvx-*` token
  （`--dvx-accent`/`--dvx-raised`/`--dvx-border` 等），不新增
  颜色值；动效遵循 `prefers-reduced-motion`。

## 6. 边界与不做清单

| 项 | 说明 |
| --- | --- |
| 语音输入 | Webview 麦克风权限待探针实证，本切片不做（用户 2026-08-12 确认范围外） |
| 仅对单条消息生效的模型切换 | SDK 无该语义：`updateSessionSetting` 是会话级，`MessageOptions` 无 per-message model 字段。编辑态换 Model = 换会话模型，UI 文案如实表述 |
| 非图片附件的公开历史回显 | `loadSession` 投影里 document/text 附件块不可与 chip 元数据对应（③继续对 document 标 partial）。chips 回显覆盖：实时发送、恢复检查点、reconcile 元数据合并（§5.2）；纯 loadSession 重建的旧消息无 chips，如实接受 |
| 原附件跨重启保留 | `sentAttachments` 保留区仅内存（32MB 上限）。重启/驱逐后原非图片附件在编辑态显示为"需重新添加"，不发明"从磁盘找回原文件"之类 SDK 没有的能力 |
| 编辑重发保留 Composer 暂存 | fork 采纳时 Composer 暂存照旧清空（现状行为，会话身份已变更）；编辑态期间底部 Composer 暂存不受影响 |
| assistant-ui 内建编辑/附件管道 | 继续不用（`addAttachmentOnPaste={false}` 保持）；编辑态走自建卡片，与③的结论一致 |

## 7. 依赖与排期

- **硬依赖切片③**：图片缩略图回显消费③的 `ImageTranscriptItem` 与
  渲染组件；编辑态"原图片附件可保留"依赖③把发送图片投影进转录；
  `attachment.addImage`（③新增）加 `stage: 'edit'` 后即为编辑态
  粘贴/拖拽图片的通道。
- 无③时本切片可独立交付的部分：非图片附件 chips 回显、卡片编辑态、
  编辑暂存、settings 时序、结构化拒绝——但会留下"图片附件编辑态
  不可保留、无缩略图"的残缺体验，**不建议拆开**。
- 排期：与③同批或紧随其后（已记入
  [`HANDOVER.md`](../HANDOVER.md) 第 3 节 V1 表，编号 3+）。
- 实现完成时同步更新 `implementation-status.md`（解除"已发送消息
  不回显附件"已知边界的记录）。

## 8. 可观察验收标准

全部在真实 Cursor 安装 VSIX（Reload Window）后验证：

1. **附件回显**：Composer 附加 1 张 png + 1 个文本文件发送 → 转录
   中该用户消息卡片内出现图片缩略图（③）+ 文件名 chip；Reload
   Window 恢复后 chips 仍在（检查点/合并路径）。
2. **卡片展开**：单击历史用户消息 → 原地展开为编辑器，含多行文本、
   chips 行、`+`/Context 圆环/Mode/Model/橙色圆形发送的完整控制条，
   与底部 Composer 视觉一致（暖色 token 不变）；Escape 收回原卡片，
   再次展开时上次未发送的编辑不保留（编辑态是一次性的）。
3. **编辑态附件**：展开近期带附件消息 → 原附件以可保留 chip 预填；
   删除其一、经 `+` 新增一个文件 → 重发后新分支消息卡片回显的
   附件集合与编辑结果一致；期间底部 Composer 的暂存 chips 不受
   编辑操作影响。
4. **Mode/Model 时序**：编辑态把 Mode 从 Auto 切到 Spec → 控制条
   显示 updating、发送按钮禁用；确认后点发送 → 会话 rewind 出新
   分支且底部控制条同步显示 Spec；日志中 `session.setting-update`
   相关事件先于 `host.turn.accepted(kind=edit-resend)`。
5. **失败恢复**：在回合进行中对历史消息点发送（或以测试桩让
   rewind 失败）→ 收到 `turn.editResendRejected`，卡片立即回到
   编辑态且文本/附件暂存未丢，转录出现原因诊断行；不再依赖 8 秒
   等待。
6. **文件恢复勾选**：编辑一条其后有文件改动的消息 → 勾选区显示
   受影响文件数，勾选后重发 → 工作区文件按 rewind 语义恢复
   （现有能力回归验证）。
7. **门禁**：`pnpm run typecheck`、`pnpm run test`（含新增双向
   敌对输入测试与 reconcile 元数据合并测试）、`pnpm run build`
   全绿；VSIX 安装后无 `host.bridge.rejected` 新增日志。
