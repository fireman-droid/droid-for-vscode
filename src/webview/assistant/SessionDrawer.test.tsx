// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionCatalogState } from '../../shared/bridgeMessages';
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

describe('SessionDrawer', () => {
  it('uses an overlay affordance and keeps search entirely local', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SessionDrawer
        sessions={sessions}
        actionsDisabled={false}
        onSelectSession={onSelect}
        onRenameSession={vi.fn()}
      />,
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
      screen.getByRole('button', { name: /Previous refactor/ }),
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('session-b');
  });

  it('gates session switching and closes with Escape', async () => {
    const user = userEvent.setup();
    render(
      <SessionDrawer
        sessions={sessions}
        actionsDisabled
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: /Previous refactor/,
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
      <SessionDrawer
        sessions={sessions}
        actionsDisabled={false}
        onSelectSession={vi.fn()}
        onRenameSession={onRename}
      />,
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
        sessions={sessions}
        actionsDisabled={false}
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
        onForkSession={vi.fn()}
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
        sessions={favorited}
        actionsDisabled={false}
        onSelectSession={vi.fn()}
        onRenameSession={vi.fn()}
        onForkSession={vi.fn()}
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
});
