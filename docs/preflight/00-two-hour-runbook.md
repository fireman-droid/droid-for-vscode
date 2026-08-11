# Two-hour implementation runbook

- Prepared: **2026-08-11**
- Installed Droid CLI: **0.191.1**
- Repository SDK: **`@factory/droid-sdk` 0.7.0**
- Factory protocol: **1.151.0**
- Target surface: **Cursor Secondary Sidebar**
- Runtime boundary: **local Droid CLI through the official SDK only**

This is the controlling document for the next implementation sprint. The
supporting preflight documents contain evidence and longer-term work, but they
do not expand the two-hour scope.

## Outcome

At the end of 120 minutes, DroidVisX must provide one coherent, visibly
verified vertical slice:

1. Context fullness uses the latest provider-reported compaction-meter tokens,
   not cumulative session tokens.
2. Long-running tool activity remains visibly alive and ends in an explicit
   completed, failed, or stopped state.
3. The Webview ships with a production React build and minified output.
4. The chat surface is visibly checked in Cursor at narrow and normal
   Secondary Sidebar widths.
5. Tests, type checks, build, VSIX verification, package hash, and installed
   file hashes are reported truthfully.

This is not a commitment to implement all delivery-plan modules. Attachments,
full terminal emulation, diff viewers, Git controls, Skills/MCP management,
Mission dashboards, rewind, compact, fork, and broad CSS reconstruction are
outside this sprint.

## Non-negotiable rules

- Droid CLI and `@factory/droid-sdk` remain the only model, session, tool,
  permission, settings, and authentication authority.
- No API key, credential, raw session file, prompt, tool parameters, command,
  path, output, terminal ID, or subagent session ID crosses into the Webview
  unless a separate reviewed contract explicitly allows it.
- Do not access `DroidSession._client`, import a private SDK chunk, copy an
  internal SDK stream implementation, or parse Droid session files.
- Do not use `getContextStats().used`, cumulative `tokenUsage`, Breakdown
  `usedTokens`, Breakdown `freeTokens`, or category sums as current-window
  fullness.
- A missing, malformed, stale, or out-of-range Context numerator produces an
  unavailable meter, never a guessed percentage.
- Preserve unrelated working-tree changes. Stage and commit only files in the
  agreed slice.
- Stop feature work when a gate fails. Fix the gate or invoke the documented
  rollback.

## Evidence that controls the Context implementation

Three no-prompt, read-only probes were run through public
`DroidClient`/`ProcessTransport` calls against an existing session:

| Observation | Result |
| --- | --- |
| Breakdown budget | `250,000` |
| Breakdown cumulative `usedTokens` | More than `18,000,000` |
| Breakdown `freeTokens` | `0` |
| Breakdown category sum | Equal to cumulative `usedTokens` |
| Breakdown `lastCallCompactionTokens` | In range, between about `162,000` and `193,000` while the active session advanced |
| `loadSession().lastCallTokenUsage` | Present |
| Last-call sum | `inputTokens + cacheReadTokens + outputTokens` matched `lastCallCompactionTokens` |
| `getContextStats().limit` | Matched Breakdown `contextBudget` |

The installed SDK implementation describes `lastCallTokenUsage` as the latest
provider-reported usage used by the context/compaction meter. It is also
carried on session-load responses so resumed sessions can show Context before
their first new turn.

Therefore:

```ts
currentWindowUsed =
  lastCall.inputTokens +
  lastCall.cacheReadTokens +
  (lastCall.outputTokens ?? 0);

currentWindowRemaining = contextBudget - currentWindowUsed;
```

The ratio is usable only when both values are safe non-negative integers,
`contextBudget > 0`, and `currentWindowUsed <= contextBudget`. No other
cross-field relationship is invented.

## Approved architecture for the slice

Use public APIs already adjacent to production, without replacing the current
high-level session stream:

1. Extend the existing startup transport capture so validated load-response
   `lastCallTokenUsage`, when present on resume, is retained alongside
   `availableModels`. A new session has no last call before its first provider
   request.
2. Subscribe through public `DroidSession.onNotification()` to
   `session_token_usage_changed`. Validate the inner notification with the
   exported SDK schema and retain only the bounded last-call token sum.
3. Continue using `getContextStats()` only for its validated `limit`. Its
   `used` and `remaining` fields are diagnostic totals and must not reach the
   user-facing meter.
4. Expose a Runtime-owned DTO:

   ```ts
   interface RuntimeContextWindow {
     used: number;
     remaining: number;
     limit: number;
     source: 'last-call';
     observedAt: number;
   }
   ```

