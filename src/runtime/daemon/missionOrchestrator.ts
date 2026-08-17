import { randomUUID } from 'node:crypto';

import type { ConnectedDroid, ConnectedDroidSession } from '@factory/droid-sdk';

import type { MissionReasoningEffort } from '../../shared/missionProtocol';

export interface MissionOrchestratorCreateOptions {
  readonly droid: ConnectedDroid;
  readonly cwd: string;
  readonly modelId: string;
  readonly reasoningEffort: MissionReasoningEffort;
  /**
   * Generated once by the Host and kept Host-side. It is never a Bridge
   * scope or a Webview-controlled target.
   */
  readonly missionId: string;
}

/**
 * Generates an opaque daemon Mission identity. Session IDs remain daemon
 * generated, while this identity makes the official orchestrator tags
 * durably attributable during recovery.
 */
export function createMissionOrchestratorIdentity(): string {
  return randomUUID();
}

/**
 * Creates one independent official Mission orchestrator. This deliberately
 * does not reuse the selected main-chat Session and returns the attached
 * SDK handle only to the Extension Host.
 */
export async function createMissionOrchestrator(
  options: MissionOrchestratorCreateOptions,
): Promise<ConnectedDroidSession> {
  return options.droid.sessions.create({
    cwd: options.cwd,
    modelId: options.modelId,
    reasoningEffort: options.reasoningEffort as never,
    tags: [
      { name: 'mission-orchestrator' },
      {
        name: 'mission-session',
        metadata: { role: 'orchestrator', missionId: options.missionId },
      },
    ],
  });
}
