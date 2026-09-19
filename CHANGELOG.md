# Changelog

只记录当前版本和后续发布。更早的逐版本记录保留在 Git 历史中。

## Unreleased

### Changed

- 主项目和 `@droidvisx/chat-ui` 原创代码采用 MIT；分发包补齐第三方条款、
  保留法律注释，增加缺失许可证材料的构建门禁。
- 补 Marketplace 元数据、现有标识的 PNG 版本、非官方声明与数据处理说明。
  新增本地预发布 VSIX 打包入口；以上均未表示已公开发布。
- 抽出独立 `@droidvisx/chat-ui@0.1.0`，Droid 的 Runtime、Host、Bridge 和
  产品特定语义留在适配层，不包含 Claude Code／Codex CLI 适配器。
- Chat、Models、Mission Control、Session Viewer 和 Review 统一切换 React 19 / Tailwind 4 /
  Radix / AI Elements 展示层，继续复用原有 Host、Bridge 和业务 reducer。
- 流式正文独立订阅，保留队列、历史编辑、Review/Commit、Mission 和只读 Viewer；
  五页共用本地样式与主题，严格 CSP 不变，Viewer 支持延迟加载 Mermaid。
- 文档重组为入口、计划、状态、架构、设计、能力、排障和反馈八类。
- 删除过时设计、日期交接、验收流水和归档 Markdown。
- 测试不再是默认打包门禁，并删除低价值 UI 与自证型测试。

### Fixed

- 旧轮次异步 Diff 结算不覆盖新问题／回复；保留监测到的变更路径，区分读取未知、
  ignored 文件与确认还原，避免临时文件清单虚增或错误缩减。
- 修复显式到底部被选区／非用户滚动取消、排队问题入场未定位，以及代码块内部
  滚动与外层跟随竞争；代码框支持独立横纵滚动和键盘操作。
- watchdog 不再在 Runtime 流未释放时先结算 Host；确认中断后唤醒并清理流，
  缺少确认时显示阻塞提示，不再把 idle 误当作成功完成。
- Plan 折叠／展开标题等高，Reload 回复操作栏归属完整回复的最后一组。
- 控件文字选区不触发正文复制／引用浮条。

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
