# Session 域调研与设计：管理补全、跨项目列表、历史对齐修复

> 调研日期：2026-08-11。
> 本文档只做调研结论与设计，不包含实现。所有 SDK 证据来自
> `node_modules/@factory/droid-sdk@0.7.0` 的公开类型定义
> （`dist/index-D_SzTnFR.d.ts`、`dist/node.d.ts`）、`dist/node.mjs`
> 实现源码，以及只读探测脚本的实测输出（脚本见
> `artifacts/probe-session-catalog-scope.mjs`、
> `artifacts/probe-reconcile-keys.mts`、
> `artifacts/probe-reconcile-align.mts`、
> `artifacts/probe-reconcile-lcs.mts`）。

---

## 1. Session 管理补全（归档 / 删除 / 收藏 / 分支关系）

### 1.1 SDK 能力证据总表

| 能力 | 子进程路径（`DroidClient` / `DroidSession`，当前生产路径） | daemon 路径（`ConnectedDroid.sessions`，未接入） | 磁盘数据模型（公开 Schema / 实测文件） |
| --- | --- | --- | --- |
| Rename | ✅ `DroidClient.renameSession()` / `DroidSession.rename()`（已生产接通） | ✅ `SessionOperationsResource.rename(sessionId, title)` | `.jsonl` 首行 `session_start.title` |
| Fork | ✅ `DroidClient.forkSession()` / `DroidSession.fork()`（已生产接通） | ✅ `SessionOperationsResource.fork()` | — |
| Archive / Unarchive | ❌ 无任何方法 | ✅ `SessionOperationsResource.archive(sessionId)` / `unarchive(sessionId)`，JSON-RPC 方法名 `DaemonDroidMethod.ARCHIVE_SESSION = "daemon.archive_session"` / `UNARCHIVE_SESSION = "daemon.unarchive_session"`，返回 `DaemonArchiveSessionResultSchema { archivedAt: string }`；`DaemonClient.archiveSession()` 的 JSDoc 明确 “Archive a session (persists to .settings.json on daemon)” | ✅ 公开 `SessionSettingsFileSchema { archivedAt?: string; tags?: … }`，对应 `~/.factory/sessions/<项目目录>/<sessionId>.settings.json`；`listSessions()` 实现里 `if (settings?.archivedAt) return null` 会把已归档会话从列表滤除 |
| Delete | ❌ 无 | ❌ 无（daemon 的 `delete()` 只存在于 crons / customModels / automations / workstreams / computers 资源上） | ❌ 无删除 API；只能物理删 `.jsonl`（SDK 无此渠道） |
| Favorite / Star | ❌ 无读写 RPC | ❌ 无（daemon list 也不返回 favorite 字段） | ⚠️ 只读：`SessionMetadataSchema.isFavorite?: boolean`，实现由 `loadFavorites()` 读 `~/.factory/sessions/.favorites`（JSON string[]，实测存在，当前内容 `[]`，旁边有 `.favorites.migrated` 标记）。**没有公开写入 API**，写入方是 droid CLI TUI |
| 分支关系 | ❌ list 结果（`SessionMetadata`）无 parent 字段 | ✅ `DaemonSessionSummary.parentSessionId` / `parentToolUseId`；`OpenedSessionSummary` 同 | ✅ `~/.factory/sessions-index.json`（version 2，实测 181 条）每条字段：`sessionId, hostId, mtime, settingsMtime, title, cwd, messagesCount, tags, callingSessionId, callingToolUseId`。`callingSessionId`/`callingToolUseId` 即父子关系。**注意实测该索引不完整**：本机由子进程路径创建的 `40ebe83d…` 不在其中 |
| 归档过滤选项 | — | ✅ daemon list 请求带 `includeArchived?: boolean`；`DaemonSessionSummary.archivedTime?: Date` | 见上 `archivedAt` |

结论：

- **Rename / Fork**：已接通，无新增调研需求。
- **Archive**：真实能力存在但**只在 daemon 协议**上；当前生产 Runtime 走
  `ProcessTransport`（子进程 JSON-RPC），`DroidClient` 上没有该方法。
  数据模型（`.settings.json` 的 `archivedAt`）是公开 Schema 且被公开的
  `listSessions()` 消费。
- **Delete**：SDK/daemon/CLI 协议全都没有。**不设计此功能**。
- **Favorite**：只有"读"是公开的（`isFavorite` 经 `listSessions()`），
  "写"是 CLI 私有文件行为（`.favorites`）。
