# 主聊天过程与视觉减重实施计划

计划日期：2026-09-05
计划状态：**代码与文档已完成，检查、VSIX 校验和 Cursor 安装通过；待 Reload 后动态验收**。
设计依据：`DESIGN.md` 的“主聊天过程、流式输出与视觉减重”。

## 1. 目标与授权

在不改变 Runtime、Host 和 Bridge 业务语义的前提下，交付一套稳定的连续过程区、
克制的流式与展开动效、统一的主聊天控件状态和三主题配色。

用户已授权自主取舍、完成设计文档后直接写代码，不需要逐项确认。本轮由当前代理
串行完成，不委派子代理。用户随后明确授权安装扩展，远端发布仍不在授权内。

当前只完成设计不算产品能力上线。代码、类型检查、预算和生产构建完成后记录工程
验证结果；VSIX 安装及真实 Cursor 行为/视觉验收另行进行，不能提前报告已安装完成。
既有 Conversation 恢复过场保留原有触发与 ready 条件，其安装验收状态不由本计划改变。

## 2. 已核对的实现事实

以下是实施前静态检查建立的基线与对应处理，不代表当前代码仍保留旧行为。
截图不能证明运行时卡顿，动态表现尚未测量。对应实现步骤已接通。

| 入口 | 当前事实 | 本轮处理 |
| --- | --- | --- |
| `assistant/activityGrouping.ts` | 至少 3 项、2 个工具才成组；Thinking 超过 200 字符或 2 行拆分 | 连续的 reasoning 与原探索类别从首项稳定成组 |
| `assistant/thread/activityRows.tsx` | 已有 ActivityGroup、单行摘要与 grid 展开；子项始终挂载 | 复用容器，保留用户选择，详情延迟挂载并支持连续退出 |
| `assistant/thread/transcriptRows.tsx` | Thinking 有独立折叠与平滑追赶；历史已有分块上限 | 分组内部直接阅读思考，保留大内容保护，取消装饰性历史追赶 |
| `assistant/MarkdownText.tsx` | MarkdownTextPrimitive 使用 smooth=false 与 defer | 保留解析器和 defer，新文字只增加有界透明度呈现 |
| `assistant/Thread.tsx`, `followScroll.ts` | 主聊天已有 ResizeObserver 与跟随所有权 | 展开与高度变化接入该链路，不另建滚动控制器 |
| `assistant/thread/VirtualizedMessages.tsx` | 消息按需卸载，已存在吸顶与导航边界 | 展开选择不能只存在于会被卸载的行组件中 |
| `assistant/theme.ts` | 已有首帧主题、Host 推送、显式主题与 Auto | 保留协议，不重建主题系统 |
| `styles/00-tokens.css`, `24-theme-dark.css`, `27-theme-auto.css` | 固定主题为纯白/纯黑；Auto 已映射编辑器变量，仍有独立字面覆盖 | 调整固定色板与相关覆盖，维持 Auto 与 Portal 一致 |
| `styles/13-composer.css` | 图标 28px、发送 24px、Mode 有 padding 而 Model 无 padding | 同角色统一几何，短标签与长模型名保持内容宽度 |
| `styles/05-message-cards.css`, `04-chrome-popovers.css` | 多类文字操作 hover 使用 soft 底色 | 区分文字动作、菜单行和主要操作，避免通用色块反馈 |
| `styles/02-markdown.css`, `19-system-overlays.css`, `24-theme-dark.css` | 正文 blockquote 在多个位置定义竖线和次级文字 | 同步修正相关覆盖，不只追加一条无效 CSS |
| `Interactions.tsx`, `composer/SettingsPopover.tsx`, `composer/ModelPopover.tsx` | Allow 与 autonomy / reasoning 使用不同契约 | 只改表现和必要布局，保留原始选项、能力过滤与回执 |

文件表中的 assistant 路径相对 `src/webview`，styles 路径相对
`src/webview/assistant`。具体尺寸、颜色和状态规则只在 `DESIGN.md` 定义。

