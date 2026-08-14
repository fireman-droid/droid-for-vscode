import { describe, expect, it } from 'vitest';

import { readHostMessage } from './validateHostMessage';

describe('readHostMessage custom model discovery', () => {
  it('accepts only projected discovery pushes', () => {
    const valid = {
      type: 'customModels.discovery',
      sequence: 5,
      sessionId: 'session-1',
      discovery: {
        status: 'ready',
        items: [{ model: 'model-a', displayName: 'Model A' }],
      },
    } as const;
    expect(readHostMessage(valid)).toEqual(valid);
    expect(
      readHostMessage({
        ...valid,
        discovery: {
          status: 'ready',
          items: [{ model: 'model-a', apiKey: 'credential-leak' }],
        },
      }),
    ).toBeUndefined();
  });
});
