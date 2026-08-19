# UI Cursor 风格重构 · 设计基线 spec（段 0 产物）

来源：`docs/debug/image对比/`（cursor = 目标，droid = 现状）逐张提取 + 代码现状核对。
用户 10 条需求原文见 `docs/debug/style-refactor.md`「原始需求记录」。
所有 px/色值为截图估值，施工时以「结构与比例对齐」为准，允许 ±1-2px 校调。

---

## 0. 总则：色板策略与照抄边界

Cursor 截图全部是**冷中性暗色**（#141416–#26262b 灰阶）。我们的 token 体系
（`styles/00-tokens.css`）是暖白基线 + charcoal 暗色，且 charcoal 注释里明确
「referencing Cursor's dark (#1a1a1a–#252526)」——**暗色 token 已经对齐 Cursor 档位**。

因此本次重构的照抄口径：

- **照抄**：布局结构、卡片层级、密度（行高/间距）、圆角、边框策略、字号层级、动效。
- **不照抄**：色相。所有色值继续走 `--dvx-*` token（亮色保持暖中性，暗色保持 charcoal），
  spec 里给出的 Cursor 十六进制估值只用来标定「明度差 / 对比度关系」，落地时翻译成 token。
- **例外待用户拍板**：终端卡片 well 现为暖琥珀（`#262019`），Cursor 是中性深灰。
  见 §10 风险 R4。

---

## 1. 全局设计 token 对照表

### 1.1 色板（Cursor 暗色估值 → 我们的 token 映射）

| 角色 | Cursor 估值 | 现有 token（dark 值） | 结论 |
| --- | --- | --- | --- |
| 页面底 | #141416–#18181a | `--dvx-surface` #1a1a1a | 已对齐，不动 |
| 卡片面（用户卡片/composer/终端卡） | #1e1e21–#202024 | `--dvx-raised` #242425 | 已对齐（明度差 ~4%，够分界） |
| 深井（终端输出区） | #151517 | `--dvx-code` #1e1e1f | 我们的井比卡片浅——Cursor 是**井比卡片深**，段 B 校正 |
| 边框 hairline | rgb(255 255 255 / 8–10%) | `--dvx-border` 9% 白 | 已对齐 |
| hover 边框/行高亮 | rgb(255 255 255 / 14–16%)、行底 #2a2a30 | `--dvx-border-strong` 16%、`--dvx-soft` 6% | 已对齐 |
| 主文字 | #e6e6e9 | `--dvx-ink` #e8e8e8 | 已对齐 |
| 次文字 | #b8b8bd | `--dvx-text-secondary` #bdbdbd | 已对齐 |
| 灰注（时间戳、"Finished 2 subagents"） | #8b8b92 | `--dvx-muted` #9a9a9a | 已对齐 |
| 极淡（占位、快捷键） | #6b6b71 | `--dvx-subtle` #6f6f6f | 已对齐 |
| 内联 code / 文件 pill | 文字 #8fa8e8（偏蓝紫）底 #26262b | `02-markdown.css` 现值 | 结构对齐即可，色走 token |
| diff 加/删 | #4fb56a / #e5645e | `--dvx-diff-add/del`（dark #57ab5a/#f47067） | 已对齐 |
| 实心主按钮（Review/Stop 白底黑字） | 底 #e8e8ea 字 #1a1a1a | `--dvx-accent`(dark)=#d4d4d4 + ink 反转 | 已对齐（dark 下 accent 即光底） |

**结论：暗色色板基本不需要动。差距集中在几何、密度、结构、动效层。**
三主题（黑/白/auto）逐 token 完整色板见 §1.5（补充需求，2026-08-15 下午）。

### 1.2 几何 token（从截图提取的目标值）

| 项 | Cursor 目标值 | 现状 | 备注 |
| --- | --- | --- | --- |
| 卡片圆角（用户卡片/终端卡） | 8px | 用户卡 8px、终端卡 10px | 终端卡收到 8px |
| Composer 圆角 | 10–12px | 12px | 保持 |
| 菜单/浮层圆角 | 6–8px | mode 8px、composer-popover 12px | 浮层统一收到 8px |
| 小按钮圆角（Review/Stop） | 4–5px | — | 新增场景 |
| 卡片边框 | 1px hairline | 1px | 保持 |
| 菜单 padding | 4px（行自带 6–8px 横向内距） | mode 4px、popover 10px | popover 类收到 4–6px |
| 菜单行高 | 26–28px | 各处不一 | 统一 27px |
| 文件/review 行高 | 23–24px | changes 行 27px | 收紧到 24px |
| 吸底折叠行高（16 Files / 1 subagent running） | 30–32px | — | 新增场景 |
| 页面左右边距 | ~10px（卡片贴边，比我们更满） | 16px（≥900px 22px） | 段 A 决策：收到 12px 左右 |
| 消息间距 | 用户卡片后 ~14px、AI 段落间 ~10px | message 下缘 20px | 收紧 |
| 阴影 | 浮层 0 8px 24px -8px rgb(0 0 0/40%)；卡片近乎无阴影只靠边框 | `--dvx-shadow` 浮层级 | 卡片阴影弱化，浮层保持 |

### 1.3 字号层级

