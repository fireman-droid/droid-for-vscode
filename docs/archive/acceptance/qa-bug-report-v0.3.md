# DroidVisX QA 缺陷报告（v0.3 验收前）

> 角色：只找、只证、只报。不修复。
> 日期：2026-08-13
> 安装中的包：`droidvisx.droidvisx@0.2.0`（2026-08-13 01:01，`dist/droidvisx.vsix`）
> 源码：已含 v0.3 切片（Add Selection to Chat、主题切换、BYOK Add model），**尚未打 v0.3.0 包、尚未重装**。第二轮增量扫描见文末，待分诊代理装完新包后补。
> 基线：`docs/product/acceptance-checklist-v0.2.md`；台账：`docs/product/implementation-status.md`。

## 数量统计

| 级别 | 条数 | 说明 |
| --- | --- | --- |
| **P0** | **0** | 未发现崩溃 / 静默数据丢失（Reload 杀回合属已知在修，不重复报） |
| **P1** | **1** | v0.3 将装上的 Add to Chat，冷启动会静默丢选区 |
| **P2** | **5** | 预览主题、预览工具栏裁切、Diff 失败无路径、命令卡 Failed 无色、Add to Chat 双击重复 chip |
| **P3** | **4** | BYOK 单选键盘、Escape 丢表单、首屏 longtask、极窄栏单词中切 |

**合计 10 条。** 当前真机 0.2.0 用户立刻会撞上的是 P2 里预览 / Diff / 命令卡三条；P1 要等 v0.3 包装上才会进右键菜单。

> **修复进展（2026-08-13 上午）：** P1-1、P2-2、P2-3、P2-4、P2-5 已修——commits `b5aa9bb`、`346fafb`、`d5c1738`、`9c72d90`、`aef2d0d`，逐条标注见各条目。P2-1（预览暗色壳）按主题切片遗留归属随去卡片化设计波处理，本轮不动。
> **包含关系注意：** 分诊代理 10:32 已切过一份 `dist/droidvisx.vsix`（0.3.0），实测其中**只含 P2-3**（`d5c1738` 在 release bump 之前）；P1-1/P2-2/P2-4/P2-5 四条落在 10:36–10:45 的 main 上，需分诊代理重切包才会进安装件。第二轮验收前先确认所装 vsix 的构建点。

---

## 本轮明确不报（避免和在修/已知残差抢工）

**正在修 / 分诊中（用户今早已撞）：**

1. 启动弹出终端窗口
2. Reload Window 杀死运行中回合（今早日志 `runtime.initialize.finished` outcome=`initialization-failed`，8081ms，act `a633a2`）
3. daemon 模式模型选择不可用
4. 计划锚卡真机行为

**清单 H 已知残差（5 条）与 I「明确不在本版」：** 不报。含 daemon 回退约 64s、低自治文件创建权限差异、归档只见最新 100 行、后台子代理停不掉、命令卡极窄芯片省略；以及入口 b/c Add to Chat、MCP 权限 UI、子代理转录回放、Mission 观察台等 backlog。

**设计如此、不当缺陷：**

- Reload 丢排队：Host 内存队列，UI 已写 “kept in this window only”（`queued-messages-design.md` §4.6）
- 切会话 / fork / compact 丢排队：有 `queued-messages-discarded` 诊断
- `ctrl+alt+l` 未贡献：Add to Chat 切片遗留，等真机快捷键冲突验证
- 产品界面英文：全产品如此，新面没有单独缺中文
- Factory 侧 EPERM 改名 `droid.exe`、Figma MCP SSE、TokenLimitService warning：上游/环境噪音
- `archived-load-failed`：0.2.0 已修，今早日志未再出现
- 暗色 BYOK 自验收图 `custom-models-form-dark.png` 仍是浅色：装置脚本把 `ui.theme` 带了 `sequence`，校验丢弃，**不是产品暗色失败**

---

## P0

无。

---

## P1

### P1-1 首次打开聊天时「Add Selection to Chat」会静默丢掉选区

