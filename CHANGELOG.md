# Changelog

All notable changes to DroidVisX are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

## [0.7.18] - 2026-08-15

### Fixed

- **Side-chat questions read like user messages** — `/btw` questions
  reuse the main user card, stay sticky, remain read-only, and jump
  smoothly to the start of their exchange when clicked.
- **Model labels honor configured display names** — generated
  `custom:…-0` identifiers remain metadata while the trigger and
  picker show the user-selected name.
- **Long model names and Add Model align cleanly** — the trigger and
  responsive model popover are wider, and the Add Model footer keeps
  its plus and label together instead of splitting them across the row.
- **Focused side-chat and model fields draw one border** — the shared
  form inputs no longer inherit a second outer focus outline.

## [0.7.17] - 2026-08-15

### Fixed

- **Subagent transcript panes dismiss predictably** — pressing blank
  space outside the pane plays the close transition, while choosing
  another session closes it immediately.
- **Opening another transcript cancels an older close** — a pending
  leave timer cannot dismiss the newly selected delegation.

## [0.7.16] - 2026-08-15

### Fixed

- **Subagent transcripts now use the main chat presentation** —
  delegated prompts, Markdown, Thinking, command cards, tool rows, and
  exploration groups share the same read-only components instead of a
  separate approximation.
- **Read and search activity identifies its target** — safe
  workspace-relative Read paths plus bounded Grep/Glob query and scope
  context survive live projection and history playback.
- **Child transcript following respects reading intent** — growth
  descends smoothly, releases on deliberate scrolling, rejoins at the
  bottom, follows disclosure resizing, and honors reduced motion.
- **Unreliable subagent cancellation controls are withdrawn** — the
  activity panel remains observational and sends no single-child or
  batch stop request; the parent Composer Stop remains unchanged.

## [0.7.15] - 2026-08-14

### Fixed

- **Exploration groups finish without jumping** — the final live
  ticker stays mounted while its completed summary crossfades in and
  the shared container smoothly contracts, so following rows are no
  longer pulled upward by an abrupt DOM replacement.
- **Hidden activity details stay out of keyboard navigation** —
  transient ticker rows and collapsed completed details are inert
  until their visible summary is ready or expanded.

## [0.7.14] - 2026-08-14

### Fixed

- **`/btw` focus has one border** — the input now strengthens its
  existing neutral border without drawing a second outer shadow ring.
- **Sticky question hand-offs stay stable** — pin ownership has a
  subpixel deadband, the compact three-line state no longer changes
  height at the ownership boundary, and transformed rows are measured
  from their natural position.
- **Slow reading is not pulled backward** — any movable vertical wheel
  or touchpad gesture releases streaming bottom-follow before content
  growth can write the scroll position; reaching the bottom rejoins it.

## [0.7.13] - 2026-08-14

### Fixed

- **Shared daemon ownership survives Windows shell exit** — discovery
  records the verified TCP listener PID instead of the transient
  `cmd.exe` wrapper, reuses healthy legacy endpoints, reaps duplicate
  race losers, and only shuts down a process verified as the listener
  for the discovered port.
- **Discovery replacement is race-safe** — stale records are removed
  only when their exact contents still own the path, preventing one
  Cursor window from deleting a healthy record published by another.
- **PowerShell command cards show the real command** — assignment
  preambles, grouped expressions, compound assignments, and quoted
  environment values remain lossless without becoming garbled titles.
- **Problems attachments stay in the bound workspace** — diagnostics
  from external editor tabs and other Cursor workspaces are excluded.
- **`/btw` prepares on pane open** — the hidden fork starts when the
  side pane mounts, so the first question no longer pays initialization
  latency; concurrent prepare/ask and rapid reopen remain single-flight.

## [0.7.12] - 2026-08-14

### Fixed

- **Queued “Send now” is immediate** — selecting a waiting message
  safely stops the active turn, waits for terminal settlement, then
  dispatches that exact item without opening a mid-turn runtime race.
- **Pinned questions stay compact** — sticky user cards contract to
  three text lines instead of occupying a large part of the viewport.
- **Side-chat focus matches the Composer** — `/btw` uses the neutral
  strong-border treatment instead of an unrelated accent ring.
