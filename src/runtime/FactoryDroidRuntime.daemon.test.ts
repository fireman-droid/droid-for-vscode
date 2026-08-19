import { describe, expect, it } from 'vitest';

import { DaemonAvailabilityError } from './daemon/daemonConnection';
import { FactoryDroidRuntime } from './FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from './runtimeInteractions';

describe('FactoryDroidRuntime daemon availability', () => {
  it.each([
    ['not-logged-in', 'daemon-not-logged-in'],
    ['credentials-unreadable', 'daemon-credentials-unreadable'],
    ['refresh-failed', 'daemon-refresh-failed'],
    ['authentication-failed', 'daemon-refresh-failed'],
    ['connect-failed', 'daemon-unavailable'],
  ] as const)('projects %s without process fallback', async (source, reason) => {
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => {
        throw new DaemonAvailabilityError(source, 'sanitized');
      },
    });

    await expect(runtime.initialize('C:\\workspace')).resolves.toMatchObject({
      status: 'unavailable',
      reason,
    });
  });
});
