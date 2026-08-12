# DroidVisX 交接总索引（HANDOVER）

> 写给**零记忆的新 AI**：打开本仓库后先读本文件，再按第 2 节的文档地图
> 按需精读。本文件只做索引与工作流约定，**不复制进度细节**——一切
> "当前做到哪了"以 `docs/product/implementation-status.md` 为准。
>
> 创建日期：2026-08-11。架构细节见
> [`docs/engineering/architecture-overview.md`](./engineering/architecture-overview.md)。

## 1. 项目定位与当前阶段

**一句话定位**：DroidVisX 把本地 Droid CLI（`@factory/droid-sdk`，
Node `ProcessTransport` 子进程路径）包装成 VS Code / Cursor 扩展，在
Cursor Secondary Sidebar 提供一个安全、暖色、响应式的 Droid 可视化
聊天工作台；Droid 本体始终是 Session、模型、权限、Skills、MCP、
Spec、Mission 的唯一权威，DroidVisX 不建第二套 AI 后端、不碰凭据。

**当前阶段**：实现期（implementation）。本地文本聊天内核、Session
管理基础、权限/AskUser/ExitSpec 交互、历史加载与恢复对账、附件、
Skills/MCP/Slash 命令、全保真本地诊断等已生产接通；V1 剩余切片
见第 3 节。行为权威 = 用户当前要求 + 生产代码；进度权威 =
`implementation-status.md`。

**必读三件套（按序）**：

1. [`AGENTS.md`](../AGENTS.md) —— 执行模型、单代理边界、交付循环、
   工程规则。所有工作必须遵守。
2. [`docs/product/implementation-status.md`](./product/implementation-status.md)
   —— 进度权威（见下）。
3. [`docs/engineering/architecture-overview.md`](./engineering/architecture-overview.md)
   —— 四层架构、关键时序、Bridge 不变式、命令速查。

## 2. 文档地图

**状态图例**：`设计待实现` = 待实现切片的设计蓝图（实现时照此做）；
`已实现记录` = 已完成功能的设计/诊断记录（当参考读，别再实现一遍）；
`计划` = 排期与顺序约定；`参考` = 历史调研/手册，按需查阅。

### docs/product/

