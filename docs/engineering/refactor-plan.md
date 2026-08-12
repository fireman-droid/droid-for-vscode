# 结构债重构计划：三巨型文件拆分 + 重复实现合并

状态：计划（2026-08-12 晚）。零生产代码改动的规划产物；执行时按本文批次开工。
背景：10+ 代理并行开发暴露结构债，代码质量审查（B+）判定
`ChatController.ts` / `styles.css` / `Thread.tsx` 为撞车重灾区；styles.css
已实际发生规则互相覆盖事故。用户已拍板：**styles.css 拆分与颜色 token
收敛（[`theme-switching-design.md`](../product/theme-switching-design.md)
§2.1）同窗口捆绑执行**。

> 行数快照（2026-08-12 19:00 实测，工作区有并行代理在写，数字随时漂移；
> 本文所有行号引用以该时点为准，执行时须重扫）：
>
> | 文件 | 行数 | 审查报告时点 |
> | --- | --- | --- |
> | `src/extension/ChatController.ts` | 7714 | 7305 |
> | `src/extension/ChatController.test.ts` | 8526 | 7907 |
> | `src/webview/assistant/styles.css` | 6295 | 6109 |
> | `src/webview/assistant/Thread.tsx` | 4078 | 4038 |
> | `src/webview/assistant/ComposerControls.tsx` | 2843 | 2842 |

## 0. 红线（先于一切）

1. **拆分批次 = 纯搬家**。逐字移动代码块，不改标识符、不改逻辑、不顺手
   重构。行为修复（丢失样式找回、幽灵 token 落定）单独成提交，与搬家
   提交严格分离。
2. 每个批次结束跑完整门禁（§2 各批次注明），**行为等价用工具证明**，
   不凭源码推测（AGENTS.md 纪律）。
3. 公共 API 面保持稳定：`ChatController` 类的路径、构造签名、
   `subscribe/handleMessage/handleWorkspaceContextChanged/dispose` 不变；
   `App.tsx` 的 `import './styles.css'` 与 `import { DroidThread } from
   './Thread'` 不变。拆出的新模块都是**内部文件**，不新增对外契约。

## 1. 目标模块图

### 1.1 styles.css（6295 行）→ `src/webview/assistant/styles/` 多文件

**构建事实（已查证）**：esbuild 不显式处理 CSS——`App.tsx:68`
`import './styles.css'`，esbuild `bundle: true` 自动把 JS 引用的 CSS
连同其内部 `@import` 全部内联打进单一 `dist/webview/webview.css`
（minify），Host 端 `DroidViewProvider.ts:95` + `webviewHtml.ts:52` 只认
这一个产物文件。
**选定方案：`@import` 索引**——`styles.css` 原地改为按原顺序排列的
`@import './styles/XX-*.css';` 清单，**esbuild.mjs、Host、App.tsx 全部
零改动**。esbuild 按 import 顺序拼接，规则顺序不变 ⇒ 产物逐字节等同
（这就是门禁，见 §2 批次①）。

切分按**连续区段**进行（族群扫描证实各类名家族已按功能局部聚集），
不做跨区段的规则重排——重排留给后续单独批次（如果有必要）。区段表
（行号 = 2026-08-12 快照，执行时以族群边界重新对位）：

