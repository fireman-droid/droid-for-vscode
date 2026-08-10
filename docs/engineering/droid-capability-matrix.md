# Droid capability matrix

- Status date: **2026-08-10**
- Capability schema: **0.1**
- Repository SDK: **`@factory/droid-sdk` 0.7.0**
- Factory protocol: **1.151.0**

This matrix is the Host-side gate for DroidVisX controls. The Droid CLI and
official SDK remain the only capability authority. A prototype control, a
protocol type, or data observed in a response is not by itself an integration
contract.

## Evidence and interpretation

Authoritative evidence used for this snapshot:

- [Factory TypeScript SDK repository](https://github.com/Factory-AI/droid-sdk-typescript)
- [Official TypeScript SDK reference source](https://github.com/Factory-AI/droid-sdk-typescript/blob/main/docs/typescript-sdk-reference.md)
- [Published SDK 0.7.0 package](https://www.npmjs.com/package/@factory/droid-sdk/v/0.7.0)

Access labels have deliberately narrow meanings:

- **Node**: exported by a public `@factory/droid-sdk/node` API.
- **Daemon**: exported by the stable `@factory/droid-sdk` daemon facade.
- **Daemon unstable**: exported only below `droid.unstable`; it may change
  between SDK releases and requires an application-owned adapter.
- **Config / CLI**: documented configuration or an interactive/local CLI path,
  not a callable session API.
- **Unresolved**: no supported public contract has been established.
- **Unsupported**: the installed public SDK has no corresponding application
  API; DroidVisX must not infer one from internal protocol declarations.

The schema currently declares **56 capability IDs**.

The daemon currently authenticates with a Factory API key. That makes it
appropriate only for a trusted Host-side integration. A key must never be
placed in Webview JavaScript, a URL, a capability report, logs, or persisted by
DroidVisX. Daemon access is therefore evidence of SDK availability, not an
approval to switch DroidVisX away from its current local `ProcessTransport`.

## Declaration matrix

“Current” describes DroidVisX as of the status date:

- **Host baseline**: already represented by the existing Host runtime.
- **Probe only**: the new opt-in probe performs a no-prompt, read-only
  structural check.
- **Gated**: declared for future work but not exposed as a product control.
- **Blocked**: no supported contract is available.

| Capability IDs | Public Node | Stable daemon | Unstable daemon | Config / CLI | Current |
| --- | --- | --- | --- | --- | --- |
| `sessions.list`, `sessions.resume` | `listSessions`, `resumeSession` | `sessions.list`, `sessions.resume` | — | CLI session UI exists separately | Host baseline; probe only |
| `sessions.load` | Public low-level `DroidClient.loadSession`; this is not a high-level `DroidSession` history method | `sessions.getMessages` | — | — | Gated |
| `sessions.search` | — | `sessions.search` | — | — | Gated |
| `sessions.rename` | `DroidSession.rename` | `sessions.rename` | — | CLI | Gated |
| `sessions.archive` | — | `sessions.archive` / `unarchive` | — | CLI | Gated |
| `sessions.fork`, `sessions.compact`, `sessions.rewind` | Public replacement operations | Stable session operations | — | CLI | Gated; mutation forbidden in probe |
| `turns.streaming`, `turns.thinking`, `tools.execution` | Public stream/events and `listTools` | Public stream/events | — | CLI | Host baseline; tool list is probe only |
| `permissions.requests`, `permissions.ask-user` | Public cancelling/settling handlers | Public handlers | — | CLI | Host baseline; probe always cancels |
| `settings.live`, `settings.mode`, `settings.model`, `settings.reasoning`, `settings.autonomy` | Live read-only settings and explicit mutation method | Session settings and defaults resources | — | Settings files | Live presence is probe only; controls gated |
| `settings.context` | `getContextStats` | Session context operations | — | — | Probe only |
| `attachments.images`, `attachments.documents` | `DroidSession.stream` accepts `MessageOptions.images` / `files` | `ConnectedDroidSession.stream` accepts the same `MessageOptions` | — | — | Stable runtime access; no DroidVisX UI support claimed |
| `skills.list` | `listSkills` | `skills.list` | — | Skill files/settings | Probe only |
| `skills.manage` | `setSkillDisabled` | `skills.setDisabled` | — | Skill files/settings | Gated; mutation forbidden in probe |
| `commands.list` | — | `commands.list` | — | Command files/settings | Gated |
| `custom-droids.list`, `custom-droids.manage` | — | — | — | Configuration only | Gated; no runtime API claimed |
| `mcp.servers`, `mcp.tools` | Public list and mutation methods | Full MCP resource | — | MCP settings | Lists are probe only; mutation/auth forbidden |
| `mcp.resources`, `mcp.prompts` | Unresolved | Unresolved | — | MCP configuration does not establish runtime listing | Blocked pending evidence |
| `spec.mode` | Public session settings / `enterSpecMode` | Session settings | — | CLI/settings | Gated |
| `missions.session-mode-events` | Public `DroidInteractionMode.Mission` and mission session notifications | Public protocol-backed mission session events | — | CLI has separate flows | Stable runtime signals; no dedicated lifecycle controller claimed |
| `missions.lifecycle` | Session mode/events do not establish lifecycle control | — | `missions.inspectReadiness` and `acknowledgeReadinessWarning` only | CLI has separate flows | Blocked pending lifecycle research |
| `worktrees.session-create` | — | Session create options expose `worktree` and `worktreeDir` | — | CLI | Gated |
| `worktrees.lifecycle` | — | No dedicated public resource in `DaemonResources` | — | CLI | Blocked pending evidence |
| `terminals.lifecycle` | — | `terminals` resource | — | CLI | Gated |
| `processes.background` | — | No dedicated stable process resource established | — | CLI | Blocked pending evidence |
| `workspace.cwd` | Live session cwd | `workspace` resource | — | CLI | Host baseline; presence is probe only |
| `workspace.files` | — | List/search/read file methods | — | CLI/tools | Gated |
| `git.repository`, `git.pull-requests` | Tool execution is not a Git control API | `git` resource | — | CLI/tools | Gated |
| `plugins.manage`, `marketplaces.manage` | — | Stable resources | — | Configuration | Gated |
| `hooks.configure` | Hook notifications/types are not a management API | — | — | Configuration only | Gated |
| `custom-models.manage` | Session model selection is not custom-model management | `customModels` resource | — | Configuration | Gated |
| `auth.login` | — | Daemon accepts Host-side API-key auth | — | CLI login | Gated; credentials never reported |
| `account.profile`, `account.usage`, `account.org-policy` | Unresolved | Unresolved | — | CLI/config behavior is not a public data API | Blocked pending evidence |
| `diagnostics.observability` | Public injected observability | — | — | CLI diagnostics | Gated |
| `diagnostics.feedback` | No public session facade method | `feedback` resource | — | CLI | Gated |
| `diagnostics.update` | — | `updates.trigger` | — | CLI update | Gated |
| `automations.lifecycle` | — | `automations` resource | — | CLI/config | Gated |
| `automations.crons` | — | — | `unstable.crons` | CLI/config | Gated behind unstable adapter |

Attachment support here is runtime-only evidence:
`MessageOptions.images` is `Base64ImageSource[]` and `MessageOptions.files` is
`DocumentSource[]`; the SDK reference documents JPEG, PNG, GIF, WebP, text,
and PDF inputs. Mission session notifications cover state, features, progress,
heartbeat, and worker events. Neither surface implies a DroidVisX control.

## Runtime probe contract

`FactoryDroidCapabilityProbe` is Host-only and injectable. Its real local path:

1. Executes `droid --version` with `execFile`, no shell, a five-second timeout,
   and bounded captured output.
2. Calls `listSessions({cwd, limit: 1})` and resumes that session when present.
   When none exists, it reports `no-saved-session` without creating a transport
   or session.
3. For an existing session only, uses a cwd-scoped `ProcessTransport`,
   auto-rejects permissions, cancels AskUser, and sends no prompt.
4. Reads only live settings/cwd presence, `listTools`, `listSkills`,
   `listMcpServers`, `listMcpTools`, and `getContextStats`.
5. Emits versions, fixed state/reason codes, bounded counts, and field-presence
   booleans. It does not emit credentials, paths, IDs, names, values, content,
   URLs, prompts, or raw errors.
6. Closes the session-owned SDK client and then the transport, while reporting
   cleanup failure without serializing the error. Cleanup is `not-needed` when
   no saved session exists.
7. Applies a finite five-second deadline independently to session listing,
   transport connection, session resume, every asynchronous structural read,
   session close, and transport close. Resume timeout aborts the SDK open
   signal; all acquired resources still receive bounded cleanup attempts.

The smoke entry point is implemented as `pnpm smoke:capabilities` and requires
`DROIDVISX_RUN_CAPABILITY_SMOKE=1`. It is no-prompt, non-creating, and
read-only; it only resumes an existing saved session. Smoke success fails
closed: the CLI check, session listing and resume, every expected settings,
cwd, tool, skill, MCP, and context projection, and session/transport cleanup
must all report supported/succeeded. Any unavailable, malformed, partial, or
timed-out required result exits unsuccessfully.

A successful opt-in local smoke run completed after the deadline and
fail-closed hardening in this snapshot, with CLI `0.190.0`: one saved session
was resumed, all seven structural observation groups and every required
capability projection were supported, and cleanup succeeded. The single JSON
report was reviewed and contained only versions, bounded counts,
field-presence booleans, fixed capability IDs, and fixed state/reason values.
It contained no names, paths, session IDs, settings values, content, URLs,
prompts, credentials, or raw errors.

## Unresolved gaps

1. MCP resource and prompt discovery.
2. Mission lifecycle control beyond unstable readiness calls and stable
   session mode/events.
3. Dedicated worktree lifecycle and background-process lifecycle ownership.
4. Account profile, usage, and organization-policy reads.
5. A secure daemon authentication/key handoff suitable for an Extension Host
   without exposing credentials to a Webview.
6. Compatibility behavior when CLI and SDK protocol versions differ.

Until resolved with official evidence, these remain hidden or disabled. Droid
session files, unexported SDK internals, raw daemon protocol messages, and
prototype sample data are not acceptable substitutes.

## Upgrade rules

For every SDK or CLI upgrade:

1. Pin and review the SDK version and exported `FACTORY_PROTOCOL_VERSION`.
2. Diff public Node and daemon declarations against this matrix.
3. Treat additions below `unstable` as unstable even if their shapes look
   complete.
4. Re-run focused capability tests before any opt-in real smoke.
5. Run the smoke only with explicit operator consent; retain only the sanitized
   structural report.
6. Promote a capability to a product control only after a Host adapter,
   hostile-safe bridge contract, focused tests, cleanup behavior, and rollback
   path exist.
7. On a removed, renamed, malformed, or failed probe, fail closed and hide the
   dependent control.

## Dependency-ordered next slices

1. **Read-only Host gate consumption:** make Host controllers consume stable
   capability IDs; do not alter the Webview contract yet.
2. **Session history adapter:** add a bounded Host projection over public
   low-level Node `DroidClient.loadSession` or stable daemon history access.
3. **Settings and context reads:** expose only fields whose support probes pass;
   keep mutations separate.
4. **Explicit mutation slices:** rename/archive, then fork/compact/rewind, each
   with replacement and recovery tests.
5. **Discovery slices:** commands, MCP, Skills, plugins, and marketplaces;
   lists before mutations or authentication.
6. **Daemon-only adapters:** workspace/files, terminals, Git/PR, automations,
   diagnostics, and custom models, only after Host-side auth is approved.
7. **Unstable adapters:** missions and crons last, version-pinned and isolated.
8. **Blocked areas:** dedicated worktree/background-process lifecycle, MCP
   resources/prompts, and account/org data remain research tasks rather than
   implied controls.
