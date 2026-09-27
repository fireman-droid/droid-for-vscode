import { describe, expect, it } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { HostTranscriptState } from '../../shared/transcript/hostTranscriptState';
import { parseRecoveryTranscript } from './conversationRecoveryParser';
import {
  appendAcceptedUserPrompt, appendExternalUserMessage, attachUserMessageId,
  createHostTranscriptState, hydrateHostTranscriptState, projectHostTranscriptMessage,
} from './hostTranscriptState';
import { reconcileSessionHistory } from './reconcileSessionHistory';

const started = 1_790_417_400_000;
const state = (transcript: readonly SessionTranscriptItem[]): HostTranscriptState =>
  ({ transcript, historyStatus: 'complete', truncated: false });
const user = (id: string, messageId: string, timestamp?: number): SessionTranscriptItem =>
  ({ id, kind: 'user', text: 'Again', messageId,
    ...(timestamp === undefined ? {} : { timestamp }) });
const reply = (id: string, timestamp?: number): SessionTranscriptItem =>
  ({ id, kind: 'assistant', turnId: id, text: 'Same reply',
    ...(timestamp === undefined ? {} : { timestamp }) });

describe('message timestamps in Host recovery', () => {
  it('keeps acceptance and first-delta times through later events and transcript decoding', () => {
    let transcript = appendAcceptedUserPrompt(createHostTranscriptState('complete'),
      'turn', 'Question', undefined, started);
    transcript = attachUserMessageId(transcript, 'turn', 'sdk-message');
    const delta = { type: 'assistant.delta' as const, sessionId: 'session', turnId: 'turn' };
    transcript = projectHostTranscriptMessage(transcript,
      { ...delta, sequence: 1, delta: 'First', timestamp: started + 1_000 });
    transcript = projectHostTranscriptMessage(transcript,
      { ...delta, sequence: 2, delta: ' reply', timestamp: started + 9_000 });
    transcript = projectHostTranscriptMessage(transcript, {
      type: 'thinking.delta', sequence: 3, sessionId: 'session', turnId: 'turn',
      delta: 'Next step', truncated: false, segmentIndex: 0,
    });
    transcript = projectHostTranscriptMessage(transcript,
      { ...delta, sequence: 4, delta: 'Second reply', timestamp: started + 20_000 });
    const restored = parseRecoveryTranscript(JSON.parse(JSON.stringify(transcript)));
    expect(restored).toEqual(transcript);
    expect(hydrateHostTranscriptState(restored!).transcript).toEqual([
      expect.objectContaining({ kind: 'user', timestamp: started, messageId: 'sdk-message' }),
      expect.objectContaining({ kind: 'assistant', timestamp: started + 1_000, text: 'First reply' }),
      expect.objectContaining({ kind: 'thinking', status: 'stopped' }),
      expect.objectContaining({ kind: 'assistant', timestamp: started + 20_000 }),
    ]);
  });

  it('preserves external user message times and does not overwrite them on duplicate notifications', () => {
    const initial = appendExternalUserMessage(createHostTranscriptState('complete'),
      'external', 'Task prompt', 'sdk-external', started);
    expect(appendExternalUserMessage(initial, 'external', 'Task prompt', 'sdk-external', started + 1_000))
      .toBe(initial);
    expect(parseRecoveryTranscript(JSON.parse(JSON.stringify(initial)))?.transcript[0])
      .toMatchObject({ timestamp: started });
  });

  it('leaves legacy unknown timestamps absent', () => {
    const legacy = state([user('u', 'message'), reply('a')]);
    expect(parseRecoveryTranscript(legacy)).toEqual(legacy);
    expect(hydrateHostTranscriptState(legacy).transcript).toEqual(legacy.transcript);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001, 'yesterday'])
    ('rejects invalid recorded times at the recovery decoder boundary: %s', timestamp => {
      for (const item of [user('u', 'message'), reply('a')]) {
        expect(parseRecoveryTranscript(state([{ ...item, timestamp } as SessionTranscriptItem])))
          .toBeUndefined();
      }
    });

  it('recovers missing times only within the matching user message even when texts repeat', () => {
    const loaded = state([user('u1', 'm1'), reply('a1'), user('u2', 'm2'), reply('a2')]);
    const recovered = state([user('cu2', 'm2', started), reply('ca2', started + 5_000)]);
    expect(reconcileSessionHistory(loaded, recovered, { authoritativeLoaded: true }).transcript)
      .toEqual([
        loaded.transcript[0], loaded.transcript[1],
        { ...loaded.transcript[2], timestamp: started },
        { ...loaded.transcript[3], timestamp: started + 5_000 },
      ]);
  });

  it('retains authoritative history times over the locally observed ones', () => {
    const loaded = state([user('u', 'm', started), reply('a', started + 1_000)]);
    const recovered = state([user('cu', 'm', started + 100), reply('ca', started + 1_100)]);
    expect(reconcileSessionHistory(loaded, recovered)).toBe(loaded);
  });

  it('pairs repeated replies in order without borrowing timestamps from later replies', () => {
    const loaded = state([user('u', 'm'), reply('a1'), reply('a2')]);
    const recovered = state([user('cu', 'm'), reply('ca1'), reply('ca2', started)]);
    const merged = reconcileSessionHistory(loaded, recovered);
    expect(merged.transcript[1]).not.toHaveProperty('timestamp');
    expect(merged.transcript[2]).toMatchObject({ timestamp: started });
  });
});
