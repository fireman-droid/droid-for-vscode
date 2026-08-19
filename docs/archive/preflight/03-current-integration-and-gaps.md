# Current integration and gaps

## Production topology

```text
Cursor Webview View
  └─ DroidViewProvider
      └─ ChatController
          ├─ one active DroidRuntime
          │   └─ FactoryDroidRuntime
          │       └─ high-level DroidSession
          │           └─ cwd-scoped ProcessTransport
          ├─ SessionCatalog
          ├─ SessionHistoryLoader
          │   └─ temporary low-level DroidClient + ProcessTransport
          ├─ SessionRecoveryStore
          ├─ PendingInteractionCoordinator
          └─ LocalDiagnostics

HostToWebview Bridge v2
  └─ hostile-safe validator
      └─ reducer/store
          └─ useExternalStoreRuntime
              └─ assistant-ui Thread/Message/Composer primitives
```

One `ChatController` owns one active Runtime. It keeps stale runtimes in a
managed set until bounded closure completes, so workspace/session transitions
do not silently abandon subprocesses.

## Startup and activation flow

1. Extension determines a trusted, usable workspace.
2. Recovery state and the cwd-scoped session catalog load in parallel.
3. Controller chooses the recovery-selected or catalog-selected session.
4. On resume, history is loaded and projected before the active high-level
   Runtime is created.
5. A new or resumed Runtime starts through `ProcessTransport`.
6. Settings, custom/BYOK model catalog, and Context metadata load.
7. Host emits a complete snapshot after Webview readiness, then sequenced
   incremental messages.

### Gap

Resume currently starts a temporary Droid subprocess for history and then a
second subprocess for the active Runtime. The order avoids simultaneous
history loading and active ownership, but it adds startup cost.

## Turn flow

```text
Composer submit
  → strict WebviewToHost validation
  → optimistic user transcript item
  → Runtime.sendTurn()
  → DroidSession.stream(includePartialMessages: true)
  → normalizeSdkEvent()
  → ChatController.handleRuntimeEvent()
  → activity projection + Host transcript
  → Bridge message
  → Webview validation
  → reducer transcript
  → full transcript-to-assistant-ui mapping
  → MessagePrimitive parts
```

Terminal outcomes are explicit:

- success → completed
- interrupted/stop → interrupted/stopped
- execution error → failed
- stream throw/no terminal result → safe fixed error

### Gap

Every SDK partial event passes through every layer independently. There is no
Bridge delta batch or postMessage coalescing.

## Source-of-truth table

| State | Authority | Current path | Notes |
| --- | --- | --- | --- |
| Active session ID | Runtime/Host | Controller activation | Webview cannot choose arbitrary hidden IDs |
| CWD/workspace | VS Code Host + persisted Droid session validation | Workspace context and Runtime target | Workspace changes retire old Runtime |
| Session list | SDK `listSessions` | `FactorySessionCatalog` | Bounded to 50 UI rows |
| History | Low-level SDK load response | `FactorySessionHistoryLoader` | No session-file parsing |
| Assistant/Thinking | SDK stream | Runtime → Host transcript | Bounded |
| Tool lifecycle | SDK stream | Safe semantic projection | Raw payload hidden |
| Permission/AskUser | SDK handlers | Host coordinator | Exact-option, settle-once |
| Settings | `DroidSession.settings` after SDK mutation | Runtime reread | No optimistic authority |
| Model catalog | init/load response | capture transport | Custom/BYOK entries only |
| Context budget | SDK Context response | Current `getContextStats` | Limit usable |
| Context numerator | Latest provider last-call usage | Not wired | Current UI falls back unavailable when totals exceed limit |
| Recovery | Extension global state | `SessionRecoveryStore` | 8 sessions, 250 ms debounce |
| Diagnostics | Host local files/output | `LocalDiagnostics` | Content-minimal |

## Runtime layer

### `src/runtime/FactoryDroidRuntime.ts`

Current responsibilities:

- Initializes one new or resumed SDK session.
- Classifies missing CLI, invalid CWD, connection, and generic availability.
- Streams partial events.
- Interrupts and closes.
- Reads and updates settings.
- Reads Context Stats.
- Reads the captured model catalog.
- Emits content-minimal observability.

Strengths:

- Runtime DTOs isolate SDK types from the Bridge.
- CWD/session target reuse is explicit.
- Setting mutation rereads authoritative `session.settings`.
- Context validation accepts SDK-valid cumulative totals instead of inventing
  arithmetic.

Gaps:

- Context uses `getContextStats` and has no last-call cache.
- `FactoryDroidSession` omits public `onNotification`.
- Stream normalizer ignores many typed signals.
- Broad SDK bundle is pulled into Extension output.

### `src/runtime/modelCatalogCaptureTransport.ts`

Current responsibilities:

- Correlates initialize/load request IDs.
- Validates response envelopes with exported SDK schemas.
- Captures `availableModels`.
- Forwards all transport messages unchanged.

Approved Context seam:

