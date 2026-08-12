import { describe, expect, it, vi } from 'vitest';

import { announceReady, persistDraft, restoreDraft } from './vscode';

describe('VS Code webview bridge', () => {
  it('restores and persists only a string draft', () => {
    let state: unknown = {
      draft: 'Continue this thought',
      transcript: ['must not be restored'],
      sessionId: 'must not be restored',
    };
    const api = {
      getState: vi.fn(() => state),
      postMessage: vi.fn(),
      setState: vi.fn((nextState: unknown) => {
        state = nextState;
      }),
    };

    expect(restoreDraft(api)).toBe('Continue this thought');
    persistDraft(api, 'New draft');

    expect(state).toEqual({ draft: 'New draft' });
    expect(api.setState).toHaveBeenCalledWith({ draft: 'New draft' });
  });

  it('rejects array-shaped persisted state', () => {
    const state = ['not-a-record'] as unknown[] & { draft: string };
    state.draft = 'must not be restored';
    const api = {
      getState: vi.fn(() => state),
      postMessage: vi.fn(),
      setState: vi.fn(),
    };

    expect(restoreDraft(api)).toBe('');
  });

  it('announces readiness with the exact supported protocol', () => {
    const api = {
      getState: vi.fn(),
      postMessage: vi.fn(),
      setState: vi.fn(),
    };

    announceReady(api);

    expect(api.postMessage).toHaveBeenCalledWith({
      type: 'webview.ready',
      protocolVersion: 3,
    });
  });
});
