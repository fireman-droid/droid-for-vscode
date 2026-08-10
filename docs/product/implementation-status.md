# DroidVisX 实现状态

> 本文档是 DroidVisX 当前实现范围的持续更新台账，用来区分“已经接入产品的功能”“部分实现”“仅能力声明/探测”以及“尚未实现”。
>
> 最后核对日期：2026-08-10
>
> 核对对象：当前工作区源码、Bridge、Extension Host、Droid Runtime 适配、Webview、测试、VSIX 与 Cursor 安装状态

## 状态定义

| 状态 | 判定标准 |
| --- | --- |
| **生产已接通** | 用户界面、Bridge、Extension Host 和 Droid Runtime 之间存在完整生产链路，并有相应测试证据 |
| **部分完成** | 只实现了规格中的一部分，或者当前行为是临时替代方案 |
| **仅探测/声明** | SDK、daemon、CLI 或配置中存在能力证据，但 Extension 和 UI 没有消费该能力 |
| **未实现** | 没有完整的 UI、Bridge、Host 和 Runtime 适配链路 |

能力声明或 smoke probe **不等于产品功能已经实现**。

## 当前结论

DroidVisX 当前完成的是一个可靠的本地 Droid 文本聊天内核，以及基础 Session、历史记录、权限交互和恢复安全能力。

它目前还不是完整的 Droid GUI，也没有完成项目目标要求的完整 MVP 后端适配。动态 Composer、Context、Rewind、Changes/Diff、daemon 主运行路径、Skills、Commands、MCP 管理、Mission 和 Manage Droid 等主要功能仍未实现。

## 生产已接通

### 1. 基础文本聊天

- assistant-ui 聊天界面
- 使用本地 Droid SDK `ProcessTransport`
- 新建和恢复 Droid Session
- 发送纯文本消息
- Assistant 文本流式输出
- Stop 中断当前轮次
- Markdown/GFM 安全渲染
- Webview 草稿保存与恢复

主要实现：

- `src/webview/assistant/App.tsx`
- `src/webview/assistant/Thread.tsx`
- `src/webview/assistant/runtimeAdapter.ts`
- `src/extension/ChatController.ts`
- `src/runtime/FactoryDroidRuntime.ts`

### 2. Thinking 和 Tool 生命周期

- Thinking 流式内容和折叠展示
- Tool 开始、运行、完成和失败状态
- 同一个 Tool 的重复事件合并
- Stop、刷新和 Runtime 重建后的状态收敛
- Tool 数量和文本长度限制

安全限制：

- UI 只接收 Tool 名称、关联 ID 和生命周期
- Tool 参数、原始输出、完整结果和其他 SDK Payload 不进入 Webview

### 3. 权限请求

- 投影 Droid SDK 返回的真实权限选项
- Edit、Execute、Create、Patch、MCP Tool、Sandbox、Spec 和 Mission 等确认类别
- 有界的标题、详情和风险说明
- 防止重复响应
- 请求与精确的 Workspace、Session、Turn 和 Runtime Generation 绑定
- 过期或非法响应安全取消

主要实现：

- `src/runtime/runtimeInteractions.ts`
- `src/extension/pendingInteractionCoordinator.ts`
- `src/webview/assistant/Interactions.tsx`

### 4. AskUser

- 单选
- 多选
- 自定义答案
- 一次处理多个问题
- Submit 和 Cancel
- 按原问题索引精确返回答案

### 5. Exit Spec 审批子集

- 显示 `ExitSpecMode` 返回的计划
- 在 SDK 提供可编辑选项时编辑计划
- 返回 Droid SDK 提供的审批结果

这只是 Exit Spec 权限交互，不代表完整 Spec Mode 已实现。

### 6. 基础 Session 导航

- 列出当前工作区的本地 Session
- 刷新列表
- 新建 Session
- 选择和恢复 Session
- 本地按标题或 ID 过滤
- 显示更新时间和消息数量

主要实现：

- `src/runtime/FactorySessionCatalog.ts`
- `src/webview/assistant/SessionDrawer.tsx`
- `src/extension/ChatController.ts`

### 7. 旧 Session 历史加载

- 使用公开低层接口 `DroidClient.loadSession()`
- 加载 CLI 创建的已有 Session
- 投影用户文本、助手文本、Thinking 和 Tool 生命周期
- 过滤隐藏内容、Hook 内容和 SDK 系统标记
- 对过长内容进行截断
- 对不支持的内容显示 partial/unavailable 状态

主要实现：

- `src/runtime/history/FactorySessionHistoryLoader.ts`
- `src/runtime/history/projectSessionHistory.ts`

### 8. Session 和 Webview 恢复

- 保存选中的 Session
- 保存有界的 Transcript 恢复缓存
- Webview 刷新后恢复快照
- 恢复未处理的权限交互
- Host 重启后把未完成活动归一为停止状态

主要实现：

