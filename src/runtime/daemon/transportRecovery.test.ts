import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutonomyLevel, DroidInteractionMode, ReasoningEffort, ToolConfirmationOutcome,
  type DaemonSessionController, type SessionSettings } from '@factory/droid-sdk';
import { retainDaemonController } from './connectPublicDaemon';
import { DaemonStreamRecoveryError } from './sessionStream';
import { DAEMON_RECOVERY_TIMEOUT_MS } from './transportRecovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  type Status = ReturnType<DaemonSessionController['getConnectionStatus']>;
  let status = { transport: 'connected', isAuthenticated: true,
    lastConnectionFailure: null, recovery: null } as Status;
  const settings: SessionSettings = { modelId: 'test', autonomyLevel: AutonomyLevel.Off,
    interactionMode: DroidInteractionMode.Auto, reasoningEffort: ReasoningEffort.Low } as SessionSettings;
  const messages: { id: string }[] = [];
  const snapshot = () => ({ settings, cwd: 'C:/test', session: { messages } });
  const state = { clear: vi.fn(), getSessionManager: vi.fn(() => null), markSessionLoading: vi.fn(), removeSession: vi.fn(),
    getSessionLoadOptions: vi.fn(() => ({ disableBuiltinSkills: true })) };
  const controller = Object.assign(new EventEmitter(), {
    loadSession: vi.fn(async (_options: object) => snapshot()),
    initializeSession: vi.fn(async (_options: object) => ({ settings })),
    getConnectionStatus: () => status,
    getSessionStateManager: () => state,
    addUserMessage: vi.fn(async (_id: string, input: { messageId: string }) => { messages.push({ id: input.messageId }); }),
    interruptSession: vi.fn(async () => {}), closeSession: vi.fn(async () => {}), destroy: vi.fn(),
    respondToPermission: vi.fn(async (_input: object) => {}), respondToAskUser: vi.fn(async () => {}),
    getPendingPermissions: vi.fn(() => [] as { requestId: string }[]),
    getPendingAskUserRequests: vi.fn(() => [] as { requestId: string }[]),
  });
  const onConnectionState = vi.fn(), onError = vi.fn();
  const api = retainDaemonController(controller as unknown as DaemonSessionController, {
    url: 'ws://test', auth: { apiKey: 'test-only' }, onConnectionState, onError,
  });
  const disconnect = () => {
    status = { ...status, transport: 'disconnected' as Status['transport'], isAuthenticated: false, recovery: null };
    controller.emit('disconnected', 1006, 'synthetic gap');
    controller.emit('connectionStatusChanged', status);
    status = { ...status, recovery: { isReconnecting: true } };
    controller.emit('connectionStatusChanged', status);
  };
  const reconnect = () => {
    status = { ...status, transport: 'connected' as Status['transport'], isAuthenticated: true, recovery: null };
    controller.emit('connectionStatusChanged', status);
  };
  const notify = (notification: object) => controller.emit('sessionNotification', { sessionId: 'session', notification });
  const complete = (turnId: string) => notify({ type: 'agent_turn_completed', turnId, reason: 'completed',
    tokenUsage: { inputTokens: 7, outputTokens: 3, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0 } });
  return { api, controller, snapshot, messages, onConnectionState, onError, disconnect, reconnect, notify, complete };
}

afterEach(() => vi.useRealTimers());