- **Side-chat answers rise naturally** — streaming growth follows the
  newest answer across animation frames, releases on upward reading
  intent, rejoins at the bottom or a new question, and respects
  reduced motion.

## [0.7.11] - 2026-08-14

### Fixed

- **Expanded live Thinking now flows between Host batches** — opening
  a running row preserves its visible prefix, then uses assistant-ui
  smoothing to reveal later reasoning across animation frames instead
  of displaying one 200ms packet at a time.
- **Completion no longer jumps past a visible backlog** — rows opened
  live keep the smooth renderer through settlement; rows opened after
  completion retain the bounded progressive history renderer.

## [0.7.10] - 2026-08-14

### Changed

- **Long Thinking stays responsive and visibly alive** — the Host
  coalesces token-level reasoning into 200ms, 16KB Bridge chunks and
  flushes them before tools, answers, completion, Stop, or failure.
  The live row distinguishes `Receiving` from `Waiting for model`.
- **Expanded reasoning mounts progressively** — collapsed Thinking
  retains no text body in the DOM; opening it renders one bounded
  chunk first and schedules the remainder without blocking the click.

### Fixed

- **The silent 32K Thinking freeze is gone** — normal long reasoning
  remains available up to an explicit 512K emergency safety limit.
  Reaching that limit is reported in the row and expanded body instead
  of silently discarding later content.

## [0.7.9] - 2026-08-14

### Fixed

- **Background subagent answers now appear live** — after all
  detached child settles, the Host follows the hidden automatic
  parent turn through the daemon's working state and refreshes the
  active transcript from public session history, so the aggregate
  answer no longer remains only on disk until Reload Window.
- **Per-row Stop is single-flight and terminal-aware** — rapid clicks
  collapse into one request, a fresh invocation-ledger read avoids
  interrupting children that already finished, and stale activity
  samples cannot bring a removed Stop control back.

## [0.7.8] - 2026-08-13

This release makes live subagent work denser and more informative,
closes several daemon concurrency and lifecycle races, and adds the
single pending follow-up requested for `/btw`.

### Added

- **Richer live subagent transcripts** — tool rows now retain a
  command's first line or the first affected file plus a `+N` count,
  and Thinking can be expanded in the read-only transcript. The
  transcript remains available while a delegation runs and refreshes
  in place.
- **One pending `/btw` follow-up** — pressing Enter while an answer is
  streaming stores one host-owned next question; another Enter
  replaces it, and the latest question sends automatically after the
  current answer completes or fails. Bridge protocol moves to v13.
- **Session-switch phase diagnostics** — the existing correlated
  `host.perf.session-switch` record now reports initialize, history,
  context, and total durations without changing activation order.

### Changed

- **Compact, reload-safe Working popup** — the active-subagent popup
  uses a denser quiet layout, and explicitly running delegations stay
  visible after Webview reload until the host settles them.
- **Metadata-only worker filtering** — ordinary and archived session
  catalogs hide subagent and Mission worker sessions using
  authoritative parent/tag/settings metadata rather than title
  guesses.

### Fixed

- **Daemon ownership races** — lease claims serialize their complete
  read-check-write transaction; discovery records publish
  exclusively only after a real pid exists, validate competing
  winners, and reap duplicate spawns.
- **Safer private-daemon reaping** — lifecycle cleanup verifies that a
  recorded pid still belongs to the expected executable running the
  `daemon` verb before killing its process tree.
- **Contained MCP timeouts** — the host stops waiting after 30 seconds
  and ignores eventual late results behind runtime/session generation
  guards. The Droid SDK exposes no cancellation signal, so this is
  containment rather than cancellation of the underlying RPC.

## [0.7.0] - 2026-08-13

The subagent panel release: the working popup finally answers "what
is each subagent doing, and can I stop just this one", and settled
delegations replay their full transcript read-only.

### Added

- **Live subagent activity** — while the "N Working" popup is open,
  each running delegation row shows the tool its child session is on
  right now (host-side polling with backoff; stops when the popup
  closes). Bridge protocol moves to v11 with the new
  `subagentProtocol.ts` contract; the child session id never crosses
  the bridge.
