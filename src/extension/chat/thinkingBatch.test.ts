import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThinkingDeltaProjection } from '../turnActivityState';
import type { ChatControllerInternals } from './internals';
import {
  discardPendingThinking,
  queueThinkingProjection,
  THINKING_BATCH_WINDOW_MS,
} from './thinkingBatch';

interface TestController {
  disposed: boolean;
  runtimeGeneration: number;
  turnGeneration: number;
  sessionId: string | null;
  turn: { turnId: string } | null;
  emit: ReturnType<typeof vi.fn>;
}

function createController(): TestController {
  return {
    disposed: false,
    runtimeGeneration: 1,
    turnGeneration: 1,
    sessionId: 'session-1',
    turn: { turnId: 'turn-1' },
    emit: vi.fn(),
  };
}

function queue(
  ctl: TestController,
  projection: Partial<ThinkingDeltaProjection> = {},
): void {
  queueThinkingProjection(
    ctl as unknown as ChatControllerInternals,
    'session-1',
    'turn-1',
    {
      delta: 'thought',
      truncated: false,
      segmentIndex: 0,
      ...projection,
    },
  );
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
    ctl.turnGeneration += 1;

    await vi.advanceTimersByTimeAsync(THINKING_BATCH_WINDOW_MS);
    expect(ctl.emit).not.toHaveBeenCalled();

    queue(ctl, { delta: 'new turn' });
    discardPendingThinking(ctl as unknown as ChatControllerInternals);
    await vi.advanceTimersByTimeAsync(THINKING_BATCH_WINDOW_MS);
    expect(ctl.emit).not.toHaveBeenCalled();
  });
});
