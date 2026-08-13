# DroidVisX 交接文档（2026-08-13 收工版，跨会话/跨 AI 接手）

> 读这一份就能接手。它是本次长会话结束时的准确快照。其余权威文档：
> [`HANDOVER.md`](../HANDOVER.md)（总路线）、
> [`implementation-status.md`](./implementation-status.md)（实现台账）、
> [`acceptance-v0.4.0.md`](./acceptance-v0.4.0.md)（当前包验收清单 + 5 分钟点测路径）、
> [`decard-design-proposal.md`](./decard-design-proposal.md)（去卡片化设计 + ticker 定稿值）、
> [`mission-control-feasibility.md`](./mission-control-feasibility.md)（Mission/子代理能力实测，§0.8 是子代理面板的技术地基）、
> [`qa-bug-report-v0.3.md`](./qa-bug-report-v0.3.md)（QA 缺陷单）。

## 0. 一句话现状

**v0.4.0 已打包装机**（`droidvisx.droidvisx@0.4.0`），全部门禁绿，工作树干净
（v0.4.0 代码 HEAD = `5d64af2`，其上仅有文档同步提交，`src/` 与包内容不受
影响），**没有在飞的代理**。用户尚未对 v0.4.0 做真人点测。
下一个 AI 的第一要务：**等用户的 v0.4.0 点测反馈**，或在用户发话后从 §4 / §5 里挑一块做。
**不要自作主张开工**——用户 2026-08-13 明确叫停过一次"未经发话就起代理"。

## 1. 已交付并提交

v0.4.0 包内关键提交（新到旧）：

- `5d64af2` / `c0d1557` v0.4.0 验收清单 + 版本 bump + CHANGELOG（补记了漏掉的 0.3.0）
- `44f8924` **ticker 手感对齐用户定稿值**（280ms / 26px / `cubic-bezier(0.22,0.61,0.36,1)`，
  做成 ticker 局部自定义属性，不动共享动效 token）
- `f3aae18` / `d828cf9` 验收规则变更 + 四份文档入库
- `34cff89` / `643b4d6` / `77115f6` **Changes 实时账本三层**（Bridge v10 流式
  `changes.update` + 契约外移到 `changesProtocol.ts`；Host 防抖串行 numstat 账本；
  Webview 钉在首现位置的 Ledger，行 hover 零灰底，footer 一行 Review / Commit…）
- `cd2ab29` 计划锚卡 → 细条计划（锚在触发消息下方、暂时吸顶、圈圈步骤、无灰底 hover）
- `1466e70` ticker 旧行上滑同时渐隐
- `b5aa9bb` Add to Chat 冷启动选区暂存（连上前不丢 + 状态栏反馈）
- `346fafb`/`9c72d90`/`aef2d0d`/`d5c1738` QA 四修（预览工具栏窄宽换行 / 命令卡失败色 /
  去重 chip / diff 失败带路径）
- `dff9dda` **Reload 保住运行中回合**（daemon 分离不中断）
- `fa2f880` 排队消息持久化，Reload 后暂停态恢复
- `9384977` **daemon 模式模型选择恢复**（settings.getDefaults 供 48 模型目录）
- `5414e3a` TodoWrite 归一化（修计划卡真机不渲染）
- `1c0e040` **Windows 去掉 detached，daemon 不再弹控制台窗口**
- `5fa020d`/`7583f73`/`d536d13`/`dd82e29` BYOK Add model（协议 v9，凭据黑盒）
- 深色主题（`aae8a2e` 一带，炭黑 token + Auto/Light/Dark）
- 大重构（三巨石文件拆 46 模块，颜色 token 集中在 `styles/00-tokens.css`）

## 2. v0.4.0 包信息

- `dist/droidvisx.vsix`，1,665,137 字节，13:30:47，SHA-256 `3BE5D52C…9FE5F`，发布提交 `c0d1557`
- 装机确认：`cursor --list-extensions --show-versions` → `droidvisx.droidvisx@0.4.0`；
  安装目录的 `extension.cjs` / `webview.js` / `webview.css` 三个 SHA-256 与本次 build 逐字节一致
