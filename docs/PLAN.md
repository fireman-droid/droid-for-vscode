# DroidVisX Conversation 过场循环实施计划

计划状态：**待用户确认，尚未开始实现**

设计依据：`docs/DESIGN.md` 的“Conversation 恢复与切换过场”。

## 1. 目标

为以下真实等待提供同一套 Droid 3×3 点阵循环：

- Webview 初始化或 Reload 后，首个权威 `host.snapshot` 尚未到达；
- 用户选择另一 Conversation；
- 用户创建、Fork 或 Rewind 到新的 Conversation；
- Conversation 已经恢复，但 Runtime 仍在连接。

动画不能延迟已经可读的持久化 Transcript，不能展示假百分比或骨架内容，也不能
把 Compact/Handoff 这种同一 Conversation 内的 backend Session 更换表现为完整
Conversation 切换。

## 2. 实施边界

本次只修改 Webview：

- 不修改 Runtime、Extension Host、Conversation Recovery Store；
- 不修改共享 Bridge 消息或协议版本；
- 不新增依赖、持久化字段、遥测或配置项；
- 不重做 Session Drawer、Composer 或 Transcript；
- 不为动画增加通用状态管理层。

现有 Host Snapshot 已提供所需权威信号：

- `conversationId`：判断是否进入了新的产品 Conversation；
- `sessionId`：判断同一 Conversation 内的 backend Session 更换；
- `connection.status`：判断 Runtime 是否仍在连接或已经失败；
- `sequence`：保证观察到的 Snapshot 已经由 reducer 提交。

## 3. Webview 过场控制器

新增 `src/webview/assistant/conversationTransition.tsx`，集中负责：

1. 初始化恢复的 120ms 防闪烁延迟；
2. 用户发起 Conversation 操作时保存基线 `conversationId`；
3. 观察 Host 消息，并等待对应 Snapshot 真正进入 reducer state；
4. 控制完整遮罩的进入、循环和 150ms 退出；
5. 对非用户发起的 Conversation 变化只触发新内容短暂显现；
6. 输出 Header 小点阵、操作禁用和无障碍状态所需的最小投影；
7. 提供可复用的 `DroidSignalGrid` 与过场遮罩组件。

控制器只保存短暂 Webview 状态，不进入 reducer、VS Code persisted state 或 Host。

### 3.1 状态

| 状态 | 表现 |
| --- | --- |
| `boot-pending` | 已挂载但不足 120ms，不渲染过场 |
| `restoring` | 首个 Snapshot 未提交，聊天区中央循环 |
| `switching` | 用户发起新的 Conversation，旧 Transcript 留在背景 |
| `leaving` | Snapshot 已提交，遮罩在 150ms 内退出 |
| `idle` | 不显示完整遮罩 |

另有 `content-entering`，仅用于非用户发起的新 Conversation Snapshot，持续
150ms，不保留或复制旧 Transcript。

### 3.2 Snapshot 提交判定

消息监听器把每个 `host.snapshot` 的 `sequence`、`conversationId` 和
`connection.status` 交给控制器。控制器只有在 reducer state 满足以下条件后才认为
Snapshot 已提交：

- `state.sequence >= observedSnapshot.sequence`；
- `state.conversationId === observedSnapshot.conversationId`。

这样不会在消息进入 rAF 队列、Transcript 还没替换时提前关闭过场。

## 4. 触发与完成规则

| 操作或事件 | 完整过场 | 完成条件 |
| --- | --- | --- |
| 初始化 / Reload | 120ms 后仍无 Snapshot 才显示 | 首个 Snapshot 提交 |
| 选择历史 Conversation | 立即显示 | 提交的 `conversationId` 不同于基线 |
| New Session | 立即显示 | 新 Conversation Snapshot 提交 |
| Worktree Session | 立即显示 | 新 Conversation Snapshot 提交 |
| Fork | 立即显示 | Fork Conversation Snapshot 提交 |
| Edit-Resend / Regenerate | 立即显示 | Rewind Conversation Snapshot 提交 |
| Compact / Handoff | 不显示 | 仅 Header 小点阵跟随 `connecting` |
| 自动 Workspace/Host 切换 | 不预显示 | 新 Snapshot 提交后内容显现 150ms |

`session.select` 开始后，Host 会先发送仍属于基线 Conversation 的
`connecting` Snapshot。该 Snapshot 只更新连接状态，不能完成完整过场。目标
Conversation 的 checkpoint-first Snapshot 到达后立即完成完整过场，即使 Runtime
仍未连接；此时只保留 Header 小点阵。

## 5. 用户操作接线

在 `App.tsx` 中，以下现有发送点先调用控制器，再发送原 Bridge 消息：

- Header、Composer 和 `/new` 的 `session.new`；
- Session Drawer 与 Transcript 跳转的 `session.select`；
- Worktree 创建；
- 当前 Session Fork；
- Edit-Resend 与 Regenerate。

同一套 callback 覆盖 Header、Composer 和 Slash command，避免某个入口绕过过场。

过场 `switching` 期间：

- Header Session 操作与 Composer 发送能力暂时禁用；
- 遮罩拦截聊天区指针操作；
- Draft、附件、滚动位置和旧 Transcript 不清空；
- 不修改 Store 中的 Conversation 状态。