| # | 新文件 | 原区段 | 预估行数 | 内容 |
| --- | --- | --- | --- | --- |
| 1 | `00-base.css` | 1–93 | ~95 | @font-face、`html/body/#root` 底色、`.dvx-shell` 盒模型/表单继承/焦点环 reset、visually-hidden、状态行小件 |
| 2 | `01-markdown.css` | 94–410 | ~315 | markdown 全家、code-block、hljs 语法色、mermaid 图 |
| 3 | `02-transcript-media.css` | 411–834 | ~425 | 活动行基础、diagnostic、compact-divider、转录图片、lightbox、pending/empty/history notice |
| 4 | `03-chrome-popovers.css` | 835–1400 | ~565 | composer seam/input 骨架、popover-row 骨架、permission-editor、question options、header/status、模型触发器早期规则、rise/fade keyframes、720px/900px/320px 响应式。**最不内聚的一段**（历史堆积区），本批次只搬不整理 |
| 5 | `04-message-cards.css` | 1401–1660 | ~260 | user/assistant 消息卡、message actions、tool-file、preview-chip、changes summary |
| 6 | `05-git-commit.css` | 1661–1860 | ~200 | commit 面板全家 |
| 7 | `06-activity-live.css` | 1861–2280 | ~420 | tool summary/error/background、subagent 行、shimmer、terminal-mirror、plan/todo（2094–2262）、入场 keyframes |
| 8 | `07-shell-frame.css` | 2281–2500 | ~220 | forced-colors 块、**`.dvx-shell` token 定义块（~2350–2385）**、header/brand/thread/viewport/reading-column。批次①c 会把 token 块抽为独立 `01-tokens.css` 并前移（自定义属性仅此一处定义，前移不改变级联结果） |
| 9 | `08-user-edit.css` | 2501–2920 | ~420 | message-user、restore box、user-edit 编辑态全家、resending、activity-chevron |
| 10 | `09-composer.css` | 2921–3457 | ~535 | activity-group、scroll-bottom、thread-pending、composer 主体/controls/context ring/mode/send、rise-out/view-slide keyframes |
| 11 | `10-settings-popover.css` | 3458–3940 | ~485 | settings-view/select/search/info、panel 骨架、context popover/progress/details、token-usage 表 |
| 12 | `11-model-sessions.css` | 3941–4500 | ~560 | model popover 全家、session drawer/搜索/行/收藏/归档/rename |
| 13 | `12-attachments-mentions.css` | 4501–4730 | ~230 | attach rows、attachment chips/thumb、mention popup |
| 14 | `13-skills-mcp.css` | 4731–5028 | ~300 | skill 行/开关、MCP 全家（status/auth/add/remove/tools） |
| 15 | `14-interactions.css` | 5029–5760 | ~730 | context-compact、interaction 面板/卡、permission tool/plan/menu、plan-markdown/preview、editor-view、ask-user、窄宽响应式（462/420/350px） |
| 16 | `15-system-overlays.css` | 5761–5963 | ~205 | fatal、command popup、slash tooltip、**selection governance（5914–5962）——依赖后位覆盖，必须保持在所有模块文件之后** |
| 17 | `16-btw.css` | 5964–6106 | ~145 | /btw 侧问卡片 |
| 18 | `17-plan-pin.css` | 6107–6295 | ~190 | plan-pin 全家 + 其 reduced-motion / forced-colors 块 |

最大新文件 ~730 行（`14-interactions.css`）。`@import` 顺序 = 区段原始
顺序，**一条都不能换位**：selection governance（#16）与各处
`prefers-reduced-motion` 覆盖块都靠源顺序赢得级联。

**审计事实核验（2026-08-12 复扫，供 ①b/①c 执行时对账）**：

- 幽灵 token 7 个（被 var() 引用、从未定义）：`--dvx-text`、
  `--dvx-mono`、`--dvx-diff-add`、`--dvx-diff-del`、`--dvx-bg`、
  `--dvx-font`、`--dvx-hover`。其中 `var(--dvx-text)` 无 fallback，
  `.dvx-user-edit-restore:hover` 实际失效（隐性 bug，theme 文档 §1.2）。
  另有 2 个定义了从未使用：`--dvx-user`、`--dvx-shadow`。
- 重复定义选择器 **8 组**（审查报告列了 4 组，复扫多出 4 组）：

  | 选择器 | 行号 | 判定 |
  | --- | --- | --- |
  | `.dvx-plan-step` | 2118 / 2222 | 审查已定性覆盖事故，①b 合并 |
  | `.dvx-context-ring-value` | 1156 / 3254 | 同上 |
  | `.dvx-session-star-active` | 4376 / 4386 | 同上 |
  | `.dvx-mcp-remove-confirm` | 4919 / 4923 | 同上 |
  | `.dvx-copy-action .dvx-copy-done` | 1484 / 1490 | 新发现，①b 逐组判定语义后合并或注释说明 |
  | `.dvx-token-usage-table td` | 3904 / 3928 | 同上 |
  | `.dvx-diagnostic code` | 525 / **5952** | **有意**——5952 在 selection governance 区，仅 `user-select`，保留 |
  | `.dvx-tool-command-inline` | 2002 / **5960** | 同上，保留 |

- 被引用但零规则的生产 className 4 个（样式已丢失，`rg` 证实 CSS 侧
  0 命中）：`dvx-message-editing`、`dvx-attachment-sent`、
  `dvx-activity-group-running`、`dvx-lightbox-stage`。找回路径：
  `git log -S '<classname>' -- src/webview/assistant/styles.css` 定位被
  覆盖删除的规则原文。**这是行为修复，归修复单/①b，不混入搬家提交**。
- 待收敛硬编码：hex 260 处、`rgb()/rgba()` 97 处（与 theme 文档 §1.1
  的 259/95 基本一致，随并行改动微涨）。

### 1.2 ChatController.ts（7714 行）→ 薄路由 + `src/extension/chat/` 功能模块

**拆分机制（决定行为等价性，先定死）**：类实在太多共享可变状态
（`turn/sessionId/runtime/各代 generation/...` 40+ 私有字段），拆子类
或搬状态都不是纯搬家。选定**自由函数 + Internals 接口**模式：

- 私有方法搬出为 `export function handleSend(ctl: ChatControllerInternals,
  ...)` 形式的模块函数，方法体内 `this.` 机械替换为 `ctl.`，其余逐字
  不动。
