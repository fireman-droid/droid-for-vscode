import { changed, choose, confirm, ManagementError, requireSuccess, type ManagementContext } from './managementUi';

/** Separate from normal archive: force never falls through from an ordinary archive failure. */
export async function forceArchiveSession(context: ManagementContext): Promise<void> {
  const sessions = await context.droid.sessions.listOpened({ filter: { includeBtwForks: true } });
  context.assertCurrent();
  const selected = await choose('Force archive an open session (current chat excluded)', sessions
    .filter((session) => session.id !== context.sessionId)
    .map((session) => ({ label: session.title || session.id, description: session.workingState,
      detail: `${session.cwd ?? 'Directory unavailable'} · ${session.id}`, session })));
  if (!selected) return;
  const session = selected.session;
  if (!await confirm(context, `Force archive "${session.title || session.id}"?\nSession: ${session.id}\nDirectory: ${session.cwd ?? 'Unavailable'}\nState: ${session.workingState}\n\nArchiving hides the session. It does NOT stop its agent, cancel queued work, or stop model charges. Use Stop in that session if you want to end its work. Archived sessions can be restored from history.`)) return;
  const fresh = (await context.droid.sessions.listOpened({ filter: { includeBtwForks: true } })).find((row) => row.id === session.id);
  context.assertCurrent(true);
  if (!fresh || fresh.cwd !== session.cwd || fresh.workingState !== session.workingState)
    throw new ManagementError('The session state changed. Inspect it again before force archiving.');
  requireSuccess(await context.droid.sessions.archive(session.id, { force: true }), 'forced session archive');
  context.assertCurrent();
  await changed('Droid confirmed the archive. The agent was not stopped; any running work continues.');
}
