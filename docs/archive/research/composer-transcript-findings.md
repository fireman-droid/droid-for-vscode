# Composer 与转录四项问题调查报告

> 调查日期：2026-08-12。纯只读调查：未改任何 src 代码、未跑
> build/package/install。
> 日志源：`droidvisx-20260812.jsonl`（globalStorage，全保真格式），
> 用户操作窗口 UTC 04:00–04:38（本地 12:00–12:38）。
> 现场还包括 `~/.factory/sessions` 下的真实会话文件与
> `@factory/droid-sdk` 0.7.0 的类型定义/实现。

## 前置结论："空窗口"假设不成立

线索称用户测试窗口可能没打开工作区文件夹（截图路径含
"empty-window"）。日志直接否定了这一点：

- 当天日志共 1029 行，**没有任何一行缺失 `workspace` 字段**；
  该字段由 `src/extension/extension.ts:253-254` 从
  `vscode.workspace.workspaceFolders?.[0]` 实时取值。
- 04:00–04:38 窗口内全部 5 个激活段（act=fd6381 / 6bb3fc / 5fe5a1 /
  6c6ab6 / 16242f）的 workspace 均为
  `d:\E\前端好玩的东西\react+ts\个人简历`。

即用户实测时**工作区文件夹是打开的**。"empty-window" 更可能只是
截图存放位置来自另一个空窗口，与 DroidVisX 测试窗口无关。四个问题
都不能用"无工作区"解释，需按下文各自的机制分析。

---

## 1. @ 文件提及"还是没用"

### 现象

用户在修复（7c37acc，CJK 前缀触发 + "Searching files…/No matching
files" 空态反馈）之后实测，仍反馈 @ 提及"没反应/没结果"。

### 日志证据

- 用户实测运行的 webview 构建号为 `20260812T040046`
  （`webview.boot-ok`，04:14–04:33 四段一致）。7c37acc 提交于本地
  10:53 之前，**修复确实在被测构建里**——不是陈旧 bundle 问题。
- 整个窗口**没有任何** `host.bridge.rejected`：webview→host 消息
  没有被校验丢弃过（CJK query 也过校验，
  `src/shared/validateMessage.ts:1167-1187` 只拒控制字符）。
- `host.turn.accepted` 的 prompt 全文里没有出现过 @ 提及产物：
  用户的 @ 尝试从未走到发送。
- 关键局限：**@ 搜索链路目前零埋点**。`workspace.searchFiles` 与
  `workspace.files` 往返在 Host/Webview 两侧都不产生任何日志事件
  （事件词典里没有对应条目），因此日志无法区分"请求没发出/被
  静默丢弃/返回了空结果"。

### 代码机制与静默失败路径

排查代码找到三条**用户看不到任何反馈**的路径：

1. **只输入 `@` 时界面完全无反应（设计如此，但与预期冲突）**。
   弹窗渲染条件是 `mention !== null && mention.query.length > 0`
   （`src/webview/assistant/Thread.tsx:1885`）——必须在 @ 后再打
   至少一个字符才出现弹窗。用户习惯了 Cursor 的"@ 一按就弹"，
   打个 @ 没反应就会判定"没用"。这是"没反应"主诉最可能的解释。
2. **Host 侧静默丢弃**：`ChatController.handleWorkspaceSearchFiles`
   （`src/extension/ChatController.ts:3710-3720`）在
   `sessionId !== this.sessionId || connection.status !== 'connected'`
   时直接 return，**不回任何消息**——webview 弹窗会永远停在
   "Searching files…"。用户实测期间恰好密集做了 edit-resend
   （rewind 换会话，04:33:13、04:34:07）和 compact（04:34:15 换到
   continuation 会话），换会话瞬间的 @ 请求就命中这条路径。
3. **无工作区时与"无匹配"不可区分**：
   `searchWorkspaceFiles`（`src/extension/vscodeAttachmentSources.ts:126-128`）
   在没有 workspaceFolders 时返回 `[]`，UI 显示 "No matching
   files"，与真的搜不到无法区分（本次实测虽有工作区，该缺陷仍
   真实存在）。

Webview 侧 `handleFileSearch`（`src/webview/assistant/App.tsx:431-443`）
也有同样的静默守卫（未连接则不发），但弹窗此时停留 "Searching
files…"，至少有视觉反馈。

### 方案

按优先级：

1. **`@` 一输入就弹窗**（Thread.tsx，~20 行 + CSS 少量）：
   `mention.query.length === 0` 时也渲染弹窗，内容为提示行
   "Type to search workspace files"（或直接预取工作区根下前 20 个
   文件，Host 已有 `searchFiles` 通道，改动集中在空 query 分支）。
2. **补全空态区分**（Bridge + Host + Webview，~40 行）：
   `workspace.files` 回包加 `status: 'ok' | 'no-workspace'`
   （`src/shared/bridgeMessages.ts`、`validateHostMessage`），Host 在
   `workspaceFolders === undefined` 时回 `no-workspace`，UI 显示
   "Open a folder to search files"。
