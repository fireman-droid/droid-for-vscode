import type { DroidRuntime, RuntimeAttachment } from '../../../runtime/DroidRuntime';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import { type TurnStatus } from '../../../shared/protocol/turns';
import {
  appendAcceptedUserPrompt,
  attachUserMessageId,
  projectHostTranscriptMessage,
  stableTranscriptId,
} from '../../recovery/hostTranscriptState';
import { sentAttachmentSummaries } from '../attachments/attachments';
import { captureSnapshotBeforeInBackground } from '../changes/snapshotCapture';
import {
  isSafeBridgeId,
  isTranscriptProjection,
  isTurnActive,
  isUsableWorkspace,
  type PendingAttachment,
} from '../internals';
import { evaluateTurnStart } from '../operationEligibility';
import {
  createTurnActivityState,
  projectAssistantDelta,
  projectSubagentStarted,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  thinkingSegmentKey,
} from './turnActivityState';
import type { TurnFlowPort } from './turnFlowPort';
import { CATALOG_ERROR_MESSAGE } from '../sessions/sessionCatalog';
import { STOP_TIMEOUT_MESSAGE } from './turnWatchdog';
import { reportSendRejection } from './turnSendFeedback';

export const TURN_FAILURE_MESSAGE =
  'Droid could not complete this turn. Retry to start a fresh session.';

export const RUNTIME_EVENT_ERROR_MESSAGE =
  'Droid reported a runtime error while processing this turn.';

export const ASSISTANT_OUTPUT_TRUNCATED_MESSAGE =
  'Assistant output exceeded the display limit and was truncated.';

export const SPEC_HANDOFF_DETECTED_MESSAGE =
  'Plan approved. Droid is implementing in a new session; the chat switches there when this turn finishes.';

export const SPEC_HANDOFF_NOT_DETECTED_MESSAGE =
  'Droid moved implementation to a new session, but it could not be identified automatically. Refresh History to open it.';