## 3. 实施边界

- 不增加包依赖、不升级 assistant-ui、不调用其 INTERNAL API，不创建替代 Markdown 引擎。
- 不改变工具分类能力、授权值、设置提交、模型能力、历史恢复或消息协议。
- 不清理无关 CSS、不拆整套设计系统；只改当前控件及必要的主题覆盖。
- 不重做 Mission、BTW、子代理专属界面、Session Drawer、ReviewDock 和终端卡。
- 共用消息组件或颜色带来的兼容影响必须处理，不能以“不在范围”忽略只读消费者。
- `MarkdownText.tsx` 当前已接近 TSX 文件预算，新的流式呈现逻辑应使用独立的局部模块，
  不把该文件扩成新的大文件；其他文件同样遵守现有预算。
- 不新增视觉原型、截图 harness、探针脚本或为 CSS 文本写单测。

## 4. 依赖顺序

这是同一条主聊天体验链路的实施步骤，不是多条并行工作流。

### 步骤一：过程区结构与状态

主要入口：`activityGrouping.ts`、`thread/AssistantMessage.tsx`、
`thread/activityRows.tsx`、`thread/transcriptRows.tsx`。

1. 移除按成员数和 reasoning 长度改变分组的规则，保留既有工具白名单与消息边界。
2. 纯 Thinking 和混合探索使用同一摘要结构；完成文案区分纯思考与探索。
3. 保留 running、stopped、failed、推理截断和并发执行事实，不能从正文出现猜成功。
4. 用 Thread 范围轻量展示状态保存过程区展开选择，身份依赖 message 与连续段起点，
   不使用内容哈希或持久化字段。虚拟列表卸载重挂保留选择，会话切换和 Reload 清理。
5. 分组内思考正文直接可读，工具结果仍按需展开。独立/只读使用路径保持正确，
   不挂载重复文本，不增加只读 Viewer 的写能力。

验收：单 Thinking、多工具、超长 reasoning、交错正文、失败与停止均不导致突然重组；
展开选择不被追加内容、主题或完成状态覆盖。

### 步骤二：展开与主聊天滚动协调

主要入口：`thread/activityRows.tsx`、`thread/VirtualizedMessages.tsx`、
`processPresentation.tsx`、`styles/12-exploration-ticker.css`。复用
`Thread.tsx` / `followScroll.ts` 现有跟随引用，不新增滚动控制器。

1. 摘要点击使用同一展开状态；详情首次打开才挂载，退出过渡后可释放重详情。
2. 复用 CSS grid 高度过渡；控制子内容生命周期，避免先移除内容再播放空壳动画。
3. 折叠区即时退出交互与可访问树，键盘关闭时保留合理焦点；快速反向操作从当前状态接续。
4. 查看详情暂停主聊天尾部跟随，保持摘要位置，不启动第二个 observer/scroll 控制器。
5. 移除当前活动的位移跑马灯和叠加 shimmer，使用单一轻量状态信号；Reduced Motion
   同时覆盖 CSS 过渡和相关呈现逻辑。

验收：摘要不随展开跑出视口；流式输入与点击同时发生时不抢阅读位置，底部跟随仍能恢复。

### 步骤三：正文新增文字轻淡入

主要入口：`MarkdownText.tsx`、`streamingText.tsx`、
`styles/02-markdown.css`；保留现有 Markdown 安全配置与内容组件。

1. 保持 smooth=false、defer 和现有 preprocess；不通过逐字队列模拟模型速度。
2. 使用现有 Markdown 插件/组件扩展点标记普通文本新增后缀，不直接重写 React DOM。
   标记按当前 message / part 与已呈现前缀隔离，首次挂载时已有内容视为已呈现。
3. 只在可证明是追加文本时淡入；Markdown 重解析、内容替换或缺少稳定边界时直接
   呈现完整内容。代码、表格、公式和 Mermaid 维持原策略，不做逐字包装。
