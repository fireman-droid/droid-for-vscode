# DroidVisX 产品交付计划

> **状态（2026-08-12 整理）**：交付原则、层级边界与完成标准**现行
> 有效**；但下方「模块路线图」表的"当前状态"列与「模块 1」章节是
> 2026-08-10 的历史快照，**早已过时**——进度以
> [`implementation-status.md`](./implementation-status.md) 为准，
> 执行顺序以 [`debug/handover-2026-08-15.md`](../debug/handover-2026-08-15.md) 为准。
>
> 本文档回答“接下来做什么、按什么顺序做、怎样才算完成”。
> 本计划不恢复已经废弃的旧 UI 规格或旧概念图。
>
> 最后更新：2026-08-10（状态头 2026-08-12 追加）

## 产品目标

DroidVisX 是本地 Droid CLI/SDK 在 Cursor 中的可视化工作台。Droid
继续作为 Session、模型、设置、工具、权限、Skills、MCP、Spec、
Mission、认证和策略的唯一权威。

产品不建立第二套 AI 后端，不要求用户重复配置 API Key，也不在
Webview 中保存或处理 Droid 凭据。

## 交付原则

### 1. 按垂直模块交付

每个模块必须形成完整生产链路：

```text
Droid 真实能力
→ Runtime Adapter
→ Extension Host
→ 严格 Bridge DTO
→ Webview UI
→ 聚焦测试
→ 完整验证
→ VSIX
→ Cursor 可见验收
```

模块内部先实现 Runtime 和 Host，再实现 Bridge 和 UI。项目整体不采用
“先写完全部后端，再统一写前端”的方式。

### 2. 先确认原型，再写模块

每个用户可见模块按以下顺序推进：

1. 基于当前实际 UI 制作该模块的少量原型。
2. 用户确认布局、状态和主要交互。
3. 固定模块目标、非目标和验收标准。
4. 当前实现 Agent 按 Runtime、Host、Bridge、Webview 的依赖顺序完成实现。
5. 先检查并冻结共享 Bridge Contract，再更新对应消费者。
6. 运行聚焦验证并检查真实浏览器中的窄、宽布局。
7. 集成、完整验证、打包并交由用户在 Cursor 中完成可见验收。

原型只定义视觉和交互，不得凭空定义 Droid Runtime 能力。

### 3. 单 Agent 实施边界

仓库默认由当前实现 Agent 独立完成，不配置或调用专用 Backend、Frontend
Writer。单 Agent 仍需保持层级边界：

- Runtime 与 Extension Host 负责消费真实 Droid 能力。
- 共享 Bridge 负责严格、版本化和有界的信任边界。
- Webview 只消费已经验证的 Contract，不增加假字段或前端专用后门。
- Contract 变更必须先定义和验证，再更新 Host 与 Webview 消费者。
- 不得因为由一个 Agent 实施而混合 Runtime、Host 和 UI 职责。

### 4. 一个模块一次正式验证

- 开发期间只运行相关聚焦测试。
- 模块集成后运行一次完整测试和 TypeScript 检查。
- UI 模块运行一次 Production Build、VSIX 打包和 Cursor 验收。
- 每个完成模块形成一个独立 Git Commit。
- 同一模块没有完成前，不并行铺开下一个模块。

### 5. 完成必须可见

只有代码、测试、打包和 Cursor 验收全部完成，模块才能在
`implementation-status.md` 中标记为“生产已接通”。

SDK 声明、Capability Contract、Probe 或 Smoke 只能证明能力证据，不能
单独视为产品功能。

## 模块路线图

| 顺序 | 模块 | 用户结果 | 当前状态 |
| --- | --- | --- | --- |
| 1 | Session Settings 与 Context | 查看并安全修改 Session 设置，查看 Context 使用量 | **待 Cursor 可见验收** |
| 2 | Context Sources 与附件 | 向 Droid 添加文件、编辑器、选区、问题、Git 和附件上下文 | 未开始 |
| 3 | Session 管理 | Rename、Archive、Delete、Favorite、搜索和分页 | 未开始 |
| 4 | Edit、Resend 与 Rewind | 编辑旧消息，安全回退并重新发送 | 未开始 |
| 5 | Changes 与 Diff | 查看每轮文件变化并打开原生 Diff | 未开始 |
| 6 | Skills 与 Commands | 浏览真实 Skills 和动态 Commands | 未开始 |
| 7 | MCP | 浏览、启停和认证 MCP Server 与 Tool | 未开始 |
| 8 | Spec 与 Mission | 完整模式状态、计划和 Mission 进度控制 | 未开始 |
| 9 | Manage Droid | 账户、策略、模型、插件、Hooks、Automations 等管理功能 | 未开始 |

