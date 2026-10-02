import type { DroidRuntime, RuntimeAttachment } from '../../../runtime/DroidRuntime';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { TurnStatus } from '../../../shared/protocol/turns';
import { appendAcceptedUserPrompt } from '../../recovery/hostTranscriptState';
import { sentAttachmentSummaries } from '../attachments/attachments';
import { captureSnapshotBeforeInBackground } from '../changes/snapshotCapture';
import type { PendingAttachment } from '../internals';
import { evaluateTurnStart } from '../operationEligibility';
import { recoverTransportTurn } from '../recovery/recoverTransportTurn';
import { createTurnActivityState } from './turnActivityState';
import type { TurnFlowPort } from './turnFlowPort';
import { isCurrentTurn } from './turnIdentity';
import { handleRuntimeEvent } from './turnRuntimeEvents';
import { emitTurnState, failTurn, handleTurnComplete } from './turnSettlement';
import { reportSendRejection } from './turnSendFeedback';

export function handleSend(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
  text: string,
  kind: 'send' | 'edit-resend' | 'queued' = 'send',
  attachmentsOverride?: readonly PendingAttachment[],
): void {
  const eligibility = evaluateTurnStart({
    requestedSessionId: sessionId,
    activeSessionId: ctl.sessionState.sessionId,
    runtime: ctl.sessionState.runtime,
    connectionStatus: ctl.sessionState.connection.status,
    isWorkspaceCurrent: () => ctl.effects.ensureActiveRuntimeWorkspaceCurrent(),
    text,
    turnId,
    turn: ctl.turnState.turn,
    sessionOperationInProgress: ctl.sessionState.sessionOperationInProgress,
    settingsUpdateInProgress: ctl.metadata.settingsUpdate !== null,
  });
  if (eligibility.kind !== 'eligible') {
    if (kind === 'send') reportSendRejection(ctl, sessionId, turnId, eligibility.reason);
    return;
  }
  const runtime = eligibility.runtime;

  const runtimeGeneration = ctl.sessionState.runtimeGeneration;
  const turnGeneration = ++ctl.turnState.turnGeneration;
  ctl.effects.discardPendingThinking();
  ctl.diagnostics?.beginTurnScope?.(turnId);
  ctl.turnState.turnIo = { counts: new Map(), bytes: 0 };
  ctl.recordHost({
    level: 'info',
    name: 'host.turn.accepted',
    attributes: {
      kind,
      textLength: text.length,
      sessionId,
    },
    detail: text,
  });
  ctl.turnState.turn = {
    turnId,
    status: 'submitting',
    activity: createTurnActivityState(),
  };
  const beforeSnapshot = captureSnapshotBeforeInBackground(ctl, sessionId, turnId);
  ctl.effects.armTurnWatchdog(sessionId, turnId);
  ctl.interactions.beginTurn(sessionId, turnId);
  // Edit-resend consumes the edit staging area passed in by the
  // caller; a plain send consumes the composer staging area.
  const consumed = attachmentsOverride ?? ctl.effects.takePendingAttachments();
  ctl.recoveryState.transcript = appendAcceptedUserPrompt(
    ctl.recoveryState.transcript,
    turnId,
    text,
    consumed === undefined ? undefined : sentAttachmentSummaries(consumed),
    Date.now(),
  );
  ctl.effects.scheduleRecoveryCheckpoint();
  ctl.effects.touchActiveSession();
  ctl.effects.recordRecentCommand(sessionId, text);
  emitTurnState(ctl, sessionId, turnId, 'submitting');
  const attachments =
    consumed === undefined || consumed.length === 0
      ? undefined
      : consumed.map(({ runtime: attachment }) => attachment);
  ctl.effects.echoUserImageAttachments(sessionId, turnId, attachments);
  ctl.attachmentState.pendingSentAttachments =
    consumed === undefined || consumed.length === 0
      ? null
      : { turnId, attachments: consumed };
  void consumeTurn(
    ctl,
    runtime,
    runtimeGeneration,
    turnGeneration,
    sessionId,
    turnId,
    text,
    attachments,
    beforeSnapshot,
  );
}

