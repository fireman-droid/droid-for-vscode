# Acceptance and rollback

## Completion definition

A slice is complete only when Runtime, Host, Bridge, Webview, focused tests,
broad checks, package, installed artifact, visible Cursor behavior, and
implementation status agree.

Code edits without visible verification are partial.

## Gate 1, Context correctness

### Contract tests

- Last-call input + cache-read + optional output produces the numerator.
- Context budget is a positive safe integer.
- Remaining is derived only after numerator/budget validation.
- Available requires `0 <= used <= limit`.
- Missing last-call data is unavailable.
- Negative, fractional, NaN, infinite, unsafe, or over-budget data is
  unavailable.
- Cumulative Stats/Breakdown totals may exceed limit without being rejected at
  the SDK boundary, but never become the current meter.
- Bridge validator accepts exact valid shapes and rejects extra keys.
- Stale session/Runtime/CWD/request generations are ignored.
- Failed refresh retains a last confirmed value and safe error.

### Visible checks

- Valid meter shows exact used/limit/remaining.
- Incoherent cumulative totals show no percentage or progressbar.
- Loading retains a confirmed value.
- Error offers refresh/log guidance without raw SDK text.

### Failure/rollback

Revert the meter portion and preserve `Current window unavailable` when:

- the implementation reads `_client` or internal chunks
- no validated last-call numerator is available
- over-budget data is clamped
- a stale response is visible
- cumulative totals are displayed as fullness

## Gate 2, Tool lifecycle

### Contract tests

- one row per `toolUseId`
- bounded Tool name/action/count
- running → completed/failed/stopped is monotonic
- repeated start does not reset progress
- post-terminal progress is ignored
- stop converts active rows to stopping/stopped
- stale turn/session events are ignored
- elapsed time is non-negative and bounded
- coalescing preserves first and terminal events
- raw progress fields do not cross the Bridge

### Visible checks

- long-running Tool remains visibly active
- elapsed label advances without layout churn
- success, failure, and stop are distinct
- no empty disclosure content
- global working row covers silent intervals

### Failure/rollback

Disable coalescing first. Revert elapsed/detail additions next. Keep the
existing safe lifecycle projection if terminal state, ordering, or privacy is
uncertain.

## Gate 3, production build

### Automated checks

- `pnpm run build` passes.
- Webview JS is below 900,000 uncompressed bytes.
- packaged Webview contains no
  `react-dom-client.development.js`.
- packaged Webview contains no React development-build banner.
- CSS/font URIs remain CSP-compatible.
- built and installed bundle hashes match.

### Failure/rollback

If production define/minification breaks the Webview:

1. retain `NODE_ENV=production`
2. disable minification temporarily
3. identify minifier-sensitive code
4. do not ship the React development build

## Gate 4, core regression

Run focused tests while editing, then:

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run package:vsix
pnpm run verify:vsix
```

Must retain:

- new/resumed session
- history/recovery
- send/stream/final response
- chronological Thinking/Tool/text
- Stop
- Permission settlement
- AskUser settlement
- settings mutation/reread
- model/reasoning selection
- session switch/new session
- workspace change cleanup
- diagnostics/logs
- hostile Bridge validation

Any new test failure blocks packaging.

## Gate 5, visible Cursor verification

Install the exact built VSIX and reload Cursor.

### Required flow

1. Open DroidVisX in Secondary Sidebar.
2. Confirm connection and active session.
3. Open session history and resume a session.
4. Verify chronological restored content.
5. Open Context and compare the UI to sanitized Runtime diagnostics/probe data.
6. Run a prompt that performs Read and Execute activity.
7. Observe ongoing work and terminal state.
8. Start another long turn and press Stop.
9. Trigger one permission and settle it once.
10. Trigger AskUser and submit/cancel once.
11. Change one setting and confirm authoritative reread.
12. Resize to 320, 400, and 600 CSS pixels.
13. Scroll upward during streaming.
14. Check light/dark/high contrast and reduced motion when time permits.

### Capture

Record:

- Cursor version
- VSIX hash
- session type: new/resumed
- widths/themes checked
- pass/fail per flow
- screenshots with no credentials or unnecessary user content

## Artifact verification

After packaging:

```powershell
$vsix = Get-Item dist\droidvisx.vsix
$hash = Get-FileHash $vsix.FullName -Algorithm SHA256
$vsix | Select-Object FullName, Length, LastWriteTimeUtc
$hash | Select-Object Algorithm, Hash
```

Verify packaged and installed:

- `dist/extension/extension.cjs`
- `dist/webview/webview.js`
- `dist/webview/webview.css`
- font/assets

Record exact hashes in `docs/product/implementation-status.md`.

## Privacy review

Search changed Bridge/diagnostic code for:

```text
prompt, content, parameters, command, path, output, fullOutput,
terminalId, subagentSessionId, apiKey, token, authorization, stack
```

Every occurrence must be:

- intentionally Host-only
- bounded and explicitly projected
- or absent

No raw error serialization. No credentials in screenshots, logs, docs, tests,
or commits.

## Performance review

Before/after:

- Webview JS/CSS bytes
- development React marker
- Bridge message count for a synthetic delta burst
- Host transcript projection time
- Webview reducer/mapping time where instrumentation exists
- resume history process/time

Do not claim a speedup from bundle size alone. Report what was measured and
what remains inferred.

## Git review and commit

1. `git status --short`
2. `git diff --check`
3. inspect `git diff -- <each changed path>`
4. stage only intended files
5. inspect `git diff --cached --stat`
6. inspect `git diff --cached`
7. commit using recent repository style and:

```text
Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>
```

Never stage unrelated existing edits or untracked files.

## Rollback matrix

| Failure | Immediate rollback | Preserve |
| --- | --- | --- |
| Context semantics uncertain | Remove available meter path | Unavailable state and diagnostics |
| Raw Tool data leaks | Remove new detail fields | lifecycle/count/category |
| Coalescing loses terminal event | Disable batching | direct Bridge delivery |
| Webview minifier breaks | disable minify, keep production React | correctness |
| History regression | revert history/Context merge | separate proven history loader |
| Secondary Sidebar unsupported | restore prior manifest/fallback | Open Chat command |
| CSS regression | revert only latest override block | functional components |
| Scroll regression | restore assistant-ui primitive defaults | transcript integrity |
| Permission double-settle | revert visual changes around interaction | Host coordinator |
| Package/install mismatch | do not install/declare complete | last verified VSIX |

## Stop-ship conditions

- Any failing test/type check/build/VSIX verification.
- Context uses cumulative totals.
- A percentage is shown without a valid last-call numerator.
- Permission/AskUser can settle twice.
- Stop leaves active Tool/Thinking state.
- Stale session events appear.
- raw command/path/output/credential data crosses the Bridge.
- React development build ships.
- installed bundles do not match the verified build.
- visible Cursor verification is skipped for UI changes.

## Honest final report template

```text
Outcome:
- What is production-wired.

Validation:
- Commands that passed.
- Visible flows that passed.

Artifact:
- VSIX bytes, SHA-256, timestamp.
- Installed bundle hash match.

Not completed:
- Cut work and why.

Remaining risks:
- Unmeasured or architecture-dependent items.
```
