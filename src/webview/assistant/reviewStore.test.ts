import { describe, expect, it } from 'vitest';

import {
  EMPTY_REVIEW_UI_STATE,
  reduceReviewUiMessage,
} from './reviewStore';

describe('review webview state', () => {
  it('keeps review state scoped to the connected Session', () => {
    const message = {
      type: 'review.state' as const,
      sequence: 1,
      state: {
        sessionId: 'session-1',
        reviewScopeId: 'scope-1',
        scopeKind: 'workspace' as const,
        baseline: 'head',
        baselineLabel: 'HEAD',
        lifecycle: 'complete' as const,
        files: [],
        currentIndex: null,
        reviewedCount: 0,
        reviewableCount: 0,
      },
    };
    expect(
      reduceReviewUiMessage(
        EMPTY_REVIEW_UI_STATE,
        message,
        'session-1',
      ).scope,
    ).toEqual(message.state);
    expect(
      reduceReviewUiMessage(
        EMPTY_REVIEW_UI_STATE,
        message,
        'session-2',
      ),
    ).toBe(EMPTY_REVIEW_UI_STATE);
  });
});
