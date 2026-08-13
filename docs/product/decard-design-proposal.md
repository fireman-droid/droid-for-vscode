# 消息流去卡片化设计提案

Status: **设计提案，未实现**（2026-08-13）。本提案只定义视觉与结构，
不修改生产代码。静态装置见
[`artifacts/design-decard-proposal.html`](../../artifacts/design-decard-proposal.html)。

## 用户定稿：聚合 ticker 上滑渐隐（2026-08-13，`artifacts/ticker-mini.html` 逐值确认）

旧行 `translateY(0 → -100%)` + `opacity(1 → 0)`，新行 `translateY(100% → 0)` +
`opacity(0 → 1)`，同一时钟。锁定值（实现真身时对齐 `activityRows.tsx` 的
`ActivityTicker` 与 `styles/12-exploration-ticker.css`）：

- 时长：**280ms**（当前真身用 `--dvx-duration-slower` 300ms，改为 280ms）
- 曲线：**`cubic-bezier(0.22, 0.61, 0.36, 1)`**（当前真身 `--dvx-easing-out-strong`，对齐到此值）
- 行高（viewport / row）：**26px**
- 机制不变（轨道上移一行 + 行级透明度、compositor-only、reduced-motion 瞬切）。

## 1. 结论

这次不是把灰卡换成白卡，而是重新分配视觉边界：

- 用户输入与编辑器仍可拥有完整容器，因为它们是可操作的输入面。
- 计划、Changes、普通工具活动属于消息叙事，使用文字层级、缩进树和
  hairline 表达结构，不再各自占一张卡。
- `Preview`、`Open` 等局部动作跟随所属行；`Commit` 属于 Changes
  整体动作，留在区域尾部。动作不再散落成下一行的孤立按钮。
- 状态主要靠动词时态、四级字色与数字表达。运行中仅允许一个小圆点或
  shimmer；完成态退色，不添加“成功卡”。

四级字色直接映射生产 token：

1. 主标题 / 当前步骤：`--dvx-ink`
2. 动词 / 区域标题：`--dvx-text-secondary`
3. 文件对象 / 常规元数据：`--dvx-muted`
4. 时间 / 数量 / 分隔 / 已完成步骤：`--dvx-subtle`

结构线统一为 `1px solid var(--dvx-border)`；hover 洗色统一为
`var(--dvx-soft)`。浅色基底为 `#f5f3ef` / `#fff`，深色为
`#1a1a1a` / `#242425`，均来自 `00-tokens.css`，未另造主题色。

## 2. Cursor 手法调研

公开资料能确认的产品方向：

