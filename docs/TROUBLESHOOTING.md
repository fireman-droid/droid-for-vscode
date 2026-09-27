# 排障

## 先做什么

回复停住时先区分“已结束”和“仍在运行／等待权限／队列暂停”。新问题在旧轮仍运行时
先排队，不代表模型已收到。`host.turn.watchdog-stop-unconfirmed` 表示后台未确认中断，
此时继续阻止下一轮是安全边界；可重试 Stop 或重新连接会话，不要把提示当作已停止。
`runtime.turn.finished` 的成功／中断／异常及对应 Host 终态应一起核对。

Diff 文件数可能因真实净变化还原而减少，不能只凭数字判断丢失。检查同一 turn 的
`host.changes.settled` 来源、文件数和 `host.changes.snapshot.diff`；没有快照时还要
区分读取未知与确认无变化。故障报告请给出会话、问题文本和发生时间，先去敏。

1. 运行 `Droid: Open Logs`。
2. 确认最近一次 `extension.activated`。
3. 找同一个 `act` 的 `webview.boot-ok`、`runtime.initialize.finished`
   和 `webview.render-ok`。
4. 按 `turn` 过滤一次交互。
5. 只根据日志中出现的事实判断，不把缺少可选事件当成故障。

## 日志位置

Windows：

```text
%APPDATA%\Cursor\User\globalStorage\droidvisx.droidvisx\logs\
```

文件为按 UTC 日期写入的 JSONL。多个窗口和多次 Reload 会写进同一天文件，
使用 `act` 区分扩展激活实例，使用 `sequence` 排序。

日志包含本地消息、命令、路径、错误和工具内容。凭据形状会替换为
`[REDACTED]`。分享日志前仍需人工检查敏感信息。

默认保留预算为 200 MiB，尽力删除最早的往日日志，不删除当前 UTC 日文件，
因此当前日仍可能超出预算。VS Code、其他系统或远端 Host 使用各自的扩展
global storage 路径，不要直接套用上面的 Cursor Windows 路径。

`Export Diagnostics Bundle` 手动弹出保存对话框，默认目录是第一个工作区，
无工作区时为 global storage。ZIP 包含现存日志、环境版本／平台及工作区路径
元数据和本排障说明。命令只保存本地文件，不自动上传；诊断链路未配置自动上传器，
但这不代表 Droid、模型服务、插件和 MCP 没有自己的网络请求。
日志、导出的 ZIP 和截图均应先人工去敏，不能直接发到公开 Issue。

## 常用命令

- `Droid: Open Logs`
- `Droid: Export Diagnostics Bundle`
- `Droid: Shut Down Background Daemon`
- `Droid: Manage Droid Capabilities`

### Plugins、MCP 与默认设置管理

从命令面板打开能力管理，也可从 Chat 的 Plugins、MCP 或设置入口进入。
需要当前已连接会话；修改配置前需受信任工作区、空闲会话及原生确认。
切换会话／工作区后重新打开，不能继续沿用先前目标。

- 插件或市场更新报部分失败时刷新目录；已完成的修改不会自动回滚。
- daemon MCP 登录在浏览器完成后若未自动结束，可把最终回调 URL 粘贴到原生
  密码输入框。需包含 code 和 state（失败时为 error 和 state），不粘贴密码、
  Cookie 或 API Key；URL、state 不匹配会被拒绝。Escape／通知中的 Cancel
  调用 Droid 取消授权；只有 SDK 完成通知确认成功才视为已登录。
- MCP 高级管理和会话终端需要 daemon 模式，Process 保留已有 MCP 操作。
- 终端列表不是系统进程列表；为空不能推断所有后台工具已停止。
- 更新只报告 Droid 是否接受请求，不报告未证实的安装完成。

### 交互终端与 Skills 范围

- 在设置的 Runtime 页打开 Droid session terminals，或从原生命令的同名分组
  进入。可新建 shell、连接已有终端或确认关闭 daemon shell，均需 daemon 模式。
- 交互终端直接执行你的输入，不经过 Droid 模型审批。打开时需空闲、可信工作区；
  连接后仍绑定该会话。切换会话／工作区或连接断开后，重新打开管理入口。
- 关闭 Cursor 终端视图只 detach，不保证 shell 或其中的进程停止。真正关闭需在
  管理列表选择 Close daemon shell 并确认；这不是任意系统进程管理器。
- 已有终端不补放早期输出。若提示输入未确认，先重新连接并检查 shell 状态，
  不盲目重复命令；扩展不会自动重发。日志不记录此交互终端的输入和正文。
- Skills 页的 Inspect skills & manage scope 可查看定义／资源／禁用来源，
  并选择用户或项目范围。项目范围只在 Droid 报告可用时出现；某个范围允许后
  仍可能被 frontmatter、组织或其他设置范围禁用，修改后以有效状态为准。
