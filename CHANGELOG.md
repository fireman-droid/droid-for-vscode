# Changelog

只记录当前版本和后续发布。更早的逐版本记录保留在 Git 历史中。

## Unreleased

### Changed

- 主聊天改用独立后台与本地原生 IDE 通道，Bridge 48 显示实际连接和断开状态；
  保留旧运行中任务，空闲持久化历史可迁移到专属后台。
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

- 修复开机后旧 Droid 进程号被其他程序复用，导致所有会话恢复失败、反复 Reconnect
  无效的问题；批量核验登记进程身份，仅清理确认失效的记录，不误杀当前进程。
- 终端后正文／回合消息投递失败、隐藏页面漏收时补同步权威快照，避免只剩旧工具卡。
  Bridge 49 快照包含待回答交互，日常刷新与恢复不再清掉仍等待回答的问题。
- 后台子代理卡片独立保留在所属聊天轮次，不再被默认折叠的 Activity 隐藏；
  主回复结束后继续展示子任务状态，完成后保留记录，Chat 和 Viewer 同步生效。
- 修复 Reconnect 仍复用失效 IDE 通道：空闲会话安全重建并等待新握手，解除已恢复的
  失败提示但不重发消息；异常断流／心跳过期不再凭迟到心跳标绿。
- Windows 会话租约文件短暂占用时，在独占锁内有界重试原子替换，避免重连直接失败。

- 修复会话空闲 30 分钟被后台回收后发送立即失败：先恢复原会话 worker，再等待
  新的 IDE 握手；元数据提前恢复与旧连接迟到事件均正确处理，取消不会补发消息。
- 修复大文件清单与长 Diff 的全量渲染、流式刷新排队和页面溢出；Review 不再
  静默丢弃第 201 项之后的文件，保留逐文件读取与撤销边界。
- 长对话复用历史消息与修改汇总，减少流式重复计算；恢复平滑跳底，窗口／输入区
  尺寸变化不打断动画，手动滚动与减少动态效果偏好继续有效。
- 首条消息等待对应 IDE 通道完成握手和初始上下文传递，避免初始化竞态；
  取消等待不会补发问题，其他聊天或子任务不会替当前连接报成功。
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
