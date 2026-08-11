# `/` 动态命令（Droid Custom Commands）设计

> 第二档第一切片的实现设计。阶段一（本文档）只做只读调研与设计；
> 阶段二按本设计实现。
>
> 调研日期：2026-08-11。调研对象：`node_modules/@factory/droid-sdk`
> （protocol 1.155.0）、本机 `droid.exe`、Factory 官方文档
> `docs.factory.ai/cli/configuration/custom-slash-commands`、
> 本仓库现有 `@` 提及 / Skills / MCP 实现。

## 1. SDK 与 CLI 能力证据

### 1.1 列表：`droid.list_commands`（已实机验证）

- `DroidServerMethod.LIST_COMMANDS = "droid.list_commands"`
  （`dist/index-D_SzTnFR.d.ts` L81）。
- 低层 `DroidClient.listCommands(): Promise<z.infer<typeof
  ListCommandsResponseSchema>>`（`dist/node.d.ts` L318）。要求已有
  active session（`initializeSession` 或 `loadSession` 之后）。
- `ListCommandsResponseSchema.result.commands[]` 元素结构
  （`dist/index-D_SzTnFR.d.ts` L43818–43834）：

  | 字段           | 类型                  | 说明                                   |
  | -------------- | --------------------- | -------------------------------------- |
  | `name`         | `string`              | 命令 slug（文件名 slug 化）            |
  | `description`  | `string`              | frontmatter `description` 或生成的摘要 |
  | `argumentHint` | `string \| undefined` | frontmatter `argument-hint`            |
  | `isExecutable` | `boolean \| undefined`| shebang 脚本命令为 `true`              |

- **高层 `DroidSession` 没有 `listCommands`**（`dist/node.d.ts`
  L635–689 全量方法核对；`dist/node.js` L3614 起的 DroidSession 类只
  委托了 `listSkills` 等，没有 commands）。这是本切片唯一的结构性
  难点，见 §4。
- 实机探测（`artifacts/probe-list-commands.mjs`，ProcessTransport +
  DroidClient + `loadSession` 本仓库已有 session）：
  - 无 `.factory/commands` 目录时返回 `result.commands: []`——
    **内置命令（/compact、/model、/settings…）不会出现在该 RPC 里**，
    它是纯自定义命令目录。daemon 侧同名接口的注释也写明
    “Custom command discovery operations”（`index-D_SzTnFR.d.ts`
    L106299–106302）。
  - 在工作区临时放置 `.factory/commands/dvx-probe.md`（frontmatter 带
    `description` 与 `argument-hint`）后，返回
    `{ name: "dvx-probe", description: "Temporary DroidVisX probe
    command", argumentHint: "<target-file>", isExecutable: false }`。
    探测后已删除该临时文件与目录。

### 1.2 执行：没有专用 RPC，走消息文本路径

- `DroidServerMethod` 全量枚举中**不存在** `execute_command` 类方法；
  SDK dist 中也没有 `$ARGUMENTS` 展开逻辑（全文无匹配）。
- 本机 `droid.exe` 反汇编字符串证据：
  - 存在 slash command registry：`execute(H,$)` 从**消息文本**提取
    前导 `/` 与 slug（`vl0`/`NK$` 函数），未命中时返回
    `{handled:false, shouldRunAgent:true}` 继续当普通消息；命中时读取
    `filePath` 文件、展开 `body.replaceAll("$ARGUMENTS", args)`，返回
    `messageText` 交给 agent；带遥测计数
    `droid.slash_command.invocations`。
  - `isExecutable` 命令受 `allowExecutable` 开关保护：
    `"Executable custom commands are not allowed in this context."`；
    Task prompt 解析路径固定 `allowExecutable:false`。
- Factory 文档确认：`/command-name optional arguments` 在聊天中调用；
  Markdown 命令的 body（含 `$ARGUMENTS` 展开）作为 prompt 发送。
