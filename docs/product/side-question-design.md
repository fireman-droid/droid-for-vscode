# `/btw` 侧边提问（Side Chat）设计

> 状态：**设计待实现**（调研 + 设计，未改生产代码）。
>
> 调研日期：2026-08-12。调研对象：Claude for VSCode "Side question"
> 面板截图、本机 `droid.exe` 0.193.0 二进制字符串、
> `node_modules/@factory/droid-sdk`（node.d.ts / index-D_SzTnFR.d.ts）、
> 官方文档 `docs.factory.ai/droid-cli/cli-reference`、本仓库
> `ChatController` / `FactoryDroidRuntime` / `/` 弹窗现有实现。
> 二进制取证转储在 `artifacts/btw-*.txt`（git 忽略，本地留证）。
>
> 姊妹文档：`slash-parity-assessment.md`（`/` 命令全量对齐评估，
> `/btw` 在其中列为价值最高的补齐切片）。

## 0. 结论速览

**droid CLI 本身原生内置 `/btw`**（"Ask in Side Chat without
polluting the main transcript"），且它的全部底层机制都走**公开
stream-jsonrpc RPC**：`/btw` = 对主会话做一个**隐藏 fork**（fork 点
`lastCompletedTurn`、tag `btw-fork`、会话文件落在 `sessions/btw/`
子目录、不建云端会话），问题经 `addUserMessage` 发进 fork，答案经
会话通知流回来；fork 每主会话一个、多问题复用；直接 resume 该
fork 时 CLI 会把它**升格**为正式会话（`promoteBtwSessionIfNeeded`）。

因此本设计**不发明任何能力**：GUI 复刻 CLI 语义——侧问**自带主会话
完整上下文**（fork 语义，回答"跟当前工作相关的快问题"正是本场景
核心），主会话（含正在跑的 turn）零打扰。Host 侧不动 ChatController
的单会话绑定，新增一个独立的 **btw sidecar**（沿用
`FactoryCommandCatalog` / `FactorySessionHistoryLoader` 已验证的
短生命周期公开 client 模式）。UI 是**与主对话并排共生的全高
"Side question" 分栏**（Claude Code 同形态；用户两次拍板
2026-08-12 晚，先推翻首版 Composer 上方卡片、再推翻二版右缘
抽屉，见 §4.2 决策记录）。

## 1. 参考形态与需求

Claude for VSCode 截图（用户提供）：主对话在左侧继续流式跑，右侧
"Side question" 面板提示 *"Ask a quick side question below without
interrupting the conversation"*，底部独立输入框 "Ask a side
question"。要点：主会话不中断、独立小会话、可连续追问、关掉即弃。

需要回答的设计问题（用户原话）：

1. 侧会话**带不带主会话上下文**——Claude 似乎是独立的；我们的选项：
   纯新会话 / 注入最近 N 条摘要 / （调研后新增）原生 btw fork。
2. Host 侧一个 ChatController 能不能带第二个轻量会话，还是走
   sidecar 直接 RPC。
3. 窄侧栏下的 UI 形态。
4. 第一切片与改动面。

## 2. 决定性证据：droid CLI 原生 `/btw`

### 2.1 命令存在性（三处互证）

- 官方 CLI Reference 斜杠命令表：`/btw <question>` — "Ask a side
  question without polluting the main transcript"。
- `droid.exe` 0.193.0 命令注册表（`Ot$` 元数据映射，
  `artifacts/btw-cmdmeta.txt`）：
  `btw:{name:"btw",description:"Ask in Side Chat without polluting
  the main transcript",category:"session"}` ——官方名词是
  **Side Chat**。
- TUI i18n 字符串：`btwHint:"ask a side question without
  interrupting droid"`、`btw:{scrollTitle:"/btw history", …,
  answerLabel:"Answer", answering:"Answering…", noAnswer:"(no
  answer)"}`、`emptyHint:"Type \`/btw <question>\` to ask a question
  in the middle of a session."`。

### 2.2 底层机制（`BtwManager`，二进制反汇编字符串）

