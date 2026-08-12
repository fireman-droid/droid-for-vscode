# Changelog

All notable changes to DroidVisX are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

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
