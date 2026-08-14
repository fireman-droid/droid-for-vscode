# DroidVisX v0.2.0 验收清单

写给明天做验收的用户：按组逐项操作，每项给出**操作步骤 → 预期表现 →
对应截图**（截图在 `artifacts/`，为发布包上的自动化回归产物，可对照）。
验收前先做一次：安装 `dist/droidvisx.vsix` 后 **完整退出并重启
Cursor**（不仅 Reload Window——本版本 Webview 资源有变，需清 service
worker 缓存）。

> **Bridge 协议 v7 提醒**：本版 Bridge 协议版本 6 → 7（排队消息
> `queue.promote` 契约）。装包后未重载的旧窗口里，缓存的旧 Webview
> 会在握手时被 Host 拒绝（日志 `host.bridge.protocol-mismatch`），
> 表现为面板空白或无响应——这不是 bug，Reload Window（或上述完整
> 重启）即恢复。

> 状态标注：每项开头的 `[包内已回归]` 表示发布前已在真实构建产物上跑过
> 自动化冒烟 + 截图；`[需真机确认]` 表示自动化只能覆盖部分路径，明天
> 需要在真实 Cursor 里走一遍。

---

## A. 运行架构：daemon 默认 + 静默回退

### A1. daemon 成为默认运行模式 [需真机确认]

- **操作**：不改任何设置，打开 DroidVisX 聊天面板，发送一条消息。
- **预期**：行为与之前完全一致（用户无感）。`DroidVisX: Open Logs`
  里能看到 `runtime.mode` 事件带 `mode: daemon, source: default`。
- **加验**：设置里 `droidvisx.runtime.mode` 的默认值显示为 `daemon`。

### A2. 回合跨 Reload 存活（daemon 模式红利） [需真机确认]

- **操作**：发起一个长回合（例如让 Droid 跑一个多步任务），回合运行
  中执行 `Developer: Reload Window`。
- **预期**：窗口回来后聊天面板显示"生成中"占位（不是空白/丢失）；
  若有 pending 权限请求会重新弹出；回合完成后转录被完整历史替换。
- **对应验证**：发布前 `artifacts/probe-a4-reload-controller.mjs`
  真机探针 PASS（两代进程 + 真实 daemon）。

### A3. daemon 起不来时静默回退 [包内已回归]

- **操作**（可选，破坏性）：人为让 daemon 无法启动（如 PATH 里移除
  droid），重启窗口。
- **预期**：聊天照常可用（回退到每窗口子进程模式）；无任何打扰性
  提示；日志里有一条 `runtime.mode.fallback` warn。显式在设置里选过
  `daemon` 的用户不回退（硬失败，便于排查）。
- **对应验证**：`artifacts/smoke-mode-fallback-live.mts`。

### A4. /btw 在两种模式下都可用 [包内已回归]

- **操作**：Composer 输入 `/btw 这个函数是干嘛的？` 回车。
- **预期**：右侧滑出 "Side question" 全高分栏（不遮主对话、无蒙层），
  问题与回答流式出现；主对话回合不受打扰。`×` 关闭。daemon 与
  process 回退两种模式下行为一致。
- **截图**：`btw-smoke-card-open.png`、`btw-smoke-first-answer.png`、
  `btw-smoke-follow-up.png`、`btw-smoke-narrow-320.png`（窄栏）。
- **对应验证**：`artifacts/smoke-btw.mjs` 六场景 +
  `artifacts/smoke-btw-daemon-live.mts`（daemon 真机）。

---

## B. Working 徽标与子代理弹层（今晚新切片）

### B1. "N Working" 徽标出现/消失 [包内已回归]

- **操作**：让 Droid 委派子代理（如"用 explore 子代理调查 X"），
  委派运行期间看 Composer 左上角。
- **预期**：出现安静的 "N Working" 药丸（带转圈点），N 随运行中
  委派数变化；全部结束后徽标自动消失。徽标只在有运行中委派时
  存在——包括**父回合已结束但后台委派还在跑**的窗口期。
- **截图**：`working-badge-active.png`。

### B2. 子代理列表弹层 [包内已回归]

