# DroidVisX 项目规则

## 范围与事实

- 只完成用户请求及其必要结果，不扩展相邻功能或无关重构。
- 以用户当前要求和生产代码为行为事实，不虚构 Droid 能力、API、命令或项目结构。
- 保留用户已有、未跟踪和无关改动；谨慎处理生成文件、Lockfile、Migration 和公共契约。
- 文档入口是 `docs/README.md`。计划、状态、能力、架构和设计分别更新
  `PLAN.md`、`STATUS.md`、`CAPABILITIES.md`、`ARCHITECTURE.md` 和
  `DESIGN.md`，不创建临时调研、交接、验收或归档 Markdown。

## 执行与委派

- 单项且实现路径连贯的任务由当前代理直接完成。
- 涉及架构、公共契约、迁移、状态机或明确实施顺序的单项功能使用 Spec Mode，
  计划获批后仍由当前代理实现和验证。
- 多个可独立交付功能、多个里程碑或预计跨会话的工作，先提出 Mission 并获得批准。
- 默认不使用子代理。每次调用 Task 前必须说明代理、必要性、准确范围、是否可编辑、
  串行或并行方式，并获得用户明确批准。Mission 只授权计划中列出的 Worker 和
  Validator。
- 多个代理不得并发修改同一文件。`pnpm run build`、`vsce package` 和
  `cursor --install-extension` 不能并发运行。

## 实现

- 只检查完成当前请求所需的代码，交付一个可独立运行和验收的完整结果。
- 保持 Runtime、Extension Host、共享 Bridge 和 Webview 的职责边界。
- 修改消费者前先稳定共享 Bridge 契约，按依赖顺序接通所需层级。
- 优先小而连贯的改动、函数和组合；避免大范围重写、推测性抽象、重复保护和
  catch-all fallback。
- 只在信任边界验证输入，保持模块职责单一、依赖明确、控制流易追踪。
- 文件预算由 `pnpm run lint:budgets` 强制执行：TS/TSX 900 行、CSS 800 行、
  测试 2000 行；现有超限文件只能缩小。

## UI

- Cursor Secondary Sidebar 是主要聊天界面。原型只作视觉参考，示例数据不是
  Runtime 能力。
- 复用现有安静视觉语言。未经用户查看并批准，不增加 Banner、填充 Pill、Badge、
  彩色条等醒目元素。
- 保持 Cursor 水平的克制质感：分层暖色中性色、1px 边框、柔和阴影、精细排版、
  准确间距和细微 hover/transition；不交付塑料感色块或裸卡片。

## Git 提交

- 开始任务时先检查 `git status`，把已有修改和未跟踪文件视为用户工作，不覆盖、
  清理、移动或顺带提交。
- 一个任务的实现、必要文档和验证全部完成后，默认创建一个本地原子提交；任务仍
  部分完成、验证失败或代码与产品状态文档未同步时不得提交。
- 只暂存当前任务明确涉及的路径；脏工作区中禁止直接使用 `git add -A`。提交前
  必须检查 `git status`、staged diff 和暂存统计，确认没有日志、缓存、临时文件、
  `dist`、VSIX、密钥或无关用户改动。
- 当前任务与既有修改共享文件且无法可靠分离时，不制造虚假的原子历史；停止提交，
  说明重叠范围，并询问用户是否创建 checkpoint 或采用其他拆分方式。
- 提交信息沿用仓库现有 Conventional Commit 风格并准确描述可运行结果。若 Hook
  修改文件，重新检查暂存内容，只允许补入并 amend 一次。
- 默认不 push，不执行 rebase、reset、clean 或其他改写、丢弃历史和工作区的操作；
  这些操作必须由用户对本次目标明确授权。

## 验证与交付

- 代码改动运行 `pnpm run typecheck` 和 `pnpm run lint:budgets`。
- 测试、无头 Chrome smoke、截图 probe 和 harness 只在用户当前会话明确要求，
  或已发布 Bug 无法通过更低成本方式复现时新增、修改或运行。
- 不为 CSS 文本、类名、静态渲染、Getter、Wrapper、实现细节或覆盖率目标添加测试。
- 需要发布安装时依次构建、生成 VSIX、安装扩展，并告知用户 Reload Window。
- 产品事实变化时同步更新 `docs/STATUS.md`；如实报告运行的命令、失败、跳过项和风险。
- Runtime、Host、Bridge 和 UI 接通且构建已安装后，功能才算工程完成；真实行为和
  视觉由用户在 Cursor 中验收。
