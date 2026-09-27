import { isSafeBridgeId, isTurnActive } from '../internals';
import type { SpecHandoffPort, SpecHandoffSignalPort } from './turnFlowPort';

export const SPEC_HANDOFF_DETECTED_MESSAGE =
  'Plan approved. Droid is implementing in a new session; the chat switches there when this turn finishes.';

export const SPEC_HANDOFF_NOT_DETECTED_MESSAGE =
  'Droid moved implementation to a new session, but it could not be identified automatically. Refresh History to open it.';

export const SPEC_HANDOFF_BLOCKED_MESSAGE =
  'The implementation session could not be opened automatically. Select it from History.';

export function recordSpecHandoff(ctl: SpecHandoffSignalPort, sessionId: string, turnId: string, implementationSessionId: string): void {
  if (isSafeBridgeId(implementationSessionId) && implementationSessionId !== sessionId && ctl.sessionState.sessionId === sessionId) {
    ctl.turnState.specHandoff = { turnId, status: 'detected', implementationSessionId };
    ctl.emit({ type: 'runtime.diagnostic', sessionId, turnId, severity: 'info',
      code: 'spec-handoff-detected', message: SPEC_HANDOFF_DETECTED_MESSAGE });
  }
}

/**
 * Ends the spec-handoff arc of a finished turn: adopts the detected
 * implementation session (same replacement path as selecting it from
 * History), or degrades to a visible warning when the handoff signal
 * never arrived or adoption is currently blocked.
 */
export function finishSpecHandoff(
  ctl: SpecHandoffPort,
  sessionId: string,
  turnId: string,
): void {
  const handoff = ctl.turnState.specHandoff;
  if (handoff === null || handoff.turnId !== turnId) {
    return;
  }
  ctl.turnState.specHandoff = null;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (ctl.sessionState.sessionId !== sessionId || cwd === null) {
    return;
  }
  if (handoff.status !== 'detected') {
    ctl.emitSessionDiagnostic(
      'spec-handoff-not-detected',
      SPEC_HANDOFF_NOT_DETECTED_MESSAGE,
    );
    return;
  }
  if (
    isTurnActive(ctl.turnState.turn) ||
    ctl.interactions.hasPending() ||
    ctl.sessionState.connection.status === 'connecting' ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.catalogState.refreshInProgress ||
    ctl.metadata.settingsUpdate !== null
  ) {
    ctl.emitSessionDiagnostic('spec-handoff-blocked', SPEC_HANDOFF_BLOCKED_MESSAGE);
    return;
  }
  ctl.recordHost({
    level: 'info',
    name: 'host.spec.handoff-adopted',
    attributes: {
      planningSessionId: sessionId,
      implementationSessionId: handoff.implementationSessionId,
    },
  });
  const conversationId = ctl.sessionState.conversationId;
  if (conversationId === null) {
    ctl.emitSessionDiagnostic('spec-handoff-blocked', SPEC_HANDOFF_BLOCKED_MESSAGE);
    return;
  }
  ctl.sessionState.sessionOperationInProgress = true;
  void adoptSpecHandoff(
    ctl,
    conversationId,
    sessionId,
    handoff.implementationSessionId,
  ).then((adopted) => {
    ctl.sessionState.sessionOperationInProgress = false;
    if (adopted) {
      ctl.effects.startReplacement({
        kind: 'resume',
        cwd,
        sessionId: handoff.implementationSessionId,
      });
    }
  });
}

async function adoptSpecHandoff(
  ctl: SpecHandoffPort,
  conversationId: string,
  planningSessionId: string,
  implementationSessionId: string,
): Promise<boolean> {
  if (!(await ctl.effects.flushRecoveryCheckpointOrReport())) {
    return false;
  }
  if (
    !(await ctl.effects.adoptDurableSuccessor(
      conversationId,
      planningSessionId,
      implementationSessionId,
      'handoff',
    ))
  ) {
    ctl.emitSessionDiagnostic('spec-handoff-blocked', SPEC_HANDOFF_BLOCKED_MESSAGE);
    return false;
  }
  return true;
}
