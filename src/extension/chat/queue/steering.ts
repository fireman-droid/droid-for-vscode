import type { QueuePort } from './queuePort';
import { appendAcceptedUserPrompt, attachUserMessageId } from '../../recovery/hostTranscriptState';
import { dropDispatchedPrompt, markDispatchBlocked } from './queuedPromptsState';
import { emitQueueState, maybeDispatchQueue } from './queue';

/** The local queue owns unsent text; the daemon alone confirms consumption. */
export function trySteerQueuedPrompt(ctl: QueuePort, queueId: string): boolean {
  const turn = ctl.turnState.turn;
  const runtime = ctl.sessionState.runtime;
  const sessionId = ctl.sessionState.sessionId;
  const prompt = ctl.queueState.queuedPrompts.items.find(item => item.queueId === queueId);
  if (!prompt || ctl.readBusyMessageMode() !== 'steer' || turn?.status !== 'streaming' || !runtime?.steerTurn || !sessionId ||
      ctl.queueState.queuedPrompts.paused || ctl.interactions.hasPending() || ctl.ideReconnectInProgress ||
      ctl.sessionState.sessionOperationInProgress || ctl.metadata.settingsUpdate !== null) return false;
  const generation = ctl.sessionState.runtimeGeneration;
  ctl.queueState.steering.add(queueId);
  emitQueueState(ctl);
  const current = () => !ctl.sessionState.disposed && ctl.sessionState.sessionId === sessionId &&
    ctl.sessionState.runtime === runtime && ctl.sessionState.runtimeGeneration === generation;
  void runtime.steerTurn(queueId, prompt.text, prompt.attachments.map(item => item.runtime)).then(() => {
    if (!current()) return;
    ctl.queueState.queuedPrompts = dropDispatchedPrompt(ctl.queueState.queuedPrompts, queueId);
    ctl.recoveryState.transcript = attachUserMessageId(appendAcceptedUserPrompt(ctl.recoveryState.transcript,
      queueId, prompt.text, prompt.attachments.map(item => item.summary), Date.now()), queueId, queueId);
    // Reuse the bounded attachment retention path without taking ownership of the active turn's attachments.
    const previous = ctl.attachmentState.pendingSentAttachments;
    ctl.attachmentState.pendingSentAttachments = { turnId: queueId, attachments: prompt.attachments };
    ctl.effects.retainSentAttachments(queueId, queueId);
    ctl.attachmentState.pendingSentAttachments = previous;
    ctl.effects.echoUserImageAttachments(sessionId, queueId, prompt.attachments.map(item => item.runtime));
    ctl.effects.scheduleRecoveryCheckpoint();
    ctl.recordHost({ level: 'info', name: 'host.queue.steered', attributes: { queueId } });
  }, (error: unknown) => {
    if (!current()) return;
    ctl.queueState.queuedPrompts = markDispatchBlocked(ctl.queueState.queuedPrompts);
    ctl.emitSessionDiagnostic('queue-steering-unconfirmed', error instanceof Error ? error.message : 'Steering delivery could not be confirmed. The message remains queued.');
  }).finally(() => {
    ctl.queueState.steering.delete(queueId);
    if (current()) { emitQueueState(ctl); ctl.emitSnapshot(); maybeDispatchQueue(ctl); }
  });
  return true;
}