| 文件 | 主题 | 状态 |
| --- | --- | --- |
| [`implementation-status.md`](./product/implementation-status.md) | **进度权威台账**：生产已接通 / 部分完成 / 仅探测 / 未实现，安装包与验证状态，"下一步"路线 | **权威、易变**。以它为准；不要在任何别处（包括本文件）复制进度细节。每个切片完成时必须同步更新它 |
| [`delivery-plan.md`](./product/delivery-plan.md) | 交付原则（垂直切片、依赖顺序、一次正式验证、完成必须可见）与模块路线图 | 计划（原则长期有效；模块表的"当前状态"列已过时，文首有醒目声明，以 implementation-status 为准） |
| [`session-management-design.md`](./product/session-management-design.md) | Session 管理补全（Favorite/Archive/Delete/分支关系的 SDK 证据与分档设计）、跨项目列表、历史对齐修复 | 已实现记录（§1 收藏/分组/归档、§2 工作区过滤、§3 历史对齐均已落地；Delete 无 API 维持 fail-closed，§1.1 证据表为该判定的权威出处） |
| [`tier1-polish-plan.md`](./product/tier1-polish-plan.md) | 第一档 UI/观察性打磨：流式命令输出预览、收起播报、恢复提速（快照先行）、回复动画 | 分节：**§1 流式命令输出预览设计待实现**（另行开片）；§3 已实现（提前为 V1 #2）；§2/§4 被 streaming-experience-design 替代/并入 |
| [`rich-content-design.md`](./product/rich-content-design.md) | 对话内图片显示（§1）、Composer 拖拽/粘贴进输入框（§1.5）与 Canvas/原型预览（§2） | 分节：§1/§1.5 已实现记录；**§2（Canvas）设计待实现**（V1 #7） |
| [`slice-prep-rich-content.md`](./product/slice-prep-rich-content.md) | 切片③（图片 + 拖拽/粘贴）开工预研：探针实证、代码锚点、实现清单 | 已实现记录（存档；探针数据可作回归参考） |
| [`slice-prep-canvas.md`](./product/slice-prep-canvas.md) | Canvas 切片开工预研：方案 b 可行性实证、CSP/sandbox/网络风险、实现清单 | 设计待实现的预研（服务 V1 #7，开工时与 rich-content §2 同读） |
| [`message-card-design.md`](./product/message-card-design.md) | 用户消息卡片编辑重发（切片 3+）：附件回显、内嵌控制条编辑态 | 已实现记录 |
| [`spec-mission-design.md`](./product/spec-mission-design.md) | 完整 Spec Mode 闭环（§1）、Mission 只读展示（§2）、子代理层级摘要（§3）；含"做不了的"清单 | 设计待实现（§1 = V1 #4；§3+§2 = V1 #5） |
| [`slice-prep-spec-mode.md`](./product/slice-prep-spec-mode.md) | Spec 闭环开工预研：SDK 核实、缺口清单 G1–G7、超长 plan 风险 R1 | 设计待实现的预研（服务 V1 #4，开工时与 spec-mission §1 同读） |
| [`queued-messages-design.md`](./product/queued-messages-design.md) | Turn 运行中排队消息完整设计：Host 层 FIFO、派发守卫、三切片交付 | 设计待实现（V1 #7+，发版前最后一步） |
| [`streaming-experience-design.md`](./product/streaming-experience-design.md) | Cursor 风格流式体验实施设计：工具聚合、Thinking shimmer、入场动画与回放静默、Todo 折叠 | 已实现记录（三批全部落地，落位 V1 #6） |
| [`cursor-streaming-ux-research.md`](./product/cursor-streaming-ux-research.md) | Cursor 流式呈现调研：动效 token、WordStreamer、shimmer 参数一手证据 | 参考（已经由 streaming-experience-design 落地，仅证据存档） |
| [`activity-aggregation-research.md`](./product/activity-aggregation-research.md) | Cursor 工具调用聚合调研：分组规则、运行中预览窗、摘要行一手证据 | 参考（同上，仅证据存档） |
| [`cli-coverage-assessment.md`](./product/cli-coverage-assessment.md) | CLI ↔ GUI 能力覆盖评估：10 条缺口与三类边界 | 参考（用户拍板与现行排期见本文件第 3 节；文中 V1 序号为旧排序） |
| [`mcp-permission-persistence-research.md`](./product/mcp-permission-persistence-research.md) | MCP 持久权限官方渠道调研（CLI 子命令 + settings.json 契约）+ 切片草案 | 调研结论（发版后 backlog 切片的实现依据；推翻 daemon-feature-opportunities §B3 的 fail-closed 判定） |
| [`daemon-architecture-design.md`](./product/daemon-architecture-design.md) | daemon 化运行调研：SDK daemon 公开面、零配置鉴权方案、分阶段迁移路线 | 已实施存档（Phase 0–3 落地，见第 7 节） |
| [`daemon-implementation-plan.md`](./product/daemon-implementation-plan.md) | daemon 化四阶段实现计划（自包含执行手册） | 已实施存档（已执行完毕，勿再照此开工；见第 7 节） |
| [`daemon-feature-opportunities.md`](./product/daemon-feature-opportunities.md) | daemon 落地后的功能机会盘点（2026-08-12）：Turn 排队走 Host 层方案、Reload 活流重连做基础档、跨窗口共享/收藏改造判不做、通知中心/搜索增强入发版后 backlog | 调研结论，排期指针已合入第 3 节 |
| [`slash-commands-design.md`](./product/slash-commands-design.md) | `/` 动态命令的 SDK 证据、Bridge 契约、分层实现 | 已实现记录 |
| [`activity-shimmer-fix-design.md`](./product/activity-shimmer-fix-design.md) | 活动行 shimmer 的诊断与纯 CSS 修复 | 已实现记录 |
| [`diagnosability-design.md`](./product/diagnosability-design.md) | 全保真日志改造设计（turn 关联、性能埋点、导出）；附录 A 是 2026-08-11 时点的文档盘点（历史快照，现行地图以本表为准） | 已实现记录 |
| [`log-analysis-playbook.md`](./product/log-analysis-playbook.md) | **读日志排障手册**：日志位置、schema、事件词典、典型故障特征、PowerShell 统计片段 | 参考（排障时必读；随 VSIX 打包进诊断导出包） |

