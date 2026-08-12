# Git 提交 / PR 工作流设计（V2）

> 状态：设计完成，待排期。撰写日期 2026-08-12。
> 本文档遵循 `message-card-design.md` 的格式约定：结论速览 → 能力
> 证据 → 分档设计 → 边界与失败路径 → 切片划分 → 验收标准。

## 0. 结论速览

| 子能力 | 可行性 | 通道 |
| --- | --- | --- |
| 查看变更 → 暂存 → 提交 | **全可行**（模式无关） | VS Code 内置 `vscode.git` 扩展 API；spawn `git` 兜底 |
| commit message 草稿（会话联动） | **全可行**（本地启发式） | Host 侧用当前回合 prompt + 变更文件数拼草稿，不调 LLM |
| 分支查看 / 新建 / 切换 | **全可行** | `vscode.git` API（`createBranch`/`checkout`）；daemon `daemon.checkout_git_branch` 为 daemon 模式等价通道 |
| 创建 PR | **降级可行**（仅 daemon 模式 + 外部 CLI 就绪时） | daemon `daemon.create_pr` RPC（底层依赖 `gh`/`glab`）；URL 兜底 `vscode.env.openExternal` 打开 compare 页 |
| PR 状态展示 | **降级可行** | daemon `daemon.get_git_diff` 结果内嵌 `pullRequestStatus`，lookup 失败时原样呈现原因 |

没有任何一步需要 GUI 触碰凭据：`vscode.git` 走用户已有的 git 认证，
daemon PR 通道走 `gh`/`glab` 自身的认证态，符合 `AGENTS.md` 凭据黑盒
约束。

## 1. 需求与范围

Droid 改完文件后，用户当前必须离开侧栏去 SCM 视图或终端完成提交。
目标：在 DroidVisX 侧栏内完成「查看本回合变更 → 暂存 → 提交」的
最小闭环，进阶到分支操作与 PR 创建。

范围外（本设计不做）：

- diff 编辑器内改动（复用 VS Code 原生 diff，只做打开入口——已有
  `changes.openDiff` 链路）；
- 合并冲突处理、rebase、stash 等高级 git 操作；
- GitHub/GitLab API 直连（需要 token 管理，违反凭据黑盒）；
- push 的凭据交互（凭据弹窗由 git/凭据管理器自己处理，GUI 只发起）。

## 2. 能力证据

### 2.1 VS Code 内置 Git 扩展 API（提交闭环的首选通道）

- `vscode.git` 是 VS Code/Cursor 内置扩展，通过
  `vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports.getAPI(1)`
  获得 `API` 对象；`api.repositories[]` 每项提供
  `state.workingTreeChanges` / `state.indexChanges` / `state.HEAD`
  （分支名）、`add(paths)` / `revert` / `commit(message)` /
  `createBranch(name, checkout)` / `checkout(ref)` / `push()`。
  证据来源：VS Code 官方仓库 `extensions/git/src/api/git.d.ts`（公开
  稳定 API，版本参数 `getAPI(1)`）。这是 Cursor 侧栏扩展常用的标准
  通道，不属于发明能力。
- 仓库先例：`src/extension/changeStats.ts` 已用 `execFile('git',
  ['diff','--numstat',...])` 直接跑 git 取变更统计——证明 Host 侧
  spawn git 在本项目是既有惯例，可作为 `vscode.git` 不可用时的兜底。

### 2.2 Droid daemon 的 git RPC（daemon 模式增强通道）

来源：`node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`
（SDK 0.193.0 类型面，行号以当前 lockfile 版本为准）：

- L45043–45045：`DaemonDroidMethod.GIT_PUSH = "daemon.git_push"`、
  `GIT_COMMIT = "daemon.git_commit"`、`CREATE_PR = "daemon.create_pr"`。