CLI 源文件路径可见于打包产物：`src/services/btw/BtwManager.ts`。
关键片段（`artifacts/btw-dir.txt` / `btw-consts.txt`）：

1. **隐藏 fork**（每主会话一个，懒创建、复用）：

   ```
   ensureFork() … GH("[BtwManager] Creating hidden /btw fork",
     {sessionId:this.mainSessionId});
   let $=await H.forkSession(this.mainSessionId, UZL, DP8,
     this.mainSessionId, "btw", {...rZL, extraTags:[{name:Dj}]});
   ```

   其中常量：`Dj="btw-fork"`（tag 名，与 mission-orchestrator /
   mission-worker / subagent / exec 同一 `decompSessionType` 枚举
   家族）、`DP8="/btw side conversation (hidden)"`（fork 标题）、
   `UZL={kind:"lastCompletedTurn"}`（**fork 点 = 最后一个已完成
   turn**，这正是"主 turn 运行中也能问"的实现基础）、
   `rZL={skipRemoteCreation:!0, preserveCurrentSession:!0,
   useBtwDirectory:!0}`（不建云端会话、主会话原样保留、fork 的
   `.jsonl` 落在 `sessions/btw/` 子目录）。

2. **目录隔离**：`getBtwSessionsDirectory(){return
   bU.join(this.sessionsDir,"btw")}`。btw fork 不进常规会话目录，
   CLI `/sessions` 与 daemon 列表默认都看不到（daemon 的
   `DaemonListOpenedSessions/ListAvailableSessions` 请求带
   `filter.includeBtwForks?: boolean`，SDK
   `index-D_SzTnFR.d.ts` L52894–52934，默认排除）。

3. **提问与回答**：`ensureFork` 后
   `loadSession({sessionId:fork})` + `subscribeToSessionNotifications`
   订阅通知，提问走 `addUserMessage({sessionId:fork, text})`；
   条目状态机 `streaming → done/error`，TUI 只渲染问题 + Answer
   文本（`/btw history` 滚动视图，↑↓ 导航、Ctrl+X 删除条目）。

4. **关闭即收**：`teardownFork()` 退订 + `closeSession(fork)`。
   fork 的 `.jsonl` 留在 `sessions/btw/`（历史可查，不占列表）。

5. **升格为正式会话**：daemon `handleLoadSession` 内调用
   `promoteBtwSessionIfNeeded(sessionId)`——若目标会话的 `.jsonl`
   在 btw 目录，则搬回常规目录（`artifacts/btw-dir.txt` 第 6–7
   段）。即"侧聊有价值 → resume 它就变成正式会话"是 **CLI 原生
   语义**，GUI 无需发明。

### 2.3 公开通道核实（GUI 能不能走同一条路）

**能，子进程与 daemon 双通道都公开：**

- **子进程 stream-jsonrpc 服务端原生识别 btw tag**。
  `droid.fork_session` 处理器（`artifacts/btw-mh.txt` 第 5 段）：

  ```
  handleForkSession(H){ … let I=H.params?.tags,
    M=t&&I.some((n)=>n.name===Dj),        // 检测 "btw-fork" tag
    u={preserveCurrentSession:!0, …, ...M?rZL:{}},
    P=await $.forkSession(L, M?UZL:{kind:"wholeTranscript"}, f, L,
      M?"btw":"fork", u); … {newSessionId:P} }
  ```

  也就是说：**只要 fork 请求的 `tags` 含 `{name:"btw-fork"}`，
  服务端自动走完整 btw 语义**（lastCompletedTurn fork 点 + btw
  目录 + 不建云会话）。GUI 不需要私有参数。

- SDK 公开面（`node.d.ts`）：低层
  `DroidClient.forkSession(params?: {title?, tags?})`（L340）、
  `DroidClient.addUserMessage(params)`（L283）、高层
  `DroidSession.fork(params?: ForkSessionRequestParams):
  Promise<DroidSession>`（L677）。`ForkSessionRequestParamsSchema =
  { title?, tags?: {name, metadata?}[] }`
  （`index-D_SzTnFR.d.ts` L35230–35254）。
