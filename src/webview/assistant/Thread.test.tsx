// @vitest-environment jsdom

import { createElement } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommandSummary } from '../../shared/bridgeMessages';
import {
  clearImagePreviews,
  getImagePreview,
  rememberImagePreview,
} from './imagePreviewCache';
import {
  TerminalMirrorContext,
  FileDiffContext,
  FOLLOW_REJOIN_PX,
  applyFollowScroll,
  applyFollowWheelIntent,
  computePinnedUserIndex,
  computeStickyLayout,
  createFollowState,
  shouldCompactStickyUser,
} from './Thread';
import {
  AttachmentChip,
  readDroppedFileUris,
} from './thread/Composer';
import {
  ChangesSummary,
  HistoryNotice,
  PendingResponse,
  formatCompactDividerLabel,
} from './thread/transcriptRows';
import {
  BackgroundProcessHint,
  SubagentSummaryRow,
  formatPlanSummary,
  formatSubagentSummary,
} from './thread/activityRows';
import {
  CommandCardMenu,
  ExecuteMirrorEntry,
} from './thread/commandCard';
import {
  filterSlashCommands,
  findMentionToken,
  findSlashToken,
  splitMentionPath,
} from './thread/composerCommands';
import { formatThinkingLabel } from './thread/readers';
import { SubagentActivityStoreContext } from './subagentPanelFlow';

afterEach(() => {
  cleanup();
  clearImagePreviews();
});

describe('PendingResponse', () => {
  it('renders the working label with the shared shimmer treatment', () => {
    render(<PendingResponse activity="working" />);
    const label = screen
      .getByRole('status')
      .querySelector('.dvx-shimmer-text');
    expect(label?.textContent).toBe('Droid is working');
  });

  it('falls back to the responding label without a working activity', () => {
    render(<PendingResponse />);
    const label = screen
      .getByRole('status')
      .querySelector('.dvx-shimmer-text');
    expect(label?.textContent).toBe('Droid is responding');
  });

  it('stays static while a transcript activity row is live', () => {
    render(<PendingResponse activity="working" activityLive />);
    const status = screen.getByRole('status');
    expect(status.querySelector('.dvx-shimmer-text')).toBeNull();
    expect(
      status.querySelector('.dvx-pending-label')?.textContent,
    ).toBe('Droid is working');
    expect(status.className).toContain('dvx-pending-quiet');
  });
});

describe('HistoryNotice', () => {
  it('states unavailable history without implying completeness', () => {
    render(<HistoryNotice historyStatus="unavailable" truncated={false} />);
    expect(screen.getByRole('note').textContent).toContain(
      'Earlier CLI messages are unavailable',
    );
  });

  it('combines partial history and local trimming into one truthful notice', () => {
    render(<HistoryNotice historyStatus="partial" truncated />);
    const notices = screen.getAllByRole('note');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.textContent).toContain(
      'Some earlier session content is unavailable',
    );
    expect(notices[0]!.textContent).toContain('were trimmed');
  });

  it('distinguishes partial public history from local trimming', () => {
    const first = render(
      <HistoryNotice historyStatus="partial" truncated={false} />,
    );
    expect(screen.getByRole('note').textContent).toContain(
      'public Droid history',
    );
    first.unmount();

    render(<HistoryNotice historyStatus="complete" truncated />);
    expect(screen.getByRole('note').textContent).toContain(
      'local display',
    );
  });
});

