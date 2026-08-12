# Plugins / Marketplaces / Hooks / Automations 能力取证与设计

> 状态：**设计文档（未实现）**。2026-08-12 完成能力取证与 GUI 形态设计。
> 用户已拍板该项排 **V2 最后**，本文档只出设计不实现，落地时间由用户
> 另行排期。
>
> **依据边界**：全部结论建立在四类可核验证据上——(a) 本机 droid CLI
> 帮助输出与 `~/.factory/` 实际文件；(b) `@factory/droid-sdk` npm 包
> 随包类型声明与官方 SDK 参考文档；(c) docs.factory.ai 官方文档
> （hooks-guide、plugins、web/automations 三章，2026-08-12 抓取）；
> (d) 本仓库只读探针 `artifacts/probe-plugins-daemon.mjs` 对本机
> 私有 daemon 的实测（输出 `probe-plugins-daemon.out.json`）。
> 查不到官方通道的能力一律判 fail-closed，不发明。
>
> 行号会漂移，定位以符号名为准。

---

## 1. 一句话结论

四个子域**不是四个平行功能**，官方产品面差异极大：

| 子域 | 官方通道 | 判定 | 一期动作 |
| --- | --- | --- | --- |
| Plugins | daemon RPC 全套（stable）+ CLI 命令族 | **可做**（读已实证；写有官方 RPC） | 只读列表 |
| Marketplaces | daemon RPC 全套（stable）+ CLI 命令族 | **可做**（读已实证；写有官方 RPC） | 只读列表（本机空态） |
| Hooks | **无管理 RPC**；配置文件契约公开；执行事件在会话流中 | **只读可做，写 fail-closed** | 不进一期 |
| Automations | daemon RPC 全套（stable），但 list **无条件依赖 Factory 后端** | **只读可做（受限）**，本机实测不可达 | 不进一期 |

一期切片 = 现有 Composer 设置弹层（Skills/MCP 同款面板家族）加一个
**Plugins 只读分区**，数据走已有 daemon sidecar，一天内可交付（§6）。

---

## 2. 子域能力档案

### 2.1 Plugins —— 可做

**是什么**：插件是 skills / slash commands / droids / hooks / MCP servers
的可分发打包（官方 plugins 文档「What plugins contain」表）。本机实证：
`~/.factory/plugins/cache/factory-plugins/core/<hash>/` 内是
`.factory-plugin/plugin.json` 清单 + `skills/*/SKILL.md`，即已装的
`core@factory-plugins` 插件本体。

**CLI 面**（`droid plugin --help`，本机 2026-08-12 输出）：

```text
Commands:
  marketplace                          Manage plugin marketplaces
  install|i [options] <plugin>         Install a plugin   (--scope user|project)
  uninstall|remove [options] <plugin>  Uninstall a plugin
  update [options] [plugin]            Update plugins
  list [options]                       List installed plugins
```

`droid plugin list` 本机输出：`core@factory-plugins  [user]  e3ff29f`。

**配置落点**（本机核实）：

| 文件 | 内容 | 性质 |
| --- | --- | --- |
| `~/.factory/plugins/installed_plugins.json` | 已装插件的 scope/installPath/version/source | CLI 内部状态 |
| `~/.factory/plugins/known_marketplaces.json` | 已知市场源与 installLocation | CLI 内部状态（见 §2.2 的不一致证据） |
| `~/.factory/plugins/cache/<marketplace>/<plugin>/<hash>/` | 插件本体缓存 | 内容目录 |
| `~/.factory/settings.json` 的 `enabledPlugins` | `{"core@factory-plugins": true}` | 启用开关（官方文档亦用于 team 分发） |

**SDK/daemon 面**：`DaemonDroidMethod` 含
`LIST_AVAILABLE_PLUGINS / LIST_INSTALLED_PLUGINS / INSTALL_PLUGIN /
UNINSTALL_PLUGIN / SET_PLUGIN_ENABLED / UPDATE_PLUGIN` 六个方法；SDK
门面 `PluginsResource`（stable，`droid.plugins.*`）：