- **Per-row Stop that actually works** — daemon-backed
  resume→interrupt→detach stops exactly that delegation while its
  siblings keep running (probed sequence). The button only renders
  when the host proved it can stop that row — never a disabled
  placeholder.
- **Read-only transcript playback** — settled delegation rows gain a
  quiet "View transcript" action opening the child session's full
  transcript in the /btw-style split pane: no composer, no writable
  entry points, fail-closed to a quiet "Transcript unavailable" when
  the child file cannot be resolved or loaded.

### Fixed

- **Session drawer leak** — subagent child sessions no longer appear
  in the session drawer or the archived list; their only entry point
  is the transcript view on their parent's Task row.

## [0.6.0] - 2026-08-13

The kitchen-sink parity release: everything the reviewed harness
showed is now the real product surface, closing out the visual
punch list in one batch.

### Changed

- **Command cards** — expanding and collapsing is one continuous
  height-and-opacity transition instead of a snap-open, and the
  terminal well follows the theme: light theme gets a warm light well
  with a light-legible syntax tint, dark keeps its deeper well.
- **Session drawer** — sized to its content (capped at 400px) with a
  rounded, hairlined bottom edge and a natural slide-down reveal, and
  chats now list newest first in every group regardless of catalog
  order.
- **Plan line** — the collapsed row and its steps align on one 14px
  marker rail, the head grows to 38px with a mono count, and steps
  tighten to 11.5px; TodoWrite activity rows retire from the
  transcript since the plan line carries the same checklist.
- **Plain tool rows** — the quiet ruled form: 29px rows led by a small
  marker dot, past-tense verbs in medium secondary ink, capsule-free
  mono file objects, hairlines between consecutive rows, and inline
  actions like Preview surfacing on hover.
- **Quieter details** — a user message with an inline image preview no
  longer repeats an IMAGE chip under it; "View source" under Mermaid
  diagrams underlines on hover instead of washing grey; "Droid is
  working" hugs the content above it.

## [0.5.0] - 2026-08-13

Polish release from the first full kitchen-sink review loop: the mode
and model popovers move to a lighter anchored form, the plan line
reads as live status, and the dark theme loses the ticker smear.

### Changed

- **Mode & model popovers reworked** — both are 200px cards with
  compact rows and a thin accent check instead of radio circles and
  selected-row washes, and they now anchor directly above their own
  triggers with right edges aligned (CSS anchor positioning, with the
  old row alignment as fallback). The model popover collapses its
  two-card stack into one card: search crown, 12px model names that
  truncate long BYOK ids, a hover-revealed reasoning pencil, and a
  quiet hairline "Add model…" footer.
- **Plan line title reads as live status** — the collapsed plan line
  shows the step Droid is on right now, the next pending step between
  updates, or the last step once everything is done, instead of
  freezing on the plan's first step. TodoWrite carries no title
  field; the gap and its fix paths are documented in
  `docs/product/plan-title-limitation.md`.

### Fixed

- **Dark ticker smear** — in dark theme the exploration ticker's
  static rows no longer paint a gradient bar behind their text; the
  paused-shimmer rule re-neutralizes the gradient so flat grey ink is
  all that renders.

## [0.4.0] - 2026-08-13

Feature release covering everything since 0.2.0, including the 0.3.0
build that shipped without its own entry here. The conversation loses
two more cards — Changes becomes a live ledger that grows while Droid
writes, and the plan card becomes a thin line pinned under the message
that asked for it — while the daemon path picks up dark theme, BYOK
custom models, editor-selection capture, and a batch of reload and
model-picker fixes.

### Added

- **Live Changes ledger** — the end-of-turn Changes summary becomes a
  running ledger that appears with the first file write and stays
  anchored where it first appeared. The header counts up as
  `writing · N files` and flips in place to `N files · settled` when
  the turn reconciles against `git diff --numstat`; the footer offers
  Review (opens every file's diff) and Commit… (the existing Git
  commit panel). Rides a new streaming `changes.update` bridge
  contract on protocol v10.
- **Dark theme** — a charcoal dark skin with an Auto / Light / Dark
  choice in the settings popover, persisted through the
  `droidvisx.theme` setting and applied without a reload.
