import {
  FACTORY_PROTOCOL_VERSION,
  SDK_VERSION,
} from '@factory/droid-sdk/node';

export const DROID_CAPABILITY_SCHEMA_VERSION = '0.1' as const;
export const DROID_CAPABILITY_REPORT_VERSION = 1 as const;
export const MAX_CAPABILITY_COUNT = 10_000;

export type DroidCapabilityAccessPath =
  | 'node-sdk'
  | 'daemon-sdk'
  | 'cli'
  | 'config'
  | 'unsupported'
  | 'needs-research';

export type DroidCapabilityStability =
  | 'stable'
  | 'unstable'
  | 'config-only'
  | 'unresolved';

export type DroidCapabilityProbeState =
  | 'supported'
  | 'unavailable'
  | 'not-probed';

export interface DroidCapabilityAccess {
  readonly path: DroidCapabilityAccessPath;
  readonly stability: DroidCapabilityStability;
  readonly evidence: readonly string[];
}

export interface DroidCapabilityDeclaration {
  readonly id: DroidCapabilityId;
  readonly access: readonly DroidCapabilityAccess[];
}

const declarations = [
  capability('runtime.cli-version', access('cli', 'stable', 'factory-cli')),
  capability(
    'sessions.list',
    access('node-sdk', 'stable', 'node-list-sessions'),
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.load',
    access('node-sdk', 'stable', 'node-client-load-session'),
    access('daemon-sdk', 'stable', 'daemon-session-messages'),
  ),
  capability(
    'sessions.resume',
    access('node-sdk', 'stable', 'node-resume-session'),
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.search',
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.rename',
    access('node-sdk', 'stable', 'node-session'),
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.archive',
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.fork',
    access('node-sdk', 'stable', 'node-session-replacements'),
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.compact',
    access('node-sdk', 'stable', 'node-session-replacements'),
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'sessions.rewind',
    access('node-sdk', 'stable', 'node-session-replacements'),
    access('daemon-sdk', 'stable', 'daemon-sessions'),
  ),
  capability(
    'turns.streaming',
    access('node-sdk', 'stable', 'node-session-stream'),
    access('daemon-sdk', 'stable', 'daemon-session-stream'),
  ),
  capability(
    'turns.thinking',
    access('node-sdk', 'stable', 'sdk-stream-events'),
    access('daemon-sdk', 'stable', 'sdk-stream-events'),
  ),
  capability(
    'tools.execution',
    access('node-sdk', 'stable', 'sdk-stream-events'),
    access('daemon-sdk', 'stable', 'sdk-stream-events'),
  ),
  capability(
    'permissions.requests',
    access('node-sdk', 'stable', 'sdk-interaction-handlers'),
    access('daemon-sdk', 'stable', 'sdk-interaction-handlers'),
  ),
  capability(
    'permissions.ask-user',
    access('node-sdk', 'stable', 'sdk-interaction-handlers'),
    access('daemon-sdk', 'stable', 'sdk-interaction-handlers'),
  ),
  capability(
    'settings.live',
    access('node-sdk', 'stable', 'node-session-state'),
    access('daemon-sdk', 'stable', 'daemon-session-state'),
  ),
  capability(
    'settings.mode',
    access('node-sdk', 'stable', 'node-session-settings'),
    access('daemon-sdk', 'stable', 'daemon-session-settings'),
    access('config', 'config-only', 'factory-settings'),
  ),
  capability(
    'settings.model',
    access('node-sdk', 'stable', 'node-session-settings'),
    access('daemon-sdk', 'stable', 'daemon-session-settings'),
    access('config', 'config-only', 'factory-settings'),
  ),
  capability(
    'settings.reasoning',
    access('node-sdk', 'stable', 'node-session-settings'),
    access('daemon-sdk', 'stable', 'daemon-session-settings'),
    access('config', 'config-only', 'factory-settings'),
  ),
  capability(
    'settings.autonomy',
    access('node-sdk', 'stable', 'node-session-settings'),
    access('daemon-sdk', 'stable', 'daemon-session-settings'),
    access('config', 'config-only', 'factory-settings'),
  ),
  capability(
    'settings.context',
    access('node-sdk', 'stable', 'node-context-stats'),
    access('daemon-sdk', 'stable', 'daemon-context'),
  ),
  capability(
    'attachments.images',
    access('node-sdk', 'stable', 'node-message-options-images'),
    access('daemon-sdk', 'stable', 'daemon-message-options-images'),
  ),
  capability(
    'attachments.documents',
    access('node-sdk', 'stable', 'node-message-options-files'),
    access('daemon-sdk', 'stable', 'daemon-message-options-files'),
  ),
  capability(
    'skills.list',
    access('node-sdk', 'stable', 'node-skills'),
    access('daemon-sdk', 'stable', 'daemon-skills'),
  ),
  capability(
    'skills.manage',
    access('node-sdk', 'stable', 'node-skills'),
    access('daemon-sdk', 'stable', 'daemon-skills'),
    access('config', 'config-only', 'factory-skills-config'),
  ),
  capability(
    'commands.list',
    access('daemon-sdk', 'stable', 'daemon-commands'),
    access('config', 'config-only', 'factory-commands-config'),
  ),
  capability(
    'custom-droids.list',
    access('config', 'config-only', 'factory-custom-droids-config'),
  ),
  capability(
    'custom-droids.manage',
    access('config', 'config-only', 'factory-custom-droids-config'),
  ),
  capability(
    'mcp.servers',
    access('node-sdk', 'stable', 'node-mcp'),
    access('daemon-sdk', 'stable', 'daemon-mcp'),
    access('config', 'config-only', 'factory-mcp-config'),
  ),
  capability(
    'mcp.tools',
    access('node-sdk', 'stable', 'node-mcp'),
    access('daemon-sdk', 'stable', 'daemon-mcp'),
  ),
  capability(
    'mcp.resources',
    access('needs-research', 'unresolved', 'mcp-resource-gap'),
  ),
  capability(
    'mcp.prompts',
    access('needs-research', 'unresolved', 'mcp-prompt-gap'),
  ),
  capability(
    'spec.mode',
    access('node-sdk', 'stable', 'node-spec-mode'),
    access('daemon-sdk', 'stable', 'daemon-session-settings'),
  ),
  capability(
    'missions.session-mode-events',
    access('node-sdk', 'stable', 'node-mission-mode-events'),
    access('daemon-sdk', 'stable', 'daemon-mission-mode-events'),
  ),
  capability(
    'missions.lifecycle',
    access('daemon-sdk', 'unstable', 'daemon-unstable-mission-readiness'),
    access(
      'needs-research',
      'unresolved',
      'no-stable-mission-lifecycle-controller',
    ),
  ),
  capability(
    'worktrees.session-create',
    access('daemon-sdk', 'stable', 'daemon-session-create-worktree-options'),
  ),
  capability(
    'worktrees.lifecycle',
    access(
      'needs-research',
      'unresolved',
      'no-dedicated-worktree-resource',
    ),
  ),
  capability(
    'terminals.lifecycle',
    access('daemon-sdk', 'stable', 'daemon-terminals'),
  ),
  capability(
    'processes.background',
    access('needs-research', 'unresolved', 'background-process-gap'),
  ),
  capability(
    'workspace.cwd',
    access('node-sdk', 'stable', 'node-session-state'),
    access('daemon-sdk', 'stable', 'daemon-workspace'),
  ),
  capability(
    'workspace.files',
    access('daemon-sdk', 'stable', 'daemon-workspace'),
  ),
  capability(
    'git.repository',
    access('daemon-sdk', 'stable', 'daemon-git'),
  ),
  capability(
    'git.pull-requests',
    access('daemon-sdk', 'stable', 'daemon-git'),
  ),
  capability(
    'plugins.manage',
    access('daemon-sdk', 'stable', 'daemon-plugins'),
    access('config', 'config-only', 'factory-plugins-config'),
  ),
  capability(
    'marketplaces.manage',
    access('daemon-sdk', 'stable', 'daemon-marketplaces'),
    access('config', 'config-only', 'factory-marketplaces-config'),
  ),
  capability(
    'hooks.configure',
    access('config', 'config-only', 'factory-hooks-config'),
  ),
  capability(
    'custom-models.manage',
    access('daemon-sdk', 'stable', 'daemon-custom-models'),
    access('config', 'config-only', 'factory-custom-models-config'),
  ),
  capability(
    'auth.login',
    access('cli', 'stable', 'factory-auth-cli'),
  ),
  capability(
    'account.profile',
    access('needs-research', 'unresolved', 'account-api-gap'),
  ),
  capability(
    'account.usage',
    access('needs-research', 'unresolved', 'account-usage-api-gap'),
  ),
  capability(
    'account.org-policy',
    access('needs-research', 'unresolved', 'org-policy-api-gap'),
  ),
  capability(
    'diagnostics.observability',
    access('node-sdk', 'stable', 'sdk-observability'),
  ),
  capability(
    'diagnostics.feedback',
    access('daemon-sdk', 'stable', 'daemon-feedback'),
  ),
  capability(
    'diagnostics.update',
    access('daemon-sdk', 'stable', 'daemon-updates'),
    access('cli', 'stable', 'factory-update-cli'),
  ),
  capability(
    'automations.lifecycle',
    access('daemon-sdk', 'stable', 'daemon-automations'),
  ),
  capability(
    'automations.crons',
    access('daemon-sdk', 'unstable', 'daemon-unstable-crons'),
  ),
] as const;

