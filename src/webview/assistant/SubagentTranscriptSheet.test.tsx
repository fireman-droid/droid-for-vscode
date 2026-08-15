// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionTranscriptItem } from '../../shared/bridgeMessages';
import type { SubagentSheetState } from './subagentPanelFlow';
import {
  SUBAGENT_SHEET_REFRESH_MS,
  SubagentTranscriptSheet,
} from './SubagentTranscriptSheet';

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
    text: 'Map the modules before reading individual files.',
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
    action: 'Read workspace files',
    target: 'src/app.ts',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    durationMs: 1_300,
  },
  {
    id: 'tool2',
    kind: 'tool',
    turnId: 't1',
    toolUseId: 'call-2',
    toolName: 'Grep',
    action: 'Searched workspace files',
    target: 'useEffect · src · **/*.tsx',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
  },
  {
    id: 'tool3',
    kind: 'tool',
    turnId: 't1',
    toolUseId: 'call-3',
    toolName: 'Execute',
    action: 'Ran command',
    status: 'failed',
    progressCount: 0,
    latestUpdateKind: null,
    detailKind: 'command',
    detail: 'pnpm run lint:budgets',
    errorMessage: 'Command failed',
  },
  {
    id: 'a1',
    kind: 'assistant',
    turnId: 't1',
    text: 'Found **three** modules.',
  },
  {
    id: 'changes1',
    kind: 'changes',
    turnId: 't1',
    files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
  },
];

