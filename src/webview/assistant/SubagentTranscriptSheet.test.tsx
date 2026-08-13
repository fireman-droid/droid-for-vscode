// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentSheetState } from './subagentPanelFlow';
import { SubagentTranscriptSheet } from './SubagentTranscriptSheet';

afterEach(cleanup);

function sheetWith(
  overrides: Partial<SubagentSheetState>,
): SubagentSheetState {
  return {
    toolUseId: 'task-1',
    title: 'explore subagent',
    status: 'available',
    items: [],
    truncated: false,
    ...overrides,
  };
}

const items: SessionTranscriptItem[] = [
  {
    id: 'u1',
    kind: 'user',
    text: '# Goal\n\nExplore the `src` folder and report back.',
  },
  {
    id: 'th1',
    kind: 'thinking',
    turnId: 't1',
    text: '',
    status: 'complete',
    durationMs: 4_200,
    truncated: false,
  },
  {
    id: 'tool1',
    kind: 'tool',
    turnId: 't1',
    toolUseId: 'call-1',
    toolName: 'Read',
    action: 'Read file',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    durationMs: 1_300,
    filePath: 'src/app.ts',
  },
  {
    id: 'tool2',
    kind: 'tool',
    turnId: 't1',
    toolUseId: 'call-2',
    toolName: 'Execute',
    action: 'Ran command',
    status: 'failed',
    progressCount: 0,
    latestUpdateKind: null,
  },
  {
    id: 'a1',
    kind: 'assistant',
    turnId: 't1',
    text: 'Found **three** modules.',
  },
];

describe('SubagentTranscriptSheet', () => {
  it('renders the task prompt as markdown inside the user bubble', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        onDismiss={vi.fn()}
      />,
    );
    const bubble = container.querySelector(
      '.dvx-user-block.dvx-subsheet-user',
    );
    expect(bubble).not.toBeNull();
    // Markdown structure, not one raw text blob.
    expect(bubble?.querySelector('.dvx-markdown h1')?.textContent).toBe(
      'Goal',
    );
    expect(bubble?.querySelector('code')?.textContent).toBe('src');
  });

  it('renders assistant text through the shared markdown renderer', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        onDismiss={vi.fn()}
      />,
    );
    const answer = container.querySelector(
      '.dvx-markdown.dvx-subsheet-answer',
    );
    expect(answer?.querySelector('strong')?.textContent).toBe('three');
  });

  it('renders tool items as ruled rows with state and duration', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        onDismiss={vi.fn()}
      />,
    );
    const rows = [...container.querySelectorAll('.dvx-subsheet-tool')];
    expect(rows).toHaveLength(2);
    expect(
      rows[0]?.querySelector('.dvx-subsheet-tool-action')?.textContent,
    ).toBe('Read file');
    expect(
      rows[0]?.querySelector('.dvx-subsheet-tool-file')?.textContent,
    ).toBe('src/app.ts');
    expect(
      rows[0]?.querySelector('.dvx-subsheet-tool-state')?.textContent,
    ).toBe('Completed · 1.3s');
    // Failed rows keep the subtle error tint and say so.
    expect(rows[1]?.className).toContain('dvx-subsheet-tool-failed');
    expect(
      rows[1]?.querySelector('.dvx-subsheet-tool-state')?.textContent,
    ).toBe('Failed');
    expect(
      rows[1]?.querySelector('.dvx-subsheet-tool-state')?.className,
    ).toContain('dvx-subsheet-tool-state-failed');
    // Read-only: the ledger rows carry no buttons at all.
    expect(container.querySelector('.dvx-subsheet-tool button')).toBeNull();
  });

  it('renders the quiet thinking line with its duration', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      container.querySelector('.dvx-subsheet-thought')?.textContent,
    ).toBe('Thought for 4s');
  });

  it('shows the unavailable state', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ status: 'unavailable' })}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Transcript unavailable.');
  });

  it('dismisses after the leave animation on ×', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const { container } = render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(
        container.querySelector('.dvx-btw-close') as HTMLElement,
      );
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(250));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
