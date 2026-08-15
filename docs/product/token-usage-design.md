# Token usage detail — evidence and design

Slice: V2 cost/token detail visualization (session/turn scope only; account
level Factory quota explicitly out of scope by user decision, 2026-08-12).

Evidence sources: `@factory/droid-sdk@0.7.0` type declarations
(`dist/index-D_SzTnFR.d.ts`), SDK JS bundle (`dist/chunk-5UXINOXG.mjs`),
SDK reference doc, and a live two-turn probe over ProcessTransport
(`artifacts/probe-token-usage.mjs` → `probe-token-usage.out.json`,
`artifacts/probe-token-usage-load.mjs` → `probe-token-usage-load.out.json`,
probed 2026-08-12, droid CLI protocol 1.155.0).

## What the SDK actually provides

The single usage shape everywhere is `TokenUsage`:
`inputTokens / outputTokens / cacheCreationTokens / cacheReadTokens /
thinkingTokens`, plus optional `factoryCredits`. There is **no USD cost
field anywhere in the SDK** and no per-token price data (models only carry
an opaque optional `tokenMultiplier`).

| Source | Shape | Timing | Probe result |
| --- | --- | --- | --- |
| `token_usage_update` stream event | 5 token fields, **no** `factoryCredits` (SDK conversion drops it) | 2–4× per turn during `stream(..., { includePartialMessages: true })` | Confirmed live; values are **cumulative session totals** |
| `result` stream message `.tokenUsage` | full `TokenUsage` incl. `factoryCredits`, or `null` | once at end of each turn | Confirmed live; values are **per-turn** (turn1 846/5 + turn2 1719/76 = final cumulative 2565/81) |
| `loadSession().result.tokenUsage` | full `TokenUsage` incl. `factoryCredits`, optional | history load | Confirmed present with cumulative session totals |
| `loadSession().result.lastCallTokenUsage` | `inputTokens / cacheReadTokens / outputTokens?` | history load | Confirmed present (last LLM *call*, not last turn) |
| `session_token_usage_changed` notification | `tokenUsage` + `inclusiveTokenUsage?` + `lastCallTokenUsage?` | public raw session notification | Confirmed live; `lastCallTokenUsage` is retained only for the Context meter |
| `agent_turn_completed` notification | per-turn `tokenUsage`, `cumulativeTokenUsage`, `childTokenUsage`, `cumulativeChildTokenUsage`, `turnId`, `durationMs` | wire-level | Confirmed on the wire; SDK drops it (never converted to a stream event) |
| per-message usage in history | — | — | **Absent**: no usage/cost/credit keys on any `loadSession` message |

Both process mode and daemon mode go through the same
`FactoryDroidSession.stream()` contract with `includePartialMessages: true`
(`FactoryDroidRuntime.ts`, `createDaemonDroidSession.ts`), and the daemon
converter (`convertNotificationToStreamMessage`) produces the same
`token_usage_update` events, so the live path is identical in both modes.

Current wiring separates two meanings:

- The Context ring is pull-based. Process mode combines the validated
  `getContextStats().limit` with the latest validated public
  `lastCallTokenUsage`; daemon mode uses
  `contextBudget / lastCallCompactionTokens`.
- The token ledger consumes cumulative `token_usage_update` and per-turn
  result usage. Those counters never feed the ring or percentage.

## Verdicts

Can do (field measured live):

- **Cumulative session token breakdown** — live from `token_usage_update`
  (5 fields), seeded for resumed/history sessions from
  `loadSession().result.tokenUsage`.
- **Per-turn token breakdown for the last completed turn** — from
  `result.tokenUsage` (null-safe; SDK documents it can be `null`).
- **`factoryCredits`** — real field on per-turn results and history loads
  (observed value 0 on this account). Session-scoped consumption, not the
  excluded account quota. Projected through, shown only when `> 0`.

Fail-closed (not implemented, data not available):

- **USD cost / any money amount** — no such field in the SDK; no local
  price-table conversion (unit prices are not SDK data).
- **Per-turn history for past turns** — `loadSession` messages carry no
  usage; only the session cumulative survives. History sessions therefore
  show cumulative only, and "last turn" appears only after a live turn
  completes in the current window.
- **Subagent/child usage split** (`childTokenUsage`) and per-turn records
  via `agent_turn_completed` — wire-notification only; adopting it would
  mean tapping raw transport, out of v1 scope.

## Current-window meter (v0.7.26)

`lastCallTokenUsage` is intentionally not presented as “last turn.” It has
one narrower use: the SDK identifies it as the provider-call numerator for
the context/compaction meter.

1. Process resume captures validated load-response
   `lastCallTokenUsage`; live sessions update it from the public
   `session_token_usage_changed` subscription.
2. The process-mode numerator is
   `inputTokens + cacheReadTokens + (outputTokens ?? 0)`.
3. Process mode reads only `getContextStats().limit`; daemon mode reads
   the provider-reported `contextBudget` and
   `lastCallCompactionTokens` together (the measured scalar matched the
   corresponding Provider Call sum).
4. Negative, fractional, unsafe, missing, or over-budget values produce
   explicit “Current window unavailable” state, never a clamped estimate.
5. Runtime/session/CWD generations still reject stale refresh results, and
   a failed refresh retains the last confirmed value with an error state.

## v1 design

Surface: the existing context popover (`ContextPopover` in
`ComposerControls.tsx`) gains one quiet "Token usage" section under the
context meter — same `dl` definition-list visual language as the existing
context details, no new prominent elements, no chart library.

- Rows: Input / Output / Cache read / Cache write / Thinking, one column
  for "Last turn" (when known) and one for "Session" (cumulative).
- A "Credits" row appears only when `factoryCredits > 0`.
- When no usage data exists at all (fresh session before the first
  update, or a history load without the field), the section is omitted
  entirely — fail-quiet.

Data flow:

1. Runtime: `normalizeSdkEvent` maps `token_usage_update` →
   `{ type: 'token-usage', cumulative }` and extends `turn-complete` with
   `turnUsage` projected from `result.tokenUsage` (validated, fail-soft to
   omission). Shared guard lives in `src/shared/tokenUsage.ts`.
2. History: `projectSessionHistory` reads the envelope's top-level
   `tokenUsage` into `SessionHistoryResult` so resumed and replayed
   sessions seed the cumulative figure.
3. Bridge: `SessionTokenUsageState { cumulative, lastTurn }` (both
   nullable `TokenUsageBreakdown`), pushed via a new
   `session.tokenUsage` host message and included in the full state
   snapshot; validated in `validateHostMessage`.
4. Host: `ChatController` keeps per-session usage state — seeds from
   history, overwrites cumulative on every `token-usage` event, sets
   `lastTurn` on `turn-complete`, resets on session switch.
5. Webview: store slice + `runtimeAdapter` mapping + popover section.

Live counters are authoritative: cumulative always tracks the newest
`token_usage_update`; the seed is only shown until the first live update.
Counters reset when Droid replaces the session (compact/rewind/fork paths
already re-run the resume path, which re-seeds from history).
