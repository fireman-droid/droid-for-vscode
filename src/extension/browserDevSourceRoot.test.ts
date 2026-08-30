import { describe, expect, it } from 'vitest';

import { resolveBrowserDevSourceRoot } from './browserDevSourceRoot';

describe('resolveBrowserDevSourceRoot', () => {
  it('uses a configured source repository outside development hosts', () => {
    expect(
      resolveBrowserDevSourceRoot(
        ' D:\\src\\droidvisx ',
        'D:\\installed\\extension',
      ),
    ).toBe('D:\\src\\droidvisx');
    expect(resolveBrowserDevSourceRoot('', null)).toBeNull();
  });
});