| 层 | Cursor | 现状 | 结论 |
| --- | --- | --- | --- |
| 正文 / 用户消息 | 13px / 行高 ~1.6 | 13px / 21.125px | 保持 |
| 菜单项 / 文件名 | 12.5–13px | 12–13px | 保持 |
| 折叠行标题（Worked for 51s、16 Files） | 12px，muted | 12px | 保持 |
| 元信息（5m ago、Completed、快捷键） | 11–11.5px，subtle | 10.5–11px | 保持 |
| 等宽（命令、文件 pill） | 12px | 11–11.5px | 提到 12px 待段 B 实测 |
| 标题（子代理工作区 h1） | 与主聊天 markdown 相同层级 | 相同 | 保持 |
| 字重 | 强调 500–600，正文 400 | 400–560 | 保持 |

### 1.4 动效清单（截图看不出的部分按 Cursor 产品行为补全）

| 动效 | 规格 | 现有 token |
| --- | --- | --- |
| 菜单/浮层出现 | rise + fade，120–150ms，ease-out，origin 锚点侧 | `dvx-rise-in` + `--dvx-duration-normal` 已有 |
| 菜单消失 | 反向 100ms | `dvx-rise-out` 已有 |
| 折叠展开（Worked for / Files / 终端 / subagent 行） | height + opacity 连续过渡 200–300ms | `interpolate-size` + `::details-content` 方案已在终端卡用，推广 |
| chevron 旋转 | 150ms | 已有 |
| 行 hover | 背景 `--dvx-soft` 淡入 100ms | 已有 |
| 卡片 hover | border-color 变 strong 160ms，无位移 | 已有 |
| 用户卡片点击展开/收起（clamp 3/6 行 ↔ 全文） | height 过渡 200ms；点击卡片跳到消息起点（条目 10/20 已做） | 段 A 补 height 过渡 |
| 新消息/新行进入 | fade 100–150ms，只在 live turn | `dvx-entry-fade` 已有 |
| 吸底行（Review/subagent）出现 | 从 composer 后方 slide-up 150ms | 新增 |
| 子代理工作区整页切换 | 淡入 150ms（或无动画直切，同 Cursor tab 行为） | 新增 |
| prefers-reduced-motion | 全部动画归零 | 已有约定，沿用 |

### 1.5 三主题完整色板（补充需求，2026-08-15 下午）

一张表覆盖黑（charcoal，`00-tokens.css` dark 块）/ 白（暖白基线）/ auto
（`27-theme-auto.css`，跟随 `--vscode-*`）。**加粗 = 相对现状的改动或新增**；
未加粗 = 现值保留。auto 列写的是目标映射规则（含兜底），不是现状。

**auto 列总规则（本次核心决策）**：凡是「层次差」类 token（raised/overlay/border/
soft/文字梯队/井），一律改为**从 `--vscode-foreground` × `--vscode-sideBar-background`
两个必然存在且必然互异的锚点用 `color-mix` 确定性推导**，不再把
`--vscode-editorWidget-background`（常与 sideBar 同值）、`--vscode-panel-border`
（常透明）当第一信源——它们降级为「存在且可用时的首选」或直接弃用。
这就是 §2.2 需求 5 修复方案的逐 token 落地。

#### 表面层次

| token | 黑 | 白 | auto 映射（→ 为兜底链） | 备注 |
| --- | --- | --- | --- | --- |
| `--dvx-surface` 页面底 | #1a1a1a | #f5f3ef | `--vscode-sideBar-background` → `--vscode-editor-background` → #f5f3ef | 现状保留，auto 的唯一「底锚点」 |
| `--dvx-raised` 卡面 | #242425 | #ffffff | **`color-mix(in srgb, var(--dvx-ink) 5%, var(--dvx-surface))`，弃用 editorWidget 首选** | **auto 规则改**：保证任何主题下卡与底恒有 ~5% 明度差（R1 修复） |
| `--dvx-code` 代码块 | #1e1e1f | #f7f5f1 | `--vscode-textCodeBlock-background` → `color-mix(in srgb, var(--dvx-ink) 4%, var(--dvx-surface))` | **auto 兜底链改**（原兜底 input-background 同样有同值风险） |
| **`--dvx-well` 终端井（新增）** | **#141414** | **R4 拍板：☐ 照抄深井 #1f1f22 ☐ 保暖 #eceae5** | **`--vscode-terminal-background` → `color-mix(in srgb, #000 20%, var(--dvx-surface))`** | 收编 `08-command-card.css` 硬编码的 #262019/#16120e/#efece6；井必须比卡面深一档（§3.4） |
| **`--dvx-overlay` 浮层（新增）** | **#2a2a2c** | **#fbfaf7** | **`color-mix(in srgb, var(--dvx-ink) 8%, var(--dvx-surface))`；editorWidget 存在且可信时可作首选** | 收编 `13-composer.css` 的字面值 #faf9f6；浮层比卡面再高一档 |

#### 边框层次

| token | 黑 | 白 | auto 映射 | 备注 |
| --- | --- | --- | --- | --- |
| `--dvx-border` | rgb(255 255 255 / 9%) | **rgb(0 0 0 / 8%)**（替代实色 #e5e5e5） | **`color-mix(in srgb, var(--dvx-ink) 12%, transparent)`，弃用 panel-border 首选** | **白改半透明**：hairline 叠任意暖底都成立；**auto 规则改**：防透明主题（R1） |
| `--dvx-border-strong` | rgb(255 255 255 / 16%) | **rgb(0 0 0 / 15%)**（替代 #d4d4d4） | **`color-mix(in srgb, var(--dvx-ink) 22%, transparent)`** | hover / focus 边框态 |
| `--dvx-soft` hover 洗 | rgb(255 255 255 / 6%) | rgb(0 0 0 / 4%) | `--vscode-list-hoverBackground` → `color-mix(in srgb, var(--dvx-ink) 6%, transparent)` | 现状保留（首选可留 list-hover，它极少缺失） |

