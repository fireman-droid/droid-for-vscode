# MCP 持久权限管理：公开渠道调研

日期：2026-08-12。纯调研，不改生产代码。对应 backlog 优先级 2
"可以有"项（`HANDOVER.md` §3），用户决策：先调研公开 SDK/daemon
是否有对应渠道，有则排期实现，无则如实判 fail-closed。

## 结论（TL;DR）

**判定：有官方管理渠道，但形式是 CLI 子命令，不是 SDK/daemon API。**
落在原定三档的第一档与第二档之间，倾向第一档：

- **官方渠道存在**：`droid mcp permissions list | revoke <server> [tool] |
  clear --confirm` 是 CLI 内置子命令，且被 Factory 官方文档
  （https://docs.factory.ai/harness/mcp "Persistent tool permissions" 节）
  明文记载，含语义承诺（撤销 server 级会连带撤销该 server 全部 tool 级
  授权；授权绑定 server 传输配置指纹，配置变更后自动失效）。
- **SDK/daemon RPC 面确认没有**：与 `daemon-feature-opportunities.md` B3
  的既有结论一致，daemon 协议无列出/撤销 RPC；且 SDK 类型里完全没有
  `persistentPermissions` 字段，`SETTINGS_UPDATED` 通知的 schema 是
  strip 模式，权限变更事件无法经 SDK 送达客户端。
- **存储文件契约是非官方的**：授权持久化在用户级
  `~/.factory/settings.json` 的 `mcp.persistentPermissions` 键下，
  结构可解析但文档未承诺该格式。

**建议排期实现**（见"实现草案"）：撤销走官方 CLI 命令（稳），读取列表
以解析 settings.json 为主、fail-soft 降级为提示用户运行
`droid mcp permissions list`（读通道无官方机器可读格式，`list`
无 `--json` 输出）。

**既有 B3 结论需要修正**：`daemon-feature-opportunities.md` §B3 判
"没有公开渠道"只核对了 daemon RPC 枚举，漏掉了 CLI 命令面与官方文档。
fail-closed 判定不成立，不应写入 `HANDOVER.md` 的 fail-closed 表。

## 调研路径与证据

### 1. SDK 公开面：无读写 API

证据来源：`node_modules/.pnpm/@factory+droid-sdk@0.7.0/node_modules/@factory/droid-sdk/dist/index-D_SzTnFR.d.ts`（SDK 0.7.0）。

- `DroidServerMethod` 全枚举（L56–91）：MCP 相关只有
  `TOGGLE_MCP_SERVER/TOOL`、`AUTHENTICATE_MCP_SERVER`、
  `CANCEL/CLEAR/SUBMIT_MCP_AUTH*`、`ADD/REMOVE_MCP_SERVER`、
  `LIST_MCP_REGISTRY/TOOLS/SERVERS`。没有任何列出/撤销持久权限的方法。
  `CLEAR_MCP_AUTH` 清的是 OAuth 凭据（与既有 B3 结论一致）。
- 全文检索 `persistentPermissions`：0 命中（`rg` 于整个 d.ts）。
- `McpToolInfoSchema`（L2906）只有 `isEnabled`（工具开关），无授权状态。
- `ToolConfirmationOutcome`（L5–24）含 `ProceedAlwaysTools =
  "proceed_always_tools"`（注释："MCP: Persist approval for specific
  tool(s) across sessions"）与 `ProceedAlwaysServer`——SDK 只提供
  "写入授权"的确认选项，不提供读取/撤销面。
- `SettingsUpdatedPayloadSchema`（L105167 起）是 strip 模式的会话设置
  形状，不含 `mcp` 键。CLI 内部持久化成功后 emit 的
  `settings-updated`（携带 `settings.mcp.persistentPermissions`，见下）
  经 SDK schema 解析会被剥掉，客户端拿不到权限变更推送。

### 2. 本地文件契约：用户级 settings.json 的 `mcp.persistentPermissions`（非官方格式）

证据来源：`C:\Users\ASUS\bin\droid.exe` 内嵌 JS 字符串（`rg -a` 提取）。

- `ToolExecutor.persistMcpPermissionsIfApplicable`：确认结果为
  `proceed_always_tools` / `proceed_always_server` 且
  `confirmationType === "mcp_tool"` 时，调用
  `McpPermissionService.persistToolPermission(server, tool, impactLevel,
  identity)` 或 `persistServerPermission(server, impactLevel, identity)`。
- `persistToolPermission` 写入记录形如
  `{ approvedAt: ISO8601, impactLevel, serverIdentity? }`，落到
  `persistentPermissions.tools[serverName][toolName]`；server 级落到
  `persistentPermissions.servers[serverName]`。
- `writePersistentPermissions` → `settingsService.updateUserMcpSettings`
  → `updateLevelSettings("user", ...)`，即用户级设置文件
  `~/.factory/settings.json` 的 `mcp` 键下（同一函数族还管理
  `general.trustedFolders`，与本机 settings.json 中实际存在的
  `trustedFolders` 键互相印证）。
- `McpPermissionService` 同时具备 `revokeToolPermission`、
  `revokeServerPermission`、`listPersistentPermissions`（返回
  `{ servers: Map, tools: Map }`）——完整 CRUD 都在 CLI 进程内。