```ts
interface PluginsResource {
  listAvailable(sessionId): Promise<...['plugins']>;
  listInstalled(sessionId, scope?): Promise<...['plugins']>;
  install(sessionId, marketplace, pluginName, scope): Promise<...>;
  uninstall(sessionId, pluginId, scope): Promise<...>;
  setEnabled(sessionId, pluginId, scope, enabled): Promise<...>;
  update(sessionId, pluginId?, scope?): Promise<...>;
}
```

官方 SDK 参考文档把 `plugins` 列在 **Stable daemon resources** 表中。
会话通道（`DroidServerMethod`，我们 process 模式的 35 个方法）**没有**
任何 plugin 方法——插件面是 daemon 独占。

**探针实证**（`probe-plugins-daemon.mjs`，私有 daemon + 本机凭据）：

- `plugins.listInstalled(<未 open 的磁盘会话 id>)` **成功**，返回
  `{id:"core@factory-plugins", scope:"user", version:"e3ff29f752fb",
  installPath, source, active:true, managed:false, reason:"enabled"}`；
- `plugins.listAvailable(同 id)` 成功返回 `[]`（无注册市场时的空态）；
- 对照组：`skills.list` / `commands.list` 拿同一个未 open 的会话 id
  **失败**（`No active session found for ID`）。

**关键推论**：plugins/marketplaces RPC 的 `sessionId` 参数不要求会话
在该 daemon 连接上活跃——**现有只读 daemon sidecar（process 模式下
也存在）即可独立供给 Plugins 面板**，不依赖 daemon 运行模式。

### 2.2 Marketplaces —— 可做

**是什么**：插件目录源（GitHub 仓库 / 任意 Git URL / 本地路径），仓库
根放 `.factory-plugin/marketplace.json`。官方市场
`Factory-AI/factory-plugins`（plugins 文档「Discover plugins」）。

**CLI 面**（`droid plugin marketplace --help`）：`add <url>` /
`remove <name>` / `list` / `update [name]`。

**SDK/daemon 面**：`MarketplacesResource`（stable）：
`list(sessionId)` / `add(sessionId, source)` / `remove(sessionId, name)` /
`update(sessionId, name?)`。

**探针实证**：`marketplaces.list` 成功返回 `[]`。

**不一致证据（为什么 GUI 必须只走 RPC、不读内部文件）**：本机
`known_marketplaces.json` 记录着 factory-plugins 市场（installLocation
指向 `~/.factory/plugins/marketplaces/factory-plugins`），但该目录
**不存在**，且 CLI `droid plugin marketplace list` 与 daemon
`marketplaces.list` 都报空。即：`~/.factory/plugins/*.json` 是 CLI
内部状态而非权威契约，直接读文件会把这类陈旧记录当成事实。

### 2.3 Hooks —— 只读可做，写 fail-closed

**是什么**：在 Droid 生命周期事件点执行的确定性 shell 命令（官方
hooks-guide）。九个事件：`PreToolUse / PostToolUse / Notification /
UserPromptSubmit / Stop / SubagentStop / PreCompact / SessionStart /
SessionEnd`（SDK `DroidHookEventSchema` 与官方文档一致）。

**配置落点**（官方文档「Configuration」表，本机核实两处均不存在，
即本机当前无自定义 hooks）：

| Scope | 文件 |
| --- | --- |
| User | `~/.factory/hooks.json` |
| Project | `.factory/hooks.json` |
| Enterprise | 组织托管设置 |
| Plugin | 插件根 `hooks/hooks.json`（随插件启用合并） |

**SDK 面（决定性证据）**：官方 SDK 参考文档原话——
「The SDK exposes hook schemas and types, but **does not provide a
programmatic hook-registration API**」。`DaemonDroidMethod` 全集
（90 项，已全文核对）**没有任何 hook 管理方法**。CLI 有 `/hooks`
TUI 管理器（User/Project/Plugins/Effective 四 tab，后两个只读），但
那是 CLI 内部 UI，不是协议。

**可读的面**（两条，都有公开契约）：