- `src/extension/SessionRecoveryStore.ts`
- `src/extension/ChatController.ts`

### 9. Workspace 与安全边界

- 没有工作区时阻止 Runtime 启动
- Workspace 未信任时阻止 Runtime 启动
- Workspace 或 Trust 改变时关闭旧 Runtime
- 拒绝旧 Runtime、旧 Session 和旧 Turn 的迟到事件
- Webview 到 Host 使用严格消息校验
- Host 到 Webview 使用严格消息校验
- Webview Bundle 不包含 Droid SDK、Host Runtime 或云端 Runtime
- CSP 禁止 Webview 网络连接
- Markdown 禁止原始 HTML 和非 HTTP(S) 链接

主要实现：

- `src/shared/strictValidation.ts`
- `src/shared/validateMessage.ts`
- `src/webview/bridge/validateHostMessage.ts`
- `src/extension/webviewHtml.ts`
- `esbuild.mjs`

## 部分完成

| 功能 | 当前实现 | 尚缺内容 |
| --- | --- | --- |
| Retry | 关闭并重新创建或恢复 Runtime | 不会重新发送失败 Prompt，也不是消息级 Regenerate/Reload |
| CLI/连接诊断 | CLI 不存在、工作区无效、未信任和初始化失败提示 | 实际登录状态、登录操作、版本兼容 UI、账户状态、升级入口 |
| Session 搜索 | 在最多 50 条本地结果中按标题或 ID 过滤 | daemon 全量搜索、内容搜索、分页、排序和筛选 |
| Session 生命周期 | List、Refresh、New、Select、Resume | Rename、Archive、Delete、Favorite、Fork、Compact、Rewind |
| Session 历史 | 文本、Thinking、Tool 生命周期 | 历史 Image、Document 和未知 Block 会被省略并标记为 partial |
| Tool 展示 | 名称、ID、运行状态 | 参数、输出、结果、耗时、文件变更、Apply/Open 操作 |
| Spec | ExitSpecMode 计划显示、编辑和审批 | 进入 Spec Mode、模式状态、完整计划生命周期、实施交接 |
| Mission | Mission 相关确认可以显示为通用权限卡片 | Mission 状态、事件、阶段、Worker、控制和独立 UI |
| Diff | 权限详情可以显示原始文本或 Patch | 原生 Diff 模型、Hunk 操作、`vscode.diff`、Changes 页面 |
| Workspace | 使用 `workspaceFolders[0]` | 多根工作区选择 |
| Extension 入口 | 当前贡献 Activity Bar Webview | 与“Secondary Sidebar 为主界面”的当前项目要求仍需统一 |

## 仅探测/声明，没有接入产品

### Capability Gate 0.1

源码中存在独立的 Host-only 能力清单、探测器和 opt-in smoke：

- `src/runtime/capabilities/capabilityContract.ts`
- `src/runtime/capabilities/FactoryDroidCapabilityProbe.ts`
- `src/runtime/capabilities/capabilitySmoke.ts`
- `docs/engineering/droid-capability-matrix.md`

已经完成的探测能力包括：

- CLI、SDK 和协议版本
- Settings 字段结构
- CWD 和 Context 字段结构
- Tool 数量
- Skill 数量
- MCP Server 和 Tool 数量
- 已有 Session 的只读 Resume
- 超时、Abort、清理和 malformed Session Handle 防护
- 无 Prompt、无新建 Session、结构化隐私安全输出

但是：

- `src/extension/extension.ts` 没有实例化或消费 Capability Gate
- 没有对应 Bridge DTO
- 没有 Host 产品控制器
- 没有 Webview UI
- 不会启用任何产品功能

因此以下能力目前仍然只是探测结果或声明：

- Live Settings
- Mode、Model、Reasoning、Autonomy
- Context Stats
- Skills
- MCP Servers 和 Tools
- 图片和文档附件能力
- Session Rename、Archive、Fork、Compact、Rewind
- Mission Mode 和 Events
- Worktree Session Creation

## MVP 未完成

### 运行架构

- [ ] daemon 作为主要运行路径
- [ ] daemon 连接和认证
- [ ] daemon 生命周期管理
- [ ] daemon 失败时回退 Node subprocess
- [ ] Capability Gate 接入 Extension 的安全产品门控

当前生产代码只使用 Node SDK `ProcessTransport`。

### 动态 Composer

- [ ] Auto / Normal / Spec / Mission 模式选择
- [ ] Autonomy 选择
- [ ] Model 选择
- [ ] Reasoning Effort 选择
- [ ] Context 使用量
- [ ] Context 明细
- [ ] `＋` 动作面板
- [ ] `@` 文件和 Symbol 引用
- [ ] `/` 动态命令
- [ ] 已附加内容标签

当前 Composer 只有文本输入、Send、Stop 和 Runtime Retry。

### Context 与附件

