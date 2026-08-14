import { describe, expect, it } from 'vitest';

import { MAX_TOOL_TARGET_LENGTH } from '../../shared/bridgeMessages';
import {
  parseSessionTranscript,
  readHostMessage,
} from './validateHostMessage';
import { isValidToolTarget } from './validateToolTarget';

describe('isValidToolTarget', () => {
  it('accepts an absent or bounded single-line target', () => {
    expect(isValidToolTarget(undefined)).toBe(true);
    expect(isValidToolTarget('needle · src · **/*.ts')).toBe(true);
    expect(isValidToolTarget('x'.repeat(MAX_TOOL_TARGET_LENGTH))).toBe(true);
  });

  it.each([
    '',
    'x'.repeat(MAX_TOOL_TARGET_LENGTH + 1),
    'line one\nline two',
    'safe\u202eunsafe',
    42,
  ])('rejects hostile target %j', (target) => {
    expect(isValidToolTarget(target)).toBe(false);
  });

  it('is enforced on live and historical tool rows', () => {
    const live = {
      type: 'tool.activity',
      sequence: 1,
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Grep',
      action: 'Searched workspace content',
      target: 'needle · src · **/*.ts',
      status: 'running',
      progressCount: 0,
      latestUpdateKind: null,
    };
    const history = {
      id: 'tool-1',
      kind: 'tool',
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      toolName: 'Read',
      action: 'Read workspace files',
      target: 'src/app.ts',
      status: 'completed',
      progressCount: 0,
      latestUpdateKind: null,
    };
    expect(readHostMessage(live)).toEqual(live);
    expect(parseSessionTranscript([history])).toEqual([history]);
    expect(readHostMessage({ ...live, target: 'line\nbreak' })).toBeUndefined();
    expect(
      parseSessionTranscript([{ ...history, target: 'safe\u202eunsafe' }]),
    ).toBeUndefined();
  });
});
