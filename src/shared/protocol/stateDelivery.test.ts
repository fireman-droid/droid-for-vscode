import { describe, expect, it } from 'vitest';
import { parseWebviewMessage } from '../validateMessage';

const receipt = { type: 'webview.state-applied', pageId: 'page', sequences: [2, 7], snapshotSequence: 2 };
describe('state application receipt boundary', () => {
  it('accepts exact sequences with gaps and an included snapshot', () => {
    expect(parseWebviewMessage(receipt)).toEqual(receipt);
  });
  it.each([
    { ...receipt, pageId: '' }, { ...receipt, sequences: [] },
    { ...receipt, sequences: [-1] }, { ...receipt, sequences: [1.5] },
    { ...receipt, sequences: Array(257).fill(2) },
    { ...receipt, snapshotSequence: 9 }, { ...receipt, extra: true },
  ])('rejects malformed or unbounded receipts %#', (value) => {
    expect(parseWebviewMessage(value)).toBeUndefined();
  });
});
