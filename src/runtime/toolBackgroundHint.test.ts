import { describe, expect, it } from 'vitest';

import { extractToolBackgroundHint } from './toolBackgroundHint';

describe('extractToolBackgroundHint', () => {
  it('flags an execute call the CLI backgrounded', () => {
    expect(
      extractToolBackgroundHint('Execute', {
        command: 'node server.mjs',
        fireAndForget: true,
      }),
    ).toEqual({ fireAndForget: true });
  });

  it('normalizes the tool name before matching', () => {
    expect(
      extractToolBackgroundHint('  execute\u0007 ', {
        fireAndForget: true,
      }),
    ).toEqual({ fireAndForget: true });
  });

  it('reads fail-soft: a missing field means no hint', () => {
    expect(
      extractToolBackgroundHint('Execute', { command: 'git status' }),
    ).toBeUndefined();
  });

  it('treats anything but literal true as no hint', () => {
    expect(
      extractToolBackgroundHint('Execute', { fireAndForget: false }),
    ).toBeUndefined();
    expect(
      extractToolBackgroundHint('Execute', { fireAndForget: 'true' }),
    ).toBeUndefined();
    expect(
      extractToolBackgroundHint('Execute', { fireAndForget: 1 }),
    ).toBeUndefined();
    expect(extractToolBackgroundHint('Execute', null)).toBeUndefined();
    expect(
      extractToolBackgroundHint('Execute', 'fireAndForget'),
    ).toBeUndefined();
  });

  it('ignores the flag on non-execute tools', () => {
    expect(
      extractToolBackgroundHint('Read', { fireAndForget: true }),
    ).toBeUndefined();
    expect(
      extractToolBackgroundHint('Task', { fireAndForget: true }),
    ).toBeUndefined();
  });
});
