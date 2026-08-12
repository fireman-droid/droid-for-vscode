# MCP / Skills 面板问题调查报告

> 纯只读调查（2026-08-12）。数据来源：
> `droidvisx-20260812.jsonl` 诊断日志（用户操作时段 UTC 04:00–04:38，
> 即本地 12:00–12:38）、生产代码、`@factory/droid-sdk` 类型定义、
> `~/.factory/mcp.json` / `settings.json`。本报告不改任何 src 代码。
>
> 时段内运行模式全部为 `runtime.mode = process`（每个会话由 node SDK
> 拉起独立 droid CLI 子进程）。时段内**没有任何** MCP/Skills 相关的
> `host.ui.diagnostic` / `host.bridge.rejected` / warn / error 日志——
> 这本身就是发现之一：MCP/Skills 面板的全部业务失败只投递到 Webview
> 面板状态，完全不入日志（见问题 4 修复方案）。

## 日志时间线摘要（UTC，act = 激活分段）

| 时间 | act | 事件 |
| --- | --- | --- |
| 04:22:03 | 6bb3fc | `droid.authenticate_mcp_server`（figma）发出，之后全天再无任何 auth 相关记录 |
| 04:23:29–04:25:12 | 6bb3fc/5fe5a1 | 多次 `toggle_mcp_server`，均在 ≤1s 内链式跟出 `list_mcp_servers`（成功） |
| 04:26:13 | 5fe5a1 | `set_skill_disabled` + `list_skills` |
| 04:28:34 | 6c6ab6 | `remove_mcp_server`（全天唯一一次），≤1s 链式 list（成功） |
| 04:28:48 | 6c6ab6 | `toggle_mcp_server` 后**没有**链式 list → 该次 toggle 失败；38s 后（04:29:26）出现手动 refresh |
| 04:29:51 | 6c6ab6 | 又一次 `toggle_mcp_server` 无链式 list → 失败；62s 后（04:30:53）手动 refresh。`~/.factory/mcp.json` 落盘时间恰为本地 12:29:51，与此次 toggle 精确对应 |
| 全天 | — | **零**次 `droid.add_mcp_server`；**零**次 `host.bridge.rejected` |

---

## 1. MCP 认证点击无反应（figma）

### 现象

figma 行同时显示 "Connected" 徽标和 "needs auth" 徽标；点认证按钮后出现
"Authenticating…" 与 "Waiting for Droid to finish authentication."，此后
永远没有下文（无浏览器拉起、无成功/失败反馈）。用户认为 figma 已登录。

### 根因（两个独立问题叠加）

**(a) "Connected + needs auth" 并存是显示 bug，不是状态矛盾。**
SDK 的 `McpServerStatusInfoSchema`（`@factory/droid-sdk`
`dist/index-D_SzTnFR.d.ts` ≈L2797）同时提供 `requiresAuth`（该 server
是 OAuth 型）、`hasAuthTokens`（本地已有令牌）、`pendingAuthUrl` 等字段。
我方 Runtime 投影 `projectMcpServer`
（`src/runtime/FactoryDroidRuntime.ts:1946-1976`）只保留 `requiresAuth`，
把 `hasAuthTokens`/`pendingAuthUrl` 全部丢弃；Webview
（`src/webview/assistant/ComposerControls.tsx:1076-1088`）只要
`requiresAuth === true` 就渲染 "needs auth" 徽标和认证按钮。figma 是
http OAuth 型 server 且已登录（`~/.factory/mcp-oauth.v2.file` 存在，
08-10 写入；状态 Connected），于是"已连接"与"needs auth"并排出现。
正确语义应是 `requiresAuth && !hasAuthTokens` 才显示。