- L58867：`DaemonGetGitDiffResultSchema`——staged/unstaged 文件、
  当前分支、commits，且内嵌 `pullRequestStatus`（L58991 起）与
  `pullRequestProvider`。
- L45082：`DaemonPullRequestUnavailableReason` 枚举了 PR 状态查询
  失败原因（含外部 CLI 缺失类），证明 daemon 的 PR 通道底层依赖
  `gh`/`glab` 一类外部工具，认证态在外部工具侧。
- L58357：`DaemonCheckoutGitBranchRequestParamsSchema`，checkout
  带 `needs_resolution` 一类结果分支（未提交改动时要求用户选择
  处理方式），自带防呆语义。
- 这些 RPC 挂在 `ConnectedDroid` facade 的 `git` 资源上（
  `daemon-feature-opportunities.md` A 节已登记），仅 daemon 模式可用。

### 2.3 会话联动素材

- Host 侧已持有当前回合的用户 prompt 与 `turn.changes`（变更文件
  列表 + 增删行数，见 changes 卡片既有链路）。commit message 草稿
  不需要新数据源。

### 2.4 查无渠道、判不做的项

- **SDK 无「生成 commit message」RPC**：全类型面无此方法。草稿只能
  本地拼（启发式），或用户手写。不调 LLM、不发明 API。
- **GitHub API 直连**：需 token，违反凭据黑盒，判不做。PR 通道只有
  daemon RPC 与 compare URL 两条。

## 3. 分档设计

### 3.1 最小档（切片 A）：变更列表 + 提交

入口：回合完成后 changes 卡片尾部一行 quiet 文本入口「提交这些
变更…」（遵守 UI restraint：弱化文本样式，复用既有 hint 视觉，不加
彩色按钮）。点击展开一个内联提交区：

1. Host 收到 `git.requestStatus`（W→H），经 `vscode.git` 读取
   `workingTreeChanges` / `indexChanges` / 当前分支名，回发
   `git.status`（H→W）。列表以本回合 `turn.changes` 文件为高亮，
   其余工作树变更一并列出（避免用户误以为只提交回合文件）。
2. Webview 显示：分支名、可勾选的文件列表（默认勾选本回合文件）、
   message 输入框（预填草稿：`用户 prompt 首行（截断 50 字）` +
   换行 + `via DroidVisX, N files`；用户可全改）。
3. 用户点「提交」→ `git.commit`（W→H，携带勾选路径 + message）→
   Host `repository.add(paths)` 后 `repository.commit(message)` →
   `git.commitResult`（H→W，成功含 commit 短哈希，失败含 git 原始
   错误文本）。
4. 成功后提交区收起为一行结果文本（短哈希 + message 首行）。

模式无关：private/shared/daemon 三模式都走 `vscode.git`，不依赖
daemon。

### 3.2 进阶档 B：分支

- 提交区常显当前分支名；旁边 quiet 入口「新分支…」→ 输入名 →
  Host `repository.createBranch(name, true)`（创建并切换）。
- 有未提交改动时切换分支的冲突由 git 自行报错，GUI 原样呈现，不做
  自动 stash（防呆：不隐式动用户工作区）。
- daemon 模式下可选用 `daemon.checkout_git_branch`（其
  `needs_resolution` 语义更完整），但为避免双通道分叉，**统一走
  `vscode.git`**，daemon RPC 登记为后备不实现。

### 3.3 进阶档 C：PR（daemon 模式专属，降级设计）

- 前置探针（放 `artifacts/`）：核实 sidecar 的 `ConnectedDroid.git`
  资源在无活动会话时是否可用、`create_pr` 在 `gh` 未安装/未登录时
  的失败形态。探针通过前不冻结 Bridge 契约。
- 通过后：提交成功且当前分支非默认分支时，结果行追加 quiet 入口
  「创建 PR…」→ Host 走 daemon `git.createPullRequest`（title 预填
  commit message 首行）→ 成功显示 PR URL（markdown 链接）。
