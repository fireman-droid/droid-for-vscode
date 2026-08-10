# Project Instructions

This repository uses one primary agent plus dedicated backend and frontend
code-writing subagents. Avoid broader multi-agent orchestration unless the
user explicitly asks for it.

## Current phase

The project is in implementation. Treat the user's current requirements and
the production code as the behavioral source of truth. Keep
`docs/product/implementation-status.md` accurate as the durable record of what
is production-wired, partial, probe-only, or not implemented. Follow
`docs/product/delivery-plan.md` for module order, execution boundaries, and
completion criteria.

The Cursor Secondary Sidebar is the primary chat surface. The previous UI
specification and concept images are obsolete and must not be restored or used
as implementation requirements. Do not invent unsupported Droid capabilities
or turn visual sample data into an implicit runtime contract.

## Execution model

- The primary agent owns requirements, repository inspection, planning,
  architecture, integration, validation, review, status tracking, and the
  final answer.
- Delegate Runtime, Extension Host, shared Bridge contract, and related test
  implementation to `backend-writer`.
- Delegate Webview, assistant-ui, styling, accessibility, and related test
  implementation to `frontend-writer`.
- Both writers use the configured BYOK `custom:gpt-5.6-terra` model.
- The primary agent defines one bounded vertical slice, explicit file
  ownership, acceptance criteria, and the integration boundary for both
  writers.
- `backend-writer` owns `src/runtime/**`, `src/extension/**`, and
  `src/shared/**` by default. `frontend-writer` owns `src/webview/**` by
  default.
- Stabilize and review the shared Bridge contract before frontend
  implementation consumes it.
- Run the two writers in parallel only when the shared contract is already
  frozen and their file ownership is disjoint. Otherwise run backend first,
  then frontend.
- Do not invoke planner, explorer, tester, reviewer, or research subagents as a
  routine workflow. Use another subagent only when the user explicitly asks.
- Never let the writers edit the same file or silently change each other's
  contracts.

## Delivery loop

1. The primary agent inspects only the code needed for the requested feature.
2. Define one user-visible vertical slice and an observable completion
   criterion.
3. Delegate Runtime, Host, Bridge contract, and backend tests to
   `backend-writer`.
4. After the Bridge contract is frozen, delegate Webview and frontend tests to
   `frontend-writer`.
5. The primary agent reviews and integrates both results, then runs focused
   validation.
6. Run broad tests, type checks, and builds once at the end when justified.
7. Package and perform visible Cursor verification when the requested slice
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
