# 反馈

所有新问题只记在本文件。不要再创建日期交接、独立 Bug 清单、样式计划或
功能调研 Markdown。

## 当前待确认

| 类型 | 内容 | 状态 |
| --- | --- | --- |
| Mission Control | Reload Window 后检查目录与 New Mission 草稿 | 待验收 |

## Cursor Browser MCP

### 活动 Browser Bridge 与目标工作区不一致

- 类型：Bug
- 状态：未处理
- 版本：cursor-browszer-mcp 1.2.3
- 现象：按 DroidVisX 工作区打开页面时提示没有匹配的 Browser Bridge；
  当前唯一活动 Bridge 属于另一个 Cursor 工作区，需要先列出窗口并显式选择
  活动实例。
- 复现步骤：
  1. 同时打开多个 Cursor 工作区，但只在其中一个窗口启用 Browser Bridge。
  2. 从另一个工作区按本地路径调用 `browser_open`。
  3. 观察到 `No bridge matched workspace`。
- 期望：能够明确显示可用窗口并快速选择，或在只有一个活动 Bridge 时提供
  可确认的回退方式。
- 截图或日志：2026-08-31 Live Webview 调试时复现；不记录 Bridge token。

### 长会话的完整交互快照过大

- 类型：功能
- 状态：未处理
- 版本：cursor-browszer-mcp 1.2.3
- 现象：Live Webview 长会话返回 224 个可交互节点，完整快照包含大量历史
  Tool、Thinking 和消息操作，定位底部 Review 面板时输出冗长。
- 复现步骤：
  1. 打开包含较长历史的 `/live` Webview。
  2. 等待 Bridge 加载真实会话。
  3. 请求完整 interactive snapshot。
- 期望：支持按元素引用、选择器或可见区域获取局部快照，便于集中调试
  Review、Composer 等单一界面。
- 截图或日志：2026-08-31 Live Webview 快照，224 个可交互节点。

### Plan 操作菜单超出可用边界

- 类型：Bug
- 状态：未处理
- 版本：DroidVisX 0.7.89
- 现象：在窄宽度 Webview 中展开 Plan 的操作按钮后，选项菜单超出卡片和
  可用视口边界，覆盖周围内容，部分菜单内容接近或越过可见区域。
- 复现步骤：
  1. 在 Cursor Secondary Sidebar 中显示带操作选项的 Plan。
  2. 保持较窄的侧栏宽度。
  3. 展开 Plan 操作按钮的选项菜单。
- 期望：菜单根据可用空间选择展开方向，并限制在视口内；高度不足时内部
  滚动，所有选项文字和点击区域保持完整可见。
- 截图或日志：2026-08-31 用户截图，菜单展开后明显越过 Plan 卡片边界。

## 新问题模板

```markdown
### 简短标题

- 类型：Bug / 样式 / 功能
- 状态：未处理 / 处理中 / 待验收 / 完成
- 版本：
- 现象：
- 复现步骤：
- 期望：
- 截图或日志：
```

## 记录规则

1. 一项问题一个小节。
2. 只写现象、复现、期望和证据。
3. 不在这里写实现方案、测试计划或每日进度。
4. 完成后保留一行结果，详细变化写 `CHANGELOG.md`。
5. 当前执行顺序只在 [`PLAN.md`](./PLAN.md) 维护。
