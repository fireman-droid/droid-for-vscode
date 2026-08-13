# BYOK 自定义模型配置（Add model）设计

> 状态：**已实现**（2026-08-13，Bridge v9 + Host daemon RPC + Webview 面板；
> 探针 `artifacts/probe-custom-models-daemon.mjs`、E2E
> `artifacts/probe-custom-models-e2e.mjs`、视觉冒烟
> `artifacts/smoke-custom-models.mjs`）。
> 基于本机 `~/.factory/` 实际文件、`@factory/droid-sdk` 0.7.0 类型定义、
> `droid --help` 输出与 docs.factory.ai 官方文档四路取证；文中标注
> 文件与行号（行号会漂移，定位以符号为准）。本文对应 HANDOVER 第 3
> 节 V2 表中「Custom Models 管理」一行的具体化设计，实现时替代该行。
>
> 涉及凭据（API key），全文设计受"凭据黑盒"红线约束
> （[`architecture-overview.md`](../engineering/architecture-overview.md)
> 第 3 节不变式 6：凭据不进 Webview 内容白名单；
> `src/extension/LocalDiagnostics.ts` `scrubCredentials` 是日志侧兜底）。

---

## 1. 需求（2026-08-12 用户提出）

模型选择器里加一个 "Add model" 入口，点击打开配置界面，配置 BYOK
（bring your own key）自定义模型；用户提示"改的是 droid 的一个 json
文件"。需要：新增、查看已配置列表、编辑、删除。

## 2. 调研结论（渠道取证）

### 2.1 配置存在哪：`~/.factory/settings.json` 的 `customModels` 数组

四路证据一致：

1. **本机实测**（2026-08-12，`C:\Users\ASUS\.factory\settings.json`）：
   顶层 `customModels` 数组，每项实际观察到字段
   `model` / `id` / `index` / `baseUrl` / `apiKey` / `displayName` /
   `maxOutputTokens` / `noImageSupport` / `provider`，个别条目另有
   `extraArgs`（如 `{"service_tier": "priority"}`）。其中 `id`
   （`custom:DeepSeek-V4-Pro-0` 形态）与 `index` 是 CLI 自己维护的
   持久化字段，官方文档字段表未列出——**GUI 不得手工生成/修改它们**。
2. **官方文档**（https://docs.factory.ai/cli/byok/overview ，
   2026-08-12 抓取）：配置位置即
   `~/.factory/settings.json` → `customModels`。字段表见 §2.2。
   遗留支持：`~/.factory/config.json` 里 snake_case 的
   `custom_models` 仍被加载并合并，`settings.json` 优先；
   `${VAR}` 环境变量引用只在 settings.json / settings.local.json
   生效。
3. **CLI**（`droid --help`，2026-08-12 实测）：**没有** custom models
   子命令（子命令只有 exec / daemon / search / update / mcp /
   plugin / computer）。TUI 内配置走 `/model` 选择器（官方文档
   "Using custom models" 节）。
4. **SDK**（`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`）：
   **daemon 有完整的自定义模型管理 RPC**，见 §2.3。仓库
   `src/runtime/capabilities/capabilityContract.ts` 早已声明
   `custom-models.manage` 能力有 `daemon-sdk` stable 通道
   （`daemon-custom-models`）与 `config` 通道
   （`factory-custom-models-config`），与本次取证吻合。

### 2.2 字段 schema（官方文档字段表 + 本机实测）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | ✓ | 发给 API 的模型标识（如 `claude-sonnet-4-5-20250929`、`qwen3:4b`） |
| `displayName` | string | | 选择器显示名 |
| `baseUrl` | string | ✓（非 Bedrock） | API 端点 base URL |
| `apiKey` | string | | **可选**：keyless 端点可省略；设了就不能为空串；支持 `${VAR_NAME}` 环境变量引用 |
| `apiKeyHelper` | string | | 输出 API key 的 shell 命令；**仅 org-managed settings 生效**（用户级会被剥除，防不可信仓库执行命令） |
| `apiKeyHelperTtlMs` | number | | helper 刷新间隔，默认 5 分钟 |
| `provider` | string | ✓ | `anthropic` / `openai` / `generic-chat-completion-api`（SDK `ModelProvider` 枚举另有 `bedrock-converse` 等值，d.ts L510–526） |
| `maxOutputTokens` | number | | 最大输出 token |
| `noImageSupport` | boolean | | true = 禁用图片输入 |
| `extraArgs` | object | | 额外请求参数（temperature 等） |
| `extraHeaders` | object | | 额外 HTTP 头 |
| `bedrock` | object | | AWS Bedrock 路由（awsRegion / awsProfile / bedrockBaseUrl / requestMetadata 等） |