describe('historical ChangesSummary', () => {
  const changesData = {
    turnId: 'turn-a',
    files: [
      { path: 'prototypes/dashboard.html', additions: 12, deletions: 0 },
      { path: 'demo/legacy.htm', additions: null, deletions: null },
      { path: 'src/app.tsx', additions: 3, deletions: 1 },
    ],
  };

  function renderChanges(
    data: unknown = changesData,
    onOpenDiff: (
      path: string,
      turnId: string | null,
    ) => void = () => undefined,
  ) {
    return render(
      createElement(
        FileDiffContext.Provider,
        { value: onOpenDiff },
        createElement(ChangesSummary, { data }),
      ),
    );
  }

  it('renders one compact aggregate line without latest-turn actions', () => {
    renderChanges();
    const summary = screen.getByRole('button');
    expect(summary.className).toBe('dvx-changes-history');
    expect(summary.textContent).toBe('Changes·3 files·+15/−1');
    expect(document.querySelector('ul, li')).toBeNull();
    expect(screen.queryByText('prototypes/dashboard.html')).toBeNull();
    expect(screen.queryByRole('button', { name: /Preview/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Commit/i })).toBeNull();
  });

  it('opens every historical diff with that turn in stable order', () => {
    const onOpenDiff = vi.fn();
    renderChanges(changesData, onOpenDiff);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDiff.mock.calls).toEqual([
      ['prototypes/dashboard.html', 'turn-a'],
      ['demo/legacy.htm', 'turn-a'],
      ['src/app.tsx', 'turn-a'],
    ]);
  });

  it('stays absent for an empty Changes projection', () => {
    const { container } = renderChanges({
      turnId: 'turn-a',
      files: [],
    });
    expect(container.childElementCount).toBe(0);
  });
});

