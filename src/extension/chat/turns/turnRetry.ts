import { isUsableWorkspace } from '../internals';
import { CATALOG_ERROR_MESSAGE } from '../sessions/sessionCatalog';
import type { TurnRetryPort } from './turnFlowPort';

export function handleRetry(ctl: TurnRetryPort, sessionId: string | null): void {
  if (
    ctl.sessionState.sessionOperationInProgress ||
    ctl.catalogState.refreshInProgress ||
    sessionId !== ctl.sessionState.sessionId ||
    (ctl.sessionState.connection.status !== 'unavailable' &&
      ctl.turnState.turn?.status !== 'failed')
  ) {
    return;
  }

  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    ctl.effects.emitWorkspaceUnavailable(workspace);
    return;
  }
  const retryOptions = ctl.turnState.turn?.status === 'failed'
    ? { acknowledgeFailedTurnId: ctl.turnState.turn.turnId } : {};
  if (ctl.childSession) {
    ctl.effects.startReplacement({ kind: 'resume', ...ctl.childSession, child: true }, retryOptions);
    return;
  }
  if (
    ctl.catalogState.sessions.status === 'idle' ||
    ctl.catalogState.sessions.status === 'error' ||
    ctl.catalogState.catalogCwd !== workspace.cwd
  ) {
    ctl.sessionState.sessionOperationInProgress = true;
    void retryAfterWorkspaceBecomesAvailable(ctl, workspace.cwd, retryOptions).finally(() => {
      ctl.sessionState.sessionOperationInProgress = false;
      ctl.effects.resumeRecoveredIdeReconnect();
    });
    return;
  }
  const resumableId =
    ctl.sessionState.sessionId !== null &&
    ctl.effects.hasCatalogSession(ctl.sessionState.sessionId, workspace.cwd)
      ? ctl.sessionState.sessionId
      : null;
  ctl.effects.startReplacement(
    resumableId === null
      ? { kind: 'new', cwd: workspace.cwd }
      : {
          kind: 'resume',
          cwd: workspace.cwd,
          sessionId: resumableId,
        },
    retryOptions,
  );
}

export async function retryAfterWorkspaceBecomesAvailable(
  ctl: TurnRetryPort,
  cwd: string,
  retryOptions: { readonly acknowledgeFailedTurnId?: string } = {},
): Promise<void> {
  if (ctl.childSession) {
    await ctl.recoveryStore.load();
    if (!ctl.sessionState.disposed) {
      await ctl.effects.replaceRuntime({ kind: 'resume', ...ctl.childSession, child: true }, retryOptions);
    }
    return;
  }
  const catalogRequest = ctl.effects.beginCatalogLoad(cwd);
  ctl.emitSnapshot();
  const [, catalog] = await Promise.all([
    ctl.recoveryStore.load(),
    ctl.effects.loadCatalog(cwd),
  ]);
  if (ctl.sessionState.disposed) {
    return;
  }
  if (!ctl.effects.isCurrentCatalogRequest(catalogRequest, cwd)) {
    ctl.effects.discardCatalogRequest(catalogRequest);
    return;
  }
  ctl.catalogState.sessions = catalog;
  if (catalog.status === 'error') {
    ctl.sessionState.connection = { status: 'unavailable', message: CATALOG_ERROR_MESSAGE };
    ctl.emitSnapshot();
    return;
  }
  ctl.effects.seedBackgroundRunning(cwd);
  const selectedSessionId = ctl.sessionState.sessionId ?? ctl.recoveryStore.getSelectedSessionId();
  await ctl.effects.replaceRuntime(
    selectedSessionId !== null && ctl.effects.hasCatalogSession(selectedSessionId, cwd)
      ? {
          kind: 'resume',
          cwd,
          sessionId: selectedSessionId,
        }
      : { kind: 'new', cwd },
    retryOptions,
  );
}
