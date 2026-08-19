# DroidVisX 接手约定（HANDOVER）

> 进度**不要写在本文件**。当前做到哪：[`debug/handover-2026-08-15.md`](./debug/handover-2026-08-15.md)。  
> 文档地图：[`README.md`](./README.md)。历史稿：[`archive/README.md`](./archive/README.md)。

**定位**：把本地 Droid CLI（`@factory/droid-sdk`）做成 Cursor Secondary Sidebar 里的可视化工作台。Droid 是 Session / 模型 / 权限 / Skills / MCP 的唯一权威；本扩展不建第二套 AI 后端、不碰凭据。

**必读**：[`../AGENTS.md`](../AGENTS.md) → 当前交接 → [`engineering/architecture-overview.md`](./engineering/architecture-overview.md)。装机能力查 [`product/implementation-status.md`](./product/implementation-status.md)，不要通读。

## 开一个切片

1. 当前工作从 `debug/` 分册或交接文档取条目，不要从本文件的旧 V1 表取。
2. 实现顺序：**Bridge → Runtime → Host → Webview**。先冻契约再改消费者。
3. 验证只跑用户现行门禁：`tsc --noEmit`、`lint:budgets`、触及文件的单测。装包：`build` / `vsce package` / `cursor --install-extension` 同时只能一个进程。
4. 同一变更里短更 `implementation-status.md` 和对应 `debug/` 分册。
5. `git add` 列文件，不用 `-A`。

## 用户明确排除（未重新开口不要做）

跨设备 Session、界面中文化、onboarding、账号用量、内置模型全目录、组织策略、远程环境、Help/Feedback、Context Category 明细、更新管理。  
Session Delete 无 API，fail closed。

## 诊断

- 日志：`%APPDATA%\Cursor\User\globalStorage\droidvisx.droidvisx\logs\`
- 命令：`DroidVisX: Open Logs`、`Export Diagnostics Bundle`
- 手册：[`product/log-analysis-playbook.md`](./product/log-analysis-playbook.md)

## 旧 V1 路线（历史）

2026-08-11 的 V1 序号表已大部分落地，**不再代表当前待办**。当前待办以交接文档为准（样式段 B/D/C、#38、0.7.28 装包）。V2 设计稿仍在 `product/`，未排期不要开工。更老的交接与设计在 `archive/`。
