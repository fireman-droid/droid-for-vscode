import { describe, expect, it } from 'vitest';

import { SESSION_VIEWER_PROTOCOL_VERSION } from '../../../shared/protocol/sessionViewerProtocol';
import { parseSessionViewerWebviewMessage } from './validateSessionViewerMessage';

describe('parseSessionViewerWebviewMessage', () => {
  it('accepts exact ready, Stop, and bounded diagnostic messages', () => {
    for (const type of ['sessionViewer.ready', 'sessionViewer.stop'] as const) {
      expect(
        parseSessionViewerWebviewMessage({
          type,
          protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
        }),
      ).toEqual({
        type,
        protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
      });
    }
    expect(
      parseSessionViewerWebviewMessage({
        type: 'webview.diagnostic',
        kind: 'error',
        detail: 'resource failed',
      }),
    ).toMatchObject({ kind: 'error' });
  });

  it.each([
    { type: 'sessionViewer.ready', protocolVersion: 0 },
    {
      type: 'sessionViewer.stop',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
      sessionId: 'forged',
    },
    { type: 'webview.diagnostic', kind: '', detail: 'failed' },
    {
      type: 'webview.diagnostic',
      kind: 'error',
      detail: 'x'.repeat(2_049),
    },
  ])('rejects malformed payload %#', (payload) => {
    expect(parseSessionViewerWebviewMessage(payload)).toBeNull();
  });
});
