// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CommandSummary } from '../../shared/bridgeMessages';
import {
  HistoryNotice,
  filterSlashCommands,
  findSlashToken,
} from './Thread';

afterEach(cleanup);

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