export type DroidCapabilityId = (typeof declarations)[number]['id'];

export const DROID_CAPABILITY_DECLARATIONS: readonly DroidCapabilityDeclaration[] =
  deepFreezeDeclarations(declarations);

export const DROID_CAPABILITY_VERSIONS = Object.freeze({
  sdkVersion: SDK_VERSION,
  protocolVersion: FACTORY_PROTOCOL_VERSION,
});

function capability<const Id extends string>(
  id: Id,
  ...capabilityAccess: readonly DroidCapabilityAccess[]
): {
  readonly id: Id;
  readonly access: readonly DroidCapabilityAccess[];
} {
  return { id, access: capabilityAccess };
}

function access(
  path: DroidCapabilityAccessPath,
  stability: DroidCapabilityStability,
  ...evidence: readonly string[]
): DroidCapabilityAccess {
  return { path, stability, evidence };
}

function deepFreezeDeclarations<
  const T extends readonly {
    readonly id: string;
    readonly access: readonly DroidCapabilityAccess[];
  }[],
>(values: T): T {
  for (const declaration of values) {
    for (const item of declaration.access) {
      Object.freeze(item.evidence);
      Object.freeze(item);
    }
    Object.freeze(declaration.access);
    Object.freeze(declaration);
  }
  return Object.freeze(values);
}
