// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import { afterEach, expect, it, vi } from 'vitest';

import { ReviewDockSlot as V2ReviewDockSlot } from '../chat/ReviewDock';

import { createChatStore } from '../chat/store';

import { initialAssistantWebviewState } from '../state/initialState';

afterEach(cleanup);

const changes = {
  id: 'changes-latest',
  kind: 'changes' as const,
  turnId: 'turn-latest',
  files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
};

const historicalReview = {
  sessionId: 'session-1',
  reviewScopeId: 'scope-old',
  scopeKind: 'turn' as const,
  turnId: 'turn-old',
  baseline: 'before-old',
  baselineLabel: 'Before turn',
  lifecycle: 'complete' as const,
  files: [
    {
      path: 'src/old.ts',
      additions: 1,
      deletions: 0,
      version: 'v1',
      status: 'current' as const,
      restorable: true,
    },
  ],
  currentIndex: 0,
  reviewedCount: 0,
  reviewableCount: 1,
};

it('V2 counts confirmed AI files and opens their operation review independently of workspace changes', async () => {
  const postMessage = vi.fn();
  const store = createChatStore({ ...initialAssistantWebviewState, sessionId: 'session-1', connection: { status: 'connected' }, transcript: [
    { ...changes, files: [...changes.files, { path: 'manual.txt', additions: 1, deletions: 0 }] },
    { kind: 'tool', id: 'edit-1', toolUseId: 'edit-1', turnId: 'turn-latest', toolName: 'Edit', action: 'Edited',
      status: 'completed', progressCount: 0, latestUpdateKind: null,
      operationDiff: { status: 'ready', source: 'tool-result', callId: 'edit-1', files: [
        { path: 'src/app.ts', kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-before\n+after' },
        { path: 'uncertain.txt', kind: 'modified', outcome: 'uncertain', patch: '' },
      ] } },
  ], review: { ...initialAssistantWebviewState.review, scope: historicalReview } });
  render(<V2ReviewDockSlot store={store} vscode={{ postMessage }} />);
  expect(screen.getByRole('button', { name: 'Open Review' }).title).toBe('1 directly confirmed file in this turn');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open Review' }));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'review.panel.open', sessionId: 'session-1', scopeKind: 'operations', turnId: 'turn-latest',
  });
  expect(screen.queryByRole('button', { name: 'Restore file' })).toBeNull();
});