### docs/engineering/

| 文件 | 主题 | 状态 |
| --- | --- | --- |
| [`architecture-overview.md`](./engineering/architecture-overview.md) | 四层职责与 import 边界、三条关键时序、Bridge 不变式、命令速查 | 参考（与本文件同批创建，接手必读） |
| [`droid-capability-matrix.md`](./engineering/droid-capability-matrix.md) | Droid 能力声明矩阵与 Capability Probe 契约 | 参考（Capability Gate 本身未接入 Extension，勿当产品功能） |

### docs/preflight/（00–07）

一次严格两小时实现窗口前的预研固化：能力清单、SDK API/事件 Schema
映射、集成缺口、UX 规格、性能审计、信息架构、验收与回滚。全部为
**参考**（历史快照，结论若与 implementation-status 冲突以后者为准）。

### 其他目录

- `design/prototypes/`：Module 1 视觉参考原型。只定义视觉与交互，
  **不是 Runtime 契约**，示例数据不代表 Droid 真实能力（AGENTS.md
  明文约定）。
- `artifacts/`：探针脚本、冒烟 harness、临时产物（git 已忽略）。
  只读调研代理的产出也放这里。

## 3. 剩余工作执行顺序（V1）

以下顺序由用户于 2026-08-11 确定（2026-08-12 局部调整：#7 Canvas
移至发版前倒数第二、#7+ Turn 排队上移为发版前最后一步，见行内注），
是本仓库的**路线索引**。已完成切片的勾销记录在
`implementation-status.md`「下一步」节，本表不复制。
`implementation-status.md` 是**进度权威**（做到哪、验了啥）；两者
必须保持一致——每完成或调整切片，同步更新 status 的「下一步」节。

| # | 切片 | 设计文档 |
| --- | --- | --- |
| 1 | 收藏与分组（Session Favorite 文件契约 + 列表分组展示） | [`session-management-design.md`](./product/session-management-design.md) §1 |
| 2 | 恢复提速（快照先行，从第一档提前） | [`tier1-polish-plan.md`](./product/tier1-polish-plan.md) §3 |
| 3 | 对话内图片显示 + Composer 拖拽/粘贴图片进输入框 | [`rich-content-design.md`](./product/rich-content-design.md) §1、§1.5 |
| 3+ | 消息卡片编辑重发（用户消息卡片 + 附件回显 + 内嵌控制条编辑态；与③同批或紧随，2026-08-12 用户确认） | [`message-card-design.md`](./product/message-card-design.md) |
| 4 | 完整 Spec Mode 闭环 | [`spec-mission-design.md`](./product/spec-mission-design.md) §1 |
| 5 | 子代理摘要层级 + Mission 只读展示 | [`spec-mission-design.md`](./product/spec-mission-design.md) §3、§2 |
| 6 | 第一档打磨剩余项（Cursor 风格流式体验：工具聚合 / Thinking shimmer / 入场动画与回放静默 / Todo 折叠，分 3 批交付；替代 tier1 §2、并入 §4；tier1 §1 流式命令输出预览保留原设计、另行开片） | [`streaming-experience-design.md`](./product/streaming-experience-design.md) |
| 7 | Canvas / 原型预览（2026-08-12 用户调整：不急，放到发版前倒数第二） | [`rich-content-design.md`](./product/rich-content-design.md) §2 |
| 7+ | Turn 运行中排队消息（2026-08-12 用户调整：从 backlog 上移进主线，作为发版前最后一步。设计文档已完成：Host 层 FIFO 队列上限 10 条、completed 自动派发、Stop/failed 转暂停态、三切片交付；前置依赖 daemon 收尾 A4 基础档——共享 turn 状态机改动，A4 先做） | [`queued-messages-design.md`](./product/queued-messages-design.md)；调研出处 [`daemon-feature-opportunities.md`](./product/daemon-feature-opportunities.md) A1 |
| 8 | 发版（版本号脱离 0.0.0、打 tag、正式 VSIX） | 无独立设计文档；遵循 [`delivery-plan.md`](./product/delivery-plan.md) 完成标准 |

