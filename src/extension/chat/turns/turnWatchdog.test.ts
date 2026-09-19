import { describe, expect, it, vi } from 'vitest';

import {
  createController,
  createMockRuntime,
  ready,
  send,
  stop,
  turnStates,
  waitForConnected,
  type HostToWebviewMessage,
  type RuntimeEvent,
} from '../controllerTestHarness';
import {
  tickTurnWatchdog,
  TURN_IDLE_CONFIRM_READS,
  TURN_IDLE_GRACE_MS,
} from './turnWatchdog';

/** Stream that emits one delta and then hangs forever (dead stream). */
function hangingStream(): (text: string) => AsyncIterable<RuntimeEvent> {
  return async function* () {
    yield { type: 'text-delta', text: 'partial' };
    await new Promise<never>(() => {});
  };
}

function diagnostics(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (message): message is Extract<HostToWebviewMessage, { type: 'runtime.diagnostic' }> =>
      message.type === 'runtime.diagnostic',
  );
}

describe('turnWatchdog', () => {
  it('force-settles a Stop stuck past its window as interrupted', async () => {
    const runtime = Object.assign(createMockRuntime(hangingStream()), {
      interruptSession: vi.fn(async () => {}),
    });
    // The interrupt Promise hangs: the failure mode of report #32.
    runtime.interrupt.mockImplementation(() => new Promise<void>(() => {}));
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long task');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    });
    stop(controller, 'session-1', 'turn-1');
    expect(turnStates(messages).at(-1)?.status).toBe('stopping');
    expect(controller.turnState.turnWatchdog?.stopDeadlineAt).not.toBeNull();

    // Before the deadline the watchdog leaves the turn alone.
    await tickTurnWatchdog(controller);
    expect(turnStates(messages).at(-1)?.status).toBe('stopping');

    controller.turnState.turnWatchdog!.stopDeadlineAt = Date.now() - 1;
    await tickTurnWatchdog(controller);

    expect(turnStates(messages).at(-1)).toMatchObject({
      turnId: 'turn-1',
      status: 'interrupted',
    });
    expect(runtime.interruptSession).toHaveBeenCalled();
    expect(
      diagnostics(messages).some((message) => message.code === 'turn-stop-timeout'),
    ).toBe(true);
    expect(controller.turnState.turnWatchdog).toBeNull();

    // The settled turn releases the send path (queue dispatch uses it).
    send(controller, 'session-1', 'turn-2', 'Next prompt');
    expect(turnStates(messages).at(-1)).toMatchObject({
      turnId: 'turn-2',
      status: 'submitting',
    });
    await controller.dispose();
  });

  it('settles a streaming turn after consecutive idle backend reads', async () => {
    const runtime = Object.assign(createMockRuntime(hangingStream()), {
      readSessionWorkingState: vi.fn(async () => 'idle' as const),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Long task');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    });

    // Within the grace window the backend is never probed.
    await tickTurnWatchdog(controller);
    expect(runtime.readSessionWorkingState).not.toHaveBeenCalled();

    Object.assign(controller.turnState.turnWatchdog!, {
      startedAt: Date.now() - TURN_IDLE_GRACE_MS - 1,
    });
    for (let read = 1; read < TURN_IDLE_CONFIRM_READS; read += 1) {
      await tickTurnWatchdog(controller);
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    }
    await tickTurnWatchdog(controller);

    expect(turnStates(messages).at(-1)).toMatchObject({
      turnId: 'turn-1',
      status: 'completed',
    });
    expect(controller.turnState.turnWatchdog).toBeNull();
    await controller.dispose();
  });

  it('resets the idle count on a running read and clears on natural completion', async () => {
    const reads: Array<'idle' | 'running'> = ['idle', 'running', 'idle'];
    const runtime = Object.assign(createMockRuntime(), {
      readSessionWorkingState: vi.fn(async () => reads.shift() ?? ('running' as const)),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Quick task');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    // A naturally settled turn leaves no watchdog behind.
    expect(controller.turnState.turnWatchdog).toBeNull();

    const hanging = Object.assign(createMockRuntime(hangingStream()), {
      readSessionWorkingState: vi.fn(async () => 'running' as const),
    });
    controller.sessionState.runtime = hanging;
    send(controller, 'session-1', 'turn-2', 'Long task');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    });
    Object.assign(controller.turnState.turnWatchdog!, {
      startedAt: Date.now() - TURN_IDLE_GRACE_MS - 1,
    });
    controller.turnState.turnWatchdog!.idleReads = TURN_IDLE_CONFIRM_READS - 1;
    await tickTurnWatchdog(controller);
    // `running` reset the streak instead of settling the turn.
    expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    expect(controller.turnState.turnWatchdog?.idleReads).toBe(0);
    await controller.dispose();
  });
});
