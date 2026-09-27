// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import { MissionCatalog as V2MissionCatalog } from './MissionCatalog';

const rows: readonly MissionControlCatalogRow[] = [
  row('mission-safe-alpha', 'Duplicate title', 'running', 'Repository one'),
  row('mission-safe-beta', 'Duplicate title', 'paused', 'Repository two'),
  row('mission-safe-planning', 'Planning', 'planning'),
  row('mission-safe-input', 'Awaiting input', 'awaiting_input'),
  row('mission-safe-init', 'Initializing', 'initializing'),
  row('mission-safe-turn', 'Orchestrating', 'orchestrator_turn'),
  row('mission-safe-done', 'Completed', 'completed'),
];

afterEach(cleanup);

describe.each([['V2', V2MissionCatalog]] as const)('%s MissionCatalog', (_version, MissionCatalog) => {
  it('classifies every official lifecycle without inventing states', async () => {
    const user = userEvent.setup();
    const onFilter = vi.fn();
    render(
      <MissionCatalog
        state={{ status: 'ready', rows }}
        filter="all"
        onFilter={onFilter}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /Open Mission/ })).toHaveLength(7);
    await user.click(screen.getByRole('tab', { name: 'Running' }));
    expect(onFilter).toHaveBeenCalledWith('running');

    cleanup();
    render(
      <MissionCatalog
        state={{ status: 'ready', rows }}
        filter="running"
        onFilter={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Open Mission/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Open Mission “Paused”' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Mission “Completed”' })).toBeNull();
  });

  it('moves semantic filter tabs with arrow keys', async () => {
    const user = userEvent.setup();
    const onFilter = vi.fn();
    render(
      <MissionCatalog
        state={{ status: 'ready', rows }}
        filter="all"
        onFilter={onFilter}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    screen.getByRole('tab', { name: 'All' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onFilter).toHaveBeenCalledWith('running');
    await user.keyboard('{End}');
    expect(onFilter).toHaveBeenLastCalledWith('completed');
  });

  it('routes duplicate titles by correlation identity for pointer, Enter, and Space', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <MissionCatalog
        state={{ status: 'ready', rows: rows.slice(0, 2) }}
        filter="all"
        onFilter={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    const missionButtons = screen.getAllByRole('button', {
      name: /Open Mission “Duplicate title” in Repository/,
    });
    expect(missionButtons[0]?.getAttribute('aria-label')).toBe(
      'Open Mission “Duplicate title” in Repository one',
    );
    expect(missionButtons[1]?.getAttribute('aria-label')).toBe(
      'Open Mission “Duplicate title” in Repository two',
    );
    await user.click(missionButtons[0]!);
    missionButtons[1]!.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onNavigate.mock.calls).toEqual([
      [{ route: 'detail', catalogId: 'mission-safe-alpha' }],
      [{ route: 'detail', catalogId: 'mission-safe-beta' }],
      [{ route: 'detail', catalogId: 'mission-safe-beta' }],
    ]);
  });

  it('keeps opaque identities out of visible and accessible presentation', () => {
    const { container } = render(
      <MissionCatalog
        state={{ status: 'ready', rows: rows.slice(0, 1) }}
        filter="all"
        onFilter={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(container.textContent).not.toContain('mission-safe-alpha');
    expect(container.innerHTML).not.toContain('mission-safe-alpha');
    expect(
      screen.getByRole('button', {
        name: 'Open Mission “Duplicate title” in Repository one',
      }),
    ).toBeDefined();
    expect(screen.getByText('Repository one')).toBeDefined();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('distinguishes duplicate titles even when safe workspace labels match', () => {
    const duplicateWorkspaceRows = [
      row('mission-safe-one', 'Same title', 'running', 'Shared workspace'),
      row('mission-safe-two', 'Same title', 'paused', 'Shared workspace'),
    ];
    const { container } = render(
      <MissionCatalog
        state={{ status: 'ready', rows: duplicateWorkspaceRows }}
        filter="all"
        onFilter={vi.fn()}
        onRefresh={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Open Mission “Same title” in Shared workspace, item 1 of 2',
      }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', {
        name: 'Open Mission “Same title” in Shared workspace, item 2 of 2',
      }),
    ).toBeDefined();
    expect(container.innerHTML).not.toContain('mission-safe-one');
    expect(container.innerHTML).not.toContain('mission-safe-two');
  });

  it('retains stale rows while refreshing and exposes bounded recovery actions', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onNavigate = vi.fn();
    const { rerender } = render(
      <MissionCatalog
        state={{ status: 'refreshing', rows: rows.slice(0, 1) }}
        filter="all"
        onFilter={vi.fn()}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Refreshing');
    expect(screen.getByText('Duplicate title')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();

    rerender(
      <MissionCatalog
        state={{
          status: 'error',
          rows: rows.slice(0, 1),
          message: 'The complete Mission catalog could not be loaded.',
          retryable: true,
        }}
        filter="all"
        onFilter={vi.fn()}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.click(screen.getByRole('button', { name: 'New Mission' }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenCalledWith({ route: 'new-mission' });
  });
});

function row(
  catalogId: string,
  title: string,
  lifecycle: MissionControlCatalogRow['lifecycle'],
  workspaceLabel = '—',
): MissionControlCatalogRow {
  return {
    catalogId,
    title,
    lifecycle,
    workspaceLabel,
    computerLabel: '—',
    progress: null,
    createdAt: null,
    updatedAt: null,
    elapsedMs: null,
    attached: false,
  };
}
