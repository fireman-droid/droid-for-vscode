# 主题切换（暗色主题）可行性调研

状态：生产已实施；2026-08-14 补齐实际编辑器配色的 Auto 模式。
配套原型（真实 styles.css 复刻 + 整体调色，480px 侧边栏宽度）：

- `artifacts/theme-proto-light.html` → `artifacts/theme-proto-light.png`
- `artifacts/theme-proto-dark.html` → `artifacts/theme-proto-dark.png`

## 0. 用户决策（2026-08-12 晚，看过第一版原型图后）

1. **只做暗色主题**。暖白主题 = 现状即 light 基准，不重做（第一版
   "Claude 向暖白"原型仅作留档，不进实施范围）。
2. **暗色盘 = 黑白灰，参考 Cursor 暗色主题**（`#1a1a1a`~`#252526`
   层次、灰阶 surface/边框、白/浅灰文字）。第一版 Grok 向原型里的
   橙色太多，被否。**品牌橙几乎全部退场**：主按钮/发送按钮/强调
   元素改黑白灰体系（浅色填充深色图标、或描边幽灵按钮）；橙最多
   保留一处极小点缀（如状态点），也可以完全不留——v2 原型选择了
   零橙色（状态点保持语义绿）。
3. 开关维持三态 **Light / Dark / Auto**（§2.3 方案不变）；**默认
   Auto**（用户拍板，2026-08-12：跟随 Cursor/VS Code 当前主题）。
4. 暗色下的轻奢标准重新调校：边框用半透明白（9%/16%）、阴影更
   收敛（单层短距）、层级"更亮 = 更浮起"。
5. **Auto 必须跟随编辑器的实际配色，不是只跟随 light/dark kind 后
   复用固定皮肤**（用户补充，2026-08-14）。因此 Light/Dark 保留产品
   自有暖白/炭黑 token；Auto 用公开 `--vscode-*` 变量替换 surface、
   text、border、accent、selection、input、terminal 和 syntax token，
   resolved kind 只继续负责 `color-scheme` 与结构性暗色修正。

对迁移的影响：工作量下调——不需要设计"暖白 v2"的 token 值（light
主题的 token 值就是现状收敛出来的值），§2.4 估计里"暗色 token 表
设计与调优"由 v2 原型直接给出第一版。

## 1. 现状盘点（styles.css，2026-08-12，约 6100 行）

### 1.1 颜色写法：半 token 化，硬编码占大头

| 类别 | 出现次数 | 去重后 | 说明 |
| --- | --- | --- | --- |
| `--dvx-*` token 引用 | 412 | 22 个已定义 | 定义在 `.dvx-shell` 上（不在 `:root`），16 个颜色/阴影 + 6 个动效 |
| 硬编码 hex（`#xxx`） | **259**（其中 214 行在 token 定义块之外） | 82 | 主体是重复值，见下 |
| 硬编码 `rgb()/rgba()` | **95** | 43 | 阴影、洗色（wash）、透明边框 |
| `var(--vscode-*)` | 30 | 10 个变量 | 全部带静态 fallback |

高频硬编码值与既有 token 的对应关系（迁移的核心机会）：

| 硬编码 | 次数 | 事实上等于 |
| --- | --- | --- |
| `#fff` | 43 | `--dvx-raised` |
| `#a1a1a1` | 29 | `--dvx-subtle`（值完全相同） |
| `#737373` | 20 | `--dvx-muted`（值完全相同） |
| `#525252` | 15 | （缺 token，介于 ink/muted，建议新增 `--dvx-text-secondary`） |
| `#404040` | 13 | （缺 token，activity summary 用，建议 `--dvx-text-strong` 或并入 ink） |
| `#262626` | 12 | `--dvx-ink`（值完全相同） |
| `#f5f3ef` | 5 | `--dvx-surface`（含 html/body/#root 三处页面底色） |
| `#37312c`、`#4d4842`、`#6b6259`、`#211f1c`、`#171717` 等 | 各 3-9 | 暖墨阶，需归并到 3-4 级文本 token |
| hljs 语法高亮 12 色（`#a626a4`、`#50a14f`…） | 各 1-2 | One-Light 派生，暗色主题需整组替换（One-Dark 系） |
| 洗色/阴影 `rgb(0 0 0 / 4-10%)` 系 | ~40 | 暗色下须翻转为白基洗色 + 更深阴影，必须 token 化（`--dvx-wash`、`--dvx-shadow-*`） |

### 1.2 token 层已有债务（迁移时顺手清）

引用了但**从未定义**的 token（靠 fallback 或失效撑着）：
`--dvx-text`、`--dvx-hover`、`--dvx-bg`、`--dvx-diff-add`、
`--dvx-diff-del`、`--dvx-font`、`--dvx-mono`。其中
`var(--dvx-text)`（无 fallback，`.dvx-user-edit-restore:hover`）当前
实际失效——hover 颜色没生效，是个隐性 bug。

