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
    },
    {
      id: 'session-b',
      title: 'Previous refactor',
      messageCount: 7,
      modifiedTime: '2026-02-19T09:00:00.000Z',
      active: false,
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
        onRefresh={vi.fn()}
        onNewSession={vi.fn()}
        onSelectSession={onSelect}
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

  it('gates every host-backed action and closes with Escape', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onNew = vi.fn();
    render(
      <SessionDrawer
        sessions={sessions}
        actionsDisabled
        onRefresh={onRefresh}
        onNewSession={onNew}
        onSelectSession={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh' })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'New session',
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: /Previous refactor/,
      }).disabled,
    ).toBe(true);

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: 'Session history' }),
    ).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });
});