- `chat/internals.ts` 定义 `ChatControllerInternals` 接口 = 现有字段 +
  跨域互调方法的可见面；`ChatController` 类 `implements` 它（字段从
  private 提为接口可见，仅内部目录使用，不出 `src/extension/chat/`）。
- `ChatController.ts` 留在原路径：字段、构造器、`handleMessage` 路由
  switch（683–973，本来就是纯分发）、订阅/销毁/工作区切换、emit 族。
  对 `extension.ts`/`DroidViewProvider`/测试的 API 面零变化。

成员 → 文件映射表（行号 = 快照；「+」表示同域的散落成员一并归位）：

| 新文件 | 搬入成员（现行号） | 预估行数 |
| --- | --- | --- |
| `ChatController.ts`（瘦身后保留） | 字段与状态（441–605）、构造器（595–668）、subscribe/handleMessage/handleWorkspaceContextChanged/dispose（670–1047）、handleReady/startup/emitEarlyRecoverySnapshot（1049–1153）、emit/emitSnapshot/projectTranscript/nextSequence（6362–6431、6646–6689、7030）、诊断族 recordHost/emitSessionDiagnostic/recordDroppedPanelRequest/recordPanelFailure/sessionRequestDropReason（6482–6807）、withActiveSession/markActive/touchActiveSession/activeSessionSummary（6830–6901）、handleBtwAsk（7101） | ~1300 |
| `chat/internals.ts` | `ChatControllerInternals` 接口、CurrentTurn/PendingAttachment/EditStage 等内部类型（215–254）、`delay`/`formatUnknownError`/`isSafeBridgeId`/`isTranscriptProjection`/`createEmptySessionCatalog`/`createTransientRecoveryStore`（7282+、7673–7714） | ~350 |
| `chat/turnFlow.ts` | handleSend、echoUserImageAttachments、consumeTurn、handleRuntimeEvent、mirrorExecuteEvent、handleTurnComplete、finishSpecHandoff、publishTurnChanges、handleStop（1153–1788）；handleRetry、retryAfterWorkspaceBecomesAvailable（2835–2910）；failTurn/setTurnStatus/startStreaming/emitTurnState/flushTurnIo（6314–6482）；settleTurnSubagents/refreshContextAfterTurn/refreshSettingsAfterRuntimeEvent（6538–6646）；isCurrentTurn（7247）+ isTurnActive（7286） | ~1250 |
| `chat/queue.ts` | handleQueueAdd/Update/Remove/Resume/Clear、maybeDispatchQueue、pauseQueueAsBlocked、settleQueueAfterTurn、projectQueueState、emitQueueState、discardQueuedPrompts（1788–2080） | ~300 |
| `chat/editResend.ts` | handleRewindInfo、handleEditResend、emitEditResendRejected、performEditResend、handleSessionCompact、performCompact（2080–2485）；handleEditStageBegin/Cancel、buildEditStageAttachments、emitEditAttachments（5076–5194） | ~620 |
| `chat/workspaceActions.ts` | handleFileOpenDiff、handleFilePreview、handleInlineHtmlPreview、handleTerminalOpenMirror、latestTurnChangePaths、handleGitRequestStatus、handleGitCommit、handleWorkspaceOpenPath（2485–2676）+ commitSubject（7268） | ~260 |
| `chat/sessionDirectory.ts` | handleSessionFork/performFork/forkTitleFromText、handleSessionNew、handleWorktreeCreateSession、handleSessionRename/Favorite/Archive/Unarchive、reloadCatalogAfterDaemonWrite、handleArchivedRefresh/refreshArchived、handleSessionSearch/Select、handleRefresh（2676–3436）；startCatalogRefresh/refreshCatalog/canReplaceSession（5335–5395）；loadCatalog/hasCatalogSession（6275、6822）；bindWorktreeSessionMetadata/refreshWorktreeAvailability（6095、7148）；目录代数守卫 beginCatalogLoad/bindCatalogViewToWorkspace/clearCatalog/isCurrentCatalogRequest/discardCatalogRequest（7117–7203）；projectCatalogEntries（7354） | ~1200 |
| `chat/capabilityPanels.ts` | handleContextRefresh、handleSkillsRefresh/pushSkills/handleSkillToggle/emitSkills、handlePluginsRefresh/emitPlugins、handleCommandsRefresh/cachedCommandItems/recordRecentCommand/emitCommands（3436–3849）+ projectSkillSummary/projectPluginSummaries/isPluginScope/projectCommandSummary（7488–7546） | ~520 |
| `chat/mcp.ts` | handleMcpRefresh/pushMcp/handleMcpServerToggle/Add/Remove、reportDroppedMcpMutation、applyMcpMutation、finishMcpMutation、handleMcpServerAuthenticate、emitMcpAuth/emitMcp（3849–4325）+ projectMcpServerSummary（7546） | ~530 |
| `chat/attachments.ts` | canStageAttachments/stagedCount、handleAttachmentPick/Capture/AddPath/AddImage/AddUris/AddTextFile、handleWorkspaceSearchFiles/recordWorkspaceSearch、handleWorkspaceReadImage/emitWorkspaceFiles、handleAttachmentRemove、stageAttachmentPayloads、takePendingAttachments/clearPendingAttachments、retainSentAttachments、emitAttachments（4325–5076）+ toRuntimeAttachment/sentAttachmentSummaries/retentionBytes/boundAttachmentName（7564–7617）+ `MAX_SENT_ATTACHMENT_RETENTION_BYTES`（254） | ~870 |
| `chat/settings.ts` | handleSettingUpdate、isSettingUpdateSupported、isCurrentSettingsUpdate（5194–5335、7062）；emitSettings/emitContext/updateTokenUsage/emitModelCatalog（6490–6538）；refreshContext（6220）；projectConfirmedSettings/projectContextStats/projectModelCatalog、isEnumValue/isSafeContextNumber（7389–7488、7652） | ~480 |
| `chat/runtimeLifecycle.ts` | startReplacement/replaceRuntime、activateInitialRuntime、prepareActivationTranscript、loadHistoryTimed、createInitializedRuntime、activateRuntime（5395–5891）；loadSessionMetadata（6132）；closeRuntime、queueWorkspaceTransition、reconcileWorkspaceContext、waitForWorkspaceTransition（6901–7030）；resetSessionMetadata（7080）；代数/工作区守卫 isCurrentRuntime/isCurrentSessionOperation/isCurrentRuntimeGeneration/isTargetWorkspaceCurrent/isActivationCandidateCurrent/ensureActiveRuntimeWorkspaceCurrent/reportWorkspaceChanged（7038–7247 除目录守卫）；unavailableMessage/isUsableWorkspace/daemonFailureMessage/isSameWorkspaceContext/emitWorkspaceUnavailable（7294–7340、6807） | ~950 |
| `chat/recovery.ts` | reconcileDaemonTurn、pollRecoveredTurn、finishRecoveredTurn（5891–6095）；scheduleRecoveryCheckpoint/checkpointRecoveryTranscript/flushRecoveryCheckpoint（6689–6739）；recoveryTurnId（7278） | ~370 |