**(b) 对"已认证的 server 再点认证"这条路径，等待链路整体哑掉。**
认证流：Webview 点击 → `mcp.server.authenticate` → Host
`handleMcpServerAuthenticate`（`src/extension/ChatController.ts:3155-3279`）
→ Runtime `authenticateMcpServer`
（`src/runtime/FactoryDroidRuntime.ts:972-1070`）→ SDK
`droid.authenticate_mcp_server`。SDK 的返回值只有 `{ success: boolean }`
（`AuthenticateMcpServerResultSchema`），OAuth URL 靠后续
`mcp_auth_required` 通知送达，结果靠 `mcp_auth_completed` 通知送达。
日志证实 04:22:03 请求已发出；对已登录的 figma，droid 接受请求
（success=true）但**不再发起 OAuth 流**，因此 15 秒内等不到
`mcp_auth_required`（`MCP_AUTH_URL_WAIT_MS = 15_000`，
`FactoryDroidRuntime.ts:83`），`authUrl` 为 null → Host 走
`MCP_AUTH_NO_URL_MESSAGE` 分支（`ChatController.ts:3236-3243`）显示
"Waiting for Droid to finish authentication."；此后唯一的出路是
`mcp_auth_completed` 通知（不会来）或 Host 侧超时
`MCP_AUTH_WAIT_TIMEOUT_MS = 10 分钟`（`ChatController.ts:311`）。用户在
04:24:05 就重载了窗口（新 act 5fe5a1），永远看不到超时文案。SDK 自身的
`MCP_AUTH_TIMEOUT = 300_000`（5 分钟）也远超合理等待。

### 修复方案

- `src/runtime/DroidRuntime.ts` + `FactoryDroidRuntime.ts`：
  `RuntimeMcpServer` 增加 `hasAuthTokens: boolean`（投影
  `record.hasAuthTokens === true`）。约 10 行。
- `src/shared/bridgeMessages.ts` + `src/webview/bridge/validateHostMessage.ts`
  + `ChatController.ts` 投影：`McpServerSummary` 增加同名字段。约 15 行。
- `ComposerControls.tsx`：徽标与认证按钮条件改为
  `requiresAuth && !hasAuthTokens`；已认证时可显示 "authenticated" 静态
  徽标。约 10 行。
- 快速失败：`authUrl === null` 时不再无限等待——Host 直接结束流程并提示
  "Droid 未发起浏览器认证（该 server 可能已登录）。刷新列表确认状态。"，
  同时把 `MCP_AUTH_WAIT_TIMEOUT_MS` 从 10 分钟降到 ≤2 分钟。
  `ChatController.ts` 约 15 行。
- 为认证流补日志（`host.ui.diagnostic` 或专用事件），当前全流程零日志。

### 是否需 Bridge 变更

**是**（`McpServerSummary.hasAuthTokens` 新字段，向后兼容的加法变更）。

### 优先级

**P0**——按钮点了没有任何终局反馈，且徽标语义误导用户反复重试。

---

## 2. Skills 开关联动变灰（MCP 面板同病）

### 现象

点某个 skill 的启用开关，更新期间**所有** skill 行的开关一起变灰不可点。

### 根因

面板级全局 pending，链路两端各贡献一半：

- Host：`handleSkillToggle`（`ChatController.ts:2702-2770`）一进来就
  `emitSkills(sessionId, { status: 'loading', items: [] })`（L2729），
  没有任何"哪一行在更新"的信息。
- Webview：store 在 loading 时保留旧列表
  （`src/webview/assistant/store.ts:313-326`），但 `SkillsPanel` 用
  `busy = status === 'loading' || 'idle'`
  （`ComposerControls.tsx:728`）把每一行渲染为
  `disabled={disabled || busy}`（L776、L814）→ 整个列表禁用。

MCP 面板**完全同病**：`handleMcpServerToggle` 同样先发全局 loading
（`ChatController.ts:2997`），`McpPanel` 同样 `busy` 全列表禁用
（`ComposerControls.tsx:845, 915-916`），且 Add/Remove/认证按钮也一并
被 `busy` 禁用。

### 修复方案

最小改法纯 Webview 即可：`SkillsPanel`/`McpPanel` 在本地 state 记录
"我刚发起 toggle 的行名"（`onToggle` 时 set，收到新的 ready/error 状态时
清空），行禁用条件改为 `disabled || pendingName === row.name`，其余行
保持可读但不可再发起新 toggle 时可整体轻量降透明度而非禁用；开关本体
加行内 spinner。`ComposerControls.tsx` 约 30–40 行。
（可选增强：Host 在 loading 状态里带上 `pendingName`，需要 Bridge 字段，
但第一版不必。）

### 是否需 Bridge 变更

**否**（行级 pending 可完全在 Webview 本地实现）。

### 优先级

**P1**——功能可用，交互体感差。

---

## 3. cursor-byok-browser 启用失败等几十秒才显示 failed

### 现象

启用 cursor-byok-browser（底层进程本来就起不来，属正常失败场景）后
面板停在 loading，几十秒后才出现失败反馈。

