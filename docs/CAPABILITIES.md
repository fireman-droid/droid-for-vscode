# 能力矩阵

Droid CLI/SDK 是唯一权威。这里描述产品是否已经消费某项能力，不代表
SDK 中出现接口就自动成为产品功能。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 文本聊天与流式回复 | 已接通 | Process 与 daemon 模式 |
| Session 列表、恢复、切换 | 已接通 | 含本地恢复检查点 |
| Rename、Fork、Compact、Rewind | 已接通 | 通过公开 SDK |
| Delete | 不可用 | 没有稳定公开 API |
| 历史与长会话 | 已接通 | daemon 分页、对账和虚拟化 |
| 权限与 AskUser | 已接通 | 严格绑定当前请求 |
| TodoWrite Plan | 已接通 | 标题来自步骤，不伪造 |
| 设置与 Context | 已接通 | 缺少可信值时显示不可用 |
| 模型与 Reasoning | 已接通 | 运行时目录，不硬编码 |
| 自定义 Provider / Model | 已接通 | Host 侧处理密钥 |
| 文件与图片附件 | 已接通 | 内容不进入 Webview |
| Tool 活动与输出预览 | 已接通 | 有界、脱敏、生命周期真实 |
| Git Changes、Diff、Commit | 已接通 | VS Code 与 Git 适配 |
| Markdown、KaTeX、Mermaid | 已接通 | 禁止原始 HTML |
| Canvas HTML | 已接通 | opaque-origin、零网络沙箱 |
| Skills | 已接通 | 浏览与启停 |
| MCP | 已接通 | 浏览、启停、添加、删除、认证 |
| Plugins | 部分 | 以只读状态展示为主 |
| 子代理 | 已接通 | 只展示公开 API 能证明的信息 |
| Mission | 已接通 | 独立 Session、完整聊天、readiness、目录恢复、进度、Worker Viewer 和受支持控制 |
| Worktree 生命周期 | 受限 | 只有部分 daemon 能力证据 |
| 后台进程管理 | 受限 | 可展示，缺少完整控制权 |
| 账号、用量、组织策略 | 未接入 | 没有稳定产品契约 |
| 跨设备 Session | 未计划 | 当前产品只面向本地工作区 |

## 判断规则

- **已接通**：Runtime、Host、Bridge 和 UI 都有真实生产路径。
- **部分**：只有部分用户流程可用。
- **受限**：能观察，但不能安全完成完整生命周期。
- **不可用**：没有受支持的公开能力。
- **未计划**：当前产品范围明确排除。

## 安全规则

- 凭据、OAuth URL、原始工具参数和敏感输出不进入 Webview。
- 本机路径只投影为经过边界检查的工作区相对路径。
- Session、Turn、Worker 和请求身份不由 UI 猜测。
- 未知字段、额外键、越界文本和非法枚举整条拒绝。