3. **消灭静默丢弃**（ChatController.ts，~10 行）：Host 守卫命中时
   也回一个空 `workspace.files`（带原 requestId），让弹窗从
   "Searching files…" 落到确定态。
4. **加埋点**（ChatController.ts，~15 行）：搜索完成时记一条
   debug 事件（query 长度、resultCount、durationMs、是否
   no-workspace），并把该事件补进
   `docs/product/log-analysis-playbook.md` 词典。下次"没用"投诉
   即可从日志直接定位。

### 优先级建议

高（联动 4 项一起做一轮）。本次无法从日志钉死用户那一刻的具体
分支，1+3+4 合起来能同时消除三条无反馈路径并让下次可诊断。

---

## 2. `/` 弹窗希望看到内建命令

### 现象

空目录下 `/` 弹窗只显示 "No custom commands (.factory/commands)"
空态。用户的真实期望是 `/` 里能看到**内建命令**，认为"修复了跟
没修复一样"。

### 现状机制

- Droid 的命令目录 RPC 只返回 `.factory/commands` 自定义命令。
  日志证实：当天 3 次 `runtime.commands.finished` 全部
  `commandCount: 0`（01:52、02:51、04:21，第三次即用户实测），
  空态显示是"正确"的——但对用户没有价值。
- GUI 自己确实有内建能力，且 `/compact` 已在
  `handleSend`（`src/webview/assistant/App.tsx:271-283`）拦截：
  输入 `/compact` 回车不发给 CLI，而是走与 Compact 按钮相同的
  `session.compact` RPC。**但它不出现在 `/` 弹窗里**，用户不知道
  它存在。
- 弹窗可见性 `slashVisible`（Thread.tsx:1701-1704）依赖命令目录
  状态；渲染只有一节（catalog 命令 + 空态行，Thread.tsx:1833-1882）。

### 设计：弹窗加 "Built-in" 一节

盘点 webview 现有真实动作（`App.tsx` 的 post 清单），适合收进
slash 的只有明确"输入一句话执行一个动作"的：

| 命令 | 行为 | 现有通道 |
| --- | --- | --- |
| `/compact` | 压缩当前会话上下文 | 已有拦截（App.tsx:278）+ `session.compact` |
| `/new` | 新建会话 | `session.new`（App.tsx:463，Header 按钮同款） |

`/fork <title>`（`session.fork` 需要标题参数）可以作为候补，但
fork 在 UI 里有带输入框的入口，slash 带参数解析的收益低，第一版
不做。设置类（autonomy/reasoning/spec）是持续状态而非动作，不适合
slash。**不发明 Droid 能力，以上全部是 GUI 已有通道。**

实现方案：

1. `Thread.tsx`（~60-80 行）：新增 `BUILT_IN_COMMANDS` 常量
   （name/description，如 `compact — Summarize earlier messages
   to free context`、`new — Start a new session`）；弹窗渲染
   "Built-in" 小节（置于自定义命令之上，加节标题样式），
   `slashVisible` 不再依赖 catalog 状态（内建节恒可见，自定义节
   保留 loading/error/空态行）；键盘上下移动跨两节统一索引。
   选中内建命令仍走现有 `selectCommand`（补全为 `/compact ` 文
   本），回车后由 handleSend 拦截执行——执行逻辑集中一处。
2. `App.tsx`（~10 行）：handleSend 拦截正则从 `/compact` 扩展为
   `/new`（调 `handleNewSession`）。
3. `styles.css`（~10 行）：节标题样式。
4. 测试：`Thread.test.tsx` 现有 12 处 slash 相关断言需适配
   （空目录时弹窗不再只有空态行），新增内建命令过滤/回车执行
   两条用例。

### 优先级建议

高。改动全在 Webview 层（无 Bridge/Runtime 变更），是四项里
收益/成本比最高的。

---

## 3. 编辑卡下提示行删除

### 现象

编辑卡外下方的 "Resending starts a new conversation branch from
this message." 提示行，用户明确要求删掉。无需调查，记录为确定
修改项。

### 改动面

- `src/webview/assistant/Thread.tsx:927-930`：删除
  `dvx-user-edit-hint` 元素。
- `src/webview/assistant/styles.css:1904-1911`：删除
  `.dvx-user-edit-hint` 规则；`styles.css:4854`：从响应式选择器
  组里删掉该行。
- 测试：`rg` 确认没有任何测试引用该文案或类名，无需改测试。

量级：两文件 ~14 行删除。

### 优先级建议

高（确定项，顺手即做）。

---

## 4. Compact 后看不到之前的消息

### 现象

