# Chat, Tool, and terminal UX specification

## Product target

DroidVisX should combine Claude-like conversational calm with Cursor-like
visibility into coding work, while remaining a native Secondary Sidebar.

The target qualities are:

- conversation first
- explicit ongoing work
- high information density without nested card piles
- no invented capability or sample data
- stable Composer and predictable scrolling
- clear permission boundaries
- quiet success and unmistakable failure

## Core rules

1. Assistant text is the primary surface and has no decorative card.
2. Cards are reserved for user messages, activities, interactions, diagnostics,
   and popovers.
3. During an active turn, assistant text, Thinking, Tool activity, a pending
   interaction, or the global working row must always be visible.
4. Tool lifecycle is more important than raw output.
5. Model, reasoning, mode, autonomy, and Context are confirmed Runtime state.
6. Missing data is unavailable, never replaced with prototype values.

## Thread anatomy

```text
Header
  product name · connection state · session history action

Scrollable reading column
  history/recovery notice
  user message
  assistant Markdown
  Thinking rows
  Tool/activity rows
  diagnostics
  Permission/AskUser request
  active-turn fallback

Sticky Composer
  input or interaction-locked state
  session controls · Context · model
  send/stop/retry
  keyboard hint
```

The reading column should remain visually continuous. Avoid separators between
ordinary assistant paragraphs.

## Message behavior

### User

- Compact warm neutral bubble aligned right.
- Preserve whitespace and wrapping.
- Copy and Reuse actions appear on focus/hover, but remain keyboard reachable.
- Double-click reuse is a convenience, not the only route.

### Assistant

- Render GFM Markdown with safe links and no raw HTML.
- Use the full readable width at narrow sidebars.
- Keep paragraph, list, code, and heading rhythm compact.
- Stream without layout jumps.
- Do not duplicate final text after partial deltas.

### Thinking

- One disclosure per chronological reasoning segment.
- Label: `Thinking`, then `Complete · 8s`, `Stopping`, or `Stopped`.
- Active indicator must not rely on color alone.
- Expansion state belongs to the individual segment, not every message.
- Long content remains bounded and uses reduced motion when requested.

## Tool activity

### Collapsed row

```text
[indicator] Running command                Working · 12s
```

Terminal examples:

```text
Reading workspace                         Completed
Applying patch                            Completed · 2s
Running command                           Failed after 14s
Using MCP Tool                            Stopped
```

Use a safe action summary derived from the Tool category:

| Tool | User-facing action |
| --- | --- |
| Read | Reading workspace |
| Grep/Glob/LS | Searching workspace |
| Edit/Create | Editing code |
| ApplyPatch | Applying patch |
| Execute | Running command |
| AskUser | Waiting for your answer |
| ExitSpecMode | Presenting implementation plan |
| Task | Running delegated work |
| MCP Tool | Using connected Tool |
| Unknown | Using workspace Tool |

Do not infer a filename, command, test name, or outcome absent from approved
data.

### Safe expanded detail

The two-hour slice may show:

- normalized Tool name
- bounded progress count
- latest semantic update kind
- elapsed duration

Do not render an expand chevron when this adds no useful information.

The following stay Host-only until a separate disclosure contract exists:

- parameters
- paths and commands
- `details`, `text`, `error`, and `valueSnippet`
- `terminalId`
- `fullOutput`
- `subagentSessionId`

### Lifecycle

```text
running → completed
running → failed
running → stopping → stopped
```

Terminal states never return to running. Coalescing may drop intermediate
progress but never start, final, stop, interaction, turn-state, or error
events.

If no Tool update arrives, the persistent `Droid is working/responding` row
prevents a false hang.

## Terminal visibility roadmap

### Current approved level

Semantic terminal activity only:

- `Running command`
- elapsed time
- bounded update count
- completed/failed/stopped

### Future output preview

Before showing command/output, define:

1. Host-only redaction of credentials, environment values, URLs, and home paths.
2. Per-update and per-turn byte/line limits.
3. Streaming coalescing and truncation labels.
4. Persistence policy, preferably no recovery persistence by default.
5. Copy behavior and explicit disclosure.
6. ANSI sanitization and accessible plain-text fallback.
7. Terminal-ID opacity, never exposing the raw ID to the Webview.