> **已修（2026-08-13）commit `b5aa9bb`：** 选区在命令触发瞬间读取一次并暂存，最长等 60s 连接后原样投递（不再重读编辑器）；等待期间状态栏显示 "Selection will be added when Droid connects…"，投递即消失；60s 未连上改为一次 `showWarningMessage`（不再静默），日志 `dropped`/`staged` 均带 `waitedMs`。测试：`ChatController.attachments.test.ts` 新增冷启动晚连不丢、空选区诊断两条，全套 2015 绿。

- **严重级：** P1（v0.3 核心入口第一次使用就像没点）
- **影响包：** 当前 **0.2.0 未安装此命令**（已装 `package.json` 无 `droidvisx.addSelectionToChat`）。源码已接线，随 v0.3.0 装上就会进编辑器右键。
- **复现步骤：**
  1. 冷启动 Cursor（或该工作区第一次打开 DroidVisX 视图）
  2. 编辑器里选中一段代码
  3. 右键 → **DroidVisX: Add Selection to Chat**（或命令面板同名命令）
- **预期：** 侧栏打开后 Composer 出现 selection chip；连不上时至少有一条可见说明。
- **实际：** 命令先 `focusView`，再最多重试 **20 × 250ms = 5s**。`canStageAttachments` 要求 `connection.status === 'connected'`。今早该工作区首次 `runtime.initialize.finished` 是 **15888ms** 才 `available`。5s 用尽后只记一条 host warn，**界面零反馈**。
- **证据：**
  - 代码：`src/extension/extension.ts` 命令循环 20 次 / 250ms，超时 `attachment.add-selection-command.dropped`（无 toast）
  - 代码：`src/extension/ChatController.ts` `addEditorSelectionToChat()` 未连接返回 `false`
  - 代码：`src/extension/chat/attachments.ts` `canStageAttachments` 要求 `connected` + `runtime !== null`
  - 日志：`%APPDATA%\Cursor\User\globalStorage\droidvisx.droidvisx\logs\droidvisx-20260813.jsonl` act `a5b7b1` sequence 13：`"durationMs":15888,"outcome":"available"`
  - 台账自己写了「安静降级，无新错误面」，但 5s 预算打不过实测冷启动，用户会以为功能坏了
- **疑似根因：** 重试窗口按「视图 reveal 的短暂间隙」估的，没覆盖 daemon 冷启动 / 历史恢复那一截。连接成功后同一命令是通的（单元测试 `ChatController.attachments.test.ts` 已覆盖 connected 路径）。

---

## P2

### P2-1 HTML Preview 独立 webview 在暗色 Cursor 里仍是暖白壳

- **严重级：** P2（用户今早真的打开过预览；和聊天暗色并排时像两套产品）
- **复现步骤：**
  1. Cursor 用暗色主题，DroidVisX 聊天也是暗色（v0.3）或侧栏在深色工作台里（0.2.0）
  2. 让 Droid 生成/打开 HTML 原型，点 Changes 行上的 Preview（今早路径 `烟花.html`）
- **预期：** 预览工具栏跟随工作台/聊天主题，至少不要一块暖白贴在深色台上。
- **实际：** Preview 是另一块 webview，`SHELL_STYLE` 写死 `background: #f5f3ef`、`color-scheme: light`。聊天暗色切片**故意没改这块**（implementation-status 主题遗留 ②），但 **不在清单 H/I**，用户看得见。
- **证据：**
  - 今早日志两次 `host.preview.opened`，`path":"烟花.html"`（02:10:34、02:19:09，act `b47674`）
  - 截图：`artifacts/qa-preview-shell-light-on-dark-stage.png`
  - 代码：`src/extension/previewHtml.ts` `SHELL_STYLE`（`:root { color-scheme: light }`，`body` / `.dvx-preview-toolbar` 暖白字面量）
- **疑似根因：** 预览面板无 `localResourceRoots`、不加载聊天 CSS token；主题切片只覆写了 `.dvx-shell`。

### P2-2 Preview 工具栏窄宽度裁掉「Open in editor」

