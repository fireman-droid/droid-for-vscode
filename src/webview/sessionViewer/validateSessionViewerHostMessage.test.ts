import { describe, expect, it } from 'vitest';

import { SESSION_VIEWER_PROTOCOL_VERSION } from '../../shared/protocol/sessionViewerProtocol';
import { parseSessionViewerHostMessage } from './validateSessionViewerHostMessage';

const target = {
  kind: 'daemon-session',
  mode: 'standard',
  sessionId: 'exec-1',
  title: 'Worker Session',
};
const snapshot = {
  type: 'sessionViewer.snapshot',
  protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
  status: 'ready',
  target,
  items: [{ id: 'u1', kind: 'user', text: 'Investigate' }],
  truncated: false,
  running: true,
  lifecycle: 'working',
  stopping: false,
  stopError: false,
} as const;

describe('parseSessionViewerHostMessage', () => {
  it('accepts exact snapshots and theme updates', () => {
    expect(parseSessionViewerHostMessage(snapshot)).toEqual(snapshot);
    expect(
      parseSessionViewerHostMessage({
        type: 'sessionViewer.snapshot',
        protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
        status: 'unavailable',
        target,
        reason: 'This session transcript is unavailable.',
        running: false,
        lifecycle: 'completed',
        stopping: false,
        stopError: false,
      }),
    ).toMatchObject({ status: 'unavailable' });
    expect(
      parseSessionViewerHostMessage({
        type: 'sessionViewer.theme',
        preference: 'auto',
        resolved: 'dark',
      }),
    ).toMatchObject({ resolved: 'dark' });
  });

  it.each([
    { ...snapshot, protocolVersion: 0 },
    { ...snapshot, extra: true },
    { ...snapshot, target: { ...target, cwd: 'd:/work' } },
    { ...snapshot, items: [{ id: 'u1', kind: 'hostile' }] },
    { ...snapshot, running: 'yes' },
    {
      type: 'sessionViewer.theme',
      preference: 'system',
      resolved: 'dark',
    },
  ])('rejects malformed payload %#', (payload) => {
    expect(parseSessionViewerHostMessage(payload)).toBeNull();
  });
});
