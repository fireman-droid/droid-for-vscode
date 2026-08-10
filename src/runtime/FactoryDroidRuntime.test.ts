import {
  ConnectionError,
  InvalidSessionCwdError,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type ClientAskUserHandler,
  type ClientPermissionHandler,
  type DroidStreamEvent,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import {
  FactoryDroidRuntime,
  createLocalDroidSession,
  type FactoryDroidSession,
  type FactoryDroidSessionFactory,
} from './FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from './runtimeInteractions';

describe('FactoryDroidRuntime', () => {
  it('creates one cwd-scoped session and streams a text turn', async () => {
    const session = createMockSession(async function* () {
      yield textDelta('hello');
      yield {
        type: 'assistant_text_complete',
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield successfulResult();
    });
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);

    const first = await runtime.initialize('C:\\workspace');
    const second = await runtime.initialize('C:\\workspace');
    const events = await collect(runtime.sendTurn('Say hello'));

    expect(first).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
      cliVersion: null,
      authenticationStatus: 'unknown',
    });
    expect(second).toEqual(first);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith({
      target: {
        kind: 'new',
        cwd: 'C:\\workspace',
      },
      interactionHandler: cancellingRuntimeInteractionHandler,
    });
    expect(session.stream).toHaveBeenCalledWith('Say hello', {
      includePartialMessages: true,
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      {
        type: 'turn-complete',
        outcome: 'success',
      },
    ]);
  });

  it('initializes an explicit resumed session target once', async () => {
    const session = createMockSession(async function* () {});
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);
    const target = {
      kind: 'resume' as const,
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    };

    const first = await runtime.initialize(target);
    const second = await runtime.initialize({ ...target });

    expect(first).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
    });
    expect(second).toEqual(first);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith({
      target,
      interactionHandler: cancellingRuntimeInteractionHandler,
    });
  });

  it('yields only defined semantic events from the SDK stream', async () => {
    const session = createMockSession(async function* () {
      yield {
        type: 'thinking_text_delta',
        messageId: 'message-1',
        blockIndex: 0,
        text: 'Considering',
      };
      yield {
        type: 'session_title_updated',
        title: 'Sensitive title',
      };
      yield {
        type: 'tool_progress',
        toolUseId: 'tool-1',
        toolName: 'Read',
        content: 'sensitive progress',
        update: {
          type: 'message',
          text: 'sensitive update',
        },
      };
    });
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');

    await expect(collect(runtime.sendTurn('Continue'))).resolves.toEqual([
      {
        type: 'thinking-delta',
        text: 'Considering',
      },
      {
        type: 'tool-progress',
        toolUseId: 'tool-1',
        toolName: 'Read',
      },
    ]);
  });

  it('interrupts only an active turn and keeps the stream terminal event', async () => {
    const interrupted = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('before stop');
      await interrupted.promise;
      yield interruptedResult();
    });
    session.interrupt.mockImplementation(async () => interrupted.resolve());
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    await runtime.interrupt();

    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', text: 'before stop' },
    });

    await runtime.interrupt();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'turn-complete',
        outcome: 'interrupted',
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    expect(session.interrupt).toHaveBeenCalledOnce();
  });

  it('rejects concurrent turns until the active stream is finished', async () => {
    const release = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('first');
      await release.promise;
      yield successfulResult();
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const first = runtime.sendTurn('First turn')[Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'text-delta', text: 'first' },
    });

    await expect(collect(runtime.sendTurn('Second turn'))).rejects.toThrow(
      'Droid runtime already has an active turn.',
    );

    release.resolve();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'turn-complete', outcome: 'success' },
    });
    await expect(first.next()).resolves.toMatchObject({ done: true });
    await expect(collect(runtime.sendTurn('Third turn'))).resolves.toHaveLength(
      2,
    );
  });

  it('drops late stream events and disposes an active session once', async () => {
    const lateEvent = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('before disposal');
      await lateEvent.promise;
      yield textDelta('late event');
    });
    session.interrupt.mockImplementation(async () => lateEvent.resolve());
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await iterator.next();

    const firstDisposal = runtime.dispose();
    const secondDisposal = runtime.dispose();

    expect(secondDisposal).toBe(firstDisposal);
    await firstDisposal;
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    expect(() => runtime.initialize('C:\\workspace')).toThrow(
      'Droid runtime is disposed.',
    );
  });

  it('retries a failed close without losing the owned session', async () => {
    const session = createMockSession(async function* () {});
    session.close
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce();
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);
    await runtime.initialize('C:\\workspace');

    const firstDisposal = runtime.dispose();
    expect(runtime.dispose()).toBe(firstDisposal);
    await expect(firstDisposal).rejects.toThrow('close failed');
    expect(() => runtime.initialize('C:\\workspace')).toThrow(
      'Droid runtime is disposed.',
    );
    await expect(collect(runtime.sendTurn('No turn'))).rejects.toThrow(
      'Droid runtime is disposed.',
    );

    await expect(runtime.dispose()).resolves.toBeUndefined();

    expect(session.close).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('closes the owned session even when active-turn interruption fails', async () => {
    const waiting = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('active');
      await waiting.promise;
    });
    session.interrupt.mockRejectedValue(new Error('interrupt failed'));
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await iterator.next();

    await expect(runtime.dispose()).rejects.toThrow('interrupt failed');

    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    waiting.resolve();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('closes a session that arrives after disposal starts', async () => {
    const created = deferred<FactoryDroidSession>();
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(() => created.promise);

    const initialization = runtime.initialize('C:\\workspace');
    const disposal = runtime.dispose();
    created.resolve(session);

    await expect(initialization).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'initialization-failed',
    });
    await disposal;
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('surfaces close failures when disposal races initialization', async () => {
    const created = deferred<FactoryDroidSession>();
    const session = createMockSession(async function* () {});
    session.close
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce();
    const runtime = createRuntime(() => created.promise);

    const initialization = runtime.initialize('C:\\workspace');
    const disposal = runtime.dispose();
    created.resolve(session);

    await expect(initialization).rejects.toThrow('close failed');
    await expect(disposal).rejects.toThrow('close failed');
    expect(session.close).toHaveBeenCalledOnce();

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('reports structured initialization failures without parsing messages', async () => {
    const invalidCwd = createRuntime(async ({ target }) => {
      throw new InvalidSessionCwdError(
        target.cwd,
        'arbitrary SDK message',
      );
    });
    const missingCli = createRuntime(async () => {
      throw new ConnectionError('arbitrary SDK message', {
        error: Object.assign(new Error('arbitrary system message'), {
          code: 'ENOENT',
        }),
      });
    });
    const unknownFailure = createRuntime(async () => {
      throw new Error('sensitive failure details');
    });

    await expect(invalidCwd.initialize('C:\\missing')).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid-cwd',
      authenticationStatus: 'unknown',
    });
    await expect(missingCli.initialize('C:\\workspace')).resolves.toMatchObject(
      {
        status: 'unavailable',
        reason: 'cli-not-found',
        authenticationStatus: 'unknown',
      },
    );
    await expect(
      unknownFailure.initialize('C:\\workspace'),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'initialization-failed',
      message: 'The Droid SDK could not initialize a session.',
      authenticationStatus: 'unknown',
    });
  });
});