- **操作**：点徽标。
- **预期**：弹出安静列表：每行 = 转圈动效 + "{type} subagent" +
  描述 + 实时递增的耗时；头部只显示 "N Working"。点外部或再点徽标
  关闭；不显示单行 Stop 或 Stop All。
- **截图**：`working-badge-popup.png`。

### B3. 子代理停止控件暂不提供 [包内已回归]

- **操作**：父回合运行中与结束后分别打开 Working 弹层。
- **预期**：两种状态都没有单行 Stop、Stop All、禁用占位或解释性注脚；
  Webview 不发送 `subagent.stop`。父聊天 Composer 的 Stop 仍只负责父回合。
- **截图**：`working-badge-popup.png`（纯观察弹层）。

### B4. 子代理体验审计修复（分支 `dvx/subagent-audit` 合入） [包内已回归]

- **内容**（审计切片，4 提交 7550601/62c5f53/a67844a/3756c19）：
  1. **派发身份直出**：Task 委派行的 type/描述随 tool-start 事件
     立即显示，不再等首个 status 才从 "subagent" 占位翻牌。
  2. **Reload 后僵尸自动结清**：窗口重载重挂会话后，台账轮询
     重新武装，回合外仍在跑的委派行会自动落定，不再永久转圈。
  3. **无 status 子行转圈**：父 Task 运行期间，尚无状态流的子行
     也有转圈动效，不再呈死行。
- **操作**：委派子代理后立刻看委派行头（应直接带类型与描述）；
  委派运行中 Reload Window，等后台委派结束，看该行是否自动落定。
- **截图**（前后对比）：`artifacts/subagent-before-dispatch.png` /
  `subagent-after-dispatch.png`、`subagent-reload-before-settle.png` /
  `subagent-reload-after-settle.png`、`subagent-after-settled.png`。

### B5. 运行中子行转圈动效 [包内已回归]

- **操作**：委派运行期间看转录里的 Task 委派行下的子代理子行。
- **预期**：运行中的子行带转圈动效；结束后动效停止、落定为静态
  摘要行；不再出现"回合结束后子行永远转圈"的僵尸态（Host 在回合
  结束后轮询 ledger 对账，经 `subagent.update` 增量收口）。
- **截图**：`subagent-smoke-streaming.png`（运行中转圈）、
  `subagent-smoke-settled.png`（子行落定）、
  `subagent-smoke-replay.png`（回放态）。

### B6. 子代理转录面板轻关闭 [包内已回归]

- **操作**：点 "View transcript" 后分别点击面板内部、主聊天空白处，
  再次打开后从 Sessions 选择另一段对话。
- **预期**：面板内点击保持打开；外部空白点击播放收拢后关闭；选择会话
  立即关闭并正常切换。收拢期间打开另一条子代理记录时，旧关闭计时器
  不会误关新记录。

---

## C. 会话抽屉：运行中动画与直返（今晚新切片）

### C1. 会话列表运行中转圈 [包内已回归]

- **操作**：daemon 模式下让一个会话跑长回合，切到别的会话（或
  保持抽屉打开观察）。
- **预期**：运行中会话的行内出现安静的转圈环（低调灰环、行高不
  变）；悬停该行时原有行操作（星标/归档等）仍可用；回合结束后
  转圈原位消失（增量 `session.running` 推送，无需重开抽屉）。
- **截图**：`session-drawer-running.png`、
  `session-drawer-running-hover.png`、
  `session-drawer-running-cleared.png`。

### C2. 点击记录直返聊天页 [包内已回归]

- **操作**：打开会话抽屉，点任意一条会话记录。
- **预期**：立即切换会话**且抽屉自动关闭**直返聊天页（不再需要
  手动关抽屉）；daemon 模式下运行中的回合不阻塞切换（后台回合
  继续跑，回来时经 A2 对账恢复）。
- **截图**：`session-drawer-select-closes.png`。

### C0. 归档列表恢复可用（必修 bug，修复 `4f2c1c3`） [包内已回归]

