# AskUser 问答记录实施计划

计划日期：2026-09-05
计划状态：**实现、96 项定向测试、类型/预算检查、生产构建与静态浏览器验证通过；尚未安装此轮变更**。
设计依据：`DESIGN.md` 的 AskUser 问答记录规则。

## 目标与授权

用户已批准：单层细边框，每组上方显示 AI 与完整问题，下方显示我与回答；
多组细线分隔，去掉 Answers 标题及圆点。问题不以主题摘要代替。
用户另行授权同步现有问答测试的预期数据及运行直接相关的定向测试。

问答实现已提交为 `0d49192`，未重新安装。两个后台审查代理均正常完成各自报告，
没有修改产品代码。用户随后明确要求把源码、报告与接续说明提交并推送 GitHub，
供另一台电脑继续开发；此授权不包含安装、修复审查问题或大范围架构重构。

## 依赖顺序

1. 共享结果增加可选 `question` 字段；旧记录继续可读，缺失原文明确提示。
2. Host 实时回执携带原问题；历史从原始 questionnaire 提取完整问题及换行。
3. Bridge 与恢复校验接受并限制字段长度，全文计入 transcript 预算；
   canonical 记录只在主题与回答一致时补齐缺失问题，不覆盖已有问题或改变身份。
4. assistant-ui data part 传递问题；复用现有主题 token 显示纵向问答卡片。
5. Studio 增加可刷新 Answers 场景，使用模拟数据验证多组、长问题和换行。

## 验证与交付

- `pnpm run typecheck`、`pnpm run lint:budgets`、`pnpm run build`、`git diff --check`。
- 定向运行实时回执、历史解析、恢复持久化、canonical 补全、Bridge 校验、
  runtimeAdapter 和 transcript 文本预算的现有测试，不运行全量测试或新增视觉测试。
- 静态浏览器检查 Light 480px、Dark 320px、Auto 400px 的边框、角色顺序、
  上下排列、保留换行和横向溢出；Auto 使用 Studio 模拟的编辑器深色变量。
- 同步 `STATUS.md`，审查并只暂存本轮精确路径，创建本地原子提交。
- 真实 Cursor 行为仍待构建安装后由用户验收，不能将静态预览描述为已安装。

本次已通过的定向测试命令（在仓库根目录执行）：

```powershell
pnpm exec vitest run src/extension/pendingInteractionCoordinator.test.ts src/runtime/history/SessionHistory.test.ts src/extension/SessionRecoveryStore.test.ts src/extension/ingestConversationHistory.test.ts src/webview/bridge/validateInteractionMessages.test.ts src/webview/assistant/runtimeAdapter.test.ts src/shared/transcriptLimits.test.ts
```

## 下一次接续开发

1. 先按根 `README.md` 在新电脑恢复依赖与静态预览。当前源码包含 `0d49192`；
   不能仅凭同为 0.8.0 就认为新电脑安装的旧 VSIX 已包含它，应从拉取后的源码重新打包。
2. 阅读 `STATUS.md`，再看两份报告的执行摘要和覆盖缺口：
   `RUNTIME_CORRECTNESS_REVIEW.md` 与 `ARCHITECTURE_SDK_REVIEW.md`。
3. 两份报告均已完成，合并去重后列出 9 个静态判定缺陷（2 P1、7 P2），
   另有候选和架构建议。报告不是动态复现或修复记录；审查基线为 `a29dec1`，
   后续定位行号与结论时以当前源码为准。
4. 建议下一项优先核实运行报告 R1（旧回合结算覆盖新内容）和 R2（snapshot 清空
   仍 pending 的交互卡），确认后按项目规则批准修复计划。报告的全部整改和重构
   尚未获实施授权，不自动开新 Worker、Mission、SDK 升级或换状态库。
5. 新会话可以直接使用以下说明接续，无需复制本次完整对话：

> 先读 AGENTS.md、README.md、docs/STATUS.md、docs/PLAN.md 和两份审查报告。
> 问答 UI 已实现并测试，两份审查已完成但缺陷未修。先核实 R1/R2，给出最小修复计划，
> 获批后再实施；保留现有未提交改动，不擅自安装或推送。
