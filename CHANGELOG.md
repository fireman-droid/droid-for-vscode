# Changelog

All notable changes to DroidVisX are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

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