- **背景**：v0.1.1 的归档列表**完全不可用**——daemon 客户端对
  `sessions.list` 的 `limit` 有 ≤100 的 schema 硬校验，代码请求
  200 行，每次都被 ZodError 拒绝（真机日志连续 12 次
  `archived-load-failed`），抽屉 Archived 区永远为空且无报错。
- **操作**：会话抽屉里归档一个非活跃会话；展开抽屉底部的
  "Archived" 折叠区；对某行点 Restore。
- **预期**：Archived 区能真实加载出本工作区的已归档会话（不再
  静默空白）；Restore 后回到常规列表。
- **截图**：`session-drawer-archived.png`。
- **修复核实**：`4f2c1c3` 在 v0.2.0 发布提交（`1076241`）之前，
  已随包发布；`DAEMON_LIST_FETCH_LIMIT = 100`，并有测试
  `DaemonSessionCatalog.test.ts` 守住 ≤100 的 schema 上限。
- **已知边界**：一次取 100 行再按工作区过滤，早于最新 100 行窗口
  的归档会话暂不可见（daemon 门面无分页，已在代码与测试注明）。

---

## D. 排队消息（Cursor 式交互）

### D1. 运行中排队 + 折叠条 [包内已回归]

- **操作**：回合运行中，在 Composer 连续输入并回车 2–3 条消息。
- **预期**：消息不打断当前回合，Composer 上方出现一条安静的折叠条
  "N Queued · ⏎ to Send"（与计划钉条同族的暖色卡片语言）；回合结束
  后队首自动派发，条上计数递减。
- **截图**：`queue-bar-collapsed.png`。

### D2. 展开列表：编辑 / 立即发送 / 删除 [包内已回归]

- **操作**：点折叠条展开；悬停任一行。
- **预期**：每条排队消息一行（超长截断、附件显示 `[image]` 类标记），
  行尾出现三个安静图标：铅笔（编辑）、上箭头（立即发送）、垃圾桶
  （删除）。点外部或 Escape 收起。
- **截图**：`queue-bar-expanded.png`。

### D3. Edit Queued 回填 Composer [包内已回归]

- **操作**：点某行铅笔。
- **预期**：该行文本回填进 Composer，Composer 出现 "Edit Queued ×"
  chip，行上出现 Editing 标记且行不移位；改完回车 = 原位替换该条
  （不新增、不派发）；Escape 或点 chip 的 × 取消并清空草稿；打开
  已发消息的编辑卡会自动取消队列编辑（两种编辑互斥）。
- **截图**：`queue-bar-editing.png`。

### D4. 立即发送（send now） [包内已回归]

- **操作**：点某行上箭头。
- **预期**：该条跳到队首（运行中回合不被打断，纯排序）；若队列处于
  暂停态则同时恢复自动派发。
- **对应验证**：`artifacts/smoke-queue-bar.mjs`（wire 上有
  `queue.promote`）。

### D5. Stop 后的暂停态 [包内已回归]

- **操作**：排着队时点 Stop。
- **预期**：队列保留、自动派发暂停；折叠条 meta 变 "paused after
  stop"（暖色警示字），条自动展开一次露出 "Send now / Clear"；点
  Send now 恢复派发，点 Clear 清空。
- **截图**：`queue-bar-paused.png`。
- **加验**：队满 10 条时 meta 显示 "queue full"（`queue-bar-full.png`）。

---

## E. 计划锚点卡（Created Plan card）

### E1. 流式出现与就地更新 [包内已回归]

- **操作**：让 Droid 做一个会建任务计划（TodoWrite）的任务。
- **预期**：第一次 TodoWrite 时对话流内、创建位置出现 "Created Plan"
  卡（不再是 Composer 上方钉条），运行中显示暖色 "Building… n/m"；
  后续计划更新在**同一张卡**就地刷新，不出第二张。
- **截图**：`plan-anchor-building.png`。

### E2. 展开/收起与完成态 [包内已回归]

- **操作**：点卡上 View Plan；再点 Hide Plan；等任务全部完成。
- **预期**：展开显示完整步骤清单（completed 勾、in-progress 点、
  pending 空）；收起还原；全部完成后卡安静落定为 "Completed n/m"。
