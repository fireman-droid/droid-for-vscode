// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: <T,>(
    selector: (state: {
      message: { status: { type: string }; parts: readonly unknown[] };
    }) => T,
  ): T =>
    selector({
      message: { status: { type: 'complete' }, parts: [] },
    }),
}));

import { ToolActivityRow } from './activityRows';
import { OpenPathContext } from '../../markdown/MarkdownText';

afterEach(cleanup);

describe('ToolActivityRow accessibility', () => {
  it('keeps file and Canvas actions available without an empty disclosure', () => {
    const { container } = render(
      <OpenPathContext.Provider value={vi.fn()}>
        <ToolActivityRow
          toolName="ApplyPatch"
          activity={{
            turnId: 'turn-1',
            action: 'Updated prototype',
            status: 'completed',
            progressCount: 1,
            latestUpdateKind: 'tool-result',
            durationMs: 120,
            filePath: 'prototype/app.html',
            detailKind: null,
            detail: null,
            target: null,
            errorMessage: null,
            outputTail: null,
            background: false,
            subagent: null,
          }}
        />
      </OpenPathContext.Provider>,
    );

    const summary = container.querySelector('summary');
    expect(summary).toBeNull();
    expect(screen.getByRole('button', { name: 'Open current file' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeDefined();
  });
});