- Capture validated `lastCallTokenUsage` from the load response when resuming.
- Do not copy raw messages or introduce a generic response tap.

### `src/runtime/normalizeSdkEvent.ts`

Currently projects:

- assistant delta
- Thinking delta/complete
- Tool start/progress/result
- working state
- settings-updated signal
- generic error
- final result

Currently ignores:

- cumulative token update
- title/CWD
- MCP
- Mission
- hooks
- structured output
- permission-resolved stream event

This selectivity is intentional. Add events only for an active product slice.

### `src/runtime/runtimeInteractions.ts`

Current responsibilities:

- Projects every installed permission category.
- Bounds tools/options/details.
- Maps AskUser questions/options.
- Returns only an option supplied by the Runtime.
- Supports edited Spec approval.

Gap:

- No major correctness gap identified for the two-hour slice. Keep stable.

## Extension Host layer

### `src/extension/ChatController.ts`

Current responsibilities:

- Runtime/session/workspace generations.
- Startup and replacement.
- History/recovery reconciliation.
- Turn state machine.
- Tool/Thinking projection.
- Context/settings/model metadata refresh.
- Bridge sequence generation.
- Interaction settlement.
- Diagnostics and recovery checkpointing.

Strengths:

- Stale Runtime/session/CWD/turn responses are rejected.
- Context refresh has its own request generation.
- Failed Context refresh retains the last confirmed value.
- Terminal turns trigger metadata refresh.
- One active turn prevents concurrent stream corruption.

Gaps:

- Very large controller, about 53.9 KB in the unminified bundle analysis.
- Every partial event performs transcript work and emits immediately.
- Context state does not encode source, freshness, or explicit availability.
- Context refresh cannot currently read the last-call meter.

### `src/extension/hostTranscriptState.ts`

Current behavior:

- Finds the last item in a turn for assistant/Thinking continuation.
- Rebuilds arrays for replacement.
- Bounds every update with `trimTranscriptToLimits`.
- Limits diagnostics separately.

Measured complexity:

- `findLastTurnItemIndex`: transcript scan.
- string concatenation/slice: proportional to accumulated part length.
- array copy on replacement: transcript length.
- `trimTranscriptToLimits`: text-unit scan and potential slice.

This produces O(n)-scale Host work per delta, plus growing string-copy cost.

### `src/extension/turnActivityState.ts`

Current behavior:

- Bounds assistant text at 200,000 UTF-16 units.
- Bounds Thinking at 32,000.
- Bounds 100 Tool activities per turn.
- Bounds progress updates per Tool.
- Enforces monotonic running → terminal lifecycle.

Gap:

- No elapsed timing.
- No progress coalescing.
- Rich SDK progress is intentionally reduced to kind/count.

### `src/extension/DroidViewProvider.ts`

Current behavior:

- Posts every Host message directly to the Webview.

Gap:

- No animation-frame/time-window batching.
- Promise failures are intentionally ignored, so delivery diagnostics are
  minimal.

### `src/extension/SessionRecoveryStore.ts`

Current behavior:

- Up to 8 sessions.
- Shared transcript limits.
- 250 ms persistence debounce.
- Revision-aware flush and bounded total text.

Gap:

- A streaming turn still schedules regular full recovery projection/checkpoint
  work. The debounce protects persistence I/O, not all in-memory scans.

## Shared Bridge layer

### `src/shared/bridgeMessages.ts`

Current contracts:

- strict version 2 protocol
- connection and turn state
- sessions/history
- settings/context/model catalog
- assistant/Thinking/Tool transcript
- diagnostics
- Permission/AskUser

Context today:

```ts
{
  used: number;
  remaining: number;
  limit: number;
  accuracy: 'exact' | 'estimated';
}
```

Gap:

- It cannot distinguish cumulative totals from current-window meter data.
- It has no explicit unavailable reason, source, observation time, or stale
  marker.

### `src/shared/transcriptLimits.ts`

Limits:

- 2,000 transcript items
- 1,000,000 UTF-16 text units

Gap:

- `transcriptTextUnits()` reduces the entire transcript.
- Bounding scans from oldest to newest on every call.
- Host and Webview both repeat the work.

## Webview layer

### `src/webview/bridge/validateHostMessage.ts`

Strengths:

- Strict exact-key parsing.
- Safe integers, bounded strings, enum membership, array limits.
- Defensive handling for accessors, proxies, and hostile nesting.
- Session/turn/transcript coherence checks.

Context validation correctly does **not** impose SDK-unsupported arithmetic.

Gap:

- New explicit Context availability/source states require contract and hostile
  input tests.

### `src/webview/assistant/store.ts`

Current behavior:

- Immutable reducer.
- Sequence and session isolation.
- Optimistic user send.
- Tool/Thinking/transcript projection.
- Rebounds transcript after updates.

Gap:

- Array copy and full transcript bound for every incremental event.
- Host has already bounded the same data.

### `src/webview/assistant/runtimeAdapter.ts`

Current behavior:

```ts
const messages = useMemo(
  () => mapTranscriptToRuntimeMessages(state.transcript, state.turn),
  [state.transcript, state.turn],
);
```