- **截图**：`plan-anchor-expanded.png`、`plan-anchor-completed.png`、
  `plan-anchor-collapsed.png`（恢复会话的静默 n/m 态）。
- **对应验证**：`artifacts/smoke-plan-anchor.mjs` 三场景。

---

## F. 终端命令卡（今晚新切片，提交 `c7f9245`）

### F1. 卡头与折叠态 [包内已回归]

- **操作**：让 Droid 跑一条终端命令（Execute 工具），看转录里的
  命令行条目；点 chevron 折叠。
- **预期**：Execute 行升级为命令卡：白底 1px 边框圆角软阴影（与
  消息流卡片家族一致）；卡头一行式——标题优先用模型自带的
  summary，没有则用规则标题（首个实义命令名 + 至多两个参数，
  不发明数据）；标题右侧 muted 等宽芯片列出解析出的命令名（去重
  ≤4 个）；折叠态只剩卡头一行。
- **截图**：`command-card-collapsed.png`、
  `command-card-expanded-short.png`。

### F2. 命令井与语法高亮 [包内已回归]

- **操作**：展开卡片看命令区与输出区。
- **预期**：命令区是暖暗琥珀"终端井"（色温与暖白壳一致、非冷蓝），
  `$` 前缀 + 规则分词高亮（命令名加粗杏色、flag 沙色、字符串橄榄
  等），软换行悬挂缩进；输出区等宽、深一档色 + 暖发丝线分隔，长
  输出沿用 outputTail 截断 + 顶端渐隐 + 钉底滚动。
- **截图**：`command-card-long-truncated.png`、
  `command-card-running.png`（运行中 shimmer + tail 钉底）。

### F3. 溢出菜单与失败态 [包内已回归]

- **操作**：点卡头右端 "…"；点 Copy Command；再看一条退出码非 0
  的命令。
- **预期**：菜单只有 Copy Command（Auto-Run/Allowlist 属 Cursor
  权限体系，不抄）；点击复制显示 "Copied" 约 900ms 自收，菜单
  开合不触发卡片折叠；失败命令卡显示退出码与错误输出摘录。
- **截图**：`command-card-menu.png`、`command-card-failed.png`、
  `command-card-narrow.png`（360px 无横向溢出）。
- **对应验证**：`artifacts/smoke-command-card.mjs`（gallery +
  running 两模式）。

---

## G. 消息区体验（今晚修复与打磨的回归）

### G1. 图片缩略图与历史顺序 [包内已回归]

- **操作**：拖拽/粘贴图片进 Composer 发送；随后重载窗口看历史。
- **预期**：已发送消息里的图片显示为 Composer 同款缩略图（不是巨图）；
  点击打开图片查看器；**历史恢复后图片仍在其 prompt 上方同一条消息里**
  （今晚修复：先图后文的历史顺序不再把图丢到别的回合）。

### G2. 编辑卡（编辑并重问） [包内已回归]

- **操作**：双击（或悬停铅笔）一条历史用户消息。
- **预期**：消息原位变成 Composer 风格白卡内联编辑；回车重问（经
  rewind 分支）；Escape 或点卡外取消；发送新消息时打开的编辑卡自动
  关闭。
- **对应验证**：`artifacts/smoke-edit-resend.mjs` /
  `run-smoke-message-polish.mjs`。

### G3. 回复悬停操作栏（每次回复一条） [包内已回归]

- **操作**：悬停一段助手回复。
- **预期**：整个回复段（多气泡）只出现**一条**操作栏：整段复制 +
  Fork；运行中不出现灰色不可点按钮。

### G4. Compact 卡 [需真机确认]

- **操作**：Context 浮层 → Compact conversation。
- **预期**：压缩后转录顶部出现安静的 Compact 摘要卡（收敛后的样式，
  非白板卡）；Context 用量刷新。

### G5. Mermaid 图渲染 [包内已回归]

