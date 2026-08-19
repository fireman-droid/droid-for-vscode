import { describe, expect, it } from 'vitest';

import { readHostMessage } from './validateHostMessage';

describe('Canvas Host feedback validation', () => {
  it('accepts only an exact bounded Composer draft request', () => {
    const message = {
      type: 'canvas.feedbackDraft',
      sequence: 12,
      text: 'Canvas feedback:\n\nReduce the card radius.',
    } as const;
    expect(readHostMessage(message)).toEqual(message);
    expect(readHostMessage({ ...message, artifactId: 'forged' })).toBeUndefined();
    expect(readHostMessage({ ...message, sequence: -1 })).toBeUndefined();
  });
});
