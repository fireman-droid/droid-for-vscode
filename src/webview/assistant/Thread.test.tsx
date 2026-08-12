// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CommandSummary } from '../../shared/bridgeMessages';
import {
  HistoryNotice,
  PendingResponse,
  filterSlashCommands,
  findSlashToken,
  formatPlanSummary,
  formatThinkingLabel,
} from './Thread';

afterEach(cleanup);

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