合计 ≈ 9000（含接口/导入头开销 ~15%）。最大新文件 ~1300 行（瘦身后的
`ChatController.ts` 本体）。`sanitizeSessionTitle/isSafeModelId/
isSafeDisplayName`（7619–7650）不搬家——批次④直接合并进 shared（§1.5）。

**测试同步拆（8526 行 / 148 用例）**：结构是单个巨型
`describe('ChatController')`（76–7599）+ `describe('…queued messages')`
（7599–7988）+ 共享 harness（8028–8526：createMockRuntime、
createController、ready/send/stop、消息选择器族、deferred 等 ~38 个
辅助函数）。拆法：

| 新文件 | 内容 | 预估行数 |
| --- | --- | --- |
| `chat/__tests__/harness.ts` | 现 8028–8526 全部辅助函数原样导出（vitest include 是 `*.test.ts`，该文件不含用例不会被独立执行） | ~550 |
| `ChatController.core.test.ts` | 启动/连接/快照/工作区切换/dispose/诊断 | ~1200 |
| `ChatController.turnFlow.test.ts` | send/stop/事件流/完成/重试/spec handoff/镜像 | ~1500 |
| `ChatController.queue.test.ts` | 现成的第二个 describe 整体平移 | ~450 |
| `ChatController.sessions.test.ts` | 目录/选择/收藏/归档/搜索/rename/fork/worktree | ~1600 |
| `ChatController.attachments.test.ts` | 附件族 + workspace 搜索/读图 | ~900 |
| `ChatController.capabilities.test.ts` | skills/plugins/commands/mcp/认证 | ~1100 |
| `ChatController.settings.test.ts` | 设置更新/模型目录/token 用量/context | ~600 |
| `ChatController.recovery.test.ts` | 恢复检查点/daemon 对账/轮询 | ~700 |

用例全部是黑盒（构造 controller → handleMessage → 断言 emit 消息），
搬家不改断言。**用例数守恒是门禁**（§2 批次②）。

### 1.3 Thread.tsx（4078 行）→ `src/webview/assistant/thread/` 子组件

外部消费面已查证极窄：`App.tsx` 只 import `DroidThread`；
`Thread.test.tsx`（744 行）import 若干内部导出。拆分后 `Thread.tsx`
原路径保留为根组件文件，测试改 import 路径（一个文件，直接改，不留
兼容 re-export）。

