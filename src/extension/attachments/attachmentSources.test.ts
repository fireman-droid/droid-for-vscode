import { describe, expect, it } from 'vitest';

import {
  MAX_TEXT_ATTACHMENT_CHARS,
  SELECTION_TRUNCATION_NOTICE,
  selectionAttachmentPayload,
} from './attachmentSources';

describe('selectionAttachmentPayload', () => {
  it('wraps the selection in a cited fence with path and line range', () => {
    const payload = selectionAttachmentPayload({
      displayName: 'store.ts',
      relativePath: 'src/webview/assistant/state/store.ts',
      startLine: 12,
      endLine: 34,
      text: 'const a = 1;\nconst b = 2;',
    });
    expect(payload).toMatchObject({
      kind: 'text',
      name: 'store.ts:12-34',
      truncated: false,
    });
    expect(payload.data).toBe(
      '```12:34:src/webview/assistant/state/store.ts\n' +
        'const a = 1;\nconst b = 2;\n```',
    );
    expect(payload.sizeBytes).toBe(Buffer.byteLength(payload.data, 'utf8'));
  });

  it('grows the fence past backtick runs inside the selection', () => {
    const payload = selectionAttachmentPayload({
      displayName: 'README.md',
      relativePath: 'docs/README.md',
      startLine: 1,
      endLine: 4,
      text: 'example:\n````\ncode\n````',
    });
    expect(payload.data.startsWith('`````1:4:docs/README.md\n')).toBe(true);
    expect(payload.data.endsWith('\n`````')).toBe(true);
  });

  it('truncates at the attachment cap and appends the notice', () => {
    const payload = selectionAttachmentPayload({
      displayName: 'big.txt',
      relativePath: 'big.txt',
      startLine: 1,
      endLine: 9000,
      text: 'x'.repeat(MAX_TEXT_ATTACHMENT_CHARS + 100),
    });
    expect(payload.truncated).toBe(true);
    // The wrapper and notice count against the cap, so the payload
    // stays within the runtime text-attachment limit.
    expect(payload.data.length).toBe(MAX_TEXT_ATTACHMENT_CHARS);
    expect(payload.data.endsWith(SELECTION_TRUNCATION_NOTICE)).toBe(true);
    expect(payload.data.startsWith('```1:9000:big.txt\n')).toBe(true);
  });
});
