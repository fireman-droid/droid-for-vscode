import { EventEmitter } from 'node:events';
import { StreamStateTracker, type DaemonSessionController, type SessionSettings } from '@factory/droid-sdk';
import { describe, expect, it, vi } from 'vitest';
import { FactoryDroidRuntime } from './FactoryDroidRuntime';
import { RecoveredDaemonTurn } from './daemon/recoveredTurn';
import { DaemonStreamRecoveryError, DaemonTurnStream } from './daemon/sessionStream';
import { cancellingRuntimeInteractionHandler } from './events/runtimeInteractions';
import type { RuntimeEvent } from './runtimeEvents';
import type { FactoryDroidSession } from './session/sessionTypes';
import { RuntimeTurnRecoveryError } from './turnRecovery';

describe('runtime transport handoff', () => {
  it('publishes the exact backend identity before submitting it once to the daemon', async () => {
    const controller = Object.assign(new EventEmitter(), {
      addUserMessage: vi.fn(async (_id: string, input: { messageId: string }) => {
        controller.emit('sessionNotification', { sessionId: 'session', notification: {
          type: 'agent_turn_completed', turnId: input.messageId, reason: 'completed',
          tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0 },
        } });
      }),
      interruptSession: vi.fn(async () => {}),
    });
    const session = {
      id: 'session', settings: {} as SessionSettings,
      stream: vi.fn<FactoryDroidSession['stream']>(function (_text, options) {
        return new DaemonTurnStream(controller as unknown as DaemonSessionController, 'session', options ?? {}, () => {}).messages(_text);
      }),
      readTurnOutcome: vi.fn(async () => null),
      interrupt: vi.fn(async () => {}), close: vi.fn(async () => {}),
      updateSettings: vi.fn<FactoryDroidSession['updateSettings']>(),
      getContextStats: vi.fn<FactoryDroidSession['getContextStats']>(),
    };
    const runtime = new FactoryDroidRuntime({ createSdkSession: async () => session,
      interactionHandler: cancellingRuntimeInteractionHandler });
    await runtime.initialize('C:/workspace');
    const stream = runtime.sendTurn('Submit exactly once')[Symbol.asyncIterator]();
    const identity = (await stream.next()).value;
    expect(identity).toMatchObject({ type: 'turn-identity', backendTurnId: expect.any(String) });
    expect(controller.addUserMessage).not.toHaveBeenCalled();
    expect((await stream.next()).value).toMatchObject({ type: 'turn-complete', outcome: 'success' });
    await stream.next();
    expect(controller.addUserMessage).toHaveBeenCalledExactlyOnceWith('session', expect.objectContaining({
      messageId: identity?.type === 'turn-identity' ? identity.backendTurnId : null,
    }));
    expect(controller.interruptSession).not.toHaveBeenCalled();
    await runtime.dispose();
  });

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