| 新文件 | 搬入成员（现行号） | 预估行数 |
| --- | --- | --- |
| `Thread.tsx`（保留） | 六个 Context（162–195）、DroidThreadProps、DroidThread 根组件与滚动/粘性协调（196–849）、FOLLOW_REJOIN_PX/SCROLL_BOTTOM_SHOW_PX 及滚动辅助（3965–4078）、THINKING_SMOOTH_OPTIONS | ~850 |
| `thread/UserMessage.tsx` | EDIT_REJECT_COPY、UserMessage、EditAttachmentChip（849–1243） | ~410 |
| `thread/AssistantMessage.tsx` | AssistantMessage、RegenerateAction、ForkAction（1243–1416） | ~200 |
| `thread/transcriptRows.tsx` | ToolFilePath、PreviewChip、ThinkingRow、ChangedFileEntry/readChangedFiles/readChangesTurnId、ChangesSummary、Diagnostic、CompactDivider、PendingResponse、HistoryNotice（1416–1705、3040–3069） | ~380 |
| `thread/Composer.tsx` | Composer 本体（1705–2713）、粘贴/拖拽图片辅助（MAX_ATTACHMENT_IMAGE_BYTES/isImageMediaType/readFileAsBase64，3841–3965 段内）、AttachmentChip + ATTACHMENT_KIND_LABELS（2858–2919） | ~1200 |
| `thread/composerCommands.ts` | MentionToken、SlashToken、BUILT_IN_COMMANDS、BTW_COMMAND、MAX_SLASH_SKILL_MATCHES、SlashEntry（2713–2858） | ~160 |
| `thread/activityRows.tsx` | ToolActivityPresentation/readToolActivity、readMetadataBackground/Subagent、ToolOutputPreview、ExecuteMirrorEntry、ToolActivityRow、BackgroundProcessHint、SubagentSummaryRow、ActivityGroup、TaskPlan（3069–3629） | ~600 |
| `thread/readers.ts` | readDroidvisxMetadata、readMetadataDuration、readReasoningDuration、firstLine、formatDuration、formatToolLifecycle/Progress/UpdateKind、readUserMessageId、readUserAttachments、readMessageText、readDiagnostic（3629–3841） | ~250 |
| `thread/icons.tsx` | ActivityChevron、SendIcon、ScrollToBottomIcon、CopyIcon、CopyActionContent、CheckIcon、RegenerateIcon、ForkIcon（2919–3040） | ~140 |

最大新文件 ~1200 行（`thread/Composer.tsx`——Composer 单函数就有
~1000 行，函数内部拆解属于行为风险，本轮不做，先物理隔离）。

### 1.4 ComposerControls.tsx（2843 行）——可选批次（③b）

接近但未破阈值。若做，按弹层家族切：

| 新文件 | 成员 | 预估行数 |
| --- | --- | --- |
| `ComposerControls.tsx`（保留） | 根组件、OpenPanel/SettingsView 类型、shouldOpenPopoverDown、MODE/AUTONOMY_OPTIONS（1–592） | ~650 |
| `controls/SettingsPopover.tsx` | SettingsPopover、SettingsDropdown、SettingsInfoRow/Icon、rankNameMatches（599–1016、1915–2050） | ~600 |
| `controls/McpPanel.tsx` | McpPanel、McpAddServerForm、McpServerRow（1174–1601） | ~430 |
| `controls/SkillsPluginsPanels.tsx` | SkillsPanel、SkillRow、PluginsPanel、PluginRow（1016–1174、1601–1706） | ~270 |
| `controls/AttachRows.tsx` | AttachRows、AttachIcon（1706–1896） | ~195 |
| `controls/ContextPopover.tsx` | ContextPopover、ContextUsage、Stat、TOKEN_USAGE_ROWS、TokenUsageSection、formatCredits（2132–2391） | ~270 |
| `controls/ModelPopover.tsx` | ModelPopover、ReasoningEditor、SettingsStatus、ModelCatalogStatus、model 格式化辅助（2391–2843） | ~470 |
| `controls/icons.tsx` | ChevronLeft/Down、Search、Check、Pencil（2050–2132 等散落） | ~120 |

### 1.5 重复实现合并 + 孤儿导出清理（批次④）

全部已逐处复核（2026-08-12）：

