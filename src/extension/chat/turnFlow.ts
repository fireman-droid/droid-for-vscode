// turnFlow: extracted ChatController turn behavior.
import type {
  HostToWebviewMessage,
  SessionMissionSummary,
  TurnStatus,
} from '../../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeAttachment,
} from '../../runtime/DroidRuntime';
import type { RuntimeEvent } from '../../runtime/runtimeEvents';
import {
  collectToolFilePaths,
  createTurnActivityState,
  projectAssistantDelta,
  projectSubagentStarted,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  thinkingSegmentKey,
} from '../turnActivityState';
import {
  appendAcceptedUserPrompt,
  appendTurnChanges,
  attachUserMessageId,
  projectHostTranscriptMessage,
  stableTranscriptId,
  type HostTranscriptState,
} from '../hostTranscriptState';
import type { TokenUsageBreakdown } from '../../shared/tokenUsage';
import {
  capturePreToolBaseline,
  recordLiveToolChanges,
} from './liveChanges';
import { scheduleLiveSubagentSync, settleTurnSubagents } from './subagentWatch';
import { settleQueueAfterTurn } from './queue';
import {
  clearPendingAttachments,
  echoUserImageAttachments,
  retainSentAttachments,
  sentAttachmentSummaries,
  takePendingAttachments,
} from './attachments';
import {
  recordRecentCommand,
  refreshContext,
  updateTokenUsage,
} from './capabilityPanels';
import { refreshSettingsAfterRuntimeEvent } from './settings';
import {
  activeSessionSummary,
  beginCatalogLoad,
  discardCatalogRequest,
  hasCatalogSession,
  isCurrentCatalogRequest,
  loadCatalog,
  touchActiveSession,
  withActiveSession,
} from './sessionDirectory';
import {
  seedBackgroundRunning,
  setSessionRunning,
} from './sessionRunning';
import {
  emitWorkspaceUnavailable,
  ensureActiveRuntimeWorkspaceCurrent,
  isCurrentRuntime,
  loadHistoryTimed,
  replaceRuntime,
  startReplacement,
} from './runtimeLifecycle';
import {
  flushRecoveryCheckpoint,
  scheduleRecoveryCheckpoint,
} from './recovery';
import {
  discardPendingThinking,
  flushPendingThinking,
  queueThinkingProjection,
} from './thinkingBatch';
import { mirrorExecuteEvent } from './terminalMirrorFlow';
import { handleMissionRuntimeEvent } from './mission/runtimeEvents';
import { armTurnWatchdog, clearTurnWatchdog, markStopRequested } from './turnWatchdog';
import {
  isSafeBridgeId,
  isTranscriptProjection,
  isTurnActive,
  isUsableWorkspace,
  type ChatControllerInternals,
  type PendingAttachment,
} from './internals';

export const TURN_FAILURE_MESSAGE =
  'Droid could not complete this turn. Retry to start a fresh session.';

export const RUNTIME_EVENT_ERROR_MESSAGE =
  'Droid reported a runtime error while processing this turn.';

export const ASSISTANT_OUTPUT_TRUNCATED_MESSAGE =
  'Assistant output exceeded the display limit and was truncated.';

export const COMPACT_BLOCKED_MESSAGE =
  'Droid cannot compact right now. Wait for the current activity to finish.';

export const COMPACT_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support context compaction.';

export const COMPACT_FAILED_MESSAGE =
  'Droid could not compact the conversation.';

export const SPEC_HANDOFF_DETECTED_MESSAGE =
  'Plan approved. Droid is implementing in a new session; the chat switches there when this turn finishes.';

export const SPEC_HANDOFF_NOT_DETECTED_MESSAGE =
  'Droid moved implementation to a new session, but it could not be identified automatically. Refresh History to open it.';

export const SPEC_HANDOFF_BLOCKED_MESSAGE =
  'The implementation session could not be opened automatically. Select it from History.';