- 失败/非 daemon 模式：降级为 URL 兜底——`vscode.env.openExternal`
  打开 `{remote}/compare/{base}...{branch}?quick_pull=1&title=...`
  （仅当 remote 是 github.com 时；其余 host 判 fail-closed，入口
  隐藏）。push 前置：PR 前需 `repository.push()`，push 失败原样
  呈现。

## 4. Bridge 契约（切片 A 冻结范围）

新增消息（协议版本 +1，命名沿用现有 `域.动作` 惯例）：

| 方向 | 消息 | 载荷 |
| --- | --- | --- |
| W→H | `git.requestStatus` | 无 |
| H→W | `git.status` | `{ branch, files: [{path, status, staged, inTurn}] , unavailableReason? }` |
| W→H | `git.commit` | `{ paths: string[], message: string }` |
| H→W | `git.commitResult` | `{ ok: true, hash, subject } \| { ok: false, error }` |

进阶档 B/C 的消息（`git.createBranch`、`git.createPr` 等）在各自
切片开工时再冻结，避免提前锁死未经探针核实的形态。

## 5. 边界与失败路径

| 情形 | 行为 |
| --- | --- |
| `vscode.git` 扩展不存在或未激活（`getExtension` 返回 undefined） | fail-soft：`git.status` 回 `unavailableReason`，入口隐藏；不自动降级到 spawn git（留作后续决定） |
| 工作区无 git 仓库 / 多根多仓库 | 第一切片只支持单仓库（取 `repositories[0]` 且校验路径 == workspace 根）；多仓库回 `unavailableReason` |
| commit 时 message 为空 | Webview 禁用提交按钮（边界校验在 UI），Host 二次校验直接拒绝 |
| git hook 失败 / 签名失败 | git 错误原样进 `git.commitResult.error`，不重试 |
| push 需要凭据 | 由 git 凭据管理器处理；GUI 不采集、不存储、不转发任何凭据 |
| `create_pr` lookup 失败 | `DaemonPullRequestUnavailableReason` 原样映射为一行可读失败文本 + 降级 URL 入口（仅 github.com） |
| 非 github.com remote 的 PR URL 兜底 | fail-closed：入口不出现 |

## 6. 切片划分与第一切片

- **切片 A（第一切片，一天内可交付）**：§3.1 全部。可观察完成标准：
  在真实 Cursor 中，一次 Droid 回合改完文件后，不离开侧栏完成勾选
  文件 → 填 message → 提交；SCM 视图与 `git log` 可见该提交；
  `vscode.git` 缺失时入口隐藏且无报错。
- **切片 B**：分支显示 + 新建切换（§3.2）。
- **切片 C**：PR 创建 + 状态（§3.3），前置探针独立半天。

## 7. 改动面预估（切片 A）

| 层 | 改动 | 量级 |
| --- | --- | --- |
| Runtime | 无 | 0 |
| Bridge | 4 条新消息 + 协议版本 | 小（~60 行含类型） |
| Host | 新 `src/extension/gitWorkflow.ts`（vscode.git 接入 + 消息处理） | 中（~150 行） |
| Webview | changes 卡片尾部入口 + 内联提交区组件 + store 状态 | 中（~200 行） |
| 测试 | Host 消息处理单测（mock git API）+ Webview 组件测试 | 小 |

## 8. 可观察验收标准

1. 回合产生变更后 changes 卡片出现 quiet 提交入口；无变更回合不出现。
2. 提交区文件列表与 `git status` 一致，本回合文件默认勾选。
3. 草稿 message 含 prompt 首行；用户清空后提交按钮禁用。
4. 提交成功后 `git log -1` 哈希与 GUI 显示一致；SCM 视图变更清零。
5. 人为让 pre-commit hook 失败：GUI 显示 git 原始错误，不吞错、不重试。
6. 禁用 `vscode.git` 扩展后重载：入口消失，控制台无未捕获异常。