- **分支关系**：daemon list 与 sessions-index.json 都有父子字段，但子进程
  路径的 `listSessions()` 不返回；且 sessions-index 覆盖不全。

### 1.2 设计决策

按 AGENTS.md "不发明不支持的能力、fail closed" 原则分三档：

1. **Favorite（建议本期做，文件契约方案）**
   `.favorites` 是 SDK 自己读取的简单 JSON string[]，往返闭环走公开
   `listSessions()`（写文件 → 重新 list → `isFavorite` 回来）。风险是
   该文件由 CLI 拥有、无锁；写入策略必须是"读-改-写全量数组 + 原子
   rename 写入 + 失败静默降级"，且只增删自己 UI 操作的 sessionId。
   这是一个明确的**私有文件契约依赖**，需在 implementation-status 里
   如实标注（类似现有 recovery 缓存的定位，不冒充官方 API）。

2. **Archive（建议 daemon 接入前不做写入；可先做"读"）**
   写入渠道只有 daemon RPC；在当前子进程架构下要么等 daemon 主运行路径
   （MVP 未完成项），要么自行写 `.settings.json` 的 `archivedAt`。后者
   与 Favorite 不同：`.settings.json` 同文件还承载 CLI 的模型/自主档等
   会话设置（实测每个会话都有该文件且字段丰富），写坏的代价是破坏会话
   设置，风险明显更高。**建议**：本期不实现 Archive 写入；Runtime 接口
   预留可选方法签名，UI 不显示按钮（保持现状 fail closed）。daemon
   路径接入后走 `sessions.archive/unarchive` + list 的 `includeArchived`。

3. **分支关系（建议 host 本地记录为主，索引只读增强为辅）**
   DroidVisX 自己触发的 fork / rewind 分支 / compact 收养在 Host 侧都有
   明确的"旧 id → 新 id"时刻（`performFork`、rewind、compact 均已知两个
   id），把这层关系记进 host 本地存储即可覆盖本产品产生的全部分支；
   CLI 侧产生的关系可在列表加载时**只读**读取 `sessions-index.json` 的
   `callingSessionId` 做增强（缺失容忍）。不把索引当权威数据源。

### 1.3 分层设计（参照 session.rename / session.fork 既有模式）

Bridge（`src/shared/bridgeMessages.ts` + 双向校验）：

```ts
// Webview -> Host（新增）
interface SessionFavoriteMessage {
  readonly type: 'session.favorite';
  readonly sessionId: string;
  readonly favorite: boolean;
}
```

- `validateMessage.ts`：仿 `session.rename` 分支（校验 sessionId 非空、
  favorite 为 boolean、无多余字段）。
- Host→Webview 无新消息类型：结果随既有快照回发，`SessionSummary`
  DTO 增加 `readonly isFavorite: boolean`（与 `readonly branch?: { parentSessionId: string } | null` 可选字段一起在
  `validateHostMessage.ts` 补校验；`isFavorite` 缺省 false）。
- Archive 的 `session.archive` / `session.unarchive` 消息**本期不加**，
  待 daemon 路径时按同模板补。

Runtime（`src/runtime/`）：

- 新增 `src/runtime/sessionFavorites.ts`：
  `readFavorites(sessionsDir): Set<string>`、
  `writeFavorite(sessionsDir, sessionId, favorite): Promise<boolean>`
  （全量读-改-原子写，任何 IO/解析失败返回 false，不 throw）。
  纯 fs 模块，不进 `DroidRuntime` 接口（favorite 不是会话 RPC，而是
  目录级操作，任意目录条目均可收藏，无需活跃 Session）。
- `FactorySessionCatalog.projectSessionMetadata` 已投影
  `isFavorite: value.isFavorite === true`（现有代码，无需改动）；
  `SessionCatalogEntry` 已含 `isFavorite`。
- 分支关系：`FactorySessionCatalog` 增加可选的只读
  `sessions-index.json` 读取（safeParse、缺失/坏损即忽略），把
  `callingSessionId` 投影为 `parentSessionId?`。

Host（`src/extension/ChatController.ts`）：

- `handleSessionFavorite(sessionId, favorite)`，模式对照
  `handleSessionRename`（见现有实现）但**不要求是活跃 Session**：
  校验目录里存在该 sessionId（`hasCatalogSession`）→ 调
  `sessionFavorites.writeFavorite` → 成功后重新 `loadCatalog(cwd)` 并
  `emitSnapshot()`；失败发 `session-favorite-failed` warning 诊断。
  与 `sessionOperationInProgress` / `refreshInProgress` 互斥，防并发
  目录写。