模型 id 生成规则（https://docs.factory.ai/droid-exec/overview ）：
`custom:<displayName 空格换连字符>-<index>`，index 为 `customModels`
数组的 0 基下标。本机实测一致（`custom:GPT-5.6-Sol-0`）。推论：
**删除数组中间条目会使后续条目 id 漂移**，settings.json 里
`sessionDefaultSettings.model`、`modelFavorites` 中的旧 id 引用会
脱钩——这是 CLI 契约固有行为，GUI 删除时须提示（§6）。

### 2.3 SDK daemon RPC（推荐的写入通道）

`@factory/droid-sdk` 0.7.0 `dist/index-D_SzTnFR.d.ts`：

- 方法枚举 `DaemonSettingsMethod`（L45101–45107）：
  `daemon.list_custom_models` / `daemon.upsert_custom_model` /
  `daemon.delete_custom_model`。
- `DaemonUpsertCustomModelRequestParamsSchema`（L66681–66711）：
  `{ model*, provider*, baseUrl?, apiKey?, displayName?,
  maxOutputTokens?, noImageSupport?, rawIndex?, expectedModel? }`。
  `rawIndex` + `expectedModel` 是编辑既有条目时的乐观并发校验
  （对应 customModels 数组下标 + 期望的 model 值）；不带 rawIndex
  即新增。**注意：RPC 不覆盖 `extraArgs` / `extraHeaders` /
  `bedrock` / `apiKeyHelper` 高级字段**（§6 边界）。
- `DaemonDeleteCustomModelRequestParamsSchema`（L66712–66721）：
  `{ rawIndex*, expectedModel* }`。
- `DaemonListCustomModelsResultSchema`（L70048–70114）：每项
  `{ rawIndex, model, displayName?, provider, baseUrl?,
  hasApiKey, apiKeyMask?, maxOutputTokens?, noImageSupport?,
  hasBedrockConfig, isValid }`——**list 天然脱敏**：只回
  `hasApiKey` / `apiKeyMask`，永不回明文 key。
- 客户端资源 `CustomModelsResource`（L106248–106252）：
  `list()` / `upsert(params)` / `delete(params)`；挂在
  `DaemonResources.customModels`（L106420），
  `ConnectedDroid extends DaemonResources`（L107691）——即仓库现有
  daemon sidecar 连接对象 `connection.droid.customModels.*` 直接可用
  （`src/extension/extension.ts` `createDaemonSidecar`，process 模式
  下也存在的懒加载共享 daemon）。

### 2.4 生效时机：不需要重启 Cursor，但当前会话目录不自动更新

- 模型目录来源：`AvailableModelConfigSchema`（d.ts L24074 注释
  "This represents both built-in models (feature-flag filtered) and
  custom BYOK models"，含 `isCustom`）只在
  **initialize_session / load_session 响应**里返回；仓库
  `src/runtime/modelCatalogCaptureTransport.ts` 正是在这两个 RPC 上
  捕获 `availableModels`。
- process 模式每次新建/恢复会话都 spawn 新 droid 子进程
  （`src/runtime/FactoryDroidRuntime.ts` `createLocalDroidSession`
  → `new ProcessTransport(...)`），新进程读取最新 settings.json。
- **结论**：改完配置后，新模型在**下一次新建会话或切换会话**时进入
  选择器；已打开会话的 catalog 不自动刷新（捕获时机已过）。GUI 可
  复用现有 `handleRefresh` → `startCatalogRefresh` 路径
  （`src/extension/ChatController.ts`）触发重载让当前会话看到新模型
  （实现时核实该路径会重建 runtime 并重新捕获 catalog）。官方文档未
  见"须重启"表述；对 TUI 的热加载行为与我们无关，GUI 行为由上述
  捕获时机决定。
- 现有选择器只显示 `isCustom === true` 的模型
  （`FactoryDroidRuntime.ts` `projectModelCatalog` 过滤，
  L1448–1463；与 HANDOVER"内置模型全目录切换不做"的用户决定一致）
  ——新增的 BYOK 模型天然会出现在选择器里，**modelCatalog 链路零
  改动**。