describe('createLocalDroidSession', () => {
  it('connects a cwd-scoped transport before creating the SDK session', async () => {
    const calls: string[] = [];
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    transport.connect.mockImplementation(async () => {
      calls.push('connect');
    });
    const createSession = vi.fn(async (options) => {
      calls.push('createSession');
      expect(options).toEqual({
        cwd: 'C:\\workspace',
        transport,
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      });
      expect(options).not.toHaveProperty('apiKey');
      return session;
    });
    const createTransport = vi.fn(() => transport);

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).resolves.toBe(session);

    expect(createTransport).toHaveBeenCalledWith({ cwd: 'C:\\workspace' });
    expect(calls).toEqual(['connect', 'createSession']);
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('wires the runtime interaction handler into SDK session callbacks', async () => {
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    let permissionHandler: ClientPermissionHandler | undefined;
    let askUserHandler: ClientAskUserHandler | undefined;
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };

    await createLocalDroidSession(
      {
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler,
      },
      {
        createTransport: () => transport,
        createSession: async (options) => {
          permissionHandler = options.permissionHandler;
          askUserHandler = options.askUserHandler;
          return session;
        },
        resumeSession: vi.fn(),
      },
    );

    await expect(
      permissionHandler?.({
        options: [
          {
            label: 'Allow once',
            value: ToolConfirmationOutcome.ProceedOnce,
          },
        ],
        toolUses: [
          {
            toolUse: {
              type: 'tool_use' as never,
              id: 'tool-1',
              name: 'Create',
              input: { secret: 'must not escape' },
            },
            confirmationType: ToolConfirmationType.Create,
            details: {
              type: ToolConfirmationType.Create,
              filePath: 'C:\\workspace\\file.ts',
              fileName: 'file.ts',
              content: 'content',
            },
          },
        ],
      }),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    await expect(
      askUserHandler?.({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 4,
            topic: 'Language',
            question: 'Which language?',
            options: ['TypeScript'],
          },
        ],
      }),
    ).resolves.toEqual({
      answers: [
        {
          index: 4,
          question: 'Which language?',
          answer: 'TypeScript',
        },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('resumes through the connected cwd transport without passing cwd to the SDK', async () => {
    const calls: string[] = [];
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    transport.connect.mockImplementation(async () => {
      calls.push('connect');
    });
    const createSession = vi.fn();
    let permissionHandler: ClientPermissionHandler | undefined;
    let askUserHandler: ClientAskUserHandler | undefined;
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };
    const resumeSession = vi.fn(async (sessionId, options) => {
      calls.push('resumeSession');
      expect(sessionId).toBe('saved-session');
      expect(options).toEqual({
        transport,
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      });
      expect(options).not.toHaveProperty('cwd');
      permissionHandler = options.permissionHandler;
      askUserHandler = options.askUserHandler;
      return session;
    });
    const createTransport = vi.fn(() => transport);

    await expect(
      createLocalDroidSession(
        {
          target: {
            kind: 'resume',
            cwd: 'C:\\workspace',
            sessionId: 'saved-session',
          },
          interactionHandler,
        },
        { createTransport, createSession, resumeSession },
      ),
    ).resolves.toBe(session);

    expect(createTransport).toHaveBeenCalledWith({ cwd: 'C:\\workspace' });
    expect(createSession).not.toHaveBeenCalled();
    expect(calls).toEqual(['connect', 'resumeSession']);
    expect(transport.close).not.toHaveBeenCalled();

    await expect(
      permissionHandler?.({
        options: [
          {
            label: 'Allow once',
            value: ToolConfirmationOutcome.ProceedOnce,
          },
        ],
        toolUses: [
          {
            toolUse: {
              type: 'tool_use' as never,
              id: 'tool-1',
              name: 'Create',
              input: { secret: 'must not escape' },
            },
            confirmationType: ToolConfirmationType.Create,
            details: {
              type: ToolConfirmationType.Create,
              filePath: 'C:\\workspace\\file.ts',
              fileName: 'file.ts',
              content: 'content',
            },
          },
        ],
      }),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    await expect(
      askUserHandler?.({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 4,
            topic: 'Language',
            question: 'Which language?',
            options: ['TypeScript'],
          },
        ],
      }),
    ).resolves.toEqual({
      answers: [
        {
          index: 4,
          question: 'Which language?',
          answer: 'TypeScript',
        },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('closes the transport when connecting fails', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    transport.connect.mockRejectedValue(failure);
    transport.close.mockRejectedValue(new Error('arbitrary cleanup failure'));
    const createSession = vi.fn();

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).rejects.toBe(failure);

    expect(createSession).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('does not double-close transport cleanup owned by a failed SDK creation', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    const createSession = vi.fn(async () => {
      await transport.close();
      throw failure;
    });

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).rejects.toBe(failure);

    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('does not double-close transport cleanup owned by a failed SDK resume', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    const resumeSession = vi.fn(async () => {
      await transport.close();
      throw failure;
    });

    await expect(
      createLocalDroidSession(
        {
          target: {
            kind: 'resume',
            cwd: 'C:\\workspace',
            sessionId: 'saved-session',
          },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession: vi.fn(),
          resumeSession,
        },
      ),
    ).rejects.toBe(failure);

    expect(resumeSession).toHaveBeenCalledWith('saved-session', {
      transport,
      permissionHandler: expect.any(Function),
      askUserHandler: expect.any(Function),
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });
});

function createRuntime(createSdkSession: FactoryDroidSessionFactory) {
  return new FactoryDroidRuntime({
    interactionHandler: cancellingRuntimeInteractionHandler,
    createSdkSession,
  });
}

function createMockSession(
  streamImplementation: (
    prompt: string,
    options: { includePartialMessages: true },
  ) => AsyncGenerator<DroidStreamEvent>,
) {
  return {
    id: 'session-1',
    stream: vi.fn(streamImplementation),
    interrupt: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createMockTransport() {
  return {
    isConnected: false,
    connect: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    onMessage: vi.fn(),
    onError: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

function textDelta(text: string): DroidStreamEvent {
  return {
    type: 'assistant_text_delta',
    messageId: 'message-1',
    blockIndex: 0,
    text,
  };
}

function successfulResult(): Extract<
  DroidStreamEvent,
  { type: 'result'; subtype: 'success' }
> {
  return {
    type: 'result',
    subtype: 'success',
    sessionId: 'session-1',
    durationMs: 10,
    tokenUsage: null,
    messages: [],
    text: '',
    turnCount: 1,
    success: true,
    interrupted: false,
    error: null,
  };
}

function interruptedResult(): Extract<
  DroidStreamEvent,
  { type: 'result'; subtype: 'interrupted' }
> {
  return {
    type: 'result',
    subtype: 'interrupted',
    sessionId: 'session-1',
    durationMs: 10,
    tokenUsage: null,
    messages: [],
    text: '',
    turnCount: 1,
    success: false,
    interrupted: true,
    error: null,
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) {
    result.push(value);
  }
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}
