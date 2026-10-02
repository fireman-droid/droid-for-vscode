import type { DaemonApi, DaemonCreateSessionOptions, DaemonSessionHandle } from './api';
import { randomUUID } from 'node:crypto';

import type { MissionReasoningEffort } from '../../shared/protocol/missionProtocol';
import type { RuntimeInteractionCallbacks } from '../events/runtimeInteractions';

export interface MissionOrchestratorCreateOptions {
  readonly droid: DaemonApi;
  readonly cwd: string;
  readonly systemPrompt?: import('../../shared/protocol/systemPromptProtocol').SessionSystemPrompt;
  readonly modelId: string;
  readonly reasoningEffort: MissionReasoningEffort;
  readonly missionSettings?: DaemonCreateSessionOptions['missionSettings'];
  /**
   * Generated once by the Host and kept Host-side. It is never a Bridge
   * scope or a Webview-controlled target.
   */
  readonly missionId: string;
  readonly callbacks: RuntimeInteractionCallbacks;
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
): Promise<DaemonSessionHandle> {
  return options.droid.sessions.create({
    ...options.callbacks,
    cwd: options.cwd,
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    modelId: options.modelId,
    reasoningEffort: options.reasoningEffort as never,
    ...(options.missionSettings === undefined ? {} : { missionSettings: options.missionSettings }),
    tags: [
      { name: 'mission-orchestrator' },
      {
        name: 'mission-session',
        metadata: { role: 'orchestrator', missionId: options.missionId },
      },
    ],
  });
}
