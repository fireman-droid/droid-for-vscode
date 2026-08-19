# SDK API, event, and schema map

This map records the exact installed evidence needed to implement DroidVisX
without reverse-engineering during the two-hour sprint.

## Evidence sources

| Source | Role |
| --- | --- |
| `@factory/droid-sdk` package version | `0.7.0` |
| Exported `SDK_VERSION` | SDK version authority |
| Exported `FACTORY_PROTOCOL_VERSION` | `1.151.0` |
| `docs/typescript-sdk-reference.md` | Installed user-facing reference |
| `dist/node.d.ts` | Public Node declarations |
| `dist/index-D_SzTnFR.d.ts` | Exported protocol/schema declarations |
| `dist/node.mjs` | Installed public-wrapper behavior |
| `dist/chunk-C3KHERVH.js` / `chunk-5UXINOXG.mjs` | Implementation comments and event conversion evidence |
| `examples/node` / `examples/browser` | Published runnable usage |
| `droid --help`, `droid exec --help`, `droid daemon --help` | Installed CLI contract |

Declarations are compile-time authority. Implementation comments are used only
to interpret fields that the public reference does not explain; DroidVisX
still validates all runtime values.

## Runtime imports

### Node runtime

```ts
import {
  createSession,
  resumeSession,
  listSessions,
  run,
  DroidSession,
  ProcessTransport,
  DroidClient,
} from '@factory/droid-sdk/node';
```

Use Node for the local Extension Host. The package starts the `droid` CLI from
`PATH` unless a custom transport or executable path is supplied.

### Daemon runtime

```ts
import {
  connectToDaemon,
  type ConnectedDroid,
  type ConnectedDroidSession,
} from '@factory/droid-sdk';
```

The root package is browser-safe, but daemon authentication currently uses a
Factory API key. DroidVisX must keep that credential out of Webview code, URLs,
Bridge messages, logs, and persistence.

## Public high-level Node session

Installed `DroidSession` members:

| Member | Purpose | Current use |
| --- | --- | --- |
| `id` | Session ID | Wired |
| `cwd` | Live working directory | Host-only |
| `settings` | Live read-only settings | Wired |
| `stream(prompt, options)` | One active turn | Wired with partial events |
| `interrupt()` | Stop turn | Wired |
| `updateSettings()` | Explicit settings mutation | Wired |
| `enterSpecMode()` | Switch to Spec | Not called directly |
| `listTools()` | Normalized Tool list | Probe only |
| `listSkills()` | Skill list | Probe only |
| `setSkillDisabled()` | Skill mutation | Not wired |
| MCP list/mutate/auth methods | MCP lifecycle | Probe/list only |
| `getContextStats()` | Context stats response | Wired, but totals are not a meter |
| `getRewindInfo()` / `rewind()` | File rewind replacement | Not wired |
| `compact()` | Compacted replacement | Not wired |
| `fork()` | Forked replacement | Not wired |
| `rename()` | Session title | Not wired |
| `onNotification()` | Raw notification subscription | Approved for last-call meter |
| `close()` | Close session/resources | Wired |

`DroidSession` does **not** expose `getContextBreakdown()` in SDK 0.7.0.
`DroidSession._client` is private and must not be accessed.

## Public low-level Node client

`DroidClient` is a public `/node` export intended for direct JSON-RPC
integrations. Important methods:

```ts
const client = new DroidClient({
  transport,
  requestTimeout?: number,
  observability?: DroidObservability,
});

await client.initializeSession(params);
await client.loadSession({ sessionId });
await client.addUserMessage(params);
await client.interruptSession();
await client.closeSession();
await client.updateSessionSettings(params);
await client.getContextStats();
await client.getContextBreakdown();
client.onNotification(callback, filter);
client.setPermissionHandler(handler);
client.setAskUserHandler(handler);
await client.close();
```

Low-level methods return complete JSON-RPC response envelopes. Successful
payloads are in `response.result`. This client is already used in production's
bounded history loader.

`ProcessTransport` options include:

```ts
interface ProcessTransportOptions {
  droidExecPath?: string;
  droidExecExtraArgs?: string[];
  enableIpc?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  isDevelopment?: boolean;
  forceBlockingUpdate?: boolean;
  observability?: DroidObservability;
}
```

## Context schemas and semantics

### High-level Context Stats

Documented call:

```ts
const stats = await session.getContextStats();
// stats.used, stats.remaining, stats.limit, stats.accuracy
```

Installed schema validates field types, not a cross-field invariant. Real
responses have reported `used` and `remaining` above `limit`. Production must
not impose `used + remaining === limit` or values-`<= limit` on this cumulative
response.

Approved use:

