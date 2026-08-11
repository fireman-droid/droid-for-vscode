# Droid capability inventory

- Evidence date: **2026-08-11**
- Droid CLI: **0.191.1**
- `@factory/droid-sdk`: **0.7.0**
- Factory protocol: **1.151.0**

## How to read this inventory

The existence of a declaration or protocol schema does not make a feature safe
to ship. Every capability is classified by its supported public access path:

- **Node stable**: public API from `@factory/droid-sdk/node`.
- **Daemon stable**: public facade from `@factory/droid-sdk`.
- **Daemon unstable**: only below `droid.unstable`, version-pin and isolate it.
- **CLI/config only**: documented behavior with no corresponding application
  API.
- **Exported low-level**: public low-level client/schema surface, usable only
  behind an application-owned adapter.
- **Unresolved/unsupported**: no supported integration contract established.

Production status is separate:

- **Wired**: Runtime, Host, strict Bridge, Webview, tests, package, and visible
  acceptance exist for the current scope.
- **Partial**: some layers exist, or a safe fallback is intentionally shown.
- **Probe only**: a no-prompt structural probe exists; no product control.
- **Not wired**: SDK support exists but DroidVisX has no product integration.
- **Blocked**: evidence is insufficient or architecture/credential approval is
  missing.

## Current authority and security boundary

Production uses one local high-level `DroidSession` over a cwd-scoped
`ProcessTransport`. The Extension Host owns all SDK access and interaction
handlers. The Webview receives only strict Bridge v2 DTOs.

The daemon facade is broad and stable, but it currently requires Host-side
Factory API-key authentication. It is capability evidence, not permission to
place credentials in the Webview or to replace the local Runtime.

## Sessions and turns

| Capability | Public access | Stability | DroidVisX status | Decision |
| --- | --- | --- | --- | --- |
| Create local session | `createSession()` | Node stable | Wired | Keep |
| Resume local session | `resumeSession(id)` | Node stable | Wired | Keep |
| List local sessions | `listSessions()` | Node stable | Wired | Keep bounded/cwd scoped |
| Load raw session response | `DroidClient.loadSession()` | Exported low-level | Wired for bounded history | Keep adapter; never parse files |
| Daemon list/open/search | `sessions.list`, `listOpened`, `search` | Daemon stable | Not wired | Later session module |
| Daemon history | `sessions.getMessages` | Daemon stable | Not wired | Alternative only after daemon auth |
| Rename | `DroidSession.rename`, `sessions.rename` | Stable | Not wired | Later mutation slice |
| Archive/unarchive | `sessions.archive`, `unarchive` | Daemon stable | Not wired | Daemon-only |
| Stream one turn | `DroidSession.stream()` | Node stable | Wired | Core path |
| Interrupt active turn | `DroidSession.interrupt()` | Node stable | Wired | Keep |
| Concurrent active turns | Separate daemon sessions | Daemon stable | Not wired | Current controller intentionally owns one active Runtime |
| Fork | `DroidSession.fork`, `sessions.fork` | Stable | Not wired | Replacement/recovery slice |
| Compact | `DroidSession.compact`, `sessions.compact` | Stable | Not wired | Replacement/recovery slice |
| Rewind | `getRewindInfo`, `rewind` | Stable | Not wired | Requires reviewed file-change UI |
| Queued messages | Daemon session queue operations | Daemon stable | Not wired | Later |
| Title/CWD notifications | Stream/raw notifications | Node stable | Ignored | Do not imply until projected |

Node replacement operations retire the source high-level handle. Daemon
replacement operations return a new session ID and leave the source handle
usable. That difference must remain explicit in any future product contract.

## Settings, models, and Context

| Capability | Public access | Stability | DroidVisX status | Decision |
| --- | --- | --- | --- | --- |
| Live settings read | `DroidSession.settings` | Node stable | Wired | Host rereads authoritative value after mutations |
| Interaction mode | `updateSettings`, `enterSpecMode` | Node stable | Wired | Auto/spec/mission |
| Model selection | `updateSettings({modelId})` | Node stable | Wired for captured BYOK catalog | Never hard-code closed model enum |
| Reasoning effort | `updateSettings` | Node stable | Wired | Validate against selected model support |
| Autonomy | `updateSettings` | Node stable | Wired | Runtime safeguards remain authoritative |
| Available model startup metadata | init/load `availableModels` | Exported schema on stable responses | Wired through transport capture | Filtered to custom/BYOK UI |
| Context stats | `DroidSession.getContextStats()` | Node stable | Partial | Limit usable; cumulative totals not a meter |
| Context Breakdown | `DroidClient.getContextBreakdown()` | Exported low-level | Proven, not wired | Use only reviewed fields |
| Daemon Context Breakdown | `sessions.getContextBreakdown(id)` | Daemon stable | Not wired | Future daemon route |
| Last-call token notification | `DroidSession.onNotification()` plus exported schema | Node stable/raw | Proven, not wired | Preferred live numerator |
| Cumulative token stream | `token_usage_update` | Node stable | Ignored | Never render as current fullness |
| Custom model management | `customModels` | Daemon stable | Not wired | Later settings module |
| Default settings | `settings.getDefaults/updateDefaults` | Daemon stable | Not wired | Session settings remain current scope |

