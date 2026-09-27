import type { DaemonApi, DaemonSessionHandle } from '../../../runtime/daemon/api';

import { FactoryDroidRuntime } from '../../../runtime/FactoryDroidRuntime';
import { adaptConnectedDaemonSession } from '../../../runtime/daemon/createDaemonDroidSession';
import type { SessionLeaseHooks } from '../../../runtime/daemon/createDaemonDroidSession';
import type { MissionProfilePair } from './MissionPreferences';
import type {
  MissionGatewayRuntime,
  MissionRuntimeInteractions,
} from './MissionGateway';

/**
 * Retains the exact session created by MissionGateway. The normal runtime
 * factory would create or resume a handle, which is unsafe while Mission
 * initialization depends on in-memory settings retained by this attachment.
 */
export function createMissionRuntime(
  session: DaemonSessionHandle,
  droid: DaemonApi,
  interactions: MissionRuntimeInteractions,
  _orchestrator: MissionProfilePair,
  lease: SessionLeaseHooks,
): MissionGatewayRuntime {
  const runtime = new FactoryDroidRuntime({
    interactionHandler: interactions.handler,
    createSdkSession: async () =>
      adaptConnectedDaemonSession(droid, session, interactions.callbacks, lease),
  });
  return {
    runtime,
    async initialize(): Promise<void> {
      const availability = await runtime.initialize({
        kind: 'resume',
        cwd: session.cwd ?? '',
        sessionId: session.id,
      });
      if (availability.status !== 'available') {
        throw new Error(availability.message);
      }
    },
  };
}