1. **配置只读**：`hooks.json` 的结构是官方文档化的公开格式（事件 →
   matcher 组 → command/timeout）。读 user/project 两级文件 + 已装
   插件的 `hooks/hooks.json` 可以拼出「近似 Effective」视图；
2. **执行事件流**：hook 执行进会话流——SDK 导出
   `HookExecutionStartedNotification` / `HookExecutionCompletedNotification`
   与 `DroidMessageType.Hook`（status/eventName/command/exitCode/stdout），
   随包示例 `examples/node/hook-execution.ts` 演示完整流程。本仓库
   `normalizeSdkEvent.ts` 目前**不消费** hook 消息（已核实无 hook
   分支），转录里的 hook 执行行是一个独立候选切片。

**写为什么 fail-closed**：无管理 RPC；hooks 是以本机凭据跑任意 shell
命令的安全敏感面（官方文档有整节 Security considerations，且明确
「Droid snapshots hooks at startup and warns when hooks are modified
externally」——GUI 绕过 CLI 直接写文件恰好就是那个 external
modification）。判定：**写入不做**，直到官方提供管理 RPC。

### 2.4 Automations —— 只读可做（受限），本机实测后端不可达

**是什么**：Factory 产品级的「定时 / Slack / GitHub 事件触发的 Droid
工作流」（docs.factory.ai/web/automations），属 Software Factory 体系，
带模板（Code Review / QA / AutoWiki / Security Audit / Triage /
Incident Response）、run target、私有/共享可见性、运行历史。本地形态
是目录 + `HEARTBEAT.md` frontmatter（`DaemonListAutomationsResultSchema`
字段注释：uuid「used for backend/Firestore sync」、templateId「parsed
from HEARTBEAT.md frontmatter」）。本机无任何 automation
（`~/.factory/` 下无 automations 目录）。

**SDK/daemon 面**：`AutomationsResource`（stable）16 个方法——
`list / run / pause / resume / getHistory / getVisual / create /
updateModel / updatePrivacy / updatePrompt / updateSchedule / update /
rename / delete / fork / applyConfig`。

**探针实证（决定一期不做的直接证据）**：`automations.list()` 与
`automations.list(basePath)` 都失败：`RPC Error: Network error`
（daemon 侧 list 无条件做后端合并；本机 BYOK 环境 Factory 后端不可达
或账户无此面）。即：即使 GUI 全部接好，本机什么也列不出来。

**近亲：Crons（会话级定时 prompt，`droid.unstable.crons`）**——与
automations 是两套东西。本机 `~/.factory/crons/<项目>/<会话>/` 有一条
真实 cancelled 记录（cron 表达式、`kind:"session_prompt"`、
`runPolicy.whenSessionInactive:"hold"`、payload 为完整 prompt）。探针
实证：`crons.list()` 返回 `[]`（默认滤掉非活跃），
`crons.list({includeInactive:true})` **本地即时返回该记录，无网络
依赖**。但官方把 crons 归 **unstable**（「APIs under `droid.unstable`
may change between SDK releases」＋「Keep unstable API use behind an
application-owned adapter」），写操作（create/update/delete）判不做，
只读展示列为可选后续切片。

---

## 3. 仓库复用面

### 3.1 面板家族（直接扩展，不发明新 UI）

Composer 设置弹层（`src/webview/assistant/ComposerControls.tsx`）：

- `type SettingsView = 'root' | 'mode' | 'autonomy' | 'skills' | 'mcp'`，
  root 菜单行（图标 + 名称 + 计数摘要如 `3/5`）→ 子视图，带搜索框
  （placeholder「Search actions, skills, MCP…」）、返回键、
  `dvx-skills-panel` 系列样式；
- 状态机四态复用：`SessionSkillsState` / `SessionMcpState`
  （`loading / ready / error / unsupported`，`src/shared/bridgeMessages.ts`）；
- 懒加载模式复用：视图打开且 `status === 'idle'` 时发一次 refresh。

### 3.2 数据通道（已在生产）