> **已修（2026-08-13）commit `346fafb`：** 工具栏改 `flex-wrap: wrap`（去掉容器级 nowrap+hidden），文件名/说明各自省略号，按钮 `flex: none` 整颗换行。300px/360px 实测按钮完整可点：`artifacts/qa-p2-preview-toolbar-300.png`、`qa-p2-preview-toolbar-360.png`、`qa-p2-ui-fixes.out.json`。

- **严重级：** P2
- **复现步骤：** 打开 HTML Preview，把面板收到大约聊天侧栏宽度。
- **预期：** 按钮可点、文案可读，或整颗收入 overflow 菜单。
- **实际：** 工具栏 `white-space: nowrap; overflow: hidden`，右侧只剩 **「Ope」**。
- **证据：** `artifacts/qa-preview-shell-light-on-dark-stage.png`；`previewHtml.ts` `.dvx-preview-toolbar` 的 nowrap + hidden。
- **疑似根因：** 文件名 + 说明文案 + Reload + Open in editor 全挤一行且禁止换行。

### P2-3 打开 Diff 失败时文案没有文件路径，连点像同一张废卡

> **已修（2026-08-13）commit `d5c1738`：** `fileDiffFailedMessage(path, reason)` 取代固定句——`Could not open <path>. It may have been moved or deleted.`（not-found）/ `…The editor failed to open it.`（open-error）。不同文件不再被 code+message 去重合并成一张匿名卡。测试断言消息含路径。

- **严重级：** P2（Changes chip 是核心动作；用户昨天连点 17 次）
- **复现步骤：** 点一条已经不在磁盘上的文件 chip / Open Diff（或 Droid 报了路径但 Host 打开失败）。
- **预期：** 告诉用户**哪一个文件**打不开。
- **实际：** 固定句 `That file could not be opened. It may have been moved or deleted.` 日志 attributes 也只有 `code`，没有 path。Webview 对「连续相同 code+message」去重，连点不会叠加，但也看不出点的是哪个文件。
- **证据：**
  - `droidvisx-20260812.jsonl` 共 **17** 条 `host.ui.diagnostic` `file-diff-failed`，detail 全部同一句（例如 12:11:43–12:14:02 工作区「个人简历」，12:50:45–12:52:21「面试算法」）
  - 代码：`FILE_DIFF_FAILED_MESSAGE`（`src/extension/chat/workspaceActions.ts`）；`handleFileOpenDiff` 失败分支不带 `path`
  - 去重：`src/webview/assistant/store.ts` `appendDiagnostic`
- **疑似根因：** 失败文案按「可能被挪/删」写死，打开时明明已经有 `path` 参数却没插进去。

### P2-4 命令卡 Failed 和 Completed 在暗色里几乎同色

> **已修（2026-08-13）commit `9c72d90`：** 单条工具/命令卡的状态 span 在 `status === 'failed'` 时挂现有 `dvx-activity-state-failed`（浅色 `#b3401f`、暗色 `var(--dvx-danger)`=`#e5484d`，与探索组同款）。双主题实测色值与截图：`artifacts/qa-p2-command-card-failed-light.png`、`qa-p2-command-card-failed-dark.png`、`qa-p2-ui-fixes.out.json`。

- **严重级：** P2（失败态要扫才能发现）
- **复现步骤：** 暗色主题下看一条失败的 execute 命令卡（装置：`artifacts/command-card-harness.html` 或真实失败命令）。
- **预期：** Failed 用危险色，和 Completed 一眼可分（探索组已经这么做了）。
- **实际：** 命令卡 header 只用 `.dvx-activity-state`，`color: inherit`。`.dvx-activity-state-failed`（浅色 `#b3401f` / 暗色 `var(--dvx-danger)`）**只打在探索组汇总**上，单条命令卡没有。
- **证据：**
  - 截图：`artifacts/qa-dark-command-card.png`（Failed 与 Completed 同为浅灰）
  - 代码：`src/webview/assistant/thread/activityRows.tsx` 命令行状态 span 无 failed class；同文件探索组才拼接 `dvx-activity-state-failed`
- **疑似根因：** 终端卡改版时没把失败色从探索组迁过来。窄栏下长芯片把 Completed 折成两行属清单 H.5，不另报。