- **Add Selection to Chat** — an editor right-click command stages the
  current selection as a Composer chip, holding the capture until a
  cold-starting session finishes connecting.
- **BYOK custom models** — a Custom Models panel reachable from the
  Model popover adds, edits, and removes bring-your-own-key models
  through the daemon; credentials stay opaque to DroidVisX.
- **Queued prompts survive a reload** — prompts queued during a turn
  are persisted and come back paused after the window reloads, so a
  reload never silently fires them.

### Changed

- **Plan line replaces the plan card** — the Created Plan card is gone.
  The plan is now a single quiet line under the user message that
  triggered it: collapsed to one row, sticky while that message is on
  screen, expanding to a circle-per-step checklist. No grey hover
  wash anywhere on it.
- **Exploration ticker dissolves while it slides** — the outgoing row
  fades as it travels instead of being clipped, and a fast arrival
  retargets the running transition from where it is rather than
  snapping back. Timing is the 280ms / 26px / `cubic-bezier(0.22,
  0.61, 0.36, 1)` the user dialled in.
- **Internals** — the three largest source files were split into
  focused modules (the chat controller into `chat/*`, the thread UI
  into `thread/*`, the stylesheet into a 23-file import index with
  colors centralized in `00-tokens.css`), and a file line-budget gate
  now blocks new monoliths.

### Fixed

- **Reload killed a running daemon turn** — a turn running on the
  shared daemon now survives a window reload or panel dispose instead
  of being torn down with the window.
- **Model picker empty in daemon mode** — the daemon serves the model
  catalog from `settings.getDefaults`, so the picker lists the full
  catalog instead of nothing.
- **Daemon console window on Windows** — the shared daemon no longer
  spawns a visible console window.
- **Plan never rendered from a real turn** — TodoWrite payloads are
  normalized to canonical plan lines, so plans built by the real CLI
  reach the UI.
- **Double Add-to-Chat stacked chips** — a repeated identical capture
  stages one chip instead of two.
- **Preview toolbar clipped when narrow** — the sandboxed preview
  toolbar wraps instead of cutting its buttons off.
- **Failed command card read as success** — a failed command card is
  colored with the danger token.
- **Silent diff failures** — `file-diff-failed` diagnostics name the
  path that failed and why.

## [0.2.0] - 2026-08-13

Feature release: the daemon becomes the default backend so turns survive
window reloads and session switches, subagent delegations get an honest
live surface (Working badge, identity on dispatch, zombie settlement),
and prompts queued during a turn gain Cursor-style management.

### Added

- **Working badge** — a quiet "N Working" pill at the Composer's left
  edge while subagent delegations run (including after the parent turn
  finished), with an activity popup listing each delegation's type,
  description, and live elapsed time. Stop All rides the existing
  turn-stop channel while the turn is active; when background
  delegations demonstrably cannot be stopped, no control is drawn at
  all rather than a fake one.