**V1 前已完成、勿重复实现**（细节见 implementation-status）：`/`
动态命令、Assistant Regenerate、Composer `@` 文件提及、Rewind 文件
安全检查、MCP 认证/增删、Problems/Git changes 附件、全保真日志、
活动 shimmer 打磨、历史对齐与 toolCallId 白屏修复等。

> daemon 化是**独立于本主链路的架构专项**，不占上面序号、不在 V1
> 顺序内。见本文件第 7 节。

### CLI 覆盖度缺口判定（2026-08-12）

[`cli-coverage-assessment.md`](./product/cli-coverage-assessment.md) 第 3 节
列出 10 条 CLI 能力缺口，用户已于 2026-08-12 逐条拍板。只记决定与
指针，论证细节见评估文档原文。

**纳入排期（按优先级）**：

| 优先级 | 项 | 用户判定 | 排期位置 | 出处 |
| --- | --- | --- | --- | --- |
| 1 | Turn 运行中排队消息 | 重要 | 2026-08-12 用户上移进 V1 主线（见第 3 节 #7+，发版前最后一步）；SDK `QueuedUserMessage*` + `daemon.resolve_queued_user_message`，数据通道已具备；动手前先补设计文档 | 评估文档 §3 #8 |
| 2 | MCP 持久权限管理 | 可以有 | 调研已完成（2026-08-12）：**有官方渠道**——CLI 内置 `droid mcp permissions list/revoke/clear`（docs.factory.ai/harness/mcp 明文记载，实测可用）；SDK/daemon RPC 面确认无对应 API。切片方案：只读列表 fail-soft 解析 `~/.factory/settings.json` 的 `mcp.persistentPermissions`（非官方格式，失败降级提示走 CLI），撤销 spawn 官方 CLI 命令。排期：发版后 backlog | [`mcp-permission-persistence-research.md`](./product/mcp-permission-persistence-research.md) |
| 3 | 会话 Tag 只读显示与过滤 | 补，重要程度低 | 计划末尾——V1 主链路全部完成之后的低优先级 backlog | 评估文档 §3 #3 |
| 4 | Tool 启停/白名单 | 补，重要程度低 | 同上，计划末尾 backlog（`disabledToolIds` 有公开 Node 渠道，技术可行） | 评估文档 §3 #9 |
| 5 | 子代理转录只读回放（"View subagent transcript"，跑完后点开子会话完整转录） | 放在后面（2026-08-12） | 计划末尾 backlog；主线只做子代理摘要行。技术可行：childSessionId + 既有历史加载管线 + 新建只读转录视图 | [`spec-mission-design.md`](./product/spec-mission-design.md) §3.3 可选进阶 |

**明确不做**：

- **内置模型全目录切换**（评估文档 §3 #1）——用户明确"不管"，GUI
  维持只显示 BYOK 模型的现行设计。已追加进下方"用户明确排除"表。
- 以下按评估文档建议判**不需要/不排期**，用户未提出异议：自定义
  系统提示（#4）、启动级禁用内置技能（#7）、进程级设置文件（#5）、
  Relay computer 管理（#6）、结构化输出（#10）。