- daemon 通道：`daemon.fork_session` 参数
  `{sessionId, title?, tags?}` → `{newSessionId}`
  （`index-D_SzTnFR.d.ts` L60734–60768）；daemon 处理器把 tags
  透传给会话子进程并登记（`artifacts/btw-mh.txt` 第 3 段）。

**注意**：高层 `DroidSession.fork()` 会**把当前会话句柄原地替换为
fork**（本仓库 `FactoryDroidRuntime.fork()` 正是利用该语义做
"Fork 并切换"，`src/runtime/FactoryDroidRuntime.ts` L758–812）。
所以主 runtime 的 session 对象**不能**直接用来做 btw fork——必须在
sidecar 里做（§5）。

## 3. 设计裁决：侧会话带不带主会话上下文

| 选项 | 成本 | 价值 | 判定 |
| --- | --- | --- | --- |
| a. 纯新会话（Claude 形态） | 最低；`sessions.create` 即可 | 答不了"跟眼前工作相关"的快问题，用户得手动粘贴上下文 | 弃 |
| b. 注入最近 N 条摘要作首条消息前缀 | 要自建摘要管线（选哪些消息、多长、截断策略），且摘要质量不可控、每次侧聊都要重付摘要 token | 半吊子上下文 | 弃 |
| c. **原生 btw fork**（CLI 语义） | 一次 fork RPC；上下文完整且与 CLI 行为逐字一致 | 完整上下文；主 turn 运行中可用（lastCompletedTurn）；免摘要管线 | **采用** |

成本如实说明：fork 的每个侧问都是一次**满上下文** turn，token
成本与主会话同长度 turn 相当（Claude 的独立面板几乎零上下文成本）。
这是 CLI 原生权衡，我们照抄并在 UI 上不做任何遮掩；真想问无关
问题的用户可以直接新建会话（GUI 已有 `/new`）。不为此加
"无上下文模式"开关——保持最小面。

与 Claude 形态的偏差声明：Claude 是"独立小会话"，我们是"带上下文
的隐藏 fork"。这是**有意偏差**，依据是 CLI 原生语义 + 本产品用户
就是 droid 用户，两端行为一致比模仿 Claude 更重要。

## 4. 产品形态（窄侧栏适配）

### 4.1 入口

- **Composer 输入 `/btw <问题>` 回车**：webview `handleSend` 拦截，
  模式与既有 `/compact`、`/new` 完全一致
  （`src/webview/assistant/App.tsx` L305–325）。带问题文本则直接
  开卡并提交；只输入 `/btw` 则只开卡。
- **`/` 弹窗 Built-in 组新增一行** `btw — Ask a side question`
  （`Thread.tsx` `BUILT_IN_COMMANDS`，L2396–2402），选中补全为
  `/btw `。
- 不加 `+` 菜单入口、不加常驻按钮（UI restraint：斜杠入口已够，
  等真实使用反馈再说）。

### 4.2 形态：与主对话并排共生的 "Side question" 分栏

**决策记录（2026-08-12 晚，用户两次拍板）**：

1. 首版按下方原候选 A（Composer 上方卡片，复用 `ComposerPopup`
   壳）交付后，用户对照真机判定形态做错——"我都说做成 claude
   那样，右边出现一个 side question"。展现层重做为右缘滑入的全高
   面板 + 遮罩（提交 `aaaca96`）。原候选讨论保留在 git 历史
   （d4a4fbc 版本）。
2. 用户对照 Claude Code 截图再次纠正：**"btw 并不是抽屉组件，他
   就是右边分了一块区域给 btw，它是共生的"**——不是浮层，是
   split-pane。提交 `62e0e1c` 把 overlay/遮罩模型改为双栏网格：
   两栏同时可交互，主对话不被盖住也不缩成窄边。两轮重做中隐藏
   fork / deny-all 权限 / 关闭即弃 / 会话切换清理 / Bridge 契约
   全部不动。

