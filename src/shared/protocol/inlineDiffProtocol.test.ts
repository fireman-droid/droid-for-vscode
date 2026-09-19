import { describe, expect, it } from 'vitest';
import { parseWebviewMessage } from '../validateMessage';
import { readHostMessage } from '../../webview/bridge/validateHostMessage';
import { MAX_INLINE_DIFF_PATCH_LENGTH } from './inlineDiffProtocol';

const identity = { sessionId: 'session-1', turnId: 'turn-1', path: 'src/app.ts' };
const request = { type: 'file.readDiff', ...identity, requestId: 'request-1' };
const response = {
  type: 'file.diff', sequence: 1, ...identity, requestId: 'request-1',
  result: { status: 'ready', phase: 'settled', patch: '@@ -1 +1 @@\n-old\n+new', truncated: false },
};

describe('inline diff bridge boundary', () => {
  it('routes validated read, exact editor and response messages through the bridge', () => {
    expect(parseWebviewMessage(request)).toEqual(request);
    const open = { type: 'file.openTurnDiff', ...identity };
    expect(parseWebviewMessage(open)).toEqual(open);
    expect(readHostMessage(response)).toEqual(response);
  });

  it.each(['../secret', '/secret', 'C:/secret', 'src\\secret'])('rejects unsafe path %s for both actions', (path) => {
    expect(parseWebviewMessage({ ...request, path })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'file.openTurnDiff', ...identity, path })).toBeUndefined();
  });

  it('rejects missing identity, extra fields and unbounded responses', () => {
    expect(parseWebviewMessage({ ...request, requestId: '' })).toBeUndefined();
    expect(parseWebviewMessage({ ...request, extra: true })).toBeUndefined();
    expect(readHostMessage({ ...response, sequence: -1 })).toBeUndefined();
    expect(readHostMessage({ ...response, result: { ...response.result, patch: 'x'.repeat(MAX_INLINE_DIFF_PATCH_LENGTH + 1) } })).toBeUndefined();
    expect(readHostMessage({ ...response, result: { ...response.result, patch: 'x\n'.repeat(602) } })).toBeUndefined();
    expect(readHostMessage({ ...response, result: { status: 'ready' } })).toBeUndefined();
    expect(readHostMessage({ ...response, result: { status: 'unavailable' } })).toBeTruthy();
  });
});
