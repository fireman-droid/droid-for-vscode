import { describe, expect, it } from 'vitest';
import { readHostMessage } from './validateHostMessage';

const model = {
  id: 'model-1', displayName: 'Model One', supportedReasoningEfforts: ['high'],
  defaultReasoningEffort: 'high', isCustom: false, supportsImages: false,
  supportsImageGeneration: true, disabled: true, disabledReason: 'Account policy',
};
const message = (item: unknown) => ({
  type: 'session.model-catalog', sessionId: 'session-1', sequence: 1,
  modelCatalog: { status: 'ready', items: [item] },
});

describe('model catalog bridge capabilities', () => {
  it('preserves official capabilities and accepts models without configurable reasoning', () => {
    expect(readHostMessage(message(model))).toEqual(message(model));
    const noReasoning = { ...model, supportedReasoningEfforts: [] };
    expect(readHostMessage(message(noReasoning))).toEqual(message(noReasoning));
  });
  it.each([
    { ...model, disabledReason: undefined },
    { ...model, disabledReason: '' },
    { ...model, disabled: false },
    { ...model, supportsImages: 'true' },
    { ...model, defaultReasoningEffort: 'low' },
  ])('rejects inconsistent capability rows %#', (invalid) => {
    expect(readHostMessage(message(invalid))).toBeUndefined();
  });
});