### P2-5 已连接时连点「Add Selection to Chat」会暂存两张相同 chip

> **已修（2026-08-13）commit `aef2d0d`（+ `b5aa9bb` 入口重构）：** `stageAttachmentPayloads` 对 capture 来源加去重守卫——同 capture 种类、同 `file:start-end` 名、同内容视为重复，静默忽略；不同选区仍正常并列。命令入口随 P1-1 改为「触发即捕获、暂存投递」，连点两次产生两份相同捕获也只落一张 chip。测试覆盖同选区连点与异选区并列。

- **严重级：** P2（v0.3 入口；0.2.0 无此命令）
- **复现步骤：** 会话已 connected 后，选区还在，快速连点两次右键命令（或命令面板连触发）。
- **预期：** 互斥，第二次被挡住或提示已暂存。
- **实际：** `addEditorSelectionToChat()` 在 `handleAttachmentCapture` **启动读选区后立刻 return true**。`attachmentOperationInProgress = true` 写在 capture 函数体内，但第一条命令已经成功返回，扩展不再重试。第二条命令是一次新的 invoke：若第一次还在读，第二次 `canStage` 为 false 并重试，直到第一次结束把 flag 清掉，然后**再 stage 一次**。
- **证据：** 代码路径（`ChatController.addEditorSelectionToChat` + `handleAttachmentCapture`）。本轮未做真机双击（待第二轮装包后补截图）。
- **疑似根因：** 命令把「捕获已开始」当成「已暂存成功」。

---

## P3

### P3-1 BYOK「Add model」Provider 单选不能用方向键

- **严重级：** P3
- **复现步骤：** 打开 Model → Add model…，Tab 到 Provider，按 ←/→。
- **预期：** `role="radiogroup"` 用方向键在 OpenAI / Anthropic / Generic 间移动。
- **实际：** 三个 `<button role="radio">` 只有 click，没有 roving tabindex / Arrow 处理。和 MCP Add server 同一模式。
- **证据：** `src/webview/assistant/CustomModelsPanel.tsx` Provider `radiogroup`。键盘操作本轮为静态巡检（面板在无 host `customModels.state` 的装置里停在 Loading）。

### P3-2 Escape 关掉整个模型弹出层，未保存的 Add model 表单直接丢

- **严重级：** P3
- **复现步骤：** Add model 填到一半，按 Escape。
- **预期：** 先关表单回列表，或确认丢弃；焦点困在 dialog 内。
- **实际：** `ComposerControls` 对任意打开的 composer 面板全局听 Escape 并 `close()`。Custom models 的 `role="dialog"` 没有 `aria-modal`、没有焦点陷阱（Lightbox 才有 `aria-modal="true"`）。
- **证据：** `ComposerControls.tsx` `closeOnEscape`；`CustomModelsPanel.tsx` dialog 无 `aria-modal`。

### P3-3 冷启动 webview 有 >1s longtask

- **严重级：** P3
- **复现步骤：** 今早第一次打开侧栏。
- **预期：** 首屏不卡一拍。
- **实际：** `webview.perf-longtask` `count 5 maxMs 1094 totalMs 1901 windowMs 30000`（act `a5b7b1` sequence 17，紧接 15888ms init 之后）。后续会话 maxMs 降到 56–375ms。
- **证据：** `droidvisx-20260813.jsonl` 上述行。属打磨，不是功能坏。

### P3-4 极窄栏 Markdown 用 `overflow-wrap: anywhere`，单词会从中间切开

- **严重级：** P3
- **复现步骤：** 侧栏拉到 320px，看含 `bubble` / `authentication` 的长句。
- **预期：** 在空格处换行；横向不裁切。
- **实际：** **没有横向裁切**（曾被截图误判）。320px 实测 `scrollWidth === clientWidth`。`anywhere` 会把 `bubble` 切成行首 `bble`。
- **证据：** `artifacts/qa-overflow.out.json`、`artifacts/qa-overflow-320.png`；`.dvx-markdown { overflow-wrap: anywhere }`（`12-exploration-ticker.css`）。

