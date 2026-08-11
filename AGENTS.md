# Project Instructions

This repository uses one implementation agent. Do not delegate repository
work to subagents unless the user explicitly asks for delegation.

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
- Do not invoke planner, explorer, writer, tester, reviewer, or research
  subagents unless the user explicitly requests them.

## Delivery loop

1. The active agent inspects only the code needed for the requested feature.
2. Define one user-visible vertical slice and an observable completion
   criterion.
3. Implement the smallest required Runtime, Host, Bridge, and Webview changes
   in dependency order.
4. Run focused validation while implementing.
5. Review the integrated result and fix correctness, accessibility,
   responsiveness, and visual issues.
6. Run broad tests, type checks, and builds once at the end when justified.
7. Package and perform visible browser and Cursor verification when the slice
   affects the extension UI.
8. Update `docs/product/implementation-status.md` in the same change.

Capability research and probes must support an active product slice. Do not
expand them into standalone projects without explicit user approval.

## Engineering rules

- Preserve existing user changes and unrelated files.
- Follow repository-local conventions discovered from the codebase.
- Prefer small, coherent changes over broad rewrites.
- Keep modules narrow, dependencies explicit, and control flow easy to trace.
- Prefer functions and composition over managers, wrappers, inheritance, or
  speculative abstraction layers.
- Validate at trust boundaries; do not spread redundant guards, catch-all
  fallbacks, or impossible-state handling through internal code.
- Do not invent APIs, commands, or project structure; verify them locally.
- Treat generated files, lockfiles, migrations, and public contracts carefully.
- Run focused checks first and broader checks in proportion to risk.
- Report commands actually run, failures, skipped checks, and remaining risks.
- Do not declare success based only on code edits; verify observable behavior.
- A capability is complete only when its Runtime, Host, Bridge, UI, tests,
  package, and visible verification are complete for the agreed scope.
