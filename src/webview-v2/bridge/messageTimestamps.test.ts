import { describe, expect, it } from 'vitest';
import { parseSessionTranscriptItem } from './host/transcript';
import { parseAssistantDelta, parseUserMessageMeta } from './host/turns';
import { assistantWebviewReducer } from '../state/store';
import { initialAssistantWebviewState } from '../state/initialState';
import { stableTranscriptId } from '../../shared/transcript/hostTranscriptState';

const timestamp = Date.UTC(2026, 8, 26, 10, 47, 15);
const user = { id: 'user', kind: 'user', text: 'Question', messageId: 'message' };
const assistant = { id: 'assistant', kind: 'assistant', turnId: 'turn', text: 'Answer' };
const delta = { type: 'assistant.delta', sequence: 1, sessionId: 'session', turnId: 'turn', delta: 'Answer' };
const meta = { type: 'user.message-meta', sequence: 2, sessionId: 'session', turnId: 'turn', messageId: 'message' };

describe('message timestamps across the Webview boundary', () => {
  it('preserves recorded times in snapshots and live messages, and accepts untimed legacy records', () => {
    for (const item of [user, assistant]) {
      expect(parseSessionTranscriptItem({ ...item, timestamp })).toEqual({ ...item, timestamp });
      expect(parseSessionTranscriptItem(item)).toEqual(item);
    }
    expect(parseAssistantDelta({ ...delta, timestamp })).toEqual({ ...delta, timestamp });
    expect(parseUserMessageMeta({ ...meta, timestamp })).toEqual({ ...meta, timestamp });
    expect(parseAssistantDelta(delta)).toEqual(delta);
    expect(parseUserMessageMeta(meta)).toEqual(meta);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001, 1.5, '2026-09-26'])('rejects invalid timestamp %s instead of discarding it silently', (invalid) => {
    expect(parseSessionTranscriptItem({ ...user, timestamp: invalid })).toBeUndefined();
    expect(parseSessionTranscriptItem({ ...assistant, timestamp: invalid })).toBeUndefined();
    expect(parseAssistantDelta({ ...delta, timestamp: invalid })).toBeUndefined();
    expect(parseUserMessageMeta({ ...meta, timestamp: invalid })).toBeUndefined();
  });

  it('keeps the first received time when a stream backlog is batched and the turn settles', () => {
    const state = { ...initialAssistantWebviewState, sessionId: 'session',
      turn: { turnId: 'turn', status: 'streaming' as const } };
    const result = assistantWebviewReducer(state, { type: 'host.batch', messages: [
      { ...delta, type: 'assistant.delta', timestamp, delta: 'A' },
      { ...delta, type: 'assistant.delta', sequence: 2, timestamp: timestamp + 500, delta: 'B' },
      { ...delta, type: 'assistant.delta', sequence: 3, timestamp: timestamp + 1000, delta: 'C' },
      { type: 'turn.state', sequence: 4, sessionId: 'session', turnId: 'turn', status: 'completed' },
    ] });
    expect(result.transcript).toEqual([{ id: 'assistant:turn:1', kind: 'assistant', turnId: 'turn', text: 'ABC', timestamp }]);
  });

  it('adds accepted prompt time even when its SDK message id was already present', () => {
    const item = { ...user, id: stableTranscriptId('user', 'turn'), kind: 'user' as const };
    const state = { ...initialAssistantWebviewState, sessionId: 'session', transcript: [item] };
    const result = assistantWebviewReducer(state, { type: 'host.message', message: { ...meta, type: 'user.message-meta', timestamp } });
    expect(result.transcript).toEqual([{ ...item, timestamp }]);
    const untimed = assistantWebviewReducer(result, { type: 'host.message', message: { ...meta, type: 'user.message-meta', sequence: 3 } });
    expect(untimed.transcript).toEqual(result.transcript);
  });
});