- **结论（待阶段二第 1 步实机确认）**：GUI 侧执行自定义命令 =
  把 `/name args` 作为普通 turn 文本经现有 `turn.send` →
  `runtime.sendTurn` → `session.stream()` 发送，由 CLI 后端识别并
  展开。不需要新的“执行” RPC。阶段二开工先用一个临时
  `.factory/commands` 命令发一个真实 turn 验证 stream-jsonrpc 后端
  确实展开（观察回复内容与会话历史里的用户消息形态）；若后端不
  展开，回退方案见 §8.1。

### 1.3 自定义命令的来源（Factory 文档）

- 工作区 `<repo>/.factory/commands`（覆盖同名个人命令）+ 个人
  `~/.factory/commands`。
- 仅注册 `*.md` 与带 shebang 的文件；文件名 slug 化；Markdown 命令用
  `$ARGUMENTS`（不支持 `$1`/`$2`）。
- `/commands` 管理器（重载/导入）是 CLI TUI 功能，本切片不做。

## 2. 范围决策

- **只暴露 `droid.list_commands` 返回的自定义命令。** 不手工维护内置
  命令清单：内置命令不经该 RPC 枚举，且 GUI 已有等价物（见下表），
  伪造清单违反“不发明未验证能力”的项目规则。

  | CLI 内置命令        | GUI 既有等价物                             |
  | ------------------- | ------------------------------------------ |
  | `/compact`          | Context 浮层 “Compact conversation”        |
  | `/model`、reasoning | Model / Reasoning 选择器                   |
  | `/settings`（mode/autonomy） | Composer Mode 触发器、`+` 面板    |
  | `/mcp`              | `+` 面板 MCP servers 视图                  |
  | `/skills`           | `+` 面板 Skills 视图                       |
  | `/sessions`         | History 抽屉                               |
  | `/rename`（等价操作）| 会话抽屉内联 Rename                       |
  | `/commands` 管理器  | 不做（列表本身即浏览；管理属后续切片）     |

- **`isExecutable: true` 的脚本命令本切片不进弹窗**（数据仍会进
  Bridge，见 §3.2）。CLI 自己都用 `allowExecutable` 门控它们；GUI
  触发本地脚本执行需要独立的权限故事，留给后续切片。
- **最近使用**：随本切片一起做（第二档条目明确“含最近使用”），
  Host 侧 `workspaceState` 持久化，见 §5.3。
- `@` Symbol 引用、命令管理（新建/重载/导入）不在本切片。

## 3. Bridge 契约新增

模式完全对齐 `skills.refresh` / `session.skills`
（`src/shared/bridgeMessages.ts` L334–346、L868–873）。

### 3.1 常量

```ts
export const MAX_COMMAND_ITEMS = 200;
export const MAX_COMMAND_NAME_LENGTH = 64;
export const MAX_COMMAND_DESCRIPTION_LENGTH = 512; // 与 skills 一致
export const MAX_COMMAND_ARGUMENT_HINT_LENGTH = 128;
export const MAX_RECENT_COMMANDS = 8;
```

### 3.2 Webview → Host：`commands.refresh`

```ts
/** Requests the custom Droid command catalog for the session. */
export interface CommandsRefreshMessage {
  readonly type: 'commands.refresh';
  readonly sessionId: string;
}
```

校验（`src/shared/validateMessage.ts`，仿 `parseSkillsRefresh`）：
`hasExactKeys(['type','sessionId'])` + `isId(sessionId)`。

不新增“执行”消息：执行复用 `turn.send`（§1.2），文本长度已受
`MAX_TURN_TEXT_LENGTH` 约束，无新校验面。

### 3.3 Host → Webview：`session.commands`

```ts
export interface CommandSummary {
  readonly name: string;               // 1..64，无空白/控制字符/'@'/'/'
  readonly description: string | null; // ≤512
  readonly argumentHint: string | null;// ≤128
  readonly isExecutable: boolean;      // SDK 缺省视为 false
}

export type SessionCommandsState =
  | { readonly status: 'loading'; readonly items: readonly CommandSummary[];
      readonly recent: readonly string[] }
  | { readonly status: 'ready'; readonly items: readonly CommandSummary[];
      readonly recent: readonly string[] }
  | { readonly status: 'error'; readonly items: readonly CommandSummary[];
      readonly recent: readonly string[]; readonly message: string }
  | { readonly status: 'unsupported'; readonly items: readonly [];
      readonly recent: readonly []; readonly message: string };

export interface SessionCommandsStateMessage {
  readonly type: 'session.commands';
  readonly sequence: number;
  readonly sessionId: string;
  readonly commands: SessionCommandsState;
}
```