- [ ] 文件附件
- [ ] 图片附件
- [ ] 文档附件
- [ ] 当前编辑器
- [ ] 编辑器选区
- [ ] Open Editors
- [ ] Problems
- [ ] Git Changes
- [ ] Terminal Output
- [ ] 项目文件选择
- [ ] Symbol 引用

### Edit、Resend 和 Rewind

- [ ] 编辑历史用户消息
- [ ] 消息级重新发送
- [ ] Assistant 消息 Regenerate
- [ ] Turn Envelope
- [ ] `getRewindInfo`
- [ ] 文件变化安全检查
- [ ] 保留当前工作区或恢复文件的选择
- [ ] 冲突检测
- [ ] Rewind 后建立分支 Session

### Changes 与 Diff

- [ ] 每轮 Changes 摘要
- [ ] 文件增删行统计
- [ ] Changes 页面
- [ ] 使用 `vscode.diff`
- [ ] Diff Hunk 操作
- [ ] 文件恢复确认
- [ ] SCM 集成

## V1 未完成

- [ ] Skills 列表、选择和管理
- [ ] Droid Commands 列表
- [ ] 动态 Slash Commands
- [ ] 最近使用命令
- [ ] MCP Server 列表
- [ ] MCP Tool 浏览
- [ ] MCP 启用、禁用和认证
- [ ] Custom Droids
- [ ] Session Rename
- [ ] Session Archive / Unarchive
- [ ] Session Delete
- [ ] Session Favorite
- [ ] Session Fork
- [ ] Session Compact
- [ ] Session Rewind
- [ ] Session 分支关系
- [ ] 完整 Spec Mode
- [ ] Mission 启动
- [ ] Mission 阶段和 Worker 摘要

## V2 未完成

- [ ] Mission Control
- [ ] Worker 详情
- [ ] Plugins
- [ ] Marketplaces
- [ ] Hooks 管理
- [ ] Automations
- [ ] Custom Models
- [ ] 组织策略
- [ ] Account Profile
- [ ] Account Usage
- [ ] Git Commit / Push / Pull Request
- [ ] 原生 Terminal 工作流
- [ ] Background Processes
- [ ] Worktree 生命周期
- [ ] 远程环境
- [ ] 跨设备 Session
- [ ] Help 和 Feedback
- [ ] 诊断导出
- [ ] 更新管理

## 当前安装包状态

最后核对结果：

- Cursor 已安装：`droidvisx.droidvisx@0.0.0`
- `dist/droidvisx.vsix` 大小：676,393 字节
- VSIX 修改时间早于 Capability Gate 源码修改时间
- 当前已安装包不包含最新 Capability Gate 源码
- Capability Gate 本身没有接入 Extension/UI，因此即使只重新打包，也不会产生新的可见功能

## 验证状态

最近记录的验证结果：

- Capability Contract/Probe 聚焦测试：28/28
- Extension TypeScript 检查：通过
- Capability 实机无提示 smoke：通过
- 完整测试套件：338/338 通过
- 所有 TypeScript 检查：通过
- Production Build：通过

## 仓库状态

当前实现已在提交 `0fb5e5c` 中形成可复现检查点：

- `src/`、测试、构建配置、依赖锁文件和工程文档已纳入 Git
- 旧 UI 规格和旧概念图已按用户决定删除
- 旧 `.codex` 多 Agent 工作流已删除
- 项目只保留 BYOK `custom:gpt-5.6-terra` code-writer
- `artifacts/`、本地 `.factory/skills/`、`.workflow/`、`dist/` 和 `node_modules/` 已忽略

后续交付顺序和完成标准见
[`delivery-plan.md`](./delivery-plan.md)。

## 建议的下一条真实产品实现链

下一阶段执行
[`delivery-plan.md`](./delivery-plan.md)
中的模块 1“Session Settings 与 Context”：

1. 生产 Runtime 读取 Session Settings 和 Context Stats
2. 增加严格的 Host 状态与更新接口
3. 增加双向 Bridge DTO 与敌对输入测试
4. Composer 显示并修改 Mode、Model、Reasoning 和 Autonomy
5. 显示 Context 使用量和明细
6. 运行完整测试、TypeScript 检查和 Production Build
7. 重新打包 VSIX
8. 安装后在 Cursor 中执行可见验收

Session Rename、附件、Rewind 和 daemon 主路径迁移不进入模块 1。

## 维护规则

以后每完成一个功能，必须在同一个变更中更新本文档：

1. 只有 UI、Bridge、Host 和 Runtime 链路全部接通后，才能标记为“生产已接通”。
2. 只有 Capability Contract、Probe 或测试证据时，必须保持“仅探测/声明”。
3. 临时替代行为必须标记为“部分完成”，并写明与规格的差距。
4. 打包或安装后必须更新“当前安装包状态”。
5. 验证章节只记录实际执行过的命令和结果，不得根据源码推测通过。
6. 不得把通用权限卡片误报为完整 Spec 或 Mission 产品功能。