- Host 本地分支记录：`SessionRecoveryStore` 增加
  `recordBranch(childId, parentId)`（fork/rewind/compact 三个既有收养
  点各加一行调用），目录投影时合并进 `SessionSummary.branch`。

Webview（`src/webview/assistant/SessionDrawer.tsx` + `App.tsx`）：

- 会话行在现有 Fork/Rename 按钮旁加 Star 切换（任意行可用，不限活跃
  行），点击发 `session.favorite`；`isFavorite` 行首实心星标；列表排序
  收藏置顶（同组内仍按 modifiedTime 降序）。
- 有 `branch.parentSessionId` 的行显示轻量 "forked from …" 徽标
  （父标题在目录内可查则显示标题，否则显示短 id）。
- `App.tsx` 仿 `session.rename` 回调下发 `onToggleFavorite`。

### 1.4 实现阶段预计改动文件

- `src/shared/bridgeMessages.ts`（`SessionFavoriteMessage`、
  `SessionSummary.isFavorite/branch`）
- `src/shared/validateMessage.ts` + `validateMessage.test.ts`
- `src/webview/bridge/validateHostMessage.ts` + 测试
- `src/runtime/sessionFavorites.ts`（新）+ 测试
- `src/runtime/FactorySessionCatalog.ts`（分支索引只读增强）+ 测试
- `src/runtime/SessionCatalog.ts`（entry 增加 `parentSessionId?`）
- `src/extension/ChatController.ts`（favorite 处理、分支记录）+ 测试
- `src/extension/SessionRecoveryStore.ts`（分支映射持久化）+ 测试
- `src/webview/assistant/SessionDrawer.tsx`、`App.tsx`、`styles.css` + 测试
- `docs/product/implementation-status.md`（Favorite → 生产已接通并注明
  文件契约；Archive/Delete 维持"无公开渠道"结论，补 daemon 证据）

---

## 2. 会话列表跨项目显示问题

### 2.1 SDK 证据与实测

`listSessions()`（`dist/node.mjs`，公开导出）的真实行为：

- 存储布局：`~/.factory/sessions/<sanitizePathToDirectoryName(cwd)>/`
  每项目一个子目录（实测本机 23 个项目目录，根目录已无遗留平铺
  `.jsonl`，只剩 `.favorites` / `.favorites.migrated`）。
- `ListSessionsOptions = { cwd?, fetchOutsideCWD?, limit?, sessionsDir? }`：
  默认按 `cwd`（缺省 `process.cwd()`）**只扫该项目子目录**；目录名经
  `path.resolve` + `fs.realpathSync`（Windows 下去掉盘符冒号、斜杠转
  `-`）。`fetchOutsideCWD: true` 才会扫全部项目目录。
- 根目录遗留平铺文件走 `requiredCwd` 精确过滤：
  `path.resolve(summary.cwd) !== requiredCwd` 即丢弃（大小写敏感，
  Windows 上 `d:` ≠ `D:`，但本机已无平铺文件，该路径不生效）。
- `SessionMetadata` 每条带 `cwd?: string`（取自 `.jsonl` 首行
  `session_start.cwd`）。

只读探测实测（`artifacts/probe-session-catalog-scope.mjs`）：

- `listSessions({ cwd: 'd:\\E\\前端好玩的东西\\droidvisx', limit: 50 })`
  返回 50 条，cwd 分布 `40 × D:\…\droidvisx + 10 × d:\…\droidvisx`，
  **无任何其他项目会话**；小写盘符入参与大写结果一致（realpath 归一）。
- `fetchOutsideCWD: true` 才出现 面试算法 / ai-drawing / 天气卡片 等其他
  项目的会话。
- `dist/extension/extension.cjs`（当前构建产物）内含同版本的
  `fetchOutsideCWD` 实现，即打包的 SDK 也是 cwd 作用域版本。

**结论：SDK 0.7.0 的 `listSessions({ cwd })` 本身就是项目作用域的，
`FactorySessionCatalog.listSessions(cwd)`（`src/runtime/FactorySessionCatalog.ts`，
Host 传 `workspace.cwd`）在当前依赖下无法复现"跨项目"。**该症状最可能
来自旧版本 SDK 的历史行为（升级前的安装包），或把 `fetchOutsideCWD`
式全量结果误当作过默认行为。设计仍补两层防护 + 一个可选增强。