describe('ExecuteMirrorEntry', () => {
  function renderEntry(
    status: string,
    detailKind: 'command' | 'plan' | null,
    onOpen: (() => void) | null,
  ) {
    return render(
      createElement(
        TerminalMirrorContext.Provider,
        { value: onOpen },
        createElement(ExecuteMirrorEntry, { status, detailKind }),
      ),
    );
  }

  it('shows the quiet entry only on running execute rows', () => {
    renderEntry('running', 'command', () => undefined);
    expect(
      screen.getByRole('button', { name: '在终端中查看' }).className,
    ).toContain('dvx-terminal-mirror-entry');
  });

  it('stays hidden for finished, non-execute, and history rows', () => {
    // Completed execute row: the terminal itself retains the output.
    renderEntry('completed', 'command', () => undefined);
    // Running non-execute row (plan detail).
    renderEntry('running', 'plan', () => undefined);
    // Unavailable action (no provider value): history/replay surfaces.
    renderEntry('running', 'command', null);
    expect(
      screen.queryByRole('button', { name: '在终端中查看' }),
    ).toBeNull();
  });

  it('opens the mirror on click', () => {
    const onOpen = vi.fn();
    renderEntry('running', 'command', onOpen);
    fireEvent.click(
      screen.getByRole('button', { name: '在终端中查看' }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('CommandCardMenu', () => {
  it('copies the command and reports Copied, then retires the menu', async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      render(createElement(CommandCardMenu, { command: 'pnpm test' }));
      const trigger = screen.getByRole('button', {
        name: 'Command actions',
      });
      fireEvent.click(trigger);
      const item = screen.getByRole('menuitem', {
        name: 'Copy Command',
      });
      fireEvent.click(item);
      expect(writeText).toHaveBeenCalledWith('pnpm test');
      expect(item.textContent).toBe('Copied');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('prevents the summary default so the details row never toggles', () => {
    render(createElement(CommandCardMenu, { command: 'git status' }));
    // fireEvent returns false when a handler called preventDefault —
    // the same cancellation that stops <summary> from toggling.
    expect(
      fireEvent.click(
        screen.getByRole('button', { name: 'Command actions' }),
      ),
    ).toBe(false);
  });

  it('closes on Escape and on pointer-down outside', () => {
    render(createElement(CommandCardMenu, { command: 'git status' }));
    const trigger = screen.getByRole('button', {
      name: 'Command actions',
    });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('SubagentSummaryRow', () => {
  it('names the delegation with its ledger summary', () => {
    render(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: 'Map the payment flow',
        status: 'completed',
        toolUseCount: 7,
        durationMs: 4_200,
      }),
    );
    screen.getByText('explore subagent');
    screen.getByText('Map the payment flow');
    screen.getByText('Completed');
    expect(
      document.querySelector('.dvx-subagent-metrics')?.textContent,
    ).toContain('Elapsed4.2s');
    expect(
      document.querySelector('.dvx-subagent-metrics')?.textContent,
    ).toContain('Tools7');
  });

  it('spins quietly while running without counters', () => {
    render(
      createElement(SubagentSummaryRow, {
        type: 'generalPurpose',
        description: '',
        status: 'running',
        toolUseCount: null,
        durationMs: null,
      }),
    );
    screen.getByText('Running');
    expect(screen.queryByText(/tool use/)).toBeNull();
    // No description span when the delegation omitted one.
    expect(
      document.querySelector('.dvx-subagent-description'),
    ).toBeNull();
    // Decision change 2026-08-12: a running delegation carries its
    // own CSS spinner (it can outlive the parent turn's shimmer).
    expect(
      document.querySelector('.dvx-subagent-spinner'),
    ).not.toBeNull();
  });

  it('treats a statusless row under a running Task as live work', () => {
    // Identity comes from the Task input ~40s before the SDK's
    // lifecycle notification; under a running parent the delegation
    // is live by construction, so the row spins instead of sitting
    // inert for the whole visible run.
    render(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: 'Early identity',
        status: null,
        toolUseCount: null,
        durationMs: null,
        parentRunning: true,
      }),
    );
    screen.getByText('Running');
    expect(
      document.querySelector('.dvx-subagent-spinner'),
    ).not.toBeNull();
  });

  it('stays statusless when neither the SDK nor the parent is live', () => {
    render(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: 'Identity only',
        status: null,
        toolUseCount: null,
        durationMs: null,
      }),
    );
    screen.getByText('explore subagent');
    screen.getByText('Pending');
    expect(document.querySelector('.dvx-subagent-spinner')).toBeNull();
  });

  it('drops the spinner once the delegation settled', () => {
    render(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: '',
        status: 'completed',
        toolUseCount: null,
        durationMs: null,
      }),
    );
    expect(document.querySelector('.dvx-subagent-spinner')).toBeNull();
  });

  it('labels a delegation that outlived its settled parent row', () => {
    render(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: 'Long research',
        status: 'running',
        toolUseCount: null,
        durationMs: null,
        parentSettled: true,
      }),
    );
    screen.getByText('Running in background');
    // Still live work, so the spinner stays.
    expect(
      document.querySelector('.dvx-subagent-spinner'),
    ).not.toBeNull();
  });

  it('keeps every Subagent state inside the inline card', () => {
    const { rerender } = render(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: 'Map the flow',
        status: null,
        toolUseCount: null,
        durationMs: null,
        toolUseId: 'use-1',
        parentRunning: true,
      }),
    );
    expect(
      screen.queryByRole('button', {
        name: 'Open explore subagent details',
      }),
    ).toBeNull();
    rerender(
      createElement(SubagentSummaryRow, {
        type: 'explore',
        description: 'Map the flow',
        status: 'running',
        toolUseCount: null,
        durationMs: null,
        toolUseId: 'use-1',
        parentRunning: false,
      }),
    );
    expect(
      screen.queryByRole('button', {
        name: 'Open explore subagent details',
      }),
    ).toBeNull();
  });

  it('shows the latest sampled child activity in the progress card', () => {
    const activity = { action: 'Reading files' };
    render(
      <SubagentActivityStoreContext.Provider
        value={{
          get: (toolUseId) =>
            toolUseId === 'use-1'
              ? activity
              : undefined,
          subscribe: () => () => undefined,
        }}
      >
        <SubagentSummaryRow
          type="explore"
          description="Map the flow"
          status="running"
          toolUseCount={3}
          durationMs={null}
          toolUseId="use-1"
        />
      </SubagentActivityStoreContext.Provider>,
    );
    expect(
      document.querySelector('.dvx-subagent-metrics')?.textContent,
    ).toContain('Tools3');
    screen.getByText('Reading files');
  });
});

