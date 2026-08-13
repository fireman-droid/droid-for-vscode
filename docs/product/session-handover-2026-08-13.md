# DroidVisX 交接文档（2026-08-13，跨会话/跨 AI 接手）

> 读这一份就能接手。它是本次长会话结束时的准确快照。其余权威文档：
> [`HANDOVER.md`](../HANDOVER.md)（总路线）、
> [`implementation-status.md`](./implementation-status.md)（实现台账）、
> [`decard-design-proposal.md`](./decard-design-proposal.md)（去卡片化设计 + ticker 定稿值）、
> [`mission-control-feasibility.md`](./mission-control-feasibility.md)（Mission/子代理能力实测，**含未提交更新，见 §7 警告**）、
> [`qa-bug-report-v0.3.md`](./qa-bug-report-v0.3.md)（QA 缺陷单）。

## 0. 一句话现状

已安装 **v0.3.0**（真机可用）。今天又完成一批 UI 定稿与修复但**尚未打包**；
有 1 个后台代理仍在跑、工作区有它的未提交半成品，**下一个 AI 的第一要务是：
等它落地→清干净工作区→做一次统一 v0.4.0 build，把所有已提交定稿一起装机**。

## 1. 已交付并提交（git log，HEAD = `cd2ab29`）

v0.3.0 及之后已在主线的关键提交（均已过门禁，未全部打包）：

- `cd2ab29` 计划锚卡 → 细条计划（锚在触发消息下方、暂时吸顶、圈圈步骤、无灰底 hover）
- `1466e70` ticker 旧行上滑同时渐隐（**注意：手感值待按 §5 微调**）
- `1f88e5f` / `23e8de9` v0.3.0 验收清单 + QA 修复批记录
- `b5aa9bb` Add to Chat 冷启动选区暂存（连上前不丢 + 状态栏反馈）
- `346fafb`/`9c72d90`/`aef2d0d`/`d5c1738` QA 四修（预览工具栏窄宽换行 / 命令卡失败色 / 去重 chip / diff 失败带路径）
- `dff9dda` **Reload 保住运行中回合**（daemon 分离不中断；四场景真机验过）
- `fa2f880` 排队消息持久化，Reload 后暂停态恢复
- `9384977` **daemon 模式模型选择恢复**（settings.getDefaults 供 48 模型目录）
- `5414e3a` TodoWrite 归一化（修计划卡真机不渲染）
- `1c0e040` **Windows 去掉 detached，daemon 不再弹控制台窗口**
- `5fa020d`/`7583f73`/`d536d13`/`dd82e29` BYOK Add model（协议 v9，凭据黑盒）
- 深色主题（`aae8a2e` 一带，炭黑 token + Auto/Light/Dark）
- 大重构（三巨石文件拆 46 模块，颜色 token 集中在 `styles/00-tokens.css`）

## 2. ⚠️ 当前在飞 / 未提交（接手前必看，别乱动）

**一个后台代理仍在跑：Changes 实时账本切片**（agent id `f67636c0-3130-4453-89c8-3fda2a9f00df`）。
它把 Changes 从"回合末汇总卡"改成"边写边出的实时账本"（去灰底 hover）。
判断：转录静默但 12:38 有活跃 node 进程（build/自验收在跑），**是活的不是死的**。
它的未提交文件（**不要覆盖、不要 `git checkout`、等它自己提交**）：

```
src/extension/turnChangesLedger.ts (+test)   ← 新增
src/extension/chat/internals.ts, chat/turnFlow.ts
src/shared/bridgeMessages.ts                 ← 可能再 bump 协议（当前 v9）
src/webview/assistant/store.ts (+test), runtimeAdapter.ts
src/webview/assistant/thread/transcriptRows.tsx  (ChangesSummary)
src/webview/assistant/GitCommitPanel.tsx
src/webview/assistant/styles/05-message-cards.css, 06-git-commit.css, 24-theme-dark.css
src/webview/bridge/validateHostMessage.ts (+test)
```

**`docs/product/mission-control-feasibility.md` 的未提交修改属于用户的另一位助手——
全程别动、别提交、别还原（见 §7）。**

接手动作：等 Changes 代理完成通知 → `git status` 确认它已提交、工作区只剩
mission-control-feasibility.md → 才可 build。

## 3. 待办 A：统一 v0.4.0 build（最高优先）

Changes 落地后，按顺序：
1. 先把 ticker 手感微调进真身（§5 的确切值），提交。
2. 复跑 `package:prepare`（三段 typecheck + 全量 vitest `--maxWorkers=4` + lint:budgets 全绿）。
   —— 今天多次出现"整树红点全是并行在途文件"的情况，Changes 落地后应自然转绿；不绿要查。
3. `pnpm run build` → `verifyVsix` → `vsce package` → `cursor --install-extension dist/droidvisx.vsix`。
4. 版本 bump 0.3.0 → **0.4.0**；验收清单加新章节（Add to Chat 右键、深色主题、BYOK、
   计划细条、Changes 账本、ticker、模型选择恢复、弹终端修复、Reload 存活）。
5. 装完提醒用户 **Reload Window**（协议已到 v9，旧窗口握手会被拒 = 面板空白，Reload 即恢复）。
6. 资源纪律：机器 **16GB 内存**，今天因"真实回合 + 全量 vitest + 探针"叠加发生过换页风暴
   把用户另一窗口压到无响应。**重活一次只跑一条链，vitest 限 `--maxWorkers=4`**。