### 1.3 与 `--vscode-*` 的耦合：很低，且全部可控

10 个变量、30 处，分三类：

1. **字体**（`--vscode-font-family` ×3、`--vscode-editor-font-family`
   ×8）：与颜色主题无关，保留。
2. **焦点色**（`--vscode-focusBorder` ×9，fallback `#d2643d`）：现状
   就是"跟编辑器主题走"的唯一活耦合。切主题方案里建议改为
   `--dvx-focus` token（浅色 = 暖橙、暗色 = 亮橙），不再跟随
   VS Code，避免"面板是暖白、焦点环是 VS Code 蓝"的违和（原型图里
   已按此处理）。
3. **零星语义色**（charts-yellow、errorForeground 等 5 处）：均有
   fallback，直接换成 `--dvx-*` 语义 token。

另有 3 处结构性明色假设：`.dvx-shell { color-scheme: light }`（影响
原生控件/滚动条渲染）、`html, body, #root { background:#f5f3ef }`、
forced-colors 媒体块（高对比模式，主题化不影响它）。

**结论**：这套 UI 从 Module 1 起就是"自带暖色世界、无视编辑器主
题"的设计，反而使双主题非常可行——不存在"要跟 VS Code 几十个变量
对表"的问题，全部色彩决策都在自己手里。

## 2. 方案

### 2.1 token 层收敛 + `data-theme` 覆写

1. **收敛**：把 §1.1 的 82 个 hex + 43 个 rgba 归并进一层完整
   token（预计 20-24 个颜色 token 收口，命名沿用现有 `--dvx-*`）：

   ```text
   底色     --dvx-surface（页面/顶栏/footer 底）
   面       --dvx-raised（卡片/Composer/代码块头）  --dvx-code（代码底）
   文本     --dvx-ink → --dvx-text-secondary(#525252) → --dvx-muted → --dvx-subtle
   线       --dvx-border / --dvx-border-strong
   洗色     --dvx-wash(现 rgb(0 0 0/4-5%) 系) / --dvx-wash-strong
   品牌     --dvx-accent / -strong / -soft
   语义     --dvx-danger / --dvx-warning / --dvx-success(#1a7f37 已散写) / --dvx-focus
   阴影     --dvx-shadow-card / --dvx-shadow-pop（现两档散写 rgba）
   语法高亮 --dvx-hl-keyword / -string / -number / -title / -type / -attr / -comment …（12 个）
   ```

2. **覆写**：主题属性挂在 `.dvx-shell`（token 本来就定义在这里，
   不必动 `:root`）：

   ```css
   .dvx-shell                     { /* 默认 = 现状暖白（light 基准，值不变） */ }
   .dvx-shell[data-theme="dark"]  { /* 只覆写 token 值 + color-scheme: dark */ }
   ```

   `html/body/#root` 的三处底色改成由 boot 脚本同步写（或改用
   `background: transparent` + shell 全高铺满，二选一，前者改动最小）。
   规则体内**零改动**——这是收敛做干净后的直接红利。

3. **暗色盘定调（按 §0 用户决策修订，v2 原型即此配色）**：
   light 列 = 现状 styles.css 收敛出的 token 值（不重新设计）；
   dark 列 = 黑白灰，参考 Cursor 暗色。

   | token | Light（= 现状暖白） | Dark（Cursor 灰阶） |
   | --- | --- | --- |
   | surface | `#f5f3ef`（现状） | `#1a1a1a` |
   | raised | `#fff`（现状） | `#242425`（≈Cursor `#252526`） |
   | code | `#f7f5f1`（现状） | `#1e1e1f` |
   | ink | `#262626`（现状） | `#e8e8e8` |
   | text-secondary / muted / subtle | `#525252` / `#737373` / `#a1a1a1`（现状） | `#bdbdbd` / `#9a9a9a` / `#6f6f6f` |
   | border / strong | `#e5e5e5` / `#d4d4d4`（现状） | `rgb(255 255 255/9%)` / `rgb(255 255 255/16%)`（半透明白） |
   | accent 消费端 | `#f2612e` 品牌橙（现状） | **灰阶化 `#d4d4d4`/`#e8e8e8`——橙退场**；发送键 = 浅色填充 `#e8e8e8` + 深色图标 `#1a1a1a` |
   | wash | 黑基 `rgb(0 0 0/4%)`（现状） | 白基 `rgb(255 255 255/6%)` |
   | shadow | 现状两档 | 更收敛：`0 1px 2px rgb(0 0 0/40%)` 单层短距 |
   | focus | `#d2643d`（现状 fallback） | `rgb(255 255 255/42%)` |
   | 语法高亮 | One-Light 系（现状） | VS Code Dark+ 系（keyword `#c586c0`、string `#ce9178`、type `#4ec9b0`…） |

   实施要点：`--dvx-accent` 在暗色下直接指向浅灰，让所有 accent
   消费端（发送键、上下文环、blockquote 边、spec 态文字）一次性
   灰阶化，**不需要逐处判断**；若后续想给状态点留一处品牌橙点缀，
   单独加 `--dvx-brand-dot` 一个 token 即可（v2 原型未保留，状态点
   维持语义绿）。暗色不是反相：层级方向翻转（更亮 = 更浮起）、
   阴影更收敛、洗色换白基——这些正是 token 化后每主题一行能表达的
   差异。

