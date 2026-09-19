import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinkingDeltaProjection } from './turnActivityState';
import { createTurnActivityState } from './turnActivityState';
import type { ThinkingBatchPort } from './thinkingBatchPort';
import {
  discardPendingThinking,
  queueThinkingProjection,
  THINKING_BATCH_WINDOW_MS,
} from './thinkingBatch';

function createController() {
  return {
    sessionState: {
      disposed: false,
      runtimeGeneration: 1,
      sessionId: 'session-1',
    },
    turnState: {
      turnGeneration: 1,
      turn: {
        turnId: 'turn-1',
        status: 'streaming',
        activity: createTurnActivityState(),
      },
    },
    emit: vi.fn<ThinkingBatchPort['emit']>(),
  } satisfies ThinkingBatchPort;
}

function queue(
  ctl: ThinkingBatchPort,
  projection: Partial<ThinkingDeltaProjection> = {},
): void {
  queueThinkingProjection(ctl, 'session-1', 'turn-1', {
    delta: 'thought',
    truncated: false,
    segmentIndex: 0,
    ...projection,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Thinking bridge batching', () => {
  it('coalesces fragments and flushes each live window', async () => {
    const ctl = createController();
    queue(ctl, { delta: 'one' });
    queue(ctl, { delta: ' two' });

    await vi.advanceTimersByTimeAsync(THINKING_BATCH_WINDOW_MS - 1);
    expect(ctl.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctl.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ delta: 'one two', truncated: false }),
    );

    queue(ctl, { delta: ' three' });
    await vi.advanceTimersByTimeAsync(THINKING_BATCH_WINDOW_MS);
    expect(ctl.emit).toHaveBeenCalledTimes(2);
    expect(ctl.emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ delta: ' three', truncated: false }),
    );
  });

  it('drops timers from stale turns and explicit cancellation', async () => {
    const ctl = createController();
    queue(ctl);
    ctl.turnState.turnGeneration += 1;

    await vi.advanceTimersByTimeAsync(THINKING_BATCH_WINDOW_MS);
    expect(ctl.emit).not.toHaveBeenCalled();

    queue(ctl, { delta: 'new turn' });
    discardPendingThinking(ctl);
    await vi.advanceTimersByTimeAsync(THINKING_BATCH_WINDOW_MS);
    expect(ctl.emit).not.toHaveBeenCalled();
  });
});