The mapper groups the entire transcript into assistant-ui messages whenever
the transcript or turn state changes.

Gap:

- Full O(n) regroup/remap per stream event.
- Adapter is recreated from broad `state`.
- Long transcripts amplify React and assistant-ui updates.

### `src/webview/assistant/Thread.tsx`

Current visible behavior:

- assistant-ui Thread/Viewport/Messages/Composer primitives.
- user bubble plus Copy/Reuse.
- Markdown assistant text.
- expandable Thinking and Tool activity rows.
- persistent pending row.
- stop/retry/send.
- inline interaction panel.

Gaps:

- One global Thinking expanded state affects all assistant messages.
- Tool details use technical “Lifecycle” and update-kind copy.
- Tool row has no elapsed duration.
- All messages remain mounted; no transcript windowing.
- Scroll behavior has not been performance-tested against the maximum
  transcript.

### `src/webview/assistant/MarkdownText.tsx`

Current behavior:

- `@assistant-ui/react-markdown`
- React Markdown/GFM
- safe links
- memoized components
- streaming smoothing

Gap:

- Every growing assistant text can trigger repeated Markdown parsing.
- No code-specific activity/diff renderer.
- No completed-block-only memoization measurement.

### `src/webview/assistant/ComposerControls.tsx`

Current behavior:

- Session controls.
- mode/autonomy.
- custom/BYOK model and reasoning.
- Context popover/refresh.
- truthful unavailable state when totals exceed limit.

Gaps:

- Settings “Skills” and “MCP servers” rows display static “None”; they must not
  be mistaken for live discovery.
- Context lacks last-call source/freshness.
- Multiple large popover implementations make the component about 32.6 KB in
  unminified source contribution.

### `src/webview/assistant/Interactions.tsx`

Current behavior:

- Permission categories and tools.
- split-button supplied outcomes.
- edited plan.
- Markdown plan preview.
- AskUser single/multi/custom answers.
- settle-once busy state.

Gap:

- No two-hour-slice changes justified unless visible verification finds a
  regression.

## Build and package

### `esbuild.mjs`

Current:

- Webview and Extension bundled.
- no minification
- no explicit production `process.env.NODE_ENV`
- Inter variable font bundled as an asset

Measured current outputs:

| Artifact | Bytes |
| --- | ---: |
| Webview JS | 2,371,006 |
| Extension JS | 1,501,817 |
| Webview CSS | 66,707 |
| Inter WOFF2 | 48,256 |

Largest Webview contributor:

- `react-dom-client.development.js`: about 1,010 KB, 43.6%.

Largest Extension contributors:

- Droid SDK chunk: about 384 KB.
- Droid SDK Node entry: about 113 KB.
- Zod v3: about 101 KB.
- MCP types/server packages, Hono, AJV, and Zod v4 are also bundled.

Production/minified in-memory Webview estimate:

- JS: 696,444 bytes.
- CSS: 54,489 bytes.

This is the lowest-risk measured startup/parse improvement.

### `package.json`

Current contribution:

- Activity Bar View Container.
- Webview view.
- Open Chat and Open Logs commands.

Product gap:

- The intended entry is Cursor's Secondary Sidebar. VS Code added
  `viewsContainers.secondarySidebar` in the 1.106 generation, but the manifest
  change must be verified against Cursor and the extension engine/fallback
  policy. Do not break older compatible hosts accidentally.

## Current production-wired features

- Local SDK session create/resume.
- Session drawer and new/select/refresh.
- Bounded real history and recovery.
- Assistant and chronological Thinking text.
- Semantic Tool lifecycle.
- Stop and result state.
- Permission and AskUser.
- Live settings and custom/BYOK model catalog.
- Context read/refresh with truthful unavailable fallback.
- Markdown/GFM and safe links.
- diagnostics and logs command.
- strict Bridge v2 and hostile-input tests.

## Probe-only or evidence-only features

- Tool, Skill, and MCP inventory.
- Broad daemon resources.
- attachments.
- structured output.
- hooks.
- Mission events/lifecycle.
- terminals.
- workspace files and Git controls.
- plugins/marketplaces/automations.
- custom model management.

## Priority gaps

### P0 correctness

1. Last-call Context meter.
2. Preserve stale/current session generation rules.
3. Never leak rich Tool payload fields.
4. Keep terminal Tool states under coalescing.

### P0 performance

1. Production React/minified Webview.
2. Bridge delta/progress batching.

### P1 performance

1. Incremental transcript text accounting.
2. Incremental assistant-ui message mapping.
3. Markdown parse containment.
4. Transcript virtualization/windowing.
5. Avoid duplicate history/Context inspection processes.

### P1 product

1. Secondary Sidebar-first manifest and command behavior.
2. Human Tool lifecycle and elapsed time.
3. Explicit Context freshness/source.
4. CSS consolidation.

### P2 product modules

Continue in delivery-plan order. Do not pull later daemon-heavy features into
the two-hour slice.