export function handleSend(
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    text: string,
    kind: 'send' | 'edit-resend' | 'queued' = 'send',
    attachmentsOverride?: readonly PendingAttachment[],
  ): void {
    const runtime = ctl.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId ||
      text.trim().length === 0 ||
      ctl.turn?.turnId === turnId ||
      isTurnActive(ctl.turn) ||
      ctl.sessionOperationInProgress ||
      ctl.settingsUpdate !== null
    ) {
      return;
    }

    const runtimeGeneration = ctl.runtimeGeneration;
    const turnGeneration = ++ctl.turnGeneration;
    discardPendingThinking(ctl);
    ctl.diagnostics?.beginTurnScope?.(turnId);
    ctl.turnIo = { counts: new Map(), bytes: 0 };
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
    ctl.turn = {
      turnId,
      status: 'submitting',
      activity: createTurnActivityState(),
    };
    armTurnWatchdog(ctl, sessionId, turnId);
    ctl.interactions.beginTurn(sessionId, turnId);
    // Edit-resend consumes the edit staging area passed in by the
    // caller; a plain send consumes the composer staging area.
    const consumed =
      attachmentsOverride ?? takePendingAttachments(ctl);
    ctl.transcript = appendAcceptedUserPrompt(
      ctl.transcript,
      turnId,
      text,
      consumed === undefined
        ? undefined
        : sentAttachmentSummaries(consumed),
    );
    scheduleRecoveryCheckpoint(ctl);
    touchActiveSession(ctl);
    recordRecentCommand(ctl, sessionId, text);
    emitTurnState(ctl, sessionId, turnId, 'submitting');
    const attachments =
      consumed === undefined || consumed.length === 0
        ? undefined
        : consumed.map(({ runtime: attachment }) => attachment);
    echoUserImageAttachments(ctl, sessionId, turnId, attachments);
    ctl.pendingSentAttachments =
      consumed === undefined || consumed.length === 0
        ? null
        : { turnId, attachments: consumed };
    void consumeTurn(ctl, 
      runtime,
      runtimeGeneration,
      turnGeneration,
      sessionId,
      turnId,
      text,
      attachments,
    );
}

export async function consumeTurn(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    turnId: string,
    text: string,
    attachments?: readonly RuntimeAttachment[],
  ): Promise<void> {
    let terminalEventSeen = false;
    let completeEvent: Extract<
      RuntimeEvent,
      { type: 'turn-complete' }
    > | null = null;

    try {
      for await (const event of runtime.sendTurn(text, attachments)) {
        if (
          !isCurrentTurn(ctl, 
            runtime,
            runtimeGeneration,
            turnGeneration,
            sessionId,
            turnId,
          )
        ) {
          return;
        }

        if (event.type === 'turn-complete') {
          flushPendingThinking(ctl, sessionId, turnId);
          terminalEventSeen = true;
          // Settle only after leaving the loop: breaking closes the
          // runtime generator (releasing its active-turn slot), so a
          // queued prompt dispatched by the completion can start the
          // next turn instead of hitting "already has an active turn".
          completeEvent = event;
          break;
        }

        if (ctl.turn?.status === 'stopping') {
          continue;
        }

        if (
          event.type === 'tool-start' &&
          await capturePreToolBaseline(ctl, sessionId, turnId, event)
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
          if (
            (ctl.turn?.status as TurnStatus | undefined) === 'stopping'
          ) {
            continue;
          }
        }
        handleRuntimeEvent(ctl, sessionId, turnId, event);
      }
    } catch {
      if (
        isCurrentTurn(ctl, 
          runtime,
          runtimeGeneration,
          turnGeneration,
          sessionId,
          turnId,
        )
      ) {
        flushPendingThinking(ctl, sessionId, turnId);
        completeEvent = null;
        terminalEventSeen = true;
        failTurn(ctl, sessionId, turnId, 'runtime-stream-failed');
      }
    }

    if (
      completeEvent !== null &&
      isCurrentTurn(ctl, 
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        turnId,
      )
    ) {
      handleTurnComplete(ctl, sessionId, turnId, completeEvent);
      return;
    }

    if (
      !terminalEventSeen &&
      isCurrentTurn(ctl, 
        runtime,
        runtimeGeneration,
        turnGeneration,
        sessionId,
        turnId,
      )
    ) {
      failTurn(ctl, sessionId, turnId, 'runtime-stream-ended');
    }
}

