import type { QueuePort } from './queuePort';
import type { SessionQueueState } from '../../../shared/protocol/queueProtocol';
import {
  clearPrompts,
  dropDispatchedPrompt,
  enqueuePrompt,
  evaluateQueueDispatch,
  markDispatchBlocked,
  pauseAfterTerminal,
  promotePrompt,
  removePrompt,
  resumeQueue,
  updatePromptText,
} from './queuedPromptsState';
import { isTurnActive } from '../internals';

export const QUEUE_DISPATCH_BLOCKED_MESSAGE =
  'Droid is busy, so the queued messages are paused. Use "Send now" once it settles.';

/**
 * Queued-messages intake (queued-messages-design.md §4.2). The
 * webview enqueues optimistically, so every request — accepted or
 * not — is answered with an authoritative `queue.state` echo that
 * confirms or rewinds the optimistic card. Rejections are silent
 * beyond a debug log; the composer already prevents them locally.
 */
export function handleQueueAdd(
  ctl: QueuePort,
  sessionId: string,
  queueId: string,
  text: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  // The composer staging area rides along with the queued prompt;
  // consume it only when the enqueue is accepted.
  const result = enqueuePrompt(ctl.queueState.queuedPrompts, {
    queueId,
    text,
    attachments: ctl.attachmentState.pendingAttachments,
  });
  if (!result.accepted) {
    ctl.recordHost({
      level: 'debug',
      name: 'host.queue.rejected',
      attributes: { op: 'add', reason: result.reason },
    });
    // Re-sync the chips too: the optimistic add already moved the
    // staged attachments into the webview's queued card.
    ctl.effects.emitAttachments();
    emitQueueState(ctl);
    return;
  }
  if (ctl.attachmentState.pendingAttachments.length > 0) {
    ctl.attachmentState.pendingAttachments = [];
    ctl.effects.emitAttachments();
  }
  ctl.queueState.queuedPrompts = result.state;
  ctl.recordHost({
    level: 'info',
    name: 'host.queue.added',
    attributes: {
      textLength: text.length,
      depth: ctl.queueState.queuedPrompts.items.length,
    },
    detail: text,
  });
  emitQueueState(ctl);
  // The turn may have settled while the enqueue was in flight;
  // dispatch now instead of stranding the prompt until the next
  // terminal turn (design §4.3 race note).
  maybeDispatchQueue(ctl);
}

export function handleQueueUpdate(
  ctl: QueuePort,
  sessionId: string,
  queueId: string,
  text: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const result = updatePromptText(ctl.queueState.queuedPrompts, queueId, text);
  if (!result.updated) {
    // Most likely dispatched while the edit was in flight; the
    // echo below rewinds the optimistic webview edit.
    ctl.recordHost({
      level: 'debug',
      name: 'host.queue.rejected',
      attributes: { op: 'update' },
    });
  }
  ctl.queueState.queuedPrompts = result.state;
  emitQueueState(ctl);
}

export function handleQueueRemove(
  ctl: QueuePort,
  sessionId: string,
  queueId: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const result = removePrompt(ctl.queueState.queuedPrompts, queueId);
  if (!result.removed) {
    ctl.recordHost({
      level: 'debug',
      name: 'host.queue.rejected',
      attributes: { op: 'remove' },
    });
  }
  ctl.queueState.queuedPrompts = result.state;
  if (result.removed && ctl.queueState.queueSendNowIntent?.queueId === queueId) {
    ctl.queueState.queueSendNowIntent = null;
  }
  emitQueueState(ctl);
}

export function handleQueueResume(ctl: QueuePort, sessionId: string): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  ctl.queueState.queuedPrompts = resumeQueue(ctl.queueState.queuedPrompts);
  emitQueueState(ctl);
  maybeDispatchQueue(ctl);
}

/**
 * "Send now" on one queued prompt (design §4.8): move it to the
 * head and dispatch it immediately when idle. If a turn owns the
 * runtime slot, request its existing safe Stop path and wait for the
 * matching terminal state before dispatching. On a paused queue the
 * explicit send intent still doubles as a resume.
 */
export function handleQueuePromote(
  ctl: QueuePort,
  sessionId: string,
  queueId: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const result = promotePrompt(ctl.queueState.queuedPrompts, queueId);
  if (!result.promoted) {
    ctl.recordHost({
      level: 'debug',
      name: 'host.queue.rejected',
      attributes: { op: 'promote' },
    });
    emitQueueState(ctl);
    return;
  }
  ctl.queueState.queuedPrompts = resumeQueue(result.state);
  emitQueueState(ctl);
  const turn = ctl.turnState.turn;
  if (turn !== null && isTurnActive(turn)) {
    ctl.queueState.queueSendNowIntent = {
      sessionId,
      turnId: turn.turnId,
      queueId,
    };
    if (turn.status !== 'stopping') {
      ctl.effects.handleStop(sessionId, turn.turnId);
    }
    // Stop acceptance is synchronous (`stopping` is emitted before
    // the Runtime interrupt Promise begins). If a residual guard
    // rejects it, do not leave an intent that a later terminal event
    // could mistake for an accepted send-now request.
    if (
      ctl.turnState.turn?.turnId !== turn.turnId ||
      ctl.turnState.turn.status !== 'stopping'
    ) {
      ctl.queueState.queueSendNowIntent = null;
      pauseQueueAsBlocked(ctl);
    }
    return;
  }
  ctl.queueState.queueSendNowIntent = null;
  maybeDispatchQueue(ctl);
}