最终形态（`SideChatSheet.tsx`，App 根级挂载，不再走 Composer 的
`sideChat` 槽）：

- **双栏网格**：`/btw` 打开时 shell 加 `dvx-shell-split`，
  `grid-template-columns: minmax(0, 1fr) auto`——Header、
  握手提示、`.dvx-thread` 显式放第 1 列，`.dvx-btw-panel` 占第 2
  列并跨全部行（含 Header 行，同 Claude）。**没有遮罩、没有"点
  外面关闭"**（分栏没有"外面"）；主对话（转录、Composer、发消息、
  流式、吸顶、计划锚卡、滚动箭头）在变窄的左栏内照常工作，两栏各自
  独立滚动。
- **右栏宽度**：`min(max(42vw, 200px), 420px, calc(100vw -
  110px))`——常规宽约 42%，下限 200px，极窄时让出主栏至少约
  110px（320px 视口实测右栏 200px / 主栏 120px），**永不回退成
  浮层**。左缘 1px 分隔线，面板保持 raised 白渐变卡面（去掉了
  抽屉时代的左投影——共面元素不该悬浮）。
- **开合动画**：宽度从 0 展开 200ms / 收合 200ms（子元素
  `min-width` 锁定在稳态宽度避免动画中途换行，`overflow: hidden`
  裁切）；`prefers-reduced-motion` 禁用。
- **面板结构**（自上而下，不变）：
  1. 安静标题行：`Side question`（12px/650）+ 右上 `×`；
  2. muted 斜体提示语（对照 Claude 原文）："Ask a quick side
     question below without interrupting the conversation."；
  3. Q&A 转录区（flex:1 内部滚动，`overscroll-behavior:
     contain`）：问题行加粗 + 答案 Markdown（复用
     `MarkdownText`，streaming shimmer / 安静错误行不变）；
  4. **输入行钉在面板底部**：框式单行输入（raised 白底、1px 边框、
     accent 聚焦环）+ 自带 accent 发送按钮（↑，空文本禁用），
     Enter 或点击发送。
- 空态 = 标题 + 提示语 + 底部输入框（对照 Claude 截图二）。
- 关闭路径：`×`、Esc、会话切换——语义仍是关卡即弃 fork。

主 Composer、主转录完全不动；主 turn 的流式渲染不受影响，且
分栏打开时主 Composer 仍可编辑、发送（冒烟有断言）。

### 4.3 生命周期

- 关卡（`×` / Esc / 会话切换 / 新建会话）：Host `teardownFork`
  （closeSession fork），条目内存态即弃——与 CLI 一致，fork jsonl
  留在 `sessions/btw/`，不进任何列表。
- 重开卡：新 fork（fork 点自动是最新的 lastCompletedTurn，比复用
  旧 fork 的过期上下文更符合直觉；CLI 在同一 TUI 进程内复用 fork，
  但它的 fork 也停留在创建时刻的上下文——我们选择"每次开卡新
  fork"，语义更清晰，代价是多一次 fork RPC）。
- "保留为正式会话"（**不进第一切片**）：卡片标头加 "Promote"
  动作 → 走既有 `session.select` 流程 resume 该 fork id。daemon
  模式下加载即原生升格（§2.2-5）；子进程模式的升格行为需探针
  P3 实证后再开这个入口。

## 5. Host / Runtime 架构

### 5.1 为什么不动 ChatController 的会话绑定

`ChatController` 是严格单会话模型：单 `runtime`、单 `sessionId`、
单 transcript 状态机、单 `sequence`/`runtimeGeneration`
（`src/extension/ChatController.ts` L377–415）。把第二个活跃会话
塞进去意味着 transcript 对账、interaction 协调器、诊断、恢复快照
全部要按会话分叉——改动面失控。**否决。**

### 5.2 采用：独立 btw sidecar（短生命周期公开 client 模式）