- 检查视图是单独的未保存文本快照；Open definition file 才打开原始本地文件，
  保存由用户决定。新启停设置在新会话中加载，扩展不自动替换当前聊天。

## 常见问题

### Webview 白屏

| 日志 | 方向 |
| --- | --- |
| 无 `boot-ok`，有 `boot-timeout` | Bundle、CSP 或资源加载 |
| `boot-ok` 后出现 `webview.error` | React 或渲染数据 |
| 有 `boot-ok`，无 `render-ok` | Host 未发快照或转录为空 |
| build id 不是最新 | 完整退出并重启 Cursor |

### 回合卡住

检查是否依次出现：

```text
host.turn.accepted
runtime.turn.started
runtime.turn.finished
host.turn.state
```

缺在哪一步，就从对应层排查。权限和 AskUser 等待时间不要算作模型耗时。

### 历史重复或缺失

查看 `host.perf.recovery`：

- `loaded` 是公开历史数量
- `recovered` 是本地检查点数量
- `reconciled` 不应简单等于两者相加
- daemon 历史为 complete 时，它是正文权威

### 输入消息时页面跳动

记录大致时间，区分“底部输入框打字”“编辑历史问题”和“AI 正在输出”。
查看同一 `act` 的 `webview.perf-batch`，其 `detail` 内 JSON 的 `source`：

- `composer.layout`：只有实际尺寸或单／多行状态变化时记录；同一行内连续输入
  不应反复切换 `previousMultiline`／`multiline` 或改变高度。
- `transcript.resize`：1 秒内的视口变化次数、最小／最大高度、最终 scrollTop、
  scrollHeight、clientHeight、following、navigating 与 composerFocused。
  可区分输入框造成的高度变化和正文滚动。该记录不包含输入内容。
- `transcript.follow`：滚轮解除跟随时的 deltaY、几何数据和 following=false。
  上滑后不应因仍距底部不足 4px 而恢复跟随；此记录不含消息或输入正文。

这些是布局证据，不等于已复现根因。没有上述记录的旧日志无法精确归因；
历史问题编辑与正文增长也不能仅凭底部 Composer 的数据排除。

### Diff 整文件替换或显示旧轮次变更

记录大致时间，并展开异常文件的 Chat Diff 或 Review 文件。按 `act`、`sessionId`、
`turnId` 关联以下事件；Review 的 `snapshotSessionId` 可能指向恢复前的原始会话。

- `host.changes.snapshot.capture`：前后 tree、被替换的 previousTree、采集模式与耗时。
  新 Git 采集模式为 `copied-index-renormalized`，只重读私有索引，不改变真实索引。
- `host.changes.snapshot.paths`：忽略文件补采集前后的 baseline 和数量。
- `host.changes.snapshot.skipped`／`host.changes.snapshot-failed`：跳过或失败原因。
- `host.changes.snapshot.diff`／`host.changes.snapshot.file`：实际树是否相等、
  文件数量和原始 numstat。树相同表示该轮完整快照没有变化。
- `host.changes.settled`／`host.changes.attribution`：最终数量、文件是否被工具点名、
  来源是快照还是备用统计，以及缺少 before/after 时的原因。
  当前完整快照来源为 snapshot；旧版 snapshot-with-tool-extras 可能混入失败候选。
  树相同、真实文件数为零，但旧结算数量非零时，不能把该数量当作成功写入。
- `host.review.scope`：请求轮次、实际快照会话、生命周期及文件清单来源。
- `host.changes.contents`：打开文件时的字节数、行尾类型与相等标记。
  `sameBytes=false` 且 `equalIgnoringCrlf=true` 仅证明所读两侧只有 CRLF/LF 差别，
  不能单凭这一条区分真实行尾编辑与旧快照采集错误。不会忽略其他空白或改写 Diff。
- `host.perf.snapshot`：`currentTurnId`、`latestChangesTurnId`、数量及
  `changesSource=latest-nonempty-settled-turn` 是历史存储元数据。底栏现在直接订阅
  当前轮的 changes.update，不借用该历史清单；历史 Review 从对应消息打开。
- `host.changes.contents.status=not-found` 表示路径在比较两侧都不存在，不表示
  快照丢失。unavailable、too-large、binary 与 read-failed 分别保留其实际含义。

新 Diff 诊断只记录元数据，不记录文件内容。旧日志缺少这些事件时不能据此反推根因，
旧快照也不会被新版本自动重写；需要结合保存树、真实索引和工作区行尾元数据判断。

### Daemon 无法连接

1. 确认本机 Droid 已登录。
2. 执行关闭后台 daemon 命令。
3. Reload Window。
4. 查看 `daemon.*`、`runtime.initialize.finished` 和 SDK transport 错误。

### UI 还是旧版本

```powershell
pnpm run build
pnpm run package:vsix
cursor --install-extension dist/droidvisx.vsix --force
```

然后 Reload Window。若 build id 仍旧，完整退出 Cursor 后重开。