### 2.5 写入通道选型

| 通道 | 评估 | 判定 |
| --- | --- | --- |
| daemon RPC（`customModels.upsert/delete/list`） | 官方公开 SDK 面；list 自带脱敏；rawIndex/expectedModel 并发防护；daemon 端统一处理 legacy config.json 合并与 id/index 维护；extension 已有懒加载 daemon sidecar（archive/search 在用），process 模式也可用 | **主通道，采用** |
| Host 直写 `~/.factory/settings.json` | schema 是官方公开契约（可写），但要自担：与 CLI/TUI/daemon 的并发写、legacy config.json 合并语义、`id`/`index` 字段维护、JSON 格式破坏风险 | 备选记录，不实施；daemon sidecar 不可用时 fail-soft 提示走 CLI/手工编辑，不降级为直写 |
| CLI 子命令 | 不存在（`droid --help` 实测） | 无此渠道 |

## 3. 现状与差距

| # | 维度 | 现状（源码实证） | 目标 |
| --- | --- | --- | --- |
| 1 | 模型选择器 | `ModelPopover`（`src/webview/assistant/ComposerControls.tsx`）：搜索 + BYOK 模型列表 + reasoning 编辑；无管理入口 | 列表底部固定 "Add model…" 入口 |
| 2 | 自定义模型管理 | 无任何链路（选择既有 BYOK 模型已接通） | 列表 / 新增 / 编辑 / 删除 |
| 3 | Bridge | 无 customModels 消息 | 新增三条 W→H + 一条 H→W（§5.1） |
| 4 | Host | daemon sidecar 已有（extension.ts），但只用于 sessions 目录 | 新增 customModels 操作与状态广播 |
| 5 | Runtime | `custom-models.manage` 能力已在 capabilityContract 声明 | 零改动（走 sidecar 的 ConnectedDroid，不经 DroidRuntime 接口） |

## 4. UI 设计

### 4.1 入口

`ModelPopover` 列表底部（滚动区外）固定一行 `Add model…`（`+` 图标，
复用 `dvx-popover-row` 视觉），点击关闭 popover、打开"Custom models"
管理面板。

### 4.2 管理面板：Webview 内面板，不用 QuickInput

**推荐 Webview 面板**，理由：

- 表单字段多（7 个基础字段），QuickInput 是串行多步流、不能回看
  改错，体验差；
- 已有同类先例：MCP add server 就是 Webview 表单 →
  `mcp.server.add` W→H 消息（`src/shared/bridgeMessages.ts`
  `McpServerAddMessage`）→ Host 执行，模式完全一致；
- 保持暖色 DroidVisX 视觉与响应式布局（AGENTS.md 视觉基准）。

面板结构（复用现有 popover/panel 样式体系，`--dvx-*` token）：

1. **列表区**：daemon `list()` 投影——每行 displayName（缺省用
   model）、model、provider、baseUrl、key 掩码（`apiKeyMask`，无 key
   显示 "no key"）、`isValid === false` 加警示标记、
   `hasBedrockConfig` 加 "Bedrock" 徽标（只读提示，编辑受限见 §6）。
   行尾 Edit / Delete 按钮。
2. **表单区**（新增/编辑共用）：`model`*、`displayName`、
   `baseUrl`*、`apiKey`（`type="password"`、`autocomplete="off"`，
   占位符提示"支持 ${VAR_NAME} 环境变量引用"；编辑态占位符显示
   `apiKeyMask` 且留空 = 不改）、`provider`*（下拉三选：anthropic /
   openai / generic-chat-completion-api）、`maxOutputTokens`（数字）、
   `noImageSupport`（勾选）。Save / Cancel。
3. **Delete 确认**：内联二次确认，文案含 id 漂移警告（§2.2 推论）。
4. 保存/删除成功后列表就地更新（upsert/delete result 均返回最新
   models 列表，d.ts L70115 起），并显示提示：
   "新模型将在下一次新建或切换会话后出现在模型选择器"，附
   "Refresh session" 快捷动作（走既有 refresh 路径，§2.4）。

## 5. 分层设计

实现顺序 Bridge → Host → Webview；Runtime 零改动。

### 5.1 Bridge 契约（`src/shared/bridgeMessages.ts`）

