# 排障

## 先做什么

1. 运行 `DroidVisX: Open Logs`。
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

## 常用命令

- `DroidVisX: Open Logs`
- `DroidVisX: Export Diagnostics Bundle`
- `DroidVisX: Shut Down Background Daemon`

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