## 4. 待办 B：去卡片化设计落地（用户已看样板间第二版，方案 A 全部认可 + 修正）

设计与视觉稿见 [`decard-design-proposal.md`](./decard-design-proposal.md) 与
`artifacts/kitchen-sink-harness.html`（融合预览第二版，浏览器打开可交互）。
**规则：kitchen-sink HTML = 视觉准绳，真实代码照它搬**。四个对象：

- **计划条**：已提交 `cd2ab29`（圈圈步骤 / 无灰底 / 贴合宽度）。核对真机与样板间一致。
- **Changes 账本**：Changes 代理正在做（§2）。行 hover 无灰底、footer 一行 Review/Commit。
- **工具活动行**：透明行 + 三级字色 + hover 才显动作。**尚未落地为独立切片**——
  部分随命令卡/ticker 已改，需核对是否全部去灰底。
- **Restore 控件**：发送键旁回转图标开关（撤 checkbox 方框）。**尚未落地**。
- 另有样板间第二版里用户认可的：命令卡展开动画、图片有预览则不重复 IMAGE chip、
  会话抽屉（下滑展开 + 矮一档 + 最新在前）、View source 去灰底、"Droid is working" 间距收紧、
  **浅色主题用浅色终端井/深色用深井**、模型&模式弹层轻量化（治塑料感）。
  这些**大部分尚未落进真实代码**，需按样板间逐项搬。

## 5. ticker 手感（用户逐值定稿，`artifacts/ticker-mini.html` 确认）

真身 `ActivityTicker`（`src/webview/assistant/thread/activityRows.tsx`）+
`styles/12-exploration-ticker.css` 当前是 300ms + `--dvx-easing-out-strong`，**改为**：

- 时长 **280ms**、曲线 **`cubic-bezier(0.22, 0.61, 0.36, 1)`**、行高 **26px**
- 机制不变（轨道上移一行 + 行级透明度、旧行上滑同时渐隐、新行下方滑入淡入、
  compositor-only、reduced-motion 瞬切）。

## 6. 待办 C：子代理面板 + 转录回放（证据已齐，用户想要，未开工）

用户最想要"像 Cursor 一样看子代理在干嘛、能单独停、点开看它内部对话"。
`mission-control-feasibility.md` 的 §0.8 已用真实探针证明**在 `Task` 子代理层完全可做**
（不需要 mission、不需要特殊模式）：

- 行数据源：拦 `Task` tool_call 取 `description`/`subagent_type`，配对 tool_result 取 `task_id`（= session id）。
- 实时活动：对活 `task_id` 轮询 `sessions.getMessages(task_id,{limit})` 取末个 tool 名（2–3s 退避）。
- **单独停止：`sessions.resume(task_id).interrupt()` 实测只停那一个、其余继续**——
  这推翻了之前"回合外子代理停不掉"的结论（当时错在打断父会话）。Working 徽标弹层可据此恢复真 Stop。
- 逐子代理成本：读子会话 sidecar `tokenUsage`。
- **不要依赖 `child_session_available` 通知**（daemon 内部消费，实测收不到）。
- 完成回放：子代理会话有自己的 jsonl，点开在右侧分栏（复用 `/btw` 的 `SideChatSheet` 壳）只读展示。

Mission 层（§0.5–0.7）也翻案为"可启动/可暂停/可恢复"，但 **Droid mission 严格串行
（同时至多 1 worker）**，面板应是 Feature 清单不是多 worker 网格；"停当前 worker"会暂停整个 mission。
Mission 观察台**做不做由用户拍板**，目前未排期。

## 7. 绝对不要动的东西

- `docs/product/mission-control-feasibility.md` 的未提交修改（用户另一位助手所写，§0.5–0.8 的探针结论）。
- Changes 代理未提交的那批文件（§2），等它自己提交。
- 不要 `git add -A` / `git checkout .` / `git reset --hard`；提交一律精确 `git add <file>`。

## 8. Backlog（用户已定，发版后做）

MCP 持久权限 UI、会话标签、工具启停白名单、后台任务通知中心、会话搜索增强、
"Show earlier messages" 批量挂载性能优化、对话小地图（设计稿有）、HTML 预览面板暗色壳（QA P2 遗留）。

## 9. 已知残差（如实告知用户，非新 bug）

- daemon 彻底起不来时回退 process 约慢 64s（首个会话）。
- daemon 低自治下工作区文件创建不触发权限请求（上游行为差异）。
- 归档列表只见最新 100 条窗口（limit=100 修复已在包内）。
- 快修四条与 v0.3.0 重切包的真机冒烟未做（按用户叫停中止），已记验收清单未验证节。

## 10. 交接给下一个 AI 的第一步

1. 读本文件 + `implementation-status.md` 尾部若干 §（§20 起是本轮记录）。
2. `git status` + `git log --oneline -25` 对齐真实状态。
3. 确认 Changes 代理是否已落地（工作区是否只剩 mission-control-feasibility.md）。
4. 若已落地 → 执行 §3 的 v0.4.0 统一 build；若未 → 先做 §4/§5/§6 里不碰 Changes 文件的部分。
5. 全程遵守 `AGENTS.md`：强制行为冒烟（真实运行时 + 断言，不是截图自评；
   审美由用户在 `artifacts/kitchen-sink-harness.html` 过）、轻奢视觉、
   精确 git add、16GB 错峰。