- `recent` 为最近使用的命令 slug（≤`MAX_RECENT_COMMANDS`，可指向
  已不存在的命令，webview 渲染时按当前 `items` 过滤）。
- Webview 侧校验（`src/webview/bridge/validateHostMessage.ts`，仿
  `parseSessionSkillsMessage` / `parseSessionSkills`）：
  - 外层 `hasExactKeys(['type','sequence','sessionId','commands'])`；
  - 四个 status 分支各自 `hasExactKeys`；`items` 用
    `isExactArray(0, MAX_COMMAND_ITEMS)`，逐项校验字段类型与长度上限、
    `name` 满足 `/^[^\s@/\u0000-\u001f\u007f]+$/`、去重（重名整条消息
    拒收，与 attachments 的 id 去重一致）；
  - `recent` 用 `isExactArray(0, MAX_RECENT_COMMANDS)` + 同一 name
    规则 + 去重；`message` 有界。
- 与 skills 的语义一致：`loading`/`error` 保留旧 `items` 供 UI 继续
  展示；`unsupported` 表示 runtime 无该能力。

## 4. Runtime 新增

### 4.1 接口（`src/runtime/DroidRuntime.ts`）

```ts
export const MAX_RUNTIME_COMMAND_ITEMS = 200;
export const MAX_RUNTIME_COMMAND_NAME_LENGTH = 64;
export const MAX_RUNTIME_COMMAND_DESCRIPTION_LENGTH = 512;
export const MAX_RUNTIME_COMMAND_ARGUMENT_HINT_LENGTH = 128;

export interface RuntimeCommand {
  readonly name: string;
  readonly description: string | null;
  readonly argumentHint: string | null;
  readonly isExecutable: boolean;
}

export interface DroidRuntime {
  // ...
  /**
   * Lists the custom slash commands visible to the active session,
   * projected to safe display fields. Optional: absent when
   * unsupported.
   */
  listCommands?(): Promise<readonly RuntimeCommand[]>;
}
```

### 4.2 实现（`FactoryDroidRuntime`）：短生命周期公开 client

高层 `DroidSession` 不暴露 `listCommands`，只有低层 `DroidClient`
有。不用私有 `session['_client']`（违反“只用公开 SDK 渠道”），也不
自己扫 `.factory/commands` 文件系统（会复刻 CLI 的 slug 化/覆盖/
shebang 判定规则，等于发明行为）。采用与
`FactorySessionHistoryLoader`（`src/runtime/history/`）完全相同的
公开渠道模式，且已被本次探测脚本实机验证：

1. `new ProcessTransport({ cwd })` → `connect()`；
2. `new DroidClient({ transport })` →
   `loadSession({ sessionId: 活跃 session id })`（只读加载，不创建
   session）；
3. `listCommands()` → 取 `response.result.commands`；
4. `client.close()`（错误路径同样 close，吞掉 close 失败）。

结构上放到新文件 `src/runtime/commands/FactoryCommandCatalog.ts`：

```ts
export interface FactoryCommandsClient {
  loadSession(params: { sessionId: string }): Promise<unknown>;
  listCommands(): Promise<unknown>;
  close(): Promise<void>;
}
export type FactoryCommandsClientFactory =
  (cwd: string) => Promise<FactoryCommandsClient>;

export async function loadSessionCommands(options: {
  cwd: string;
  sessionId: string;
  createClient?: FactoryCommandsClientFactory; // 测试注入
}): Promise<readonly RuntimeCommand[]>;
```

`FactoryDroidRuntime.listCommands()` 用 `requireSession()` 拿到
`session.id` 与 `sessionTarget.cwd` 后委托该 loader。投影函数
`projectCommand(raw)`（与 `projectSkill` 同风格）：非法记录返回
`null` 丢弃，`description`/`argumentHint` 超长截断到上限、含控制
字符则置 `null`，`isExecutable` 非 boolean 视为 `false`，列表
`slice(0, MAX_RUNTIME_COMMAND_ITEMS)`。响应不是
`{ result: { commands: unknown[] } }` 形态时抛
`'Droid returned an invalid command list.'`。

