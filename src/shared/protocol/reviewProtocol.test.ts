import { describe, expect, it } from 'vitest';

import { parseReviewHostMessage, parseReviewWebviewMessage } from './reviewProtocol';
import { isSafeWorkspaceRelativePath } from '../validation/guards';
import { isReviewPanelFile, MAX_REVIEW_PATCH_CHARS, parseReviewPanelRequest } from './reviewPanelProtocol';

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

describe('review protocol', () => {
  it('routes a selected edit and budgets its full context independently from saved excerpts', () => {
    const request = { type: 'reviewPanel.readFile', requestId: 'request-1', reviewScopeId: 'scope-1',
      baseline: 'operations', path: 'src/main.ts', context: 'all', toolUseId: 'edit-20' };
    expect(parseReviewPanelRequest(request)).toEqual(request);
    expect(parseReviewPanelRequest({ ...request, type: 'reviewPanel.openNative' })).toBeDefined();
    expect(parseReviewPanelRequest({ ...request, toolUseId: '' })).toBeUndefined();
    const operation = { toolUseId: 'edit-20', patch: '', source: 'tool-result', outcome: 'applied',
      fullPatch: ' '.repeat(MAX_REVIEW_PATCH_CHARS) };
    const message = { type: 'reviewPanel.file', requestId: 'request-1', reviewScopeId: 'scope-1',
      path: 'src/main.ts', version: 'v1', patch: '', truncated: false, error: null,
      recordedOperations: [operation, { toolUseId: 'edit-19', patch: ' '.repeat(24_000) }] };
    expect(isReviewPanelFile(message)).toBe(true);
    expect(isReviewPanelFile({ ...message, recordedOperations: [operation, operation] })).toBe(false);
    expect(isReviewPanelFile({ ...message, recordedOperations: [{ ...operation, fullPatch: `${operation.fullPatch}x` }] })).toBe(false);
    const { fullPatch: _fullPatch, ...excerpt } = operation;
    expect(isReviewPanelFile({ ...message, recordedOperations: [{ ...excerpt, fullPatchUnavailableReason: 'too-large' }] })).toBe(true);
    expect(isReviewPanelFile({ ...message, recordedOperations: [{ ...operation, fullPatchUnavailableReason: 'too-large' }] })).toBe(false);
  });

  it('accepts turn operation undo entry and rejects incompatible or unknown actions', () => {
    const request = { type: 'review.panel.open', sessionId: 'session-1', scopeKind: 'operations', turnId: 'turn-1', action: 'undo' };
    expect(parseReviewPanelRequest(request)).toEqual(request);
    expect(parseReviewPanelRequest({ ...request, path: 'src/main.ts' })).toBeDefined();
    for (const invalid of [
      { ...request, scopeKind: 'turn' },
      { ...request, scopeKind: 'workspace', turnId: undefined },
      { ...request, turnId: undefined },
      { ...request, toolUseId: 'tool-1' },
      { ...request, action: 'restore' },
      { ...request, action: true },
      { ...request, path: '../outside.ts' },
      { ...request, confirmed: true },
    ]) expect(parseReviewPanelRequest(invalid)).toBeUndefined();
  });

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