### Full terminal

The stable daemon has a terminal resource, but adopting it requires a separate
daemon/auth/session-ownership architecture. A `terminalId` in Tool progress
does not by itself authorize a terminal emulator.

## Context UX

### Available

- Ring and progress bar show
  `lastCallCompactionTokens / contextBudget`.
- Main copy: `65% used`.
- Detail: `162,452 of 250,000`.
- Remaining is derived only after the numerator and budget pass validation.
- Optional label: `Latest model call`.

### Loading with confirmed value

- Keep the confirmed meter visible.
- Show a quiet refreshing state.
- Do not reset the ring to zero.

### Stale/error with confirmed value

- Keep the last confirmed value.
- Label it `Last confirmed`.
- Show bounded retry guidance.

### Unavailable

- Empty/neutral ring, no progressbar role and no percentage.
- Copy: `Current window unavailable`.
- Reason may be `No model call yet`, `Droid did not report the current window`,
  or fixed safe failure copy.
- Never display cumulative totals as a substitute.

## Composer

- Sticky to the viewport footer.
- Enter sends; Shift+Enter inserts a newline.
- Send becomes Stop during an active turn.
- Stop disables after the first click and shows stopping state.
- Permission/AskUser replaces or locks the input until settled.
- Draft persists locally through Webview state.
- Controls remain usable at 320 CSS pixels without overlap.

## Permission

- Eyebrow identifies Permission, Plan, Mission, or security violation.
- Explain the requested operation in bounded Runtime-projected terms.
- Destructive/cancel actions are visually distinct.
- Primary approval uses only a supplied SDK option.
- Additional approval scopes live in a split menu.
- Edited plan is bounded, counted, and submitted once.
- While settling, disable every option and mark the card busy.

## AskUser

- Show one to four questions in Runtime order.
- Clearly distinguish single choice, multi-select, and open response.
- Provide the user-supplied/custom answer path.
- Require a non-empty resolved answer for every question.
- Submit or cancel exactly once.
- Preserve keyboard fieldset semantics and visible focus.

## Scrolling

- Scroll to bottom on initialization, session switch, and a new local run.
- Auto-follow only while the user remains near the bottom.
- Never yank a reader who has scrolled upward.
- Keep a visible Scroll to Bottom affordance when detached.
- Composer height changes must not obscure the last message.

## Responsive states

| Width | Behavior |
| --- | --- |
| 320 px | Single-column popovers, shortened labels, full-width interactions |
| 400 px | Standard Secondary Sidebar target |
| 600 px | Wider reading column, no excessive message stretching |
| 800+ px | Keep a bounded reading measure rather than filling all space |

Long model IDs, multilingual text, 200% zoom, and Windows scrollbar width must
not cause horizontal scrolling.

## Accessibility

- Visible focus on every interactive element.
- Semantic buttons, details/summary, fieldsets, labels, progressbar only when
  a real ratio exists, and `aria-live` for status changes.
- Activity state never uses color alone.
- Minimum 44 CSS-pixel target where layout permits, otherwise VS Code-native
  compact controls with adequate spacing.
- Support high contrast and VS Code theme colors without losing the warm
  DroidVisX identity.
- Respect `prefers-reduced-motion`.
- Error, busy, disabled, and selected states remain screen-reader legible.

## Motion

- Use short opacity/transform transitions for popovers and rows.
- No looping ornamental animation.
- Working pulse must be subtle and disabled under reduced motion.
- Streaming smoothing must not delay final text or Tool terminal state.

## Acceptance scenarios

1. A 20-second Execute call shows elapsed work and completes without exposing
   its command/output.
2. A Tool failure is visually and programmatically distinct from success.
3. Stopping a turn leaves no `Working` Tool row.
4. A Permission request receives focus and Composer cannot send behind it.
5. An AskUser multi-select plus custom answer submits one bounded response.
6. A cumulative Context total above budget shows no percentage.
7. A valid last-call meter shows the exact computed ratio.
8. The user can scroll upward during streaming without being pulled down.
9. 320/400/600-pixel widths, 200% zoom, reduced motion, and high contrast pass.
