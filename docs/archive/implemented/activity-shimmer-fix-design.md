# Activity Shimmer Fix — Design

Status: **implemented, archived**（活动 shimmer 打磨已于 2026-08-11
落地，见 `implementation-status.md`「V1 前已完成」）. Diagnosed
2026-08-11 against the working tree of that day; line numbers
reference that state.

## Problem

During one turn, every tool activity row whose status is `running`
shows the "Working" label with the `dvx-activity-shimmer` animation
(`styles.css:1211-1236`, bound via `.dvx-activity-running`). A real
screenshot showed three rows (TodoWrite plan update, Read, Execute)
shimmering simultaneously while Execute was blocked on a pending
permission request. Three synchronized shimmers read as noise, and the
animation claims progress while Droid is actually waiting on the user.

## 1. Status timing through the event chain

Chain: SDK stream event → `normalizeSdkEvent.ts` → Runtime event →
Host `turnActivityState.ts` → `tool.activity` Bridge message →
Host transcript (`hostTranscriptState.ts`) + Webview `store.ts` →
`runtimeAdapter.ts` part metadata → `Thread.tsx` row class.

- `tool_call` / `tool_call_delta` SDK events become `tool-start`
  (`normalizeSdkEvent.ts:46-76`); `tool_result` becomes `tool-result`
  carrying `isError` (`normalizeSdkEvent.ts:90-102`). `tool_progress`
  becomes `tool-progress` (`normalizeSdkEvent.ts:78-88`).
- `projectToolEvent` creates a new entry with status `running`
  (`turnActivityState.ts:212-230`) and flips it to
  `completed`/`failed` **only** on a `tool-result` event
  (`turnActivityState.ts:196-205`). `tool-progress` keeps `running`
  (`turnActivityState.ts:151-167`); nothing else changes status.
- The host transcript stores the projected status verbatim
  (`hostTranscriptState.ts:347-420`) and only rewrites running rows on
  turn-level transitions: `stopping`/terminal turn state maps running →
  `stopping`/`stopped` (`hostTranscriptState.ts:200-216, 452-482`).
- The webview mirror does the same: `upsertTool` writes the incoming
  status (`store.ts:779-850`), `finalizeActivities` closes running rows
  when `turn.state` goes terminal (`store.ts:875-906`),
  `markActivitiesStopping` handles user Stop (`store.ts:852-873`).
- `Thread.tsx` derives `running = activity.status === 'running'`
  (`Thread.tsx:1644`) and adds `dvx-activity-running`
  (`Thread.tsx:1646-1649`), which activates the shimmer.

**Answer 1 — completion trigger.** Mid-turn, the only event that moves
a tool row out of `running` is the SDK `tool_result` for that
`toolUseId` (→ `completed`, or `failed` when `isError`). Otherwise the
row stays `running` until the turn itself stops or reaches a terminal
state.

**Answer 2 — during a pending interaction.** `interaction.request`
only appends to `state.interactions` (`store.ts:578-599`); it never
touches tool statuses. So every tool that has started but has no
`tool_result` yet remains `running`, and all of its rows shimmer while
the permission dialog waits. That is exactly the screenshot.

## 2. SDK batching evidence

- One assistant message can carry N `tool_use` blocks. The SDK's
  `create_message` conversion emits one `ToolCall` stream event per
  block in a single batch
  (`@factory/droid-sdk dist/chunk-5UXINOXG.mjs:8650-8662`), so N rows
  can appear as `running` at once.
- `tool_result` stream events are per tool
  (`chunk-5UXINOXG.mjs:8615-8622`), but the persisted history batches
  them: a probe over a real DroidVisX session
  (`artifacts/probe-shimmer-tool-result-batching.mjs`, run against
  `~/.factory/sessions/.../7856c5c2-….jsonl`) found **9 of 9**
  assistant messages with ≥2 `tool_use` blocks received all of their
  `tool_result` blocks in exactly one following user message; results
  were never split.
- Permission requests gate batches, not single tools:
  `RequestPermissionRequestParamsSchema.toolUses` is an array
  (`chunk-5UXINOXG.mjs:3230-3234`), `PendingPermission.toolUses` is an
  array (`dist/index-D_SzTnFR.d.ts:111993-112005`), and
  `PermissionResolved.toolUseIds` is `string[]`
  (`index-D_SzTnFR.d.ts:105980-105985`).