4. 每批只保存有限的瞬态标记；过渡后恢复普通内容，禁止长回复累积每 token 的元素。
5. 完成、中断、选区、Reduced Motion 与重挂载不重播旧内容；复制和预览继续消费真实文本。

验收：不遗漏正文、不重复文字、不影响链接/代码/数学语义；新文字有轻反馈，旧段落不闪动。

### 步骤四：颜色基线与控件减重

主要入口：`styles/00-tokens.css`、`24-theme-dark.css`、`27-theme-auto.css`，
`02-markdown.css`、`04-chrome-popovers.css`、`05-message-cards.css`、
`10-shell-frame.css`、`12-exploration-ticker.css`、`13-composer.css`、
`14-settings-popover.css`、`18-interactions.css`、`19-system-overlays.css`、
`23-interaction-dock.css`，以及对应的 Composer / 权限组件。

1. 先落实固定主题 token 与 Auto 回退，再修正本轮组件的字面色覆盖；不改变主题通信。
2. Composer 底部触发器统一高度、内边距、图标占位；保持现有菜单定位、可用性和提交逻辑。
3. 长模型名与 effort 一起受可用宽度约束，菜单独立定宽，防止其撑大触发器。
   Effort 在原模型菜单内切换并提供返回入口，移除向侧边再占 168px 的浮出布局。
4. 次要文字动作 hover 不铺底色；菜单行保留定位反馈，主要动作有清楚但克制的轮廓。
5. 权限卡减少重复框线和背景，保留风险、对象、范围和拒绝入口；设置选项不改原始值。
6. 引用恢复正文可读性；代码块只保留一层容器；主聊天问题卡只减轻非必要阴影。
7. 逐一检查 default、hover、active、expanded、selected、busy、disabled、focus-visible，
   不用一个全局 hover 覆盖全部控件。

验收：按 DESIGN.md 的尺寸/主题矩阵检查，没有因减重丢失操作反馈或必要信息。

## 5. 验证与交付

### 文档阶段

- 检查本地链接、实施入口、设计与计划的一致性、占位文本和 `git diff --check`。
- 固定色板的正文、次级、辅助文字与焦点已可用 WCAG 相对亮度公式做静态计算；
  计算结果不能声称已经通过浏览器截图或真实主题验收。

### 代码阶段

依次运行：

```powershell
pnpm run typecheck
pnpm run lint:budgets
pnpm run build
git diff --check
```

遵守仓库测试规则：不为 CSS、类名或静态控件新增测试；当前会话未明确要求运行
测试套件、浏览器 smoke 或截图 harness，默认不运行。若已发布行为缺陷无法通过
类型检查和低成本复现确认，才启用最窄的行为验证并说明目的，不跑无关全量检查。

验收场景覆盖：分组阈值跨越、展开后完成/失败、虚拟列表返回、长消息与 Markdown
闭合、复制/选择、离底阅读、320/400px 长标签、三主题及 Reduced Motion。
未实际运行的动态场景必须标记为未验证，不以静态代码审查代替动画验收。

实施改变产品事实时同步 `STATUS.md`，只写已经接通与实际验证的结果。最终审查
本轮精确路径及 staged diff，提交一个本地原子提交，不包含 dist、VSIX、日志、
截图、凭据或其他用户改动，不 push。

### 安装阶段（已按用户追加授权完成）

已依次执行 `pnpm run package:vsix`、`pnpm run verify:vsix`、
`cursor --install-extension dist/droidvisx.vsix --force`；75 项 VSIX 校验通过，Cursor
确认安装 `droidvisx.droidvisx@0.8.0`，已告知用户 Reload Window。
`package:vsix` 的现有 prepublish 会串行执行 package:prepare，不并发启动构建。
真实 Cursor 交互、视觉和主题验收通过前，不宣称功能已经完成安装验收。