### 2.2 设计

1. **防御性 cwd 复核（本期做）**：`FactorySessionCatalog.projectSessionMetadata`
   把 `value.cwd` 一并投影；Host 侧（或 catalog 内）对
   `entry.cwd` 与 workspace cwd 做**归一化比较**（两侧
   `path.resolve` + Windows 下不区分大小写；`realpath` 失败容忍），
   不匹配的条目直接丢弃并计数进诊断。这样即使 SDK 回归/降级为全量
   列表，UI 仍然只显示本项目，且 `d:`/`D:` 变体不误伤（实测同项目内
   两种盘符大小写并存）。
2. **"本项目 / 其他项目"分组（可选二期）**：目录加载改为两次调用——
   `listSessions({ cwd })` 与 `listSessions({ fetchOutsideCWD: true, limit })`
   ——或单次全量后按归一化 cwd 分组。Bridge `SessionSummary` 增加
   `readonly scope: 'workspace' | 'other'`（或直接带安全截断后的
   `projectLabel`），SessionDrawer 渲染两个分组标题，"其他项目"分组
   默认折叠、仅可 Resume 不可设为活跃工作区外会话（`resumeSession`
   固定使用会话持久化 cwd，跨项目恢复本身可行，但工具将作用于对方
   项目目录——需要显著提示）。若不接受该复杂度，一期只做分组显示、
   选择时提示"请在对应项目窗口打开"。
3. sessions-index.json 不用于列表（覆盖不全、非公开读取契约），仅按
   §1.3 用作分支关系增强。

### 2.3 实现阶段预计改动文件

- `src/runtime/SessionCatalog.ts`（entry 增 `cwd?`/`scope`）
- `src/runtime/FactorySessionCatalog.ts` + 测试（cwd 投影、归一化过滤、
  可选双查询分组）
- `src/extension/ChatController.ts` + 测试（目录快照投影 scope；
  跨项目选择的守卫与提示）
- `src/shared/bridgeMessages.ts`、`src/webview/bridge/validateHostMessage.ts`
  + 测试（`SessionSummary.scope`）
- `src/webview/assistant/SessionDrawer.tsx` + 测试（分组渲染）
- `docs/product/implementation-status.md`

---

## 3. 历史对齐重复显示修复（reconcileSessionHistory）

### 3.1 实测诊断（真实崩溃会话 `40ebe83d…`，cwd `D:\E\前端好玩的东西\react+ts\面试算法`）

探测方法：恢复检查点取自
`C:\Users\ASUS\AppData\Local\Temp\dvx-recovery2.json`
（`droidvisx.sessionRecovery` 内该会话 72 条）；loaded 侧用生产同路径
（`ProcessTransport` + `DroidClient.loadSession` + `projectSessionHistory`）
现场加载（今日已增长到 128 条；崩溃当时为 78 条）。复刻
`transcriptItemKey` 后对比（`artifacts/probe-reconcile-keys.mts`、
`probe-reconcile-lcs.mts`；loaded 投影缓存在
`artifacts/tmp/probe-loaded-40ebe83d.json`）：

- `suffixPrefixOverlap(recovered, loaded) = 0`、
  `suffixPrefixOverlap(loaded, recovered) = 0`；
- 但按多重集合计，**69/72 个 recovered key 在 loaded 中有逐字节相等的
  对应项**；LCS 长度 68，匹配对形成 **7 段** 而非 1 段连续区间
  （`r[2..71] ↔ l[0..74]`）。

逐项归因（全部有实测输出支撑）：

1. **recovered 独有头部 `r[0..1]`**：首轮"你是什么模型 → 我是 GPT-5.6
   Sol…"在 loaded 里完全不存在。该会话是编辑重问（rewind fork）产生的
   分支：CLI 持久化文件从重发消息开始，而 Host 检查点保留了分支前观察
   到的更早前缀。另有 `r[3]` 重发导致的重复用户消息（检查点两条
   "给我讲一下火影忍者的故事"，loaded 只有一条）。
2. **同一 thinking 块两侧文本不等**：`r[50]` 29,534 字符 vs `l[47]`
   31,421 字符（`MAX_THINKING_TEXT_LENGTH = 32_000`，两侧都没到本地
   截断线）——实时流观察到的 thinking 文本与 CLI 持久化的 thinking
   文本本来就可能不一致（尾部差约 1.9K 字符）。文本精确 key 在这类项
   上天然不稳。