The installed schema's `lastCallTokenUsage` comment explicitly says it drives
the context/compaction meter. The high-level partial stream drops this field,
so `token_usage_update` alone cannot power the meter. See
[02-sdk-api-event-schema-map.md](02-sdk-api-event-schema-map.md).

## Streaming output and lifecycle signals

| Signal | SDK stream support | DroidVisX status | Product interpretation |
| --- | --- | --- | --- |
| Assistant text delta | Typed partial event | Wired | Append in chronological turn order |
| Thinking text delta/complete | Typed partial event | Wired | One or more bounded reasoning parts |
| Tool call/delta | Typed event | Wired, metadata-minimal | Start/update one activity by `toolUseId` |
| Tool progress | Typed event with rich update schema | Partial | Only lifecycle/count/kind currently crosses Bridge |
| Tool result | Typed event | Wired, result hidden | Terminal completed/failed state |
| Working state | Typed event | Wired | Persistent active-turn feedback |
| Token usage | Typed partial event | Intentionally ignored | Cumulative accounting, not Context ratio |
| Permission resolved | Typed event | Interaction settlement is wired separately | Do not double-settle |
| Settings updated | Typed event | Wired as authoritative reread trigger | No optimistic authority |
| Session title updated | Typed event | Ignored | Future catalog freshness |
| Session CWD changed | Typed event | Ignored | Workspace authority remains Host |
| MCP status/auth | Typed events | Ignored | No UI claim |
| Mission state/features/progress/heartbeat/workers | Typed events | Ignored | No Mission dashboard claim |
| Hook execution | Typed event | Ignored | Configuration-owned feature |
| Structured output | Typed event/result | Ignored | No structured renderer |
| Error | Typed event | Safely normalized | Fixed Host diagnostics only |
| Final result | Typed event | Wired | Success/interrupted/execution error terminal state |

## Permissions and elicitation

Installed permission confirmation categories:

1. Edit
2. Execute
3. Create
4. AskUser
5. ExitSpecMode
6. ProposeMission
7. StartMissionRun
8. ApplyPatch
9. MCP Tool
10. Sandbox Violation
11. Droid Shield Violation

Installed outcomes include one-time approval, persistent path/tool/server
approval, autonomy/session scopes, same-session and new-session plan approval,
edited-plan approval, and cancellation. DroidVisX projects the exact options
supplied by the Runtime and validates the selected option by exact value. It
does not invent “allow” outcomes.

| Capability | Public access | DroidVisX status |
| --- | --- | --- |
| Permission handler | Node and daemon session handlers | Wired |
| AskUser handler | Node and daemon session handlers | Wired |
| Multiple-choice AskUser | Typed questions/options | Wired |
| Multi-select AskUser | Question semantics plus bounded response | Wired |
| Custom/open answer | Typed response | Wired |
| Edited spec approval | Permission option plus editable content | Wired |
| Queued interactions | Host coordinator | Wired and bounded |
| No handler behavior | SDK cancels/declines | Understood; production supplies handlers |

## Tools, terminal, files, and Git

| Capability | Public access | Stability | DroidVisX status |
| --- | --- | --- | --- |
| Tool execution through agent | Session stream | Node stable | Wired |
| Tool inventory | `DroidSession.listTools()` | Node stable | Probe only |
| Disable selected tools | `disabledToolIds` | Node stable | Not wired |
| Restrictive allowlist | No public Node session allowlist | Unsupported | Do not invent |
| Rich Tool progress | `ToolProgressUpdate` | Typed schema | Partial/safely reduced |
| Terminal lifecycle | `terminals.create/write/resize/close/list` | Daemon stable | Not wired |
| Terminal serialized/restoration state | Exported daemon controller state | Low-level/host-oriented | Not wired |
| Workspace list/search/read | `workspace` resource | Daemon stable | Not wired |
| Git diff/branch/commit/push/PR | `git` resource | Daemon stable | Not wired |
| Background process resource | No dedicated stable facade established | Unresolved | Blocked |
| Worktree on session create | Daemon create options; CLI flags | Stable/CLI | Not wired |
| Worktree lifecycle manager | No dedicated stable resource established | Unresolved | Blocked |

Tool progress can contain:

- `type`: tool call, tool result, error, status, or message
- `toolName`, `status`, `details`, `text`, `error`, `timestamp`
- `parameters`
- `valueSnippet`
- `terminalId`
- `fullOutput`
- `subagentSessionId`

The last seven categories can reveal user content, paths, commands, output, or
cross-session identifiers. The two-hour slice keeps them Host-only. A later
terminal/output feature needs field-specific redaction, size limits, retention,
copy behavior, accessibility, and explicit acceptance.

## Skills, MCP, custom Droids, commands, plugins

