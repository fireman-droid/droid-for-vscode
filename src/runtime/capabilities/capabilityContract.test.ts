import {
  FACTORY_PROTOCOL_VERSION,
  SDK_VERSION,
} from '@factory/droid-sdk/node';
import { describe, expect, it } from 'vitest';

import {
  DROID_CAPABILITY_DECLARATIONS,
  DROID_CAPABILITY_VERSIONS,
} from './capabilityContract';

describe('Droid capability contract', () => {
  it('is a complete, unique, deeply frozen evidence matrix', () => {
    const ids = DROID_CAPABILITY_DECLARATIONS.map(({ id }) => id);

    expect(ids).toHaveLength(56);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.isFrozen(DROID_CAPABILITY_DECLARATIONS)).toBe(true);
    for (const declaration of DROID_CAPABILITY_DECLARATIONS) {
      expect(declaration.access.length).toBeGreaterThan(0);
      expect(Object.isFrozen(declaration)).toBe(true);
      expect(Object.isFrozen(declaration.access)).toBe(true);
      for (const item of declaration.access) {
        expect(item.evidence.length).toBeGreaterThan(0);
        expect(Object.isFrozen(item)).toBe(true);
        expect(Object.isFrozen(item.evidence)).toBe(true);
      }
    }

    expect(ids).toEqual(
      expect.arrayContaining([
        'sessions.list',
        'sessions.load',
        'sessions.resume',
        'sessions.search',
        'sessions.rename',
        'sessions.archive',
        'sessions.fork',
        'sessions.compact',
        'sessions.rewind',
        'turns.streaming',
        'turns.thinking',
        'tools.execution',
        'permissions.requests',
        'permissions.ask-user',
        'settings.live',
        'settings.mode',
        'settings.model',
        'settings.reasoning',
        'settings.autonomy',
        'settings.context',
        'attachments.images',
        'attachments.documents',
        'skills.list',
        'commands.list',
        'custom-droids.list',
        'mcp.servers',
        'mcp.tools',
        'mcp.resources',
        'mcp.prompts',
        'spec.mode',
        'missions.session-mode-events',
        'missions.lifecycle',
        'worktrees.session-create',
        'worktrees.lifecycle',
        'terminals.lifecycle',
        'processes.background',
        'workspace.files',
        'git.pull-requests',
        'plugins.manage',
        'marketplaces.manage',
        'hooks.configure',
        'custom-models.manage',
        'auth.login',
        'account.profile',
        'account.usage',
        'account.org-policy',
        'diagnostics.observability',
        'diagnostics.feedback',
        'diagnostics.update',
        'automations.lifecycle',
        'automations.crons',
      ]),
    );
  });

  it('pins the installed public SDK and protocol versions', () => {
    expect(DROID_CAPABILITY_VERSIONS).toEqual({
      sdkVersion: SDK_VERSION,
      protocolVersion: FACTORY_PROTOCOL_VERSION,
    });
    expect(DROID_CAPABILITY_VERSIONS).toEqual({
      sdkVersion: '0.7.0',
      protocolVersion: '1.151.0',
    });
  });

  it('records stable attachments, history, mission, and worktree evidence', () => {
    expect(accessFor('attachments.images')).toEqual([
      {
        path: 'node-sdk',
        stability: 'stable',
        evidence: ['node-message-options-images'],
      },
      {
        path: 'daemon-sdk',
        stability: 'stable',
        evidence: ['daemon-message-options-images'],
      },
    ]);
    expect(accessFor('attachments.documents')).toEqual([
      {
        path: 'node-sdk',
        stability: 'stable',
        evidence: ['node-message-options-files'],
      },
      {
        path: 'daemon-sdk',
        stability: 'stable',
        evidence: ['daemon-message-options-files'],
      },
    ]);
    expect(accessFor('sessions.load')).toEqual([
      {
        path: 'node-sdk',
        stability: 'stable',
        evidence: ['node-client-load-session'],
      },
      {
        path: 'daemon-sdk',
        stability: 'stable',
        evidence: ['daemon-session-messages'],
      },
    ]);
    expect(accessFor('missions.session-mode-events')).toEqual([
      {
        path: 'node-sdk',
        stability: 'stable',
        evidence: ['node-mission-mode-events'],
      },
      {
        path: 'daemon-sdk',
        stability: 'stable',
        evidence: ['daemon-mission-mode-events'],
      },
    ]);
    expect(accessFor('missions.lifecycle')).toEqual([
      {
        path: 'daemon-sdk',
        stability: 'unstable',
        evidence: ['daemon-unstable-mission-readiness'],
      },
      {
        path: 'needs-research',
        stability: 'unresolved',
        evidence: ['no-stable-mission-lifecycle-controller'],
      },
    ]);
    expect(accessFor('worktrees.session-create')).toEqual([
      {
        path: 'daemon-sdk',
        stability: 'stable',
        evidence: ['daemon-session-create-worktree-options'],
      },
    ]);
    expect(accessFor('worktrees.lifecycle')).toEqual([
      {
        path: 'needs-research',
        stability: 'unresolved',
        evidence: ['no-dedicated-worktree-resource'],
      },
    ]);
  });

  it('keeps unsupported and unstable areas explicit', () => {
    expect(accessFor('automations.crons')).toEqual([
      {
        path: 'daemon-sdk',
        stability: 'unstable',
        evidence: ['daemon-unstable-crons'],
      },
    ]);
    expect(accessFor('hooks.configure')).toEqual([
      {
        path: 'config',
        stability: 'config-only',
        evidence: ['factory-hooks-config'],
      },
    ]);
  });
});

function accessFor(
  id: (typeof DROID_CAPABILITY_DECLARATIONS)[number]['id'],
) {
  return DROID_CAPABILITY_DECLARATIONS.find(
    (declaration) => declaration.id === id,
  )?.access;
}
