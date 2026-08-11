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

  it('uniquifies duplicated toolUseIds when both merge sides kept a copy', () => {
    // A recovered checkpoint persisted from an earlier reconcile carries
    // the same synthesized toolUseIds as a fresh history projection of
    // the same session. When overlap matching fails, both copies survive
    // and duplicate toolCallIds crash the webview renderer.
    const recovered = state([
      user('cached-u', 'Different cached prompt'),
      tool('cached-t', 'turn-x', 'tool-dupe'),
    ]);
    const loaded = state([
      user('sdk-u', 'Different loaded prompt'),
      tool('sdk-t', 'turn-x', 'tool-dupe'),
    ]);

    const result = reconcileSessionHistory(loaded, recovered);
    const toolUseIds = result.transcript
      .filter((item) => item.kind === 'tool')
      .map((item) => (item as { toolUseId: string }).toolUseId);
    expect(toolUseIds).toHaveLength(2);
    expect(new Set(toolUseIds).size).toBe(2);
    expect(toolUseIds).toContain('tool-dupe');
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

function tool(
  id: string,
  turnId: string,
  toolUseId: string,
): Extract<SessionTranscriptItem, { kind: 'tool' }> {
  return {
    id,
    kind: 'tool',
    turnId,
    toolUseId,
    toolName: 'Glob',
    action: 'Inspected workspace structure',
    status: 'stopped',
    progressCount: 0,
    latestUpdateKind: null,
  };
}
