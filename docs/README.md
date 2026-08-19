# docs/

文档入口。**不要把新调研默认丢进 `product/`。** 做完就归档，活文档保持短。

## 日常只看这些

| 读什么 | 干什么 |
| --- | --- |
| **[`发现问题写哪里.md`](./发现问题写哪里.md)** | **用着用着发现 bug / 样式 / 缺功能，记到哪** |
| [`../AGENTS.md`](../AGENTS.md) | 怎么干活（门禁、分层、装包） |
| [`debug/handover-2026-08-15.md`](./debug/handover-2026-08-15.md) | **当前做到哪、下一步做什么**（给下一个模型） |
| [`debug/README.md`](./debug/README.md) | 进行中的 bug / 样式 / 子代理 / 扩展分册 |
| [`product/implementation-status.md`](./product/implementation-status.md) | 已装机能力台账（很长，按需搜，不要通读） |
| [`engineering/architecture-overview.md`](./engineering/architecture-overview.md) | 四层架构 |

排障日志：[`product/log-analysis-playbook.md`](./product/log-analysis-playbook.md)。

## 目录怎么分

```text
docs/
  README.md                 ← 你在这里
  HANDOVER.md               ← 接手约定（排除项、切片流程）；进度不写这里
  debug/                    ← 当前反馈与施工（活）
  product/                  ← 仍可能开工的设计 + 进度台账
  engineering/              ← 架构（很少改）
  archive/                  ← 历史：预研、已落地设计、旧验收、旧交接
```

**新文档规则**

1. 正在修的东西进 `debug/` 对应分册，不要新开总清单。
2. 尚未开工、以后可能做的设计才进 `product/`。
3. 已经落地或过期的设计/调研 **挪到 `archive/`**，不要继续堆在 `product/`。
4. 跨会话交接只保留一份：目前是 `debug/handover-2026-08-15.md`。下一份交接应替换它，旧的移入 `archive/handovers/`。

## `product/` 里还留着什么

都是「还可能对照着做」的设计，不是待办清单。开工时再读，不要当进度表。

| 文件 | 何时读 |
| --- | --- |
| `implementation-status.md` | 查某能力是否已接通 |
| `delivery-plan.md` | 交付原则（模块表已过时） |
| `log-analysis-playbook.md` | 排障 |
| `feature-overview.md` | 给人看「现在能干什么」（版本号可能滞后） |
| `ui-cursor-spec` 不在这里 | 在 [`debug/ui-cursor-spec.md`](./debug/ui-cursor-spec.md) |
| `spec-mission-design.md` / `slice-prep-spec-mode.md` | Spec Mode |
| `queued-messages-design.md` | 发送队列（行为已有，设计可参考） |
| `changes-ledger-git-snapshot-design.md` | Changes 账本改造（git 快照树为权威），未开工 |
| `byok-add-model-design.md` | 自定义模型（段 D 会碰到） |
| `subagent-transcript-playback-design.md` | 子代理转录（段 C 会碰到） |
| `rich-content-design.md` / `slice-prep-canvas.md` | Canvas 仍待做 |
| `theme-switching-design.md` | 主题（段 A 已动 token，对照用） |
| `tier1-polish-plan.md` | 流式命令预览等残留 |
| `plugins-hooks-design.md`、`git-pr-workflow-design.md`、`native-terminal-design.md`、`background-process-design.md`、`worktree-parallel-design.md`、`add-to-chat-design.md`、`conversation-minimap-design.md`、`interleaved-thinking-design.md`、`token-usage-design.md`、`plan-title-limitation.md`、`mission-control-feasibility.md` | V2 / 边界证据，未排期不要开工 |

归档清单见 [`archive/README.md`](./archive/README.md)。
