# Performance audit

## Executive summary

The largest immediate defect is not React component micro-optimization. The
Webview ships React's development build and unminified output. The largest
streaming defect is repeated whole-transcript work for every partial event.
Session resume also starts a temporary history subprocess before the active
Runtime subprocess.

Priority:

1. production/minified Webview
2. delta/progress coalescing
3. incremental transcript accounting
4. incremental assistant-ui mapping
5. transcript virtualization/windowing
6. duplicate-process reduction
7. CSS consolidation

## Measured bundles

In-memory esbuild analysis used the same entry points and bundle settings as
the repository build, with `write:false`.

| Output | Current bytes |
| --- | ---: |
| Webview JavaScript | 2,371,006 |
| Extension JavaScript | 1,501,817 |
| Webview CSS | 66,707 |
| Inter variable WOFF2 | 48,256 |

### Webview contributors

| Contributor | Approximate size | Share |
| --- | ---: | ---: |
| `react-dom-client.development.js` | 1,010 KB | 43.6% |
| React development build | 46 KB | 2.0% |
| `ComposerControls.tsx` | 32.6 KB | 1.4% |
| Host-message validator | 31.6 KB | 1.4% |
| assistant-ui MessageParts | 27.8 KB | 1.2% |
| `Interactions.tsx` | 23.2 KB | 1.0% |
| unified/Markdown parser modules | multiple 10-22 KB modules | material |
| `Thread.tsx` | 19.7 KB | 0.9% |
| Webview store | 15.0 KB | 0.6% |

### Extension contributors

| Contributor | Approximate size | Share |
| --- | ---: | ---: |
| Droid SDK main chunk | 384.3 KB | 26.2% |
| Droid SDK Node entry | 112.8 KB | 7.7% |
| Zod v3 | 100.5 KB | 6.9% |
| `ChatController.ts` | 53.9 KB | 3.7% |
| MCP protocol types | 51.9 KB | 3.5% |
| Zod v4 schemas | 38.0 KB | 2.6% |
| Hono Node server | 36.5 KB | 2.5% |
| MCP shared protocol | 35.1 KB | 2.4% |
| MCP server modules/AJV | multiple 15-30 KB modules | material |

The SDK breadth explains most Extension size. Do not replace public SDK imports
with private deep imports merely to shrink the bundle.

## Production-build estimate

| Configuration | Webview JS | CSS |
| --- | ---: | ---: |
| Current | 2,371,006 | 66,707 |
| `NODE_ENV=production`, unminified | 1,852,890 | 66,707 |
| Production and minified | 696,444 | 54,489 |

Webview JS reduction: **70.6%**. CSS reduction: **18.3%**.

Optional Extension minification estimate:

| Configuration | Extension JS |
| --- | ---: |
| Current | 1,501,817 |
| Minified | 691,038 |

Extension minification is lower priority because stack readability and
Extension Host activation behavior require separate review. Production React
is mandatory.

## Startup path

```text
activate extension
  → register provider/controller
  → Webview resolves
  → load recovery + list sessions in parallel
  → on resume: temporary ProcessTransport + DroidClient history load
  → close temporary process
  → active ProcessTransport + high-level session resume
  → settings/model/Context reads
  → snapshot
  → Webview parses 2.37 MB development bundle
```

### Risks

- Two sequential Droid processes on resume.
- Up to 10,000 messages and 20,000 blocks projected before activation.
- Development React parse/execute cost.
- Inter font delays first text if not cached.
- Full snapshot validation and transcript mapping on Webview readiness.

### Actions

P0:

- Production/minified Webview.
- Record activation, Runtime connect, history load/project, snapshot post,
  Webview ready, and first paint timings without content.

P1:

- Have the existing low-level history inspection also return validated initial
  last-call Context data.
- Consider a reusable bounded session-inspection process only after locking,
  cancellation, and cleanup are proven.
- Project large history incrementally or defer older history.

## Streaming hot path

For every assistant or Thinking delta:

1. SDK emits partial event.
2. Runtime normalizes it.
3. Host activity projector bounds it.
4. Host transcript scans for the target segment.
5. Growing text is concatenated and sliced.
6. Transcript array is copied.
7. Diagnostics are counted.
8. Entire transcript text usage is reduced and bounded.
9. Recovery checkpoint is scheduled.
10. Host posts one Bridge message.
11. Webview strictly validates it.
12. Reducer copies and rebounds transcript.
13. Runtime adapter scans/groups the whole transcript.
14. assistant-ui updates.
15. Markdown reparses growing text.

This is O(n)-scale transcript work per delta in both Host and Webview, plus
O(m) string copies/Markdown work for a growing message.

## Coalescing design

Batch only high-frequency, replaceable updates:

- assistant deltas for the same session/turn/segment
- Thinking deltas for the same session/turn/segment
- intermediate Tool progress for the same `toolUseId`
- nonterminal working-state repetition

Suggested interval:

- one animation frame or 16-33 ms
- maximum buffered text still respects existing per-turn bounds

Flush immediately before:

- Tool result
- Thinking complete
- turn completed/interrupted/failed
- permission or AskUser request/close
- stop/stopping state
- error/diagnostic
- session/workspace replacement
- snapshot/dispose

Maintain Bridge sequence order at flush time. Do not batch across session,
Runtime generation, or turn boundaries.

## Incremental transcript accounting

Current `trimTranscriptToLimits` repeatedly computes text units for the entire
transcript.

P1 design:

```ts
interface BoundedTranscript {
  items: readonly SessionTranscriptItem[];
  textUnits: number;
  itemTextUnits: ReadonlyMap<string, number>;
  truncated: boolean;
}
```

On append/replace:

1. subtract old item units
2. add new item units
3. evict oldest items while item/text budgets are exceeded
4. update cached totals

Keep the existing pure full-bound function for hostile snapshots and tests.
Use incremental accounting only in trusted internal state.

## Incremental assistant-ui mapping

Current:

```ts
mapTranscriptToRuntimeMessages(state.transcript, state.turn)
```

rebuilds every assistant-ui message for each event.

P1 options:

- Store already-grouped Runtime messages in the reducer.
- Memoize by stable transcript item identity and recompute only the affected
  turn.
- Split turn status from transcript data so a status change does not remap
  unrelated messages.

Acceptance:

- One delta changes the active assistant message and no earlier message object.
- A Tool progress update changes only its containing assistant message.
- Session switch replaces all messages atomically.
- History reconciliation remains chronological.

## Rendering and virtualization

Current transcript limit of 2,000 items can still mount hundreds or thousands
of React/Markdown nodes.

P1/P2:

- Window old completed messages.
- Keep active turn and a measured viewport overscan mounted.
- Preserve assistant-ui scroll anchors and Scroll to Bottom.
- Provide an accessible way to reach older history.
- Avoid virtualization until variable-height Thinking/Markdown/interaction
  behavior is tested.

Do not simply lower safety limits as a performance fix; that silently removes
valid history.

## Markdown

Risks:

- growing text reparses repeatedly
- GFM/unified dependency weight
- long code/list/table blocks

Actions:

- Ensure completed blocks retain stable message/part identity.
- Keep memoized Markdown components.
- Consider parsing the active block at a coarser text flush cadence.
- Gate syntax highlighting, Mermaid, and other heavy renderers until measured.

## Sessions and recovery

Current:

- session catalog UI bounded at 50
- recovery bounded at 8 sessions
- persistence debounce 250 ms
- transcript 2,000 items / 1,000,000 UTF-16 units
- history projection 10,000 messages / 20,000 blocks

Risks:

- catalog list is rescanned for search/filter, acceptable at 50
- large resume projection blocks activation
- recovery snapshots may repeat full transcript accounting
- temporary history process increases latency and memory

Actions:

- Instrument before changing limits.
- Merge initial history and Context inspection.
- Add cancellation/deadline to inspection calls.
- Preserve partial/unavailable status when projection is cut.

## CSS

`styles.css` is about 3,800 lines and contains multiple historical token and
override layers. The build analysis attributes essentially all 65 KB of
unminified CSS to this file.

Risks:

- specificity escalation
- duplicated tokens
- hard-to-predict narrow/high-contrast behavior
- slower review and accidental regressions

Do not rewrite it during the two-hour slice. Later:

1. freeze visual regression fixtures
2. identify active selectors
3. consolidate tokens
4. group shell/thread/message/activity/composer/interaction/popover layers
5. delete superseded overrides only after measured verification

## Performance acceptance budgets

Initial engineering budgets, not user-facing guarantees:

| Scenario | Budget |
| --- | --- |
| Packaged Webview JS | < 900 KB uncompressed |
| React development markers | 0 |
| Delta Bridge flush cadence | <= 33 ms while active |
| Terminal event flush | immediate, next microtask/frame at latest |
| Webview message handling | no long task > 50 ms in normal transcript |
| 2,000-item snapshot validation | bounded, no crash |
| Session switch stale event | never rendered |
| Recovery write cadence | no more frequent than configured debounce |

Add real timing diagnostics before setting startup milliseconds. Hardware,
Cursor version, workspace size, session size, CLI startup, and model state all
affect absolute latency.

## Validation matrix

| Scenario | What to measure |
| --- | --- |
| Empty new session | activation to interactive Composer |
| 50-session catalog | catalog ready and filter responsiveness |
| Large saved session | history load, projection, first usable UI |
| 10,000 small deltas | Host CPU, Bridge count, Webview commits |
| One 200,000-char response | string/Markdown cost and truncation |
| 100 Tools/turn | lifecycle correctness and row update cost |
| Permission during streaming | immediate flush and focus |
| User scrolled upward | no forced auto-scroll |
| Stop during Tool | immediate stopping and terminal cleanup |
| Workspace switch mid-read | cancellation and stale isolation |