export async function consumeTurn(
  ctl: TurnFlowPort,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  turnId: string,
  text: string,
  attachments?: readonly RuntimeAttachment[],
  beforeSnapshot?: Promise<void>,
): Promise<void> {
  let terminalEventSeen = false;
  let completeEvent: Extract<RuntimeEvent, { type: 'turn-complete' }> | null = null;

  try {
    await beforeSnapshot;
    if (!isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)) return;
    if ((ctl.turnState.turn?.status as TurnStatus | undefined) === 'stopping') {
      handleTurnComplete(ctl, sessionId, turnId, { type: 'turn-complete', outcome: 'interrupted' });
      return;
    }
    ctl.effects.startLiveChanges(sessionId, turnId);
    for await (const event of runtime.sendTurn(text, attachments)) {
      if (
        !isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
      ) {
        return;
      }

      if (event.type === 'turn-complete') {
        ctl.effects.flushPendingThinking(sessionId, turnId);
        terminalEventSeen = true;
        // Settle only after leaving the loop: breaking closes the
        // runtime generator (releasing its active-turn slot), so a
        // queued prompt dispatched by the completion can start the
        // next turn instead of hitting "already has an active turn".
        completeEvent = event;
        break;
      }

      if (ctl.turnState.turn?.status === 'stopping') {
        continue;
      }

      if (
        event.type === 'tool-start' &&
        (await ctl.effects.capturePreToolBaseline(sessionId, turnId, event))
      ) {
        if (
          !isCurrentTurn(
            ctl,
            runtime,
            runtimeGeneration,
            turnGeneration,
            sessionId,
            turnId,
          )
        ) {
          return;
        }
        if ((ctl.turnState.turn?.status as TurnStatus | undefined) === 'stopping') {
          continue;
        }
      }
      handleRuntimeEvent(ctl, sessionId, turnId, event);
      if (event.type === 'turn-identity') {
        // The generator has not submitted yet. Persist the daemon id before it
        // can advance so an immediate Host restart can recover this exact turn.
        const saved = await ctl.effects.flushRecoveryCheckpointOrReport();
        if (!isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)) return;
        if (!saved) {
          failTurn(ctl, sessionId, turnId, 'recovery-checkpoint-failed');
          return;
        }
        if ((ctl.turnState.turn?.status as TurnStatus | undefined) === 'stopping') {
          terminalEventSeen = true;
          completeEvent = { type: 'turn-complete', outcome: 'interrupted' };
          break;
        }
      }
    }
  } catch (error) {
    if (
      isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
    ) {
      ctl.effects.flushPendingThinking(sessionId, turnId);
      completeEvent = null;
      terminalEventSeen = true;
      if (recoverTransportTurn(ctl, runtime, runtimeGeneration, sessionId, turnId, error)) return;
      if (ctl.turnState.turn?.status === 'stopping' && error instanceof Error && error.name === 'AbortError')
        completeEvent = { type: 'turn-complete', outcome: 'interrupted' };
      else failTurn(ctl, sessionId, turnId, 'runtime-stream-failed',
        error instanceof Error ? error.message : typeof error === 'string' ? error : undefined);
    }
  }

  if (
    completeEvent !== null &&
    isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
  ) {
    handleTurnComplete(ctl, sessionId, turnId, completeEvent);
    return;
  }

  if (
    !terminalEventSeen &&
    isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
  ) {
    if (ctl.turnState.turn?.status === 'stopping')
      handleTurnComplete(ctl, sessionId, turnId, { type: 'turn-complete', outcome: 'interrupted' });
    else failTurn(ctl, sessionId, turnId, 'runtime-stream-ended');
  }
}
