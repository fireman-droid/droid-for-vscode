# Project Agent Workflow

This repository uses a quality-first multi-agent workflow for non-trivial work.
The primary agent remains responsible for scope, orchestration, integration,
validation, and the final answer.

## Role routing

- Use `planner` for architecture, dependency analysis, staged implementation
  plans, risk analysis, and validation strategy.
- Use `explorer` for independent read-only repository mapping and targeted
  investigations that can run in parallel.
- Use `code_writer` for production implementation after scope, dependencies,
  and file ownership are clear.
- Use `tester` for test implementation, regression coverage, and independent
  verification.
- Use `reviewer` after implementation and testing for final quality review.

Small, localized changes do not require delegation. For substantial work,
start with planning and use subagents only for bounded workstreams that can
proceed independently or benefit from isolated context.

## Orchestration contract

1. Inspect the repository and clarify the desired outcome.
2. Ask `planner` for an evidence-backed plan before substantial edits.
3. Use `explorer` in parallel only when separate discovery questions exist.
4. Assign each implementation workstream to one `code_writer` with explicit
   file ownership and acceptance criteria.
5. Never let two active agents edit the same file or overlapping code paths.
6. Respect dependency order; do not parallelize work whose inputs are not yet
   stable.
7. Ask `tester` to cover changed behavior and run relevant validation.
8. Ask `reviewer` to inspect the integrated result after tests complete.
9. Resolve material findings, rerun affected checks, and only then report
   completion.

Wait for all delegated work needed by the current stage before integrating or
moving to a dependent stage. Return distilled findings and decisions to the
primary thread instead of dumping raw logs.

## Engineering rules

- Preserve existing user changes and unrelated files.
- Follow repository-local conventions discovered from the codebase.
- Prefer small, coherent changes over broad rewrites.
- Do not invent APIs, commands, or project structure; verify them locally.
- Treat generated files, lockfiles, migrations, and public contracts carefully.
- Run focused checks first and broader checks in proportion to risk.
- Report commands actually run, failures, skipped checks, and remaining risks.
- Do not declare success based only on code edits; verify observable behavior.

## Example invocation

For a large feature, ask Codex:

> Use the project agent workflow. Have `planner` produce the implementation
> plan, delegate independent discovery to `explorer`, assign non-overlapping
> workstreams to `code_writer`, then use `tester` and `reviewer`. Wait for each
> dependency stage and return one integrated result.