**Conclusion.** Results for a same-message tool batch settle together,
and a pending `droid.request_permission` blocks the batch before its
results are delivered. While the permission is pending, sibling tools
that already ran have no `tool_result` yet, so their rows legitimately
report `running`. The state machine is correct; the presentation
(three synchronized shimmers) is what needs fixing.

Caveat: `~/.factory/logs/droid-log-single.log` is metrics-only (no
notification trace), so the streaming interleaving during a pending
permission is inferred from the schemas, the persisted history, and
the observed UI rather than from a raw event trace.

## 3. Fix design (not implemented)

All rows of a turn render as sibling parts inside one
`.dvx-message-assistant`, because `mapTranscriptToRuntimeMessages`
groups a turn's items into a single assistant message
(`runtimeAdapter.ts:197-231, 289-294`). That makes (a) and (b) pure
CSS.

### a) At most one shimmering row per turn

Keep `dvx-activity-running` semantics unchanged; statically style any
running row that is followed by another running sibling. Chromium in
the VS Code webview supports `:has()`.

```css
/* Only the newest running row animates; earlier ones stay static. */
.dvx-activity-running:has(~ .dvx-activity-running) .dvx-tool-action {
  animation: none;
  background: none;
  color: var(--dvx-muted);
}
```

The static rows keep their "Working" state text
(`Thread.tsx:1767-1778`), so they still read as in progress.

Fallback if `:has()` is ever rejected: compute "is latest running"
inside `ToolActivityRow` from aui message state and emit an extra
class; costs a re-render per tool event and new unit tests.

### b) No shimmer while an interaction is pending

The thread root already gets `dvx-thread-pending` when
`interactionPending` is true (`Thread.tsx:196-200`, fed by
`hasInteraction`, `App.tsx:124, 597`). Add:

```css
.dvx-thread-pending .dvx-activity-running .dvx-tool-action {
  animation: none;
  background: none;
  color: var(--dvx-muted);
}
```

No TSX change. Note the "Droid is working" pending row is already
hidden during interactions (`showPending = active && !hasInteraction`,
`App.tsx:561`), so this rule completes the "everything goes calm while
Droid waits on you" story.

### c) Shimmer on the "Droid is working" status text

Render point: `PendingResponse` in `Thread.tsx:777-794` (the only
place that renders "Droid is working" / "Droid is responding"). Plan:

1. Extract the gradient text treatment from
   `.dvx-activity-running .dvx-tool-action` (`styles.css:1222-1236`)
   into a shared `.dvx-shimmer-text` class; keep the existing selector
   composing it so tool rows are unchanged.
2. In `PendingResponse`, wrap the label in
   `<span className="dvx-shimmer-text">…</span>` (keep the
   `dvx-runtime-pulse` dot as is).

Rules (a)/(b) target `.dvx-activity-running` specifically, so they do
not suppress this status shimmer; it disappears during interactions
anyway via `showPending`.

## Files to change and test points

Files:

- `src/webview/assistant/styles.css` — rules (a), (b); extract
  `.dvx-shimmer-text` for (c).
- `src/webview/assistant/Thread.tsx` — `PendingResponse` label span
  only.
- `docs/product/implementation-status.md` — record the slice when
  implemented.

No Runtime, Host, Bridge, or store changes; existing
`turnActivityState.test.ts` / `store.test.ts` behavior is untouched.

Test points (visible verification in the packaged webview, per repo
delivery rules):

1. Multi-tool batch mid-turn: several rows show "Working", only the
   last running row animates (verify via `getComputedStyle(...).animationName`,
   not class names, since (a) is CSS-only).
2. Trigger a permission request: no row animates while the
   interaction panel is open; statuses still read "Working"; resolving
   the permission resumes exactly one shimmer.
3. Thinking phase with no interaction: "Droid is working" text
   shimmers; it disappears when the interaction panel opens.
4. `prefers-reduced-motion`: global kill switch at
   `styles.css:3742-3747` already neutralizes the animation — confirm
   it covers the new `.dvx-shimmer-text`.
5. High-contrast: forced-colors block at `styles.css:1374-1385` is
   unaffected; spot-check gradient text remains readable (background-
   clip text falls back to `color` when unsupported).
