// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommandSummary } from '../../shared/bridgeMessages';
import {
  clearImagePreviews,
  getImagePreview,
  rememberImagePreview,
} from './imagePreviewCache';
import {
  AttachmentChip,
  HistoryNotice,
  PendingResponse,
  computePinnedUserIndex,
  filterSlashCommands,
  findMentionToken,
  findSlashToken,
  formatPlanSummary,
  formatThinkingLabel,
  readDroppedFileUris,
} from './Thread';

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
