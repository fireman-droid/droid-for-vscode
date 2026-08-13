// queue: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
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
} from '../queuedPromptsState';
import type { SessionQueueState } from '../../shared/queueProtocol';
import { emitAttachments } from './attachments';
import { handleSend } from './turnFlow';
import { isTurnActive, type ChatControllerInternals } from './internals';

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
  ctl: ChatControllerInternals,
    sessionId: string,
    queueId: string,
    text: string,
  ): void {
    if (
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    // The composer staging area rides along with the queued prompt;
    // consume it only when the enqueue is accepted.
    const result = enqueuePrompt(ctl.queuedPrompts, {
      queueId,
      text,
      attachments: ctl.pendingAttachments,
    });
    if (!result.accepted) {
      ctl.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'add', reason: result.reason },
      });
      // Re-sync the chips too: the optimistic add already moved the
      // staged attachments into the webview's queued card.
      emitAttachments(ctl);
      emitQueueState(ctl);
      return;
    }
    if (ctl.pendingAttachments.length > 0) {
      ctl.pendingAttachments = [];
      emitAttachments(ctl);
    }
    ctl.queuedPrompts = result.state;
    ctl.recordHost({
      level: 'info',
      name: 'host.queue.added',
      attributes: {
        textLength: text.length,
        depth: ctl.queuedPrompts.items.length,
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
  ctl: ChatControllerInternals,
    sessionId: string,
    queueId: string,
    text: string,
  ): void {
    if (
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    const result = updatePromptText(ctl.queuedPrompts, queueId, text);
    if (!result.updated) {
      // Most likely dispatched while the edit was in flight; the
      // echo below rewinds the optimistic webview edit.
      ctl.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'update' },
      });
    }
    ctl.queuedPrompts = result.state;
    emitQueueState(ctl);
}

export function handleQueueRemove(
  ctl: ChatControllerInternals,
  sessionId: string, queueId: string): void {
    if (
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    const result = removePrompt(ctl.queuedPrompts, queueId);
    if (!result.removed) {
      ctl.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'remove' },
      });
    }
    ctl.queuedPrompts = result.state;
    emitQueueState(ctl);
}

