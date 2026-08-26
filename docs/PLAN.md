# 当前计划

最后更新：2026-08-26

## 当前目标

按 [`DESIGN.md`](./DESIGN.md) 已批准的 A2 架构，实现由 SDK child Session
原始通知驱动的完整只读子代理对话，并在独立 Editor 中实时展示。

## 当前进度

已完成：

- 已有 Task 子代理身份、状态、耗时和工具次数摘要
- 已有 `child_session_available` 通知监听和 host-only ledger child Session ID
- 已有 `SessionViewerPanelController`、`ReadOnlyTranscript` 和独立 Editor Bundle
- Mission Worker 已复用只读 Session Viewer
- 已确认 SDK raw notification 提供 child 文本、Thinking、Tool 和生命周期事件
- A2 实时架构、卡片交互、恢复边界和验收标准已获批准
- daemon 使用同一 `DaemonSessionController` 的公开
  `sessionNotification` 事件，不建立第二条连接；process 使用 Session 原始通知
- Host-only Registry 已建立父 Task 到 child Session 的映射，并从 ledger 恢复历史项
- Transcript Store 已接通历史初始化、实时通知和 terminal 最终历史对齐
- Task 卡已移除 2.5 秒活动采样，实时摘要与 Viewer 消费同一 Store
- 整卡点击、Host 父 Session/Turn/Tool 校验和每 child 独立 Editor 已接通
- Viewer 已复用 `ReadOnlyTranscript`，提供实时 snapshot 和明确 child 生命周期
- `pnpm run typecheck` 与 `pnpm run lint:budgets` 已通过

尚未完成：

1. Reload Window 后由用户完成真实运行、并发标签和视觉验收

## 执行顺序

1. 用户 Reload Window，按 [`DESIGN.md`](./DESIGN.md) 的子代理验收标准检查。

## 后续候选

以下内容没有排期，只有用户明确选择后才开始：

- 插件、Hooks 和 Automations 管理
- GitHub PR 工作流
- Worktree 和后台进程管理
- 对话 minimap
- 子代理对话搜索与跨父 Session 目录

## 明确不做

- 第二套 AI Runtime、Session 或认证
- 从私有文件猜测 Droid 能力
- 伪造 Mission、Worker、模型、权限或进度
- 跨设备 Session、账号用量、组织策略、远程环境和内置 onboarding
- 没有公开 API 的 Session Delete 或 Undo All
- 为完成度数字增加没有业务价值的测试

## 完成标准

- Runtime、Host、Bridge 和 Webview 链路真实接通
- 失败状态诚实且可恢复，不用样例数据兜底
- `pnpm run typecheck` 与 `pnpm run lint:budgets` 通过
- VSIX 已构建并安装
- 用户在真实 Cursor 中确认行为和视觉
- [`STATUS.md`](./STATUS.md) 同步更新