- 门禁：三段 typecheck 绿、`lint:budgets` 绿、`vitest --maxWorkers=4` **103 文件 2033 例全绿**
  （32.33s）、build 绿、`verify:vsix` 11 条目绿
- **装完必须 Reload Window**：协议已到 **v10**，旧窗口握手会被拒 = 面板空白
- 六条冒烟均为数值断言，明细见 [`acceptance-v0.4.0.md`](./acceptance-v0.4.0.md)：
  Changes 账本真实回合 6 帧 writing + settled 对账 / 真实 dist hover 背景实测
  `rgba(0,0,0,0)` / plan 细条五场景锚位正确且滚动会离开吸顶 / ticker 同帧
  `translateY −11.9px` 时两行 opacity `[0.54,0.46]` / Reload 是重接不是重发
  （`sendTurnNeverCalled`）/ 排队消息 reload 后 `paused:"dispatch-blocked"` 且静置零派发
- **本包没有真人点测**，视觉审美按新规则未自评

## 3. 验收规程（2026-08-13 用户决定，已写入 `AGENTS.md` 第 8 步）

旧的"强制自验收（代理自己截图自评）"**已废除**。理由：代理拿自己的审美给自己的实现
打分，结构上必然通过——用户后来指出的丑（终端样式、plan 雷霆大卡、图片预览过大、
btw 做成抽屉、ticker 不丝滑、picker 塑料感）一条都没被那一环拦住。现在是三档：

1. **边做边跑**：只跑受影响的 focused vitest + 相关那段 typecheck。
2. **功能收口**（每切片必过）：focused vitest 绿 → `pnpm run typecheck`（三段）→
   `pnpm run lint:budgets`（TS/TSX 900、CSS 800、测试 2000，ratchet 只许变小，
   碰顶必须拆文件）→ **行为冒烟**（真实运行时驱动真实交互并断言可观测结果；
   两种形式：headless Chrome 加载真实 `dist` 装置页做数值断言，或真起 daemon +
   一次性 scratch 会话让真模型真干活）→ 更新台账 → 精确 `git add` 提交。
   相邻态必走：空 / 运行中 / 报错 / hover / 收展 / 切会话 / reload。
   碰 Runtime 或能力层另加 `smoke:runtime`、`smoke:capabilities`。
3. **发版时**：`package:prepare`（typecheck + 全量 vitest + budgets + build）→
   `package:vsix` → `verify:vsix` → `cursor --install-extension`。
   全量 vitest **必须** `--maxWorkers=4`（机器 16GB，曾因重活叠加换页把用户另一窗口压死）。

**禁止**代理给自己的截图打审美分。截图只作为某条具体断言的证据留在 `artifacts/`。
审美签收归用户，走 `artifacts/kitchen-sink-harness.html`。

## 4. 待办 A：样板间视觉意见落地真身（用户已认可形态，未开工）

准绳规则：**`artifacts/kitchen-sink-harness.html` = 视觉准绳，真身照它搬**。八项：

1. **终端展开动画不够丝滑**——展开要有连续的高度 + 透明度过渡，不是瞬开。
2. **有缩略图时不再出冗余 IMAGE chip**——图片消息已有缩略图，下面的 `Image image.png`
   属重复信息。
3. **会话抽屉**三改：自然下滑展开的动画感、整体矮一档、chats **最新排前**
   （用户原话"每次找个 chats 都要好久"）。
4. **计划细条**：内边距加大、左右**贴齐聊天框宽度**（现在两侧空了一点）。
   圈圈步骤形态已在 `cd2ab29` 落地，只需核对真机与样板间一致。
5. **View source 去掉灰色 hover 卡**——用户原话"我真的很讨厌这种的，看着很廉价"。
6. **`Droid is working` 与上方间距收紧**。
7. **终端井跟随主题**：浅色主题浅井、深色主题深井（现在固定深井）。
8. **模型选择 & 模式切换弹层轻量化**——用户原话"有种廉价塑料感，不像 cursor 那么轻"。