遵循不变式：双侧 exact-keys 校验器 +敌对输入测试同一变更落地，上限
用共享常量。

```ts
// W→H
export interface CustomModelsRefreshMessage {
  readonly type: 'customModels.refresh';
  readonly sessionId: string;
}
export interface CustomModelSaveMessage {
  readonly type: 'customModels.save';
  readonly sessionId: string;
  /** 编辑既有条目时携带；新增省略。 */
  readonly rawIndex?: number;
  readonly expectedModel?: string;
  readonly model: string;                 // ≤ MAX_MODEL_ID_LENGTH
  readonly displayName?: string;          // ≤ MAX_MODEL_DISPLAY_NAME_LENGTH
  readonly baseUrl: string;               // ≤ MAX_CUSTOM_MODEL_URL_LENGTH（新常量）
  /** 明文只在本消息出现一次；编辑态省略 = 保留原 key。 */
  readonly apiKey?: string;               // ≤ MAX_CUSTOM_MODEL_KEY_LENGTH（新常量）
  readonly maxOutputTokens?: number;
  readonly noImageSupport?: boolean;
  readonly provider: 'anthropic' | 'openai' | 'generic-chat-completion-api';
}
export interface CustomModelDeleteMessage {
  readonly type: 'customModels.delete';
  readonly sessionId: string;
  readonly rawIndex: number;
  readonly expectedModel: string;
}

// H→W（脱敏投影，永不含明文 key）
export interface CustomModelsStateMessage {
  readonly type: 'customModels.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly state:
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly items: readonly CustomModelListItem[] }
    | { readonly status: 'error'; readonly message: string }
    | { readonly status: 'unavailable'; readonly message: string }; // daemon 不可用
}
export interface CustomModelListItem {
  readonly rawIndex: number;
  readonly model: string;
  readonly displayName?: string;
  readonly provider: string;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
  readonly apiKeyMask?: string;
  readonly maxOutputTokens?: number;
  readonly noImageSupport?: boolean;
  readonly hasBedrockConfig: boolean;
  readonly isValid: boolean;
}
```

`customModels.state` 不进 `host.snapshot`（面板打开时按需拉取，
避免掩码等半敏感数据常驻快照）。

### 5.2 Host（`src/extension/ChatController.ts` + extension.ts）

- ChatController 注入 daemon sidecar 的 acquire 函数（extension.ts
  已把 `daemonSidecar.provider` 给了 sessions 路径，同法注入或复用）。
- 三个 handler：`refresh` → `droid.customModels.list()` 投影广播；
  `save` → `upsert(params)`；`delete` → `delete(params)`；upsert /
  delete 用 result 里的 models 直接广播新 state。互斥沿用
  `refreshInProgress` 风格的局部 in-flight 标志，一次一个操作。
- **凭据路径**（红线核心）：
  1. `apiKey` 明文生命周期 = `customModels.save` 消息体 → upsert
     params，一次转手，Host 不留副本、不进任何 state/快照/转录。
  2. 日志：save/delete 事件只记
     `{ model, provider, hasApiKey: boolean }` 摘要，**不记消息原文**。
     现状核实：入站消息只有校验被拒时才整条进日志
     （`DroidViewProvider.ts` `host.bridge.rejected`，且 detail 经
     `sanitizeDetail` → `scrubCredentials`——其
     `ASSIGNMENT_PATTERN` 覆盖 `"apiKey":"…"` 形态、`sk-` token
     模式也覆盖，`LocalDiagnostics.ts` L448–461），双保险成立。
  3. daemon RPC 失败的原始 error 不外泄（沿用 daemonConnection.ts
     "Deliberately drop the original error" 惯例），投影为固定文案。
- 保存成功后不自动重载会话（用户可能正在对话），只广播 state +
  提示；"Refresh session" 动作复用现有 `session.refresh` 消息路径。

### 5.3 Webview（`src/webview/assistant/`）

- `ComposerControls.tsx`：ModelPopover 底部加 "Add model…" 行，
  点击发 `customModels.refresh` 并打开管理面板（面板挂在现有
  popover/panel 机制上，`openPanel` 状态加 `'customModels'`）。
- 新组件 `CustomModelsPanel`：列表 + 表单 + 删除确认（§4.2）；
  表单为本地 state，**不进 draft 持久化**（`restoreDraft` /
  `vscode.setState` 机制不得涵盖 apiKey 字段）；Cancel/关闭即弃。