状态文档的同步由实现代理在下次更新 `implementation-status.md`
时完成。

### 其他 backlog（发版后，低优先级）

- 「Show earlier messages」一次性展开数百条历史消息时有 300–400ms
  长任务（React 批量挂载成本；2026-08-12 性能复测时发现，与吸顶
  改动无关）。打磨方向：分批挂载。低优先级。
- **BYOK 自定义模型配置（Add model）**：模型选择器加 "Add model…"
  入口 + Webview 管理面板，写入走 daemon `customModels.*` RPC（list
  自带脱敏）；设计已完成，见
  [`byok-add-model-design.md`](./product/byok-add-model-design.md)
  （实现时替代下方 V2 表「Custom Models 管理」行）。排期位置待用户
  拍板（文档建议：发版后 backlog 前列）。
- **Add to Chat（选中/文件/转录引用三入口）**：编辑器选中与文件
  右键加入附件暂存（Bridge/Webview 零改动）+ 转录选中 Quote in
  reply；设计已完成，见
  [`add-to-chat-design.md`](./product/add-to-chat-design.md)。排期
  位置待用户拍板（文档建议：入口 a+b 切片近期空档优先、先于 BYOK）。

### 用户明确排除（近期不做，勿自行加回）

用户于 2026-08-11 决定以下项**暂不纳入 V1 与近期 V2**，除非用户
重新开口：

| 项 | 说明 |
| --- | --- |
| 跨设备 Session | 换机接续同一会话 |
| 界面中文化（i18n） | 全界面翻译，成本高 |
| 个人体验基线 | 首次引导、任务完成通知、设置页、快捷键等 onboarding |
| 账号用量 | Factory 账户 token 消耗/额度展示 |
| 内置模型全目录切换 | GUI 维持只显示 BYOK 模型的现行设计（用户 2026-08-12 决定，见上方"CLI 覆盖度缺口判定"；出处 cli-coverage-assessment §3 #1） |
| Mission Control / Worker 详情 | 控制面 SDK 无 RPC，fail-closed（出处 spec-mission-design 结论速览）；只读展示已入 V1 #5，剩余控制面做不了（用户 2026-08-12 裁剪 V2） |
| 组织策略 / Account Profile | 账户与组织侧能力，与上面"账号用量"同类（用户 2026-08-12 裁剪 V2） |
| 远程环境 | 非本地运行环境，与本地 GUI 定位不符（用户 2026-08-12 裁剪 V2） |
| Help / Feedback | 帮助与反馈入口，价值过低（用户 2026-08-12 裁剪 V2） |
| Context Category 明细 | context 条已有，细分展示收益小（用户 2026-08-12 裁剪 V2） |
| 更新管理 | 扩展/CLI 版本检测与升级提示，价值一般（用户 2026-08-12 裁剪 V2） |

`implementation-status.md` 的 V2 清单里可能仍列有这些项——以本表
为准，接手时视为**冻结/排除**，不要误当成待办。

### V2 远期（完整版 V1 之后，按需启动）

不在上面 V1 序号内；用户未排期前不要开工。完整索引如下，细节分散
在各设计文档与 status 的 V2 节。

> **2026-08-12 用户裁剪：15 项 → 8 项**，砍掉项见上方「用户明确
> 排除」表。另有「Custom Models 管理」一项不是排除，而是与 backlog
> 的 BYOK「Add model」设计重复，按重复清理删除，由上方"其他
> backlog"的
> [`byok-add-model-design.md`](./product/byok-add-model-design.md)
> 条目承接。

