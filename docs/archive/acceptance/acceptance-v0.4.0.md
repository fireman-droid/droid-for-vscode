# DroidVisX v0.4.0 验收清单

本文件只记录**本次实际执行过**的命令、断言与数值。没跑到的一律进
§4「未验证」，不以源码推断代替验证。验收口径按 `AGENTS.md` 第 8 步
（2026-08-13 改为强制行为冒烟）：证据是断言，不是截图自评；审美签收
仍归用户，走 `artifacts/kitchen-sink-harness.html`。

## 1. 发布指纹

- 版本：`0.4.0`，发布提交 `c0d1557`（`chore(release): bump to 0.4.0`），
  打包时工作树干净（`git status` 空，`git diff HEAD -- src package.json`
  无输出）。
- 包：`dist/droidvisx.vsix`，1,665,137 字节，打包于 2026-08-13 13:30:47，
  SHA-256
  `3BE5D52CE6975553E5CC886EDDFA7B9A6C55A3F252EFCB094A88C1FF49B9FE5F`。
- 安装：`cursor --install-extension dist/droidvisx.vsix --force` 成功，
  `cursor --list-extensions --show-versions` 确认
  `droidvisx.droidvisx@0.4.0`。
- 装机产物与本次 build 逐字节一致（安装目录 SHA-256 与 `dist/` 相同）：
  - `extension.cjs`
    `FD32B3B175285045B9CBF9C7C09D2A7C24D6F9F73573F19A309085A1C3E63078`
  - `webview.js`
    `E52B51F54F039BD592C283513E330D7660C2C35898E01FB565D4F12A6361A66D`
  - `webview.css`
    `88DA13183077688E8A211B6720E77452787C148B17155A8690F959D0170D5702`
- **协议已到 v10**：装完必须 Reload Window，旧窗口握手会被拒（表现为
  面板空白），Reload 即恢复。

## 2. v0.3.0 → v0.4.0 落地清单

`1f88e5f`（v0.3.0 验收清单）之后进入本包的提交：

| 提交 | 内容 |
| --- | --- |
| `b5aa9bb` | Add Selection to Chat 冷启动保留捕获（连上前不丢） |
| `1466e70` | exploration ticker 出场行边滑边溶解 |
| `34cff89` | Bridge v10：`turn.changes` 换成流式 `changes.update` |
| `643b4d6` | Host：防抖串行 numstat 的实时 changes 账本 |
| `77115f6` | Webview：Changes 渲染为账本 + 原地 settled 头 + footer 动作 |
| `cd2ab29` | plan 锚卡重做为钉在触发消息下方的细条 |
| `44f8924` | **本次新增**：ticker 手感对齐用户定稿值 |
| `c0d1557` | 版本 bump 0.4.0 + CHANGELOG（含补记 0.3.0 内容） |

另有三个文档提交（`23e8de9` / `1f88e5f` / `f3aae18` / `d828cf9`），
不影响运行时。

**收口时发现并修掉的一条偏差**：`1466e70` 落的是共享动效 token
（300ms / `--dvx-easing-out-strong` / 22px 行高），而用户在
`artifacts/ticker-mini.html` 逐值定稿、并写进
`decard-design-proposal.md` 的是 **280ms / 26px /
`cubic-bezier(0.22, 0.61, 0.36, 1)`**。本包按定稿值改齐
（`44f8924`，局部自定义属性，不动共享 token；提交回退计时
`TICKER_SLIDE_FALLBACK_MS` 360→340 保持同样余量）。

## 3. 已验证矩阵（本次实际断言过）

### 3.1 门禁（全绿，数字如实）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| typecheck 三段 | `pnpm run typecheck` | 通过（extension / webview / webview-tsconfig） |
| 行数预算 | `pnpm run lint:budgets` | `file budgets OK` |
| 全量测试 | `pnpm exec vitest run --maxWorkers=4` | **103 files / 2033 tests 全通过**，32.33s |
| 构建 | `pnpm run build` | 通过 |
| 打包 | `vsce package --no-dependencies` | 11 files / 1.59 MB |
| 包内容校验 | `pnpm run verify:vsix` | `Verified 11 VSIX entries and bundled externals` |
| 装机 | `cursor --install-extension` | 成功，`@0.4.0` |

### 3.2 Changes 实时账本

**A. 真实 Droid 回合**（`artifacts/smoke-changes-ledger-live.mts`：真实
`ChatController` + `FactoryDroidRuntime`(daemon) + 用户 BYOK gpt-luna，
一次性 scratch git 仓库，未碰用户会话文件）——全部 `[PASS]`：

- 回合内流出 **6 帧 writing**，首帧在 32.7s（回合发出 19.5s、终态
  48.8s），**早于终态**：账本确实边写边出，不是回合末汇总。
- 文件数单调增长 `[1,1,2,2,3,4]`：**第一个文件写入时账本就出现**，后续
  原地长大。
