import { describe, expect, it } from 'vitest';

import {
  parseReviewHostMessage,
  parseReviewWebviewMessage,
} from './reviewProtocol';
import { isSafeWorkspaceRelativePath } from './validateMessage';

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

describe('review protocol', () => {
  it('accepts exact review intents and rejects stale or surplus fields', () => {
    const message = {
      type: 'review.markReviewed',
      sessionId: 'session-1',
      reviewScopeId: 'scope-1',
      baseline: 'baseline-1',
      path: 'src/main.ts',
      version: 'version-1',
      advance: true,
    };
    expect(
      parseReviewWebviewMessage(
        message,
        isId,
        isSafeWorkspaceRelativePath,
      ),
    ).toEqual(message);
    expect(
      parseReviewWebviewMessage(
        { ...message, path: '../outside.ts' },
        isId,
        isSafeWorkspaceRelativePath,
      ),
    ).toBeUndefined();
    expect(
      parseReviewWebviewMessage(
        { ...message, reviewed: true },
        isId,
        isSafeWorkspaceRelativePath,
      ),
    ).toBeUndefined();
  });

  it('accepts safe file selection and rejects paths outside the workspace', () => {
    const message = {
      type: 'review.selectFile',
      sessionId: 'session-1',
      reviewScopeId: 'scope-1',
      baseline: 'baseline-1',
      path: 'src/main.ts',
    };
    expect(
      parseReviewWebviewMessage(
        message,
        isId,
        isSafeWorkspaceRelativePath,
      ),
    ).toEqual(message);
    expect(
      parseReviewWebviewMessage(
        { ...message, path: '../outside.ts' },
        isId,
        isSafeWorkspaceRelativePath,
      ),
    ).toBeUndefined();
  });

  it('validates bounded Host review state with exact keys', () => {
    const message = {
      type: 'review.state',
      sequence: 4,
      state: {
        sessionId: 'session-1',
        reviewScopeId: 'scope-1',
        scopeKind: 'turn',
        turnId: 'turn-1',
        baseline: 'before:after',
        baselineLabel: 'Before turn',
        lifecycle: 'reviewing',
        files: [
          {
            path: 'src/main.ts',
            additions: 3,
            deletions: 1,
            status: 'current',
            version: 'version-1',
            restorable: true,
          },
        ],
        currentIndex: 0,
        reviewedCount: 0,
        reviewableCount: 1,
        branchCommitCount: 2,
      },
    };
    expect(parseReviewHostMessage(message)).toEqual(message);
    expect(
      parseReviewHostMessage({
        ...message,
        state: { ...message.state, approved: true },
      }),
    ).toBeUndefined();
    expect(
      parseReviewHostMessage({
        ...message,
        state: { ...message.state, branchCommitCount: -1 },
      }),
    ).toBeUndefined();
  });
});