5. Change the Bridge DTO to make availability explicit. A recommended shape
   is:

   ```ts
   type SessionContextValue =
     | {
         availability: 'available';
         used: number;
         remaining: number;
         limit: number;
         source: 'last-call';
         observedAt: number;
       }
     | {
         availability: 'unavailable';
         reason: 'no-last-call' | 'invalid-last-call' | 'read-failed';
       };
   ```

6. Keep Host request generations and session/CWD checks authoritative.
7. Render available, loading-with-confirmed-value, stale/error-with-confirmed-
   value, and unavailable states without changing the numerator's meaning.

Do not start a second subprocess for every Context refresh. The existing
history loader may harvest load-time last-call usage while it already owns a
temporary low-level client, but live updates belong to the active session's
raw notification subscription.

## Minute-by-minute execution

### 00:00-00:08, establish a safe baseline

1. Run `git status --short`.
2. Record the current diff for every file that will be touched.
3. Run the focused Context and Tool tests before editing.
4. Confirm the active SDK/CLI/protocol versions.

Commands:

```powershell
git status --short
pnpm exec vitest run `
  src/runtime/FactoryDroidRuntime.test.ts `
  src/runtime/modelCatalogCaptureTransport.test.ts `
  src/extension/ChatController.test.ts `
  src/webview/bridge/validateHostMessage.test.ts `
  src/webview/assistant/ComposerControls.test.tsx `
  src/extension/turnActivityState.test.ts `
  src/webview/assistant/Thread.test.tsx
droid --version
node -p "require('./node_modules/@factory/droid-sdk/package.json').version"
```

**Gate 0:** focused tests pass before edits. If they do not, distinguish
pre-existing failures from new work before proceeding.

### 00:08-00:36, make Context truthful end to end

Change in dependency order:

1. Runtime capture and projection tests.
2. `DroidRuntime` Context DTO.
3. Bridge v2 Context value and strict Webview validator.
4. Host Context refresh state and stale-response tests.
5. Webview reducer and Composer Context states.

Required test cases:

- Cumulative totals above the model limit never produce a percentage.
- A valid last-call sum produces the expected used and remaining values.
- Output tokens are included in the numerator.
- Missing `lastCallTokenUsage` produces unavailable.
- Negative, fractional, unsafe, or over-budget last-call values produce
  unavailable.
- A stale Context response from the previous Runtime/session/CWD is ignored.
- A failed refresh retains the last confirmed meter but marks it stale/error.
- A resumed session can use validated load-time last-call usage.
- A terminal turn refresh uses the newest notification-backed value.

**Gate 1 at minute 36:** Context-focused tests pass and no production code
reads cumulative `used` as window fullness.

**Cut rule:** if public notification or load-response capture cannot be made
safe by minute 28, keep the current unavailable UI, add diagnostics, and move
on. Never use `_client` or infer a percentage from cumulative fields to save
time.

### 00:36-00:52, ship the production Webview build

Update `esbuild.mjs` so release Webview builds define
`process.env.NODE_ENV` as `"production"` and minify JS/CSS. Keep source maps
or a non-minified development path only if the repository already has an
explicit development mode.

Measured in-memory estimates:

| Output | Current | Production/minified | Reduction |
| --- | ---: | ---: | ---: |
| Webview JavaScript | 2,371,006 bytes | 696,444 bytes | 70.6% |
| Webview CSS | 66,707 bytes | 54,489 bytes | 18.3% |
| Inter font | 48,256 bytes | 48,256 bytes | none |
| Extension JavaScript, optional minification | 1,501,817 bytes | 691,038 bytes | 54.0% |

Minifying the Extension Host bundle is optional in this sprint. Production
React and Webview minification are not optional.

Add a build assertion that the packaged Webview does not contain
`react-dom-client.development.js` or React's development-build banner.

**Gate 2 at minute 52:** production Webview is below **900 KB** uncompressed
JavaScript and contains no React development bundle.

### 00:52-01:12, improve visible long-running activity

Keep the safe payload boundary. Improve the lifecycle rather than forwarding
raw outputs:

1. Add bounded start/end timestamps or elapsed duration to the existing Tool
   activity DTO.
2. Preserve one row per `toolUseId`.
3. Show a human action label, elapsed/running state, bounded progress count,
   and final completed/failed/stopped state.
4. Keep the global “Droid is working/responding” row visible when no Tool
   progress arrives.
5. Coalesce purely repetitive progress updates before posting to the Webview.
6. Do not render an expandable detail body when it contains no useful safe
   detail.

Required visible examples:

- `Read`: “Reading workspace”, then “Completed”.
- `Edit`/`ApplyPatch`: “Editing code” or “Applying patch”, then terminal state.
- `Execute`: “Running command · 12s”, then “Completed in 14s” or “Failed after
  14s”.
- Unknown/MCP Tool: neutral label and explicit lifecycle.

This slice does **not** forward `parameters`, `details`, `text`, `error`,
`valueSnippet`, `terminalId`, `fullOutput`, or `subagentSessionId`. Those
fields require a separate redaction and disclosure contract.

**Gate 3 at minute 72:** tests prove lifecycle monotonicity, bounded progress,
stop-state preservation, stale-turn isolation, and no raw payload leakage.

### 01:12-01:25, focused interaction polish

Limit visual changes to defects exposed by the slice:

- Context loading/stale/unavailable copy.
- Tool row density, elapsed state, chevron only when details exist.
- Composer and interaction panel at narrow widths.
- Focus-visible, disabled, running, failed, and high-contrast states.
- Respect `prefers-reduced-motion`.

Do not rewrite the 3,800-line stylesheet. Record CSS consolidation as follow-up
work.

**Gate 4 at minute 85:** no overlap, clipped controls, meaningless empty
details, or inaccessible status-only color at 320, 400, and 600 CSS-pixel
widths.

### 01:25-01:42, integrated validation

Run:

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
```

