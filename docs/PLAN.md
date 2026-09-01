# DroidVisX Conversation 过场循环实施计划

计划状态：**已实现，正在完成收窄修正、重新打包安装**

设计依据：`docs/DESIGN.md` 的“Conversation 恢复与切换过场”。

## 1. 目标

只为以下两类真实等待显示 Droid 3×3 完整循环：

- Webview 初始化或 Reload，当前 Conversation 尚未恢复；
- 用户从 Sessions 目录选择另一个已有 Conversation。

完整过场持续到目标内容已经由 reducer 提交，且 Runtime 满足 Composer 的发送前置
条件：`connection.status === 'connected'`、`sessionId !== null`。New、Worktree、
Fork、Rewind、Compact 和 Handoff 不触发本过场。

## 2. 实施边界

本次只修改 Webview：

- 不修改 Runtime、Extension Host、Recovery Store 或共享 Bridge；
- 不新增依赖、持久化字段、遥测、配置或通用状态管理；
- 不替换 Header 连接点或 Transcript 自身的 pending 点阵；
- 不重做 Session Drawer、Composer 或 Transcript。

现有状态已经提供全部权威信号：

- `sequence`：证明观察到的 Snapshot 已经进入 reducer；
- `sessionId`：识别选中的已有 Session，并证明 Composer 已绑定 Session；
- `connection.status`：证明 Runtime 已连接。

## 3. Webview 过场控制器

`src/webview/assistant/conversationTransition.tsx` 集中负责：

1. 初始化 120ms 防闪烁延迟；
2. 记录 Sessions 目录中用户选择的目标 `sessionId` 与当前 `sequence`；
3. 观察首个或目标 `host.snapshot`，等待对应 sequence 进入 reducer；
4. 等待 `connected` 和非空 `sessionId`；
5. 控制完整遮罩的循环与 150ms 退出；
6. 识别现有 Session 选择失败诊断，让错误 UI 接管。

控制器只保存短暂 Webview 状态。

### 状态

| 状态 | 表现 |
| --- | --- |
| `boot-pending` | 已挂载但不足 120ms，不渲染过场 |
| `restoring` | 当前 Conversation 或 Runtime 尚未就绪，聊天区中央循环 |
| `switching` | 已选择已有 Conversation，旧 Transcript 留在背景 |
| `leaving` | 目标已可发送，遮罩在 150ms 内退出 |
| `idle` | 不显示完整遮罩 |

## 4. 完成规则

### 初始化 / Reload

1. 监听首个 `host.snapshot` 的 sequence；
2. 等待该 sequence 已由 reducer 提交；
3. 若 Runtime 已 `connected` 且 `sessionId` 非空，结束过场；
4. 120ms 内完成时不显示完整遮罩；
5. `unavailable` 时结束循环，让现有错误或 Reload 提示接管。

### 选择已有 Conversation

1. `session.select` 发送前记录用户选中的目标 `sessionId`；
2. 只接受 `message.sessionId === targetSessionId` 的后续 Snapshot；
3. 等待该 Snapshot 已由 reducer 提交；
4. 继续等待 state 同时满足目标 `sessionId` 和 `connected`；
5. 失败诊断或 `unavailable` 时结束循环。

目标 Session 的 checkpoint Snapshot 可以先更新遮罩后的真实 Transcript，但
`connecting` 状态不能提前结束过场。无关的目录刷新或旧 Session Snapshot 也不能
完成切换。

## 5. UI 与交互

- 遮罩只覆盖 Conversation surface，不覆盖 Header；
- `switching` 时旧 Transcript 降低透明度并轻微模糊；
- 遮罩拦截聊天区指针操作，Composer 和 Session 操作沿用现有 disabled 条件；
- Draft、附件和 Store 内容不因过场清空；
- Reduced Motion 禁用循环、模糊和位移，仅显示静态点阵；
- 不显示百分比、骨架屏或人工最短等待。

## 6. 文件

- `src/webview/assistant/conversationTransition.tsx`
- `src/webview/assistant/App.tsx`
- `src/webview/assistant/AppHeader.tsx`
- `src/webview/assistant/thread/transcriptRows.tsx`
- `src/webview/assistant/styles/34-conversation-transition.css`
- `docs/DESIGN.md`
- `docs/STATUS.md`
- `docs/PLAN.md`

`AppHeader.tsx` 和 `thread/transcriptRows.tsx` 只撤回上一版超出范围的点阵复用。

## 7. 验证与发布

代码验证：

```powershell
pnpm run typecheck
pnpm run lint:budgets
pnpm run build
git diff --check
```

随后依次执行：

```powershell
pnpm run package:vsix
pnpm run verify:vsix
cursor --install-extension dist/droidvisx.vsix --force
```

用户 Reload Window 后在真实 Cursor Secondary Sidebar 验收：

1. 快速 Reload 不闪现完整过场；
2. 慢 Reload 在 Composer 灰色期间持续循环；
3. 选择已有 Conversation 时持续到目标 Transcript 已提交且 Composer 可发送；
4. New、Worktree、Fork、Rewind、Compact 和 Handoff 不出现完整过场；
5. 失败后现有错误 UI 可操作。

## 8. 完成条件

只有上述两个触发入口、ready 完成条件、代码验证、VSIX 验证和 Cursor 安装全部完成，
本次修正才算工程完成；真实动画表现由用户在 Reload 后验收。