- **Queued-messages bar** — prompts queued during a running turn fold
  into a single Cursor-style line above the Composer ("N Queued · ⏎ to
  Send"); expanding it offers per-prompt editing through the Composer
  (Edit Queued chip), send-now promotion, and removal, and the paused
  state surfaces Send now / Clear inline.
- **Created Plan card** — the task plan anchors as a card at its
  creation point in the conversation, building live and settling to
  Completed, replacing the Composer-pinned plan surface.
- **Session drawer running indicator** — sessions with an in-flight
  turn wear a quiet inline ring that clears in place when the turn
  ends, and daemon-backed sessions can be switched away from while
  their turn keeps running in the background.

### Changed

- **Daemon by default** — sessions ride the shared local daemon
  (turns survive window reloads) with a silent per-window fallback to
  the subprocess runtime when the daemon cannot start; an explicit
  mode setting is always honored, and `/btw` works in both modes.
- **`/btw` split pane** — the side question surface becomes a
  full-height split-pane column beside the conversation instead of a
  right-edge overlay panel.
- **Command card** — the Execute row grows into a Cursor-grade command
  card with the call's own summary as its title.
- **Session drawer closes on selection** — picking a session returns
  straight to the chat instead of leaving the drawer open.

### Fixed

- **Archived list dead on arrival** — the drawer's Archived section
  failed silently on every load: the 200-row fetch exceeded the daemon
  client's limit-100 schema cap and was rejected before the request
  was sent. The fetch now stays inside the cap.
- **Subagent rows without an identity** — a Task delegation row now
  shows its type and description the moment it is dispatched instead
  of sitting on a bare "subagent" placeholder until the first status
  event, and a statusless row still spins while its parent Task runs.
- **Zombie running subagents** — delegation rows (and the Working
  badge) no longer spin forever when a background child outlives the
  turn: the host reconciles the delegation ledger after the turn ends
  and re-arms that watch after a window reload re-attaches the
  session.
- **Sent image order** — user images sent before their prompt text
  adopt into the same history message instead of drifting apart.
- **Exploration group integrity** — the running-group append helper no
  longer swallows user rows into a collapsed exploration group.

## [0.1.1] - 2026-08-12

Fix release for the first round of v0.1.0 field reports: streaming
correctness, MCP panel survivability, and the acceptance batch of visual
fixes.

### Fixed

- **Streamed CJK paths** — file paths derived from a streaming tool call
  no longer stick at a truncated partial parse (a CJK filename cut
  mid-way), so file chips, the changes card, and the commit panel see the
  real path.
- **Stacked error cards** — clicking a dead file chip repeatedly keeps a
  single diagnostic card instead of stacking identical copies, and a file
  Droid is still writing is worded as not ready yet rather than missing.
- **MCP add-server freeze** — submitting the Add server form no longer
  navigates and permanently blanks the webview, and a hung MCP daemon
  round-trip times out into the normal retry path instead of pinning the
  panel in loading.
- **Popup keyboard follow** — arrow-key navigation in the `/` command and
  `@` mention popups scrolls the highlighted row into view instead of
  walking it below the fold.
- **Commit panel count and buttons** — the changed-file count no longer
  drops to zero while paths stream in, and Cancel / Commit dock at the
  panel's lower right in conventional order.
- **Preview toolbar finish** — the sandboxed preview panel replaces its
  bare browser-default toolbar with the warm shell finish and quiet
  Reload / Open in editor buttons.
- **Exploration ticker** — the collapsed running exploration group shows
  only the tool that is running and hands off with a news-ticker slide,
  instead of stacking every member row.
- **Task plan pin** — the pinned plan wears the warm layered card
  treatment with quiet progress cues, dropping the flat white card and
  the strikethrough that read poorly on CJK.
- **Thin scrollbars everywhere** — popovers, popups, textareas, and
  preview panes all use the one thin quiet scrollbar instead of chunky
  engine defaults.
- **Sent image thumbs** — images in a sent user bubble render as
  composer-style rounded thumbs instead of a letterboxed black slab.
- **Live output auto-open** — a running command's output tail opens by
  itself and settles closed on completion, while a manual toggle always
  wins over the policy.
- **One action bar per reply** — a reply split across interleaved
  thinking segments gets a single action bar whose Copy takes the whole
  run, instead of one footer per segment.

### Changed

- **`/btw` side panel** — the side chat leaves the composer-anchored card
  for a full-height right-edge panel over a scrim, with the Q&A
  transcript scrolling in the middle and the input pinned at the foot.

## [0.1.0] - 2026-08-12

First release. DroidVisX wraps the local Droid CLI (`@factory/droid-sdk`)
into a warm, responsive chat workbench in the Cursor / VS Code Secondary
Sidebar. Droid itself remains the single authority for sessions, models,
permissions, Skills, and MCP; DroidVisX adds no second AI backend and never
touches credentials. The core — streaming text chat, session management,
permission / AskUser / Spec interactions, history recovery, attachments,
Skills / MCP / slash commands — ships together with the highlights below.

### Added

- **Turn queueing** — send follow-up prompts while a turn is running; they
  stack as queued cards below the transcript and dispatch automatically when
  the turn completes (Stop or a failure pauses the queue for review).
- **`/btw` side chat** — ask a quick side question in a compact card that
  runs over Droid's hidden fork mechanism, without derailing the main
  conversation; CLI aliases like `/compress`, `/handoff`, and `/clear` now
  route to the matching UI instead of being sent as plain text.
- **Streaming command output preview** — running Execute tools show a live
  output tail in a recessed dark window inside the activity row.
- **Read-only terminal mirror** — open a running command's output as a live
  mirror in a real VS Code terminal, straight from the activity row.
- **Pinned task plan** — the current task plan stays pinned above the
  Composer while a turn runs, so progress is visible without scrolling.
- **Interleaved thinking segments** — thinking renders as separate segments
  in their true order between tool runs, instead of one merged block.
- **Subagent summaries and Mission read-only view** — delegated Task rows
  expand into per-subagent summary rows with settled outcomes, and mission
  identity appears quietly in the header and session list.
- **Canvas / HTML sandboxed preview** — Preview entries on HTML code blocks,
  workspace path links, and changed `.html` files open a locked-down
  sandboxed preview panel.
- **Changes card and Git commit flow** — each turn ends with a
  "Changes · N files" card with +/− line counts and native diff opening,
  plus an inline commit panel built on the VS Code Git API.
- **Worktree parallel sessions** — start a session in a fresh git worktree
  from the session drawer to develop on a branch without touching the
  current checkout.
- **Session export** — `DroidVisX: Export Session as Markdown` writes the
  active transcript to a Markdown document.
- **Mermaid diagrams** — completed `mermaid` code blocks render as diagrams
  (bundle loads lazily on first use).
- **Plugins, read-only** — the composer settings popover lists installed
  Droid plugins via the daemon sidecar.
- **Token usage** — the context popover shows a per-session token breakdown
  ledger fed by real SDK usage events.
- **Spec Mode closed loop** — plan cards with expand and edit preview, spec
  planning badge, a drafting-model override, and safe adoption of
  plan-approved handoff sessions.
- **Cursor-style streaming experience** — exploration tools aggregate into
  activity groups, thinking gets a shimmer treatment, new content animates
  in (silent on replay), and todo lists fold into summaries.
- **Rich content** — images display in the transcript, drag or paste images
  into the Composer, a fullscreen media viewer, and clickable file paths in
  transcript inline code.
- **Message editing and actions** — in-place edit-and-resend card with
  sent-attachment echo, a hover action bar with fork, and dynamic `/`
  commands backed by the live Droid command catalog.
- **Session organization** — favorites with grouped drawer display, plus
  archive, unarchive, and cross-session search over a read-only daemon
  sidecar.
- **Daemon mode (experimental)** — opt-in `droidvisx.runtime.mode = daemon`
  runs sessions over a shared detached daemon that survives window reloads,
  with in-flight turns reconciled after reload.
- **Full-fidelity diagnostics** — structured local JSONL logs with turn
  correlation and performance beacons, `Open Logs`, and an
  `Export Diagnostics Bundle` command that zips logs with the analysis
  playbook.

### Fixed

- **Session switching** — Skills and MCP panels no longer freeze after a
  session switch, and long sessions unfreeze with much faster recovery
  rendering.
- **Startup flash** — the shell background paints before the webview boots,
  removing the white flash on activation.
- **Tab retention** — the chat webview is kept alive across sidebar tab
  switches instead of rebooting each time.
- **ApplyPatch paths** — file links on ApplyPatch rows are read from the
  patch text itself, so they point at the real files.
- **Blank panel and history integrity** — duplicate tool-call ids no longer
  blank the panel, recovered history aligns by user message anchors, and
  poisoned checkpoints no longer resurrect duplicate messages.
- **Permission approvals** — oversized permission details are truncated
  instead of silently cancelling the approval.
- **MCP reliability** — authentication and server toggle flows were made
  reliable, with panel failures logged instead of hanging silently.
- **Daemon startup** — a private daemon that fails to spawn retries on a
  fresh port and surfaces its stderr tail in diagnostics.

### Changed

- **Quiet shell convergence** — spec, compact, menu, and diagnostic surfaces
  now share the warm quiet visual language, alongside a reworked context
  card and a ten-item UI polish batch.
- **Composer popups** — the `@` and `/` popups were redesigned; an empty `@`
  query lists your open editor tabs.
- **Output styling** — command output tails use a thin quiet scrollbar and a
  warm recessed window treatment.
- **Version** — the extension leaves the perpetual `0.0.0` development
  version; installed builds now upgrade normally by version number.