| 项 | 一句话 | 设计文档 |
| --- | --- | --- |
| Git 提交 / PR 工作流 | GUI 内提交、发 PR | 待补（设计中） |
| 原生 Terminal 工作流 | 命令跑在 VS Code 真终端，可看可接管 | 待补（设计中） |
| 后台进程管理 | dev server 等进程的列表/停止 | 待补（设计中） |
| worktree 并行任务 | 独立目录改分支，不动眼前代码 | 待补（设计中） |
| 会话导出 Markdown | 对话导出成文档（正在实现中，落地后由实现代理勾销本行） | — |
| Mermaid 图渲染 | 转录里的流程图直接画出来 | — |
| 成本 / token 明细可视化 | context 条之外的细分用量 | — |
| Plugins / Marketplaces / Hooks / Automations | CLI 能力，GUI 未接（用户明确：放最后） | — |

### SDK 边界内做不了的（不要尝试实现，fail closed）

| 项 | 原因 | 证据 |
| --- | --- | --- |
| Session Delete | 子进程 / daemon / 磁盘三条路径都没有删除 API | session-management-design §1.1 |
| Mission 控制面（start/pause/resume） | 公开 SDK 无对应 RPC，只能只读展示 | spec-mission-design 结论速览 |
| Spec 起草过程实时渲染 | 起草即普通流式文本，无专用增量事件；specs 目录无公开 API | spec-mission-design §1 |
| Favorite 官方写入 | 写入是 CLI 私有 `.favorites` 文件行为；只能按"私有文件契约"实现并如实标注 | session-management-design §1.2 |

## 4. 接手工作流：怎么开一个切片

1. **读设计**：从第 3 节找到该切片的设计文档，精读对应章节；同时
   重读 `AGENTS.md` 与 implementation-status 中相邻功能的"已知边界"。
2. **定义切片**：一个有可观察完成标准的用户可见垂直切片。不发明
   SDK 没有的能力；能力来源存疑时先写只读探针（放 `artifacts/`）
   实证，再动生产代码。
3. **按依赖顺序实现**：**Bridge（`src/shared/`）→ Runtime
   （`src/runtime/`）→ Host（`src/extension/`）→ Webview
   （`src/webview/`）**。先冻结共享 Bridge 契约（双向校验对称、
   长度上限、枚举），再改消费者。层职责与 import 边界见
   [`architecture-overview.md`](./engineering/architecture-overview.md)。
4. **边写边验**：聚焦测试先行（`npx vitest run <文件>`），集成后
   跑一次全量。
5. **完成门禁**（顺序执行，全部必须真实通过，不得凭源码推测）：

   ```powershell
   pnpm run typecheck          # 三个 tsconfig：extension / webview(build) / webview(src)
   pnpm run test               # vitest 全量
   pnpm run build              # node esbuild.mjs（含 Webview 禁运入检查）
   npx vsce package --no-dependencies   # 产出 VSIX（或 pnpm run package:vsix 一条龙 + verify:vsix）
   cursor --install-extension <vsix路径> --force
   ```

6. **可见验收**：影响 UI 的切片先用浏览器 harness / 无头冒烟自查，
   最终由用户在真实 Cursor 中验收。**版本号仍是 `0.0.0`**，同版本
   覆盖安装后现有窗口不会自动换 Bundle：
   - **Reload Window**：加载新 Extension Bundle 与 Webview 资源，
     日常验收用它；
   - **完整退出并重启 Cursor**：额外清掉 webview service worker
     缓存——若怀疑 Webview 资源陈旧（日志里 `boot-ok` 的 build id
     和本次构建不一致），必须完整重启而不是只 Reload。
7. **更新状态**：在**同一个变更**里更新
   `implementation-status.md`（含"当前安装包状态"与"验证状态"，只记
   实际执行过的命令与结果）。
8. **提交**：conventional commits 风格（`feat(scope): …` /
   `fix(scope): …` / `docs: …`，见 `git log`）。消息写进临时文件用
   `git commit -F <临时文件>`（避免 PowerShell 引号转义问题）；
   `git add` **明确列出文件，不用 `-A`**（工作区常有并行代理的
   未提交文件与探针产物）。

## 5. 诊断入口

