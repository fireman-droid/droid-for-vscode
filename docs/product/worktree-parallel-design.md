# Worktree 并行任务设计（V2）

> 状态：设计完成，待排期。撰写日期 2026-08-12。
> 格式遵循 `message-card-design.md` 约定。

## 0. 结论速览

| 子能力 | 可行性 | 通道 |
| --- | --- | --- |
| 创建 worktree | **全可行** | Host 侧 spawn `git worktree add`（仓库已有 execFile git 先例） |
| 在 worktree 中开 Droid 会话 | **全可行**（daemon 模式） | daemon `sessions.create({ cwd })`；SDK 另有原生 `worktree: true` 参数可整体替代（证据 §2.1） |
| 会话 ↔ worktree 绑定展示 | **全可行** | Host 侧元数据 + 会话列表 quiet 标注 |
| 清理 worktree（防呆） | **全可行** | `git worktree remove`（git 默认拒删 dirty，Host 再加前置检查双保险） |
| 多根工作区路由 | **范围外** | 与 `daemon-feature-opportunities.md` A5 的判缓一致，本项不做 |

四项核心能力全可行，无需降级。前提：会话创建走 daemon 模式（
private/shared 旧模式不在本项范围，入口在非 daemon 模式下隐藏）。

## 1. 需求与范围

用户诉求：让 Droid 在独立目录里改另一个分支，不动眼前正在编辑的
代码。即「创建 worktree + 在其中开会话 + 用完清理」的最小闭环。

范围外（与 A5 判缓边界对齐）：

- 把 worktree 加入 VS Code 多根工作区、跨根文件路由；
- worktree 之间的 diff/merge 工作流（用户在 git 里自理）；
- 自动同步主工作区未提交改动到 worktree；
- 非 daemon 模式支持。

## 2. 能力证据

### 2.1 SDK / CLI

来源：`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`：

- L36348–36354：`sessions.create` 参数含 `worktree?: boolean` 与
  `worktreeDir?: string`，JSDoc 明示回退到用户 `worktreeDirectory`
  设置（settings schema L66607 同名字段）——daemon 有**原生建
  worktree 开会话**的一体化通道。
- L26087：`InitializeSessionResult` 含 `worktree` 对象（`path`、
  `branch`、`isNewlyCreated`、`repoRoot`）——会话初始化结果自带
  worktree 元数据，绑定展示可直接取自权威来源。
- `sessions.create` 同时支持显式 `cwd`（
  `src/runtime/daemon/createDaemonDroidSession.ts` 已在生产使用
  cwd 传参），即「Host 自建 worktree + cwd 指进去」的组合通道
  同样成立。
- CLI 一手对照：`droid exec --worktree/-w`、`--worktree-dir`
  存在，与 SDK 参数一致（本机 0.193.0 help 面核实）。

### 2.2 Host 侧 git 封装先例

- `src/extension/changeStats.ts`：`execFile('git', [...])` 已是
  仓库惯例；`git worktree add/list/remove --porcelain` 输出稳定、
  易解析，无需引第三方库。
- `git worktree remove` 对含未提交改动的 worktree 默认拒绝（git
  自身行为），`--force` 才会删——设计中**不提供 force**，天然
  防呆底线。

### 2.3 通道选型

两条路都成立，选 **daemon 原生 `worktree: true`** 为主通道：一次
RPC 完成「建 worktree + 开会话」，分支命名/目录规约与 CLI 行为
一致，且 `InitializeSessionResult.worktree` 直接回权威元数据，
Host 不必自己拼装状态。Host spawn `git worktree add` 仅用于**清理
与列表**（`list`/`remove`，SDK 无对应 RPC）。这样创建走官方语义、
运维走本地 git，各取其长，无重复建设。

## 3. 分层设计

### 3.1 创建流程

1. 入口：SessionDrawer 新建会话区域加一个 quiet 文本选项
   「在 worktree 中新建…」（遵守 UI restraint：与既有新建入口同级
   的弱化文本，无新彩色元素；非 daemon 模式或工作区非 git 仓库时
   不渲染）。
2. 点击 → 内联输入分支名（预填 `droid/<日期>-<序号>`，可改）。
3. Host 走 `sessions.create({ worktree: true, worktreeDir?, ... })`
   （目录遵循用户 `worktreeDirectory` 设置的回退链，不另造规约）。
4. 成功后从 `InitializeSessionResult.worktree` 取 `path`/`branch`
   存入该会话的 Host 侧元数据，随会话列表数据下发 Webview。

### 3.2 绑定展示

- 会话列表该行标题下追加一行 quiet 次级文本：
  `worktree · <branch>`（复用现有次级信息的字号与颜色，不加徽章
  底色——符合视觉克制与轻奢基调：信息以排版层级表达，不靠色块）。