`App.tsx` 当前超过普通 TSX 文件预算。实施时把现有 handshake timeout 逻辑一并
收进新的控制器模块，使 `App.tsx` 总行数只减不增。

## 6. 失败处理

控制器按发起的操作类型识别现有失败消息：

- Select：`session-selection-invalid`、`session-operation-blocked`、
  `session-resume-failed`、`session-close-failed`；
- New：`session-operation-blocked`、`session-new-failed`；
- Worktree：`worktree-create-unavailable`、`session-new-failed`；
- Fork：`session-fork-blocked`、`session-fork-unsupported`、
  `session-fork-failed`；
- Rewind：结构化 `turn.editResendRejected`；
- 通用恢复失败：Snapshot 或 Connection 进入 `unavailable`。

失败后进入 `leaving`，停止循环并让现有错误/重试 UI 接管。因为 reducer 未收到新的
Conversation Snapshot，旧 Conversation、Draft 和 Transcript 保持原状。

初始化 5 秒仍未收到任何 Host 消息时，沿用现有 Reload Window 提示；点阵停止循环，
不遮挡提示。

## 7. 组件与样式

### `conversationTransition.tsx`

- `useConversationTransition()`：局部状态机、定时器和 Host 消息观察；
- `DroidSignalGrid`：3×3 点阵，中心、十字、四角三层延迟；
- `ConversationTransitionOverlay`：`role="status"`、polite live region 和文案。

### `App.tsx`

- 将 Host 消息交给控制器观察；
- 在 Conversation 操作入口调用 `beginSwitch(kind)`；
- 用 `.dvx-conversation-surface` 包裹现有 handshake notice 和 `DroidThread`；
- 把完整遮罩作为 Thread 的绝对定位 sibling；
- 将过场状态并入 Header 与 Composer 的 disabled 条件。

### `AppHeader.tsx`

- `connecting` 时用缩小的 `DroidSignalGrid` 代替当前单点 pulse；
- `connected`、`idle`、`unavailable` 保留现有单点语义和颜色。

### `styles/34-conversation-transition.css`

- 使用现有 Motion、Surface、Ink、Border Token；
- 完整点阵约 1.2 秒循环；
- 遮罩只覆盖 Conversation surface，不覆盖 Header；
- Switching 背景降低透明度并轻微模糊；
- 进入/退出不超过 150ms，不改变布局或滚动；
- 320px 宽度不溢出；
- `prefers-reduced-motion: reduce` 下禁用循环、模糊和位移，仅保留静态点阵；
- `styles.css` 只增加该文件的 import。

## 8. 文件清单

计划修改：

- `src/webview/assistant/conversationTransition.tsx`
- `src/webview/assistant/App.tsx`
- `src/webview/assistant/AppHeader.tsx`
- `src/webview/assistant/styles/34-conversation-transition.css`
- `src/webview/assistant/styles.css`
- `docs/STATUS.md`
- `docs/PLAN.md`

除非实施中出现已证实的公共契约缺口，不修改 Host、Bridge、Store 或 Runtime。

## 9. 验证

按项目规则，本次不为 CSS、类名或静态渲染增加测试，也不新增动画测试 Harness。

代码验证：

```powershell
pnpm run typecheck
pnpm run lint:budgets
pnpm run build
git diff --check
```

浏览器与 Cursor 验收：

1. 快速 Reload 不闪现完整过场；
2. 慢初始化显示完整循环，首个 Snapshot 到达即消失；
3. 切换历史 Conversation 时旧内容留在背景，新 checkpoint 到达即显示；
4. checkpoint 已显示但 Runtime 仍连接时只有 Header 小点阵继续循环；
5. Compact/Handoff 不出现完整遮罩；
6. 失败后旧 Transcript 和 Draft 保留；
7. Light、Dark、Auto、320px 和 Reduced Motion 表现正确。

工程验证通过后，依次执行：

```powershell
pnpm run package:vsix
pnpm run verify:vsix
cursor --install-extension dist/droidvisx.vsix --force
```

安装后由用户执行 `Developer: Reload Window`，在真实 Cursor Secondary Sidebar
验收初始化和 Conversation 切换。

## 10. 实施顺序

1. 建立局部过场控制器，迁移 handshake timeout，保持 App 文件预算下降；
2. 接通首个 Snapshot、用户操作和失败消息；
3. 接入 Conversation surface 遮罩与 Header 小点阵；
4. 完成 Reduced Motion、主题和窄宽度样式；
5. 更新 `docs/STATUS.md` 与本计划状态；
6. 运行 typecheck、预算、build 和 diff check；
7. 创建一个本地原子实现提交；
8. 顺序 package、verify、force install，不 push。

## 11. 完成条件

只有以下全部成立才算完成：

1. 初始化、Reload 和真实 Conversation 切换使用批准的循环过场；
2. 可读 checkpoint 不被动画延迟；
3. Compact/Handoff 只显示 Header 连接信号；
4. 失败保留旧 Conversation 与 Draft；
5. Reduced Motion 和无障碍状态符合设计；
6. App 与 CSS 文件预算通过；
7. typecheck、build 和 diff check 通过；
8. VSIX 已验证并安装到 Cursor，等待用户真实视觉验收。
