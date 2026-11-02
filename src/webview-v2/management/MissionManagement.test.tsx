// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import type { ManagementState } from './useManagement';
import { DefaultsSettings } from './DefaultsSettings';
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

it('keeps subtask model defaults valid when switching a configured tier back to Follow main chat', async () => {
  Element.prototype.scrollIntoView = () => {};
  const user = userEvent.setup();
  const defaults = {
    values: {
      modelId: 'auto', reasoningEffort: 'none', interactionMode: 'auto', autonomyLevel: 'high',
      compactionTokenLimit: 300000, compactionTokenLimitPerModel: {}, compactionModel: 'current-model',
      compactionThresholdCheckEnabled: true, subagentAutonomyLevel: 'high',
      'subagentModelSettings.lightModel': 'auto', 'subagentModelSettings.lightReasoningEffort': 'none',
    },
    locked: {}, autonomyLevels: ['off', 'low', 'medium', 'high'], specDirectories: [],
    models: [{ id: 'auto', label: 'Auto Model', reasoning: ['none'], defaultReasoning: 'none', isCustom: false }],
  };
  const run = vi.fn().mockResolvedValue({ ok: true, defaults });
  render(<DefaultsSettings active scope="sessions" state={{ settings: {}, busy: false, run, setNotice: vi.fn() } as unknown as ManagementState} />);
  const trigger = await screen.findByRole('button', { name: 'Model', exact: true });
  await user.click(trigger);
  await user.click(await screen.findByRole('menuitemradio', { name: /跟随主聊天|Follow main chat/ }));
  expect(screen.queryByRole('alert')).toBeNull();
  const save = screen.getByRole('button', { name: /保存|Save/ });
  expect((save as HTMLButtonElement).disabled).toBe(false);
  await user.click(save);
  expect(run).toHaveBeenLastCalledWith({
    kind: 'defaults.save', scope: 'sessions',
    patch: { 'subagentModelSettings.lightModel': null, 'subagentModelSettings.lightReasoningEffort': null },
  });
});