诊断：`runtime.commands.finished`（info/error，`durationMs` +
`outcome`），不记录命令名与描述（与 skills 诊断同一隐私边界）。

成本与缓解：每次刷新会短暂 spawn 一个 `droid exec` 子进程（探测实测
连接+加载+查询约 3–8 秒）。因此列表**懒加载 + Host 缓存**（§5.1），
`/` 弹窗先用缓存即时渲染。若未来 SDK 在 `DroidSession` 上补齐
`listCommands`，只需把 `FactoryDroidSession` 可选方法接上并让
`listCommands()` 优先走会话内调用，Bridge/Host/UI 不变。

## 5. Extension Host（`ChatController`）

### 5.1 `commands.refresh` 处理

`handleWebviewMessage` 新增 `case 'commands.refresh'`，处理函数
`handleCommandsRefresh(sessionId)` 完全镜像
`handleSkillsRefresh`（`ChatController.ts` L1767 起）：

- 守卫：`sessionId === this.sessionId`、runtime 非空、
  `connection.status === 'connected'`、无
  `sessionOperationInProgress`；`typeof runtime.listCommands !==
  'function'` 时发 `unsupported`；
- 发 `loading`（携带缓存的旧 `items` 与 `recent`）→
  `void runtime.listCommands().then(...)`，回调里校验
  `runtimeGeneration` / `sessionId` / `cwd` 未变后发 `ready`；
- 失败发安全 `error`（固定文案指向 DroidVisX Logs，不透传内部错误）。
- 结果写入 `private commandsCache: { sessionId, items } | null`，
  Session 切换/Fork/Compact/Rewind 收养、Runtime 重建时清空并让
  webview 回到 `loading`/空态（与 skills 状态在 session 生命周期上的
  处理保持一致）。

去抖动：一次 refresh 在途时忽略后续 refresh（skills 的既有做法沿用，
loading 状态期间 webview 也不重发）。

### 5.2 执行路径

无新处理：`turn.send` 原样把 `/name args` 交给
`runtime.sendTurn`。转录中的用户消息就显示原始 `/name args` 文本
（与 CLI 会话历史的用户输入形态一致；以阶段二探测确认为准）。

### 5.3 最近使用

- `handleTurnSend` 成功受理后，若文本以 `/` 开头、首 token（去掉
  `/`，lowercase）命中 `commandsCache.items` 中某 `name`，则把该
  name 移到 recents 头部、截断到 `MAX_RECENT_COMMANDS`，写入
  `ExtensionContext.workspaceState`（key
  `droidvisx.recentCommands`，工作区维度，与命令的工作区来源匹配），
  并广播一次 `session.commands`（ready，复用缓存 items）。
- 启动/Session 切换时从 workspaceState 读取并随首个
  `session.commands` 下发；读取时按 name 规则重新校验，非法即弃。

## 6. Webview

### 6.1 Store（`src/webview/assistant/store.ts`）

- 新增 `commands: SessionCommandsState`（初值
  `{ status: 'loading', items: [], recent: [] }`），`session.commands`
  消息按 `sessionId` 匹配后整体替换；host.snapshot 不携带 commands
  （与 skills 相同，懒加载状态不进快照），session 切换时 reducer 重置。

### 6.2 Composer `/` 触发弹窗（`Thread.tsx`）

复用 `@` mention 的实现骨架（`MentionToken` / `findMentionToken` /
`dvx-mention-popup`，Thread.tsx L851–1116），差异点：

- **Token 识别** `findCommandToken(value, caret)`：仅当 `/` 位于
  draft 首字符（`value[0] === '/'`，CLI 语义是“整条消息即命令”），
  且 caret 落在首 token 内（`/` 之后到第一个空白之前）；query 为
  `/` 与 caret 之间的文本，含空白或超过
  `MAX_COMMAND_NAME_LENGTH` 即无 token。已输入参数（caret 在空白
  之后）不再弹窗。