#### 文字层次

| token | 黑 | 白 | auto 映射 | 备注 |
| --- | --- | --- | --- | --- |
| `--dvx-ink` | #e8e8e8 | #262626 | `--vscode-foreground` → #262626 | auto 的唯一「墨锚点」 |
| `--dvx-text-strong` | #d6d6d6 | #404040 | **`color-mix(in srgb, var(--dvx-ink) 88%, var(--dvx-surface))`** | **auto 统一梯队**：五档全部由双锚点插值，主题再怪层级也稳定 |
| `--dvx-text-secondary` | #bdbdbd | #525252 | **`color-mix(… 76%, …)`** | 同上 |
| `--dvx-muted` | #9a9a9a | #737373 | **`color-mix(… 62%, …)`**（`--vscode-descriptionForeground` 可作首选） | 同上 |
| `--dvx-subtle` | #6f6f6f | #a1a1a1 | **`color-mix(… 45%, …)`** | 同上；对比度底线 ≥3:1（仅用于元信息） |

#### 强调色

| token | 黑 | 白 | auto 映射 | 备注 |
| --- | --- | --- | --- | --- |
| `--dvx-accent` | #d4d4d4（橙退役，光底） | #f2612e | `--vscode-button-background` → #f2612e | 现状保留；白保品牌橙、黑走「光底反字」，Cursor 同构 |
| `--dvx-accent-strong` | #e8e8e8 | #df5020 | `--vscode-button-hoverBackground` → 上行 | 现状保留 |
| `--dvx-accent-deep` | #bdbdbd | #b5451f | `--vscode-textLink-activeForeground` → 上行 | 现状保留 |
| `--dvx-accent-soft` | rgb(255 255 255 / 10%) | #fff0ea | **`color-mix(in srgb, var(--dvx-accent) 12%, var(--dvx-surface))`**（替代 list-inactiveSelection 首选） | **auto 规则改**：跟 accent 本体联动而非借列表选中色 |

#### 状态色 / 焦点 / 阴影

| token | 黑 | 白 | auto 映射 | 备注 |
| --- | --- | --- | --- | --- |
| `--dvx-danger` | #e5484d | #c93a4a | `--vscode-errorForeground` → #c93a4a | 现状保留 |
| `--dvx-warning` | rgb(220 180 120 / 90%) | rgb(187 77 0 / 90%) | `--vscode-editorWarning-foreground` → 上行 | 现状保留 |
| `--dvx-diff-add` | #57ab5a | #1a7f37 | `--vscode-gitDecoration-addedResourceForeground` → 上行 | 现状保留 |
| `--dvx-diff-del` | #f47067 | #cf222e | `--vscode-gitDecoration-deletedResourceForeground` → 上行 | 现状保留 |
| `--dvx-focus` | rgb(255 255 255 / 42%) | #d2643d | `--vscode-focusBorder` → #d2643d | 现状保留 |
| `--dvx-shadow` 浮层影 | 0 12px 28px -12px rgb(0 0 0/55%) | 0 16px 40px -14px rgb(0 0 0/28%) | 色用 `--vscode-widget-shadow` → 上行 | 现状保留；**卡片一律不用**（§1.2） |
| **`--dvx-ctx-1..5` 上下文图表五段（新增）** | **灰 #7f7f86 · 紫 #a48fd8 · 青 #58b5a8 · 橙 #d8955c · 蓝 #6f9fd8** | **灰 #9a9a9a · 紫 #8a6fc8 · 青 #2f9688 · 橙 #c07a3a · 蓝 #4a7fc0** | **`light-dark(白值, 黑值)`**（webview Chromium 支持；auto 块已声明 color-scheme） | §3.2 Context Usage 分段彩条专用，静音饱和度 |

**白主题主要新增决策汇总**：① 边框族由实色转半透明黑 hairline；② 新增
`--dvx-overlay` / `--dvx-well` 两个表面 token，收编散落的字面值；③ 品牌橙保留；
④ 卡片去阴影只留 hairline，大阴影仅浮层——白主题「不精致感」主要来自边框实色 +
到处小阴影，这两条是主修。
**auto 主要新增决策汇总**：① 层次差 token 全部改双锚点 color-mix 确定性推导；
② 文字五档统一插值梯队；③ 井优先 terminal-background；④ ctx 五色走 `light-dark()`。

---

## 2. 段 A · 聊天主体 spec（需求 1、2、5、10 + 旧账 30、33）

### 2.1 聊天记录（需求 1，`cursor/聊天记录.png`）

Cursor 形态：**header 时钟按钮锚定的下拉浮层**，不是整页列表。

| 项 | 目标值 |
| --- | --- |
| 浮层 | 宽 ~300px，右对齐 header 按钮下方 4px，radius 8px，1px border，浮层阴影，padding 4px |
| 搜索 | 首行内嵌输入，无边框透明底，占位 subtle 色，13px，高 30px，下缘 hairline |
| 分组标题 | Today / Yesterday / Previous 7 days（相对时间分组），11px muted，上 10px 下 4px，左 8px |
| 行 | 高 28px，radius 4px，左侧 14px 状态图标（运行=spinner，完成=淡灰圈勾），标题 13px ink，单行省略号 |
| 行 hover | 底 `--dvx-soft`；**行内右侧浮现操作**：… 菜单、pin、删除（图标 14px muted→ink） |
| 当前会话行 | 常驻高亮底 + 右侧操作常显 |
| Archived | 底部折叠行「› Archived」，12px muted，上缘 hairline |
| 日期 | Cursor 不显示每行日期（分组已表达）；我们右侧日期删除，信息移入 hover title |