3. **loaded 独有的插入项**：历史投影合成的 2 条 `changes` 行
   （`l[50]`、`l[57]`，检查点为 0 条），以及 4 条实时流从未下发的短
   thinking（`l[51]`、`l[54]`、`l[58]`、`l[62]`，128–1,441 字符，权限
   拦截后的补充思考）。
4. **loaded 独有尾部 `l[75..127]`**：检查点写入后会话在 CLI 继续使用产
   生的新回合（崩溃当时对应 78−75≈3 条新项）。

`suffixPrefixOverlap` 要求"一侧后缀与另一侧前缀**整段逐项相等**"，
上述任意一处差异都会把重叠长度直接打到 0，于是走到兜底分支
`[...loaded, ...recovered]` 整段拼接 → 同一段对话显示两遍（崩溃会话
72+78=150 条）。

**关键新证据（决定设计方向）**：两侧 user 项都带 SDK `messageId`
（recovered 12/12、loaded 17/17），且 **10/12 recovered user 的
messageId 与 loaded 逐字相等**；不相等的 2 条恰好就是 loaded 真实缺失
的分支前头部。`messageId` 是跨"实时流投影 ↔ 历史投影 ↔ 恢复缓存"
三方稳定的锚点，还天然区分重复文本（"你是什么模型"在 loaded 里出现
两次、messageId 不同）。

### 3.2 设计：user 锚点分段对齐，loaded 优先、recovered 只补两端

替换 `reconcileSessionHistory` 的匹配核心（函数签名与调用点
`ChatController.prepareActivationTranscript` 不变）：

1. **锚点提取**：两侧各取 `kind === 'user'` 项为锚点；主键
   `messageId`，无 `messageId` 的锚点退化为 `text.trim()`（仅当该文本
   在本侧唯一时才可用作锚，重复文本不作退化锚）。
2. **锚点对齐**：按顺序做单调匹配（messageId 相等优先；两侧锚点数是
   个位/十位量级，O(n·m) 可忽略）。
3. **有 ≥1 个共同锚点时**（本例 10 个）：
   - 输出以 **loaded 为唯一权威主体**（loaded 的段内合成项 changes、
     补充 thinking、文本差异一律以 loaded 版本呈现，不再逐项比对）；
   - recovered 中**位于第一个共同锚点之前**的段（本例 `r[0..1]` + 重发
     残留 `r[2..3]` 中未匹配部分）整段**前置**到 loaded 之前，
     `historyStatus` 标 `partial`（保留本地观察到的更早前缀，与现有
     "SDK 只返回压缩后缀"语义一致）；对前置段里与 loaded 首锚点文本
     相同但 messageId 不同的重发残留（`r[3]`），因其锚点未匹配且文本
     与后续 loaded 首项重复，按"文本与紧邻 loaded 段首 user 相同则
     丢弃"的窄规则去重；
   - recovered 中**位于最后一个共同锚点之后**、且 loaded 在该锚点后
     没有任何内容的段，**追加**到尾部（覆盖"崩溃发生在 CLI 持久化前"
     的场景；本例不触发，因为 loaded 尾部更长）；
   - **尾段防污染规则（2026-08-11 深夜补充，真实事故
     `4adeb11f…` recovered:151/loaded:75 → 修复前 reconciled:134）**：
     被旧"整段拼接"合并污染过的检查点把对话重复了两份，重复副本的
     user 锚点在单调匹配中因 `candidate <= lastLoadedAnchor` 被跳过，
     却会被尾段扫描当成"CLI 未持久化的新回合"整段追加。因此尾段起点
     扫描跳过所有 **loaded 已认识其锚点**（messageId 命中
     `loadedByMessageId`，或无 messageId 时 trim 文本命中 loaded 侧
     唯一文本表）的 user 回合——这些是陈旧副本而非新内容；从第一个
     loaded 不认识的 user 锚点起才算真正的尾段。真实数据复验：该
     检查点（现持久化为 134 条、29 个 user 仅 15 个唯一 messageId）
     对 loaded 75 条 reconcile 输出恰为 75 条，messageId/toolUseId
     均无重复（`artifacts/probe-reconcile-poisoned.mts`）；
   - recovered 的其余段（锚点已匹配的中段）直接丢弃——这就是重复显示
     的根治点；
   - 仍经 `uniqueTranscriptIds` + `trimTranscriptToLimits` 收尾（保留
     现有 toolUseId 去重安全网）。