| 项 | 现状 | 合并/清理方案 | 行为影响 |
| --- | --- | --- | --- |
| `isSafeModelId` ×4 | `shared/validateMessage.ts:1481`（私有）、`webview/bridge/validateHostMessage.ts:3515`、`extension/ChatController.ts:7632`、`runtime/FactoryDroidRuntime.ts:1825`，四份逐字符相同 | `shared/validateMessage.ts` 的那份加 `export`，其余三处删除改 import。分层合法：四层都允许 import `src/shared`（esbuild 禁运入检查只禁 extension/runtime 进 webview bundle） | 零 |
| `isSafeDisplayName` ×2 | ChatController:7642、validateHostMessage:3523，相同 | 同上，落位 `shared/validateMessage.ts` 并导出 | 零 |
| `sanitizeSessionTitle` ×2 | `runtime/SessionCatalog.ts:46`（上限 `MAX_SESSION_CATALOG_TITLE_LENGTH`=200，供 Factory/Daemon 目录）vs `ChatController.ts:7619`（上限 `MAX_SESSION_TITLE_LENGTH`=256，Bridge 契约） | 合并为 `shared` 单实现 `sanitizeSessionTitle(value, maxLength)`（新 `src/shared/sanitizeTitle.ts` 或并入 validateMessage.ts）；两个调用方**各自保留现有上限常量**传参 | 零（上限差异是两条信任边界的既有契约，保留；若要统一成 256 须用户拍板，不在本计划内） |
| `store.ts` `hasTurnContent`（:1100） | 导出、全仓零引用（含测试） | 确认 Webview 内无使用后整函数删除；若函数体被同文件调用则仅去 `export` | 零 |
| `bridgeMessages.ts` `MAX_INTERACTION_TEXT_LENGTH`（:127） | `= MAX_INTERACTION_DETAIL_LENGTH` 别名，零引用 | 删除该行 | 零 |
| `ChatController.ts` `MAX_SENT_ATTACHMENT_RETENTION_BYTES`（:254） | 导出但仅本文件 :5055 使用，测试也未引 | 去 `export`（批次②搬入 `chat/attachments.ts` 时顺势处理） | 零 |

## 2. 执行阶段划分

### 批次①：styles.css 拆分 + token 收敛 + 卫生清理（用户已拍板捆绑）

子批次串行，同一代理同一窗口完成：

| 子批 | 内容 | 门禁（行为等价证明） |
| --- | --- | --- |
| ①a 机械拆分 | §1.1 区段表切 18 文件 + `@import` 索引 | **产物逐字节比对**：拆分前 `pnpm run build` 存 `dist/webview/webview.css` 哈希 → 拆分后重建比对（`Get-FileHash`）。规则顺序未动 ⇒ 必须全等，不等即回退 |
| ①b 卫生清理（行为修复，独立提交） | 6 组事故性重复选择器逐组判定合并；7 个幽灵 token 落定（有意保留的补定义进 token 块、无意的删 var() 改回字面量——按 theme 文档 §1.2）；2 个未使用 token 删除；4 个丢失 className 规则从 git 历史找回（`git log -S`），属修复单范围可并入 | 逐条列出预期可见变化（如 `.dvx-user-edit-restore:hover` 恢复生效）；样式审计脚本（见①c）跑前后对比，diff 必须恰好等于声明的修复清单 |
| ①c 颜色 token 收敛 | 260 hex + 97 rgba 归并进 ~24 个 `--dvx-*` token（对应表已在 theme 文档 §1.1/§2.1，~104 处是与现 token 完全同值的机械替换）；token 块抽出为 `01-tokens.css` 前移 | **计算样式对比脚本**（新 `scripts/styleAudit.mjs`，沿用仓库 headless-Chrome-CDP harness 惯例）：加载真实 bundle 的 harness 页面，枚举全部 `dvx-*` 元素，记录 `getComputedStyle` 的 color/background/border/shadow/outline，收敛前后 JSON diff 必须为空（var() 替换后计算值不变） |

- **前置条件**：无代码前置；须**独占 styles.css 窗口**（theme 文档 §2.4
  已警告冲突面大）。开工前重扫行数与族群边界。
- **独占文件**：`src/webview/assistant/styles.css`、新 `styles/` 目录、
  `scripts/styleAudit.mjs`；①a/①c 各需一次 build（全仓 build 互斥）。
- **通用门禁**：`pnpm run typecheck`（三段）+ `pnpm run test`（全量
  vitest）+ `pnpm run build` + VSIX 安装 + Cursor 目检一轮主界面。
- **预估**：①a 0.5 天、①b 0.5 天、①c 1–1.5 天，共 **2–2.5 天**。
- **并行性**：可与批次②并行（extension 层 vs webview CSS，无文件交
  集）；**不可**与批次③/③b 或任何改 webview 视觉的切片并行。

### 批次②：ChatController 拆分（含测试同步拆）

| 子批 | 内容 |
| --- | --- |
| ②a | `chat/internals.ts` 接口 + 底部纯函数区归位（7268–7714 中非合并项） |
| ②b | 低耦合域搬出：queue / mcp / capabilityPanels / attachments / settings / workspaceActions / editResend |
| ②c | 高耦合域搬出：turnFlow / runtimeLifecycle / recovery / sessionDirectory |
| ②d | 测试拆分：harness 提取 + 148 用例按 §1.2 表分 9 文件 |

- **前置条件**：与在途 extension 层切片（daemon 收尾 A4、V1 #7+ 排队
  消息、子代理摘要 #6 的 Host 部分）**不可交叠**——开工前确认没有其他
  代理持有 ChatController；若有在途分支，先合入再拆（§5.3）。
- **独占文件**：`src/extension/ChatController.ts`、
  `ChatController.test.ts`、新 `src/extension/chat/` 目录。