---

## 已验证通过

这些面本轮有日志、装置或活体探针，**可以当作用户能用的**（在已知在修项之外）：

| 面 | 证据 |
| --- | --- |
| 默认 daemon 模式 | 今早多次 `runtime.mode` `mode=daemon` `source=default` |
| 排队入队并在回合结束后自动发出 | `host.queue.added`「你好」→ `host.turn.accepted` kind=`queued` → `host.queue.dispatched` remaining=0 |
| AskUser / 权限卡打开并关掉 | 今早 `host.interaction.opened` ask-user ×2 + permission ×1，均有 `interaction.closed`；暗色 Deny/Approve：`artifacts/qa-dark-permission.png` |
| 附件空选区 / 无编辑器有明确诊断 | `attachment-empty`：「Open a text editor first…」「Select text in an editor first…」 |
| HTML Preview 能打开真实文件 | `host.preview.opened` `烟花.html` 17518 bytes（壳主题见 P2-1） |
| 暗色聊天壳 token | 真实 `dist/webview`：shell `rgb(26,26,26)`，发送键浅灰底深色箭头，抽样无暖白/品牌橙泄漏（`artifacts/qa-visual.out.json`） |
| 暗色空态 / 模型弹出层 / 命令卡井 | `qa-dark-empty.png`、`qa-dark-model-popover.png`（含 **+ Add model...**）、`qa-dark-command-card.png` |
| reduced-motion | `18-interactions.css` 对 `.dvx-shell *` 强制 `animation-duration: 0.001ms`；暗色把 shimmer 字色改到 `#9a9a9a`，不是暖棕 |
| BYOK 空列表 / 加载 / 失败 / 并发冲突文案 | 代码里有固定句：`No custom models configured yet.` / `Loading custom models…` / `CUSTOM_MODELS_CONFLICT_MESSAGE` / `CUSTOM_MODELS_BUSY_MESSAGE` |
| 诊断连续去重 | 同 code+message 连点不叠卡（`appendDiagnostic`） |
| **Stop 打断回合** | 活体 `artifacts/qa-live-interrupt.ts`，模型 `custom:DeepSeek-V4-Flash-0`，outcome=`interrupted`（`qa-live-interrupt.out.json`） |
| **短回合成功 + Fork + rewind-info** | 活体 `qa-live-fork.ts`：回答 `pong`，fork 得到新 `sessionId` `2c979e15-…`，无文件变更时 rewind-info `0/0` |

---

## 本轮覆盖与缺口

**用过的手段：** 今早真实 Cursor 日志 + Factory `droid-log-single.log`；`dist/webview` 暗色装置（`artifacts/qa-visual.mjs`）；Preview 壳装置；320px overflow 测量；源码静态巡检；两条生产 Runtime 活体探针（Flash BYOK，一次一个）。未跑 vitest、未打包、未改生产代码。

**还没做、不要当成已绿：**

- 图片附件、`/btw`、compact 完整跑完、归档/还原、会话搜索、切会话、排队中再 Stop
- compact：用户今早点了 compact（`runtime.compact.started` 02:03:27）后约 21s Reload，没有 `compact.finished`——归到已知「Reload 杀回合」，不单列 compact 缺陷
- **第二轮（未开始）：** v0.3.0 重装后的 Add to Chat 右键、设置里主题切换、BYOK 面板真机、以及那四条在修项是否真的修好

---

## 第二轮增量（待 v0.3.0 安装）

当前 `cursor --list-extensions` 仍是 **0.2.0**。`dist/` 下没有新的 0.3 vsix。分诊代理打包装完后，在本文件追加：

1. 右键 Add Selection：冷启动是否仍静默丢（P1-1）、连点是否双 chip（P2-5）
2. `droidvisx.theme` auto/light/dark 即时切换、Reload 后是否保持、设置 UI 与 Composer 是否一致
3. BYOK 面板：真机 list/save/冲突文案、键盘、Escape
4. 启动是否还弹终端、Reload 是否还杀回合、daemon 模型列表是否能选、锚卡真机

（本节有结果后再改统计表。）
