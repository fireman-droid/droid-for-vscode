import { describe, expect, it } from 'vitest';

import {
  parseCanvasFeedbackDraftMessage,
  parseCanvasPanelMessage,
} from './canvasProtocol';

describe('Canvas protocol', () => {
  it('accepts exact revision-bound panel commands', () => {
    expect(
      parseCanvasPanelMessage({
        type: 'canvas.reload',
        generation: 2,
        revision: 4,
      }),
    ).toEqual({
      type: 'canvas.reload',
      generation: 2,
      revision: 4,
    });
    expect(
      parseCanvasPanelMessage({
        type: 'canvas.feedback',
        generation: 2,
        revision: 4,
        feedback: 'Increase the spacing.',
        selection: {
          tag: 'button',
          id: 'save',
          classes: 'primary action',
          text: 'Save',
          path: 'main:nth-of-type(1) > button#save',
        },
      }),
    ).toBeDefined();
  });

  it('rejects extra keys, stale-shaped data, and hostile descriptors', () => {
    for (const value of [
      { type: 'canvas.reload', generation: 1, revision: 1, path: '../x' },
      { type: 'canvas.reload', generation: -1, revision: 1 },
      {
        type: 'canvas.feedback',
        generation: 1,
        revision: 1,
        feedback: '',
      },
      {
        type: 'canvas.feedback',
        generation: 1,
        revision: 1,
        feedback: 'x',
        selection: { tag: 'div', path: 'main\u0000body' },
      },
    ]) {
      expect(parseCanvasPanelMessage(value)).toBeUndefined();
    }
  });

  it('validates the exact bounded Host feedback draft', () => {
    const message = {
      type: 'canvas.feedbackDraft',
      sequence: 7,
      text: 'Canvas feedback:\n\nMake the selected button quieter.',
    } as const;
    expect(parseCanvasFeedbackDraftMessage(message)).toEqual(message);
    expect(
      parseCanvasFeedbackDraftMessage({ ...message, extra: true }),
    ).toBeUndefined();
    expect(
      parseCanvasFeedbackDraftMessage({
        ...message,
        text: 'x'.repeat(4_001),
      }),
    ).toBeUndefined();
  });
});