daemon、Terminal、Git/PR、Worktree 和远程环境在对应模块需要时进入单独
的架构决策，不提前建设没有消费者的抽象层。

## 模块 1：Session Settings 与 Context

### 用户结果

用户在 Cursor 聊天 Composer 附近能够：

- 查看当前 Session 的 Interaction Mode。
- 查看当前 Model。
- 查看当前 Reasoning Effort。
- 查看当前 Autonomy Level。
- 查看 Context 已使用、剩余、上限和准确度。
- 修改 Droid 真实支持且具有稳定选项来源的设置。
- 在 Session 切换、Runtime 重建或设置更新后看到最新状态。
- 通过语义 Tool 动作、生命周期和有界进度了解 Droid 正在做什么，而不暴露
  命令、路径、参数或输出。
- Copy 用户消息，或把历史 Prompt 非破坏性 Reuse 到当前 Composer。
- 通过本地轮换 JSONL 和 `DroidVisX: Open Logs` 调查不可见错误和耗时。

### 已确认的 Droid 能力

当前安装的 `@factory/droid-sdk` Node Session 提供：

- `session.settings`：实时只读 Session 设置。
- `session.updateSettings(...)`：更新 Session 设置。
- `session.getContextStats()`：读取 Context 使用量。
- 公开低层 `DroidClient.initializeSession()` / `loadSession()` 响应中的
  `availableModels`：当前 Session 可用模型和对应 Reasoning 选项。

本模块使用的公开设置字段：

- `interactionMode`
- `modelId`
- `reasoningEffort`
- `autonomyLevel`

Context 使用公开字段：

- `used`
- `remaining`
- `limit`
- `accuracy`

### 模型列表门控

SDK 将 Model ID 定义为运行时发现的字符串，不允许把模型列表硬编码为
封闭枚举。

当前生产路径已经确认可信来源：使用公开
`InitializeSessionResponseSchema` / `LoadSessionResponseSchema` 和对应 Result
Schema，从同一个 Session 初始化或加载响应中保留 `availableModels`，再通过
Runtime 和 Host 投影给 Webview。UI 可以提供 Model 选择并通过
`updateSettings()` 写回。

如果响应不包含目录或目录无法通过有界投影，UI 必须保持 fail closed，
只显示当前 `modelId`，不得退回硬编码列表。

不得使用原型中的示例模型、旧模型列表或人工维护列表冒充 Droid 数据。

### 原型范围

编码前只制作本模块的以下状态：

1. 默认 Composer 状态。
2. Settings 展开状态。
3. Context 详情展开状态。
4. Loading、Updating、Failed 和 Unsupported 状态。
5. Cursor 窄 Secondary Sidebar 状态。

原型基于当前 assistant-ui 界面演进，不重新设计整个产品。

### 生产实现链路

#### Runtime

- 为生产 `DroidRuntime` 增加有界的 Settings/Context 读取接口。
- 为支持的字段增加最小 Settings 更新接口。
- 使用实际 `DroidSession.settings`、`updateSettings()` 和
  `getContextStats()`。
- 在公开 String-Framed Transport 边界按公开 SDK Schema 保留初始化/加载
  响应中的模型目录，不读取 Session 私有字段或私有持久化文件。
- 不把原始 SDK 对象或错误消息直接暴露给 Webview。
- 把同一个隐私安全 SDK Observability Bundle 注入 Transport 和 Session，
  并只记录有界的初始化/Turn 结果、计数和耗时。

#### Extension Host

- 在 Runtime 初始化、Session 切换和 Runtime Retry 后加载状态。
- 为读取和更新操作绑定 Workspace、Session 和 Runtime Generation。
- 拒绝旧 Session 或旧 Runtime 的迟到结果。
- 更新期间提供明确状态，并在失败后恢复最后一次确认值。
- 设置更新成功后重新读取权威 Session 状态，不依赖乐观值作为最终值。
- 本地诊断 Sink 失败必须被隔离；JSONL 当前文件上限 512 KiB，并只保留两个
  轮换备份。

#### Bridge

- 增加严格、有界、版本化的 Settings/Context DTO。
- Webview 到 Host 只允许白名单字段和合法枚举值。
- Host 到 Webview 不发送 SDK 对象、未知字段或原始异常。
- 为额外字段、Getter、Proxy、超长字符串和非法数值补充敌对输入测试。
- Tool 活动只允许语义动作、生命周期、有界进度计数和通用更新类别；不得
  传递命令、路径、参数、输出、原始错误或 Terminal/Subagent ID。

