// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import type { ManagementState } from './useManagement';
import { MissionManagement } from './MissionManagement';

afterEach(cleanup);
const rows: MissionControlCatalogRow[] = Array.from({ length: 23 }, (_, index) => ({
  catalogId: `mission-${index}`, title: `Task ${index + 1}`, workspaceLabel: index === 21 ? 'Special repository' : 'Workspace',
  lifecycle: 'completed', computerLabel: 'Local', progress: null, createdAt: null, updatedAt: null, elapsedMs: null, attached: false,
}));
it('searches the whole mission list and returns to page one when the query changes', async () => {
  const user = userEvent.setup();
  const run = vi.fn().mockResolvedValue({ ok: true, missions: rows });
  render(<MissionManagement active state={{ settings: {}, busy: false, run, setNotice: vi.fn() } as unknown as ManagementState} />);
  await screen.findByRole('button', { name: 'Task 1', exact: true });
  await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
  expect(screen.getByRole('button', { name: 'Task 11', exact: true })).toBeDefined();
  const search = screen.getByRole('searchbox');
  await user.type(search, 'special');
  expect(screen.getByRole('button', { name: 'Task 22', exact: true })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Task 11', exact: true })).toBeNull();
  expect(within(screen.getByRole('navigation')).getByText(/1–1/)).toBeDefined();
  await user.clear(search);
  expect(screen.getByRole('button', { name: 'Task 1', exact: true })).toBeDefined();
  expect(screen.getByRole('button', { name: /第 1 页|Page 1/ }).getAttribute('aria-current')).toBe('page');
  expect(run).toHaveBeenCalledTimes(1);
});
