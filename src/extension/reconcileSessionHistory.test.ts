import { describe, expect, it } from 'vitest';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import { reconcileSessionHistory } from './reconcileSessionHistory';

describe('reconcileSessionHistory', () => {
  it('keeps a recovered prefix when public SDK history is a compacted suffix', () => {
    const recovered = state([
      user('cached-a', 'Old prompt'),
      assistant('cached-b', 'Old answer'),
      user('cached-c', 'Recent prompt'),
      assistant('cached-d', 'Recent answer'),
    ]);
    const loaded = state([
      user('sdk-c', 'Recent prompt'),
      assistant('sdk-d', 'Recent answer'),
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: recovered.transcript,
      historyStatus: 'partial',
      truncated: false,
    });
  });

  it('uses complete public history when it extends the recovered prefix', () => {
    const recovered = state([
      user('cached-a', 'Old prompt'),
      assistant('cached-b', 'Old answer'),
    ]);
    const loaded = state([
      user('sdk-a', 'Old prompt'),
      assistant('sdk-b', 'Old answer'),
      user('sdk-c', 'Recent prompt'),
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
  });

  it('uses complete public history when recovery retained only its suffix', () => {
    const loaded = state([
      user('sdk-a', 'Old prompt'),
      assistant('sdk-b', 'Old answer'),
      user('sdk-c', 'Recent prompt'),
    ]);
    const recovered = state([
      assistant('cached-b', 'Old answer'),
      user('cached-c', 'Recent prompt'),
    ]);

    expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
  });

  it('retains non-overlapping safe content and marks chronology partial', () => {
    const recovered = state([user('cached', 'Locally observed prompt')]);
    const loaded = state([user('sdk', 'Public SDK prompt')]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: [...loaded.transcript, ...recovered.transcript],
      historyStatus: 'partial',
      truncated: false,
    });
  });

  it('preserves an actual source truncation independently from partial history', () => {
    const recovered = {
      ...state([user('cached', 'Locally observed prompt')]),
      historyStatus: 'partial' as const,
      truncated: true,
    };
    const loaded = state([user('sdk', 'Public SDK prompt')]);

    expect(reconcileSessionHistory(loaded, recovered)).toEqual({
      transcript: [...loaded.transcript, ...recovered.transcript],
      historyStatus: 'partial',
      truncated: true,
    });
  });
});

function state(
  transcript: readonly SessionTranscriptItem[],
): HostTranscriptState {
  return {
    transcript,
    historyStatus: 'complete',
    truncated: false,
  };
}

function user(
  id: string,
  text: string,
): Extract<SessionTranscriptItem, { kind: 'user' }> {
  return { id, kind: 'user', text };
}

function assistant(
  id: string,
  text: string,
): Extract<SessionTranscriptItem, { kind: 'assistant' }> {
  return {
    id,
    kind: 'assistant',
    turnId: `${id}-turn`,
    text,
  };
}