- **门禁**：typecheck 三段 + 全量 vitest + **用例数守恒**（拆分前后
  `npx vitest run src/extension --reporter=json` 提取用例名集合，必须
  相等——148 个一个不少）+ build + VSIX 安装 + 真实会话发一轮消息冒烟
  （send/stop/附件/设置各一次）。
- **预估**：②a 0.5、②b 1、②c 1、②d 0.5，共 **3 天**。
- **并行性**：批次内不可再分给多代理（共享 internals.ts 与
  ChatController.ts 本体，天然串行）；批次整体可与①或③并行。

### 批次③：Thread.tsx 拆分（+可选③b ComposerControls）

- **前置条件**：批次①完成（避免 CSS/组件同窗口双改导致视觉回归无法
  归因）；与在途 webview 切片（小地图、子代理回放）不可交叠。
- **独占文件**：`Thread.tsx`、`Thread.test.tsx`、新 `thread/` 目录；
  ③b 加 `ComposerControls.tsx`、`ComposerControls.test.tsx`、新
  `controls/` 目录。
- **门禁**：typecheck 三段 + `pnpm run test:webview` + 全量 + build +
  **DOM 快照对比**：复用现有 harness（`artifacts/subagent-harness.html`、
  `shimmer-harness`、`path-link-harness` 已覆盖活动行/流式/路径链接三
  形态），拆分前后各跑一遍，序列化 `#root` outerHTML 与关键
  computedStyle 全等 + 截图肉眼比对；VSIX 安装 + Cursor 目检。
- **预估**：③ 1–1.5 天；③b 0.5–1 天（可独立排期，优先级最低）。
- **并行性**：③ 与 ② 可两代理并行（extension vs webview 无文件交
  集，注意 build 互斥错峰）；③ 与 ③b 若分两代理则不可同时（同在
  assistant/ 目录且 Composer/ComposerControls 互相 import）。

### 批次④：重复实现合并 + 孤儿导出清理

- **前置条件**：批次②完成（`isSafeModelId` 等的 ChatController 侧
  副本在②后位于 `chat/` 模块，改动点清晰；避免与②的搬家 diff 打架）。
- **独占文件**：`shared/validateMessage.ts`（或新 `shared/sanitizeTitle.ts`）、
  `shared/bridgeMessages.ts`、`webview/bridge/validateHostMessage.ts`、
  `runtime/FactoryDroidRuntime.ts`、`runtime/SessionCatalog.ts`、
  `webview/assistant/store.ts`、`chat/` 相关模块。**跨全部四层**，是
  唯一必须全仓独占的批次（好在只有 ~0.5 天）。
- **门禁**：typecheck 三段 + 全量 vitest + build（esbuild 的 Webview
  禁运入断言会自动验证 shared 归位没把 runtime/extension 拖进 webview
  bundle）+ VSIX 安装。
- **预估**：**0.5 天**。

## 3. 分工模型与窗口时序

原则：**一个批次 = 一个代理独占其文件族**；跨批次可双代理并行；全仓
只有一个 build/package/install 执行权（AGENTS.md 物理互斥）。

| 窗口 | 代理 A（webview 族） | 代理 B（extension 族） | 备注 |
| --- | --- | --- | --- |
| W1 | ①a 拆分 + ①b 清理 | ②a internals + ②b 低耦合域 | A 持 styles.css，B 持 ChatController*；build 错峰：A 在窗口头尾各一次基线/比对 build，B 本窗口只跑 vitest/typecheck |
| W2 | ①c token 收敛 | ②c 高耦合域 | 同上 |
| W3 | ③ Thread.tsx 拆分 | ②d 测试拆分 → ④ 合并清理 | ④ 动 `webview/assistant/store.ts` 与 `webview/bridge/`——**与 A 的 thread/ 目录无交集**，但 B 开动 ④ 前与 A 确认；或 ④ 顺延到 W4 |
| W4 | 暗色主题实施（theme 文档 §2，吃①c 的 token 地基） | 小地图（吃③的 thread/ 拆分成果）或 修复单剩余项 | 重构结束，恢复正常切片节奏 |

- **与其他已排期工作的关系**：
  - **修复单**（代码质量审查产出）：其中 styles.css 项（丢失 className、
    幽灵 token）已并入①b；其余修复项若涉及 ChatController/Thread，
    **必须在对应拆分批次之前或之后完成，不得交叠**——建议排前（修复在
    旧文件里做，拆分把修复一起搬走），因为拆分后再改修复单引用的行号
    /位置全部失效。
  - **性能审计**：只读工作，任意窗口可并行，不占文件锁。
  - **子代理转录回放**（backlog，动 Thread/store/Host）：排 ③ 之后
    （W4+），直接在新模块结构上开发。
  - **暗色主题实施**：硬依赖 ①c 的 token 收敛（theme 文档明言收敛是
    地基），排 W4。
  - **小地图**：动 Thread 滚动协调器，排 ③ 之后（W4+）。
  - **V1 主线在途切片**（#6 子代理摘要、#7+ 排队等）：与②冲突面最大；
    若主线优先，则②整体后移，①/③照常——三个批次互相独立，顺序可换。
