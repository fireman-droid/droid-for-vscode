# Changelog

只记录当前版本和后续发布。更早的逐版本记录保留在 Git 历史中。

## Unreleased

### Changed

- 文档重组为入口、计划、状态、架构、设计、能力、排障和反馈八类。
- 删除过时设计、日期交接、验收流水和归档 Markdown。
- 测试不再是默认打包门禁，并删除低价值 UI 与自证型测试。

## 0.8.0

### Changed

- Recovery Store 升级为 Conversation V2，分离产品 Conversation 与 backend Session
  身份，并显式记录 Fork、Rewind、Compact 和 Spec Handoff lineage。
- Reload 首屏从 durable canonical Display Snapshot 精确恢复；daemon history
  改为 append/enrich-only，不再替换、删除或重排关闭前可见内容。
- Compact/Handoff 保持 Conversation-scoped Webview 状态，Sessions 目录按
  Conversation 去重并把操作路由到 active backend Session。
- settled Changes 改由 logical Turn ledger 独立持久化，并通过 Host Snapshot
  `latestChanges` 提供给 Review、Git status、commit 和 draft。

### Fixed

- 图片恢复改用 Extension global storage 中的 managed artifacts；缺失 artifact
  保留 transcript 行和顺序，并显式降级为 partial history。
- Fork/Rewind durable transition 失败时回滚新 Conversation；Compact/Handoff
  durable transition 失败时恢复原 lineage。

## 0.7.90

### Fixed

- 提前捕获 ExitSpecMode 新会话通知，避免 implementation session 在权限返回前创建时丢失自动切换。
- 修复 Live snapshot 中空 Changes settlement 导致整份转录被拒绝的问题。
- 收紧 Plan、Answers、Exploring、命令卡和 Review Dock 的布局与反馈位置。

## 0.7.89

### Changed

- AskUser 与 Plan 使用 Composer 上方的有界停靠区域。
- Plan 可在 Cursor Markdown 编辑器中审查和编辑。
- AskUser 结果进入转录、恢复、Session Viewer 和导出。
- Canvas 支持 Preview、Code、Diff、元素选择和反馈。
- 长会话与 Session Viewer 使用虚拟化渲染。
- Mission Control 目录与 New Mission 草稿进入部分完成状态。
