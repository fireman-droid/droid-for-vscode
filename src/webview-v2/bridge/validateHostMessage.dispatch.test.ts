import { describe, expect, it } from 'vitest';

import { readHostMessage } from './validateHostMessage';

describe('readHostMessage dispatch', () => {
  it('rejects unknown, prototype-named, and inherited type keys', () => {
    expect(readHostMessage({ type: 'unknown', sequence: 0 })).toBeUndefined();
    expect(readHostMessage({ type: 'toString', sequence: 0 })).toBeUndefined();
    const inherited = Object.assign(
      Object.create({ type: 'assistant.delta' }) as Record<string, unknown>,
      { sequence: 0, sessionId: 'session-1', turnId: 'turn-1', text: 'x' },
    );
    expect(readHostMessage(inherited)).toBeUndefined();
  });
});