**逐项准绳判定**（重要）：先确认样板间是否已呈现修正后的形态。已呈现 → 照它逐值搬
（取它的时长/曲线/间距/token），不要另发明一套。未呈现 → **先改样板间**（让用户能审）
再让真身与之一致，并在报告里标明"这项样板间原无参考形态，是新拟的"并给出确切数值。
严禁擅自扩大到这八项之外。

## 5. 待办 B：子代理面板 + 转录回放（证据已齐，用户最想要，未开工）

用户诉求原话精神："在进行子代理探索的时候，左边放个 Working 和转圈，打开后能看到
每个子代理在干嘛，把我们有的操作放里面——看和停止。"对现状的评价是
"这部分做的跟坨屎一样怎么用"。具体痛点：看不出还在跑还是结束了、点进去看不到它
在干什么、停不掉单个、**刷新之后子代理就没了**。

技术地基已用真机探针验过（`mission-control-feasibility.md` §0.8，**不要重复探**）：

- **行数据源**：拦 `Task` 的 tool_call 取 `description`/`subagent_type`，配对 tool_result
  取 `task_id`（= 子会话 session id）。
- **准实时活动**：对活着的 `task_id` 轮询 `sessions.getMessages(task_id,{limit})`，
  取末个 tool 名作为"此刻在干嘛"，2–3s 退避。
- **单独停止可行**：`sessions.resume(task_id).interrupt()` 实测**只停那一个、其余继续**。
  这推翻了早前"回合外子代理停不掉"的结论（当时错在打断父会话）。
  用户原话："那就做显示状态，不放 stop 不就行了吗，什么还要加个按钮然后变成灰色，
  这不是搞笑吗"——**要么给能用的 Stop，要么别放按钮，禁止禁用态占位**。
- **逐子代理成本**：读子会话 sidecar 的 `tokenUsage`。
- **不要依赖 `child_session_available` 通知**（daemon 内部消费掉，实测收不到）。
- **回放**：子代理会话有自己的 jsonl，点开在右侧分栏只读展示；壳复用 `/btw` 的
  `SideChatSheet`（它已经是右侧共生分栏，**不要改回浮层/抽屉**）。

实现要点：Host 侧子代理注册表需**跨 reload 存活**（daemon 模式父回合都能重接，
子代理行不该刷新就消失）；`src/shared/bridgeMessages.ts` **已压在行数预算上限
（当前 2200 行，ratchet 上限 2202）**，新契约必须外移到独立文件（参照 `src/shared/changesProtocol.ts`
的做法）；视觉遵守 UI restraint 与轻奢标准，**不要新增灰色 hover 卡、塑料填充块、大卡片**。
性能红线：只轮活着的 task、2–3s 退避、面板关闭降频或停、`limit` 收敛、消息增量 diff
而非整树重渲染。

冒烟必须真起 daemon + 真实会话开出**至少两个** `Task` 子代理，断言：两行都在且带各自
描述 / 活动文字随轮询更新 / 对其中一个 interrupt 后**只有它变终态而另一个继续跑** /
点"看"能拉到该子会话消息 / **dispose 重建一代 ChatController（模拟 Reload）后行仍在**。
可复用的真机脚手架：`artifacts/smoke-changes-ledger-live.mts`、`artifacts/probe-queue-reload.mjs`。

## 6. 待办 C：Mission 观察台（可行性已翻案，做不做等用户拍板，未排期）

`mission-control-feasibility.md` §0.5–0.7 已翻案为"可启动 / 可暂停 / 可恢复"，但
**Droid mission 严格串行（同时至多 1 worker）**，所以面板应是 Feature 清单而不是
多 worker 网格；"停当前 worker"会暂停整个 mission。用户此前多次说"任务那里还是
控制不了"，后被探针推翻，但**是否排期由用户决定**。

## 7. 并行工作纪律（本轮踩过坑，务必遵守）

