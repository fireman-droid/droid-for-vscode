# 当前状态

最后更新：2026-08-26
包版本：`0.7.89`

## 总结

主聊天、新版 Mission Control 和实时子代理只读对话的生产链路已经接通。
当前工作区含未提交实现；`0.7.89` 新版 VSIX 已覆盖安装，等待 Reload Window
后的真实运行和视觉验收。

## 已接通

### 聊天与会话

- 新建、恢复、切换、重命名、Fork、Compact 和 Rewind
- daemon 历史加载、本地恢复检查点和长会话虚拟化
- 流式文本、Thinking、Tool 生命周期、Stop 和排队消息
- 草稿恢复、历史消息复用、编辑重问和回答重新生成

### 交互与输入

- 权限请求、AskUser 和 ExitSpecMode Plan
- 文件、图片、PDF、活动编辑器、选区、Problems 和 Git changes 附件
- Slash commands、文件提及和选区加入聊天

### 展示与 IDE 集成

- 安全 Markdown、代码高亮、KaTeX、Mermaid 和图片预览
- Tool 文件路径、原生 Diff、Changes ReviewDock 和 Git commit
- Canvas HTML 预览、代码、Diff、元素选择和反馈回 Composer
- 只读终端镜像和 Session Viewer
- 子代理 Task 卡实时摘要，整卡打开每 child 独立只读 Editor
- 子代理完整文本、Thinking、Tool 进度/结果、图片和明确生命周期

### 设置与扩展能力

- Mode、Model、Reasoning、Autonomy、Context
- Skills 浏览与启停
- MCP Server 浏览、启停、添加、删除和认证
- 自定义 Provider 与模型
- Light、Dark、Auto 三主题
- 本地日志与诊断导出

### Mission Control

- Mission Control Editor 只保留目录、筛选和刷新
- Mode 菜单、New Mission 和目录项把内容带回原 DroidVisX 聊天区；`/mission` 不触发
- Auto 等普通模式不会因后台 Mission 状态投影自动展开右栏
- 产品状态分为普通 Session、Mission Draft 和 Mission Active，底层复用单一 ChatController
- Mission 有自己的 Orchestrator 对话且不进入普通 Sessions 目录，task 是第一条消息
- Start、当前 Mission 和历史 Mission 都会打开对应对话与运行详情
- 关闭 Mission 优先恢复进入前的普通 Session；选择普通 Session 会关闭右栏但不停止后台 Mission
- 原聊天区复用完整聊天和 Composer，右侧复用 BTW 分栏外壳
- 右栏在 280–320px 宽度使用单列配置、纵向执行摘要和明确文字状态
- 完整角色、模型、推理、质量设置与官方 readiness 警告确认
- Mission 目录恢复、真实进度、Feature、Worker Viewer 和 Validator 状态
- Pause activity 中断当前 Orchestrator 活动，Resume 发送恢复指令
- Stop feature 使用官方 `sessions.killWorker()`，不虚构控制能力
- Mission 内容不再创建第二个聊天 App 或第二套交互表面

### 子代理只读对话

- daemon 复用同一 SDK controller 的原始通知事件，不创建第二条连接或第二个 ChatController
- process 模式从当前 Session 原始通知接收 child 事件
- child Session ID、Registry 和 Transcript Store 始终留在 Runtime/Host
- 历史用于初始化、Reload 恢复和 terminal 最终对齐；运行更新不依赖 2.5 秒轮询
- Task 卡与 Viewer 消费同一 Store，多个 child 使用独立 Editor 标签页
- resumed Task 可共享同一 child transcript，每张父 Task 卡仍保留独立打开映射
- Viewer 复用主聊天消息、Thinking、Tool 和图片组件，无 Composer、Diff、Stop 或写操作
- Viewer 使用与主聊天一致的 Cursor 版心；首条 Task Invocation 显示委派摘要并可展开原文
- Webview 只能按父 Session、Turn 和 Task `toolUseId` 请求打开，Host 校验后解析 child

### 能力展示

- 插件面板目前以读取状态为主
- 子代理只展示公开通知和持久化历史能证明的内容，不构造团队树
- Context 只展示可信的最新调用窗口数据，缺失时显示不可用

## 不可用或受限

- Session Delete，没有稳定公开 API
- Undo All，没有安全的统一语义
- 完整账号、用量、组织策略和更新管理
- MCP resources / prompts 的稳定发现接口
- 后台进程和 Worktree 的完整生命周期控制
- 跨设备会话和远程环境
- Mission 目录只恢复当前工作区会话目录中可验证的 Session

## 当前工作区

- Mission Control 完整实现和相关清理仍未提交
- 测试套件已删除纯 UI、样式、格式化和自证型用例
- 打包不再自动运行测试
- 下一步只按 [`PLAN.md`](./PLAN.md) 执行