### 根因

超时全部悬在 SDK 客户端层，我方三层（Webview/Host/Runtime）没有任何
自设超时，也没有等待期提示：

- 链路：`setMcpServerEnabled`（`FactoryDroidRuntime.ts:911-927`）
  `await session.toggleMcpServer(...)` → SDK `droid.toggle_mcp_server`
  RPC。droid CLI 收到后写配置（`mcp.json` 落盘时间与失败 toggle 精确
  吻合）、再尝试拉起/连接 server 进程，直到其内部连接流程放弃才回包；
  SDK 客户端兜底超时为 `DEFAULT_REQUEST_TIMEOUT = 30_000`（30 秒，
  `@factory/droid-sdk` `dist/index-D_SzTnFR.d.ts:105478`）。
- 日志证据：04:28:48 与 04:29:51 两次 toggle 均无链式 list（即 promise
  拒绝），到用户下一次手动 refresh 分别间隔 38s / 62s——与"CLI 内部连接
  等待 + SDK 30s 超时"量级一致。
- 等待期间面板只是全列表灰化（问题 2 的 busy），没有"正在启动 xxx"的
  行内提示；失败后错误文案还会把列表清空（见问题 4a）。

### 修复方案

- Runtime 层给 `setMcpServerEnabled` 加 `Promise.race` 自设超时
  （建议 10–15s，超时即拒绝并带明确文案"server 未能在 N 秒内启动"），
  `FactoryDroidRuntime.ts` 约 15 行。注意：droid 侧配置已写入，超时后
  Host 应照常重新 `listMcpServers` 让状态徽标（failed/connecting）说话。
- 行级 pending + "Enabling…" 行内文案（与问题 2 同一处改动）。
- 失败时保留列表（见问题 4 修复），红字只作为附加行提示。

### 是否需 Bridge 变更

**否**。

### 优先级

**P1**——正常失败场景，反馈慢且无过程提示，但最终有结果。

---

## 4. MCP 列表可信度（remove 红字 / Add 无效果 / 列表与实际不符）

### 现象

(a) remove 若干 server 后出现红字 "Droid could not update that MCP
server. The list may be stale; refresh it."；(b) Add 表单提交后"完全没
效果、像摆设"；(c) 列表显示的 server 实际已不存在。

### 数据流与真相源（统一背景）

持久真相源是 `~/.factory/mcp.json`（+ settings 层级），但面板显示的是
**三层缓存后的会话内快照**：

1. **CLI 进程内存视图**：process 模式下每个会话一个 droid CLI 子进程，
   `droid.list_mcp_servers` 查询的是该进程自己的视图。一个窗口/会话里
   add/remove/toggle 写了 `mcp.json`，其他已在运行的会话进程不保证重读
   —— 面板可能显示别处已删掉的 server（现象 c 的第一来源）。
2. **Webview ready 缓存**：打开 MCP 面板只在 `status === 'idle' ||
   'error'` 时才触发 `mcp.refresh`（`ComposerControls.tsx:678-680`；
   Skills 同理 L653-655）。一旦某次加载成 ready，之后无论过多久、
   无论 Droid 侧发生什么，重新打开面板都**不再刷新**（现象 c 的第二
   来源）。
3. **错误即清空**：mutation 失败时 Host 发
   `{ status: 'error', items: [] }`（`ChatController.ts:3146-3151`、
   toggle 同 3031-3035），store 只对 loading 保留旧列表
   （`store.ts:327-338`），error 直接把列表清成空 → 用户只看到一句红字，
   全部 server "消失"，必须手动 Refresh 才回来。

### 三个现象的具体判定

**(a) 红字**：该文案是 `MCP_TOGGLE_FAILED_MESSAGE`
（`ChatController.ts:292-293`），remove 有自己的独立文案
（"could not remove"，L296-297）。日志显示全天唯一一次
`remove_mcp_server`（04:28:34）成功地链式跟出了 list；真正失败的是
紧随其后 04:28:48 的 **toggle**（对刚出问题的 cursor-byok-browser 类
server）。即：红字本身报的是 toggle 失败，用户在连续操作中把它归因给了
remove；叠加"错误即清空"，体感是"remove 搞坏了列表"。