export function handleQueueClear(ctl: QueuePort, sessionId: string): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  if (ctl.queueState.queuedPrompts.items.length > 0) {
    ctl.recordHost({
      level: 'info',
      name: 'host.queue.cleared',
      attributes: { count: ctl.queueState.queuedPrompts.items.length },
    });
  }
  ctl.queueState.queueSendNowIntent = null;
  ctl.queueState.queuedPrompts = clearPrompts();
  emitQueueState(ctl);
}

/**
 * Runs the dispatch decision (queued-messages-design.md §4.3).
 * Triggered by a completed turn, an accepted enqueue, and an
 * explicit resume. `handleSend` keeps its own guards, so a veto
 * there downgrades the queue to the paused `dispatch-blocked`
 * state instead of silently losing the prompt.
 */
export function maybeDispatchQueue(ctl: QueuePort): void {
  if (ctl.ideReconnectInProgress) return;
  const decision = evaluateQueueDispatch(ctl.queueState.queuedPrompts, {
    turnActive: isTurnActive(ctl.turnState.turn),
    connected: ctl.sessionState.connection.status === 'connected',
    hasRuntime: ctl.sessionState.runtime !== null,
    hasSession: ctl.sessionState.sessionId !== null,
    hasPendingInteractions: ctl.interactions.hasPending(),
    sessionOperationInProgress: ctl.sessionState.sessionOperationInProgress,
    settingsUpdateInProgress: ctl.metadata.settingsUpdate !== null,
  });
  if (decision.kind === 'idle' || decision.kind === 'wait') {
    return;
  }
  if (decision.kind === 'blocked') {
    pauseQueueAsBlocked(ctl);
    return;
  }
  const sessionId = ctl.sessionState.sessionId;
  if (sessionId === null) {
    return;
  }
  const { prompt } = decision;
  // The generation only advances when handleSend accepts, so it
  // separates a real dispatch from a veto — matching turn ids
  // cannot (a stale completed turn may share the queued id).
  const generationBefore = ctl.turnState.turnGeneration;
  ctl.effects.handleSend(
    sessionId,
    prompt.queueId,
    prompt.text,
    'queued',
    prompt.attachments,
  );
  if (
    ctl.turnState.turnGeneration === generationBefore ||
    ctl.turnState.turn?.turnId !== prompt.queueId
  ) {
    // A residual handleSend guard (workspace drift, duplicate turn
    // id) vetoed the send; keep the prompt and pause so the queue
    // does not spin against a send path that keeps refusing.
    pauseQueueAsBlocked(ctl);
    return;
  }
  ctl.queueState.queuedPrompts = dropDispatchedPrompt(
    ctl.queueState.queuedPrompts,
    prompt.queueId,
  );
  ctl.recordHost({
    level: 'info',
    name: 'host.queue.dispatched',
    attributes: { remaining: ctl.queueState.queuedPrompts.items.length },
  });
  emitQueueState(ctl);
  ctl.emitSnapshot();
}

export function pauseQueueAsBlocked(ctl: QueuePort): void {
  if (ctl.queueState.queuedPrompts.paused === 'dispatch-blocked') {
    return;
  }
  ctl.queueState.queuedPrompts = markDispatchBlocked(ctl.queueState.queuedPrompts);
  ctl.emitSessionDiagnostic('queue-dispatch-blocked', QUEUE_DISPATCH_BLOCKED_MESSAGE);
  emitQueueState(ctl);
}

/**
 * Applies the queue policy at a terminal turn boundary
 * (queued-messages-design.md §4.3/§4.4): `completed` attempts a
 * dispatch on a microtask (off the turn.state emission stack) so
 * completion side effects land first; ordinary Stop and failure park
 * the queue. A row-level send-now Stop is the explicit exception: its
 * selected prompt dispatches after the matching interrupted terminal
 * state releases the Runtime slot.
 */