- 会话详情/抽屉展开处显示完整路径，提供「在文件管理器中显示」
  （`vscode.env.openExternal(file://)` 或 `revealFileInOS`）。

### 3.3 清理流程

- worktree 会话行的溢出菜单加「移除 worktree…」：
  1. Host 先 `git -C <path> status --porcelain`：非空 → 拒绝并
     返回可读提示「该 worktree 有未提交改动，请先提交或丢弃」，
     **不提供强制选项**；
  2. 会话仍在运行 → 拒绝（先结束会话）；
  3. 通过后 `git worktree remove <path>`（不带 `--force`，git 层
     二次兜底）；分支本身不删（用户可能还要用，删分支是范围外）。
- 会话与 worktree 生命周期解耦：删会话不删 worktree（提示遗留
  路径），删 worktree 必须先无活动会话。

### 3.4 Bridge 契约（切片 A 冻结范围）

| 方向 | 消息 | 载荷 |
| --- | --- | --- |
| W→H | `worktree.createSession` | `{ branch: string }` |
| H→W | 会话列表条目扩展 | `worktree?: { branch, path }`（可选字段，向后兼容） |
| W→H | `worktree.remove` | `{ sessionId }` |
| H→W | `worktree.removeResult` | `{ ok: true } \| { ok: false, reason: 'dirty' \| 'sessionActive' \| 'gitError', detail? }` |

### 3.5 路径安全（重要边界）

worktree 会话的文件事件路径以 worktree 根为锚。现有 diff 打开、
附件路径校验以主工作区根做越权校验——第一切片对 worktree 会话的
「打开 diff」入口**降级禁用**（hint：「文件位于 worktree，请在
对应目录查看」），避免路径校验被绕过；完整的双根锚定放切片 B。

## 4. 边界与失败路径

| 情形 | 行为 |
| --- | --- |
| 非 daemon 模式 | 入口不渲染（fail-closed，不提示半可用） |
| 分支名已存在 / 非法 | `sessions.create` 报错原样映射为一行可读失败；不自动改名重试 |
| worktree 目录被用户手动删除 | 会话行标注失效态（路径检查 fail-soft）；清理动作改为 `git worktree prune` 提示文本 |
| dirty worktree 清理 | 拒绝 + 可读提示；无 force 路径 |
| 会话运行中清理 | 拒绝；先停会话 |
| 主仓库不是 git 仓库 / 裸仓库 | 入口不渲染 |
| worktree 内会话的 diff/附件 | 切片 A 禁用 diff 打开（见 §3.5），附件仍按现行校验（主根外路径本就拒绝） |

## 5. 切片划分与第一切片

- **前置探针（半天内，放 `artifacts/`）**：核实
  `sessions.create({ worktree: true })` 在本机 0.193.0 daemon 的
  真实行为——目录落点、分支命名、`InitializeSessionResult.worktree`
  实际载荷；探针通过前 Bridge 契约不冻结。
- **切片 A（第一切片，一天内可交付，含探针）**：§3.1 创建 + §3.2
  列表标注（不含清理）。可观察完成标准：真实 Cursor 中从
  SessionDrawer 用分支名建 worktree 会话，`git worktree list` 可见
  新条目，会话列表显示 `worktree · <branch>`，在该会话让 Droid 改
  一个文件，`git -C <worktree> status` 显示改动而主工作区无变化。
- **切片 B**：§3.3 清理闭环 + 失效态检测 + diff 双根锚定。
- **切片 C（可选）**：worktree 会话完成后的「回主仓库开 PR」联动
  （衔接 `git-pr-workflow-design.md` 切片 C）。

## 6. 改动面预估（切片 A）

| 层 | 改动 | 量级 |
| --- | --- | --- |
| Runtime | `createDaemonDroidSession` 传参扩展（worktree 选项透传） | 小（~30 行） |
| Bridge | 1 条 W→H 消息 + 会话条目可选字段 | 小 |
| Host | 会话创建接线 + worktree 元数据存取 | 中（~100 行） |
| Webview | SessionDrawer 入口 + 分支名输入 + 列表次级文本 | 中（~120 行） |
| 探针 | `artifacts/` worktree 创建行为核实脚本 | 小 |

## 7. 可观察验收标准

1. daemon 模式下 SessionDrawer 出现「在 worktree 中新建…」；非
   daemon / 非 git 工作区不出现。
2. 创建后 `git worktree list` 与会话列表标注一致（分支、路径）。
3. worktree 会话中 Droid 的文件改动只落在 worktree 目录，主工作区
   `git status` 干净。
4. 分支名冲突时显示 git/daemon 原始错误，不产生半创建状态（无
   孤儿 worktree）。
5. （切片 B）dirty worktree 的移除被拒绝且提示准确；干净 worktree
   移除后 `git worktree list` 无残留、分支保留。
