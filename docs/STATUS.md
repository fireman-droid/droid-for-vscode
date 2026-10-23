# 当前状态

核对日期：2026-10-22。本文区分当前源码、实际验证与安装状态，不再追加逐次施工日志。
功能边界见 [CAPABILITIES](CAPABILITIES.md)，待办见 [PLAN](PLAN.md)，交互约定见 [DESIGN](DESIGN.md)。
旧构建哈希、调查和性能数字从 Git 历史查阅，不能充当当前版本验收。

## 版本与交付

- `0.8.16` 包含「已探索」活动折叠与底部 Composer 输入框内运行状态提示、多步历史回合合并与尾部预算保留、工作区基线哈希缓存、当前目录启动隔离与租约冲突处理、Script 结果解包与关联去重、长 Thinking 分块与收起终端卸载、代码块自动换行、界面提示复制过滤，以及纯本地前端统计。
- 恢复文件等 composer 回执、附件／引用提示及临时诊断继续保留在消息列表底部状态区域；「Droid 正在工作／回答」等运行状态移入底部 Composer 输入框的「继续提问」占位位置，发送后旋转显示、输入时隐藏、停止后恢复占位文字。
- `0.8.15` 已通过 [PR #12](https://github.com/fireman-droid/droid-for-vscode/pull/12) 合入 `main`，
  提交 `30268883`；版本、CHANGELOG 与 `v0.8.15` 标签一致。包含最新操作原位更新、移除中间思考分组、
  保留单条独立折叠，以及正文／符号左边缘对齐；不包含目录整理、超长输入或暂停中的 BYOK 草稿。
- [GitHub v0.8.15](https://github.com/fireman-droid/droid-for-vscode/releases/tag/v0.8.15) 已正式公开。
  正式包来自标签的干净源码，下载后再次核对版本、源码提交、172 项包内容与扩展入口加载。
  SHA256：`34245c268c8b2759364c2361dc96a18b94f0ed97ca19d0871369aecdebca6659`。
- [Open VSX 0.8.15](https://open-vsx.org/extension/droidvisx/droidvisx/0.8.15) 已公开可下载，
  [发布流程](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39094529442) 成功；下载包的 SHA256 与上述 GitHub 正式包一致。
  Cursor 客户端更新仍取决于其市场同步。
- Microsoft Marketplace 管理页在 2026-10-18 仍返回 429／Azure DevOps VSID 并发限流，本次未提交。
  此前还存在 `The extension 'droidvisx' already exists in the Marketplace`、Owner 列表为空的问题。
  未改名或覆盖既有产物，微软自动发布保持关闭，未配置 `VSCE_PAT`。
- Microsoft VS Code 当前安装 `codex/script-activity-results` 的 `0.8.15` 本地试用包，源码提交 `9b50956d`，尚未正式发布。
  包 SHA256 为 `afef506d83b860934e0aa844714cd7d1c497f0d4a280846b5a7ad6bce54fe12a`；已核对 Microsoft VS Code 产品身份，CLI 安装成功，需 Reload Window。
  Cursor 已于 2026-10-19 按用户要求安装同一个 `9b50956d`／`0.8.15` 本地试用包，替换旧 `0.8.13`。已核对 Cursor 产品身份及当前用户扩展登记，扩展入口、聊天 JS 与 CSS 的 SHA256 均与 VSIX 一致；需在 Cursor 执行 Reload Window，未追加安装后页面验收。
  官方 Droid CLI 当前为 `0.241.1`；文档站为 https://fireman-droid.github.io/droid-for-vscode/ 。
- 主工作区未提交 BYOK 改动与其他任务分支保留原样，未顺带合并或清理。

## 当前源码

| 范围 | 当前实现与边界 |
| --- | --- |
| 聊天 | 最新活动独立成行，更早活动归入“执行过程”；正文按时间顺序穿插，历史数量紧随标题。单条工具与 thinking 独立折叠，Edit 默认显示精简 Diff，可在原卡片展开全部，没有 thinking 中间分组；长 thinking 原文分块合并更新并限高滚动。正文与折叠箭头左边缘对齐，失败操作收起时仍可查看。队列预览最多三行；常规设置提供等待／引导，默认等待；daemon 引导不停止当前任务，消费确认后移入聊天，投递不明时暂停保留内容。其余流式、附件、权限／问答、引用和 BTW 保留 |
| 管理页 | 常规、模型、补全、会话、任务；共享设置行、搜索筛选、分页和滚动条，列表刷新保留已有内容 |
| Mission 创建 | 说明型开关行保持背景稳定，操作按钮随内容收紧；调度／执行／验证代理模型支持搜索，保留来源筛选与现有推理等级 |
| 设置模型 | 搜索、来源分组、继承、模型与强度子菜单；等级来自 SDK；纯模型场景直接选择，主聊天尚未整体迁移 |
| 多语言 | 简体中文、繁体中文、英语；默认跟随编辑器，消息与代码保持原文 |
| 主题 | Light／Dark／Auto；真实浏览器刷新先恢复最近主题，深色导航使用可辨识的共享选中背景；正文、BTW、Diff 和输入框共用用户选定的半透明石墨灰文字选区，保留原有字色 |
| Review | 操作与整轮改动、Git 比较、全文／片段、行内问答、受限的操作 Undo 和 SDK Restore；真实浏览器复用同一 Host 控制器，工具栏、滚动和问答沿用共享 UI |
| 恢复 | 打开的会话在 SDK 快速重连结束后每 30 秒继续恢复原连接；Host 自动恢复已知会话及空闲 IDE，回到窗口／侧栏时检查；不重发消息，不中断运行中的后台。失联后台仅在确认旧进程退出后允许替代，身份无法核实不另起任务 |
| 补全 | 独立 FIM 与 Next Edit；自动续写允许较长词尾、条件右括号和语言候选扩展，共享防抖／上下文／请求，短负缓存及可关联诊断；多行建议的嵌套闭合括号不再因相邻同形括号被整段拒绝；默认关闭，模型费用独立于聊天 |

## 最近验证

- `codex/ga4-telemetry` 分支已接入 Cloudflare Worker GA4 转发上报（`Ga4RelayReporter`、`ga4Config.ts` 与 `scripts/ga4-relay-worker.mjs`），默认转发地址已配置为 `https://droid-ga4.k83065556.workers.dev/collect`，覆盖匿名设备哈希、`extension_activated`、`frontend_ready`、`frontend_error`、`frontend_longtask` 与 `activity_expand` 白名单事件；定向测试、`lint:budgets`、`typecheck`、生产 VSIX 172 项校验及线上 Worker `/health`、`/collect?debug=1`（GA4 `validationMessages: []`）与 `/collect`（HTTP 204）实测通过。
- 本轮以真实原生会话和 VS Code `globalStorage/droidvisx.droidvisx/logs` 交叉核对，展开测量实际写入 `webview.perf-batch/activity.expand`。新连接上的 13／15／20／43 条记录组可展开，收起终端正文未挂载，完成态 thinking 从顶部阅读，所见 Script 不再有外层转义包装；跨段复制实测排除执行提示。未重现用户报告的整个编辑器无响应，启动／历史定位仍观察到 205–274ms 长任务，不能将局部展开修复描述成全面性能达标。源码复制按钮通过 Host 路径处理，浏览器剪贴板未提供该路径的有效验证；对应内容／Diff 复制由针对性测试覆盖。
- 本轮 12 个定向测试文件共 186 项通过，涵盖实时／历史失败状态、Script 解包与去重、长 Thinking 分块排版和滚动、紧凑缺失状态及既有 Edit／快照恢复。
  同一真实会话读取 2442 条消息、保留 2000 条记录后重放：原错误命令为 failed、对应重复汇总消失，剩余 14 条有内容的 Script 均无外层 part/result 传输包装直接展示。
  后续空白思考修复的 6 项定向测试通过，并在用户指定的真实页面位置核对空正文与无效箭头已移除；最终包已安装，安装后未重载编辑器验收。用户指出的 Diff 方法提取行配对已按要求推后，见 PLAN。
- 自动换行完成类型检查、文件预算、一次最终构建及 172 项 VSIX 内容／入口校验；按用户要求未追加页面验收或样式测试。
- [PR #14 上一提交的 CI](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39113891055) 有 2505 项测试通过，
  `ReviewFiles.large.test.tsx` 的清空筛选后滚动复位断言失败（31720／预期 0）。相关文件不在本轮改动中，尚未确定根因；PR 保持草稿，未因本地安装绕过合并检查。
- 本轮运行状态、最新活动组合、Edit 归属、长 thinking 与聊天快照恢复的定向测试通过；
  类型检查、文件预算通过。长文本测试验证原文完整、增量合并、旧文本节点复用与滚动恢复，不作为编辑器帧率结论。
  未追加真实页面验收，旧卡住会话与新界面留待用户在本轮试用包中核对。
- Node 24／pnpm 10.2.0 下类型检查、文件预算、生产构建与 172 项 VSIX 内容及入口加载校验通过。
  [0.8.15 远端 CI](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39093967549) 的 354 个文件、3951 项测试全部通过。
  [正式标签构建](https://github.com/fireman-droid/droid-for-vscode/actions/runs/39094350617) 成功，各渠道复用其同一附件。
- 本次 Activity 独立折叠修正的 2 个针对性测试文件、24 项通过，覆盖外层与单条各自收起、没有中间思考分组、
  新增思考不重新打开旧条目、手动选择跨虚拟重挂载保留，以及命令输出与失败操作仍可查看。
  ChatApp 转录恢复的 5 项测试通过，明确区分过程摘要与实际命令卡片，并保留命令与后续正文不重复的断言。
  Node 24／pnpm 10.2.0 下类型检查、文件预算、最终构建与 172 项 VSIX 校验通过。
  当前 VS Code Browser Dev Client 已确认外层展开、单条思考收起同时成立，且没有中间“思考记录”入口；没有添加 CSS 文本测试。
- 自动恢复以模拟时钟覆盖长时间断线、订阅恢复失败、进程退出、并发重试、认证阻塞和关闭清理。
  未做真实整日挂机／休眠验收，未调用付费模型；真实 daemon 中途引导及断线组合场景仍待实测。
## 未完成与使用限制

- 自动恢复不能代替 CLI 登录、安装或协议升级；这些明确的不可用状态保留人工处理入口。没有已知会话 ID 时不自动新建聊天；后台身份不确定、仍有待答权限或正在执行的任务时，不强制迁移 IDE。
- 常规问答 BYOK 目录的未提交修改仍暂停，未进入本次包。
- 同一工作区目前只允许一条执行；多聊天可以打开，等待状态提示与并发架构没有在本次改变。
- SDK 0.9.1 没有独立压缩推理强度。能力是否可配置应按具体操作契约核对。
- 当前局部回归和浏览器验证不代表全仓、跨平台、长期运行或全部模型服务已验收。
  Restore／Undo、管理写操作、完整 Mission 生命周期等按具体任务验证。
- 历史原文和任务状态以 Droid 为权威；本地元数据、快照、UI ACK 或工具路径不能替代
  真实终态、完整绘制和文件作者证据。其他未接入能力集中在能力矩阵。

## 文档与规则

- 用户／项目规则已去除逐次测试审批与无效 skill 依赖；保留范围、用户改动和安装发布边界。
- 设置页认可的共用样式写入 DESIGN，项目仅将 `practical-ui-refinement` 作为当前界面整改 skill。
- STATUS 保留当前快照，PLAN 保留待办，DESIGN 保留稳定约定；历史材料由 Git 保存。
- 文档站构建及仓库内文档文件链接检查通过；构建仍提示已有的大体积前端 chunk，未影响产出。
- 宣传首页按 Factory 首页结构重做：首屏、三列支柱、模型展示、八项功能、Mission、
  工作流、安装步骤和文档入口使用 Droid 内容；本地字体附带 OFL 许可。
  首页与 README 统一定位为“开源 AI 编码助手”；参考 Kilo 的任务导向表达，按 Droid
  实际能力重写介绍、功能与使用场景，页面标题和摘要同步更新。
  桌面及 390px 窄屏已检查，下载菜单、导航和安装步骤切换正常，未见横向溢出或坏图。
  网站构建与文件预算此前通过；本轮发行在独立工作目录中保留主工作区的暂停改动。
  参考取证包含 HTML 双抓、527 个资产的哈希账本、运行时补录与源码模块定位；
  403 个源站 404 和 1 个基址 400 逐 URL 登记后镜像校验通过，抽样回源 3/3 一致。
  未完成 skill 的整站断网、像素等价和 Next/RSC 重构门，不宣称全流程或整站 1:1 验收。
  [官网](https://fireman-droid.github.io/droid-for-vscode/) 与
  [文档站](https://fireman-droid.github.io/droid-for-vscode/GUIDE.html) 已部署至 GitHub Pages；
  [部署流水线](https://github.com/fireman-droid/droid-for-vscode/actions/runs/38380860041) 构建及发布通过。
  线上首页与文档页均返回 200，新文案已生效，首页已移除 noindex；README 和仓库主页已接入正式地址。
  本次部署仅更新网站，没有重复发布扩展。