4. **无任何共同锚点时**：维持现有逻辑（先 suffix/prefix 判定，再兜底
   拼接标 partial），保证既有 5 个测试场景语义不变——现测试用例均无
   messageId，自动落入该路径。
5. `changes` / `diagnostic` 项不参与任何匹配（本地/合成产物）。

已知边界（接受，不改代码）：loaded 在最后共同锚点后已有任意更新的
user 回合时，recovered 的整个尾段按陈旧处理丢弃。若 recovered 中
存在一个"比 loaded 更新且未持久化"的回合，且它对应的中间回合恰好
同时缺 messageId、文本又在两侧非唯一（锚点匹配失败），该回合会被
误丢。触发需要三个低概率条件叠加（检查点无 messageId + 文本重复 +
崩溃恰在该回合），且丢弃侧只是本地未持久化的流式残段，接受为已知
边界。

不选的替代方案：
- 「宽松 key（thinking 取前缀哈希、忽略 changes）+ 原 suffix/prefix」：
  仍是全有全无的整段匹配，对"loaded 缺头 + 中段插入 + 尾部增长"同时
  出现的真实形态（本例 7 段碎片）依旧返回 0；
- 「通用 LCS 逐项合并」：O(n·m) 在 2,000 项上限下可到 4M 次比较尚可，
  但合并语义复杂（交错段的取舍难以解释），且文本级 key 的不稳定性
  （证据 2）仍需锚点兜底，不如直接用锚点。

### 3.3 需要新增的测试用例（`reconcileSessionHistory.test.ts`）

1. messageId 锚点全部命中、loaded 含合成 `changes` 与额外 thinking →
   返回 loaded 原样（status 不降级）。
2. rewind 分支形态：recovered 头部两项（user+assistant）无对应锚点、
   其余锚点命中 → 头部前置 + loaded 主体，`historyStatus: 'partial'`。
3. 重发残留：recovered 含两条同文本 user（一条锚点命中、一条未命中且
   紧邻 loaded 首锚点同文本）→ 未命中残留被丢弃，不产生重复。
4. 同一 thinking 文本两侧长度不同（模拟 29,534 vs 31,421）→ 不再触发
   整段拼接；输出中该 thinking 只出现一次（loaded 版本）。
5. 尾部补全：recovered 在最后共同锚点之后还有一整回合、loaded 无 →
   尾段追加，标 `partial`。
6. loaded 在最后共同锚点后另有新回合（会话继续增长）→ recovered 尾段
   丢弃，输出 loaded。
7. 无 messageId、文本唯一 → 退化文本锚生效。
8. 无 messageId 且文本重复（两条相同 user）→ 不作锚，落回旧路径。
9. 完全无共同锚点 → 现有 5 个既有用例语义逐一保持（回归）。
10. 真实数据回归 fixture：从本次探针输出提炼的脱敏 key 序列
    （72/78 形态），断言 reconcile 结果长度 ≈ loaded 长度 + 前置头部，
    且无重复 user messageId。

### 3.4 实现阶段预计改动文件

- `src/extension/reconcileSessionHistory.ts`（匹配核心重写）
- `src/extension/reconcileSessionHistory.test.ts`（新增 §3.3 用例）
- 必要时 `src/shared/hostTranscriptState.ts` 类型辅助（预计不需要）
- `docs/product/implementation-status.md`（"遗留问题（另行排期）"段
  收口）

---

## 附：本次调研产出的只读探测脚本

| 脚本 | 作用 |
| --- | --- |
| `artifacts/probe-session-catalog-scope.mjs` | `listSessions` cwd 作用域实测、`.favorites`、`.settings.json`、sessions-index.json 结构 |
| `artifacts/probe-reconcile-keys.mts` | 崩溃会话两侧 key 序列对比、user 锚点、近似匹配分析 |
| `artifacts/probe-reconcile-align.mts` | 贪心顺序对齐（暴露重复文本误锚问题） |
| `artifacts/probe-reconcile-lcs.mts` | LCS 对齐与 7 段碎片结构；loaded 投影缓存到 `artifacts/tmp/probe-loaded-40ebe83d.json` |

均为只读（`loadSession` 走与生产历史加载完全相同的公开只读路径），
未修改任何仓库既有文件。
