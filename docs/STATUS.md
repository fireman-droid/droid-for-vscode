# 当前状态

最后更新：2026-08-30
包版本：`0.7.89`

## 总结

主聊天、新版 Mission Control、实时子代理只读对话、真实浏览器联调和统一
Diff 审查链路已经接通。`0.7.89` 新版 VSIX 已覆盖安装；Cursor 内真实行为
和视觉仍以用户验收为准。

## 已接通

### 聊天与会话

- 新建、恢复、切换、重命名、Fork、Compact 和 Rewind
- daemon 历史加载、本地恢复检查点和长会话虚拟化；问题导航与顶部吸附问题使用
  同一像素边界判定
- 流式文本、Thinking、Tool 生命周期、Stop 和排队消息
- 草稿恢复、历史消息复用、编辑重问和回答重新生成

### 交互与输入

- 权限请求、AskUser 和 ExitSpecMode Plan
- 文件、图片、PDF、活动编辑器、选区、Problems 和 Git changes 附件
- 主 Composer 与历史编辑卡支持选择、粘贴和拖入图片、PDF、可读文本、编辑器 URI
  及公开 HTTPS 图片；落点决定进入主附件区或编辑重发附件区
- 待发送图片支持缩放、平移和红色自由笔标注，保存后原位替换 Host 持有的发送字节；
  GIF 和动态 WebP 只预览、发送，不进入标注
- Slash commands、文件提及和选区加入聊天

### BTW 旁问

- 右侧使用可拖拽宽度的轻量旁注流，回答继续支持 Markdown、代码和长文本
- 输入框自动增长到三行，Enter 发送、Shift+Enter 换行，排队问题贴近输入区；聚焦时
  使用输入容器的中性边线，不继承编辑器主题的彩色 textarea 轮廓
- 主对话正文选区提供 `Add to Chat` 和 `By the Way`，均只预填引用、不自动发送
- 同一主对话内关闭只隐藏并保留旁问上下文；切换主对话或 Reload 后清空

### 展示与 IDE 集成

- 安全 Markdown、代码高亮、KaTeX、Mermaid 和图片预览
- Tool 文件路径、原生 Diff、Changes ReviewDock 和 Git commit
- Canvas HTML 预览、代码、Diff、元素选择和反馈回 Composer
- 只读终端镜像和 Session Viewer
- 子代理 Task 卡实时摘要，整卡打开每 child 独立只读 Editor
- 子代理完整文本、Thinking、Tool 进度/结果、图片和明确生命周期

### Diff Review

- Latest Turn、Workspace 和 Branch 只在 ReviewDock 内切换文件列表；点击 Review
  直接打开当前待审文件并复用一个 Cursor 原生 preview Diff，文件行或 Previous /
  Next 继续切换当前 Diff
- 后续纯聊天回合不会清空最近一次实际改动的 Latest Turn Dock；新的改动回合
  仍会替换它；Commit 只在当前查看该 Latest Turn 时出现，失败后重新读取 Git
  状态并移除已不存在的选中文件，Session 切换按各自 transcript 隔离
- 实时 Changes 同步写入 Host transcript；已打开的 writing Review scope 会随新增文件
  在同一 scope 身份内刷新，并在 turn 结束后切换到 settled snapshot；Reload
  会用持久化 Changes 补齐 snapshot 文件清单并保留完整 settled 文件集，最终无
  净改动时清除临时 Dock
- Latest Turn 缺少完整 before/after snapshot 时，使用已记录的文件清单回退到
  HEAD ↔ Working Diff；该回退只读，不提供 Restore
- 历史 Changes、Workspace 和 Branch 使用同一 ReviewDock；Branch 明确显示
  base branch 和相对该基线的 commit 数，无法建立可靠基线的文件降级为 Open only
- Scope 切换会立即选中目标并显示 Loading，直到匹配的 Review state 或打开失败结果抵达；
  Host 以最多 6 个并发文件版本读取先发布 Review state，再等待原生 Diff 打开，Branch
  commit 数随该 Review state 一次读取投影，不再触发重复 Git diff 请求
- reviewed 只由明确按钮产生，按文件版本持久化；当前 Session 最近打开的 scope
  在 Reload 后重建并验证版本，文件再次变化时显示 changed-after-review，不计入完成率
- Review 的 More 菜单作为按钮上方的悬浮层打开，不改变 Dock 或控制栏高度
- Turn 提供 Restore file / Restore turn 双重预检；展开的文件清单保持路径和
  created 标记可读；未保存编辑、after-state
  不匹配或快照缺失都会阻止写入，整 Turn 任一冲突则全部不写；操作成功或 preview
  已失效后会清除旧确认状态
- Tool 明确命名的 Git ignored 文件也会进入 before / after 精确快照，可正常
  Diff 和 Restore，不再被误判为快照缺失
- ApplyPatch 的 Add、Update 和 Delete 路径都参与实时 ledger 与 pre-tool baseline
- 整 Turn 恢复使用恢复日志和失败回滚；扩展启动时会继续处理未完成恢复日志
- 原生 Diff 左右两侧选区均可通过 `Add Selection to Chat` 回主 Composer，
  引用携带 before/current、文件和 Review scope 身份；历史 Session 的 Diff
  选区不会附加到当前聊天
- Agent Review 仅用于 Workspace / Branch Git scope，通过独立公开 `/review`
  Session 运行；结果使用只读 Session Viewer，不混入主 Session transcript，
  也不改变 reviewed 状态

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

### 真实浏览器联调

- `DroidVisX: Start Browser Dev Client` 从机器级
  `droidvisx.browserDev.sourceRoot`（开发 Host 可回退到扩展源码目录）启动
  Vite 和本机 Bridge；当前 workspace 独立作为真实 Runtime cwd，`/live`
  一次性连接 URL 写入剪贴板供隔离的 `agent-browser` 会话打开
- `/live` 直接渲染生产 `App`，与 Cursor 侧栏共享唯一 `ChatController`、当前
  Session、真实 Runtime 和全部现有操作
- Host 增量同步给浏览器和侧栏；每个客户端 Reload 使用定向 Snapshot，不让另一端
  重复重放
- Browser transport 继续使用共享 Bridge DTO 和 Host 校验，不包含 Droid SDK、
  Runtime 或 Extension Host 代码
- Bridge 只监听 `127.0.0.1`，使用每次启动生成的临时令牌并限制固定 Vite Origin
- `DroidVisX: Stop Browser Dev Client`、扩展停用或 Cursor 窗口关闭时停止 Bridge
  与本次启动的 Vite
- 原有 `pnpm run dev:webview` Studio 继续提供 fake scenario 视觉预览，与真实
  `/live` transport 分离

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

- Mission、实时子代理和 Viewer 基线已建立本地 checkpoint
- 测试套件已删除纯 UI、样式、格式化和自证型用例
- 打包不再自动运行测试
- 真实浏览器联调通过本机 Bridge 与 Vite 启停、双客户端 boot 和定向 replay 验证