export function handleQueueResume(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    if (
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    ctl.queuedPrompts = resumeQueue(ctl.queuedPrompts);
    emitQueueState(ctl);
    maybeDispatchQueue(ctl);
}

/**
 * "Send now" on one queued prompt (design §4.8): move it to the
 * head and dispatch as soon as the state machine allows. A running
 * turn is never interrupted — the promotion just decides what goes
 * next — and on a paused queue the explicit send intent doubles as
 * a resume.
 */
export function handleQueuePromote(
  ctl: ChatControllerInternals,
  sessionId: string, queueId: string): void {
    if (
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    const result = promotePrompt(ctl.queuedPrompts, queueId);
    if (!result.promoted) {
      ctl.recordHost({
        level: 'debug',
        name: 'host.queue.rejected',
        attributes: { op: 'promote' },
      });
      emitQueueState(ctl);
      return;
    }
    ctl.queuedPrompts = resumeQueue(result.state);
    emitQueueState(ctl);
    maybeDispatchQueue(ctl);
}

export function handleQueueClear(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    if (
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    if (ctl.queuedPrompts.items.length > 0) {
      ctl.recordHost({
        level: 'info',
        name: 'host.queue.cleared',
        attributes: { count: ctl.queuedPrompts.items.length },
      });
    }
    ctl.queuedPrompts = clearPrompts();
    emitQueueState(ctl);
}

/**
 * Runs the dispatch decision (queued-messages-design.md §4.3).
 * Triggered by a completed turn, an accepted enqueue, and an
 * explicit resume. `handleSend` keeps its own guards, so a veto
 * there downgrades the queue to the paused `dispatch-blocked`
 * state instead of silently losing the prompt.
 */
export function maybeDispatchQueue(ctl: ChatControllerInternals): void {
    const decision = evaluateQueueDispatch(ctl.queuedPrompts, {
      turnActive: isTurnActive(ctl.turn),
      connected: ctl.connection.status === 'connected',
      hasRuntime: ctl.runtime !== null,
      hasSession: ctl.sessionId !== null,
      hasPendingInteractions: ctl.interactions.hasPending(),
      sessionOperationInProgress: ctl.sessionOperationInProgress,
      settingsUpdateInProgress: ctl.settingsUpdate !== null,
    });
    if (decision.kind === 'idle' || decision.kind === 'wait') {
      return;
    }
    if (decision.kind === 'blocked') {
      pauseQueueAsBlocked(ctl);
      return;
    }
    const sessionId = ctl.sessionId;
    if (sessionId === null) {
      return;
    }
    const { prompt } = decision;
    // The generation only advances when handleSend accepts, so it
    // separates a real dispatch from a veto — matching turn ids
    // cannot (a stale completed turn may share the queued id).
    const generationBefore = ctl.turnGeneration;
    handleSend(ctl, 
      sessionId,
      prompt.queueId,
      prompt.text,
      'queued',
      prompt.attachments,
    );
    if (
      ctl.turnGeneration === generationBefore ||
      ctl.turn?.turnId !== prompt.queueId
    ) {
      // A residual handleSend guard (workspace drift, duplicate turn
      // id) vetoed the send; keep the prompt and pause so the queue
      // does not spin against a send path that keeps refusing.
      pauseQueueAsBlocked(ctl);
      return;
    }
    ctl.queuedPrompts = dropDispatchedPrompt(
      ctl.queuedPrompts,
      prompt.queueId,
    );
    ctl.recordHost({
      level: 'info',
      name: 'host.queue.dispatched',
      attributes: { remaining: ctl.queuedPrompts.items.length },
    });
    emitQueueState(ctl);
    ctl.emitSnapshot();
}

export function pauseQueueAsBlocked(ctl: ChatControllerInternals): void {
    if (ctl.queuedPrompts.paused === 'dispatch-blocked') {
      return;
    }
    ctl.queuedPrompts = markDispatchBlocked(ctl.queuedPrompts);
    ctl.emitSessionDiagnostic(
      'queue-dispatch-blocked',
      QUEUE_DISPATCH_BLOCKED_MESSAGE,
    );
    emitQueueState(ctl);
}

/**
 * Applies the queue policy at a terminal turn boundary
 * (queued-messages-design.md §4.3/§4.4): `completed` attempts a
 * dispatch on a microtask (off the turn.state emission stack) so
 * completion side effects land first; Stop and failure park the
 * queue in a paused state that only `queue.resume`, emptying the
 * queue, or a session change leaves.
 */
export function settleQueueAfterTurn(
  ctl: ChatControllerInternals,
    sessionId: string,
    status: 'completed' | 'interrupted' | 'failed',
  ): void {
    if (sessionId !== ctl.sessionId) {
      return;
    }
    if (status === 'completed') {
      queueMicrotask(() => {
        if (!ctl.disposed) {
          maybeDispatchQueue(ctl);
        }
      });
      return;
    }
    const paused = pauseAfterTerminal(ctl.queuedPrompts, status);
    if (paused !== ctl.queuedPrompts) {
      ctl.queuedPrompts = paused;
      emitQueueState(ctl);
    }
}

/** Bounded queue projection shared by `queue.state` and snapshots. */
export function projectQueueState(ctl: ChatControllerInternals): SessionQueueState {
    return {
      items: ctl.queuedPrompts.items.map((item) => ({
        queueId: item.queueId,
        text: item.text,
        attachments: item.attachments.map(({ summary }) => ({
          kind: summary.kind,
          name: summary.name,
          sizeBytes: summary.sizeBytes,
        })),
      })),
      paused: ctl.queuedPrompts.paused,
    };
}

export function emitQueueState(ctl: ChatControllerInternals): void {
    if (ctl.sessionId === null) {
      return;
    }
    const { items, paused } = projectQueueState(ctl);
    ctl.emit({
      type: 'queue.state',
      sessionId: ctl.sessionId,
      items,
      paused,
    });
    // Every queue mutation funnels through here, so the recovery
    // checkpoint always mirrors the live queue: a reload restores the
    // texts (restoreQueuedPrompts) instead of silently dropping them.
    ctl.recoveryStore.writeQueuedTexts(
      ctl.sessionId,
      ctl.queuedPrompts.items.map((item) => item.text),
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
export function restoreQueuedPrompts(
  ctl: ChatControllerInternals,
  sessionId: string,
): void {
    if (
      ctl.queuedPrompts.items.length > 0 ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    const texts = ctl.recoveryStore.readQueuedTexts(sessionId);
    if (texts.length === 0) {
      return;
    }
    ctl.queuedPrompts = {
      items: texts.map((text, index) => ({
        queueId: `recovered-${String(ctl.runtimeGeneration)}-${String(index)}`,
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
export function discardQueuedPrompts(ctl: ChatControllerInternals): void {
    const count = ctl.queuedPrompts.items.length;
    if (count === 0) {
      return;
    }
    ctl.queuedPrompts = clearPrompts();
    ctl.recordHost({
      level: 'info',
      name: 'host.queue.discarded',
      attributes: { count },
    });
    if (ctl.sessionId !== null) {
      ctl.emit({
        type: 'runtime.diagnostic',
        sessionId: ctl.sessionId,
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
