import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  AutonomyLevel,
  DroidInteractionMode,
  ReasoningEffort,
  ToolConfirmationOutcome,
  type DaemonSessionController,
  type SessionSettings,
} from '@factory/droid-sdk';
import { retainDaemonController } from './connectPublicDaemon';
import { createSubagentEventSource } from './daemonNotificationSource';

const settings = {
  modelId: 'model-1',
  autonomyLevel: AutonomyLevel.Off,
  interactionMode: DroidInteractionMode.Auto,
  reasoningEffort: ReasoningEffort.Low,
} as SessionSettings;

function setup() {
  const state = {
    getSessionManager: vi.fn(() => null),
    markSessionLoading: vi.fn(),
    removeSession: vi.fn(),
    clear: vi.fn(),
  };
  const controller = Object.assign(new EventEmitter(), {
    initializeSession: vi.fn(async () => ({ settings })),
    loadSession: vi.fn(async () => ({ settings, cwd: 'C:/test' })),
    addUserMessage: vi.fn(async (_id: string, _params: { messageId: string }) => ({})),
    interruptSession: vi.fn(async () => ({})),
    closeSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => ({ newSessionId: 'fork-1' })),
    respondToPermission: vi.fn(async (_params: object) => undefined),
    respondToAskUser: vi.fn(async (_params: object) => undefined),
    ensureChildSessionAttached: vi.fn(async () => undefined),
    getSessionStateManager: () => state,
    destroy: vi.fn(),
  });
  const onError = vi.fn();
  const api = retainDaemonController(controller as unknown as DaemonSessionController, {
    url: 'ws://127.0.0.1:1',
    auth: { apiKey: 'test-only' },
    onError,
  });
  const notify = (sessionId: string, notification: object) =>
    controller.emit('sessionNotification', { sessionId, notification });
  return { api, controller, state, onError, notify };
}