export const SPEC_HANDOFF_BLOCKED_MESSAGE =
  'The implementation session could not be opened automatically. Select it from History.';

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
    }
  } catch (error) {
    if (
      isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
    ) {
      ctl.effects.flushPendingThinking(sessionId, turnId);
      completeEvent = null;
      terminalEventSeen = true;
      if (ctl.turnState.turn?.status === 'stopping' && error instanceof Error && error.name === 'AbortError')
        completeEvent = { type: 'turn-complete', outcome: 'interrupted' };
      else failTurn(ctl, sessionId, turnId, 'runtime-stream-failed');
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

export function handleRuntimeEvent(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
  event: Exclude<RuntimeEvent, { type: 'turn-complete' }>,
): void {
  if (event.type !== 'thinking-delta') {
    ctl.effects.flushPendingThinking(sessionId, turnId);
  }
  if (ctl.effects.handleMissionRuntimeEvent(event)) return;
  switch (event.type) {
    case 'text-delta': {
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const result = projectAssistantDelta(turn.activity, event.text);
      turn.activity = result.state;
      if (result.projection === null) {
        return;
      }
      if (result.projection.delta.length > 0) {
        startStreaming(ctl, sessionId, turnId);
        ctl.emit({
          type: 'assistant.delta',
          sessionId,
          turnId,
          delta: result.projection.delta,
        });
      }
      if (result.projection.truncated) {
        ctl.emit({
          type: 'runtime.diagnostic',
          sessionId,
          turnId,
          severity: 'warning',
          code: 'assistant-output-truncated',
          message: ASSISTANT_OUTPUT_TRUNCATED_MESSAGE,
        });
      }
      return;
    }
    case 'thinking-delta': {
      startStreaming(ctl, sessionId, turnId);
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const result = projectThinkingDelta(
        turn.activity,
        event.text,
        thinkingSegmentKey(event),
      );
      turn.activity = result.state;
      if (result.projection !== null) {
        ctl.effects.queueThinkingProjection(sessionId, turnId, result.projection);
      }
      return;
    }
    case 'thinking-complete': {
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const projection = projectThinkingComplete(
        turn.activity,
        thinkingSegmentKey(event),
      );
      if (projection !== null) {
        ctl.emit({
          type: 'thinking.complete',
          sessionId,
          turnId,
          durationMs: event.durationMs,
          segmentIndex: projection.segmentIndex,
        });
      }
      return;
    }
    case 'tool-start':
    case 'tool-progress':
    case 'tool-result':
    case 'tool-execution-phase': {
      startStreaming(ctl, sessionId, turnId);
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      if (event.type !== 'tool-execution-phase') {
        ctl.effects.mirrorExecuteEvent(sessionId, event);
      }
      const result = projectToolEvent(turn.activity, event);
      turn.activity = result.state;
      if (result.projection !== null) {
        ctl.emit({
          type: 'tool.activity',
          sessionId,
          turnId,
          ...result.projection,
        });
      }
      if (event.type === 'tool-result') {
        ctl.effects.recordLiveToolChanges(sessionId, turnId, event.toolUseId);
        ctl.reviewCoordinator?.refreshOperationsTurn(sessionId, turnId);
      }
      // A finished Task dispatch hands off to a child session the
      // stream no longer narrates; sync its row with the subagent
      // ledger so the delegation shows as running mid-turn.
      if (event.type === 'tool-result' && result.projection?.subagent !== undefined) {
        ctl.effects.scheduleLiveSubagentSync(sessionId, turnId);
      }
      return;
    }
    case 'image-block': {
      startStreaming(ctl, sessionId, turnId);
      ctl.emit({
        type: 'transcript.image',
        sessionId,
        turnId,
        item: {
          id: stableTranscriptId(
            'image',
            turnId,
            event.sourceId,
            String(event.blockIndex),
          ),
          kind: 'image',
          turnId,
          origin: event.origin,
          mediaType: event.mediaType,
          data: event.data,
          generated: event.generated,
          byteLength: event.byteLength,
        },
      });
      return;
    }
    case 'user-message':
      ctl.recoveryState.transcript = attachUserMessageId(
        ctl.recoveryState.transcript,
        turnId,
        event.messageId,
      );
      ctl.effects.retainSentAttachments(turnId, event.messageId);
      ctl.effects.scheduleRecoveryCheckpoint();
      ctl.emit({
        type: 'user.message-meta',
        sessionId,
        turnId,
        messageId: event.messageId,
      });
      return;
    case 'subagent-started': {
      startStreaming(ctl, sessionId, turnId);
      const turn = ctl.turnState.turn;
      if (turn === null) {
        return;
      }
      const result = projectSubagentStarted(turn.activity, event);
      turn.activity = result.state;
      if (result.projection !== null) {
        ctl.emit({
          type: 'tool.activity',
          sessionId,
          turnId,
          ...result.projection,
        });
      }
      return;
    }
    case 'working-state': {
      const turn = ctl.turnState.turn;
      const compacting = event.compacting === true;
      const changed = turn !== null && (turn.compacting === true) !== compacting;
      if (turn !== null) turn.compacting = compacting;
      const submitting = turn?.status === 'submitting';
      if (event.isWorking) {
        startStreaming(ctl, sessionId, turnId);
      }
      if (changed && turn !== null && !(submitting && event.isWorking)) {
        emitTurnState(ctl, sessionId, turnId, turn.status);
      }
      return;
    }
    case 'token-usage':
      // Live cumulative totals are authoritative over any history
      // seed; the CLI pushes a few per turn.
      ctl.effects.updateTokenUsage(sessionId, {
        cumulative: event.cumulative,
      });
      return;
    case 'settings-updated':
      ctl.effects.refreshSettingsAfterRuntimeEvent(sessionId);
      return;
    case 'spec-handoff':
      if (
        isSafeBridgeId(event.implementationSessionId) &&
        event.implementationSessionId !== sessionId &&
        ctl.sessionState.sessionId === sessionId
      ) {
        ctl.turnState.specHandoff = {
          turnId,
          status: 'detected',
          implementationSessionId: event.implementationSessionId,
        };
        ctl.emit({
          type: 'runtime.diagnostic',
          sessionId,
          turnId,
          severity: 'info',
          code: 'spec-handoff-detected',
          message: SPEC_HANDOFF_DETECTED_MESSAGE,
        });
      }
      return;
    case 'error':
      ctl.emit({
        type: 'runtime.diagnostic',
        sessionId,
        turnId,
        severity: 'error',
        code: 'runtime-event-error',
        message: RUNTIME_EVENT_ERROR_MESSAGE,
      });
      return;
  }
}

export function handleTurnComplete(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
  event: Extract<RuntimeEvent, { type: 'turn-complete' }>,
): void {
  ctl.interactions.endTurn(sessionId, turnId);
  ctl.terminalMirror?.settleAll();
  if (event.turnUsage !== undefined) {
    // Per-turn consumption regardless of outcome; interrupted and
    // failed turns still burned tokens.
    ctl.effects.updateTokenUsage(sessionId, { lastTurn: event.turnUsage });
  }
  switch (event.outcome) {
    case 'success':
      ctl.effects.publishTurnChanges(sessionId, turnId, 'completed');
      setTurnStatus(ctl, sessionId, turnId, 'completed');
      ctl.effects.settleTurnSubagents(sessionId, turnId);
      refreshContextAfterTurn(ctl, sessionId);
      finishSpecHandoff(ctl, sessionId, turnId);
      return;
    case 'interrupted':
      ctl.effects.publishTurnChanges(sessionId, turnId, 'interrupted');
      setTurnStatus(ctl, sessionId, turnId, 'interrupted');
      ctl.effects.settleTurnSubagents(sessionId, turnId);
      refreshContextAfterTurn(ctl, sessionId);
      finishSpecHandoff(ctl, sessionId, turnId);
      return;
    case 'error_during_execution':
      ctl.turnState.specHandoff = null;
      failTurn(ctl, sessionId, turnId, 'runtime-execution-failed');
      return;
    case 'error_structured_output':
      ctl.turnState.specHandoff = null;
      failTurn(ctl, sessionId, turnId, 'runtime-structured-output-failed');
      return;
  }
}

/**
 * Ends the spec-handoff arc of a finished turn: adopts the detected
 * implementation session (same replacement path as selecting it from
 * History), or degrades to a visible warning when the handoff signal
 * never arrived or adoption is currently blocked.
 */
export function finishSpecHandoff(
  ctl: TurnFlowPort,
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
  ctl: TurnFlowPort,
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

export function handleStop(ctl: TurnFlowPort, sessionId: string, turnId: string): void {
  const runtime = ctl.sessionState.runtime;
  if (runtime !== null && !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  if (
    runtime === null ||
    sessionId !== ctl.sessionState.sessionId ||
    ctl.turnState.turn?.turnId !== turnId ||
    (ctl.turnState.turn.status !== 'submitting' &&
      ctl.turnState.turn.status !== 'streaming' &&
      ctl.turnState.turn.status !== 'stopping')
  ) {
    return;
  }

  const turnGeneration = ctl.turnState.turnGeneration;
  if (ctl.turnState.stopRequestGeneration === turnGeneration) return;
  ctl.turnState.stopRequestGeneration = turnGeneration;

  // A recovery turn runs daemon-side with no locally streaming turn;
  // interrupt() would no-op there, interruptSession() reaches the
  // daemon. The poll loop then observes idle and settles the turn.
  const interruptTurn =
    ctl.turnState.turn.recovery === true && typeof runtime.interruptSession === 'function'
      ? () => runtime.interruptSession!()
      : () => runtime.interrupt();
  ctl.effects.flushPendingThinking(sessionId, turnId);
  ctl.interactions.endTurn(sessionId, turnId);
  setTurnStatus(ctl, sessionId, turnId, 'stopping');
  ctl.effects.markStopRequested(sessionId, turnId); // stop-settle deadline (#32)
  const runtimeGeneration = ctl.sessionState.runtimeGeneration;
  void interruptTurn().catch(() => {
    if (
      isCurrentTurn(ctl, runtime, runtimeGeneration, turnGeneration, sessionId, turnId)
    ) {
      // Rejection does not establish that the backend stopped. Keep the
      // execution lock and watchdog until the stream releases ownership.
      ctl.emit({
        type: 'runtime.diagnostic', sessionId, turnId, severity: 'warning',
        code: 'turn-stop-unconfirmed', message: STOP_TIMEOUT_MESSAGE,
      });
    }
  }).finally(() => {
    if (ctl.turnState.stopRequestGeneration === turnGeneration) {
      ctl.turnState.stopRequestGeneration = null;
    }
  });
}

export function handleRetry(ctl: TurnFlowPort, sessionId: string | null): void {
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
  if (
    ctl.catalogState.sessions.status === 'idle' ||
    ctl.catalogState.sessions.status === 'error' ||
    ctl.catalogState.catalogCwd !== workspace.cwd
  ) {
    ctl.sessionState.sessionOperationInProgress = true;
    void retryAfterWorkspaceBecomesAvailable(ctl, workspace.cwd).finally(() => {
      ctl.sessionState.sessionOperationInProgress = false;
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
  );
}

export async function retryAfterWorkspaceBecomesAvailable(
  ctl: TurnFlowPort,
  cwd: string,
): Promise<void> {
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
  );
}

export function failTurn(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
  code: string,
): void {
  ctl.effects.flushPendingThinking(sessionId, turnId);
  if (ctl.turnState.turn?.turnId !== turnId) {
    return;
  }

  if (ctl.turnState.specHandoff?.turnId === turnId) {
    ctl.turnState.specHandoff = null;
  }
  ctl.interactions.endTurn(sessionId, turnId);
  ctl.terminalMirror?.settleAll();
  ctl.turnState.turn.changesLedger?.cancel();
  ctl.effects.publishTurnChanges(sessionId, turnId, 'failed');
  ctl.turnState.turn.status = 'failed';
  ctl.turnState.turn.compacting = false;
  ctl.turnState.turn.error = TURN_FAILURE_MESSAGE;
  ctl.emit({
    type: 'turn.error',
    sessionId,
    turnId,
    code,
    message: TURN_FAILURE_MESSAGE,
    retryable: true,
  });
  emitTurnState(ctl, sessionId, turnId, 'failed');
  refreshContextAfterTurn(ctl, sessionId);
}

export function setTurnStatus(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
  status: TurnStatus,
): void {
  if (ctl.turnState.turn?.turnId !== turnId) {
    return;
  }

  ctl.turnState.turn.status = status;
  if (!isTurnActive(ctl.turnState.turn)) ctl.turnState.turn.compacting = false;
  emitTurnState(ctl, sessionId, turnId, status);
}

export function startStreaming(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
): void {
  if (ctl.turnState.turn?.status === 'submitting') {
    setTurnStatus(ctl, sessionId, turnId, 'streaming');
  }
}

export function emitTurnState(
  ctl: TurnFlowPort,
  sessionId: string,
  turnId: string,
  status: TurnStatus,
): void {
  ctl.emit({
    type: 'turn.state',
    sessionId,
    turnId,
    status,
    ...(ctl.turnState.turn?.compacting === true ? { compacting: true } : {}),
  });
  ctl.recordHost({
    level: 'debug',
    name: 'host.turn.state',
    attributes: { status },
  });
  if (status === 'completed' || status === 'interrupted' || status === 'failed') {
    ctl.effects.clearTurnWatchdog();
    flushTurnIo(ctl);
    ctl.diagnostics?.endTurnScope?.();
    ctl.effects.settleQueueAfterTurn(sessionId, turnId, status);
    // Every terminal outcome clears the running indicator at once.
    ctl.effects.setSessionRunning(sessionId, false);
  } else {
    ctl.effects.setSessionRunning(sessionId, true);
  }
}

/** Emits the per-turn outbound Bridge message accounting (P5). */
export function flushTurnIo(ctl: TurnFlowPort): void {
  const io = ctl.turnState.turnIo;
  ctl.turnState.turnIo = null;
  if (io === null) {
    return;
  }
  const attributes: Record<string, number> = {
    bytesOut: io.bytes,
    messagesOut: [...io.counts.values()].reduce((sum, count) => sum + count, 0),
  };
  for (const [type, count] of io.counts) {
    attributes[`n_${type.replaceAll('.', '_')}`] = count;
  }
  ctl.recordHost({
    level: 'debug',
    name: 'host.perf.turn-io',
    attributes,
  });
}

export function projectTranscript(
  ctl: TurnFlowPort,
  message: HostToWebviewMessage,
): void {
  if (
    ctl.sessionState.sessionId === null ||
    !isTranscriptProjection(message) ||
    message.sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  ctl.recoveryState.transcript = projectHostTranscriptMessage(
    ctl.recoveryState.transcript,
    message,
  );
  ctl.effects.scheduleRecoveryCheckpoint();
}

export function isCurrentTurn(
  ctl: TurnFlowPort,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  turnId: string,
): boolean {
  if (
    ctl.effects.isCurrentRuntime(runtime, runtimeGeneration) &&
    ctl.turnState.turnGeneration === turnGeneration &&
    ctl.sessionState.sessionId === sessionId &&
    ctl.turnState.turn?.turnId === turnId &&
    isTurnActive(ctl.turnState.turn)
  ) {
    return ctl.effects.ensureActiveRuntimeWorkspaceCurrent();
  }
  return false;
}

export function refreshContextAfterTurn(ctl: TurnFlowPort, sessionId: string): void {
  if (
    ctl.sessionState.runtime !== null &&
    ctl.sessionState.activeRuntimeCwd !== null &&
    ctl.sessionState.sessionId === sessionId &&
    ctl.sessionState.connection.status === 'connected'
  ) {
    ctl.effects.refreshContext(
      ctl.sessionState.runtime,
      ctl.sessionState.runtimeGeneration,
      sessionId,
      ctl.sessionState.activeRuntimeCwd,
    );
  }
}

export { publishTurnChanges } from '../changes/publishTurnChanges';
export {
  COMPACT_BLOCKED_MESSAGE,
  COMPACT_FAILED_MESSAGE,
  COMPACT_UNSUPPORTED_MESSAGE,
  handleSessionCompact,
  performCompact,
} from './compact';