**(b) Add 像摆设**：代码链路本身是完整的（表单
`ComposerControls.tsx:928-1016` → `mcp.server.add` → 校验
`validateMessage.ts:782-844` → `handleMcpServerAdd`
`ChatController.ts:3040-3071` → SDK `droid.add_mcp_server`），但日志
证明当天**从未有任何一次 `droid.add_mcp_server` 到达 SDK 层**，同时
`host.bridge.rejected` 为零（校验没拒过消息）。消息在到达 SDK 之前被
静默吞掉，候选丢弃点全部无任何用户反馈或日志：

- 表单校验静默 no-op：stdio 要求命令非空、http/sse 要求 URL 以
  `http(s)://` 开头，不满足时提交按钮只是禁用（L944-945），点击无任何
  提示；
- 表单提交先 `setAdding(false)` 关闭表单再调 `onAdd`（L882-885），
  即使后续被丢弃，用户看到"表单收起来了"也会以为已提交；
- Host 守卫链（L3045-3053：sessionId 不匹配 / runtime 为 null / 未连接 /
  `sessionOperationInProgress` / 工作区变更）命中任意一条都 `return`，
  零反馈零日志。

日志无法区分具体命中哪一点（这是如实结论），但"全链路静默失败 + 成功
与失败都没有回执"本身就是根因：用户没有任何办法区分"已添加"和"被丢弃"。

**(c) 显示有但实际没有**：上述 1（跨会话进程内存视图不同步）+ 2
（ready 永不自动刷新）叠加。另外快照切换会话时 Webview 保留同会话旧
mcp 状态（`store.ts:222-225`），窗口重载后为 idle 会重新拉，但同窗口
长时间开着就一直是旧的。

### 修复方案

- **错误不清列表**：Host 在 mutation 失败分支改为"重新 `listMcpServers`
  并以 ready+错误消息附带"或至少发 `{ status: 'error', items: 旧列表 }`；
  或 store 对 error 也保留旧 items。`ChatController.ts` 或 `store.ts`
  约 10–20 行。
- **打开面板必刷新**：`ComposerControls.tsx` 打开 skills/mcp 视图时无
  条件触发 refresh（ready 时后台静默刷新，不打断显示）。约 5 行。
- **操作回执**：add/remove/toggle 的成功与失败都发一条可见反馈
  （成功可复用列表刷新 + 轻量 toast/状态行；失败带上 server 名与原因），
  并镜像到 `host.ui.diagnostic` 日志（当前 MCP/Skills 全部业务失败
  零日志，是本次调查最大的可观测性缺口）。`ChatController.ts` 约 30 行。
- **Add 表单显式校验提示**：不满足条件时按钮旁给出原因文字。
  `ComposerControls.tsx` 约 10 行。

### 是否需 Bridge 变更

核心修复**否**；若做独立的"操作回执" toast 消息（如 `mcp.op.result`）
则**是**（加法变更，可选）。

### 优先级

**P0**——列表可信度是这个面板存在的意义；错误清空 + 静默 add + 永不
刷新三者叠加直接摧毁信任。

---

## 5. Skills 会话可用性错位（面板已启用，会话内 Droid 说没有）

### 现象

设置面板启用了 gpt-image skill，当前会话里 Droid 自述可用技能列表中
没有它；新建/刷新会话后才同步。

### 判定：Droid 的会话级 skill 快照语义，不是本项目 bug

- 面板走的 `droid.list_skills` / `droid.set_skill_disabled` 是对会话
  CLI 进程的配置查询/写入（SDK `SkillInfoSchema` 含 `enabled` /
  `disabledBy` ledger 字段），写入立即反映在 list 结果里——所以面板
  显示"已启用"是真实的配置状态。
- 但 Droid 会话把可用 skills 注入在会话启动时构建的系统提示里，运行中
  的会话不会重读；因此会话内模型自述的技能清单停留在会话创建时刻的
  快照。日志佐证：04:26:13 `set_skill_disabled` + `list_skills` 成功
  后，04:33 用户在会话内询问，Droid 仍答"没有"；且用户自己观察到新会话
  即同步——与快照语义完全一致。我方代码没有任何一层缓存会造成这种
  "面板真、会话假"的错位。

### 修复方案（UX，因为语义不可改）

- `SkillsPanel` 顶部或 toggle 成功后显示静态说明行："对话中的技能列表
  在会话启动时确定，更改将在新会话生效"。`ComposerControls.tsx` 约 5 行。