export function handleRuntimeEvent(
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    event: Exclude<RuntimeEvent, { type: 'turn-complete' }>,
  ): void {
    if (event.type !== 'thinking-delta') {
      flushPendingThinking(ctl, sessionId, turnId);
    }
  if (handleMissionRuntimeEvent(ctl, event)) return;
    switch (event.type) {
      case 'text-delta': {
        const turn = ctl.turn;
        if (turn === null) {
          return;
        }
        const result = projectAssistantDelta(
          turn.activity,
          event.text,
        );
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
        const turn = ctl.turn;
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
          queueThinkingProjection(
            ctl,
            sessionId,
            turnId,
            result.projection,
          );
        }
        return;
      }
      case 'thinking-complete': {
        const turn = ctl.turn;
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
      case 'tool-result': {
        startStreaming(ctl, sessionId, turnId);
        const turn = ctl.turn;
        if (turn === null) {
          return;
        }
        mirrorExecuteEvent(ctl, sessionId, event);
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
        if (event.type === 'tool-result' && !event.isError) {
          recordLiveToolChanges(ctl, sessionId, turnId, event.toolUseId);
        }
        // A finished Task dispatch hands off to a child session the
        // stream no longer narrates; sync its row with the subagent
        // ledger so the delegation shows as running mid-turn.
        if (
          event.type === 'tool-result' &&
          result.projection?.subagent !== undefined
        ) {
          scheduleLiveSubagentSync(ctl, sessionId, turnId);
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
        ctl.transcript = attachUserMessageId(
          ctl.transcript,
          turnId,
          event.messageId,
        );
        retainSentAttachments(ctl, turnId, event.messageId);
        scheduleRecoveryCheckpoint(ctl);
        ctl.emit({
          type: 'user.message-meta',
          sessionId,
          turnId,
          messageId: event.messageId,
        });
        return;
      case 'subagent-started': {
        startStreaming(ctl, sessionId, turnId);
        const turn = ctl.turn;
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
      case 'working-state':
        if (event.isWorking) {
          startStreaming(ctl, sessionId, turnId);
        }
        return;
      case 'token-usage':
        // Live cumulative totals are authoritative over any history
        // seed; the CLI pushes a few per turn.
        updateTokenUsage(ctl, sessionId, {
          cumulative: event.cumulative,
        });
        return;
      case 'settings-updated':
        refreshSettingsAfterRuntimeEvent(ctl, sessionId);
        return;
      case 'spec-handoff':
        if (
          isSafeBridgeId(event.implementationSessionId) &&
          event.implementationSessionId !== sessionId &&
          ctl.sessionId === sessionId
        ) {
          ctl.specHandoff = {
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
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    event: Extract<RuntimeEvent, { type: 'turn-complete' }>,
  ): void {
    ctl.interactions.endTurn(sessionId, turnId);
    ctl.terminalMirror?.settleAll();
    if (event.turnUsage !== undefined) {
      // Per-turn consumption regardless of outcome; interrupted and
      // failed turns still burned tokens.
      updateTokenUsage(ctl, sessionId, { lastTurn: event.turnUsage });
    }
    switch (event.outcome) {
      case 'success':
        publishTurnChanges(ctl, sessionId, turnId);
        setTurnStatus(ctl, sessionId, turnId, 'completed');
        void flushRecoveryCheckpoint(ctl);
        settleTurnSubagents(ctl, sessionId, turnId);
        refreshContextAfterTurn(ctl, sessionId);
        finishSpecHandoff(ctl, sessionId, turnId);
        return;
      case 'interrupted':
        publishTurnChanges(ctl, sessionId, turnId);
        setTurnStatus(ctl, sessionId, turnId, 'interrupted');
        void flushRecoveryCheckpoint(ctl);
        settleTurnSubagents(ctl, sessionId, turnId);
        refreshContextAfterTurn(ctl, sessionId);
        finishSpecHandoff(ctl, sessionId, turnId);
        return;
      case 'error_during_execution':
        ctl.specHandoff = null;
        failTurn(ctl, sessionId, turnId, 'runtime-execution-failed');
        return;
      case 'error_structured_output':
        ctl.specHandoff = null;
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
  ctl: ChatControllerInternals,
  sessionId: string, turnId: string): void {
    const handoff = ctl.specHandoff;
    if (handoff === null || handoff.turnId !== turnId) {
      return;
    }
    ctl.specHandoff = null;
    const cwd = ctl.activeRuntimeCwd;
    if (ctl.sessionId !== sessionId || cwd === null) {
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
      isTurnActive(ctl.turn) ||
      ctl.interactions.hasPending() ||
      ctl.connection.status === 'connecting' ||
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress ||
      ctl.settingsUpdate !== null
    ) {
      ctl.emitSessionDiagnostic(
        'spec-handoff-blocked',
        SPEC_HANDOFF_BLOCKED_MESSAGE,
      );
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
    startReplacement(ctl, {
      kind: 'resume',
      cwd,
      sessionId: handoff.implementationSessionId,
    });
}

/**
 * Publishes the settled changed-files ledger for a finished turn:
 * one whole-turn stats read over every tool-named path closes the
 * live ledger stream. Captured before-turn files are authoritative;
 * git HEAD is the fallback for paths without a live baseline. The
 * settlement is dropped when the session changes before stats arrive.
 */
export function publishTurnChanges(
  ctl: ChatControllerInternals,
  sessionId: string, turnId: string): void {
    if (
      ctl.sessionId !== sessionId ||
      ctl.turn?.turnId !== turnId
    ) {
      return;
    }
    // From here the reconciliation owns the stream: pending debounce
    // reads must not publish a stale `writing` frame after `settled`.
    ctl.turn.changesLedger?.cancel();
    const paths = collectToolFilePaths(ctl.turn.activity);
    if (paths.length === 0) {
      return;
    }
    const runtimeGeneration = ctl.runtimeGeneration;
    void ctl.changeStats.read(paths, { sessionId, turnId }).then((stats) => {
      if (
        ctl.disposed ||
        ctl.sessionId !== sessionId ||
        ctl.runtimeGeneration !== runtimeGeneration
      ) {
        return;
      }
      const files = paths.map((path) => {
        const stat = stats.get(path);
        return {
          path,
          additions: stat?.additions ?? null,
          deletions: stat?.deletions ?? null,
        };
      });
      const next = appendTurnChanges(ctl.transcript, turnId, files);
      if (next === ctl.transcript) {
        return;
      }
      ctl.transcript = next;
      scheduleRecoveryCheckpoint(ctl);
      ctl.emit({
        type: 'changes.update',
        sessionId,
        turnId,
        state: 'settled',
        files,
      });
    });
}

export function handleStop(
  ctl: ChatControllerInternals,
  sessionId: string, turnId: string): void {
    const runtime = ctl.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (
      runtime === null ||
      sessionId !== ctl.sessionId ||
      ctl.turn?.turnId !== turnId ||
      (ctl.turn.status !== 'submitting' &&
        ctl.turn.status !== 'streaming')
    ) {
      return;
    }

    // A recovery turn runs daemon-side with no locally streaming turn;
    // interrupt() would no-op there, interruptSession() reaches the
    // daemon. The poll loop then observes idle and settles the turn.
    const interruptTurn =
      ctl.turn.recovery === true &&
      typeof runtime.interruptSession === 'function'
        ? () => runtime.interruptSession!()
        : () => runtime.interrupt();
    flushPendingThinking(ctl, sessionId, turnId);
    ctl.interactions.endTurn(sessionId, turnId);
    setTurnStatus(ctl, sessionId, turnId, 'stopping');
    markStopRequested(ctl, sessionId, turnId); // stop-settle deadline (#32)
    const runtimeGeneration = ctl.runtimeGeneration;
    const turnGeneration = ctl.turnGeneration;
    void interruptTurn().catch(() => {
      if (
        isCurrentTurn(ctl, 
          runtime,
          runtimeGeneration,
          turnGeneration,
          sessionId,
          turnId,
        )
      ) {
        failTurn(ctl, sessionId, turnId, 'runtime-interrupt-failed');
      }
    });
}

export function handleRetry(
  ctl: ChatControllerInternals,
  sessionId: string | null): void {
    if (
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress ||
      sessionId !== ctl.sessionId ||
      (ctl.connection.status !== 'unavailable' &&
        ctl.turn?.status !== 'failed')
    ) {
      return;
    }

    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      emitWorkspaceUnavailable(ctl, workspace);
      return;
    }
    if (
      ctl.sessions.status === 'idle' ||
      ctl.catalogCwd !== workspace.cwd
    ) {
      ctl.sessionOperationInProgress = true;
      void retryAfterWorkspaceBecomesAvailable(ctl, 
        workspace.cwd,
      ).finally(() => {
        ctl.sessionOperationInProgress = false;
      });
      return;
    }
    const resumableId =
      ctl.sessionId !== null &&
      hasCatalogSession(ctl, ctl.sessionId, workspace.cwd)
        ? ctl.sessionId
        : null;
    startReplacement(ctl, 
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
  ctl: ChatControllerInternals,
    cwd: string,
  ): Promise<void> {
    const catalogRequest = beginCatalogLoad(ctl, cwd);
    ctl.emitSnapshot();
    const [, catalog] = await Promise.all([
      ctl.recoveryStore.load(),
      loadCatalog(ctl, cwd),
    ]);
    if (ctl.disposed) {
      return;
    }
    if (!isCurrentCatalogRequest(ctl, catalogRequest, cwd)) {
      discardCatalogRequest(ctl, catalogRequest);
      return;
    }
    ctl.sessions = catalog;
    seedBackgroundRunning(ctl, cwd);
    const selectedSessionId =
      ctl.recoveryStore.getSelectedSessionId();
    await replaceRuntime(ctl, 
      selectedSessionId !== null &&
        hasCatalogSession(ctl, selectedSessionId, cwd)
        ? {
            kind: 'resume',
            cwd,
            sessionId: selectedSessionId,
          }
        : { kind: 'new', cwd },
    );
}

export function handleSessionCompact(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    if (
      isTurnActive(ctl.turn) ||
      ctl.interactions.hasPending() ||
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress ||
      ctl.settingsUpdate !== null
    ) {
      ctl.emitSessionDiagnostic(
        'session-compact-blocked',
        COMPACT_BLOCKED_MESSAGE,
      );
      return;
    }
    if (typeof runtime.compact !== 'function') {
      ctl.emitSessionDiagnostic(
        'session-compact-unsupported',
        COMPACT_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    ctl.sessionOperationInProgress = true;
    void performCompact(ctl, runtime, sessionId).finally(() => {
      ctl.sessionOperationInProgress = false;
    });
}

/**
 * Compacts the active session and adopts the continuation session
 * that Droid returns, reloading its summarized transcript.
 */
export async function performCompact(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    sessionId: string,
  ): Promise<void> {
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }

    let compactedSessionId: string;
    let removedCount: number;
    try {
      const result = await runtime.compact!();
      compactedSessionId = result.sessionId;
      removedCount = result.removedCount;
    } catch {
      if (
        ctl.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        )
      ) {
        ctl.emitSessionDiagnostic(
          'session-compact-failed',
          COMPACT_FAILED_MESSAGE,
        );
      }
      return;
    }
    if (
      !ctl.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    ) {
      return;
    }
    if (!isSafeBridgeId(compactedSessionId)) {
      ctl.emitSessionDiagnostic(
        'session-compact-failed',
        COMPACT_FAILED_MESSAGE,
      );
      return;
    }

    const previousTitle =
      activeSessionSummary(ctl)?.title ?? 'Current session';
    // The compacted session stays in the catalog: its file remains on
    // disk with the full pre-compaction history, and the compaction
    // divider's "View full history" jump needs it selectable.
    ctl.sessionId = compactedSessionId;
    ctl.turn = null;
    clearPendingAttachments(ctl);
    ctl.sessions = withActiveSession(ctl, ctl.sessions, {
      id: compactedSessionId,
      title: previousTitle,
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    });

    let transcript: HostTranscriptState | null = null;
    let mission: SessionMissionSummary | null = null;
    let tokenUsage: TokenUsageBreakdown | null = null;
    {
      const loaded = await loadHistoryTimed(ctl, 
        cwd,
        compactedSessionId,
      );
      if (loaded?.status === 'available') {
        transcript = loaded.state;
        mission = loaded.mission ?? null;
        tokenUsage = loaded.tokenUsage ?? null;
      }
    }
    if (
      !ctl.isCurrentSessionOperation(
        runtime,
        generation,
        compactedSessionId,
        cwd,
      )
    ) {
      return;
    }
    ctl.mission = mission;
    // The compacted successor is a new session; its counters restart.
    ctl.tokenUsage = { cumulative: tokenUsage, lastTurn: null };
    // If the summarized history cannot be read, keep the previous
    // transcript visible; the runtime context is compacted either way.
    ctl.transcript =
      transcript ?? { ...ctl.transcript, historyStatus: 'partial' };
    ctl.recoveryStore.writeSession(compactedSessionId, ctl.transcript);
    ctl.recoveryStore.selectSession(compactedSessionId);
    void ctl.recoveryStore.flush();
    ctl.emitSnapshot();
    ctl.emit({
      type: 'runtime.diagnostic',
      sessionId: compactedSessionId,
      turnId: null,
      severity: 'info',
      code: 'session-compacted',
      message:
        removedCount > 0
          ? `Conversation compacted: ${removedCount} earlier messages summarized.`
          : 'Conversation compacted.',
      // The pre-compaction session backs the divider's
      // "View full history" jump.
      relatedSessionId: sessionId,
    });
    refreshContextAfterTurn(ctl, compactedSessionId);
}

export function failTurn(
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    code: string,
  ): void {
    flushPendingThinking(ctl, sessionId, turnId);
    if (ctl.turn?.turnId !== turnId) {
      return;
    }

    if (ctl.specHandoff?.turnId === turnId) {
      ctl.specHandoff = null;
    }
    ctl.interactions.endTurn(sessionId, turnId);
    ctl.terminalMirror?.settleAll();
    // No settled reconciliation follows a failed turn; the webview
    // flips the ledger header on the terminal turn state instead.
    ctl.turn.changesLedger?.cancel();
    ctl.turn.status = 'failed';
    ctl.turn.error = TURN_FAILURE_MESSAGE;
    ctl.emit({
      type: 'turn.error',
      sessionId,
      turnId,
      code,
      message: TURN_FAILURE_MESSAGE,
      retryable: true,
    });
    emitTurnState(ctl, sessionId, turnId, 'failed');
    void flushRecoveryCheckpoint(ctl);
    refreshContextAfterTurn(ctl, sessionId);
}

export function setTurnStatus(
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    status: TurnStatus,
  ): void {
    if (ctl.turn?.turnId !== turnId) {
      return;
    }

    ctl.turn.status = status;
    emitTurnState(ctl, sessionId, turnId, status);
}

export function startStreaming(
  ctl: ChatControllerInternals,
  sessionId: string, turnId: string): void {
    if (ctl.turn?.status === 'submitting') {
      setTurnStatus(ctl, sessionId, turnId, 'streaming');
    }
}

export function emitTurnState(
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    status: TurnStatus,
  ): void {
    ctl.emit({
      type: 'turn.state',
      sessionId,
      turnId,
      status,
    });
    ctl.recordHost({
      level: 'debug',
      name: 'host.turn.state',
      attributes: { status },
    });
    if (
      status === 'completed' ||
      status === 'interrupted' ||
      status === 'failed'
    ) {
      clearTurnWatchdog(ctl);
      flushTurnIo(ctl);
      ctl.diagnostics?.endTurnScope?.();
      settleQueueAfterTurn(ctl, sessionId, turnId, status);
      // Every terminal outcome clears the running indicator at once.
      setSessionRunning(ctl, sessionId, false);
    } else {
      setSessionRunning(ctl, sessionId, true);
    }
}

/** Emits the per-turn outbound Bridge message accounting (P5). */
export function flushTurnIo(ctl: ChatControllerInternals): void {
    const io = ctl.turnIo;
    ctl.turnIo = null;
    if (io === null) {
      return;
    }
    const attributes: Record<string, number> = {
      bytesOut: io.bytes,
      messagesOut: [...io.counts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
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
  ctl: ChatControllerInternals,
  message: HostToWebviewMessage): void {
    if (
      ctl.sessionId === null ||
      !isTranscriptProjection(message) ||
      message.sessionId !== ctl.sessionId
    ) {
      return;
    }
    ctl.transcript = projectHostTranscriptMessage(
      ctl.transcript,
      message,
    );
    scheduleRecoveryCheckpoint(ctl);
}

export function isCurrentTurn(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    runtimeGeneration: number,
    turnGeneration: number,
    sessionId: string,
    turnId: string,
  ): boolean {
    if (
      isCurrentRuntime(ctl, runtime, runtimeGeneration) &&
      ctl.turnGeneration === turnGeneration &&
      ctl.sessionId === sessionId &&
      ctl.turn?.turnId === turnId &&
      isTurnActive(ctl.turn)
    ) {
      return ensureActiveRuntimeWorkspaceCurrent(ctl);
    }
    return false;
}

export function refreshContextAfterTurn(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    if (
      ctl.runtime !== null &&
      ctl.activeRuntimeCwd !== null &&
      ctl.sessionId === sessionId &&
      ctl.connection.status === 'connected'
    ) {
      refreshContext(ctl, 
        ctl.runtime,
        ctl.runtimeGeneration,
        sessionId,
        ctl.activeRuntimeCwd,
      );
    }
}