- 防抖 numstat 计数中途到达（非终局才有数）。
- **恰好一帧 settled** 收口（48.9s）。
- settled 与真实 numstat 对账：`a.txt +10/−5`、`b.txt +3/−0`；新建未跟踪
  文件计数为 null（符合 HEAD 对账语义）。

**B. 真实 dist 产物 + headless Chrome**（`smoke-changes-ledger.mjs`，
顶层 `pass: true`）：

- 首个文件写入前账本不存在（`beforeFirst: true`），写入后出现，行高
  27px、头 28px。
- 头文案原地切换：`writing · 1 file` → `writing · 2 files` →
  `writing · 4 files` → `4 files · settled`（settled 后运行点消失）。
- **钉在首现位置**：四段 staging 全程 `markerKept: true`（首现锚点节点
  未被重建/移动）。
- **行 hover 无灰底**：`rowBackground: "rgba(0, 0, 0, 0)"`，反馈只有行尾
  动作 `opacity 1` 浮现；未 hover 的行不显示动作。
- footer：`["Review", "Commit…"]` + 1px hairline，横向溢出 0。
- **Review 逐个开 diff**：点击后发出 4 条 `file.openDiff`
  （`a.txt` / `b.txt` / `page.html` / `notes/deep.md`）。
- 暗色：行与文件底色均 `rgba(0, 0, 0, 0)`。

**C. Commit… → 既有 Git 面板**（`smoke-git-commit.mjs`，`pass: true`）：
点击账本 footer 的 `.dvx-changes-commit` 拉起既有 commit 面板（分支行
`on main`、3 个文件复选框、草稿信息、2 次 `git.requestStatus`）；提交发出
`git.commit` 携勾选路径并回显 `Committed abc1234 · …` 后面板关闭；失败时
面板保持打开并显示 `pre-commit hook exited with code 1`；git 不可用时入口
与面板都不出现。

### 3.3 计划细条

`smoke-plan-anchor.mjs`（真实 dist，五场景全 `pass: true`）：

- **位置**：五场景全部 `inUserMessage: true` + `afterContent: true` ——
  细条落在**触发它的那句用户消息**内容之后，不在执行流中游；
  `hasCardChrome: false`（旧大卡形态已无残留）。
- **收起态**：一行、`open: false`、整行只有 1 个 button。
- **流式全链**：首个 todowrite 出条 live `0/3` → 原地更新 `2/3`（不出第
  二条）→ 展开见 3 个圈 2 个勾（步骤三态 completed/inProgress/pending
  正确）→ 收起 → 回合结束转 done `3/3`。
- **吸顶**：滚到该消息区间 pin 住，底盘为不透明白底 + 1px 边框 + 8px
  圆角，行高 35px 不变（内容不跳位）；吸顶后展开是
  `position: absolute` 浮层，不挤压布局；**继续滚动会离开** ——
  `firstPinned: false` / `secondPinned: true`，下一条消息接管。
- 暗色展开态正常。

### 3.4 探索跑马灯

`smoke-ticker-fade.mjs`（真实 dist + CDP，`pass: true`）：

- **同一帧内既位移又渐隐**（连续动画的数值证据，不是瞬切）：真速采样
  `translateY −11.9px` 时两行 opacity 为 `[0.54, 0.46]`；第二次到达
  `−14.9px` / `[0.43, 0.57]`。慢放连拍三组的包夹采样同样成立。
- 打断接续：80ms 连发 trail 达 4 行，`snapBack: false`（不回退重置），
  最终收敛回单行 `translateY 0`。
- **89 次采样容器高度全为 26px**（用户定稿行高）。
- reduced-motion：track 与 item 的 `transitionProperty` 均为 `none`。
- 动画期 50ms+ 长任务 0 个。
- 注：本次把该冒烟脚本里过期的 22px 期望改为 26px（断言跟随出厂值）。

### 3.5 Reload 存活与排队恢复

**A. Reload 不杀 daemon 回合**（`probe-a4-reload-controller.mjs`，
生产 host 栈 + 真实 daemon，两代客户端，`VERDICT: PASS`）：
gen-a 在权限挂起中**硬退出**；gen-b 用生产 `ChatController` 正常启动路径
恢复后观察到 —— 流式 `recovery-1` 占位回合仍在（`placeholderSeen: true`，
即 daemon 侧回合没被 reload 杀掉）、挂起权限被重新投射且归属同一回合、
回答 `proceed_once` 后回合 `completed`、终态转录 5 条为 daemon 产出内容、
且 `sendTurnNeverCalled: true`（是重接不是重发）。

