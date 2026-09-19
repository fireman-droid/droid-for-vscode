import type { DaemonApi, DaemonSessionHandle } from '../../../runtime/daemon/api';

import { FactoryDroidRuntime } from '../../../runtime/FactoryDroidRuntime';
import { adaptConnectedDaemonSession } from '../../../runtime/daemon/createDaemonDroidSession';
import type { SessionLeaseHooks } from '../../../runtime/daemon/createDaemonDroidSession';
import type { RuntimeInteractionHandler } from '../../../runtime/events/runtimeInteractions';
import type { MissionProfilePair } from './MissionPreferences';
import type { MissionGatewayRuntime } from './MissionGateway';

/**
 * Retains the exact session created by MissionGateway. The normal runtime
 * factory would create or resume a handle, which is unsafe while Mission
 * initialization depends on in-memory settings retained by this attachment.
 */
export function createMissionRuntime(
  session: DaemonSessionHandle,
  droid: DaemonApi,
  interactionHandler: RuntimeInteractionHandler,
  _orchestrator: MissionProfilePair,
  lease: SessionLeaseHooks,
): MissionGatewayRuntime {
  const runtime = new FactoryDroidRuntime({
    interactionHandler,
    createSdkSession: async () =>
      adaptConnectedDaemonSession(droid, session, interactionHandler, lease),
  });
  return {
    runtime,
    async initialize(): Promise<void> {
      await runtime.initialize({
        kind: 'resume',
        cwd: session.cwd ?? '',
        sessionId: session.id,
      });
    },
  };
}