现状差距：`SessionDrawer.tsx` 已是顶部下拉抽屉（形态接近），但占满整宽、带大搜索框、
右对齐日期、worktree 新建行、ARCHIVED 大写标签。改：收窄为右锚浮层、行样式全面替换、
保留 worktree/重命名等我们特有功能但降级为行内 hover 操作或底部次要行（样式服从 Cursor，功能不删）。

涉及文件：`SessionDrawer.tsx`、`styles/15-model-sessions.css`（.dvx-session-*）、
`styles/04-chrome-popovers.css`（350px 宽度规则）、`App.tsx`（触发按钮位）。

### 2.2 发送卡片与宽度对齐（需求 2、5，`cursor/已发送卡片和聊天区.png`）

| 项 | 目标值 |
| --- | --- |
| 用户卡片 | 全宽 = composer 宽，radius 8px，1px `--dvx-border`，底 `--dvx-raised`，padding 10px 12px，13px 文字 |
| 吸顶 | 保持现有 sticky 行为；吸顶时卡片完整（边框圆角保留），下缘 6px 投影已有 |
| AI 回复 | 无卡片直接排版（现状一致），段间 10px |
| 消息尾部 | 时间戳 + 操作图标右对齐一行（现状 hover 显示，保持） |

**需求 2 根因（已定位）**：`styles/04-chrome-popovers.css` @media(min-width:900px) 给
`.dvx-reading-column` 和 `.dvx-composer-wrap` 同设 `max-width: 860px`，但 reading-column
的 22px padding 算在 860 内、composer-wrap 在 footer（自有 22px padding）内再限 860——
两者内容宽度错位。另 `styles/18-interactions.css` @420px 下 reading-column 14px vs
footer 12px 也不同步。**修法：宽度与内距只定义一次**（建议引入
`--dvx-column-max` / `--dvx-column-pad` 两个 token，双方消费同一对值）。

**需求 5 根因（假说，段 A 首验）**：auto 主题（`styles/27-theme-auto.css`）把
`--dvx-surface` 映射 `--vscode-sideBar-background`、`--dvx-raised` 映射
`--vscode-editorWidget-background`——大量主题两值相同 → 用户卡片与页面同色；
`--dvx-border` 首选 `--vscode-panel-border`，部分主题该值透明 → 边框也消失。
**修法：auto 下给 raised 叠一层 `color-mix(in srgb, var(--dvx-ink) 4%, var(--dvx-surface))`
式的保底明度差；border 保底 `color-mix(ink 12%, transparent)`。** 亮/暗自有主题无此问题。

### 2.3 卡片瘦身与动画（需求 10 + 旧账 30、33）

- 全局排查「滥用卡片」：计划卡、queue 卡、interaction 面板等凡是「内容天生是行列表」的，
  参照 Cursor 降级为无框行组 + hairline 分隔（点开 review 的文件列表就是范本）。
- 旧账 30（吸顶漏一行字）：sticky top 偏移与 header 高度联动核正，归段 A。
- 旧账 33（图片一行两张）：`03-transcript-media.css` 改为一行一张、宽度 100%、radius 8px。
- header 60px 过高：Cursor header 是一行 ~36px（标题 + 路径 + 图标组）。建议收到 40px
  内，`10-shell-frame.css` grid-template-rows 与 `.dvx-header` 联动。

涉及文件：`styles/10-shell-frame.css`、`11-user-edit.css`、`05-message-cards.css`、
`03-transcript-media.css`、`04-chrome-popovers.css`、`18-interactions.css`、
`27-theme-auto.css`、`Thread.tsx`、`thread/UserMessage.tsx`。

---

## 3. 段 B · 功能卡片 spec（需求 3、4、6、9 + 旧账 34a/b/c）

### 3.1 选择模式菜单（需求 3，`cursor/选择模式.png`）

| 项 | 目标值 |
| --- | --- |
| 浮层 | 锚定 mode 触发器上方 6px（现状机制保留），宽 ~150–180px，radius 8px，padding 4px |
| 行 | 高 27px，radius 4px，**左侧 14px 线性图标 + 名称 13px**，选中行右侧 ✓ 14px |
| hover | `--dvx-soft` 底 |
| 描述文字 | Cursor 无描述。我们 Auto/Spec/Mission 的两行描述**收为 hover tooltip（title）**，菜单本体单行化；图标：Auto=∞、Spec=文档笔、Mission=旗帜（线性 1.5px 描边，同 `thread/icons.tsx` 风格） |

涉及文件：`ComposerControls.tsx`（MODE_OPTIONS 渲染）、`styles/13-composer.css`
（.dvx-mode-popover）、`thread/icons.tsx`（新图标）。

### 3.2 压缩内容 / Context Usage（需求 4，`cursor/压缩内容.png`）