- Cursor 0.49 把统一 `Review changes` 放在回复末尾，而不是给每个文件
  重复一个主按钮。这支持“局部动作跟文件行、整体动作跟区域尾部”的
  层级。[Cursor 0.49 changelog](https://cursor.com/changelog/0-49)
- Cursor 2.0 强调跨文件统一 review，并把文件 / 目录作为行内 pills；
  pill 用于短对象，不等于把整个活动行做成卡片。
  [Cursor 2.0 changelog](https://cursor.com/changelog/2-0)
- Cursor 3.0 继续把 plan 放进 transcript，todo 完成后仍保留；这要求
  plan 是消息叙事中的稳定锚点，而非回合结束就消失的临时浮层。
  [Cursor 3.0 changelog](https://cursor.com/changelog/3-0)
- Cursor Agents Window 的 review 是独立检查面，聊天里只需要给出轻量
  入口；文件级接受 / 拒绝动作仅在 hover 时出现。
  [Agents Window docs](https://cursor.com/docs/agent/agents-window)
- Cursor 自己的流式体验也遵循“动画只属于正在发生的事”：运行中
  shimmer，完成后切过去时态和量化摘要，不额外包完成卡。仓库既有
  [`streaming-experience-design.md`](./streaming-experience-design.md)
  已记录这一点。

从这些界面与资料可归纳四种“无卡仍有结构”的方法：

1. **字色四级**：强文字只给任务名与当前动作，时间和结束状态主动后退。
2. **缩进树**：父任务与子步骤靠左轨和缩进建立从属，不靠不同底色。
3. **hairline 分节**：线只切换语义段，不包围每一行。
4. **hover 才显动作**：`Open` / `Preview` 等低频动作在静止时弱化或
   隐藏；用户靠近该行才完整显现。

## 3. 计划条

### 推荐：A · Hairline timeline

流内收起态固定为一行，顺序为：

`6px 状态点 → 单行标题 → n/m → 13px chevron`。

- 行高 `32px`，顶部 hairline 与前一段正文分节；没有外框、圆角和底色。
- 标题 `13px / 535 / --dvx-text-secondary`；计数
  `10.5px / --dvx-subtle / tabular-nums`。
- 运行中只把状态点设为 `--dvx-accent`，外加 3px、10% 混色的静态
  halo；如已有全局 shimmer，可让标题 shimmer，二者只保留一个动态载体。
- 完成后圆点退到 `--dvx-subtle`，标题保持 secondary，`4/4` 就是完成
  证据；不加绿色、对勾胶囊或 Completed 横条。
- 展开体不是面板：在标题下缩进 `18px`，一根 `--dvx-border` 左轨贯穿
  步骤；每项用短横接轨。当前项用 5px accent 点 + `--dvx-ink`，
  已完成项用 `--dvx-subtle`，不加整行底色。
- 展开 body 使用既有 `0fr ↔ 1fr` 或 `max-height + opacity`，
  `--dvx-duration-slower` 与 `--dvx-easing-out-strong`；reduce-motion
  下移除 transition。

吸顶态只增加“可读性底盘”：`padding-inline: 10px`、`8px` 圆角、
`1px --dvx-border`、不透明 `--dvx-raised` 和极短阴影。行高维持
`34px`，内容位置不跳；展开内容继续使用同一左轨。离开锚区后由下一条
自然推走，不做 fixed 浮窗。

### 备选：B · Left rail

整段计划左侧保留一根持续轨道，完成计划的整体感更强，但在连续出现多段
活动时容易形成过多竖线。因此适合计划详情页，不推荐作为主消息流默认。

### 给实现代理

- 现有 `.dvx-plan-anchor` 的 gradient、四边 border、12px radius、
  shadow、eyebrow、独立 foot 全部应移除。
- DOM 建议为一个 disclosure `button` 加一个同级步骤 `ol`；不要再拆
  `View` 与 status 两个点击目标。
- sticky 类只由现有吸顶体系附加；不要在计划组件内自行监听滚动。
- 当前步骤背景 `color-mix(...6%)` 应删除，当前性由轨道点与字色表达。

## 4. Changes 区域

### 推荐：A · Ledger with footer

Changes 是一份实时增长的“文件账本”，不是文件 chip 集合：

- 首次文件写入时出现区域；header 高 `28px`，左侧 `Changes`，右侧
  `writing · 2 files`。运行中前置 5px accent 点，数字实时刷新。
- 文件按首次出现顺序逐行追加。每行高 `27px`，左侧仅一根竖 hairline；
  文件名用 `--dvx-mono / --dvx-muted`，统计用 tabular nums 与现有
  diff token。
- 同一文件再次写入只更新统计，不重播整行入场；新文件以
  `--dvx-duration-fast` 纯淡入。
- HTML 文件的 `Preview` 位于该文件行尾；其他 `Open` / 更多动作默认
  弱化，row hover / focus-within 时完整出现。
- 回合结束后 header 从 `writing · N files` 原位切为 `N files · settled`，
  accent 点消失；不改变区域尺寸、不弹“完成卡”。
- footer 用一根顶部 hairline 与文件账本分开。`Review` 是普通文字动作，
  `Commit…` 稍强但仍是无框文字动作；两者同行，不再出现下一行的孤立
  `Commit these changes...` 按钮。

窄侧栏允许隐藏 footer 解释文案，只保留右侧动作；文件行可把 `Open`
收进省略号，但 `Preview` 仍保留在 HTML 文件所属行。

### 备选：B · Compact inline rows

标题直接写 `Changed N files`，每行都带 `Preview/Open + ···`。信息密度
更高，适合宽面板；在 Secondary Sidebar 会使右侧动作拥挤，因此不是默认。

### 给实现代理

- `.dvx-changes-files` 从 `flex-wrap + chips` 改为纵向 `ul`。
- `.dvx-changes-file` 移除 background、四边 border、radius；改用
  grid row 与左侧 `border-left`。
- `.dvx-preview-chip` 与 `.dvx-commit-entry` 不再是有框 chip；统一为
  22px 高无框 text action，hover 才使用 `--dvx-soft`。
- 运行状态只挂在区域 header，避免每个文件行 shimmer。
- 文件统计更新需保持 DOM key 稳定；新增行才做 entry fade。

## 5. 工具活动行

### 推荐：A · Quiet ruled rows

普通工具活动保持单行、透明背景：

- 两列 grid：左侧“过去时动词 + 对象”，右侧“动作 · 状态 · 时间”。
- 动词 `--dvx-text-secondary / 525`；对象
  `--dvx-muted / mono / 10.5px`；状态与时间 `--dvx-subtle`。
- 左侧 4px 中性点对齐文字基线，连续行之间只用 58% 透明度的 hairline。
- `Preview/Open` 静止时 `opacity: 0`；所在行 hover、键盘
  focus-within 或触屏设备下显示。状态文字不做按钮。
- running 行只让动词 shimmer；完成立即切过去时态。完成行不需要灰底、
  描边、圆角或阴影。

这与 Cursor 的“动词先行、对象行内、量化结果收尾”一致，同时保留
DroidVisX 的暖色 shimmer。

### 备选：B · Indented tree

同一连续工作段使用左侧竖轨和短横连接子步骤。适合 3 条以上的连续探索或
验证活动；单条 edit / execute 不应为了视觉一致强行成树。

### 给实现代理

- 普通 `.dvx-activity-row` 必须保持 `background: transparent;
  border: 0; box-shadow: none`；只有真正的 terminal well 等可滚动内容
  保留容器。
- 不要把 `Completed` 加 font-weight；过去时动词已经说明动作完成。
- row action 需在 `:focus-within`、粗指针 / 无 hover 媒体查询下常显，
  避免只靠 mouse hover。
- 现有 activity grouping 可复用缩进树，但 group header 也应是透明行。

## 6. 编辑卡 Restore 控件

### 推荐：A · Send-adjacent undo toggle

Restore 是“这次重发会不会回退文件”的发送选项，应靠近发送按钮：

- 有后续文件变更时，在发送按钮左侧出现 24px 高无框 undo 控件。
- 默认关闭时只显示 12px 回转箭头，tooltip 为
  `Restore files changed after this message`。
- 开启后原位扩成 `Restore 1 file`；`--dvx-soft` 仅作为已开启的轻洗色，
  不画 checkbox 方框。
- 点击发送时选项与主动作在同一视线内，避免用户在编辑正文和底栏之间
  来回寻找状态。
- 文案按数量为 `Restore 1 file` / `Restore N files`；不再使用
  `changed after this point` 这类内部实现口吻。

该选项风险高但频率低：不能默认隐藏进更多菜单，也不应抢成第二个主按钮。
图标 + 开启后文案兼顾安静与可确认性。

### 备选：B · Footer switch

在输入区和控制条之间放一条 hairline footer：
`Restore 1 later file on resend  [switch]`。语义最明确，但会永久增加编辑卡
高度；仅适合用户研究证明该选项被频繁使用时。

### 给实现代理

- 删除 `.dvx-restore-box` 自绘 checkbox 视觉；语义控件可继续使用隐藏
  checkbox 或 `button[aria-pressed]`，但可见层采用 undo icon。
- 推荐 DOM 放进 `.dvx-user-edit-actions`，紧邻 send；不要放在 textarea
  下方左侧。
- `aria-pressed`、明确 accessible name、tooltip 和 focus ring 必须保留。
- 深色开启态只使用 `--dvx-soft` 与 `--dvx-text-secondary`，不使用亮橙
  填充；深色主题品牌 accent 已按生产规则退为灰阶。

## 7. 装置与截图

装置页通过 query 参数切换主题和对象：

- `?theme=light|dark`
- `?focus=plan|changes|activity|restore`

预期截图：

- `artifacts/design-decard-plan-light.png`
- `artifacts/design-decard-plan-dark.png`
- `artifacts/design-decard-changes-light.png`
- `artifacts/design-decard-changes-dark.png`
- `artifacts/design-decard-activity-light.png`
- `artifacts/design-decard-activity-dark.png`
- `artifacts/design-decard-restore-light.png`
- `artifacts/design-decard-restore-dark.png`

这些图是设计拍板用静态状态，不代表生产能力已接通。