- 可选一键操作："应用并开始新会话"按钮，复用现有 `session.new` Bridge
  消息（无需新消息）。`ComposerControls.tsx` + `App.tsx` 约 15 行。
- MCP 面板如有同类错位（toggle 后会话内工具集不更新）可共用同一说明行；
  本次日志无法证实 MCP 是否同语义，待后续验证。

### 是否需 Bridge 变更

**否**。

### 优先级

**P2**——不是缺陷，是需要解释的语义；一行文案即可消除大部分困惑。

---

## 6. "+" 菜单搜索失效（输入 image2 / figma 无结果）

### 现象

Composer "+" 菜单顶部搜索框（placeholder："Search actions, skills,
MCP…"）输入 `image2` 或 `figma` 均无结果，而这些项在 Skills/MCP 子面板
里明明存在。

### 根因

搜索实现只对**五个写死的分类标签字符串**做子串匹配，从未接入 skills/
MCP/commands 的实际条目数据（`ComposerControls.tsx:523-534`）：

```ts
const normalizedQuery = query.trim().toLocaleLowerCase();
const showMode = ... 'mode'.includes(normalizedQuery);
const showAutonomy = ... 'autonomy'.includes(normalizedQuery);
const showSkills = ... 'skills'.includes(normalizedQuery);
const showMcp = ... 'mcp servers'.includes(normalizedQuery);
const showAttach = ... 'attach files editor selection context'.includes(...);
```

`figma` 不是 `'mcp servers'` 的子串、`image2` 不是 `'skills'` 的子串，
于是全部隐藏、显示 "No matching actions."。大小写处理没有问题
（两侧都 toLocaleLowerCase），数据也早就在 props 里（`skills.items`、
`mcp.items` 就传给了同一个组件）——纯粹是匹配逻辑只写了类目一层。

### 修复方案

在 `SettingsPopover` 里把查询同时匹配到条目级：
`skills.items.some(s => s.name.toLowerCase().includes(q))` 命中则显示
Skills 行（并可直接在根视图渲染命中的 skill 行/跳入子面板），MCP 同理
匹配 `server.name` 与 `tools[].name`；attach 行匹配各行标题。若 skills/
mcp 尚为 idle，输入非空时顺带触发一次 refresh，否则数据为空永远搜不到。
`ComposerControls.tsx` 约 40–60 行。

### 是否需 Bridge 变更

**否**。

### 优先级

**P1**——搜索框承诺了 "skills, MCP" 却完全不搜它们，属于功能性失效。

---

## 汇总

| # | 一句话根因 | Bridge 变更 | 优先级 |
| --- | --- | --- | --- |
| 1 | 投影丢弃 `hasAuthTokens` 导致已登录 server 仍显示 needs auth；对已认证 server droid 不发通知，Host 等 10 分钟超时用户等不到 | 是 | P0 |
| 2 | toggle 时 Host 发全局 loading、Webview 按 busy 禁用全列表；MCP 面板同病 | 否 | P1 |
| 3 | 三层无自设超时，全靠 SDK 30s 兜底 + CLI 内部连接等待；等待期无行内提示 | 否 | P1 |
| 4 | 真相源是 mcp.json，面板隔着"CLI 进程内存视图 + ready 永不刷新 + 错误清空列表"三层陈旧；add 全链路静默失败无回执无日志 | 否（回执消息可选） | P0 |
| 5 | Droid 会话级 skill 快照语义（启动时注入），非本项目 bug；需 UX 标注 | 否 | P2 |
| 6 | 搜索只匹配五个写死的分类标签，从未接入 skills/MCP 条目数据 | 否 | P1 |

## 日志无法回答的部分（如实记录）

- 问题 4(b)：add 请求被静默吞掉的确切位置（表单 no-op 还是 Host 守卫链
  哪一条）无法从日志判定——因为该链路成功与失败都不产生日志。修复
  "操作回执 + host.ui.diagnostic 镜像"后可复测定位。
- 问题 1：无法从日志确认 droid 对已认证 server 是否真的不发
  `mcp_auth_completed`（SDK 通知不入日志），该结论由"请求已发出 +
  15s 无 URL 分支被触发（用户看到 Waiting 文案）+ 用户重载前无任何
  后续"推断。
- `sdk.request.sent` 有去无回（playbook §3.3），所有"RPC 成功/失败"
  的判定均由"是否出现链式 list 请求"间接推断。