describe('BackgroundProcessHint', () => {
  it('renders one quiet informational line without chrome', () => {
    render(createElement(BackgroundProcessHint));
    const hint = screen.getByText(
      'Background process · Keeps running until you stop it manually',
    );
    expect(hint.className).toBe('dvx-tool-background-hint');
    // No icon, no button: the GUI cannot stop the process
    // (fail-closed), so the line only informs.
    expect(hint.querySelector('svg, button')).toBeNull();
  });
});

describe('formatSubagentSummary', () => {
  it('joins status, singular tool use, and duration', () => {
    expect(
      formatSubagentSummary({
        status: 'failed',
        toolUseCount: 1,
        durationMs: 900,
      }),
    ).toBe('failed · 1 tool use · 0.9s');
  });

  it('omits counters the ledger never reported', () => {
    expect(
      formatSubagentSummary({
        status: 'cancelled',
        toolUseCount: null,
        durationMs: null,
      }),
    ).toBe('cancelled');
  });
});

describe('formatThinkingLabel', () => {
  it('reads completed thinking as a past-tense duration', () => {
    expect(formatThinkingLabel('complete', 3_000)).toBe(
      'Thought for 3s',
    );
    expect(formatThinkingLabel('complete', 3_240)).toBe(
      'Thought for 3s',
    );
    expect(formatThinkingLabel('complete', 72_000)).toBe(
      'Thought for 1m 12s',
    );
    expect(formatThinkingLabel('complete', 120_400)).toBe(
      'Thought for 2m',
    );
  });

  it('keeps sub-second runs qualitative and fractions visible', () => {
    expect(formatThinkingLabel('complete', 320)).toBe('Thought briefly');
    expect(formatThinkingLabel('complete', 700)).toBe('Thought for 0.7s');
  });

  it('degrades without a duration and names stopped runs', () => {
    expect(formatThinkingLabel('complete', null)).toBe('Thought');
    expect(formatThinkingLabel(undefined, null)).toBe('Thought');
    expect(formatThinkingLabel('incomplete', 3_000)).toBe(
      'Thinking stopped',
    );
  });
});

describe('formatPlanSummary', () => {
  it('pairs the completed count with the in-progress item', () => {
    expect(
      formatPlanSummary(
        '1. [completed] Survey the modules\n' +
          '2. [in_progress] Design the API\n' +
          '3. [pending] Write the tests',
      ),
    ).toBe('1/3 · Design the API');
  });

  it('falls back to the next pending item after an advance', () => {
    expect(
      formatPlanSummary(
        '1. [completed] Survey the modules\n' +
          '2. [pending] Write the tests',
      ),
    ).toBe('1/2 · Write the tests');
  });

  it('shows the count alone once every item is complete', () => {
    expect(
      formatPlanSummary(
        '1. [completed] Survey the modules\n2. [done] Ship it',
      ),
    ).toBe('2/2');
  });

  it('truncates a long current item like other summary lines', () => {
    const summary = formatPlanSummary(
      `1. [in_progress] ${'x'.repeat(150)}`,
    );
    expect(summary).toBe(`0/1 · ${'x'.repeat(119)}…`);
  });

  it('returns null when no steps parse', () => {
    expect(formatPlanSummary('')).toBeNull();
    expect(formatPlanSummary('   \n  ')).toBeNull();
  });
});