### 2.2 主题选择的持久化

推荐 **Host `globalState` 经 Bridge**，不用 webview `localStorage`：

- 主题是用户跨会话、跨工作区的偏好，`localStorage` 在 webview 的
  生命周期语义下不可靠（面板 dispose/扩展重装即丢），且 Host 侧
  无法读取（未来 status bar / 命令面板切主题都要 Host 知情）。
- 仓库已有完整先例：设置面板的 `onSettingUpdate` 流（Webview →
  `setting.update` → Host 写 state → snapshot 回推）。主题作为一个
  新设置项走同一通道，协议增量是一个字段，不是新消息对。
- `vscode.setState()`（现只存 draft）继续只管每面板暂态，不掺和。

### 2.3 跟随 VS Code vs 手动三态

推荐**三态 Auto / Light / Dark，默认 Auto**：

- Host 监听 VS Code active-color-theme 事件并推送 authoritative resolved
  kind；Auto 同时用 webview 中公开的 `--vscode-*` CSS 变量直接驱动
  DroidVisX token，因此编辑器切换到任意第三方配色时，surface/text/
  accent 等会跟着变化，而不是落回固定炭黑皮肤。无需轮询。
- 手动 Light/Dark 覆盖 Auto，存 §2.2 的设置项。
- 入口 UI 遵守 UI-restraint：设置弹层里一行三态（复用现有
  settings popover 的行样式），不做显眼开关。首切片甚至可以只做
  Auto + 命令面板命令，视觉入口后置。

### 2.4 迁移工作量估计

主要成本就是**硬编码收敛**，其余都薄：

| 工作 | 量 | 估计 |
| --- | --- | --- |
| 收敛 214 行 hex + 95 处 rgba → token（其中 ~104 处是与现 token 完全同值的机械替换） | styles.css 全量过一遍 | 1–1.5 天（含清 §1.2 的 7 个幽灵 token） |
| 暗色 token 表设计与调优（含 hljs 12 色、阴影、洗色、`color-scheme`、mermaid 图底色；light 不需要设计，= 现状值） | 一张表 + 视觉迭代 | 0.5 天（v2 原型已按用户拍板的黑白灰方向给出第一版，可直接抄） |
| Bridge/Host：设置项 + 持久化 + Auto 监听 | 一个字段 + 一个 effect | 0.5 天 |
| 验收：两主题 × 既有 harness 截图全套 + forced-colors 回归 + 打包装进 Cursor 目检 | 既有工具 | 0.5 天 |

**合计约 2.5–3.5 个 agent 工作日**；其中收敛这一步独立有价值
（消灭同值散写 + 幽灵 token），即使主题切换推迟也值得先做，且可以
按文件区段拆成多个小 PR 与其他并行代理错峰。

风险：并行代理正在频繁改 styles.css——收敛属于"宽而浅"的全文件
改动，冲突面大，**必须挑一个没有其他代理动 styles.css 的窗口一次
性做完**（AGENTS.md 资源冲突纪律）。

## 3. 原型说明（关键交付）

做法：复制当日 `src/webview/assistant/styles.css` 为
`artifacts/theme-proto-styles.css`（零改动快照），两个静态 HTML 用
真实 `dvx-*` DOM 结构复刻主界面典型状态——顶栏（Droid 标题 + 状态
行 + 圆形图标钮）、一条用户消息卡、一条 AI 回复（Thinking 行、
Read file 工具活动行、markdown 段落 + 带头部的 TSX 代码块、动作
条）、底部 Composer（+ 按钮、上下文环、Auto 模式、模型选择、发送
键）与快捷键提示——再在 `<style data-theme-overrides>` 里以
§2.1 的 token 表整体调色。暗色文件里的覆写块同时就是"哪些硬编码
必须收敛"的实证清单（每一条 override 对应一处生产 CSS 的硬编码）。

截图：`artifacts/theme-proto-shot.mjs`（`artifacts/shot.mjs` 的
480×860 变体，独立端口避免与其他代理的截图冲突），headless Chrome
(CDP) 出 PNG：

- `artifacts/theme-proto-light.png`（第一轮"Claude 向暖奶油白"，
  按 §0 决策**仅留档**：暖白不做，light = 现状）
- `artifacts/theme-proto-dark.png`（**v2，实施基准**：Cursor 灰阶
  黑白灰、橙色退场、发送键浅色填充深色图标）

原型版本记录：第一版暗色走 "Grok 炭黑 + 品牌橙提亮"，用户否决
（橙太多）；v2 按 §0 决策改黑白灰后覆盖同名文件。