与 `FactoryCommandCatalog`（`src/runtime/commands/`，
slash-commands-design §4.2）和 `FactorySessionHistoryLoader`
（`src/runtime/history/`）同一模式——这条"主会话子进程之外再起
一个公开 client"的路已被两个生产功能验证（含主 turn 运行中并发
读取同一会话）。新增 `src/runtime/btw/BtwSidecar.ts`：

```ts
export interface BtwSidecar {
  /** Fork the main session with the btw-fork tag; idempotent. */
  ensureFork(): Promise<string>; // fork session id
  /** Streams one side question; yields text deltas then done. */
  ask(text: string): AsyncGenerator<BtwAnswerEvent>;
  dispose(): Promise<void>; // closeSession + transport close
}
```

流程（默认 `process` 运行模式）：

1. `new ProcessTransport({cwd})` → `DroidClient` →
   `loadSession({sessionId: 主会话 id})`（只读加载，历史加载器
   同款）；
2. `forkSession({ title: 'DroidVisX side chat', tags:
   [{name:'btw-fork'}] })` → `newSessionId`（服务端自动走 btw
   语义，§2.3）；
3. 对 fork 发问、收流：候选链路两条，开工第 1 步用探针 P1 定夺——
   (a) 同一 client `loadSession({sessionId:newSessionId})` 切换后
   `addUserMessage` + 通知订阅（CLI 同款）；(b) 关掉该 client，
   用高层 `resumeSession(newSessionId)` 拿 `DroidSession.stream()`
   （流式消费与主 runtime 同构，代码更少）。
4. `dispose()`：closeSession + transport close，错误路径同样
   close（吞 close 失败）。

daemon 运行模式（`droidvisx.runtime.mode = daemon`，默认关）：
第一切片直接报 `unsupported`（fail closed，文案指向 process
模式）；后续增量用 `daemon.fork_session` + 既有 daemon 会话工厂
（`createDaemonDroidSession.ts`）补齐。

### 5.3 Host 集成（ChatController 内薄薄一层）

不建新 controller：`ChatController` 持有 `btwSidecar:
BtwSidecar | null` + 有界条目数组，处理三条新 Bridge 消息（§5.4），
在以下时机强制 `dispose`：会话切换 / 新建 / Fork / Compact /
Rewind 收养 / runtime 重建 / webview 销毁（与 skills/commands
缓存失效时机一致）。侧问流式事件经现有 `postMessage` 序列下发，
不进主 transcript、不进恢复快照（卡片即弃语义）。

### 5.4 Bridge 契约草案（对称校验照 skills/commands 模式）

```ts
export const MAX_BTW_TEXT_LENGTH = 4000;      // 与 MAX_TURN_TEXT 对齐
export const MAX_BTW_ENTRIES = 20;            // 卡内条目上限
export const MAX_BTW_ANSWER_LENGTH = 32000;   // 有界投影，超长截断

// Webview → Host
{ type: 'btw.ask'; sessionId: string; text: string }
{ type: 'btw.dismiss'; sessionId: string }

// Host → Webview（整卡状态快照，含 sequence）
{ type: 'session.btw'; sequence: number; sessionId: string;
  btw: { status: 'idle'|'forking'|'ready'|'error'|'unsupported';
         entries: readonly {
           id: string; question: string;
           answer: string;               // 累计文本，有界
           state: 'streaming'|'done'|'error' }[];
         message?: string } }
```

校验：`validateMessage.ts` 加 `parseBtwAsk/parseBtwDismiss`
（`hasExactKeys` + `isId` + 长度上限）；
`validateHostMessage.ts` 加 `parseSessionBtwMessage`（各 status
分支 `hasExactKeys`、entries `isExactArray(0, MAX_BTW_ENTRIES)`、
逐字段长度上限、id 去重拒收）。

## 6. 边界与降级

- **主 turn 运行中提问**：允许（这就是卖点）。fork 从磁盘 jsonl
  的 lastCompletedTurn 切分，主子进程不被打扰（历史加载器已证明
  并发读安全）。
- **侧问 streaming 中再提问**：第一切片直接禁发（mini 输入行
  disabled + "Answering…"），不建队列——CLI 也是逐条的。
