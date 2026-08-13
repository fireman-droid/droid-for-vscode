# 计划条标题短板：TodoWrite 没有计划标题字段

> 性质：上游数据面短板的独立档案（用户 2026-08-13 要求单独立档：
> "存在这样的短板，看看后期能不能修复"）。
> 关联实现：`src/webview/assistant/planAnchor.ts`（标题投影）、
> `src/runtime/toolDetail.ts`（TodoWrite 归一化）、
> `src/webview/assistant/PlanLine.tsx`（折叠行渲染）。

## 1. 短板是什么

计划细条折叠时只有一行：状态点 + **标题** + n/m 计数 + chevron。
这个标题在数据面上没有权威来源——Droid 的 TodoWrite 工具从头到尾
只携带**步骤清单**，不存在任何"计划名称/标题"字段：

- Runtime 侧 `normalizeTodoDetail()`（`src/runtime/toolDetail.ts`）
  接受的 `todos` 全部形态为：行字符串清单（`- [x] …`、`1. …`）或
  `{ id?, content, status }` 对象数组（与 droid CLI 自身解析器核实，
  见该文件注释）。可用字段只有步骤文字与状态，归一化输出为
  `N. [status] text` 行。
- Bridge 的 plan detail 即这些行的拼接文本；Webview
  `parsePlanSteps()` 只能解析出 `status + text`。
- CLI 自己的界面同样没有计划标题概念（TodoWrite 渲染即清单）。

所以折叠行标题只能拿**某一步的文字**顶替，天然存在语义误导空间。

## 2. 现行缓解（2026-08-13 已实现）

标题改为**动态状态行**语义（`planLineTitle()`，投影时逐次计算）：

1. 有 `in_progress` 步 → 显示第一个进行中的步骤；
2. 没有进行中但有 `pending` → 显示下一个待做步骤（更新间隙）；
3. 全部完成 → 显示最后一步。

由此消除的副作用：此前标题是"创建时冻结的第一步文案"，计划全部
完成（n/n）时仍显示第一步，读起来像"卡在第一步"（用户 2026-08-13
真机截图反馈，当日改为动态）。

**注意**：这仍是"步骤文字顶替"，不是真标题。清单只有一步时，标题
与展开清单的唯一条目重复，属已知可接受的噪音。

## 3. 后期能不能修复（路径评估）

| 路径 | 判定 | 说明 |
| --- | --- | --- |
| a) 上游 SDK/CLI 给 TodoWrite（或 plan 数据面）增加标题字段 | **首选，等上游** | 一旦公开 schema 出现 title/plan-name 字段：Runtime 归一化透传、`PlanAnchorState.title` 改取真标题、`planLineTitle()` 退役为回退路径。改动局部、无迁移成本 |
| b) 用触发该回合的用户消息首行当标题 | 备选，未采用 | 数据现成（计划本就锚定在该用户消息下）。风险：用户消息常常很长、口语化或与计划内容错位——语义是"任务由来"不是"计划名"。若将来采用需配截断与去噪规则，且要用户先审形态 |
| c) 本地生成式摘要（LLM 起标题） | **排除** | 违反产品原则：DroidVisX 不建第二套 AI 后端（AGENTS.md、delivery-plan 产品目标） |
| d) 引导 Droid 把标题写进第一步 | **排除** | 模型行为不可控，无法保证格式契约，且污染第一步的真实步骤语义 |

## 4. 复查触发点

- 每次升级 `@factory/droid-sdk` 或 droid CLI 后，检查 TodoWrite
  工具 schema 与会话 JSONL 中 plan 相关字段有没有出现标题类字段
  （路径 a 的解除条件）。
- 若用户再次反馈折叠行标题误导，先考虑路径 b 的形态原型（样板间
  先行），不要直接上生产。