export function settleQueueAfterTurn(
  ctl: QueuePort,
  sessionId: string,
  turnId: string,
  status: 'completed' | 'interrupted' | 'failed',
): void {
  if (sessionId !== ctl.sessionState.sessionId) {
    return;
  }
  const sendNow = ctl.queueState.queueSendNowIntent;
  const sendNowSettled = sendNow?.sessionId === sessionId && sendNow.turnId === turnId;
  if (sendNowSettled) {
    ctl.queueState.queueSendNowIntent = null;
  }
  if (status === 'completed') {
    scheduleQueueDispatch(ctl);
    return;
  }
  if (
    status === 'interrupted' &&
    sendNowSettled &&
    ctl.queueState.queuedPrompts.items.some((item) => item.queueId === sendNow.queueId)
  ) {
    ctl.queueState.queuedPrompts = resumeQueue(ctl.queueState.queuedPrompts);
    scheduleQueueDispatch(ctl);
    return;
  }
  const paused = pauseAfterTerminal(ctl.queueState.queuedPrompts, status);
  if (paused !== ctl.queueState.queuedPrompts) {
    ctl.queueState.queuedPrompts = paused;
    emitQueueState(ctl);
  }
}

function scheduleQueueDispatch(ctl: QueuePort): void {
  queueMicrotask(() => {
    if (!ctl.sessionState.disposed) {
      maybeDispatchQueue(ctl);
    }
  });
}

/** Bounded queue projection shared by `queue.state` and snapshots. */
export function projectQueueState(ctl: QueuePort): SessionQueueState {
  return {
    items: ctl.queueState.queuedPrompts.items.map((item) => ({
      queueId: item.queueId,
      text: item.text,
      attachments: item.attachments.map(({ summary }) => ({
        kind: summary.kind,
        name: summary.name,
        sizeBytes: summary.sizeBytes,
      })),
    })),
    paused: ctl.queueState.queuedPrompts.paused,
  };
}

export function emitQueueState(ctl: QueuePort): void {
  if (ctl.sessionState.sessionId === null) {
    return;
  }
  const { items, paused } = projectQueueState(ctl);
  ctl.emit({
    type: 'queue.state',
    sessionId: ctl.sessionState.sessionId,
    items,
    paused,
  });
  // Every queue mutation funnels through here, so the recovery
  // checkpoint always mirrors the live queue: a reload restores the
  // texts (restoreQueuedPrompts) instead of silently dropping them.
  if (ctl.sessionState.conversationId === null) {
    return;
  }
  ctl.recoveryStore.writeConversationQueuedTexts(
    ctl.sessionState.conversationId,
    ctl.queueState.queuedPrompts.items.map((item) => item.text),
  );
}

export const QUEUE_RESTORED_CODE = 'queued-messages-restored';

/**
 * Restores queued prompt texts persisted before a reload into the
 * resumed session's queue. Restored prompts arrive paused (never
 * auto-dispatched into a changed world) and text-only: staged
 * attachment payloads live in host memory and do not survive a
 * reload, which the diagnostic spells out.
 */
export function restoreQueuedPrompts(ctl: QueuePort, sessionId: string): void {
  if (
    ctl.queueState.queuedPrompts.items.length > 0 ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  if (ctl.sessionState.conversationId === null) {
    return;
  }
  const texts = ctl.recoveryStore.readConversationQueuedTexts(
    ctl.sessionState.conversationId,
  );
  if (texts.length === 0) {
    return;
  }
  ctl.queueState.queuedPrompts = {
    items: texts.map((text, index) => ({
      queueId: `recovered-${String(ctl.sessionState.runtimeGeneration)}-${String(index)}`,
      text,
      attachments: [],
    })),
    paused: 'dispatch-blocked',
  };
  ctl.recordHost({
    level: 'info',
    name: 'host.queue.restored',
    attributes: { count: texts.length },
  });
  ctl.emit({
    type: 'runtime.diagnostic',
    sessionId,
    turnId: null,
    severity: 'info',
    code: QUEUE_RESTORED_CODE,
    message:
      texts.length === 1
        ? '1 queued message from before the reload was restored ' +
          '(text only). Use "Send now" to dispatch it.'
        : `${String(texts.length)} queued messages from before the ` +
          'reload were restored (text only). Use "Send now" to ' +
          'dispatch them.',
  });
  emitQueueState(ctl);
}

/**
 * Queue lifetime is bound to the session line
 * (queued-messages-design.md §4.5): any rebind — select, new
 * session, fork, compact, edit-resend adoption, workspace change —
 * discards the queued prompts with a visible info diagnostic.
 */
export function discardQueuedPrompts(ctl: QueuePort): void {
  const count = ctl.queueState.queuedPrompts.items.length;
  ctl.queueState.queueSendNowIntent = null;
  if (count === 0) {
    return;
  }
  ctl.queueState.queuedPrompts = clearPrompts();
  ctl.recordHost({
    level: 'info',
    name: 'host.queue.discarded',
    attributes: { count },
  });
  if (ctl.sessionState.sessionId !== null) {
    ctl.emit({
      type: 'runtime.diagnostic',
      sessionId: ctl.sessionState.sessionId,
      turnId: null,
      severity: 'info',
      code: 'queued-messages-discarded',
      message:
        count === 1
          ? '1 queued message was discarded because the session changed.'
          : `${count} queued messages were discarded because the session changed.`,
    });
    emitQueueState(ctl);
  }
}
