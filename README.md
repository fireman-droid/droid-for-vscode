<div align="center">

# Droid

**把聊天、改动审阅和代码补全，放进熟悉的编辑器。**

[开始使用](#开始使用) · [补全指南](docs/AUTOCOMPLETE.md) · [文档](docs/README.md) · [反馈问题](https://github.com/fireman-droid/droid-for-vscode/issues)

![Droid — Chat. Review. Keep coding. 在 VS Code / Cursor 中使用](assets/banner.webp)

</div>

Droid 是 **Factory Droid CLI 的非官方图形界面插件**，运行在 VS Code / Cursor 中。
它复用本机 Droid 的会话与工具，让你在编辑器里讨论代码、查看执行过程、审阅修改，并继续写代码。

做这个项目，是因为我更喜欢 Cursor 原生聊天那种简洁的体验：对话清楚，工具细节按需展开，
文件改在哪里，可以顺着当前任务看下去。Droid 围绕这个习惯，加入了完整文件 Diff、BTW 旁问和编辑器补全。

## 日常写代码，会用到这些

### 聊天和旁问，各有自己的位置

在侧栏中讨论项目，附上文件或图片，查看工具执行，回答提问和确认权限。
计划、工具输出和子任务放在对应对话里，需要时再展开。

看到某段代码或解释，想顺便问一句？选中文字后打开 **BTW（By the Way）**，
围绕这段上下文单独讨论。旁问支持图片和独立选择模型，关闭后可以继续看主对话。

### 审阅修改，连着完整上下文一起看

从聊天里的文件修改进入 **Review**，对照修改前后的完整文件，在改动位置查看红绿增删标记。
支持统一视图、左右分栏和修改位置跳转，也可以集中审阅文件列表。

完整对照依赖对应的版本记录；只保存了修改片段的旧会话，无法凭空补回当时的完整文件。

### 写代码时，直接补全或接受下一处修改

**代码补全**在编辑器中显示灰字，`Tab` 接受，`Esc` 关闭。
**Next Edit** 提示下一处修改：修改在别处时，先跳转，再接受；接受后仍可撤销。

补全默认关闭，可以独立启用，不需要先打开聊天。普通续写支持 Codestral、DeepSeek 兼容 FIM、
Ollama 等服务，Next Edit 已接入 Mercury。从状态栏可以暂停、恢复或切换配置。
[查看配置方法 →](docs/AUTOCOMPLETE.md)

### 模型、工具和任务，也能在界面里管理

| 功能 | 可以做什么 |
| --- | --- |
| 模型管理 | 区分服务渠道，修改别名，临时禁用或恢复模型配置 |
| Skills / MCP / 插件 | 查看和管理 Droid 提供的扩展能力 |
| 子代理 | 查看任务活动，从卡片打开子会话；daemon 模式下可继续交流或停止任务 |
| Mission | 查看任务进度与 Worker，进入对应子会话 |

具体支持范围见 [能力说明](docs/CAPABILITIES.md)。本项目仍在持续打磨，已知问题与验证范围记录在
[当前状态](docs/STATUS.md)。

## 开始使用

### 1. 准备编辑器和 Droid

- **编辑器**：VS Code API `1.108.0` 或更高兼容版本的 VS Code / Cursor。
- **Droid CLI**：按 [官方快速开始](https://docs.factory.ai/droid-cli/quickstart.md) 安装并完成认证，
  在终端确认 `droid --version` 正常，所选模型可以使用。
- **模型服务**：使用自己的 Factory 服务或按 [BYOK 说明](https://docs.factory.ai/model-independence/byok.md)
  配置支持的模型。插件不附带订阅或免费额度；编辑器补全另外配置服务和计费。

目前主要在 Windows 上开发和验证；macOS、Linux、WSL、Remote SSH 和容器环境尚未完成同等验收。

### 2. 安装扩展

1. 打开 [最新版本](https://github.com/fireman-droid/droid-for-vscode/releases/latest)，
   在 **Assets** 下载 `droid-版本号.vsix`。当前版本为
   [droid-0.8.3.vsix](https://github.com/fireman-droid/droid-for-vscode/releases/download/v0.8.3/droid-0.8.3.vsix)。
2. 在编辑器扩展面板的 `…` 菜单中选择 **Install from VSIX…**，安装下载的文件。
3. 执行 **Developer: Reload Window**，再运行 **Droid: Open Chat** 打开侧栏。

安装不需要克隆源码或配置 Node.js。需要自行开发时，见 [源码构建指南](docs/DEVELOPMENT.md)。

需要代码补全时，运行 **Droid: Configure Autocomplete**，配置服务后选择 **Enable autocomplete**。

GitHub 下载版需要手动安装新版 VSIX。更新会沿用扩展 ID `droidvisx.droidvisx`，
已有设置与会话继续使用；无需卸载旧版。完整构建与更新方法见 [开发指南](docs/DEVELOPMENT.md)。

## 使用时需要了解

**任务与连接。** 默认 daemon 模式下，窗口重载后后台任务可能仍在运行，关闭面板不等于停止任务。
遇到连接或进度异常时，可按 [排障指南](docs/TROUBLESHOOTING.md) 检查当前状态。

**数据与服务。** 提示词、附件和工具内容会按实际操作交给 Droid、所选模型及相关 MCP / 插件服务处理。
扩展在本地保存恢复状态、图片附件和诊断日志，这些内容不随 Git 仓库迁移，也不保证卸载后自动清除。
补全密钥保存在编辑器 SecretStorage 中，补全不读取聊天历史。

**反馈与隐私。** 日志可能包含对话、命令、文件路径和工具内容。诊断包由你手动导出，不会由导出命令自动上传；
分享日志或截图前请去除个人信息和密钥。具体保存位置、保留规则及排障步骤见 [诊断说明](docs/TROUBLESHOOTING.md)。

## 文档与贡献

欢迎提交 [Issue](https://github.com/fireman-droid/droid-for-vscode/issues) 和 PR。
反馈问题时，请带上编辑器与 Droid CLI 版本、复现步骤，以及脱敏后的截图或日志；
可以参考 [反馈模板](docs/FEEDBACK.md)。

| 想了解什么 | 从这里开始 |
| --- | --- |
| 补全、模型服务与 Next Edit 配置 | [补全指南](docs/AUTOCOMPLETE.md) |
| 本地开发、前端预览与打包发布 | [开发指南](docs/DEVELOPMENT.md) |
| 源码结构与各层职责 | [架构导航](docs/ARCHITECTURE.md) |
| 已支持的功能与当前限制 | [能力说明](docs/CAPABILITIES.md) · [当前状态](docs/STATUS.md) |
| 后续计划与版本变化 | [计划](docs/PLAN.md) · [更新记录](CHANGELOG.md) |

贡献前请阅读 [项目规则](AGENTS.md)。全部文档入口在 [docs/README.md](docs/README.md)。

## 许可与致谢

原创代码采用 [MIT](LICENSE) 许可证，第三方代码与依赖保留各自许可。
补全实现参考并适配了 [Kilo Code](https://github.com/Kilo-Org/kilocode) 与
[Continue](https://github.com/continuedev/continue)；分发包包含相应的第三方许可证。

本项目由社区独立维护，不由 Factory 官方发布、维护或背书。
风车标识来源于 [Factory](https://factory.com/)，名称与标识的权利归各自权利人，
不随本项目 MIT 许可证重新授权。[标识来源说明](docs/DESIGN.md#分发标识)
