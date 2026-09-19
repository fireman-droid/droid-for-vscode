import { changed, choose, confirm, ManagementError, requireSuccess, type ManagementContext } from './managementUi';
import type { DaemonTerminalManager } from '../terminal/DaemonTerminalManager';

export async function manageTerminals(context: ManagementContext, manager: DaemonTerminalManager): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const terminals = await context.droid.terminals.list(context.sessionId, {});
    const selected = await choose('Terminals owned by this Droid session', [
      { label: 'New interactive terminal…', action: 'new' as const, description: 'Open a daemon-owned shell in the current workspace' },
      ...terminals.map((terminal) => ({
        label: terminal.id, description: `PID ${terminal.pid ?? 'unavailable'} · ${terminal.cols}×${terminal.rows}`,
        action: 'existing' as const, terminal,
      })),
    ]);
    if (!selected) return;
    if (selected.action === 'new') {
      if (!await confirm(context, 'Create an interactive Droid shell in the current workspace? Anything you type runs directly, outside Droid model permission prompts. Closing the Cursor terminal only detaches; closing the daemon shell is a separate confirmed action.')) continue;
      manager.open(context.droid);
      return;
    }
    const action = await choose('Droid terminal action', [
      { label: 'Open interactive terminal…', action: 'open' },
      { label: 'Close daemon shell…', action: 'close' },
    ]);
    if (!action) continue;
    if (action.action === 'open') {
      if (!await confirm(context, `Open terminal "${selected.terminal.id}" for direct input? This may interact with existing shell work. Only new output is shown; history is not replayed. Commands run outside Droid model permission prompts. Closing the Cursor view only detaches.`)) continue;
      manager.open(context.droid, selected.terminal);
      return;
    }
    if (!await confirm(context, `Close Droid terminal "${selected.terminal.id}"? Its shell and attached work may be interrupted. This action cannot be undone.`)) continue;
    const fresh = (await context.droid.terminals.list(context.sessionId, {})).find((terminal) => terminal.id === selected.terminal.id);
    context.assertCurrent(true);
    if (!fresh || fresh.pid !== selected.terminal.pid || fresh.createdAt.getTime() !== selected.terminal.createdAt.getTime())
      throw new ManagementError('The terminal changed. Refresh before closing it.');
    requireSuccess(await context.droid.terminals.close(context.sessionId, { terminalId: fresh.id }), 'terminal closure');
    context.assertCurrent();
  }
}

export async function requestDroidUpdate(context: ManagementContext): Promise<void> {
  if (!await confirm(context, 'Ask Droid to update itself? This is a shared local daemon operation and can affect other windows. Finish their tasks before continuing. It does not update the DroidVisX extension.')) return;
  const result = await context.droid.updates.trigger();
  if (!result.triggered) throw new ManagementError('Droid did not start an update. It may already be current or updates may be managed by policy.');
  await changed('Droid accepted the update request. This does not confirm installation has finished; reconnect after Droid completes its update.');
}
