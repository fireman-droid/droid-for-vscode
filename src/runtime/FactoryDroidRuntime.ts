import {
  ConnectionError,
  InvalidSessionCwdError,
  ProcessTransport,
  SDK_VERSION,
  createSession,
  resumeSession,
  type DroidStreamEvent,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';

import type {
  DroidRuntime,
  RuntimeSessionTarget,
} from './DroidRuntime';
import { normalizeSdkEvent } from './normalizeSdkEvent';
import type { RuntimeAvailability, RuntimeEvent } from './runtimeEvents';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from './runtimeInteractions';

export interface FactoryDroidSession {
  readonly id: string;
  stream(
    prompt: string,
    options: { includePartialMessages: true },
  ): AsyncIterable<DroidStreamEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export type FactoryDroidSessionFactory = (options: {
  target: RuntimeSessionTarget;
  interactionHandler: RuntimeInteractionHandler;
}) => Promise<FactoryDroidSession>;

export interface FactoryDroidRuntimeOptions {
  readonly interactionHandler: RuntimeInteractionHandler;
  readonly createSdkSession?: FactoryDroidSessionFactory;
}

export class FactoryDroidRuntime implements DroidRuntime {
  private readonly createSdkSession: FactoryDroidSessionFactory;
  private readonly interactionHandler: RuntimeInteractionHandler;
  private session: FactoryDroidSession | null = null;
  private sessionTarget: RuntimeSessionTarget | null = null;
  private initialization:
    | {
        target: RuntimeSessionTarget;
        promise: Promise<RuntimeAvailability>;
      }
    | undefined;
  private activeTurn: symbol | null = null;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(options: FactoryDroidRuntimeOptions) {
    this.interactionHandler = options.interactionHandler;
    this.createSdkSession =
      options.createSdkSession ?? createLocalDroidSession;
  }

  initialize(
    requestedTarget: RuntimeSessionTarget | string,
  ): Promise<RuntimeAvailability> {
    this.ensureNotDisposed();
    const target = normalizeSessionTarget(requestedTarget);

    if (this.session) {
      if (!sameSessionTarget(target, this.sessionTarget)) {
        throw new Error(
          'Droid runtime is already initialized for another session target.',
        );
      }

      return Promise.resolve(this.available(this.session));
    }

    if (this.initialization) {
      if (!sameSessionTarget(target, this.initialization.target)) {
        throw new Error(
          'Droid runtime is already initializing for another session target.',
        );
      }

      return this.initialization.promise;
    }

    const promise = this.create(target).finally(() => {
      if (this.initialization?.promise === promise) {
        this.initialization = undefined;
      }
    });

    this.initialization = { target, promise };
    return promise;
  }

  async *sendTurn(text: string): AsyncIterable<RuntimeEvent> {
    this.ensureNotDisposed();

    if (text.trim().length === 0) {
      throw new Error('A Droid turn requires non-empty text.');
    }

    const session = this.session;
    if (!session) {
      throw new Error('Droid runtime is not initialized.');
    }

    if (this.activeTurn) {
      throw new Error('Droid runtime already has an active turn.');
    }

    const turn = Symbol('droid-turn');
    this.activeTurn = turn;

    try {
      for await (const sdkEvent of session.stream(text, {
        includePartialMessages: true,
      })) {
        if (this.disposed || this.activeTurn !== turn) {
          return;
        }

        const event = normalizeSdkEvent(sdkEvent);
        if (event) {
          yield event;
        }
      }
    } finally {
      if (this.activeTurn === turn) {
        this.activeTurn = null;
      }
    }
  }

  async interrupt(): Promise<void> {
    if (this.disposed || !this.session || !this.activeTurn) {
      return;
    }

    await this.session.interrupt();
  }

  dispose(): Promise<void> {
    if (this.disposal) {
      return this.disposal;
    }

    this.disposed = true;
    const disposal = this.disposeOwnedSession().catch((error) => {
      if (this.disposal === disposal) {
        this.disposal = null;
      }
      throw error;
    });
    this.disposal = disposal;
    return disposal;
  }

  private async create(
    target: RuntimeSessionTarget,
  ): Promise<RuntimeAvailability> {
    let session: FactoryDroidSession;
    try {
      session = await this.createSdkSession({
        target,
        interactionHandler: this.interactionHandler,
      });
    } catch (error) {
      if (error instanceof InvalidSessionCwdError) {
        return this.unavailable(
          'invalid-cwd',
          'Droid rejected the requested working directory.',
        );
      }

      if (isMissingCliError(error)) {
        return this.unavailable(
          'cli-not-found',
          'The Droid CLI executable was not found.',
        );
      }

      return this.unavailable(
        'initialization-failed',
        'The Droid SDK could not initialize a session.',
      );
    }

    if (this.disposed) {
      this.session = session;
      this.sessionTarget = target;
      await session.close();
      if (this.session === session) {
        this.session = null;
        this.sessionTarget = null;
      }
      return this.unavailable(
        'initialization-failed',
        'Droid runtime was disposed during initialization.',
      );
    }

    this.session = session;
    this.sessionTarget = target;
    return this.available(session);
  }

  private async disposeOwnedSession(): Promise<void> {
    await this.initialization?.promise;

    const session = this.session;
    if (!session) {
      return;
    }

    let interruptError: unknown;
    if (this.activeTurn) {
      try {
        await session.interrupt();
      } catch (error) {
        interruptError = error;
      }
    }

    await session.close();

    if (this.session === session) {
      this.session = null;
      this.sessionTarget = null;
    }

    if (interruptError) {
      throw interruptError;
    }
  }

  private available(session: FactoryDroidSession): RuntimeAvailability {
    return {
      status: 'available',
      sdkVersion: SDK_VERSION,
      cliVersion: null,
      authenticationStatus: 'unknown',
      sessionId: session.id,
    };
  }

  private unavailable(
    reason: Extract<RuntimeAvailability, { status: 'unavailable' }>['reason'],
    message: string,
  ): RuntimeAvailability {
    return {
      status: 'unavailable',
      sdkVersion: SDK_VERSION,
      cliVersion: null,
      authenticationStatus: 'unknown',
      reason,
      message,
    };
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Droid runtime is disposed.');
    }
  }
}

interface LocalSessionTransport extends StringFramedDroidClientTransport {
  connect(): Promise<void>;
}

interface LocalSessionDependencies {
  createTransport(options: { cwd: string }): LocalSessionTransport;
  createSession(options: {
    cwd: string;
    transport: StringFramedDroidClientTransport;
    permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
    askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
  }): Promise<FactoryDroidSession>;
  resumeSession(
    sessionId: string,
    options: {
      transport: StringFramedDroidClientTransport;
      permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
      askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
    },
  ): Promise<FactoryDroidSession>;
}

const localSessionDependencies: LocalSessionDependencies = {
  createTransport: (options) => new ProcessTransport(options),
  createSession,
  resumeSession,
};

export async function createLocalDroidSession(
  {
    target,
    interactionHandler,
  }: {
    target: RuntimeSessionTarget;
    interactionHandler: RuntimeInteractionHandler;
  },
  dependencies: LocalSessionDependencies = localSessionDependencies,
): Promise<FactoryDroidSession> {
  const transport = dependencies.createTransport({ cwd: target.cwd });

  try {
    await transport.connect();
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // Preserve the structured connection failure that initialization classifies.
    }
    throw error;
  }

  const interactionCallbacks =
    createRuntimeInteractionCallbacks(interactionHandler);

  if (target.kind === 'resume') {
    return dependencies.resumeSession(target.sessionId, {
      transport,
      ...interactionCallbacks,
    });
  }

  return dependencies.createSession({
    cwd: target.cwd,
    transport,
    ...interactionCallbacks,
  });
}

function normalizeSessionTarget(
  target: RuntimeSessionTarget | string,
): RuntimeSessionTarget {
  return typeof target === 'string'
    ? { kind: 'new', cwd: target }
    : target;
}

function sameSessionTarget(
  left: RuntimeSessionTarget,
  right: RuntimeSessionTarget | null,
): boolean {
  return (
    right !== null &&
    left.kind === right.kind &&
    left.cwd === right.cwd &&
    (left.kind === 'new' ||
      (right.kind === 'resume' && left.sessionId === right.sessionId))
  );
}

function isMissingCliError(error: unknown): boolean {
  if (!(error instanceof ConnectionError)) {
    return false;
  }

  return (
    hasErrorCode(error.cause, 'ENOENT') ||
    hasErrorCode(error.metadata?.error, 'ENOENT')
  );
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === expectedCode
  );
}