describe('findSlashToken', () => {
  it('matches only a leading slash with the caret inside the slug', () => {
    expect(findSlashToken('/', 1)).toEqual({ end: 1, query: '' });
    expect(findSlashToken('/dep', 4)).toEqual({ end: 4, query: 'dep' });
    expect(findSlashToken('/dep', 2)).toEqual({ end: 2, query: 'd' });
  });

  it('rejects drafts that are not a command slug at the caret', () => {
    expect(findSlashToken('hello /dep', 10)).toBeNull();
    expect(findSlashToken('/deploy now', 11)).toBeNull();
    expect(findSlashToken('/dep/loy', 8)).toBeNull();
    expect(findSlashToken('/de@p', 5)).toBeNull();
    expect(findSlashToken('/', 0)).toBeNull();
    expect(findSlashToken(`/${'a'.repeat(65)}`, 66)).toBeNull();
  });
});

describe('filterSlashCommands', () => {
  const command = (
    name: string,
    isExecutable = false,
  ): CommandSummary => ({
    name,
    description: null,
    argumentHint: null,
    isExecutable,
  });

  it('hides executable commands and filters by name substring', () => {
    const commands = {
      status: 'ready' as const,
      items: [
        command('deploy'),
        command('triage', true),
        command('undeploy'),
        command('review'),
      ],
      recent: [],
    };
    expect(
      filterSlashCommands(commands, 'dep').map((item) => item.name),
    ).toEqual(['deploy', 'undeploy']);
    expect(
      filterSlashCommands(commands, 'triage'),
    ).toEqual([]);
  });

  it('lists recent commands first, the rest alphabetical', () => {
    const commands = {
      status: 'ready' as const,
      items: [
        command('alpha'),
        command('beta'),
        command('gamma'),
      ],
      recent: ['gamma', 'beta'],
    };
    expect(
      filterSlashCommands(commands, '').map((item) => item.name),
    ).toEqual(['gamma', 'beta', 'alpha']);
  });
});

describe('findMentionToken', () => {
  it('triggers at the start of the draft and after whitespace', () => {
    expect(findMentionToken('@src', 4)).toEqual({
      start: 0,
      end: 4,
      query: 'src',
    });
    expect(findMentionToken('look at @Thr', 12)).toEqual({
      start: 8,
      end: 12,
      query: 'Thr',
    });
  });

  it('triggers directly after CJK text and punctuation', () => {
    expect(findMentionToken('帮我看看@src', 8)).toEqual({
      start: 4,
      end: 8,
      query: 'src',
    });
    expect(findMentionToken('（见@a', 4)).toEqual({
      start: 2,
      end: 4,
      query: 'a',
    });
  });

  it('never triggers inside email-like or doubled-@ text', () => {
    expect(findMentionToken('user@host', 9)).toBeNull();
    expect(findMentionToken('a.b@c', 5)).toBeNull();
    expect(findMentionToken('x-y@z', 5)).toBeNull();
    expect(findMentionToken('@@src', 5)).toBeNull();
  });

  it('ends the token at whitespace or a second @', () => {
    expect(findMentionToken('@src file', 9)).toBeNull();
    expect(findMentionToken('no mention here', 15)).toBeNull();
  });
});

describe('splitMentionPath', () => {
  it('splits the file name from its directory', () => {
    expect(splitMentionPath('src/webview/assistant/Thread.tsx')).toEqual({
      name: 'Thread.tsx',
      directory: 'src/webview/assistant',
    });
  });

  it('leaves root-level files without a directory', () => {
    expect(splitMentionPath('package.json')).toEqual({
      name: 'package.json',
      directory: '',
    });
  });
});