| 项 | 目标值 |
| --- | --- |
| 浮层 | composer 上方全宽面板，radius 8px，padding 12px |
| 标题行 | 「Context Usage」13px ink 500 + 右上 × 关闭（24px 图标钮） |
| 摘要行 | 左「12% Full」13px，右「~115.6K / 1M Tokens」12px muted |
| 分段彩条 | 高 4px radius 2px，底轨 border 色；彩段按类别并排 |
| 图例 | 行高 26px：左 10px 色块（radius 2px）+ 类别 13px，右数值 12px muted 右对齐 |
| 类别→色 | 我们的数据是 Input/Output/Cache read/Cache write/Thinking（droid 截图）。映射五段色：建议从现有 syntax token 派生一组静音色（灰、紫、青、橙、蓝），新增 `--dvx-ctx-1..5` token |
| **Compact 位置** | Cursor 无此功能。方案：图例下方加一条上缘 hairline 的 footer 行，右侧「Compact conversation」quiet 文字按钮（同 `.dvx-changes-action` 语言），左侧原说明文字 11px subtle。Refresh 收为标题行 × 旁的 16px 图标钮 |
| 删除 | 现状大字「7% used」、Remaining/Source 双列、Last turn/Session 双列表全部收进：摘要行 + 图例即可（Last turn 明细挪 hover title） |

涉及文件：`ComposerControls.tsx`（ContextPopover/ContextUsage/TokenUsageSection/Stat）、
`styles/14-settings-popover.css`、`04-chrome-popovers.css`、`00-tokens.css`（新增 ctx 色）。

### 3.3 Review 行（需求 6，`cursor/已发送卡片和聊天区.png`、`cursor/点开review.png`）

Cursor 形态：**composer 上方吸底折叠行**，非消息流内卡片。

| 项 | 目标值 |
| --- | --- |
| 折叠行 | 高 32px，上缘 hairline，左「› N Files」12px（chevron 随开合旋转），右「Undo All」quiet 文字钮 + 「Review」实心钮（accent 底反色字，radius 5px，高 22px，padding 4px 10px） |
| 展开列表 | 行高 24px：文件类型图标 14px + 文件名 13px + diff 统计（+n 绿 / -n 红，11.5px）左贴文件名；无行边框，hover `--dvx-soft`；列表最大高 ~40vh 内滚 |
| 运行中 | 行首加 5px accent 呼吸点（现有 `.dvx-changes-dot` 语言） |
| 折叠行族 | 该吸底区是一个**行族**：Files 行、subagent 行（§4）、queue 行按序堆叠，同一视觉语言 |

现状差距：`ChangesSummary` 长在 `thread/transcriptRows.tsx` 消息流里（per-turn 账本）。
**迁移 = 结构改动**：数据源（changesProtocol/liveChanges）不动，渲染位置迁到
`Thread.tsx` 的 `ViewportFooter` 内 Composer 之前；per-turn 历史账本是否保留消息流内
残影（Cursor 不保留）→ 建议只留吸底一处，历史 turn 的 changes 收进该 turn 尾部一行
quiet 文字。Commit 入口（我们特有）保留在展开列表 footer。

涉及文件：`thread/transcriptRows.tsx`、`Thread.tsx`、`styles/05-message-cards.css`
（.dvx-changes* 全族）、`GitCommitPanel.tsx`、`styles/06-git-commit.css`、
`styles/12-exploration-ticker.css`（.dvx-thread-footer）。

### 3.4 终端卡片（需求 9，`cursor/终端打开.png`、`cursor/终端没打开.png`）

| 项 | 目标值 |
| --- | --- |
| 折叠态 | 单行卡片：高 28px，radius 8px，1px border，raised 底；「>_」图标 + 命令描述（ink 500）+ 命令本体（muted，mono 12px）单行省略 |
| 展开态 | 标题行同上（chevron 换 ›）+ 右侧 … 菜单；输出井**比卡片深一档**（Cursor #151517 < 卡面 #1e1e21），mono 12px，输出字 muted，padding 8px 12px，下圆角 7px |
| 阴影 | 无卡片阴影，纯 hairline |
| 动效 | 现有 `::details-content` height 过渡保留 |

现状差距：`07-activity-live.css` 卡 radius 10px + 双层阴影；`08-command-card.css` 井是
暖琥珀 `#262019` 渐变、亮色下 `#efece6`。**照抄 = 井改中性深灰（走 `--dvx-code` 并把
dark 的 code token 调深到卡面之下）**——与暖中性基调冲突，见风险 R4，需用户拍板。

涉及文件：`styles/08-command-card.css`、`07-activity-live.css`、`24-theme-dark.css`
（command 井 override）、`27-theme-auto.css`（terminal 背景映射）、`thread/commandCard.tsx`。

### 3.5 计划卡片重做（34c + 补充需求 2026-08-15 下午，参照 `image/计划卡片-补充.png`）

**决策变更声明**：2026-08-13「plan 行无卡片 chrome / hairline 行 / 禁灰块 hover」的
设计决定（写在 `styles/22-plan-anchor.css` 头注释与 decard design §3 A）**就此作废**，
以本次用户要求「整体重做质感」为准——计划呈现升级为完整卡片，与 §3.4 终端卡同族。

现状（截图）：hairline 顶边一条、无边框无底色、勾选行裸排、右侧「3 / 3」小字——
即 34c 说的「缺 padding、过于单调」。