#### Webview

- 在 Composer 附近显示紧凑状态摘要。
- Settings 和 Context 使用可关闭的展开面板。
- 保留当前 assistant-ui Runtime 和 Primitives。
- 主界面使用固定的 DroidVisX 暖色 Token，不让 Cursor 主题覆盖产品配色。
- Cursor 变量只用于焦点、高对比度和必要的平台集成兜底。
- Loading、Updating、Failed、Unsupported 必须可区分。
- 更新进行中时避免重复提交。
- 窄侧边栏中不产生横向滚动。
- 不支持或无法发现选项的控件必须隐藏或禁用，而不是使用假数据。
- Tool 行以语义动作作为主内容，不以 Call ID 作为可见内容。
- 用户消息提供 Copy 和 Reuse；双击等价于 Reuse in Composer，不自动发送，
  也不声称历史 Edit、Resend、分支或 Rewind。
- Context 失败只显示一个可访问的 Alert。

### 非目标

本模块不包含：

- 文件、图片或文档附件
- `@` Context Sources
- Session Rename
- Edit、Resend 或 Rewind
- Changes 或 Diff
- Skills、Commands 或 MCP
- 完整 Spec 或 Mission
- daemon 主路径迁移
- Module 1 之外的全产品信息架构重做

### 测试要求

#### 聚焦测试

- Runtime Settings 读取、更新和 Context 读取。
- 公开初始化/加载响应中的模型目录捕获、投影和非法目录 fail-closed。
- Settings 更新失败和读取失败。
- Session 切换与迟到结果隔离。
- Bridge 双向合法和敌对输入。
- Webview 默认、展开、Updating、Failed 和 Unsupported 状态。
- 窄布局关键行为。
- SDK Progress 隐私投影、Tool 进度上限和 Bridge/Recovery 一致性。
- Copy、Reuse、双击 Draft 同步、单一 Context Error。
- 本地日志轮换、Sink Failure 隔离和禁止字段缺失证明。

#### 模块完成验证

```text
pnpm test
pnpm run typecheck
pnpm run build
pnpm run package:vsix
pnpm run verify:vsix
```

随后安装 VSIX，并在 Cursor 中验证：

1. 新 Session 显示真实设置。
2. 旧 Session Resume 后显示对应设置。
3. 修改设置后 Droid Session 真实更新。
4. 切换 Session 后状态不会串线。
5. Context 数值来自当前 Session。
6. 不支持的字段不会显示假选项。
7. 窄 Secondary Sidebar 可正常操作。
8. Tool 行能说明安全语义活动且不显示原始 Call ID。
9. Copy/Reuse 不会自动发送，双击 Reuse 后 Composer 获得焦点。
10. `DroidVisX: Open Logs` 能打开本地 Output Channel，日志不包含 Prompt、
    路径、命令、Payload、原始错误或 Stack Trace。

### 完成标准

以下条件必须全部满足：

- Runtime、Host、Bridge 和 UI 链路完整。
- 没有硬编码模型列表或伪造能力。
- 聚焦测试和完整验证通过。
- 新 VSIX 已生成并验证。
- Cursor 中完成可见验收。
- `implementation-status.md` 已更新。
- 形成一个独立 Git Commit。

## 当前插入切片：产品化打磨轮（2026-08-11）

在 Module 1 验收与 Module 2 之间，按用户要求插入一轮不新增 Droid 能力的
产品化打磨，包括：Production Build（minify + production React）、长会话
渲染性能（消息身份缓存、Thinking 展开局部化、尾部窗口渲染）、styles.css
去重、权限/Plan/AskUser 拍平为对话流内的扁平内联交互块、Tool/Thinking
行内联耗时（Runtime 计时 → Bridge 可选 `durationMs` → UI），以及
Composer 常驻 Mode 触发器与 Context 百分比。该轮完成标准与普通模块相同：
完整测试、打包、安装和 Cursor 可见验收。

## 后续模块进入规则

Module 2 当前按用户要求保持暂停。只有用户确认本轮 Module 1 体验、完整验证
和 Cursor 可见检查后才开始 Module 2。每个后续模块开始前，只补充该模块需要的
原型状态、Droid 能力证据、非目标和验收标准，不提前扩写所有内部接口。

如果实现过程中发现某项能力没有稳定公开来源，应缩小当前模块范围并在状态
文档中记录，不得使用硬编码、私有协议猜测或样例数据绕过。