describe('readDroppedFileUris', () => {
  const transfer = (
    data: Readonly<Record<string, string>>,
  ): Pick<DataTransfer, 'getData'> => ({
    getData: (type: string) => data[type] ?? '',
  });

  it('parses text/uri-list with CRLF lines and comments', () => {
    expect(
      readDroppedFileUris(
        transfer({
          'text/uri-list':
            '# dragged files\r\nfile:///C:/repo/a.ts\r\n\r\nfile:///C:/repo/b.md\n',
        }),
      ),
    ).toEqual(['file:///C:/repo/a.ts', 'file:///C:/repo/b.md']);
  });

  it('falls back to the vs code JSON uri list', () => {
    expect(
      readDroppedFileUris(
        transfer({
          'application/vnd.code.uri-list': JSON.stringify([
            'file:///C:/repo/a.ts',
          ]),
        }),
      ),
    ).toEqual(['file:///C:/repo/a.ts']);
  });

  it('drops non-file and overlong URIs', () => {
    expect(
      readDroppedFileUris(
        transfer({
          'text/uri-list': [
            'https://example.com/a.ts',
            'untitled:Untitled-1',
            `file:///${'a'.repeat(2100)}`,
            'file:///C:/repo/kept.ts',
          ].join('\n'),
        }),
      ),
    ).toEqual(['file:///C:/repo/kept.ts']);
  });

  it('returns nothing for an empty transfer', () => {
    expect(readDroppedFileUris(transfer({}))).toEqual([]);
  });
});

describe('computePinnedUserIndex', () => {
  it('picks the last message whose top reached the viewport top', () => {
    expect(computePinnedUserIndex([-200, 0, 150], 0)).toBe(1);
    expect(computePinnedUserIndex([-200, -50, 150], 0)).toBe(1);
    expect(computePinnedUserIndex([-200, -50, -10], 0)).toBe(2);
  });

  it('reports none pinned while every message sits below the top', () => {
    expect(computePinnedUserIndex([120, 400], 0)).toBe(-1);
    expect(computePinnedUserIndex([], 0)).toBe(-1);
  });

  it('retains the current owner through fractional sticky jitter', () => {
    expect(computePinnedUserIndex([0, 2.5], 0, 1)).toBe(1);
    expect(computePinnedUserIndex([0, 3.5], 0, 1)).toBe(0);
  });
});

describe('shouldCompactStickyUser', () => {
  it('uses a release deadband so line clamping cannot oscillate', () => {
    expect(shouldCompactStickyUser(false, 0.5, 0)).toBe(true);
    expect(shouldCompactStickyUser(true, 20, 0)).toBe(true);
    expect(shouldCompactStickyUser(true, 49, 0)).toBe(false);
  });
});

describe('computeStickyLayout', () => {
  it('covers older stuck messages behind the pinned one', () => {
    const layout = computeStickyLayout([0, 0, 300], [40, 60, 40], 0);
    expect(layout.pinnedIndex).toBe(1);
    expect(layout.covered).toEqual([true, false, false]);
    expect(layout.pushPx).toBe(0);
  });

  it('pushes the pinned message out as the next one reaches it', () => {
    // Pinned block is 60px tall; the next message top has scrolled to
    // 45px, intruding 15px into the pinned block.
    const layout = computeStickyLayout([0, 45], [60, 40], 0);
    expect(layout.pinnedIndex).toBe(0);
    expect(layout.pushPx).toBe(15);
  });

  it('caps the push at the pinned block height during hand-off', () => {
    const layout = computeStickyLayout([0, -30], [60, 40], 0);
    // The next message became pinned itself; the old one is covered.
    expect(layout.pinnedIndex).toBe(1);
    expect(layout.covered).toEqual([true, false]);
    const almost = computeStickyLayout([0, 2], [60, 40], 0);
    expect(almost.pinnedIndex).toBe(0);
    expect(almost.pushPx).toBeLessThanOrEqual(60);
    expect(almost.pushPx).toBeCloseTo(58);
  });

  it('keeps the pinned message untouched while the next is far', () => {
    const layout = computeStickyLayout([0, 500], [60, 40], 0);
    expect(layout.pushPx).toBe(0);
  });

  it('never pushes an open edit card, even mid hand-off', () => {
    // A 400px edit card is pinned and the next message has intruded
    // deep into it; without the exemption pushPx would be 355 and
    // only the card footer would remain visible.
    const layout = computeStickyLayout([0, 45], [400, 40], 0, 0);
    expect(layout.pinnedIndex).toBe(0);
    expect(layout.pushPx).toBe(0);
  });

  it('keeps the edit card pinned instead of handing off to later messages', () => {
    // Scrolled far past the editor: the second message would
    // naturally own the pin, but the editor keeps the slot and the
    // stuck later message hides behind it.
    const layout = computeStickyLayout(
      [-500, -30, 200],
      [400, 40, 40],
      0,
      0,
    );
    expect(layout.pinnedIndex).toBe(0);
    expect(layout.pushPx).toBe(0);
    expect(layout.covered).toEqual([false, true, false]);
  });

  it('keeps normal push behavior while the editor sits below the pin', () => {
    const layout = computeStickyLayout([0, 45], [60, 400], 0, 1);
    expect(layout.pinnedIndex).toBe(0);
    expect(layout.pushPx).toBe(15);
  });

  it('pins nothing while everything, editor included, is below the top', () => {
    const layout = computeStickyLayout([120, 400], [60, 400], 0, 1);
    expect(layout.pinnedIndex).toBe(-1);
    expect(layout.pushPx).toBe(0);
    expect(layout.covered).toEqual([false, false]);
  });
});

