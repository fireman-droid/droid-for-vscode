# Project Instructions

## Work routing and delegation approval

Use Factory's three-level execution model (user decision, 2026-08-16). This
replaces the earlier 2026-08-12 policy that allowed unrestricted delegation.
File count alone never determines the level.

1. **Normal task** — one observable user outcome with a coherent
   implementation and validation path. The active agent handles it directly
   in Normal Mode, even when several files or layers are involved.
2. **Planned feature** — one product capability that needs explicit
   architecture, sequencing, contract, migration, or state-machine decisions.
   Use Spec Mode, obtain approval for the implementation plan, then keep
   implementation and validation with the active agent by default.
3. **Mission project** — multiple independently valuable features, multiple
   milestones, or work expected to span sessions and benefit from structured
   worker/validator orchestration. Propose a Factory Mission and obtain
   approval for its features, milestones, and validation plan before entering
   Mission Control.

Outside an approved Mission, the default subagent count is zero. Before every
Task call, including resuming an existing subagent, the active agent must tell
the user:

- which subagent would run and why direct execution is insufficient;
- its exact bounded scope and whether it may edit files;
- whether it runs serially or in parallel;
- why the work is genuinely independent rather than duplicate investigation.

The Task call may run only after explicit user approval. Propose at most one
subagent by default; two or more require separately justified, non-overlapping
workstreams and explicit approval. If the user says to work directly or not to
use subagents, do not call Task for that task. Do not use a fixed
planner/researcher/coder/tester pipeline. Prefer Skills and AGENTS.md for
repeatable methods; use subagents only for focused work that benefits from a
fresh context. Approval of a Mission plan authorizes only the workers and
validators within that approved plan.

When approved agents or Mission workers do run, these physical constraints
still apply:

- Two agents must not concurrently edit the same files in the same working
  directory.
- `pnpm run build`, `vsce package`, and `cursor --install-extension` share
  `dist/` and the global extension install location; only one agent may run
  them at a time.
- Concurrent editors of `docs/product/implementation-status.md` must merge,
  not overwrite, each other's entries.

## Current phase

The project is in implementation. Treat the user's current requirements and
the production code as the behavioral source of truth. Doc map:
`docs/README.md`. Current work snapshot:
`docs/debug/handover-2026-08-15.md`. Keep
`docs/product/implementation-status.md` accurate as the durable record of what
is production-wired, partial, probe-only, or not implemented. Follow
`docs/product/delivery-plan.md` for completion criteria. Do not add new
design/research files under `docs/product/` unless the work is not yet
started; land finished probes in `docs/archive/`.

The Cursor Secondary Sidebar is the primary chat surface. The retained Module
1 main-chat prototype is the visual reference for the warm DroidVisX shell,
responsive spacing, activity rows, and Composer. It is not a Runtime contract,
and visual sample data must not be treated as real Droid capability data. Do
not invent unsupported Droid capabilities.

## Execution model

- The active agent owns requirements, repository inspection, planning,
  architecture, implementation, integration, validation, review, status
  tracking, and the final answer.
- Define one bounded vertical slice with an observable completion criterion.
- Stabilize shared Bridge contracts before changing their consumers.
- Preserve explicit boundaries between Runtime, Extension Host, shared Bridge,
  and Webview code even though one agent implements all layers.
- Apply the three-level routing and delegation approval policy above before
  using any subagent.

## Delivery loop

1. The active agent inspects only the code needed for the requested feature.
2. Define one user-visible vertical slice and an observable completion
   criterion.
3. Implement the smallest required Runtime, Host, Bridge, and Webview changes
   in dependency order.
4. Validate (user order, 2026-08-13 evening — this REPLACES every earlier
   smoke/verification rule, including the "mandatory behavioral smoke"):
   run ONLY `tsc --noEmit`, `lint:budgets`, and the unit tests of files
   actually touched. Nothing else. NO full vitest suite, NO headless-Chrome
   smokes, NO screenshot probes, NO harness runs — unless the user asks for
   one by name in the current conversation, or a shipped bug cannot be
   reproduced any cheaper way. Time goes to shipping, not to self-acceptance.
5. Ship: build, `vsce package`, `cursor --install-extension`, tell the user
   to Reload Window. The user is the acceptance gate — they look at the real
   UI and send screenshots; fix what they report, by their screenshots.
6. Update `docs/product/implementation-status.md` in the same change
   (keep the entry short).

Capability research and probes must support an active product slice. Do not
expand them into standalone projects without explicit user approval.

## Engineering rules

- Preserve existing user changes and unrelated files.
- Follow repository-local conventions discovered from the codebase.
- UI restraint (user decision, 2026-08-12): when adding UI, reuse the
  existing quiet visual language (subtle text, existing trigger/hint
  patterns). Do NOT introduce new prominent styled elements (banners,
  filled pills, badges, colored bars) without the user seeing and
  approving the visual first. When in doubt, ship the most minimal
  indication possible.
- Visual bar (user decision, 2026-08-12): the target aesthetic is
  understated luxury ("轻奢") at Cursor's level of finish. Never ship
  plasticky flat colors or bare, undecorated cards. Every surface needs
  the full finish treatment consistent with the existing shell: layered
  warm neutrals, 1px borders, soft shadows, refined typography, precise
  spacing, subtle hover/transition feedback.
- Prefer small, coherent changes over broad rewrites.
- File line budgets are enforced by `pnpm run lint:budgets`
 (TS/TSX 900, CSS 800, tests 2000): new files must stay within budget,
 and over-budget work must be split before it lands. Existing offenders
 are ratcheted in `scripts/checkFileBudgets.mjs` and may only shrink.
- Keep modules narrow, dependencies explicit, and control flow easy to trace.
- Prefer functions and composition over managers, wrappers, inheritance, or
  speculative abstraction layers.
- Validate at trust boundaries; do not spread redundant guards, catch-all
  fallbacks, or impossible-state handling through internal code.
- Do not invent APIs, commands, or project structure; verify them locally.
- Treat generated files, lockfiles, migrations, and public contracts carefully.
- Report commands actually run, failures, skipped checks, and remaining risks.
- A capability is complete when its Runtime, Host, Bridge, UI, and touched-file
  tests are done and the build is installed; acceptance of behavior and
  visuals belongs to the user in the real UI (user order, 2026-08-13 evening).
- Full vitest runs at most once per release, and only when the release
  touched shared contracts (Bridge, store, validators). The `artifacts/`
  smoke scripts are frozen: do not run or maintain them unless the user
  asks; stale assertions there are acceptable rot, not work.