- `limit`, after safe-integer and positive validation, as model budget.
- `accuracy` for diagnostics only.

Rejected use:

- `used` as current Context.
- `remaining` as current free tokens.
- deriving a ratio or clamping either total to the budget.

### Context Breakdown

Public low-level method:

```ts
const response = await client.getContextBreakdown();
const breakdown = response.result;
```

Stable daemon equivalent:

```ts
const breakdown =
  await droid.sessions.getContextBreakdown(sessionId);
```

Installed result:

```ts
interface ContextBreakdownResult {
  modelId: string;
  modelDisplayName: string;
  contextBudget: number;
  lastCallCompactionTokens?: number;
  usedTokens: number;
  freeTokens: number;
  categories: Array<{
    name: string;
    tokens: number;
    colorKey:
      | 'systemPrompt'
      | 'systemTools'
      | 'mcpTools'
      | 'userInfo'
      | 'agentsMd'
      | 'customAgents'
      | 'skills'
      | 'messages';
  }>;
  skills: Array<{
    name: string;
    location: string;
    tokens: number;
  }>;
  mcpServers: Array<{
    name: string;
    toolCount: number;
    tokens: number;
  }>;
  droids: Array<{
    name: string;
    location: string;
    tokens: number;
  }>;
}
```

Empirical result:

- `usedTokens` and the category sum were cumulative and exceeded
  `contextBudget` by more than 70 times.
- `freeTokens` was therefore `0`.
- `lastCallCompactionTokens` remained within the budget.

Only `contextBudget` and `lastCallCompactionTokens` are approved for the
current-window meter in this SDK version. Categories must not be visualized as
the active window until Factory publishes stronger semantics.

### Last-call token usage

`session_token_usage_changed` contains:

```ts
{
  type: 'session_token_usage_changed';
  sessionId: string;
  tokenUsage: TokenUsage;          // cumulative
  inclusiveTokenUsage?: TokenUsage;
  lastCallTokenUsage?: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens?: number;
  };
}
```

The installed implementation comments:

- `lastCallTokenUsage` is the latest provider-reported usage used by the
  context/compaction meter.
- It is included in load responses so resumed sessions can display Context
  before the first new turn.

The measured relationship was:

```ts
lastCallCompactionTokens ===
  inputTokens + cacheReadTokens + (outputTokens ?? 0);
```

`cacheCreationTokens` and `thinkingTokens` are not members of the installed
last-call projection and must not be added.

### High-level stream loss

The converter maps `session_token_usage_changed` to:

```ts
{
  type: 'token_usage_update';
  inputTokens;
  outputTokens;
  cacheReadTokens;
  cacheCreationTokens;
  thinkingTokens;
}
```

It reads `notification.tokenUsage`, not `lastCallTokenUsage`. Therefore
`DroidStreamEvent` token updates are cumulative and insufficient for the
current-window meter.

## Stream event union

With `includePartialMessages: true`, the installed stream can yield:

### Content

- `assistant`
- `user`
- `assistant_text_delta`
- `assistant_text_complete`
- `thinking_text_delta`
- `thinking_text_complete`
- `structured_output`

### Tool lifecycle

- `tool_call`
- `tool_call_delta`
- `tool_progress`
- `tool_result`

### Runtime/session lifecycle

- `working_state_changed`
- `token_usage_update`
- `permission_resolved`
- `settings_updated`
- `session_title_updated`
- `session_working_directory_changed`
- `error`
- `result`

### MCP

- `mcp_status_changed`
- `mcp_auth_required`
- `mcp_auth_completed`

### Mission

- `mission_state_changed`
- `mission_features_changed`
- `mission_progress_entry`
- `mission_heartbeat`
- `mission_worker_started`
- `mission_worker_completed`

### Hooks

- `hook`

The Runtime normalizer currently handles assistant/Thinking deltas, Tool
call/progress/result, working state, settings update, generic error, and final
result. All other events are intentionally ignored and must not appear in the
UI by implication.

## Tool progress schema

```ts
interface ToolProgressUpdate {
  type: 'tool_call' | 'tool_result' | 'error' | 'status' | 'message';
  toolName?: string;
  status?: string;
  details?: string;
  text?: string;
  error?: string;
  timestamp?: number;
  parameters?: Record<string, unknown>;
  valueSnippet?: string;
  terminalId?: string;
  fullOutput?: string;
  subagentSessionId?: string;
}
```

Current production projection:

```ts
{
  toolUseId;
  toolName;
  action;             // safe Host summary based on Tool name
  status;             // running/completed/failed
  progressCount;      // bounded
  latestUpdateKind;   // enum only
}
```

Approved two-hour additions:

