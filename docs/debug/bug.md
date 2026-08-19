# Bug 修复

只跟进 **功能/行为缺陷**。样式、子代理探索、功能扩展见同目录其他文档。  
状态词：`已完成` / `待实机验收` / `未做` / `部分` / `待验证`。  
编号沿用原始清单；已删除编号 **6**。

---

## 已完成

| 编号 | 问题 | 截图 | 版本 / 质量注 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 等待队列时无法提前发送 | [image/发送队列问题.png](./image/发送队列问题.png) | 质量好 | 已完成 |
| 2 | 吸顶卡片过高，影响视觉 | [image/高度.png](./image/高度.png) | 质量好 | 已完成 |
| 3 | btw 聚焦聊天框边界颜色有问题 | — | 质量好 | 已完成 |
| 4 | btw 在 AI 发消息时无法自然上移 | — | 质量好 | 已完成 |
| 5 | `/ide` / 工作区混乱；不同 Cursor 文件夹与会话进程关系 | [image/选中文件混乱.png](./image/选中文件混乱.png) | Problems 已修；**选区附件仍可能混工作区** → 见下方复验 | 部分 |
| 7 | `/btw` 应先初始化，而非等首条消息 | — | 质量好 | 已完成 |
| 8 | btw 搜索框两层外边框（外层灰框应删） | — | 与主 Composer soft shadow **不完全同构**，关联 **19**（样式册） | 部分 |
| 9 | 吸顶卡片近距闪烁 / 向下滚动被回拉 | — | 质量好 | 已完成 |
| 13 | 提示出现后不消失 | [image/提示不消失.png](./image/提示不消失.png) | v0.7.21 | 已完成 |
| 14 | 模型名后带 `0`，非 display 名 | [image/模型名字不符合.png](./image/模型名字不符合.png) | v0.7.18 | 已完成 |
| 15 | 生成中无法 review；写入无 `+87 -12` 进度 | — | v0.7.22 | 已完成 |
| 17 | 计划卡片两个堆叠，旧计划未去掉 | — | v0.7.24 | 已完成 |
| 18 | 文件 preview 位置异常（二次改写后丢失） | — | v0.7.22 | 已完成 |
| 29 | 终端 failed 的命令错误放在终端卡片外 + ANSI 乱码 | [image/重命名.png](./image/重命名.png) | v0.7.27：错误文本并入终端 well（无输出时单独入 well），`stripTerminalNoise` 在 Runtime 源头剥离 ANSI/控制符 | 已完成 |
| 32 | 长任务不停止；Stop 无效；待发送卡住；reload 后结束态缺 fork 等 | [image/长任务不停止.png](./image/长任务不停止.png) | v0.7.27：Host 侧 turnWatchdog——Stop 超 10s 未结算则本地强结算为 interrupted（先补一次 `interruptSession`），streaming 主 turn 在 30s 宽限后连续 3 次读到 daemon idle 则按 completed 结算；结算前重载持久历史补内容，队列/action bar 随终态恢复 | 已完成（待实机验收） |

---

## 待复验 / 待验证

| 编号 | 问题 | 截图 | 说明 | 状态 |
| --- | --- | --- | --- | --- |
| 5 | 选区附件仍可能混工作区 | [image/选中文件混乱.png](./image/选中文件混乱.png) | Problems 路径已修。残留范围（2026-08-15 复核）：`vscodeAttachmentSources.ts` 的 `readActiveSelection`/`readActiveFile` 抓「当前活跃编辑器」，**不做工作区 containment 过滤**；工作区外文件按设计保留全路径以便定位。多窗口/多根场景下选区可能来自别的文件夹——待实机确认是否为真实困扰再决定是否加过滤 | 部分 |
| 8 / 19 | btw（及 add model）边框 / soft shadow 与主 Composer 不一致 | [image/灰色外层边框.png](./image/灰色外层边框.png)、[image/原边框.png](./image/原边框.png) | 8 有隐患；19 审计标 v0.7.18 已改，样式册为待实机验收；实机对照主 Composer（本轮不动 CSS，样式归 style-refactor） | 待实机验收 |
| 35 | plan：执行中应实时出卡并随推送更新，而非结束后才显示 | — | 2026-08-15 代码审计：链路全程实时——Runtime 在 `tool-start` 即带 plan detail（`extractToolDetail`），Host 收到即 emit `tool.activity`，Webview store 活跃回合内实时 upsert 进 transcript，plan 行由 transcript 纯推导（`selectPlanAnchors`）。未发现「结束后才显示」的代码路径；**待用户实机复现**（若复现，方向是 daemon 事件送达延迟而非投影缺口） | 待实机验证 |

---

## 未做

| 编号 | 问题 | 截图 | 根因摘要 / 证据指针 | 状态 |
| --- | --- | --- | --- | --- |
| 36 | 久对话恢复差：长会话恢复后内容大量缺失，实时卡片信息（终端输出、耗时、changes 行数、diagnostic 卡）丢失 | — | **代码已落地、未打包装机**（工作区，目标 v0.7.28）。`reconcileSessionHistory` 按锚点合并 recovered 富态（outputTail / durationMs / changes ±行 / diagnostic）；thinking 按 1/8 权重记账。详见 [handover-2026-08-15.md](./handover-2026-08-15.md)。原根因：预算裁剪把 43MB 会话裁成 141 行 + 对账整段丢弃富态 | 部分（代码未装包） |
| 37 | 切换会话慢：常态 5–8s，最差 14.6s 才可用 | — | **代码已落地、未打包装机**。`DaemonSessionHistoryLoader` 走 daemon `getMessages` 分页，消灭 ~5s spawn 税；`replaceRuntime` 检查点先行渲染；子代理轮询不再 spawn。`runtime.initialize`（1.6–9s）仍是 CLI 侧瓶颈。详见交接文档 | 部分（代码未装包） |

---

## 不在本册

| 编号 | 去向 |
| --- | --- |
| 10 / 20、11、12、19、22 / 27、23、24、26、30、33、34 | [style-refactor.md](./style-refactor.md) |
| 16、31 | [explore-subagent.md](./explore-subagent.md) |
| 21、25、28 | [feature-extend.md](./feature-extend.md) |
| 6 | 已删除（shared daemon 已确认修复） |