- **数据源是本地缓存而非逐键搜索**：打开 token 时若
  `commands.status` 尚无本 session 的 ready 数据，发一次
  `commands.refresh`（每次弹窗会话最多一次，无 150ms 防抖搜索——
  过滤在本地做）。候选 = `items` 中 `isExecutable === false` 且
  `name.toLowerCase().startsWith(query.toLowerCase())`，排序：recent
  命中者在前（按 recents 顺序），其余按名称；上限渲染 20 行。
- **行渲染**：`/name` 主标签 + `argumentHint`（淡色内联）+
  `description`（次行淡色，单行截断）。`loading` 且无缓存时显示
  单行 “Loading commands…”；`ready` 且候选为空、query 为空时显示
  单行不可交互提示 “No custom commands (.factory/commands)”；
  `error` 显示单行错误提示。`unsupported` 不弹窗。
- **键盘**：↑/↓ 循环、Enter/Tab 选中、Escape 关闭——直接沿用
  mention 的 onKeyDown 结构；与 mention 弹窗互斥（`/` token 只在行首，
  两者不会同时成立，代码里仍显式先判 command token）。
- **选中行为**：把 draft 从 token 起替换为 `/name `（保留用户已输入
  的后续文本，若 token 即整个 draft 则补一个尾随空格），光标移到
  name 之后；**不发送**。用户继续输入参数并按 Enter 走既有发送链路。
- 待处理交互（`interactionPending`）时 Composer 输入区本就不渲染，
  弹窗自然不可用；Turn 运行中允许浏览列表（只读），发送仍受既有
  “先 Stop” 约束。

### 6.3 样式（`styles.css`）

新增 `dvx-command-popup/-item/-active/-name/-hint/-desc`，几何复用
mention 弹窗（Composer 上方、同宽、内部滚动、`prefers-reduced-motion`
无动画）。**协调项：另一代理正在改 `styles.css` 与
`runtimeAdapter.ts`/`main.tsx`，阶段二动这些文件前先确认其变更已
落地，追加式改动、避免重排既有规则。**

## 7. 测试清单

Shared（双向校验）：

- `validateMessage.test.ts`：`commands.refresh` 接受合法消息；拒绝
  多余键、非法 sessionId。
- `validateHostMessage.test.ts`：`session.commands` 四种 status 的
  接受/拒绝；items 超量、name 超长/含空白或 `@` `/`、重名、
  argumentHint 超长、recent 超量/重复、unsupported 携带非空 items
  均拒收。

Runtime：

- `FactoryCommandCatalog.test.ts`：注入 fake client——正常投影；
  非法记录丢弃；超长字段截断/置 null；`isExecutable` 缺省 false；
  列表超量截断；响应形态非法抛错；错误路径与成功路径都 close。
- `FactoryDroidRuntime.test.ts`：`listCommands` 无会话时抛错；委托
  loader 传入正确 cwd/sessionId；诊断事件 outcome 分类。

Host：

- `ChatController.test.ts`：refresh 的守卫（错误 session、未连接、
  操作中）；loading→ready 序列与缓存复用；runtime 无方法时
  unsupported；失败时安全 error；session 切换清缓存；
  `turn.send` 命中命令时 recents 更新+持久化+重新广播，未命中/非
  `/` 开头不动 recents。

Webview：

- store：`session.commands` 落地、session 切换重置。
- App/Thread 组件测试：行首 `/` 弹窗且触发一次 refresh；非行首
  `/` 不弹；本地过滤与 recent 排序；键盘导航与 Enter 补全为
  `/name ` 不发送；Escape 关闭；空列表提示行；`isExecutable` 项
  不出现。

集成/实机（阶段二收尾）：

- 展开语义探测（临时命令 + 真实 turn，见 §8.1）；
- typecheck + 全量测试 + 打包 + 浏览器冒烟（弹窗交互、320px 无横向
  溢出、reduced-motion）+ Cursor 可见验收；
- 更新 `docs/product/implementation-status.md`。

## 8. 风险与未决项

### 8.1 执行展开语义（阶段二第 1 步验证）