- **总耗时**：串行 6.5–8 个代理工作日；按上表双代理并行压缩到
  **约 4 个日历窗口**（不含可选③b 与 W4 的后续工作）。

## 4. 防回潮护栏：文件行数门禁

- **脚本**：新建 `scripts/checkFileBudgets.mjs`（仓库现无 scripts/
  目录，新建之；不放 `artifacts/`——那里 git-ignored，护栏必须进版本
  控制）。逻辑：
  1. 扫描 `src/**/*.{ts,tsx,css}`（排除 `*.test.*` 用独立阈值）；
  2. 默认阈值：TS/TSX **900 行**、CSS **800 行**、测试文件 **2000 行**；
  3. 内置**棘轮 allowlist**：现存超标文件按"当前行数 + 2% 余量"登记
     （如 `chat/turnFlow.ts: 1300`），只许降不许升；每次有人把文件
     降到阈值内就从 allowlist 删除该行；
  4. 超标即 exit 1，输出"文件 / 现行数 / 预算 / 建议拆分方向"。
- **接入方式**（仓库无 CI，门禁 = HANDOVER §4 的手动命令清单 + pnpm
  script 链）：
  1. `package.json` 增加 `"lint:budgets": "node scripts/checkFileBudgets.mjs"`；
  2. 挂进 `package:prepare`（`typecheck && test && lint:budgets && build`），
     使每次出包必查；
  3. HANDOVER §4 完成门禁代码块加一行 `pnpm run lint:budgets`；
  4. AGENTS.md 工程规则区加一句"新文件不得超预算，超标须先拆再合"。
- **落地时机**：批次②完成后立即上线（那时 allowlist 最短）；批次①后
  可先对 CSS 生效。

## 5. 风险与回退

### 5.1 "纯搬家"红线怎么守

- 搬家提交与行为修复提交**物理分离**（①b 单独成串），每个搬家提交的
  验证产物（CSS 哈希、用例名集合 diff、DOM 快照 diff）记入提交信息或
  `implementation-status.md` 验证条目。
- 机械性优先于美观：`this.` → `ctl.` 之外零文本变化；不顺手改名、不
  调整参数、不换 import 风格。发现真 bug 记入修复单，不当场改。
- 每个批次在独立分支上做成小提交序列（一个目标文件一个提交），回退 =
  `git revert` 区间，无任何数据/格式迁移，无回滚成本。

### 5.2 导出兼容层：基本不留

- `ChatController.ts`、`Thread.tsx`、`styles.css`、
  `ComposerControls.tsx` 四个**原路径全部保留**（变薄），外部 import
  零变化——这本身就是兼容层，无需额外 shim。
- 测试专用导出（`FOLLOW_REJOIN_PX`、`BUILT_IN_COMMANDS` 等）：消费者
  只有各自的 `.test.tsx`（已 rg 证实），直接改测试的 import 路径，
  不留 re-export。唯一例外：若 ②/③ 期间有并行分支在途，可临时在原
  文件加 `export … from './chat/…'` 聚合行，批次④统一摘除。

### 5.3 git 历史可追溯性

- 一对多拆分无法用 `git mv`；靠**逐字搬移 + 单文件单提交**让
  `git blame -C -C` 与 `git log --follow -L` 的拷贝检测保持命中。
- 提交信息写明"moved from ChatController.ts L1153–L1788, verbatim"，
  §1 的映射表即是日后考古的索引（本文档长期保留）。

### 5.4 在途功能分支冲突

- **开工闸门**：每个批次动工前，用 `git status` + 与并行代理沟通确认
  目标文件族无未合并改动；有则**先合后拆**（拆分分支 rebase 功能分支
  的成本远高于反向）。
- 拆分批次落地后，存量在途分支的冲突解法固定为："以功能分支的语义
  改动为准，按 §1 映射表把改动重放到新模块位置"——映射表就是冲突
  处理手册。
- 批次窗口期间，其他代理对被独占文件族的需求一律排队（AGENTS.md
  物理互斥），紧急修复走"通知拆分代理代为落入"。

### 5.5 技术残余风险

- ①a 的字节等同门禁若因 esbuild 对 `@import` 的注释/空白处理出现
  非语义 diff（预期不会，minify 后注释全消），降级为"CSS 规则序列化
  AST 对比"（postcss 解析后逐规则比对），仍是硬门禁。
- ②的 `ChatControllerInternals` 会把私有字段暴露给 `chat/` 目录——
  用注释 + 目录边界约定（仅 `src/extension/chat/` 可用）控制；这是
  拆分的固有代价，后续如需硬约束可加 eslint 边界规则（本计划不含）。
- ③ 中 Composer（~1000 行单函数）只做物理隔离不做函数内拆解；其内部
  复杂度是已知遗留，记入 backlog，不算本轮回潮。