| 项 | 目标值 |
| --- | --- |
| 卡片 | radius 8px，1px `--dvx-border`，`--dvx-raised` 底，无阴影；仍锚在触发它的用户消息下方（现有 plan-line 位置），上外距 10px |
| 标题行 | 高 32px，padding 0 12px：状态点 6px（运行 = accent 呼吸光晕，沿用 `dvx-plan-line-glow`；完成 = 灰）+ 计划标题 13px ink 500 单行省略 + 右侧进度「3 / 3」11.5px muted tabular-nums + chevron 14px（hover 显形，随开合旋转 150ms）；整行可点折叠 |
| 进度条 | 标题行下缘一条 2px 全宽进度条（`--dvx-accent` 已完成占比，底轨 `--dvx-border`），替代纯数字的单薄感；完成时整条转灰淡出 |
| 步骤区 | 与标题行以 hairline 分隔，padding 8px 12px 10px，行距 2px |
| 步骤行 | 高 26px：左 14px 状态圈（未做 = 1.5px `--dvx-subtle` 空圈；进行中 = accent 实心点 + 呼吸；完成 = 灰圈勾）+ 文字 12.5px；完成态文字转 `--dvx-muted` + 删除线（dark 30% 白，沿用现规则）；行 hover 仅 ink 加深，无灰块 |
| 折叠态 | 只剩标题行 + 进度条的单行卡（高 34px），同终端卡折叠形态 |
| 动效 | 展开收起 = `::details-content` height 过渡（同 §3.4）；新步骤 fade-in（`dvx-todo-fade-in` 保留）；勾选瞬间空圈→勾 150ms 缩放过渡 |
| 审批面板 | plan 审批（Interactions）里的预览列表同步换此卡片语言，34b「plan 选择太素」随之解决 |

静态稿先行的约定不变（style-refactor.md 决策 3）：本 spec 即静态稿的量化基准，
静态稿获用户认可后落地。

涉及文件：`PlanLine.tsx`、`planAnchor.ts`、`Interactions.tsx`（审批面板）、
`styles/22-plan-anchor.css`（形态整体替换）、`09-plan-todo-anim.css`、
`18-interactions.css`、`24-theme-dark.css` / `27-theme-auto.css`（回归）。

### 3.6 旧账 34a

34a（按钮多一个方框）：随 §3.1–3.5 触发器统一排查 border 重复。

---

## 4. 段 C · 子代理工作区 spec（需求 7）

参照 `cursor/子代理ai回答.png`、`cursor/子代理聊天区.png`、`cursor/点击子代理.png`。

### 4.1 消息流内的子代理行

| 项 | 目标值 |
| --- | --- |
| 行 | 无框两行组：首行 = 状态图标（运行 spinner）+ 名称 13px ink 500 + 类型「Explorer」12px muted + 右侧 Stop 小钮（1px border，radius 4px，高 20px，11px 字）；次行 = 当前活动 12px muted（流式更新） |
| 完成态 | 图标换淡灰勾，Stop 消失，次行换「Completed」 |
| 点击 | 整行可点 → 打开子代理工作区 |

### 4.2 吸底汇总行（composer 上方，与 Review 行同族）

「ˇ N subagent(s) running」折叠行 32px；展开逐行「▽ 名称 …… Stop」，行高 24px。

### 4.3 子代理工作区页

Cursor 在编辑器 tab 里开整页；我们是单 Webview → **整页替换聊天视图**（同 add model 页
机制），顶部返回。结构完全复用主聊天渲染：

| 项 | 目标值 |
| --- | --- |
| 页头 | ← 返回 + 子代理名 + 元信息行「2m · 模型名」11px muted |
| 正文 | 用户 prompt 卡片（同主聊天用户卡片，只读不吸顶）+ 「Worked for Ns」折叠 + 完整 markdown 渲染（标题/表格/代码/列表全走主聊天样式） |
| 流式 | 快照轮询 + 增量渲染（近流式观感，已对齐的物理上限），新增内容 fade-in 同主聊天 |
| 无 composer | 只读页，无输入区 |

现状差距：`SubagentTranscriptSheet.tsx` 是 split-pane 侧栏（与 btw 共用第二栏）。
按用户决定：**btw 独占侧栏，子代理改整页**。后端通道（Runtime 发现 exec/subagent 会话、
Bridge v20）与本 spec 并行，UI 待段 A 落地后复用其样式。

涉及文件：`SubagentTranscriptSheet.tsx`、`styles/26-subagent-sheet.css`（大部废弃）、
`subagentPanelFlow.ts`、`thread/activityRows.tsx`（delegation 行）、`App.tsx`（视图切换）、
`SideChatSheet.tsx`（不动，btw 专用）。

---

## 5. 段 D · 模型页 spec（需求 8）

### 5.1 模型选择菜单（`cursor/模型卡片.png`）

| 项 | 目标值 |
| --- | --- |
| 浮层 | 宽 ~225px，radius 8px，padding 4px，锚定模型触发器上方 |
| 搜索 | 首行透明输入「Search models」，高 28px，下缘 hairline |
| Auto 行 | 列表首行（我们对应 Auto Balance 若有；无则省） |
| 模型行 | 高 27px，13px，选中 ✓ 右侧，hover `--dvx-soft`；**长名不换行省略号**（旧账 12/24 已做，核对） |
| Effort 子面板 | Cursor 是 hover 二级菜单；我们现有 reasoning flyout 机制保留，样式对齐（radius 8px、行 27px、✓ 选中、「Options」11px 分组标题） |
| **Add Models** | 列表底部固定行（上缘 hairline，不随滚动），13px，点击 → 整页（§6） |
| Spec scope 切换 | 我们特有，保留，收为顶部 2-segment 小切换（高 24px，radius 6px） |

涉及文件：`ComposerControls.tsx`（ModelPopover/ReasoningEditor）、
`styles/15-model-sessions.css`、`13-composer.css`。

### 5.2 add model 整页

见 §6 设计方案（待用户过目）。涉及 `CustomModelsPanel.tsx`、
`CustomModelProviderForm.tsx`、`styles/25-custom-models.css`、`App.tsx`（新整页视图）。

---

