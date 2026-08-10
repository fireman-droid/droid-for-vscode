# DroidVisX 产品交付计划

> 本文档回答“接下来做什么、按什么顺序做、怎样才算完成”。
>
> 当前状态以 [`implementation-status.md`](./implementation-status.md) 为准。
> 本计划不恢复已经废弃的旧 UI 规格或旧概念图。
>
> 最后更新：2026-08-10

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
4. 交给 BYOK Terra `backend-writer` 实现 Runtime、Host、Bridge 和测试。
5. 主 Agent 检查并冻结共享 Bridge Contract。
6. 交给 BYOK Terra `frontend-writer` 实现 Webview、样式和测试。
7. 主 Agent 集成、验证、打包和汇报。

原型只定义视觉和交互，不得凭空定义 Droid Runtime 能力。

### 3. 前后端角色边界

默认文件所有权：

```text
backend-writer
├─ src/runtime/**
├─ src/extension/**
└─ src/shared/**

frontend-writer
└─ src/webview/**
```

两个角色都使用 `custom:gpt-5.6-terra`。

- Backend 负责定义和验证严格 Bridge Contract。
- Frontend 只消费已经冻结的 Contract，不增加假字段或前端专用后门。
- Contract 未冻结时默认先 Backend、后 Frontend。
- Contract 已冻结且文件完全不重叠时，才允许两个角色并行。
- 两个角色不得同时编辑同一文件。
- `package.json` 等跨层文件由主 Agent 明确分配单一所有者。

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
| 1 | Session Settings 与 Context | 查看并安全修改 Session 设置，查看 Context 使用量 | **下一模块** |
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

### 已确认的 Droid 能力

当前安装的 `@factory/droid-sdk` Node Session 提供：

- `session.settings`：实时只读 Session 设置。
- `session.updateSettings(...)`：更新 Session 设置。
- `session.getContextStats()`：读取 Context 使用量。

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

实施时必须先确认当前生产路径中稳定、公开的模型目录来源：

- 如果存在可信来源，UI 可以提供 Model 选择并通过
  `updateSettings()` 写回。
- 如果不存在可信来源，UI 只显示当前 `modelId`，Model 编辑保持禁用，
  并在状态文档中明确记录限制。

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
- 不把原始 SDK 对象或错误消息直接暴露给 Webview。

#### Extension Host

- 在 Runtime 初始化、Session 切换和 Runtime Retry 后加载状态。
- 为读取和更新操作绑定 Workspace、Session 和 Runtime Generation。
- 拒绝旧 Session 或旧 Runtime 的迟到结果。
- 更新期间提供明确状态，并在失败后恢复最后一次确认值。
- 设置更新成功后重新读取权威 Session 状态，不依赖乐观值作为最终值。

#### Bridge

- 增加严格、有界、版本化的 Settings/Context DTO。
- Webview 到 Host 只允许白名单字段和合法枚举值。
- Host 到 Webview 不发送 SDK 对象、未知字段或原始异常。
- 为额外字段、Getter、Proxy、超长字符串和非法数值补充敌对输入测试。

#### Webview

- 在 Composer 附近显示紧凑状态摘要。
- Settings 和 Context 使用可关闭的展开面板。
- 使用当前 assistant-ui、VS Code 主题变量和现有响应式样式。
- Loading、Updating、Failed、Unsupported 必须可区分。
- 更新进行中时避免重复提交。
- 窄侧边栏中不产生横向滚动。
- 不支持或无法发现选项的控件必须隐藏或禁用，而不是使用假数据。

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
- 全产品视觉重做

### 测试要求

#### 聚焦测试

- Runtime Settings 读取、更新和 Context 读取。
- Settings 更新失败和读取失败。
- Session 切换与迟到结果隔离。
- Bridge 双向合法和敌对输入。
- Webview 默认、展开、Updating、Failed 和 Unsupported 状态。
- 窄布局关键行为。

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

### 完成标准

以下条件必须全部满足：

- Runtime、Host、Bridge 和 UI 链路完整。
- 没有硬编码模型列表或伪造能力。
- 聚焦测试和完整验证通过。
- 新 VSIX 已生成并验证。
- Cursor 中完成可见验收。
- `implementation-status.md` 已更新。
- 形成一个独立 Git Commit。

## 后续模块进入规则

只有模块 1 完成后才开始模块 2。每个后续模块开始前，只补充该模块需要的
原型状态、Droid 能力证据、非目标和验收标准，不提前扩写所有内部接口。

如果实现过程中发现某项能力没有稳定公开来源，应缩小当前模块范围并在状态
文档中记录，不得使用硬编码、私有协议猜测或样例数据绕过。
