# Droid - AI Coding Agent

**把 Factory Droid 带进 VS Code 与 Cursor。**

在编辑器里推进编码任务、审阅文件改动，或选中代码随时提问。支持使用自己的模型服务（BYOK）。

[Open VSX](https://open-vsx.org/extension/droidvisx/droidvisx) · [下载 VSIX](https://github.com/fireman-droid/droid-for-vscode/releases/latest) · [使用文档](docs/README.md) · [更新记录](CHANGELOG.md)

Droid 是由 droidvisx 维护的非官方社区扩展，连接本机的 Factory Droid CLI。
会话、工具执行与代码审阅集中在同一个工作区；旁问保留主任务上下文，逐项对照改动后再继续。

![Droid 实际界面：左侧对照文件改动，右侧查看对话、任务计划与工具执行](https://raw.githubusercontent.com/fireman-droid/droid-for-vscode/main/docs/images/review-split.png)

*真实使用截图：新增文件的分栏审阅与任务对话。界面以安装版本为准。*

## 安装

需要支持 **VS Code API 1.108.0+** 的编辑器，以及已经安装、认证并可正常使用的
[Factory Droid CLI](https://docs.factory.ai/droid-cli/quickstart.md)。

| 编辑器 | 安装方式 |
| --- | --- |
| Cursor | 在扩展面板搜索 `droidvisx.droidvisx`，安装发布者为 **droidvisx** 的 **Droid**。[Open VSX 页面](https://open-vsx.org/extension/droidvisx/droidvisx) |
| VS Code / 手动安装 | 从 [GitHub Releases](https://github.com/fireman-droid/droid-for-vscode/releases/latest) 下载 `droid-版本号.vsix`，在扩展面板 `…` → **Install from VSIX…** 安装 |

安装包用户不需要克隆源码、Node.js 或 pnpm。找不到市场版本时，也可以使用 VSIX。

1. 在编辑器终端运行 `droid --version`，再运行 `droid`，确认 CLI 可以正常对话。
2. 安装扩展后执行 **Developer: Reload Window**，打开项目文件夹，运行 **Droid: Open Chat**。
3. 选择可用模型，从一个明确的小任务开始：

   > 阅读 README 和项目入口，解释各目录的用途。先不要修改文件。

使用自己的 API Key，按 [Factory BYOK 文档](https://docs.factory.ai/model-independence/byok.md) 配置。
扩展不附带模型订阅、API Key 或免费额度。详细步骤见 [安装与第一次对话](docs/GETTING_STARTED.md)。

## 围绕日常编码

### 看清任务如何推进

在对话中阅读 Markdown、代码、任务计划和工具结果；执行细节按需展开，权限与提问直接在对应卡片处理。
通过会话历史继续已有任务，也可以从子代理卡片进入子会话。Mission Control 提供任务与 Worker 视图。

### 随时问一个旁支问题

选中对话中的文字打开 **BTW 旁问**，保留引用，继续追问；支持图片、独立模型和模型提供的推理强度。
审阅 Diff 时，也可以选中代码发起**行内问答**，围绕当前片段解释改动。
行内问答仅用于解释，模型在设置中的“常规 → 代码审阅问答”配置，默认跟随主聊天。

### 对照检查代码改动

**Review Changes** 提供逐次编辑、整轮任务和 Git 比较范围，支持分栏、改动跳转、上下文展开与已读标记。
查看一次编辑的记录，或检查当前未提交内容，都有对应入口；具备完整版本证据时可撤销相关改动。
不同范围的含义与限制见 [审阅指南](docs/REVIEW.md)。

### 选择适合自己的模型与工具

在管理页配置 **BYOK 渠道、模型别名和启停状态**，并管理当前 Droid 环境提供的 **Skills、MCP 与插件**。
手动写代码时，还可以启用灰字补全与 **Next Edit**：前者在光标处续写，后者提供下一处编辑建议。

补全默认关闭，独立于聊天配置，不读取聊天历史。普通补全支持 Codestral、DeepSeek 兼容 FIM、Ollama 等协议；
Next Edit 接入 Mercury。详见 [模型管理](docs/MODELS.md) 与 [补全配置](docs/AUTOCOMPLETE.md)。

## 使用前了解

- **兼容范围**：主要在 Windows 上开发和验证；macOS、Linux、WSL、Remote SSH 与容器环境尚未完成同等验收。Mission 功能的日常验证也较少。
- **任务生命周期**：默认 daemon 模式下，重载窗口或关闭面板不会自动停止后台任务。需要中断时使用停止操作，并确认任务状态。
- **历史与撤销**：完整文件比较和撤销依赖已保存的版本或修改证据；缺失的历史内容无法补回。
- **版本与更新**：市场安装按编辑器的更新设置获取版本，VSIX 下载版需要手动安装新版。不同分发渠道可能存在时间差，已发布能力以对应版本说明为准。

完整范围见 [能力说明](docs/CAPABILITIES.md)。遇到连接或运行问题，先查看 [排障指南](docs/TROUBLESHOOTING.md)。

## 数据与隐私

聊天、附件和工具内容会按你的操作交给 Droid、所选模型及相关 MCP / 插件服务。
扩展在本机保存会话恢复元数据、暂存附件和诊断日志；这些数据不随 Git 迁移，也不保证卸载后自动清除。
编辑器补全密钥保存在 SecretStorage 中，聊天与补全的模型服务分别配置、分别计费。

诊断包需手动导出，导出命令不会自动上传。提交 Issue 前请去除密钥、私人路径与对话内容。
[数据位置与诊断说明](docs/TROUBLESHOOTING.md)

## 文档与贡献

[使用文档](docs/README.md) · [开发指南](docs/DEVELOPMENT.md) · [架构说明](docs/ARCHITECTURE.md) · [独立 React UI 包](packages/chat-ui/README.md)

欢迎通过 [Issues](https://github.com/fireman-droid/droid-for-vscode/issues) 报告问题、提出建议，或提交 PR。
请附上具体场景、复现步骤与验证结果；开发前阅读 [项目规则](AGENTS.md)，反馈格式见 [反馈指南](docs/FEEDBACK.md)。
维护进度见 [STATUS](docs/STATUS.md)。社区交流：[LINUX DO](https://linux.do/)。

## 许可与致谢

原创代码采用 [MIT](LICENSE)。补全实现参考并适配了 [Kilo Code](https://github.com/Kilo-Org/kilocode)
与 [Continue](https://github.com/continuedev/continue)，第三方代码与依赖保留原许可，分发包附带对应条款。
界面与交互借鉴了 Cursor、Claude for VS Code、Codex 和 Kilo。

本项目由社区独立维护，不由 Factory 官方发布、维护或背书。
Factory 名称和风车标识归各自权利人所有，不随本项目 MIT 许可证重新授权。[标识来源](docs/DESIGN.md#分发标识)
