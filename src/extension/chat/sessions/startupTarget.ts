import type { RuntimeSessionTarget } from '../../../runtime/DroidRuntime';
import type { RuntimeLifecyclePort } from './runtimeLifecyclePort';

/** The recent-chat list is bounded; verify the selected record before dropping it. */
export async function resolveStartupTarget(
  ctl: Pick<RuntimeLifecyclePort, 'recoveryStore' | 'sessionCatalog' | 'effects' | 'childSession'>,
  cwd: string,
): Promise<RuntimeSessionTarget> {
  if (ctl.childSession) return { kind: 'resume', ...ctl.childSession, child: true };
  const sessionId = ctl.recoveryStore.getSelectedSessionId();
  const resumable = sessionId !== null && (
    ctl.effects.hasCatalogSession(sessionId, cwd) ||
    await ctl.sessionCatalog.canResumeSession?.(cwd, sessionId) === true
  );
  return resumable ? { kind: 'resume', cwd, sessionId } : { kind: 'new', cwd };
}