describe('applyFollowScroll', () => {
  const sample = (
    scrollTop: number,
    scrollHeight: number,
    clientHeight = 400,
  ) => ({ scrollTop, scrollHeight, clientHeight });

  it('keeps following across the streaming growth race', () => {
    const state = createFollowState();
    // Coordinator glued to bottom (writes 600), but by the time the
    // scroll event fires more content rendered: scrollTop unchanged
    // while scrollHeight grew. assistant-ui treated this as a user
    // scroll; the latch must not.
    state.pendingProgrammaticTop = 600;
    applyFollowScroll(state, sample(600, 1000));
    expect(state.following).toBe(true);
    applyFollowScroll(state, sample(600, 1400));
    expect(state.following).toBe(true);
  });

  it('releases on a genuine upward user scroll', () => {
    const state = createFollowState();
    applyFollowScroll(state, sample(600, 1000));
    applyFollowScroll(state, sample(400, 1000));
    expect(state.following).toBe(false);
  });

  it('releases on the first upward scroll from an existing position', () => {
    const state = createFollowState(sample(600, 1000));
    applyFollowScroll(state, sample(400, 1000));
    expect(state.following).toBe(false);
  });

  it('does not release on a clamp from shrinking content', () => {
    const state = createFollowState();
    applyFollowScroll(state, sample(600, 1000));
    // Content collapsed (group folded); the browser clamps scrollTop.
    applyFollowScroll(state, sample(200, 620));
    expect(state.following).toBe(true);
  });

  it('re-latches when the user returns to the bottom', () => {
    const state = createFollowState();
    applyFollowScroll(state, sample(600, 1000));
    applyFollowScroll(state, sample(300, 1000));
    expect(state.following).toBe(false);
    applyFollowScroll(
      state,
      sample(1000 - 400 - FOLLOW_REJOIN_PX, 1000),
    );
    expect(state.following).toBe(true);
  });

  it('re-latches a return to bottom that raced streaming growth', () => {
    const state = createFollowState();
    applyFollowScroll(state, sample(600, 1200));
    applyFollowScroll(state, sample(300, 1200));
    expect(state.following).toBe(false);
    // The user jumped to the bottom (maxTop of the 1200px content =
    // 800), but by the time the event fires another 120px streamed
    // in: the live distance is large yet the gesture reached the
    // previous bottom, so following resumes.
    applyFollowScroll(state, sample(800, 1320));
    expect(state.following).toBe(true);
    // A partial downward scroll far from the bottom does not latch.
    const parked = createFollowState();
    applyFollowScroll(parked, sample(600, 1200));
    applyFollowScroll(parked, sample(200, 1200));
    expect(parked.following).toBe(false);
    applyFollowScroll(parked, sample(400, 1320));
    expect(parked.following).toBe(false);
  });

  it('treats the marked programmatic write as non-user input', () => {
    const state = createFollowState();
    applyFollowScroll(state, sample(600, 1000));
    applyFollowScroll(state, sample(300, 1000));
    expect(state.following).toBe(false);
    // A programmatic jump back down must not re-enable following by
    // itself unless it actually lands at the bottom.
    state.pendingProgrammaticTop = 450;
    applyFollowScroll(state, sample(450, 1000));
    expect(state.following).toBe(false);
    expect(state.pendingProgrammaticTop).toBeNull();
  });

  it('releases before a slow downward wheel can be glued backward', () => {
    const state = createFollowState(sample(300, 1000));
    state.pendingProgrammaticTop = 600;
    expect(applyFollowWheelIntent(state, 12, sample(300, 1000))).toBe(true);
    expect(state.following).toBe(false);
    expect(state.pendingProgrammaticTop).toBeNull();
  });

  it('keeps streaming follow for a downward wheel already at bottom', () => {
    const atBottom = sample(900, 1000);
    const state = createFollowState(atBottom);
    expect(applyFollowWheelIntent(state, 12, atBottom)).toBe(false);
    expect(state.following).toBe(true);
  });

  it('ignores a wheel event without vertical intent', () => {
    const state = createFollowState(sample(300, 1000));
    expect(applyFollowWheelIntent(state, 0, sample(300, 1000))).toBe(false);
    expect(state.following).toBe(true);
  });
});

