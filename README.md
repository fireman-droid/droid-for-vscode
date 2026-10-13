# Droid

**面向 VS Code 与 Cursor 的 AI 编码工作台。**

Droid 将 Factory Droid CLI 的对话、任务执行和代码审阅接入编辑器，支持 BYOK 模型、独立侧问答与代码补全。项目由社区独立维护，是 Factory Droid CLI 的非官方扩展。

[安装扩展 · Open VSX](https://open-vsx.org/extension/droidvisx/droidvisx) · [下载 VSIX](https://github.com/fireman-droid/droid-for-vscode/releases/latest) · [使用文档](docs/README.md) · [版本记录](CHANGELOG.md)

![Droid 功能示例：任务计划、对话与多文件代码审阅](https://raw.githubusercontent.com/fireman-droid/droid-for-vscode/main/docs/images/v0.8.10/final/01-overview.webp)

*图示由 v0.8.10 生产界面与演示数据截取，主聊天和 Review 为两个独立场景。当前版本的布局与交互已有进一步优化。*

## 安装与开始使用

需要支持 **VS Code API 1.108.0+** 的编辑器，以及已安装、认证并可正常使用的 [Factory Droid CLI](https://docs.factory.ai/droid-cli/quickstart.md)。安装扩展无需克隆源码或安装 Node.js。

| 编辑器 | 安装方式 |
| --- | --- |
| Cursor / Open VSX 兼容编辑器 | 在扩展面板搜索 `droidvisx.droidvisx`，核对名称 **Droid - AI Coding Agent** 与发布者 **droidvisx**；也可从 [Open VSX](https://open-vsx.org/extension/droidvisx/droidvisx) 获取 |
| Microsoft VS Code / 手动安装 | 从 [GitHub Releases](https://github.com/fireman-droid/droid-for-vscode/releases/latest) 下载 `droid-版本号.vsix`，在扩展面板选择 **Install from VSIX…** |

1. 在编辑器终端运行 `droid --version`，再运行 `droid`，确认 CLI 和所选模型可用。
2. 安装扩展后执行 **Developer: Reload Window**，打开项目文件夹，运行 **Droid: Open Chat**。
3. 选择模型并描述任务。需要权限或补充信息时，在对应卡片中确认；文件修改后进入 **Review Changes** 查看结果。

扩展不附带模型订阅、API Key 或免费额度。聊天与代码补全分别配置、分别计费。完整步骤见 [安装指南](docs/GETTING_STARTED.md)，自定义服务见 [模型与渠道](docs/MODELS.md)。

## 核心功能

### 对话与任务执行

在同一对话中查看计划、工具调用、权限请求和执行结果，支持 Markdown、代码高亮、公式与图表。历史会话可搜索、继续和导出；BTW 侧问答用于解释选中内容，独立选择模型与推理强度，保留主任务上下文。

主聊天、BTW 与代码问答支持紧凑的文件和行号引用，可与问题文字混排。主聊天和 BTW 中点击引用可定位编辑器文件；Review 中点击引用可回到对应代码并短暂高亮。

### 代码审阅与行内问答

Review 支持逐次编辑、整轮任务和 Git 比较，提供分栏／合并视图、文件筛选、上下文展开与已读标记。选中 Diff 代码即可带入引用并提问，回答在代码旁展开；问答用于解释，不执行文件修改。文件撤销与消息回退各有明确范围和条件。

![Review 行内问答功能示例：在分栏 Diff 中解释选中的代码](https://raw.githubusercontent.com/fireman-droid/droid-for-vscode/main/docs/images/v0.8.10/final/09-review-question.webp)

*v0.8.10 界面示例，使用演示数据。完整操作与范围说明见 [审阅指南](docs/REVIEW.md)。*

### 模型、工具与工作区设置

集中管理 BYOK 渠道、模型别名及启停状态。模型选择支持搜索；支持推理强度的模型可单独设置档位。计划模型可跟随主模型或独立配置，选择模型不会切换聊天模式。

管理页提供会话默认设置、Skills、MCP 与插件入口。Mission 将目标拆分为 Feature 与 Worker，展示任务进度和验证结果。界面支持简体中文、繁体中文、英语，以及浅色、深色和自动主题。

### 代码补全与 Next Edit

灰字补全在光标处提供续写，Next Edit 提供下一处编辑建议。补全默认关闭，使用独立的模型服务，不读取聊天历史。支持的协议、上下文范围和启用步骤见 [补全指南](docs/AUTOCOMPLETE.md)。

## 使用范围与数据

- **运行环境**：主要在 Windows 上开发和验证；macOS、Linux、WSL、Remote SSH 与容器环境尚未完成同等验收。
- **后台任务**：默认 daemon 模式下，关闭面板或重载窗口不会自动停止任务。中断操作以后台确认的状态为准。
- **历史与恢复**：完整文件比较及撤销依赖已保存的版本和修改证据。具体限制见 [能力说明](docs/CAPABILITIES.md)。
- **数据处理**：聊天、附件与工具内容按操作发送到 Droid、所选模型及相关服务。本机保存会话恢复数据、暂存附件和诊断日志；补全密钥存入编辑器 SecretStorage。
- **诊断与反馈**：诊断包由用户主动导出，不会自动上传。反馈前请移除密钥、私人路径和对话内容。见 [排障指南](docs/TROUBLESHOOTING.md)。

市场安装按编辑器设置更新，VSIX 安装需手动获取新版。GitHub 与市场可能存在同步延迟；各渠道沿用同一扩展 ID `droidvisx.droidvisx`。

## 文档与贡献

| 主题 | 入口 |
| --- | --- |
| 日常使用 | [聊天与 BTW](docs/CHAT.md) · [模型管理](docs/MODELS.md) · [代码审阅](docs/REVIEW.md) |
| 任务与补全 | [子代理与 Mission](docs/MISSIONS.md) · [代码补全与 Next Edit](docs/AUTOCOMPLETE.md) |
| 开发与接入 | [开发指南](docs/DEVELOPMENT.md) · [架构说明](docs/ARCHITECTURE.md) · [React UI 包](packages/chat-ui/README.md) |

通过 [Issues](https://github.com/fireman-droid/droid-for-vscode/issues) 提交问题与建议，或通过 Pull Request 参与开发。请提供复现步骤、环境信息与验证结果；贡献前阅读 [项目规则](AGENTS.md)。

## 许可与致谢

原创代码采用 [MIT](LICENSE) 许可证。补全实现参考并适配 [Kilo Code](https://github.com/Kilo-Org/kilocode) 与 [Continue](https://github.com/continuedev/continue)，第三方代码和依赖保留各自许可，分发包附带相应条款。界面与交互参考了 Cursor、Claude for VS Code、Codex 和 Kilo。

本项目不由 Factory 官方发布、维护或背书。Factory 名称和风车标识归各自权利人所有，不随本项目 MIT 许可证重新授权。[标识来源](docs/DESIGN.md#分发标识)
