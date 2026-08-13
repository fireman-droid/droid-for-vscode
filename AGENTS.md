# Project Instructions

Delegation and parallel agents are allowed: anything the Cursor agent
platform supports (background subagents, parallel workers, worktrees) may be
used freely (user decision, 2026-08-12). The only remaining constraints are
physical resource conflicts, not policy:

- Two agents must not concurrently edit the same files in the same working
  directory.
- `pnpm run build`, `vsce package`, and `cursor --install-extension` share
  `dist/` and the global extension install location; only one agent may run
  them at a time.
- Concurrent editors of `docs/product/implementation-status.md` must merge,
  not overwrite, each other's entries.

## Current phase

The project is in implementation. Treat the user's current requirements and
the production code as the behavioral source of truth. Keep
`docs/product/implementation-status.md` accurate as the durable record of what
is production-wired, partial, probe-only, or not implemented. Follow
`docs/product/delivery-plan.md` for module order, execution boundaries, and
completion criteria.

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
- Subagents of any kind (planner, explorer, writer, tester, reviewer,
  research) may be used whenever they help; respect the physical resource
  constraints listed at the top of this file.

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