- Host-generated start/end timestamps or elapsed duration.
- Coalescing metadata.
- Human lifecycle labels.

Not approved without a disclosure contract:

- Any raw optional string.
- `parameters`.
- `terminalId`.
- `fullOutput`.
- `subagentSessionId`.

## Result and error schema

Final result:

```ts
{
  type: 'result';
  subtype:
    | 'success'
    | 'interrupted'
    | 'error_during_execution'
    | 'error_structured_output';
  sessionId: string;
  durationMs: number;
  tokenUsage: TokenUsage | null;
  messages: DroidStreamEvent[];
  text: string;
  turnCount: number;
  success: boolean;
  interrupted: boolean;
  structuredOutput?: unknown;
  structuredOutputError?: StructuredOutputError | null;
  error: ErrorEvent | null;
}
```

Runtime terminal states observed in exported enums additionally distinguish
cancellation, permission rejection, process exit, Spec handoff, structured
output failures, usage exhaustion, authentication failures, provider
rejection/unreachable/unavailable, and no approver. DroidVisX currently
projects only the safe result subtype and fixed diagnostics.

Main universal errors:

- `ConcurrentStreamError`
- `SessionReplacedError`
- `SessionReplacementError`
- `AbortError`
- `ConnectionClosedError`
- `JsonRpcRequestError`
- `RelayConnectionError`
- `WebSocketConnectionError`

Node-only errors:

- `DroidClientError`
- `ConnectionError`
- `TimeoutError`
- `ProtocolError`
- `SessionError`
- `SessionNotFoundError`
- `InvalidSessionCwdError`
- `ProcessExitError`

Raw error messages and stacks are not Bridge-safe by default.

## Permission request schema

The SDK supplies a request containing Tool uses and allowed outcomes.
DroidVisX must:

1. Bound and classify Tool details by confirmation category.
2. Preserve only the exact supplied options.
3. Return one supplied outcome or cancellation.
4. Return edited Spec content only when that supplied option requires it.
5. Settle once, even if UI events repeat.

Confirmation detail fields can contain:

- File paths/names and old/new/patch content.
- Execute command and risk details.
- MCP server and Tool names.
- Spec/Mission proposal text.
- Running Mission IDs.
- Sandbox/Shield violation details.

The existing Runtime projector is the security boundary for those fields. A
generic JSON renderer is forbidden.

## Session history/load response

Public low-level `loadSession({sessionId})` returns:

- persisted messages
- settings and CWD
- available models
- cumulative `tokenUsage`
- latest `lastCallTokenUsage`
- Mission and decomposition metadata when applicable
- subagent invocation summaries

Production history projects at most:

- 10,000 raw messages
- 1,000 raw blocks per message
- 20,000 total raw blocks
- then the shared 2,000-item / 1,000,000-UTF-16 transcript budget

Only recognized user, assistant, Thinking, and Tool structures become
transcript items. System reminders/notifications and unsafe payloads are
filtered.

## Stable daemon facade

The stable `sessions` facade includes:

```text
list, listOpened, create, resume, getMessages, search,
archive, unarchive, rename, updateSettings,
resolveQueuedMessage, killWorker,
getRewindInfo, rewind, compact, fork, getContextBreakdown
```

Other stable resources:

```text
workspace, settings, customModels, ssh, updates, relay,
terminals, mcp, skills, commands, plugins, marketplaces,
automations, git, feedback
```

Unstable resources:

```text
crons, missions, semanticDiff, fileTransfers, proxy,
softwareFactory
```

## Lifecycle constraints

- One high-level session handle can run one stream at a time.
- Different daemon sessions may stream concurrently.
- Do not replace a session while it has an active stream.
- Node `fork`/`compact`/`rewind` automatically load a successor and retire the
  source wrapper.
- Daemon replacements return IDs; callers explicitly resume successors.
- Closing a Node session closes owned resources.
- Detaching a daemon session leaves the server session running.
- Disconnecting a daemon retains server sessions but destroys local handles.

## Implementation checklists

### Before using a new event

- Confirm it is in the public stream or raw-notification contract.
- Decide whether it is content-bearing.
- Define Runtime DTO and maximum sizes.
- Define Host generation/session/turn rules.
- Define exact Bridge keys and hostile-input validation.
- Define recovery/history behavior.
- Add success, malformed, stale, oversized, and terminal-state tests.

### Before using a daemon method

- Confirm it is outside `unstable`, or isolate and pin it.
- Keep API-key handling Host-only.
- Define connection/disconnection and session-attachment ownership.
- Reconcile daemon replacement semantics with local Runtime semantics.
- Do not mix daemon and local ownership of one active session without a tested
  locking model.