- `store.ts` / `validateHostMessage.ts`：`customModels.state`
  reducer 分支 + 校验器（items 数组长度 ≤ `MAX_MODEL_CATALOG_ITEMS`
  复用，字符串上限对齐 §5.1 常量）。

## 6. 边界与失败路径

| 项 | 处理 |
| --- | --- |
| daemon sidecar 不可用（未登录 / 连接失败） | `customModels.state = unavailable`，面板显示固定文案引导"在 droid CLI 中登录后重试，或直接编辑 ~/.factory/settings.json"；**不降级为 Host 直写文件** |
| 高级字段（`extraArgs` / `extraHeaders` / `bedrock` / `apiKeyHelper`） | upsert RPC 不支持（§2.3），表单不提供；列表对 `hasBedrockConfig` 条目显示徽标并在编辑时提示"Bedrock/高级字段请在 settings.json 中维护"。编辑此类条目基础字段是否会丢高级字段——**需实现时探针实证**，实证前对 `hasBedrockConfig` 条目禁用 Edit（fail closed） |
| 编辑态省略 `apiKey` 的语义（保留 or 清除） | SDK 类型未声明；**需探针实证**，实证前编辑表单 key 留空按"保留"文案展示、以实证结果为准 |
| 删除导致 id 漂移 | CLI 契约固有（§2.2）；删除确认文案明示"删除后其后模型的 custom: 编号会变化，收藏与默认模型引用可能失效" |
| 并发修改（TUI/CLI 同时改） | upsert/delete 的 `expectedModel` 校验失败 → daemon 报错 → 投影为"配置已被外部修改，请刷新后重试"，面板自动 refresh |
| `${VAR}` 环境变量引用 | 表单原样透传（不展开、不校验存在性），占位符提示语法；掩码回显时 `${…}` 形态由 daemon 决定 |
| legacy `config.json` 里的 snake_case 模型 | 走 daemon list 是否可见——**需探针实证**；不可见则如实不显示（文档注明只管理 settings.json 条目） |
| 当前会话选择器不含新模型 | §2.4 生效时机提示 + "Refresh session" 动作；不发明"运行中会话热更新 catalog"能力 |
| 凭据黑盒 | §5.2；另外 `customModels.state` 的 `apiKeyMask` 是 daemon 已脱敏值，允许进 Webview（等同 TUI 的显示面），但不进日志 attributes、不进快照 |

## 7. 可观察验收标准

全部在真实 Cursor 安装 VSIX（Reload Window）后验证：

1. 模型选择器底部出现 "Add model…"，点击打开管理面板，列出本机
   settings.json 已有的自定义模型（displayName、掩码 key、provider
   与文件内容一致）。
2. 新增一个模型（如 Ollama `http://localhost:11434/v1` 占位配置）→
   保存成功、列表即时出现；`~/.factory/settings.json` 里新增条目
   （key 原文正确、`id`/`index` 由 daemon 维护）；新建会话后模型
   选择器出现该模型，选中可正常对话（配置真实端点时）。
3. 编辑该模型 displayName（key 留空）→ 文件更新且 key 未变。
4. 删除该模型 → 确认提示含 id 漂移警告 → 文件条目移除。
5. **凭据审计**：完成上述操作后，
   `droidvisx-YYYYMMDD.jsonl` 全文 grep key 原文零命中；
   `host.snapshot` / 转录消息不含 key 与掩码。
6. daemon 不可用时（登出/断网停 daemon）面板显示 unavailable 文案，
   无崩溃、无直写文件行为。
7. 门禁：`pnpm run typecheck`、`pnpm run test`（含 Bridge 双向敌对
   输入测试）、`pnpm run build` 全绿。

## 8. 切片与排期建议

- **切片 A（Bridge + Host）**：§5.1 契约 + §5.2 daemon 接线 +
  聚焦测试；完成标准 = 测试内模拟 sidecar 走通 list/upsert/delete
  投影与脱敏断言。
- **切片 B（Webview 面板 + 入口 + 打包验收）**：§4/§5.3 + §7 验收。
- 排期建议：**发版后 backlog 前列**——用户价值高（目前只能手改
  JSON）、Runtime 零改动、daemon sidecar 基建现成；不阻塞 V1 主线
  （HANDOVER 第 3 节 #4–#8）。最终排期位置待用户拍板。