- **日志文件**：`%APPDATA%\Cursor\User\globalStorage\droidvisx.droidvisx\logs\droidvisx-YYYYMMDD.jsonl`
  （UTC 按日分文件，所有窗口汇聚写同一份；总量 200 MB 超限删最旧
  整天）。**全保真**：prompt 原文、命令、路径、ID、错误堆栈全都记，
  唯一过滤是凭据扫除（`scrubCredentials`）。
- **命令**：`DroidVisX: Open Logs`（Output Channel 实时镜像）、
  `DroidVisX: Export Diagnostics Bundle`（zip = 全部日志 +
  metadata + 分析手册）。
- **读日志手册**：
  [`log-analysis-playbook.md`](./product/log-analysis-playbook.md)
  是事件词典与排障模板的当前真相——排任何障先读它（含按 `turn`
  字段串起单次交互全链路、`act` 激活实例锚点、性能埋点 P1–P9、
  PowerShell 统计片段）。

## 6. 多代理并行约定（2026-08-12 更新：Cursor 能力全放开）

用户决定（2026-08-12）：**Cursor 代理平台允许的能力全部可用**——
后台子代理、并行 worker、worktree 等按需使用，不再默认单实现代理。
仅保留以下**物理资源互斥**（这些是文件系统/构建产物的客观冲突，
不是政策限制）：

1. **同目录同文件不并发写**：两个代理不得同时编辑同一工作目录里的
   同一批文件；并行实现时按文件/模块划分好写入范围。
2. **build / package / install 互斥**：同一时间只允许一个代理跑
   `pnpm run build`、`vsce package`、`cursor --install-extension`
   （共享 `dist/` 与全局扩展安装位）。
3. **`implementation-status.md` 并发更新须合并**：多个代理都可更新，
   但提交前先读最新内容、只追加/更新自己的条目，不覆盖他人记录。
4. **提交用明确文件列表**：并行期间工作区必然混有他人未提交文件，
   `git add` 逐个列文件，禁止 `-A` / `.`。

## 7. 架构专项：daemon 化（独立于 V1 主链路）

> 这一节刻意放在最后、与第 3 节主链路分离。daemon 化是一条**自包含
> 的架构专项**，有自己的调研结论和分阶段实现计划，无需牵动 V1 切片
> 顺序（唯一交叉点是下述遗留收尾 A4，它是 #7+ 的前置）。

**现状（2026-08-12，Phase 0–3 已全部落地）**：凭据黑盒复用 CLI 登录
态（零配置）、归档/取消归档/跨会话搜索走只读 sidecar、执行链路
`droidvisx.runtime.mode = daemon` 可选（**默认仍是 process**）、脱管
共享 daemon + 发现文件 + 跨窗口租约（Reload 后 daemon 侧任务存活已
探针实证）。细节与验证记录见 `implementation-status.md`「运行架构」。
原"归档需 daemon 接入后做"的 fail-closed 判定已随 Phase 1 落地解除。

**遗留收尾与后续机会**（现行真相在
[`daemon-feature-opportunities.md`](./product/daemon-feature-opportunities.md)）：

- **A4 基础档 reload 对账 UI**（in-flight 回合占位、pending 权限
  重弹）——已作为第 3 节 #7+（Turn 排队）的前置排入主线，A4 先做。
- daemon 模式转正门槛（模型目录 unavailable、浏览器 MCP OAuth）见
  该文档 §B5；`sessions.getMessages` 探针异常核对与 A4 共享前置。

**两份历史文档（已实施存档，接手 A4 前可作背景速读，勿照此开工）**：

1. [`daemon-architecture-design.md`](./product/daemon-architecture-design.md)
   —— SDK daemon 公开面、reload 存活验证、零配置鉴权方案（§6）。
2. [`daemon-implementation-plan.md`](./product/daemon-implementation-plan.md)
   —— 已执行完毕的四阶段实现手册。

**接手须知**：

- 仍遵守 §1 分层顺序与门禁；鉴权相关实现严格限定在 Runtime 层、
  不外泄敏感字段、日志继续走 `scrubCredentials`。