证据强烈指向 CLI 后端在消息文本路径解析 `/slug`（§1.2），但尚未在
stream-jsonrpc 后端上用真实 turn 验证。若验证失败（后端把
`/name args` 当普通文本）：回退方案是 Host 侧展开——`list_commands`
不返回文件路径，Host 需按文档规则解析
`<workspace>/.factory/commands/<slug>.md` → `~/.factory/commands/`
的 frontmatter 并展开 `$ARGUMENTS`，以展开文本调用 `sendTurn` 而
转录仍显示 `/name args`。该路径要复刻 CLI 规则，属最后手段；若走到
这一步，弹窗行为不变，新增改动集中在 Host。

**验证结果（2026-08-11，阶段二第 1 步）：假设成立，无需回退。**
用临时 `.factory/commands/dvx-probe.md`（模板要求原样回显
`$ARGUMENTS`）经 SDK `createSession` + `ProcessTransport` +
`session.stream('/dvx-probe purple-elephant-42')` 发送真实 turn，
助手准确返回 `EXPANDED-OK purple-elephant-42`，即 stream-jsonrpc
后端在服务端完成命令展开。持久化历史形态：CLI 把可见用户行记为
`/dvx-probe is running`，展开后的模板正文以
`<system-notification>` 包裹的用户消息入库（现有历史投影会将其
过滤），助手回复正常入库。结论：发送路径保持普通 `turn.send`
文本；重载会话后用户行显示 `is running` 文案属 CLI 行为，接受。
探测用命令文件与探测会话已删除。

### 8.2 与并行修复代理的文件冲突

对方正在改 `reconcileSessionHistory.ts`、`runtimeAdapter.ts`、
`main.tsx`、`AppErrorBoundary.tsx`、`styles.css` 及相关测试并会跑
构建。本切片阶段二改动面与其仅在 `styles.css`（追加规则）与可能的
`Thread.tsx` 邻近测试上接触。执行顺序上：阶段二开工前先 `git status`
确认对方变更已落地或明确边界，`styles.css` 只追加不重排。

### 8.3 其他

- 短生命周期 client 的额外 `droid` 进程有秒级延迟：懒加载 + 缓存 +
  loading 态兜底；不在 Runtime 初始化时预取（避免拖慢首屏）。
- 命令列表是文件系统状态，用户中途增删文件不会自动刷新：每次弹窗
  打开时若无 ready 缓存才拉取；后续可加手动刷新入口（不在本切片）。
- 新建 Session（尚未产生 session id 前）不可列命令：`requireSession`
  保证只在会话就绪后可用，弹窗在 loading 态提示。

## 9. 阶段二预计改动文件

| 层级    | 文件                                                        | 改动                                        |
| ------- | ----------------------------------------------------------- | ------------------------------------------- |
| Shared  | `src/shared/bridgeMessages.ts`                              | 常量、`CommandsRefreshMessage`、`SessionCommandsState(+Message)`、union 注册 |
| Shared  | `src/shared/validateMessage.ts`                             | `parseCommandsRefresh`                      |
| Webview | `src/webview/bridge/validateHostMessage.ts`                 | `parseSessionCommandsMessage`               |
| Runtime | `src/runtime/DroidRuntime.ts`                               | `RuntimeCommand`、`listCommands?` 接口与常量 |
| Runtime | `src/runtime/commands/FactoryCommandCatalog.ts`（新建）     | 短生命周期 client loader + 投影             |
| Runtime | `src/runtime/FactoryDroidRuntime.ts`                        | `listCommands()` 委托、诊断                 |
| Host    | `src/extension/ChatController.ts`                           | `commands.refresh` 分支、缓存、emit、recents |
| Webview | `src/webview/assistant/store.ts`                            | `commands` 状态                             |
| Webview | `src/webview/assistant/App.tsx`                             | 状态下传、`onCommandsRefresh` 回调          |
| Webview | `src/webview/assistant/Thread.tsx`                          | `findCommandToken` + 弹窗                   |
| Webview | `src/webview/assistant/styles.css`                          | `dvx-command-*`（追加，注意 §8.2）          |
| 测试    | 上述各层对应 `.test.ts(x)`                                   | §7 清单                                     |
| 文档    | `docs/product/implementation-status.md`                     | 状态更新                                    |