describe('daemon transport recovery', () => {
  it('queries a persisted outcome with exact identity and retained load options without sending or interrupting', async () => {
    const f = fixture();
    const session = await f.api.sessions.resume('session');
    f.controller.loadSession.mockResolvedValueOnce({ ...f.snapshot(), agentTurnOutcome: {
      type: 'agent_turn_outcome', turnId: 'submitted', reason: 'cancelled', resultKind: 'text',
    } } as ReturnType<typeof f.snapshot>);
    await expect(session.readTurnOutcome!('submitted')).resolves.toMatchObject({
      backendTurnId: 'submitted', completion: { outcome: 'interrupted' },
    });
    expect(f.controller.loadSession).toHaveBeenLastCalledWith({
      sessionId: 'session', disableBuiltinSkills: true, agentTurnOutcomeTurnId: 'submitted',
    });
    expect(f.controller.addUserMessage).not.toHaveBeenCalled();
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    f.api.disconnect();
  });

  it('does not interrupt an active turn for an unrelated controller error', async () => {
    const f = fixture();
    const session = await f.api.sessions.resume('session');
    const stream = session.stream('hello');
    const next = stream.next();
    await vi.waitFor(() => expect(f.controller.addUserMessage).toHaveBeenCalledOnce());
    f.controller.emit('error', new Error('unrelated diagnostic'));
    f.complete(f.messages[0]!.id);
    expect((await next).value).toMatchObject({ type: 'result', success: true });
    await stream.next();
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    expect(f.onConnectionState).not.toHaveBeenCalled();
    f.api.disconnect();
  });

  it('restores original subscription options then hands off without resend and keeps real completion', async () => {
    const f = fixture();
    const options = { disableBuiltinSkills: true, disabledToolIds: ['browser'], messageLimit: 71 };
    const session = await f.api.sessions.resume('session', options);
    const next = session.stream('once').next().catch(error => error);
    await vi.waitFor(() => expect(f.controller.addUserMessage).toHaveBeenCalledOnce());
    const load = deferred<ReturnType<typeof f.snapshot>>();
    f.controller.loadSession.mockImplementationOnce(() => load.promise);
    f.disconnect();
    f.reconnect();
    let ready = false;
    const wait = f.api.waitUntilReady!().then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(f.controller.loadSession).toHaveBeenLastCalledWith({ ...options, sessionId: 'session' });
    load.resolve(f.snapshot());
    await wait;
    const handoff = await next as DaemonStreamRecoveryError;
    expect(handoff).toBeInstanceOf(DaemonStreamRecoveryError);
    expect(handoff.recovery.completion).toBeUndefined();
    f.complete('unrelated-turn');
    expect(handoff.recovery.completion).toBeUndefined();
    f.complete(handoff.messageId);
    expect(handoff.recovery.completion).toMatchObject({ success: true, tokenUsage: { inputTokens: 7, outputTokens: 3 } });
    expect(f.controller.addUserMessage).toHaveBeenCalledOnce();
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    expect(f.onConnectionState.mock.calls.map(([state]) => state)).toEqual(['recovering', 'connected']);
    f.api.disconnect();
  });

  it('reports unconfirmed submission instead of resending it or inventing a recovered turn', async () => {
    const f = fixture();
    const session = await f.api.sessions.resume('session');
    const next = session.stream('uncertain').next().catch(error => error);
    await vi.waitFor(() => expect(f.controller.addUserMessage).toHaveBeenCalledOnce());
    f.disconnect();
    f.messages.length = 0;
    f.reconnect();
    expect(await next).toMatchObject({ message: expect.stringContaining('delivery of this message could not be confirmed') });
    expect(f.controller.addUserMessage).toHaveBeenCalledOnce();
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    f.api.disconnect();
  });

  it('cancels a send waiting for socket restoration without sending or interrupting', async () => {
    const f = fixture();
    const session = await f.api.sessions.resume('session');
    f.disconnect();
    const next = session.stream('never sent').next();
    const rejected = expect(next).rejects.toMatchObject({ name: 'AbortError' });
    await session.interrupt();
    await rejected;
    f.reconnect();
    await f.api.waitUntilReady!();
    expect(f.controller.addUserMessage).not.toHaveBeenCalled();
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    f.api.disconnect();
  });

  it('bounds a broken transport without cancelling the still owned remote task', async () => {
    const f = fixture();
    const session = await f.api.sessions.resume('session');
    const next = session.stream('once').next().catch(error => error);
    await vi.waitFor(() => expect(f.controller.addUserMessage).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    f.disconnect();
    await vi.advanceTimersByTimeAsync(DAEMON_RECOVERY_TIMEOUT_MS);
    expect(await next).toBeInstanceOf(Error);
    expect(f.onConnectionState).toHaveBeenLastCalledWith('failed');
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    f.api.disconnect();
  });

  it('does not fail surviving transport when an attachment closes during reload', async () => {
    const f = fixture();
    const session = await f.api.sessions.resume('session');
    const load = deferred<ReturnType<typeof f.snapshot>>();
    f.controller.loadSession.mockImplementationOnce(() => load.promise);
    f.disconnect(); f.reconnect();
    await session.detach();
    load.reject(new Error('detached load'));
    await expect(f.api.waitUntilReady!()).resolves.toBeUndefined();
    expect(f.onConnectionState).toHaveBeenLastCalledWith('connected');
    f.api.disconnect();
  });

  it('holds one permission answer through recovery despite a replayed pending request', async () => {
    const f = fixture();
    const permissionHandler = vi.fn(async () => ToolConfirmationOutcome.ProceedOnce as const);
    await f.api.sessions.resume('session', { permissionHandler });
    const request = { sessionId: 'session', requestId: 'approval', toolUses: [], associatedSessionIds: [],
      options: [{ value: ToolConfirmationOutcome.ProceedOnce, label: 'Allow' }] };
    f.disconnect();
    f.controller.emit('permissionRequested', request);
    await Promise.resolve();
    expect(f.controller.respondToPermission).not.toHaveBeenCalled();
    f.controller.emit('permissionRequested', request);
    f.reconnect();
    await vi.waitFor(() => expect(f.controller.respondToPermission).toHaveBeenCalledOnce());
    expect(permissionHandler).toHaveBeenCalledOnce();
    f.api.disconnect();
  });

  it('re-asks a confirmed pending permission when the old response rejects across a connection generation', async () => {
    const f = fixture();
    const response = deferred<void>();
    f.controller.respondToPermission.mockImplementationOnce(() => response.promise);
    const permissionHandler = vi.fn().mockResolvedValueOnce(ToolConfirmationOutcome.ProceedOnce)
      .mockResolvedValueOnce(ToolConfirmationOutcome.Cancel);
    await f.api.sessions.resume('session', { permissionHandler });
    const request = { sessionId: 'session', requestId: 'approval', toolUses: [], associatedSessionIds: [], options: [
      { value: ToolConfirmationOutcome.ProceedOnce, label: 'Allow' }, { value: ToolConfirmationOutcome.Cancel, label: 'Cancel' },
    ] };
    f.controller.getPendingPermissions.mockReturnValue([request]);
    f.controller.emit('permissionRequested', request);
    await vi.waitFor(() => expect(f.controller.respondToPermission).toHaveBeenCalledOnce());
    f.disconnect();
    f.controller.emit('permissionRequested', request);
    f.reconnect();
    await f.api.waitUntilReady!();
    response.reject(new Error('response result lost'));
    await vi.waitFor(() => expect(f.controller.respondToPermission).toHaveBeenCalledTimes(2));
    expect(permissionHandler).toHaveBeenCalledTimes(2);
    expect(f.controller.respondToPermission).toHaveBeenLastCalledWith(expect.objectContaining({ selectedOption: 'cancel' }));
    expect(f.controller.interruptSession).not.toHaveBeenCalled();
    expect(f.onConnectionState).toHaveBeenLastCalledWith('connected');
    f.api.disconnect();
  });
});
