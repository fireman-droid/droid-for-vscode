// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  SessionArchivedState,
  SessionCatalogState,
  SessionSearchState,
} from '../../shared/bridgeMessages';
import { SessionDrawer } from './SessionDrawer';

afterEach(cleanup);

const sessions: SessionCatalogState = {
  status: 'ready',
  items: [
    {
      id: 'session-a',
      title: 'Current work',
      messageCount: 3,
      modifiedTime: '2026-02-20T10:00:00.000Z',
      active: true,
      isFavorite: false,
    },
    {
      id: 'session-b',
      title: 'Previous refactor',
      messageCount: 7,
      modifiedTime: '2026-02-19T09:00:00.000Z',
      active: false,
      isFavorite: false,
    },
  ],
};

function baseProps() {
  return {
    sessions,
    archived: { status: 'idle', items: [] } as const,
    sessionSearch: null,
    actionsDisabled: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn(),
    onForkSession: vi.fn(),
    onToggleFavorite: vi.fn(),
    onArchiveSession: vi.fn(),
    onUnarchiveSession: vi.fn(),
    onRefreshArchived: vi.fn(),
    onSearchContent: vi.fn(),
  };
}

describe('SessionDrawer', () => {
  it('uses an overlay affordance and keeps search entirely local', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SessionDrawer {...baseProps()} onSelectSession={onSelect} />,
    );
    const toggle = screen.getByRole('button', { name: 'Sessions' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('complementary', { name: 'Session history' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Close session history' }),
    ).toBeTruthy();
    expect(screen.getByText('All chats').textContent).toBe('All chats');

    await user.type(
      screen.getByRole('searchbox', { name: 'Search sessions' }),
      'PREVIOUS',
    );
    expect(screen.queryByText('Current work')).toBeNull();
    expect(screen.getByText('Previous refactor')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: /^Previous refactor/ }),
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('session-b');
  });

  it('gates session switching and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<SessionDrawer {...baseProps()} actionsDisabled />);
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: /^Previous refactor/,
      }).disabled,
    ).toBe(true);

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: 'Session history' }),
    ).toBeNull();
  });

  it('renames only the active session through an inline editor', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <SessionDrawer {...baseProps()} onRenameSession={onRename} />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // Only the active session exposes the rename affordance.
    expect(
      screen.getAllByRole('button', { name: 'Rename session' }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole('button', { name: 'Rename session' }),
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Rename session',
    });
    expect(input.value).toBe('Current work');

    await user.clear(input);
    await user.type(input, '  Fireworks demo  {Enter}');
    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith(
      'session-a',
      'Fireworks demo',
    );

    // Escape cancels without renaming and keeps the drawer open.
    await user.click(
      screen.getByRole('button', { name: 'Rename session' }),
    );
    await user.keyboard('{Escape}');
    expect(onRename).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('complementary', { name: 'Session history' }),
    ).toBeTruthy();
  });

  it('toggles favorites from any row', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    render(
      <SessionDrawer
        {...baseProps()}
        onToggleFavorite={onToggleFavorite}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // Every row exposes the toggle, active or not, and no group
    // headers render while nothing is favorited.
    const stars = screen.getAllByRole('button', {
      name: 'Add session to favorites',
    });
    expect(stars).toHaveLength(2);
    expect(screen.queryByText('Favorites')).toBeNull();

    await user.click(stars[1]);
    expect(onToggleFavorite).toHaveBeenCalledOnce();
    expect(onToggleFavorite).toHaveBeenCalledWith('session-b', true);
  });

  it('groups favorited sessions ahead of the rest', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    const favorited: SessionCatalogState = {
      status: 'ready',
      items: [
        sessions.items[0],
        { ...sessions.items[1], isFavorite: true },
      ],
    };
    render(
      <SessionDrawer
        {...baseProps()}
        sessions={favorited}
        onToggleFavorite={onToggleFavorite}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // The favorites group renders first and holds the starred row.
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Favorites',
      'Recent',
    ]);
    const favoriteGroup = screen.getByRole('region', {
      name: 'Favorites',
    });
    expect(favoriteGroup.textContent).toContain('Previous refactor');
    const recentGroup = screen.getByRole('region', { name: 'Recent' });
    expect(recentGroup.textContent).toContain('Current work');

    // A favorited row offers removal.
    await user.click(
      screen.getByRole('button', {
        name: 'Remove session from favorites',
      }),
    );
    expect(onToggleFavorite).toHaveBeenCalledWith('session-b', false);
  });

  it('archives only non-active rows', async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(
      <SessionDrawer {...baseProps()} onArchiveSession={onArchive} />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // The active session has no archive affordance.
    const archives = screen.getAllByRole('button', {
      name: /^Archive /,
    });
    expect(archives).toHaveLength(1);
    expect(archives[0].getAttribute('aria-label')).toBe(
      'Archive Previous refactor',
    );

    await user.click(archives[0]);
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onArchive).toHaveBeenCalledWith('session-b');
  });

  it('loads the archived section lazily and restores from it', async () => {
    const user = userEvent.setup();
    const onRefreshArchived = vi.fn();
    const onUnarchive = vi.fn();
    const archived: SessionArchivedState = {
      status: 'ready',
      items: [
        {
          id: 'session-z',
          title: 'Old spike',
          modifiedTime: '2026-02-10T10:00:00.000Z',
          archivedTime: '2026-02-11T10:00:00.000Z',
        },
      ],
    };
    const idle = render(
      <SessionDrawer
        {...baseProps()}
        onRefreshArchived={onRefreshArchived}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    // Expanding an idle section requests the archived list once.
    await user.click(screen.getByRole('button', { name: /Archived/ }));
    expect(onRefreshArchived).toHaveBeenCalledOnce();
    expect(screen.getByText('Loading archived sessions…')).toBeTruthy();
    idle.unmount();

    render(
      <SessionDrawer
        {...baseProps()}
        archived={archived}
        onUnarchiveSession={onUnarchive}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    await user.click(
      screen.getByRole('button', { name: 'Archived (1)' }),
    );
    expect(screen.getByText('Old spike')).toBeTruthy();

    await user.click(
      screen.getByRole('button', {
        name: 'Restore Old spike from the archive',
      }),
    );
    expect(onUnarchive).toHaveBeenCalledOnce();
    expect(onUnarchive).toHaveBeenCalledWith('session-z');
  });

  it('submits content searches with Enter and renders matches', async () => {
    const user = userEvent.setup();
    const onSearchContent = vi.fn();
    const onSelect = vi.fn();
    const sessionSearch: SessionSearchState = {
      status: 'ready',
      query: 'refactor',
      items: [
        {
          id: 'session-b',
          title: 'Previous refactor',
          modifiedTime: '2026-02-19T09:00:00.000Z',
          snippet: 'we should refactor the store',
        },
        {
          id: 'session-remote',
          title: 'Other workspace hit',
          modifiedTime: null,
          snippet: null,
        },
      ],
    };
    render(
      <SessionDrawer
        {...baseProps()}
        sessionSearch={sessionSearch}
        onSearchContent={onSearchContent}
        onSelectSession={onSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));

    await user.type(
      screen.getByRole('searchbox', { name: 'Search sessions' }),
      '  refactor  {Enter}',
    );
    expect(onSearchContent).toHaveBeenCalledOnce();
    expect(onSearchContent).toHaveBeenCalledWith('refactor');

    const matches = screen.getByRole('region', {
      name: 'Content matches',
    });
    expect(matches.textContent).toContain(
      'we should refactor the store',
    );
    // Hits outside the current catalog render without a button.
    expect(matches.textContent).toContain('Other workspace hit');
    const matchButtons = matches.querySelectorAll('button');
    expect(matchButtons).toHaveLength(1);

    await user.click(matchButtons[0]);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('session-b');
  });

  it('surfaces daemon search errors inside the matches section', async () => {
    const user = userEvent.setup();
    const sessionSearch: SessionSearchState = {
      status: 'error',
      query: 'refactor',
      items: [],
      message: 'The local droid daemon is unavailable.',
    };
    render(
      <SessionDrawer {...baseProps()} sessionSearch={sessionSearch} />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(
      screen.getByText('The local droid daemon is unavailable.'),
    ).toBeTruthy();
  });
});
