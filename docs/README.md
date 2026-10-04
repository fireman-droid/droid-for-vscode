# Droid 文档

在熟悉的编辑器里，完成从讨论代码到审阅修改的工作。

Droid 是 Factory Droid CLI 的非官方 VS Code / Cursor 扩展。聊天、BTW 旁问、
文件 Diff 和代码补全各有自己的位置；执行任务的能力来自本机 Droid，
编辑器补全使用单独配置的模型服务。

第一次使用，从 [安装与第一次对话](GETTING_STARTED.md) 开始。

## 使用指南

| 你想做什么 | 从这里开始 |
| --- | --- |
| 安装扩展，准备 CLI，开始聊天 | [安装与第一次对话](GETTING_STARTED.md) |
| 讨论项目、引用文字，顺便问一个问题 | [聊天与 BTW 旁问](CHAT.md) |
| 配置自己的渠道，修改别名，禁用或恢复模型 | [模型与服务渠道](MODELS.md) |
| 查看文件完整上下文和红绿改动 | [审阅文件改动](REVIEW.md) |
| 开启灰字补全或下一处编辑预测 | [代码补全与 Next Edit](AUTOCOMPLETE.md) |
| 查看子任务，跟进 Mission 的进展 | [子代理与 Mission](MISSIONS.md) |
| 处理连接、模型请求或界面异常 | [排障与诊断](TROUBLESHOOTING.md) |

## 开发文档

第一次读代码从 [架构与代码导航](./ARCHITECTURE.md) 开始，按其中的源码阅读顺序和修改定位表查找。
前端源码统一在 `src/webview-v2/`；预览、构建和类型检查命令见
[开发指南](DEVELOPMENT.md#前端开发与预览)。

| 文件 | 内容 |
| --- | --- |
| [`AUTOCOMPLETE.md`](./AUTOCOMPLETE.md) | 代码补全、模型服务、Next Edit 与读取边界 |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | 开发环境、构建安装、前端预览、换机与发布流程 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 源码阅读顺序、目录职责、发送/恢复流程与修改定位 |
| [`chat-ui`](../packages/chat-ui/README.md) | 独立前端包的分发、接口和其他项目接入示例 |
| [`CAPABILITIES.md`](./CAPABILITIES.md) | Droid 能力来源与产品支持矩阵 |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | 日志位置和排障步骤 |
| [`FEEDBACK.md`](./FEEDBACK.md) | Bug、样式和功能反馈模板 |

换电脑的依赖安装、构建、静态预览与本机配置边界见 [开发指南](DEVELOPMENT.md)。
安装、非官方声明、MIT 与数据处理说明见 [项目首页](../README.md)；本地发布准备和人工发布阻塞
见 `STATUS.md`，日志分享风险与手动导出行为见 `TROUBLESHOOTING.md`。
报告中的绝对路径是原审查机器的证据定位，换电脑后以仓库相对路径定位，不要求相同盘符。

工作方式、验证和交付规则只看根目录 [`AGENTS.md`](../AGENTS.md)。

## 维护规则

网站与 GitHub 使用同一份 Markdown；构建、预览和部署入口见
[维护文档网站](DEVELOPMENT.md#维护文档网站)。
内部计划与状态继续保留在 [PLAN](PLAN.md)、[STATUS](STATUS.md) 和 [DESIGN](DESIGN.md)，
不放入网站主导航。旧基线审查可查 [原记录](RUNTIME_CORRECTNESS_REVIEW.md)，当前结论以 STATUS 为准。

1. 当前工作只写进 `PLAN.md`。
2. 产品事实只写进 `STATUS.md` 或 `CAPABILITIES.md`。
3. 架构和视觉规则分别只写一处。
4. 已完成的施工过程不追加到文档，版本变化写入 `CHANGELOG.md`。
5. 不创建日期交接、临时调研、验收流水或归档 Markdown。
