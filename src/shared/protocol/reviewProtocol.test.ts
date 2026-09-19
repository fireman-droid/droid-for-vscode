import { describe, expect, it } from 'vitest';

import { parseReviewHostMessage, parseReviewWebviewMessage } from './reviewProtocol';
import { isSafeWorkspaceRelativePath } from '../validation/guards';
import { isReviewPanelFile } from './reviewPanelProtocol';

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

describe('review protocol', () => {
  it('accepts bounded operation excerpts and rejects surplus fields and oversized payloads', () => {
    const operation = { toolUseId: 'tool-1', patch: '@@ -1 +1 @@\n-old\n+new' };
    const message = { type: 'reviewPanel.file', requestId: 'request-1', reviewScopeId: 'scope-1',
      path: 'src/main.ts', version: 'v1', patch: '', truncated: false, error: null,
      recordedOperations: [operation] };
    expect(isReviewPanelFile(message)).toBe(true);
    for (const recordedOperations of [
      [{ ...operation, netDiff: true }],
      [{ ...operation, patch: 'x'.repeat(24_001) }],
      Array.from({ length: 201 }, () => operation),
      Array.from({ length: 22 }, () => ({ ...operation, patch: 'x'.repeat(24_000) })),
    ]) expect(isReviewPanelFile({ ...message, recordedOperations })).toBe(false);
  });

  it('accepts only an explicit true open-current intent', () => {
    const message = {
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-1',
      openCurrent: true,
    } as const;
    expect(parseReviewWebviewMessage(message, isId, isSafeWorkspaceRelativePath)).toEqual(
      message,
    );
    expect(
      parseReviewWebviewMessage(
        { ...message, openCurrent: false },
        isId,
        isSafeWorkspaceRelativePath,
      ),
    ).toBeUndefined();
  });

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
    expect(parseReviewWebviewMessage(message, isId, isSafeWorkspaceRelativePath)).toEqual(
      message,
    );
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
    expect(parseReviewWebviewMessage(message, isId, isSafeWorkspaceRelativePath)).toEqual(
      message,
    );
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
    expect(parseReviewHostMessage({ ...message, state: { ...message.state, recordedOnly: true } })).toBeDefined();
    expect(parseReviewHostMessage({ ...message, state: { ...message.state, recordedOnly: false } })).toBeUndefined();
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
