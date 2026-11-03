// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementState } from './useManagement';
import { AutomationManagement } from './AutomationManagement';
import { AutomationEditor } from './AutomationEditor';
import { AutomationHistory } from './AutomationHistory';

afterEach(cleanup);
const row: ManagedAutomation = {
  id: 'daily', revision: 'a'.repeat(64), name: 'Daily checks', description: '', prompt: 'Inspect the repository.',
  schedule: '0 9 * * 1-5', model: '', reasoningEffort: '', workingDirectory: '', status: 'paused',
  valid: true, editable: true, nextRunAt: null, lastRunAt: null,
};
const state = (run: ReturnType<typeof vi.fn>) => ({
  settings: { sessionManagementAvailable: true, reviewQuestion: { models: [] } }, busy: false, run, setNotice: vi.fn(),
}) as unknown as ManagementState;

it('creates a draft only on explicit save, without dispatching or enabling it', async () => {
  const user = userEvent.setup();
  const run = vi.fn().mockImplementation(async action => action.kind === 'automations.list'
    ? { ok: true, automations: [] } : { ok: true, message: 'Created' });
  render(<AutomationManagement active state={state(run)} />);
  await screen.findByText('No local automations yet');
  await user.click(screen.getByRole('button', { name: 'New automation' }));
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Morning checks');
  await user.type(screen.getByRole('textbox', { name: 'Instructions' }), 'Inspect the repository.');
  expect(run.mock.calls.every(([action]) => action.kind === 'automations.list')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Create paused' }));
  await waitFor(() => expect(run).toHaveBeenCalledWith({
    kind: 'automations.create', draft: { name: 'Morning checks', description: '', prompt: 'Inspect the repository.',
      schedule: '0 9 * * 1-5', model: '', reasoningEffort: '', workingDirectory: '' },
  }));
  expect(run.mock.calls.some(([action]) => ['automations.run', 'automations.resume'].includes(action.kind))).toBe(false);
});

it('preserves an edited draft when the Host rejects stale configuration', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  const run = vi.fn().mockResolvedValue({ ok: false, message: 'Automation changed. Refresh it before trying again.' });
  render(<AutomationEditor row={row} state={state(run)} onSaved={saved} onClose={vi.fn()} />);
  const instructions = screen.getByRole('textbox', { name: 'Instructions' });
  fireEvent.change(instructions, { target: { value: 'Keep my new instructions.' } });
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(await screen.findByRole('alert')).toBeDefined();
  expect((instructions as HTMLTextAreaElement).value).toBe('Keep my new instructions.');
  expect(saved).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledWith({ kind: 'automations.update', id: row.id, revision: row.revision,
    draft: expect.objectContaining({ prompt: 'Keep my new instructions.' }) });
});

it('requests the next history page without changing or running the automation', async () => {
  const user = userEvent.setup();
  const run = vi.fn().mockImplementation(async action => ({
    ok: true, automationHistory: { id: row.id, offset: action.offset, total: 21,
      runs: Array.from({ length: action.offset === 0 ? 20 : 1 }, (_, index) => ({
        id: `run-${action.offset + index}`, status: 'success', startedAt: '2026-11-04T09:00:00Z',
        completedAt: null, error: null, modelFallback: null,
      })),
    },
  }));
  render(<AutomationHistory row={row} state={state(run)} onClose={vi.fn()} />);
  await screen.findByText('1–20 / 21');
  await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
  await screen.findByText('21–21 / 21');
  expect(run.mock.calls.map(([action]) => action)).toEqual([
    { kind: 'automations.history', id: row.id, offset: 0 },
    { kind: 'automations.history', id: row.id, offset: 20 },
  ]);
});