| Capability | Public access | Stability | DroidVisX status |
| --- | --- | --- | --- |
| List Skills | `listSkills`, `skills.list` | Stable | Probe only |
| Enable/disable Skill | `setSkillDisabled`, `skills.setDisabled` | Stable | Not wired |
| SDK in-process MCP Tool | `createSdkMcpServer`, `tool` | Node stable | Not used |
| MCP servers/tools list | Node session and daemon `mcp` resource | Stable | Probe only |
| MCP add/remove/toggle/auth | Node session and daemon resource | Stable | Not wired |
| MCP resources/prompts | No supported contract established | Unresolved | Blocked |
| Commands list | Daemon `commands.list`; CLI/config files | Stable daemon | Not wired |
| Custom Droids | Configuration and CLI behavior | Config only | Not wired |
| Plugins | Daemon `plugins` resource | Stable | Not wired |
| Marketplaces | Daemon `marketplaces` resource | Stable | Not wired |

## Spec and Mission

| Capability | Public access | Stability | DroidVisX status |
| --- | --- | --- | --- |
| Enter/start Spec | Node settings/`enterSpecMode`, CLI | Stable | Mode selector wired |
| Exit Spec permission | Permission handler | Stable | Wired |
| Same-session implementation | Permission outcome | Stable | Wired at settlement boundary |
| New-session Spec handoff ID | Raw notification inspection required | Limitation | Not productized |
| Mission interaction mode | Session setting/CLI | Stable | Mode selector wired |
| Mission state/events | Typed session notifications | Stable | Ignored |
| Mission orchestration CLI | `droid exec --mission` | CLI | Not Host API |
| Mission readiness | `unstable.missions` | Daemon unstable | Not wired |
| Mission lifecycle controller | No complete stable facade established | Unresolved | Blocked |

The user must run `/missions` to enter the Factory Mission workflow. Selecting
Mission as a session setting is not evidence that DroidVisX owns Mission
creation, orchestration, worker control, or progress persistence.

## Attachments and structured output

| Capability | Public access | DroidVisX status |
| --- | --- | --- |
| Images | `MessageOptions.images` | Runtime supported, no UI |
| Text/PDF documents | `MessageOptions.files` | Runtime supported, no UI |
| Structured JSON output | `outputFormat` plus stream/result events | Runtime supported, no UI |

The SDK reference documents JPEG, PNG, GIF, WebP, text, and PDF inputs. Before
adding attachments, DroidVisX needs VS Code URI handling, explicit size/type
limits, no Webview file access, Host-side encoding, cancellation, previews,
and recovery semantics.

## Daemon resource map

Stable namespaces:

- `sessions`
- `workspace`
- `settings`
- `customModels`
- `ssh`
- `updates`
- `relay`
- `terminals`
- `mcp`
- `skills`
- `commands`
- `plugins`
- `marketplaces`
- `automations`
- `git`
- `feedback`

Unstable namespaces:

- `crons`
- `missions`
- `semanticDiff`
- `fileTransfers`
- `proxy`
- `softwareFactory`

No daemon feature should be mixed into the current local Runtime opportunistically.
Adopting the daemon is a separate Host architecture and credential-lifecycle
decision.

## CLI surface

The installed CLI exposes:

- Interactive Droid with initial prompt, resume, fork, cwd, worktree, autonomy,
  Spec, and built-in-Skill controls.
- `droid exec` text, JSON, stream-JSON, and stream-JSONRPC operation.
- Session resume/fork, model/reasoning, Spec/Mission, tool controls, worktree,
  tags, autonomy, structured output, permission modes, and worker/validator
  options in headless execution.
- `droid daemon`.
- Local session `search`/`find`.
- `droid update`.
- MCP, plugin, and relay-computer management.

CLI flags are not automatically safe Extension APIs. `--skip-permissions-unsafe`
is explicitly unsuitable for the normal local extension.

## Observability and diagnostics

| Capability | Public access | DroidVisX status |
| --- | --- | --- |
| Injected logger/metrics/tracing | Node `observability` | Wired for bounded local diagnostics |
| Feedback/bug report | Daemon `feedback` | Not wired |
| Update trigger | Daemon `updates.trigger`, CLI update | Not wired |
| Hook configuration | `.factory/hooks.json` | Config only |
| Hook stream events | Typed stream | Ignored |

Production diagnostics intentionally retain lifecycle codes, durations, counts,
and fixed classifications, not prompt content, raw output, paths, IDs,
credentials, or stack traces.

## Unsupported claims to keep out of the UI

DroidVisX must not claim any of the following until a complete slice exists:

- Current Context based on cumulative token totals.
- A Tool allowlist from Node `disabledToolIds`.
- Mission lifecycle ownership from Mission mode/events alone.
- Worktree or background-process ownership from agent Tool execution.
- MCP resources/prompts from server/tool listing.
- Account profile, billing/usage, or organization policy.
- Custom Droid management from config-file existence.
- Full terminal visibility from a `terminalId` field.
- Git/PR control from the agent's ability to call Git-related tools.

The durable 56-ID gate remains
[`docs/engineering/droid-capability-matrix.md`](../engineering/droid-capability-matrix.md).
