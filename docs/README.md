# DroidVisX 文档

文档只保留当前有效信息。历史设计、验收记录和施工流水从 Git 历史查看，
不在仓库里维护第二份。

| 文件 | 内容 |
| --- | --- |
| [`PLAN.md`](./PLAN.md) | 当前目标、执行顺序和明确不做的内容 |
| [`STATUS.md`](./STATUS.md) | 已完成、进行中、受限和未实现能力 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 四层架构、关键文件和安全边界 |
| [`DESIGN.md`](./DESIGN.md) | UI 视觉与交互规则 |
| [`chat-ui`](../packages/chat-ui/README.md) | 独立前端包的分发、接口和其他项目接入示例 |
| [`CAPABILITIES.md`](./CAPABILITIES.md) | Droid 能力来源与产品支持矩阵 |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | 日志位置和排障步骤 |
| [`FEEDBACK.md`](./FEEDBACK.md) | Bug、样式和功能反馈模板 |
| [`ARCHITECTURE_SDK_REVIEW.md`](./ARCHITECTURE_SDK_REVIEW.md) | 原调查及 A–F 实施对照；当前结构见 ARCHITECTURE，交付事实见 STATUS |
| [`RUNTIME_CORRECTNESS_REVIEW.md`](./RUNTIME_CORRECTNESS_REVIEW.md) | 用户要求的运行正确性报告；静态问题、候选、覆盖缺口与整改顺序 |

换电脑的依赖安装、构建、静态预览与本机配置边界见根目录 [`README.md`](../README.md)。
安装、非官方声明、MIT 与数据处理说明也在该入口；本地发布准备和人工发布阻塞
见 `STATUS.md`，日志分享风险与手动导出行为见 `TROUBLESHOOTING.md`。
报告中的绝对路径是原审查机器的证据定位，换电脑后以仓库相对路径定位，不要求相同盘符。

工作方式、验证和交付规则只看根目录 [`AGENTS.md`](../AGENTS.md)。

## 维护规则

1. 当前工作只写进 `PLAN.md`。
2. 产品事实只写进 `STATUS.md` 或 `CAPABILITIES.md`。
3. 架构和视觉规则分别只写一处。
4. 已完成的施工过程不追加到文档，版本变化写入 `CHANGELOG.md`。
5. 不创建日期交接、临时调研、验收流水或归档 Markdown。
