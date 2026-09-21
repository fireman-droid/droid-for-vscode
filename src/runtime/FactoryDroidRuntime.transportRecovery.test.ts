import { EventEmitter } from 'node:events';
import { StreamStateTracker, type DaemonSessionController, type SessionSettings } from '@factory/droid-sdk';
import { describe, expect, it, vi } from 'vitest';
import { FactoryDroidRuntime } from './FactoryDroidRuntime';
import { RecoveredDaemonTurn } from './daemon/recoveredTurn';
import { DaemonStreamRecoveryError } from './daemon/sessionStream';
import { cancellingRuntimeInteractionHandler } from './events/runtimeInteractions';
import type { RuntimeEvent } from './runtimeEvents';
import type { FactoryDroidSession } from './session/sessionTypes';
import { RuntimeTurnRecoveryError } from './turnRecovery';

describe('runtime transport handoff', () => {
  it('preserves the existing submission and exposes its later real completion without resend or failure', async () => {
    const controller = new EventEmitter();
    const released = vi.fn();
    const recovery = new RecoveredDaemonTurn(controller as unknown as DaemonSessionController, 'session', 'submitted-message',
      new StreamStateTracker({ sessionId: 'session', startedAt: Date.now(), hasOutputFormat: false }), undefined, released);
    const session = {
      id: 'session', settings: {} as SessionSettings,
      stream: vi.fn<FactoryDroidSession['stream']>(async function* () {
        yield { type: 'assistant_text_delta', messageId: 'assistant', blockIndex: 0, text: 'Before the gap' };
        throw new DaemonStreamRecoveryError('submitted-message', recovery);
      }),
      interrupt: vi.fn(async () => {}), close: vi.fn(async () => {}),
      updateSettings: vi.fn<FactoryDroidSession['updateSettings']>(),
      getContextStats: vi.fn<FactoryDroidSession['getContextStats']>(),
    };
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({ createSdkSession: async () => session,
      interactionHandler: cancellingRuntimeInteractionHandler, diagnostics });
    await runtime.initialize('C:/workspace');
    const events: RuntimeEvent[] = [];
    let failure: unknown;
    try { for await (const event of runtime.sendTurn('Submit exactly once')) events.push(event); }
    catch (error) { failure = error; }

    expect(failure).toBeInstanceOf(RuntimeTurnRecoveryError);
    const handoff = failure as RuntimeTurnRecoveryError;
    expect(handoff.messageId).toBe('submitted-message');
    expect(handoff.completion).toBeUndefined();
    expect(events).toEqual([{ type: 'text-delta', text: 'Before the gap' }]);
    expect(session.stream).toHaveBeenCalledOnce();
    expect(session.interrupt).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenLastCalledWith(expect.objectContaining({
      level: 'info', name: 'runtime.turn.finished', attributes: expect.objectContaining({ outcome: 'transport-recovered' }),
    }));

    controller.emit('sessionNotification', { sessionId: 'session', notification: {
      type: 'agent_turn_completed', turnId: 'submitted-message', reason: 'completed',
      tokenUsage: { inputTokens: 7, outputTokens: 3, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0 },
    } });
    expect(handoff.completion).toMatchObject({ type: 'turn-complete', outcome: 'success',
      turnUsage: { inputTokens: 7, outputTokens: 3 } });
    handoff.dispose();
    expect(released).toHaveBeenCalledOnce();
    expect(controller.listenerCount('sessionNotification')).toBe(0);
    await runtime.dispose();
  });
});
