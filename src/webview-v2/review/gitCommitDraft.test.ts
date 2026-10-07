import { describe, expect, it } from 'vitest';

import { buildCommitMessageDraft } from './gitCommitDraft';

describe('buildCommitMessageDraft', () => {
  it('uses the canonical Turn prompt and file count', () => {
    expect(buildCommitMessageDraft('Update the page', 2)).toBe(
      'Update the page\n\nvia Droid, 2 files',
    );
  });
});