- **文件归属必须先划清再并行**。三巨石已拆成 46 模块，所以并行是可行的，但两个代理
  绝不能同时编辑同一文件。典型的两块划分：视觉批（`styles/00–24`、`SessionDrawer`、
  `ComposerControls`、`ToolOutputPreview`、`thread/transcriptRows`、`thread/activityRows`、
  kitchen-sink HTML）与功能批（`WorkingBadge`、`SideChatSheet`、`store.ts`、
  `bridgeMessages.ts` 与新 `*Protocol.ts`、`validateHostMessage.ts`、`extension/chat/`、
  `runtime/`、新建 `styles/25+`）互不重叠。
- **`pnpm run build` / `dist/` 是独占资源**。并行时用建议锁 `artifacts\.build-lock`：
  build 前检查，存在且修改时间 <15 分钟就等 60–90s 重试；取锁写入自己的名字，
  用完 `Remove-Item`。不要硬闯。
- **`implementation-status.md` 只许追加，不许覆盖**别人的条目。
- 提交一律**精确 `git add <path>`**。严禁 `git add -A` / `git add .` /
  `git checkout .` / `git reset --hard` / `git clean`。
- **16GB 内存**：重活一次只跑一条链，全量 vitest 限 `--maxWorkers=4`。
  本轮发生过"真实回合 + 全量 vitest + 探针"叠加换页把用户另一窗口压到无响应。
- **未经用户发话不要起代理开工**。用户 2026-08-13 明确叫停过一次。

## 8. Backlog（用户已定，发版后做）

MCP 持久权限 UI、会话标签（只读展示 + 过滤）、工具启停白名单、后台任务通知中心、
会话搜索增强、"Show earlier messages" 批量挂载性能优化、对话小地图（设计稿在
`conversation-minimap-design.md`）、HTML 预览面板暗色壳（QA P2 遗留）。

## 9. 已知残差（如实告知用户，非新 bug）

- **v0.4.0 未经真人点测**，全部是自动化断言。
- daemon 彻底起不来时回退 process 约慢 64s（首个会话）。
- daemon 低自治下工作区文件创建不触发权限请求（上游行为差异）。
- 归档列表只见最新 100 条窗口（limit=100 修复已在包内）。
- QA v0.3 快修四条仍未真机验证（按用户叫停中止）。
- Changes 账本的"切走再切回"回放、失败回合原地翻头、账本与计划细条同屏的吸顶
  相互作用，都只有单测覆盖，未真机验。
- `src/shared/bridgeMessages.ts` 恰好压在 ratchet 顶（当前 2200 行 /
  上限 2202），下一个碰它的切片必须继续拆域。
- 实录脚本发现一个诊断缺口：settings 更新确认帧发出后 `settingsUpdate` 要到下一
  microtask 才清，紧贴着发 `turn.send` 会被**静默丢弃**。生产用户手速到不了这个
  窗口，但"静默丢弃"本身值得补一条诊断。
- `artifacts/tmp/changes-ledger-live-*` 留有三个 scratch 目录（早期失败运行的 daemon
  可能仍握句柄，删除会 EPERM），无害，可日后清理。

## 10. 交接给下一个 AI 的第一步

1. 读本文件 + [`acceptance-v0.4.0.md`](./acceptance-v0.4.0.md) +
   `implementation-status.md` 尾部若干 §。
2. `git status` + `git log --oneline -25` 对齐真实状态（应为干净树；v0.4.0
   代码 HEAD 为 `5d64af2`，其上仅有文档同步提交）。
3. **先问用户 v0.4.0 点测结果**。有 bug 单就先修 bug，别抢着做 §4/§5。
4. 用户发话后再开工；开工前按 §7 划清文件归属。
5. 全程遵守 `AGENTS.md`：行为冒烟（真实运行时 + 断言，不是截图自评；审美由用户在
   `artifacts/kitchen-sink-harness.html` 过）、轻奢视觉（无塑料色、无裸卡片、
   无灰色 hover 卡）、精确 git add、16GB 错峰。