function installAnimationFrames(): {
  readonly runFrame: () => void;
  readonly restore: () => void;
} {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    });
  const cancel = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((id) => {
      frames.delete(id);
    });
  return {
    runFrame: () => {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) {
        callback(performance.now());
      }
    },
    restore: () => {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

function setScrollGeometry(
  element: HTMLElement,
  scrollHeight: number,
  clientHeight = 100,
): void {
  Object.defineProperty(element, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(element, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
}

describe('SubagentTranscriptSheet', () => {
  it('reuses the main read-only message, Markdown, Thinking, and tool rows', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        running={false}
        onRefresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const user = container.querySelector(
      '.dvx-message-user .dvx-user-block',
    );
    expect(user?.textContent).toContain('# Goal');
    expect(container.querySelector('.dvx-message-assistant')).not.toBeNull();
    expect(
      container.querySelector('.dvx-markdown strong')?.textContent,
    ).toBe('three');
    expect(
      container.querySelector('.dvx-thinking-row summary')?.textContent,
    ).toContain('Thought for 4s');
    expect(container.querySelector('.dvx-activity-group')).not.toBeNull();
    expect(container.querySelectorAll('.dvx-activity-row')).toHaveLength(4);
    expect(
      [...container.querySelectorAll('.dvx-tool-target')].map(
        (target) => target.textContent,
      ),
    ).toEqual([
      'src/app.ts',
      'useEffect · src · **/*.tsx',
    ]);
    expect(
      container.querySelector('.dvx-command-code')?.textContent,
    ).toContain('pnpm run lint:budgets');
    expect(
      container.querySelector('.dvx-activity-state-failed')?.textContent,
    ).toContain('Failed');
  });

  it('keeps child playback actionless where an action could mutate state', () => {
    const { container } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        running
        onRefresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('.dvx-assistant-actions')).toBeNull();
    expect(container.querySelector('.dvx-composer')).toBeNull();
    expect(container.querySelector('.dvx-changes')).toBeNull();
    expect(container.querySelector('.dvx-terminal-mirror-entry')).toBeNull();
    expect(
      container.querySelector('[aria-label="Regenerate response"]'),
    ).toBeNull();
  });

  it('shows unavailable and truncated states', () => {
    const { container, rerender } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ status: 'unavailable' })}
        running={false}
        onRefresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Transcript unavailable.');
    rerender(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items, truncated: true })}
        running={false}
        onRefresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent).toContain(
      'Some messages were truncated.',
    );
  });

  it('dismisses after the leave animation on ×', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const { container } = render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running={false}
          onRefresh={vi.fn()}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(container.querySelector('.dvx-btw-close')!);
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(250));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismisses from blank space but not from interactions inside', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running={false}
          onRefresh={vi.fn()}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.pointerDown(
        screen.getByRole('complementary', {
          name: 'Subagent transcript',
        }),
      );
      act(() => vi.advanceTimersByTime(250));
      expect(onDismiss).not.toHaveBeenCalled();

      fireEvent.pointerDown(document.body);
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(250));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an old leave timer when another transcript opens', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const renderSheet = (toolUseId: string) => (
        <SubagentTranscriptSheet
          key={toolUseId}
          sheet={sheetWith({ toolUseId })}
          running={false}
          onRefresh={vi.fn()}
          onDismiss={onDismiss}
        />
      );
      const { rerender } = render(renderSheet('task-1'));
      fireEvent.pointerDown(document.body);
      rerender(renderSheet('task-2'));
      act(() => vi.advanceTimersByTime(250));
      expect(onDismiss).not.toHaveBeenCalled();
      expect(
        screen.getByRole('complementary', {
          name: 'Subagent transcript',
        }),
      ).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the current child reply live until its row settles', async () => {
    const { container, rerender } = render(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        running
        onRefresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      container.querySelector(
        '.dvx-message-assistant.dvx-message-live',
      ),
    ).not.toBeNull();
    rerender(
      <SubagentTranscriptSheet
        sheet={sheetWith({ items })}
        running={false}
        onRefresh={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(
          '.dvx-message-assistant.dvx-message-live',
        ),
      ).toBeNull();
    });
  });

  it('shows the live indicator and refreshes only while running', () => {
    vi.useFakeTimers();
    try {
      const onRefresh = vi.fn();
      const { container, rerender } = render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running
          onRefresh={onRefresh}
          onDismiss={vi.fn()}
        />,
      );
      expect(container.querySelector('.dvx-subsheet-live')).not.toBeNull();
      act(() => vi.advanceTimersByTime(SUBAGENT_SHEET_REFRESH_MS * 2));
      expect(onRefresh).toHaveBeenCalledTimes(2);
      rerender(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running={false}
          onRefresh={onRefresh}
          onDismiss={vi.fn()}
        />,
      );
      expect(container.querySelector('.dvx-subsheet-live')).toBeNull();
      // One final refresh captures the transcript tail after settlement.
      expect(onRefresh).toHaveBeenCalledTimes(3);
      act(() => vi.advanceTimersByTime(SUBAGENT_SHEET_REFRESH_MS * 2));
      expect(onRefresh).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows transcript growth smoothly over animation frames', () => {
    const animation = installAnimationFrames();
    try {
      const { container, rerender } = render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const body = container.querySelector<HTMLElement>(
        '.dvx-subsheet-body',
      )!;
      setScrollGeometry(body, 700);
      rerender(
        <SubagentTranscriptSheet
          sheet={sheetWith({
            items: [
              ...items,
              { id: 'a2', kind: 'assistant', turnId: 't1', text: 'More.' },
            ],
          })}
          running
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      act(() => animation.runFrame());
      expect(body.scrollTop).toBeGreaterThan(0);
      expect(body.scrollTop).toBeLessThan(600);
      const firstTop = body.scrollTop;
      act(() => animation.runFrame());
      expect(body.scrollTop).toBeGreaterThan(firstTop);
    } finally {
      animation.restore();
    }
  });

  it('releases on reading intent and rejoins after reaching the bottom', () => {
    const animation = installAnimationFrames();
    try {
      const { container, rerender } = render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const body = container.querySelector<HTMLElement>(
        '.dvx-subsheet-body',
      )!;
      setScrollGeometry(body, 1_000);
      act(() => animation.runFrame());
      const followedTop = body.scrollTop;
      fireEvent.wheel(body, { deltaY: -80 });
      rerender(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items: [...items] })}
          running
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      act(() => animation.runFrame());
      expect(body.scrollTop).toBe(followedTop);

      body.scrollTop = 900;
      fireEvent.scroll(body);
      setScrollGeometry(body, 1_200);
      rerender(
        <SubagentTranscriptSheet
          sheet={sheetWith({
            items: [
              ...items,
              { id: 'a3', kind: 'assistant', turnId: 't1', text: 'Tail.' },
            ],
          })}
          running
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      act(() => animation.runFrame());
      expect(body.scrollTop).toBeGreaterThan(900);
    } finally {
      animation.restore();
    }
  });

  it('observes rendered content growth between polling snapshots', () => {
    const animation = installAnimationFrames();
    let notifyResize: (() => void) | undefined;
    const OriginalResizeObserver = globalThis.ResizeObserver;
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = () => callback([], this);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    try {
      const { container } = render(
        <SubagentTranscriptSheet
          sheet={sheetWith({ items })}
          running
          onRefresh={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const body = container.querySelector<HTMLElement>(
        '.dvx-subsheet-body',
      )!;
      setScrollGeometry(body, 100);
      act(() => animation.runFrame());
      setScrollGeometry(body, 600);
      act(() => notifyResize?.());
      act(() => animation.runFrame());
      expect(body.scrollTop).toBeGreaterThan(0);
    } finally {
      animation.restore();
      if (OriginalResizeObserver === undefined) {
        vi.unstubAllGlobals();
      } else {
        vi.stubGlobal('ResizeObserver', OriginalResizeObserver);
      }
    }
  });
});