describe('formatCompactDividerLabel', () => {
  it('shortens the host compaction message', () => {
    expect(
      formatCompactDividerLabel(
        'Conversation compacted: 71 earlier messages summarized.',
      ),
    ).toBe('Summarized 71 earlier messages');
    expect(
      formatCompactDividerLabel(
        'Conversation compacted: 1 earlier message summarized.',
      ),
    ).toBe('Summarized 1 earlier message');
  });

  it('falls back to a generic label without a count', () => {
    expect(formatCompactDividerLabel('Conversation compacted.')).toBe(
      'Conversation summarized',
    );
  });
});

describe('AttachmentChip', () => {
  const summary = {
    id: 'attachment-1',
    kind: 'image' as const,
    name: 'shot.png',
    sizeBytes: 3,
    truncated: false,
  };

  it('renders a thumbnail when the webview staged the image bytes', () => {
    rememberImagePreview(
      'shot.png',
      3,
      'data:image/png;base64,aW1n',
    );
    const onRemove = vi.fn();
    render(<AttachmentChip attachment={summary} onRemove={onRemove} />);
    const image = screen.getByRole('img', { name: 'shot.png' });
    expect(image.getAttribute('src')).toBe(
      'data:image/png;base64,aW1n',
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove attachment shot.png',
      }),
    );
    expect(onRemove).toHaveBeenCalledWith('attachment-1');
  });

  it('falls back to the labeled chip without cached bytes', () => {
    render(<AttachmentChip attachment={summary} onRemove={vi.fn()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Image')).toBeDefined();
    expect(screen.getByText('shot.png')).toBeDefined();
  });
});

describe('imagePreviewCache', () => {
  it('keys previews by name and size together', () => {
    rememberImagePreview('a.png', 3, 'data:a');
    expect(getImagePreview('a.png', 3)).toBe('data:a');
    expect(getImagePreview('a.png', 4)).toBeUndefined();
    expect(getImagePreview('b.png', 3)).toBeUndefined();
  });

  it('evicts the least recently stored entries beyond the cap', () => {
    for (let index = 0; index < 25; index += 1) {
      rememberImagePreview(`file-${index}.png`, index, `data:${index}`);
    }
    expect(getImagePreview('file-0.png', 0)).toBeUndefined();
    expect(getImagePreview('file-24.png', 24)).toBe('data:24');
  });
});