compact 走 `session.compact` RPC 后 GUI 切到 continuation 会话，
转录里旧消息只剩摘要 + "Conversation compacted: N earlier messages
summarized." 分隔卡。用户问：算不算 bug？能否像 Cursor 那样看到
全部历史，但要符合 Droid 机制。

### 现状机制（这是设计使然，不是 bug；但"找回历史"有真实通道）

Droid compact 的真实会话关系（本机实测证据，2026-08-12 12:34 的
那次 compact，`runtime.compact.finished durationMs=26905 success`）：

- 原会话 `577820f5` 的 `.jsonl`（146 KB）**原样保留在磁盘**，
  settings 里**没有 `archivedAt`**——它仍会出现在 `listSessions`
  结果里（SDK `node.mjs` `parseSessionFile` 会跳过 archived 会话，
  该会话未被跳过）。
- 新 continuation 会话 `7472d2d9` 的 `.jsonl` 首行 `session_start`
  **带 `"parent": "577820f5-…"` 字段**，第二行是
  `compaction_state`（含完整 `summaryText`）。即 **Droid 自己在
  磁盘上记录了父子关系**。
- 但 SDK 的公开投影不透出它：`CompactSessionResult` 只有
  `{ newSessionId, removedCount }`
  （`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts:35016`），
  `SessionMetadataSchema` 无 parent 字段（同文件 :105497；
  `node.mjs` :4016-4046 `parseSessionFile` 重建固定键、丢弃了
  passthrough 的 `parent`）。`loadSession` 返回也只有 messages
  本身。
- 不过 GUI 侧**根本不需要 SDK 透出**：compact 时我们自己就知道
  原会话 id（`FactoryDroidRuntime.compact()` 换 session 前的
  `session.id`，`src/runtime/FactoryDroidRuntime.ts:632-693`；
  `performCompact` 的入参 `sessionId`，
  `src/extension/ChatController.ts:1753`）。对于重启后才恢复的
  continuation 会话，也可由 Host 直接读会话文件首行拿 `parent`
  （目录规则 `sessionFavorites.defaultSessionsDirectory()` 已有）。
- 现状还有一个反向坏味道：`performCompact` 主动把原会话从会话
  列表里过滤掉（ChatController.ts:1808-1811），用户想手动翻旧
  会话都翻不到（直到下次全量刷新目录才回来）。

### 方案（两个，均基于真实机制）

**方案 A（推荐）：压缩分隔卡加 "View full history" 跳转原会话。**

- Host：`performCompact` 把原 `sessionId` 记进
  `session-compacted` 诊断（Bridge 的 diagnostic 消息加一个可选
  `relatedSessionId` 字段），并**停止从列表里过滤原会话**（改为
  正常显示，标题可加后缀标识）；重启恢复场景由 Host 读
  continuation 会话文件首行的 `parent` 补齐。
- Webview：`CompactDivider`（Thread.tsx:1358-1390）渲染
  "View full history" 链接，点击发已有的 `session.select`
  切到原会话浏览（它是普通可恢复会话，天然只读——用户真在里面
  发消息也只是 Droid 允许的分叉，不破坏机制）。
- 改动面：bridgeMessages/validateHostMessage ~10 行、
  ChatController ~30 行、FactoryDroidRuntime ~10 行（compact 返回
  值带 previousSessionId）、Thread.tsx ~20 行、测试若干。
- 取舍：跳转是"离开当前会话去看历史"，不是原地展开；但零风险、
  完全顺着 Droid 的会话模型。

**方案 B：转录顶部懒加载拼接 pre-compact 历史。**

- 在压缩分隔卡上方加 "Show earlier messages"，点击后 Host 用
  `loadSession(parent)` 读原会话，把投影结果以只读段前插到当前
  转录顶部（视觉上加"历史（已压缩出上下文）"分隔）。
- 改动面明显更大：Host 需要第二条只读历史加载路径与缓存、
  messageId/toolUseId 与当前会话潜在重复需加命名空间（正是
  2026-08-11 白屏事故的雷区，见 log-analysis-playbook §5.1）、
  recovery 检查点必须排除拼接段、超长转录的性能都要处理。
  体验最接近 Cursor（原地看全史），但工程风险和量级是 A 的
  数倍。

推荐 **A 先行**（一个切片内可完成，立即回应"能不能看到"），B 作
为后续体验增强单独立项。

### 优先级建议

中。A 方案建议排在 1/2/3 之后同批或紧随其后交付。

---

## 汇总

| # | 定性 | 层 | 量级 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | UX 缺陷 + 三条静默失败路径 + 零埋点（根因未能从日志钉死） | Webview + Host + Bridge | ~85 行 | 高 |
| 2 | 设计缺口（内建命令不可见） | Webview | ~90 行 + 测试 | 高 |
| 3 | 确定删除项 | Webview | ~14 行删除 | 高 |
| 4 | 设计使然，非 bug；推荐方案 A（分隔卡跳转原会话） | 全四层 | ~70 行 | 中 |