- **fork 内权限请求 / AskUser**：侧卡不渲染权限卡（那是主聊的
  交互面）。第一切片策略：sidecar 的 handler 对权限请求一律
  **拒绝并中断该条目**，条目落 error 态，文案引导"需要工具权限的
  问题请在主对话问"。探针 P2 先看 CLI 对 btw fork 里权限请求的
  真实行为，若 CLI 有更优雅的原生策略则照抄。
- **会话列表污染**：daemon 列表默认排除（`includeBtwForks`）；
  子进程 `listSessions`（`FactorySessionCatalog`）按证据推断不会
  扫 `sessions/btw/` 子目录，探针 P3 实锤（顺带验证子进程模式
  resume 是否也触发升格）。若泄漏，Host 侧按 tag `btw-fork`
  过滤兜底（tag 在 fork 参数里，是公开字段）。
- **新建会话尚无 session id / 连接未就绪**：`/btw` 拦截后提示
  先等会话就绪（与 commands.refresh 守卫一致）。

## 7. 第一切片定义（最小闭环）

**切片**：Composer `/btw <问题>`（含 `/` 弹窗 Built-in 行）→
Side chat 卡片打开 → sidecar 创建隐藏 fork → 答案流式渲染 →
可连续追问 → 关卡即弃。process 模式 only，daemon 模式
unsupported；无 Promote、无附件、无历史回看。

**可观察完成标准**：

1. 主会话正在跑一个长 turn 时 `/btw 这个报错是什么意思`，答案在
   侧卡流式出现，主转录**零新增行**、主 turn 不中断；
2. 关卡后：GUI History 抽屉、CLI `/sessions`、daemon 列表均看
   不到该 fork；`~/.factory/sessions/<project>/btw/`（或对应
   路径）下能看到 fork jsonl；
3. 断言 fork 请求带 `tags:[{name:'btw-fork'}]`（诊断日志）；
4. 320px 宽度无横向溢出；reduced-motion 下无动画;
5. 全量测试 + typecheck + 打包 + Cursor 实机验收。

**开工前探针**（`artifacts/`，实证后再动生产代码）：

| # | 问题 | 方法 |
| --- | --- | --- |
| P1 | 子进程链路选型：同 client loadSession 切换 vs resumeSession 高层流 | 探针脚本对 fork 走两条链路各发一问 |
| P2 | fork 内权限请求行为（CLI 原生策略） | 低 autonomy + 必触发权限的问题，观察通知流 |
| P3 | 子进程 `listSessions` 是否泄漏 btw fork；子进程 resume 是否触发升格 | fork 后调 listSessions / loadSession 观察 |

## 8. 改动面预估

| 层级 | 文件 | 改动 | 规模 |
| --- | --- | --- | --- |
| Shared | `bridgeMessages.ts` / `validateMessage.ts` | 3 条消息 + 常量 + 校验 | ~120 行 |
| Webview bridge | `validateHostMessage.ts` | `parseSessionBtwMessage` | ~80 行 |
| Runtime | `src/runtime/btw/BtwSidecar.ts`（新） | fork + ask 流 + dispose | ~200 行 |
| Host | `ChatController.ts` | btw 消息分支、生命周期挂钩、有界投影 | ~150 行 |
| Webview | `store.ts` / `App.tsx` | btw 状态 + `/btw` 拦截 | ~80 行 |
| Webview | `SideChatSheet.tsx`（新）+ `Thread.tsx` + `App.tsx` | 右缘面板组件（App 根级挂载）、Built-in 行 | ~260 行 |
| Webview | `styles.css` | `dvx-btw-*`（追加，遵守轻奢视觉基线） | ~90 行 |
| 测试 | 各层 `.test.ts(x)` | 校验/守卫/生命周期/组件 | ~500 行 |

合计约 1,400–1,500 行级，单切片可交付。风险集中在 P1–P3 探针
结果；Bridge/UI 部分全部有同构先例（skills/commands/mention
弹窗），属于低风险复刻。