- **操作**：让 Droid 输出一个 ```mermaid 代码块。
- **预期**：流式结束后代码块原位渲染为图（懒加载，首屏无损耗）；
  渲染失败时安静回退为代码块。
- **对应验证**：`artifacts/smoke-mermaid.mjs`。

### G6. Preview chip 与沙箱预览 [包内已回归]

- **操作**：转录中出现 `.html` 路径链接或成品 HTML 代码块时点 Preview。
- **预期**：右侧打开沙箱预览面板；顶栏是暖色成品工具条（Reload /
  Open in editor），无浏览器默认样式；网络出口被阻断。
- **对应验证**：`artifacts/smoke-path-link.mjs` /
  `smoke-output-preview.mjs`。

### G7. Git commit 面板 [包内已回归]

- **操作**：一个改了文件的回合结束后，Changes 卡尾部点 "Commit these
  changes…"；确认文件勾选与草稿信息；点 Commit。
- **预期**：内联提交区显示分支名、默认勾选本回合文件、prompt 首行
  拼好的草稿 subject；提交成功回显短哈希 + subject；失败原样显示
  git 错误；Cancel / Commit 按钮停靠面板右下；文件计数不会因路径
  流式而闪 0。
- **对应验证**：`artifacts/smoke-git-commit.mjs` 三场景。

### G8. 白闪修复 [需真机确认]

- **操作**：打开聊天面板 / Reload Window，盯首帧。
- **预期**：面板背景直接以暖色 shell 底色绘出，无白色闪屏帧。

### G9. 今晚修复批次抽验（v0.1.1 内容） [需真机确认]

- MCP 面板 Add server：提交表单不再让整个 Webview 白屏死机；daemon
  卡死时超时进重试路径。
- `/` 与 `@` 弹窗键盘上下移动时高亮行始终滚入可见区。
- 中文文件名流式期间文件 chip / Changes 卡 / 提交面板拿到完整路径。
- 连点失效文件 chip 只保留一张诊断卡，不叠加。
- 运行中探索组以竖向跑马灯滑动交接，不堆叠成员行。

---

## H. 已知残留风险（如实列出）

1. **daemon 回退首会话约慢 64 秒**：daemon 起不来时，端口等待 +
   一次换端口重试合计约 64s，首个会话建立会慢这一拍，之后恢复
   正常（`smoke-mode-fallback-live.mts` 实测；回退本身静默、仅
   记一条 `runtime.mode.fallback` warn）。
2. **daemon 低自治文件创建权限差异**：daemon 路径下主/fork 会话
   autonomy 均为 low 时，工作区内文件创建**不触发**权限请求
   （process 路径会触发）。语义仍 fail-safe，但与 process 存在
   上游差异，待上游确认（探针 `probe-btw-daemon2.mjs` 实证）。
3. **归档列表只见最新 100 行窗口**：daemon 门面无分页，一次取
   100 行再按工作区过滤，更早的归档会话暂不可见（见 C0 已知
   边界）。
4. **后台子代理停不掉**：父回合结束后仍在跑的委派无法经
   `session.interrupt()` 终止（上游限制），按用户决策不渲染任何
   Stop 控件（见 B3）。
5. **命令卡数据上限**：极窄宽度下卡头芯片省略截断（by design）；
   模型没写 summary 的链式命令用规则标题（取首个实义命令名），
   可读性不如模型 summary，属数据上限而非缺陷。

---

## I. 明确不在本版（backlog，勿按缺陷报）

以下能力本版**没有**，属已排期/已设计未实现的 backlog：

- **Add to Chat**（编辑器选中 / 文件右键 / 转录引用三入口）：
  设计已完成（`docs/product/add-to-chat-design.md`），发版后
  backlog。
- **BYOK 自定义模型管理**（创建、编辑、Provider 管理）：已配置
  BYOK 模型的**选择**已接通，管理界面不在本版。
- **MCP 权限 UI**（全局/永久权限管理）：MCP 浏览、启停、Add
  server 已接通，权限管理界面不在本版。
- **Mission 观察台**（Mission 管理、Worker、阶段与进度界面）：
  可行性调研见 `mission-control-feasibility.md`，未实现。
- 其余见 implementation-status「差距清单」未勾选项（远程环境、
  跨设备 Session、Hooks 管理、Automations、组织策略等）。

---

## 附：发布指纹

- 版本：`0.2.0`，发布提交 `1076241`（`chore(release): v0.2.0`）。
- 包：`dist/droidvisx.vsix`，1,651,586 字节，打包于 2026-08-13
  01:01，SHA-256
  `1A50CDCDE34148D37AC5E279C8E1AB504CAB6B6321172A743A8BF060E1723B24`。
- 安装：`cursor --install-extension --force` 成功，
  `cursor --list-extensions --show-versions` 确认
  `droidvisx.droidvisx@0.2.0`。
- 门禁：typecheck 三段 / vitest 全量 / build / verifyVsix /
  vsce package / cursor --install-extension 全绿（发布前已跑）。
- 回归：收官阶段（2026-08-13 01:45）在 01:01 打包产物
  （`dist/webview`）上复跑 harness 冒烟七套：plan-anchor /
  queue-bar / queued-bar / working-badge / command-card /
  session-drawer / subagent，**全部 PASS**（每套断言 JSON 顶层
  `pass: true`），截图同步刷新，引用见上文各节。

---

## 附 2：v0.3.0 发布指纹与验证状态（增补）

- 版本：`0.3.0`，切包提交 `23e8de9`（含分诊修复
  `d5c1738`/`dff9dda`/`fa2f880`/`9384977`/`aaf3f12` 与 QA 快修
  `b5aa9bb`/`aef2d0d`/`9c72d90`/`346fafb`）。
- 包：`dist/droidvisx.vsix`，1,662,797 字节，打包于 2026-08-13
  11:24，SHA-256
  `9641211704AB2F4958EBE6CDB05A43BD2DFBBBB494A094E14250C24B490DE139`。
- 安装：`cursor --install-extension` 成功，
  `cursor --list-extensions --show-versions` 确认
  `droidvisx.droidvisx@0.3.0`。快修 P1 代码已在包内实证
  （解包 `extension.cjs` 含 `stageCapturedSelectionOutcome`）。
- 上节 I 的「Add to Chat 不在本版」已过时：三入口中编辑器选中
  入口已随 `b5aa9bb` 落地（冷启动选区暂存 60s + 状态栏反馈）。

### 真机已验证（v0.3.0 分诊修复，截图在 `artifacts/uat/`）

- 启动无终端窗口：杀 daemon 后 Reload 重拉起，隐藏 spawn，
  控制台窗口零弹出（`09-daemon-fresh-no-console.png`）。
- 普通回合运行中 Reload：daemon 存活、回合继续并完成
  （`10/11-scenario1-*.png`）。
- 委托子代理运行中 Reload：委派回合存活并完成
  （`28/29-scenario2-*.png`）。
- compact 进行中 Reload：重连后压缩分隔卡正常渲染、UI 无卡死
  （`21c/23-scenario3-*.png`）。
- 排队消息 + Reload：队列以暂停态恢复并带诊断提示（"restored
  (text only), use Send now"），无静默丢失
  （`16/17-scenario4-*.png`）。
- 计划锚卡（真实 TodoWrite / gpt-luna）：创建位置、原地更新
  0/3→3/3、完成灰勾、View Plan 展开、Reload 回放同构
  （`24/25/26/27-plan-*.png`）。

### 未验证（用户叫停真机测试，如实标注）

- QA 快修四条（Add to Chat 冷启动、连点去重、Failed 危险色、
  预览工具栏换行）：代码确认在包内，但**未做真机验证**，其
  聚焦测试在合并后基线上**未由本次发布方复跑**（快修提交方
  门禁见 `23e8de9` 记录）。
- 重装后的 0.3.0 新包本身未做真机冒烟；上述矩阵验证跑在同日
  10:32 的 0.3.0 旧切包上（两包共享全部分诊修复提交，新包仅
  多快修四条与文档提交）。
- 计划锚卡"切走再切回"的会话切换回放未单独验证（Reload 回放
  已验证）。
- compact 场景的精确时序窗口（RPC 中途被杀的最坏点）无法从
  UI 侧钉死；验收以"重连后不卡死、分隔卡完整"为准，已满足。