`src/extension/extension.ts` 的 daemon sidecar 在 **process 与 daemon
两种运行模式下都存在**（process 模式 = Phase 1 私有 daemon，懒启动），
`daemonSidecar.droid()` 返回 `ConnectedDroid`，其上就有
`plugins / marketplaces / automations / unstable.crons` 资源。
ChatController 已持有 sidecar provider（归档/搜索在用）。凭据链路
（`readFactoryAccessCredential` + `connectToDaemon`）不变，token
不落盘不进 Bridge。

### 3.3 Bridge 消息模式（对称复制 skills 的）

`skills.refresh` → `session.skills` 的请求/状态对
（ChatController.handleSkillsRefresh + `emitSkills`）与双向校验
（`validateHostMessage.ts` 白名单）是现成模板。

---

## 4. GUI 形态提案

遵守 AGENTS.md UI restraint / Visual bar：不加新的重型 UI，不加
banner/badge/彩条；全部落在现有设置弹层的安静视觉语言里。

### 4.1 一期形态（随第一切片交付）

设置弹层 root 菜单新增一行 **Plugins**（与 Skills / MCP 同款行样式，
计数摘要 `N enabled`），进入只读子视图：

- 每个已装插件一行：名称（`core@factory-plugins`）、scope 徽记复用
  skills 面板的 location 小字样式（`user` / `project`）、版本短
  hash、`active` 状态用现有 enabled 视觉（不新造样式）；
- 列表下方一行小字：市场数（`marketplaces.list` 结果，本机为
  `No marketplaces registered.`）；
- 空态 / 加载态 / 错误态文案复用 skills 面板措辞习惯（error 显式
  展示 daemon 不可用原因，不静默）。

### 4.2 后续形态（本文档只定方向，不进一期）

| 能力 | 通道 | 备注 |
| --- | --- | --- |
| Plugin enable/disable | `plugins.setEnabled`（stable RPC） | 面板内开关，语义同 skills toggle；需先实机验证写路径 |
| Plugin install/uninstall/update | 对应 stable RPC | 破坏性操作要确认卡；install 需市场浏览（listAvailable） |
| Marketplace add/remove | 对应 stable RPC | add 输入 URL，风格对齐 MCP add server 表单 |
| Hooks 只读视图 | 读 user/project `hooks.json` + 插件 hooks 目录 | 「近似 Effective」列表；文件读取在 Host 侧 |
| 转录 hook 执行行 | 会话流 `DroidMessageType.Hook` | normalizeSdkEvent 新增分支，activity 行家族 |
| Crons 只读列表 | `unstable.crons.list({includeInactive:true})` | unstable：Runtime 侧要加自有适配层 |
| Automations | stable RPC 全套 | 等有 Factory 后端可达的实机环境再验证；本机 Network error |

---

## 5. 明确「不做」清单

| 项 | 原因 |
| --- | --- |
| GUI 写 `hooks.json`（任何 scope）/ hook 增删改 | 无管理 RPC（SDK 文档明示）；安全敏感（任意 shell + 本机凭据）；CLI 有启动快照与外部修改警告机制，绕过它写文件制造不一致。**只读** |
| 直接读写 `~/.factory/plugins/*.json`、`settings.json` 的 `enabledPlugins`、`known_marketplaces.json` | 有官方 RPC 就不碰内部文件；本机已实证 known_marketplaces.json 与 RPC/CLI 状态不一致（§2.2），文件不是权威 |
| Automations 的 create/run/pause/delete 等全部写操作 | RPC 存在但本机连 list 都因后端不可达失败，写路径完全未实证；等实机验证 |
| Crons 的 create/update/delete | unstable 命名空间 + 写操作，双重理由 |
| 自造插件市场浏览器 / 插件详情页等重型 UI | UI restraint；一期只做设置弹层分区 |
| 模拟 TUI `/plugins`、`/hooks` 管理器交互 | 那是 CLI 内部 UI，不是协议 |

---

## 6. 第一切片：Plugins 只读分区

**目标（可观察完成判据）**：打开 Composer 设置弹层 → Plugins 分区，
看到真实的 `core@factory-plugins`（scope=user、版本短 hash、active）；
断开/杀掉 daemon 后刷新，看到显式 error 态而非空转。