Inspect:

```powershell
Get-Item dist\extension\extension.cjs, `
  dist\webview\webview.js, `
  dist\webview\webview.css |
  Select-Object Name, Length

Select-String `
  -Path dist\webview\webview.js `
  -Pattern 'react-dom-client\.development|development build'
```

**Gate 5:** all checks pass. The development-pattern search returns no match.

### 01:42-01:55, package and visible Cursor verification

Run:

```powershell
pnpm run package:vsix
pnpm run verify:vsix
```

Install the exact VSIX in Cursor, reload the Extension Host, and verify:

1. DroidVisX opens in the Secondary Sidebar.
2. Existing history loads without losing chronological Thinking/Tool/text
   order.
3. Context shows a plausible current-window value based on the latest
   last-call meter, or a truthful unavailable state.
4. A real long-running turn shows persistent activity and a terminal Tool
   state.
5. Stop works and leaves no running activity row.
6. Permission and AskUser interactions still block Composer submission and
   settle exactly once.
7. Narrow and normal widths remain usable.
8. Scroll anchoring does not yank a user who has scrolled upward.

Capture screenshots only after all values are real Runtime values.

**Gate 6:** visible behavior passes. A unit-test-only result is insufficient.

### 01:55-02:00, bookkeeping and commit

1. Update `docs/product/implementation-status.md`.
2. Record VSIX byte size, SHA-256, build time, and installed bundle hashes.
3. Review `git diff --check`, `git diff --stat`, and the intended diff.
4. Stage only the vertical-slice files.
5. Commit with the repository-required co-author trailer.

Do not spend the last five minutes adding features.

## Hard cut lines

At each time boundary, finish the current gate and cut later work:

| Time | Keep | Cut first |
| --- | --- | --- |
| 00:36 | Truthful Context | Context category visualization |
| 00:52 | Production React/minified Webview | Extension bundle minification |
| 01:12 | Tool lifecycle and elapsed state | Raw terminal/output details |
| 01:25 | Accessibility and narrow-width defects | Broad visual redesign |
| 01:42 | Full validation | New optimizations |
| 01:55 | Visible Cursor check | Extra screenshots and cosmetic polish |

Context correctness, lifecycle terminal states, and truthful validation are
never cut.

## Rollback triggers

Immediately roll back the relevant slice when:

- The Runtime needs a private SDK property or internal chunk.
- Context displays a percentage when the last-call numerator is absent or
  larger than the budget.
- A stale Runtime/session/CWD response reaches the active UI.
- Tool progress leaks raw command, path, output, terminal, or subagent data.
- Coalescing drops final completed, failed, stopped, permission, AskUser, turn
  state, or error events.
- Production packaging still contains React development code.
- Cursor verification regresses sending, stopping, permission settlement,
  history, scrolling, or recovery.

Use the detailed procedures in
[07-acceptance-and-rollback.md](07-acceptance-and-rollback.md).

## Follow-up order after the sprint

1. Move transcript text accounting from repeated scans to incremental counts.
2. Batch Bridge deltas by animation frame or 16-33 ms with immediate terminal
   flush.
3. Incrementally map transcript items into assistant-ui messages.
4. Add transcript virtualization/windowing.
5. Merge history and initial Context inspection to avoid redundant process
   startup.
6. Define a reviewed terminal/output disclosure contract.
7. Consolidate CSS into one token and component layer.
8. Expand the Secondary Sidebar information architecture by delivery-plan
   module order.
