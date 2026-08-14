import { MAX_THINKING_DELTA_LENGTH } from '../../shared/bridgeMessages';
import type { ThinkingDeltaProjection } from '../turnActivityState';
import type { ChatControllerInternals } from './internals';

/**
 * SDKs can publish one Thinking fragment per token. Batch briefly,
 * but force-flush before every non-Thinking event so transcript
 * chronology remains exact.
 */
export const THINKING_BATCH_WINDOW_MS = 200;

interface PendingThinkingBatch {
  readonly runtimeGeneration: number;
  readonly turnGeneration: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly segmentIndex: number;
  delta: string;
  truncated: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const pendingThinkingBatches = new WeakMap<
  ChatControllerInternals,
  PendingThinkingBatch
>();

export function queueThinkingProjection(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  projection: ThinkingDeltaProjection,
): void {
  let pending = pendingThinkingBatches.get(ctl);
  if (
    pending !== undefined &&
    (pending.runtimeGeneration !== ctl.runtimeGeneration ||
      pending.turnGeneration !== ctl.turnGeneration ||
      pending.sessionId !== sessionId ||
      pending.turnId !== turnId ||
      pending.segmentIndex !== projection.segmentIndex)
  ) {
    flushPendingThinking(ctl, sessionId, turnId);
    pending = undefined;
  }

  let remaining = projection.delta;
  while (remaining.length > 0) {
    pending ??= createPendingThinkingBatch(
      ctl,
      sessionId,
      turnId,
      projection.segmentIndex,
    );
    const available =
      MAX_THINKING_DELTA_LENGTH - pending.delta.length;
    pending.delta += remaining.slice(0, available);
    remaining = remaining.slice(available);
    if (pending.delta.length >= MAX_THINKING_DELTA_LENGTH) {
      flushPendingThinking(ctl, sessionId, turnId);
      pending = undefined;
    }
  }

  if (projection.truncated) {
    pending ??= createPendingThinkingBatch(
      ctl,
      sessionId,
      turnId,
      projection.segmentIndex,
    );
    pending.truncated = true;
    flushPendingThinking(ctl, sessionId, turnId);
    return;
  }

  pending = pendingThinkingBatches.get(ctl);
  if (pending !== undefined && pending.timer === null) {
    pending.timer = setTimeout(() => {
      pending!.timer = null;
      flushPendingThinking(ctl, sessionId, turnId);
    }, THINKING_BATCH_WINDOW_MS);
  }
}

function createPendingThinkingBatch(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  segmentIndex: number,
): PendingThinkingBatch {
  const pending: PendingThinkingBatch = {
    runtimeGeneration: ctl.runtimeGeneration,
    turnGeneration: ctl.turnGeneration,
    sessionId,
    turnId,
    segmentIndex,
    delta: '',
    truncated: false,
    timer: null,
  };
  pendingThinkingBatches.set(ctl, pending);
  return pending;
}

export function flushPendingThinking(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
): void {
  const pending = pendingThinkingBatches.get(ctl);
  if (pending === undefined) {
    return;
  }
  pendingThinkingBatches.delete(ctl);
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  if (
    ctl.disposed ||
    pending.sessionId !== sessionId ||
    pending.turnId !== turnId ||
    ctl.sessionId !== pending.sessionId ||
    ctl.turn?.turnId !== pending.turnId ||
    ctl.runtimeGeneration !== pending.runtimeGeneration ||
    ctl.turnGeneration !== pending.turnGeneration ||
    (pending.delta.length === 0 && !pending.truncated)
  ) {
    return;
  }
  ctl.emit({
    type: 'thinking.delta',
    sessionId: pending.sessionId,
    turnId: pending.turnId,
    delta: pending.delta,
    truncated: pending.truncated,
    segmentIndex: pending.segmentIndex,
  });
}

export function discardPendingThinking(
  ctl: ChatControllerInternals,
): void {
  const pending = pendingThinkingBatches.get(ctl);
  if (pending?.timer !== null && pending?.timer !== undefined) {
    clearTimeout(pending.timer);
  }
  pendingThinkingBatches.delete(ctl);
}