**数据流**：Webview `plugins.refresh` → Host（ChatController）→
`daemonSidecar.droid()` → `plugins.listInstalled(activeSessionId)` +
`marketplaces.list(activeSessionId)`（探针已证未 open 的会话 id 可用，
活跃会话 id 必然可用）→ 投影为有界 summary → `session.plugins` 状态
消息 → store → 面板。

**分层改动面预估**：

| 层 | 文件 | 改动 |
| --- | --- | --- |
| Bridge | `src/shared/bridgeMessages.ts` | `PluginSummary`、四态 `SessionPluginsState`、`plugins.refresh` / `session.plugins` 消息（对称加入两侧联合类型） |
| Bridge 校验 | `src/webview/bridge/validateHostMessage.ts`（+test） | `session.plugins` 白名单分支，上限沿用现有共享常量模式 |
| Host | `src/extension/ChatController.ts`（+test） | `handlePluginsRefresh`：sidecar 调用、双 RPC 并发、投影与脱敏（不透传 installPath 之外的本机绝对路径到 UI 正文，仅保留展示所需字段）、错误分类复用 `DaemonAvailabilityError` 语义，约 100 行 |
| Webview | `ComposerControls.tsx`（+test）、`store.ts`、`App.tsx` | `SettingsView` 加 `'plugins'`、root 菜单行、子视图（复用 `dvx-skills-panel` 结构与样式类）、store 状态与 handler，约 150 行 |
| 样式 | `styles.css` | 预期零到极少新增（复用 skills 面板类） |

**不进本切片**：一切写操作；hooks / automations / crons 的任何 UI；
`plugins.listAvailable`（无市场时恒空，留给市场管理切片）。

**验证**：controller 单测（成功投影 / sidecar 失败 / 无活跃会话）、
composer 面板单测（四态渲染）、validateHostMessage 对称测试；实机
按完成判据目验。

---

## 7. 待实机验证与已知边界

| # | 事项 | 影响 |
| --- | --- | --- |
| 1 | `plugins.setEnabled` 写路径的行为（是否即刻生效、是否需要新会话——skills 面板已有「apply at new session」先例） | 决定二期 toggle 的文案与时序 |
| 2 | Automations 在有 Factory 后端可达的账户上的真实返回 | 决定 automations 只读切片是否可排 |
| 3 | 插件提供的 skills 在 `skills.list` 里的 location 标注（SDK `SkillLocation` 枚举只有 project/personal/builtin/automation，无 plugin 值） | 决定 Plugins 分区与 Skills 分区如何交叉引用 |
| 4 | `plugins.install` 对 scope=project 的会话 cwd 解析（sessionId 语义） | 决定 install UI 是否要显式选 scope |
| 5 | daemon 运行模式（Phase 2/3）下同一面板的行为一致性 | 预期一致（同一 RPC 面），需目验一次 |

---

## 附：证据文件清单

- CLI：`droid --help`、`droid plugin --help`、`droid plugin marketplace --help`、
  `droid plugin list`、`droid plugin marketplace list`（2026-08-12 本机输出）
- 配置：`~/.factory/plugins/{installed_plugins,known_marketplaces,sync_stamp}.json`、
  `~/.factory/plugins/cache/factory-plugins/core/*/`、`~/.factory/settings.json`
  （`enabledPlugins` 键）、`~/.factory/crons/<项目>/<会话>/e6032968.json`
- SDK：`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`
  （`DaemonDroidMethod`、`PluginsResource`、`MarketplacesResource`、
  `AutomationsResource`、`CronsResource`、`DroidHookEventSchema`、
  `DaemonListAutomationsResultSchema`）、`docs/typescript-sdk-reference.md`
  （Stable/Unstable daemon resources 表、Hooks 节）、
  `examples/node/hook-execution.ts`
- 官方文档：docs.factory.ai `cli/configuration/hooks-guide`、
  `cli/configuration/plugins`、`web/automations`（2026-08-12 抓取）
- 探针：`artifacts/probe-plugins-daemon.mjs` → `probe-plugins-daemon.out.json`