**B. 排队消息 reload 后暂停态恢复**（`probe-queue-reload.mjs`，本次新
写，生产 host 栈 + 真实会话，`VERDICT: PASS`）：回合流式中入队 2 条 →
恢复存储里确实持久化了 2 条 → dispose 掉这一代（reload 边界）→ 新一代
控制器**恢复同一会话**，发出 `queued-messages-restored` 诊断，
`queue.state` 带回原文两条（顺序一致）且
`paused: "dispatch-blocked"`；此后静置 4s **没有任何自动派发**。

## 4. 未验证（如实标注）

- **本包未做真人点测**：§3 的验证全部是自动化断言（真实运行时 / 真实
  dist / headless Chrome / 生产 host 栈），**没有**在 Cursor 的 Secondary
  Sidebar 里用鼠标走一遍。真机可见验收由用户按 §5 完成。
- **视觉审美未签收**：按 `AGENTS.md` 新第 8 步，本次不做截图自评。账本 /
  细条 / ticker 的观感请在 `artifacts/kitchen-sink-harness.html` 上过。
- **用户 11:59 在样板间给的那批视觉意见本次全部延后**，未进本包：终端
  展开动画更丝滑、有缩略图时去掉冗余 image chip、会话抽屉自然下滑 + 更短
  + 最新在前、计划步骤圈改空心/实心 + 加内边距 + 贴齐聊天框、View source
  与 Changes 去掉灰色 hover 卡、`Droid is working` 上方间距收紧、终端井跟
  随主题、model/mode picker 变轻去塑料感。
- 账本的**会话切换回放**（切走再切回后账本是否同构）未单独验证；
  reload 回放与历史回放语义由单测覆盖，未在真机走。
- Changes 账本在**失败回合**（无 settled 帧，靠终态 turn.state 原地翻头）
  的表现只有单测覆盖，未跑真实失败回合。
- 计划细条与账本**同屏共存**时的滚动/吸顶相互作用未专门测。
- QA v0.3 快修四条（冷启动选区、连点去重、Failed 危险色、预览工具栏换行）
  仍**未做真机验证**（v0.3.0 清单里已记，本次未补）。
- 已知残差沿用交接文档 §9：daemon 起不来时回退 process 约慢 64s；daemon
  低自治下工作区文件创建不触发权限请求；归档列表只见最新 100 条窗口。

## 5. 给用户的 5 分钟点测路径

> 前置：**先 Reload Window**（协议 v10，旧窗口不 Reload 会看到空白面板）。
> 建议开一个**新会话**测，别用有价值的老会话。

1. **Changes 实时账本（约 2 分钟）**
   在一个 git 仓库里发：「改 `a.txt` 和 `b.txt`，各加几行，再新建一个
   `notes/deep.md`」。
   - 期望：**第一个文件刚写完**账本就出现（不是等回合结束），标题右侧是
     `writing · N files` 带一个小圆点，N 随文件增加实时跳；账本**待在它
     第一次出现的位置**，后面的工具行在它下面继续追加。
   - 回合结束：标题**原地**变成 `N files · settled`，圆点消失，位置和尺寸
     不跳。
   - 鼠标划过文件行：**不应该出现灰色底块**，只有行尾动作淡入、文件名字色
     略深。
   - 点 footer 的 **Review**：逐个打开每个文件的 diff。
   - 点 **Commit…**：拉起原有的 Git commit 面板（分支、文件勾选、草稿
     信息）。取消即可，不用真提交。
2. **计划细条（约 1 分钟）**
   发一个明显多步的任务（例如「分三步重构这个函数并说明每步」）。
   - 期望：细条出现在**你发的那句话正下方**，默认只有一行高（状态点 +
     标题 + `n/m` + chevron），没有卡片边框。
   - 向下滚动：滚过这条消息时细条**吸顶**并出现一层薄底盘；继续往下滚，
     它会**离开**，下一条消息的细条接管。
   - 点这一行：展开步骤清单，每步一个圈（未到空心 / 当前实心 / 完成实心
     带勾）；再点收起。
   - 鼠标划过：**不应该有灰底**。
3. **探索跑马灯（约 30 秒）**
   让它读几个文件（例如「看看 `src/webview/assistant` 下都有什么」）。
   - 期望：收起的 Explored 行换行时，旧行是**一边上滑一边淡掉**的连续动画
     （约 0.28s），新行从下方淡入；不应该是瞬间切换或硬裁切。
4. **Reload 存活（约 1.5 分钟）**
   发一个长回合（「从 1 数到 60，每行一个数字」），流式过程中：
   - 先在输入框里排 1–2 条消息（回合运行中发送即入队）。
   - 然后 **Reload Window**。
   - 期望：Reload 后回合**还活着**并继续/完成，不是从头再来；排队消息以
     **暂停态**回来，并有一条提示说明「已恢复（仅文本），用 Send now 派
     发」；**不会自动发出去**。

点测中任何一条与上面描述不符，就是缺陷，请记下来（哪一步、看到什么、
期望什么），下一轮按缺陷单修。