## 6. 设计方案 A：add model 整页（待用户过目 ☐）

**入口**：模型菜单底部「Add models」固定行（§5.1）。点击 → 关闭浮层 → 整页替换聊天
视图（`App.tsx` 顶层 view 切换，非弹层非 popover 视图）。返回：页头 ←、Esc、
添加成功自动返回 + 顶部 transient 提示。聊天状态在后台不受影响（流式继续）。

### 方案一（推荐）：单栏分组页 + 就地展开向导

```
← Models                                    ⟳ 刷新
──────────────────────────────────────────────
「Providers」                                 ← 分组区：已存的订阅站点+key
┌────────────────────────────────────────┐
│ api.siliconflow.cn        key ····f3a2 │   ← 组卡：radius 8、1px border、
│ 3 models                 Fetch · Edit  │      padding 12、host 名 13px 500、
│  ├ deepseek-v3          编辑 · 移除    │      组内模型行 24px 无框 hairline 分隔
│  └ qwen-max             编辑 · 移除    │
└────────────────────────────────────────┘
┌ + Add provider ────────────────────────┐   ← 虚线框 quiet 入口行，点击就地展开：
│ Provider 类型 ○OpenAI兼容 ○Anthropic ○Bedrock │  ← 单选 pills（高 24px radius 6）
│ Base URL [___________________________] │
│ API key  [___________________________] │
│                        [Fetch models]  │   ← 实心主按钮
│ ── fetch 返回后就地追加 ──              │
│ 🔍 filter…      ☑ all                  │
│ ☑ deepseek-v3          128K            │   ← 多选行 27px，checkbox + id + 上下文
│ ☐ qwen-72b             32K             │
│ ☑ qwen-max             32K             │
│ ── 已选 2 个，参数区 ──                 │
│ deepseek-v3: 显示名[____] max tokens[__]│   ← 每个已选模型一行参数（可折叠）
│                        [Add 2 models]  │
└────────────────────────────────────────┘
```

三步（provider → 多选 → 参数）在同一张卡里纵向就地展开，无跳页无弹层；
表单控件走现有 `.dvx-mcp-add-input` 语言升级版（高 28px，radius 6px，1px border，
focus 边框转 strong）。

### 方案二（备选）：两栏主从

左栏 provider 列表（窄 180px），右栏当前 provider 详情+添加流程。
在 Secondary Sidebar 常见的 300–450px 宽度下两栏局促，**不推荐**，仅在用户常用宽面板时考虑。

---

## 7. 设计方案 B：+号面板（待用户过目 ☐）

现状：`SettingsPopover`（root=AttachRows + Skills/MCP/Plugins 子视图），popover
padding 10px、radius 12px，行样式偏松。按 Cursor 菜单质感重制：

| 项 | 目标值 |
| --- | --- |
| 浮层 | 锚定 + 钮上方 6px，宽 260px，radius 8px，padding 4px，hairline border + 浮层阴影 |
| 搜索 | 首行透明输入「Search files…」28px（固定定位已做，条目 23），输入≥1 字 → 整面板切换为文件搜索结果列表（行 27px，路径 11px subtle 次行省略） |
| Attach 组 | 单行 28px：16px 线性图标 + 文字 13px（Files & folders / Editor tabs / Selection / Problems / Git changes / Image…），hover `--dvx-soft` |
| 分隔 | 组间 hairline + 4px 呼吸 |
| Configure 组 | Skills / MCP / Plugins 三行，行尾 › ；点击子视图**水平滑入** 150ms（现有 view 机制保留），子视图首行 ‹ 返回 + 标题 |
| 上下文环 | + 钮旁的 context ring 保持现位（我们特有） |
| 动效 | rise-in/out 沿用；子视图 slide 新增 |

涉及文件：`ComposerControls.tsx`（SettingsPopover/AttachRows/SkillsPanel/McpPanel/
PluginsPanel）、`styles/14-settings-popover.css`、`16-attachments-mentions.css`、
`17-skills-mcp.css`。

---

## 8. 10 条需求 → 文件映射与冲突面

| # | 需求 | 组件文件 | 样式文件 | 段 |
| --- | --- | --- | --- | --- |
| 1 | 聊天记录复刻 | `SessionDrawer.tsx`、`App.tsx` | `15-model-sessions.css`、`04-chrome-popovers.css` | A |
| 2 | 卡片/composer 宽度对齐 | — | `04-chrome-popovers.css`(@900px)、`18-interactions.css`(@420px)、`10-shell-frame.css`、`13-composer.css` | A |
| 3 | 选择模式样式 | `ComposerControls.tsx`、`thread/icons.tsx` | `13-composer.css` | B |
| 4 | 压缩内容 + compact 位置 | `ComposerControls.tsx`(ContextPopover 族) | `14-settings-popover.css`、`00-tokens.css` | B |
| 5 | 分界线多主题 | — | `27-theme-auto.css`、`00-tokens.css`、`11-user-edit.css` | A |
| 6 | review 挪聊天区上方 | `thread/transcriptRows.tsx`、`Thread.tsx`、`GitCommitPanel.tsx` | `05-message-cards.css`、`06-git-commit.css`、`12-exploration-ticker.css` | B |
| 7 | 子代理行+整页工作区 | `thread/activityRows.tsx`、`SubagentTranscriptSheet.tsx`、`subagentPanelFlow.ts`、`App.tsx` | `26-subagent-sheet.css`、`07-activity-live.css` | C |
| 8 | 模型卡片 + add model 整页 | `ComposerControls.tsx`(ModelPopover)、`CustomModelsPanel.tsx`、`CustomModelProviderForm.tsx`、`App.tsx` | `15-model-sessions.css`、`25-custom-models.css` | D |
| 9 | 终端照抄 | `thread/commandCard.tsx` | `08-command-card.css`、`07-activity-live.css`、`24-theme-dark.css`、`27-theme-auto.css` | B |
| 10 | 卡片瘦身+动画（含 + 号面板） | `ComposerControls.tsx`(SettingsPopover)、各卡片组件 | `14-settings-popover.css`、`16/17-*.css`、全局 | A/B |