describe('public daemon ownership', () => {
  it('releases a failed provisional create and allows retry without closing the backend', async () => {
    const { api, controller, state } = setup();
    controller.initializeSession.mockRejectedValueOnce(new Error('create failed'));
    await expect(
      api.sessions.create({ cwd: 'C:/test', sessionId: 'session-1' }),
    ).rejects.toThrow('create failed');
    expect(state.removeSession).toHaveBeenCalledWith('session-1');
    const session = await api.sessions.create({ cwd: 'C:/test', sessionId: 'session-1' });
    await expect(api.sessions.resume(session.id)).rejects.toThrow('attached handle');
    await session.detach();
    await api.sessions.resume(session.id);
    expect(controller.closeSession).not.toHaveBeenCalled();
    api.disconnect();
    expect(controller.destroy).toHaveBeenCalledOnce();
    expect(state.clear).toHaveBeenCalledOnce();
  });

  it('routes child permission to its attached parent exactly once and declines unowned requests', async () => {
    const { api, controller } = setup();
    const permissionHandler = vi.fn(
      async () => ToolConfirmationOutcome.ProceedOnce as const,
    );
    await api.sessions.resume('parent', { permissionHandler });
    const request = {
      sessionId: 'child',
      requestId: 'permission-1',
      toolUses: [],
      associatedSessionIds: ['child', 'parent'],
      options: [{ value: ToolConfirmationOutcome.ProceedOnce, label: 'Allow once' }],
    };
    controller.emit('permissionRequested', request);
    await vi.waitFor(() => expect(controller.respondToPermission).toHaveBeenCalledOnce());
    expect(permissionHandler).toHaveBeenCalledOnce();
    expect(controller.respondToPermission).toHaveBeenCalledWith({
      sessionId: 'parent',
      permissionId: 'permission-1',
      selectedOption: ToolConfirmationOutcome.ProceedOnce,
    });
    controller.emit('permissionRequested', {
      ...request,
      requestId: 'permission-2',
      associatedSessionIds: [],
    });
    await vi.waitFor(() =>
      expect(controller.respondToPermission).toHaveBeenCalledTimes(2),
    );
    expect(controller.respondToPermission).toHaveBeenLastCalledWith({
      sessionId: 'child',
      permissionId: 'permission-2',
      selectedOption: ToolConfirmationOutcome.Cancel,
    });
    api.disconnect();
    expect(controller.listenerCount('permissionRequested')).toBe(0);
  });

  it('cancels rejected handlers and missing AskUser handlers instead of leaving requests pending', async () => {
    const { api, controller, onError } = setup();
    await api.sessions.resume('parent', {
      permissionHandler: async () => {
        throw new Error('handler failed');
      },
    });
    controller.emit('permissionRequested', {
      sessionId: 'parent',
      requestId: 'p1',
      toolUses: [],
      options: [],
      associatedSessionIds: [],
    });
    controller.emit('askUserRequested', {
      sessionId: 'parent',
      requestId: 'q1',
      questions: [],
      toolCallId: 'tool-1',
    });
    await vi.waitFor(() => expect(controller.respondToPermission).toHaveBeenCalledOnce());
    expect(controller.respondToPermission.mock.calls[0]?.[0]).toMatchObject({
      selectedOption: 'cancel',
    });
    expect(controller.respondToAskUser).toHaveBeenCalledWith({
      sessionId: 'parent',
      requestId: 'q1',
      result: { cancelled: true, answers: [] },
    });
    expect(onError).toHaveBeenCalledOnce();
    api.disconnect();
  });

  it('accepts only the active turn completion and preserves terminal usage', async () => {
    const { api, controller, notify } = setup();
    const session = await api.sessions.resume('session-1');
    const stream = session.stream('hello', { includePartialMessages: true });
    const result = stream.next();
    await vi.waitFor(() => expect(controller.addUserMessage).toHaveBeenCalledOnce());
    const turnId = controller.addUserMessage.mock.calls[0]![1].messageId;
    notify(session.id, {
      type: 'agent_turn_completed',
      turnId: 'other-turn',
      reason: 'completed',
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
      },
    });
    const tokenUsage = {
      inputTokens: 4,
      outputTokens: 2,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      thinkingTokens: 0,
    };
    notify(session.id, {
      type: 'agent_turn_completed',
      turnId,
      reason: 'completed',
      tokenUsage,
      durationMs: 10,
    });
    expect((await result).value).toMatchObject({
      type: 'result',
      success: true,
      tokenUsage,
    });
    expect((await stream.next()).done).toBe(true);
    expect(controller.interruptSession).not.toHaveBeenCalled();
    expect(controller.listenerCount('sessionNotification')).toBe(1);
    api.disconnect();
  });

  it('rejects concurrent streams and preserves a source handle after replacement', async () => {
    const { api, controller, notify } = setup();
    const session = await api.sessions.resume('session-1');
    const stream = session.stream('hello', { includePartialMessages: true });
    const first = stream.next();
    await vi.waitFor(() => expect(controller.addUserMessage).toHaveBeenCalledOnce());
    await expect(session.stream('concurrent').next()).rejects.toThrow();
    await expect(session.fork()).rejects.toThrow();
    const turnId = controller.addUserMessage.mock.calls[0]![1].messageId;
    notify(session.id, {
      type: 'agent_turn_completed',
      turnId,
      reason: 'completed',
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
      },
    });
    await first;
    await stream.next();
    await expect(session.fork()).resolves.toEqual({ newSessionId: 'fork-1' });
    await session.interrupt();
    expect(controller.interruptSession).toHaveBeenCalledWith(session.id);
    api.disconnect();
  });

  it('interrupts an aborted stream once and detach never terminates the backend', async () => {
    const { api, controller } = setup();
    const session = await api.sessions.resume('session-1');
    const abort = new AbortController();
    const next = session.stream('hello', { abortSignal: abort.signal }).next();
    const rejected = expect(next).rejects.toThrow('cancel-test');
    await vi.waitFor(() => expect(controller.addUserMessage).toHaveBeenCalledOnce());
    abort.abort(new Error('cancel-test'));
    await rejected;
    expect(controller.interruptSession).toHaveBeenCalledOnce();
    await session.detach();
    expect(controller.closeSession).not.toHaveBeenCalled();
    api.disconnect();
  });

  it('rebinds the child source without duplicate listeners or attaching history-only children', async () => {
    const first = setup(),
      second = setup();
    const source = createSubagentEventSource();
    const listener = vi.fn();
    source.subscribe(listener);
    source.watch('history', 'C:/test', false);
    source.watch('live', 'C:/test', true);
    source.bindDaemon(first.api);
    source.bindDaemon(first.api);
    expect(first.controller.ensureChildSessionAttached).toHaveBeenCalledOnce();
    source.bindDaemon(second.api);
    first.notify('parent', {
      type: 'child_session_available',
      childSessionId: 'child',
      toolUseId: 'tool',
    });
    expect(listener).not.toHaveBeenCalled();
    second.notify('parent', {
      type: 'child_session_available',
      childSessionId: 'child',
      toolUseId: 'tool',
    });
    expect(listener).toHaveBeenCalledOnce();
    source.dispose();
    first.api.disconnect();
    second.api.disconnect();
  });
});