- `serverIdentity` 是 server 传输配置的指纹（官方文档语义：stdio 的
  command+args 或 http/sse 的 URL）；配置变更后旧授权不再生效。
- 本机只读检查：`C:\Users\ASUS\.factory\settings.json` 当前没有 `mcp`
  键（本机尚未对 MCP 工具点过 "Always allow"，`droid mcp permissions
  list` 输出 "No persistent MCP permissions configured." 印证）；
  `~/.factory/mcp.json` 只有 server 配置与 `disabled` 标志；项目
  `.factory/` 下只有 droids/skills，无权限文件。
- 官方 Settings 文档页（https://docs.factory.ai/cli/configuration/settings）
  **不含** `persistentPermissions` 字段——文件格式无文档承诺，属
  非官方契约。

### 3. CLI 命令面：官方子命令，实测可用

证据来源：`droid.exe` 内命令注册代码 + 本机实际运行输出。

- 命令注册（binary 提取）：`command("permissions").description("Manage
  persistent MCP tool permissions")`，子命令 `list`、
  `revoke <server> [tool]`、`clear --confirm`。
- 实测 `droid mcp permissions --help`（2026-08-12 本机输出）：

  ```
  Commands:
    list                    List all persistent MCP permissions
    revoke <server> [tool]  Revoke MCP tool or server permission (revoking a
                            server also revokes all per-tool permissions for
                            that server)
    clear [options]         Clear all persistent MCP permissions
  ```

- 实测 `droid mcp permissions list` → "No persistent MCP permissions
  configured."（人类可读文本，无 `--json` 之类机器可读选项）。
- 撤销成功输出格式（binary 提取）：`✓ Revoked permission for tool:
  <server>___<tool>` / `✓ Revoked all permissions for server: <server>`，
  失败走非零退出码。

### 4. 公开文档：官方明文记载

证据来源：https://docs.factory.ai/harness/mcp，"Persistent tool
permissions" 节（2026-08-12 抓取）。原文要点：

- "When you approve an MCP tool, Droid can remember that approval so it
  persists across sessions."
- "Each approval is bound to a stable fingerprint of the server's
  transport configuration… If a previously trusted server name is later
  re-pointed at a different command or URL, the stored approval no longer
  applies."
- "Manage these approvals with `droid mcp permissions`"，列出与实测一致
  的三个子命令及语义。

## 三档判定

| 档位 | 是否成立 | 说明 |
| --- | --- | --- |
| 有官方读写渠道 | **部分成立** | 官方渠道 = CLI 子命令（文档承诺语义），但无 SDK API、无机器可读输出、无文档承诺的文件格式 |
| 只有非官方文件契约 | 成立（读侧） | `settings.json` 的 `mcp.persistentPermissions` 可解析但格式无承诺 |
| 完全无渠道（fail-closed） | **不成立** | 既有 B3 的 fail-closed 判定只看了 daemon RPC，应修正 |

综合：**按第一档处理，建议排期**。撤销（安全闭环的关键动作）有官方
稳定通道；读取列表只能靠非官方文件契约或解析 CLI 人类文本，需按降级
心态设计。

## 实现草案（排期建议）

一个 slice 可交付："MCP 持久权限"只读列表 + 逐条撤销。

- **读**（Extension Host）：解析 `~/.factory/settings.json` →
  `mcp.persistentPermissions`。zod 宽松校验（unknown 键容忍），解析失败
  或结构不符时 fail-soft：面板显示"无法读取，请在终端运行
  `droid mcp permissions list` 查看"。不做任何写入。
- **撤销**（Extension Host）：spawn `droid mcp permissions revoke
  <server> [tool]`（官方命令面，参数与语义有文档承诺）。以退出码判定
  成败，成功后重读 settings.json 刷新列表。`clear` 全清可以先不做
  （破坏面大，CLI 里已有 `--confirm` 门槛）。
- **刷新**：无 daemon 推送可用（SETTINGS_UPDATED schema strip 掉 mcp
  键），用 `fs.watch` 监听 settings.json 或每次面板展开时重读即可。
- **UI 挂载**：MCP 管理入口旁新增"持久权限"视图；按 server 分组，
  server 级授权一行 + 该 server 的 tool 级授权若干行，展示
  `approvedAt`、`impactLevel`，每行一个撤销按钮。权限卡上用户点
  "Always allow" 后，可在确认 toast 里带"管理已授予权限"链接跳转。
- **提示语义**：列表页脚注明授权绑定 server 配置指纹（配置变更即失效），
  避免用户误以为列表 = 当前生效集合的强承诺。
- **风险**：`persistentPermissions` 文件格式可能随 CLI 版本演进——读侧
  已 fail-soft；撤销走官方命令不受影响。CLI 未来若提供 `--json` 输出，
  读侧应迁移过去。

## 对既有文档的修正建议（本文档不代改）

- `docs/product/daemon-feature-opportunities.md` §B3 与 §结论表第 10 行
  的"判 fail-closed"应更新为"有官方 CLI 渠道，建议排期"。
- `docs/HANDOVER.md`：不要把本项写入 fail-closed 表；在 backlog 中把
  优先级 2 该项的状态改为"调研完成，可排期"，并引用本文档。