**冲突面（多段共用文件，施工须串行或分区块编辑）：**

- `ComposerControls.tsx`（88KB）：需求 3、4、8、10 四条都改它 → **段 B 与段 D 不得并行
  编辑此文件**；建议段 B 前先按功能拆分（mode/context/model/settings 各自成文件，
  也顺带满足 900 行预算压力）。
- `App.tsx`：需求 1（抽屉触发）、7（子代理整页）、8（add model 整页）→ 整页视图切换
  机制应在**最先动它的段一次性建好**（建议段 D 先建，段 C 复用）。
- `04-chrome-popovers.css`：需求 1、2、4 共用。
- `Thread.tsx`：需求 2、6 共用。
- `24-theme-dark.css` / `27-theme-auto.css`：每段结尾都要过一遍主题回归。

---

## 9. 差异清单（功能不同 → 只改样式不改行为）

| Cursor 截图内容 | 我们的现实 | 处理 |
| --- | --- | --- |
| 菜单模式 Agent/Plan/Debug/Multitask/Ask | Auto/Spec/Mission | 只换皮：图标+单行；不加模式 |
| 「Worked for 51s / Thought for 18s」折叠 | 我们有 thinking/activity 行族 | 样式对齐折叠行语言，不改分组逻辑 |
| 子代理开编辑器 tab | 单 Webview | 整页替换视图替代 tab |
| 模型菜单 Auto Balance / Fast toggle / 1M 后缀 | 无对应能力 | 不发明；只抄行样式 |
| Review 白底按钮带 Stop 快捷键提示 | 我们 Stop 在 composer | 快捷键提示样式可抄，绑定我们自己的行为 |
| Context Usage 类别（System prompt/Tools/Rules…） | Input/Output/Cache/Thinking | 用我们的真实类别，抄图表形式 |
| 聊天记录浮层 pin/更多操作 | 我们有重命名/收藏/worktree | 功能保留，样式收进 hover 行内操作 |
| 真 token 流式子代理 | 快照轮询增量渲染 | 已对齐预期，不追流式 |

## 10. 风险清单

- **R1 · auto 主题分界线**（需求 5）：surface/raised 同源、panel-border 透明的主题下
  卡片隐形。修复须用 color-mix 保底，且**亮/暗/auto × 高对比主题共 4+ 形态回归**，
  auto 只能实机换主题验，跑不了单测。
- **R2 · 吸底行族与 sticky 栈**：Review 行 + subagent 行 + queue 行迁入
  `ViewportFooter` 后 footer 高度动态化 → 用户卡片 sticky top 偏移、scroll-bottom
  dock 位置、旧账 30（不完全吸顶）全部联动。段 B/C 改 footer 前必须先把段 A 的
  sticky 偏移参数化（否则互相打架）。
- **R3 · ComposerControls.tsx 编辑冲突**：四条需求共用一个 88KB 文件，且已逼近行数
  预算 ratchet。不先拆文件就并行施工必然冲突。
- **R4 · 终端井色相**（需求 9）：照抄 = 中性深灰井，现状 = 暖琥珀井（且亮色主题有
  配套的暖白井）。二选一需用户拍板：☐ 全中性（纯照抄）☐ 保暖调只抄几何。**亮色主题
  下「深色井」是否也照抄**（Cursor 亮色终端仍是深井）同样待拍板。
- **R5 · Review 账本迁移是行为邻接改动**：数据流（liveChanges → per-turn 账本）改为
  全局吸底聚合，undo/commit 的 turn 归属语义要保持；per-turn 历史展示形式变化需用户
  过目。

## 11. 各段验收要点（装包后实机对照）

**段 A**：① 宽窗口（>900px）用户卡片右缘与 composer 右缘像素级对齐；② auto 主题切
3 个不同 VS Code 主题，用户卡片始终可辨；③ 聊天记录浮层右锚、行 hover 出操作、
Archived 折叠；④ 图片一行一张；⑤ 吸顶无漏字；⑥ header ≤40px。
**段 B**：① 模式菜单单行图标化、✓ 在右；② Context Usage 分段彩条 + 图例 + compact
在 footer 行；③ Review 折叠行吸底、展开文件行 24px、diff 红绿、Undo All/Review 钮；
④ 终端折叠单行/展开深井、无阴影 radius 8；⑤ 计划卡片按 §3.5 卡片化（标题行 +
2px 进度条 + 26px 步骤行），静态稿获用户认可后落地；⑥ 三主题下按 §1.5 色板抽查
卡/底/井/浮层四层可辨。
**段 C**：① 消息流子代理两行组 + Stop；② 吸底「N subagents running」行；③ 点击行
整页工作区 = 主聊天渲染 + 只读 + 返回；④ btw 侧栏不受影响。
**段 D**：① 模型菜单搜索行 + 27px 行 + 底部 Add models 固定行；② add model 整页
（方案获用户认可后）三步就地展开可走通；③ Esc/返回/成功自动回聊天三条路径都通。
