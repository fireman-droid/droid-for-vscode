import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import type { RuntimeDiagnosticEvent } from '../runtime/runtimeDiagnostics';
import type { ChatController } from './ChatController';
import {
  BrowserDevBridge,
  type BrowserDevBridgeDependencies,
} from './BrowserDevBridge';
import type { MissionControlPanelController } from './MissionControlPanelController';

type StartupStage = 'listen' | 'waitForVite';
type StopAction = 'stop' | 'dispose';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface FakeDisposable {
  readonly dispose: () => void;
}

interface BrowserDevFixture {
  readonly bridge: BrowserDevBridge;
  readonly servers: EventEmitter[];
  readonly processes: EventEmitter[];
  readonly subscriptions: FakeDisposable[];
  readonly timers: object[];
  readonly diagnostics: RuntimeDiagnosticEvent[];
  readonly clipboard: ReturnType<typeof vi.fn>;
  readonly closeServer: ReturnType<typeof vi.fn>;
  readonly stopProcess: ReturnType<typeof vi.fn>;
  readonly clearInterval: ReturnType<typeof vi.fn>;
  readonly releaseCleanup: () => void;
  openEvents(): { readonly end: ReturnType<typeof vi.fn> };
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function disposable(): FakeDisposable {
  return { dispose: vi.fn() };
}

function fakeServer(): Server {
  return new EventEmitter() as unknown as Server;
}

function fakeProcess(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    exitCode: null,
  }) as unknown as ChildProcess;
}

function createFixture(stage: StartupStage): BrowserDevFixture {
  const servers: EventEmitter[] = [];
  const processes: EventEmitter[] = [];
  const subscriptions: FakeDisposable[] = [];
  const timers: object[] = [];
  const diagnostics: RuntimeDiagnosticEvent[] = [];
  const cleanup = deferred<void>();
  const startup = deferred<never>();
  const clipboard = vi.fn(async () => undefined);
  const closeServer = vi.fn(() => cleanup.promise);
  const stopProcess = vi.fn(() => cleanup.promise);
  const clearInterval = vi.fn();
  const controller = {
    subscribe: vi.fn(() => {
      const value = disposable();
      subscriptions.push(value);
      return value;
    }),
  } as unknown as ChatController;
  const missionControl = {
    onDidChangeWorkspaceSetup: vi.fn(() => {
      const value = disposable();
      subscriptions.push(value);
      return value;
    }),
  } as unknown as MissionControlPanelController;
  const listen = vi.fn((_server: Server, signal: AbortSignal) => {
    if (stage === 'waitForVite') {
      return Promise.resolve(43_000);
    }
    signal.addEventListener(
      'abort',
      () => startup.reject(new Error('listen cancelled')),
      { once: true },
    );
    return startup.promise;
  });
  const waitForVite = vi.fn(
    (_process: ChildProcess, _readError: () => string, signal: AbortSignal) => {
      signal.addEventListener(
        'abort',
        () => startup.reject(new Error('Vite readiness cancelled')),
        { once: true },
      );
      return startup.promise;
    },
  );
  const dependencies: Partial<BrowserDevBridgeDependencies> = {
    assertSourceRoot: async () => undefined,
    createToken: () => 'test-token',
    createServer: () => {
      const server = fakeServer();
      servers.push(server as unknown as EventEmitter);
      return server;
    },
    startVite: () => {
      const process = fakeProcess();
      processes.push(process as unknown as EventEmitter);
      return process;
    },
    listen,
    waitForVite,
    closeServer,
    stopProcess,
    setInterval: vi.fn((callback: () => void) => {
      const timer = { callback };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setInterval>;
    }),
    clearInterval,
    writeClipboard: clipboard,
    showInformationMessage: vi.fn(async () => undefined),
    onDidChangeConfiguration: vi.fn(() => {
      const value = disposable();
      subscriptions.push(value);
      return value;
    }),
    onDidChangeActiveColorTheme: vi.fn(() => {
      const value = disposable();
      subscriptions.push(value);
      return value;
    }),
  };
  const bridge = new BrowserDevBridge(
    controller,
    missionControl,
    { record: (event) => diagnostics.push(event) },
    dependencies,
  );
  return {
    bridge,
    servers,
    processes,
    subscriptions,
    timers,
    diagnostics,
    clipboard,
    closeServer,
    stopProcess,
    clearInterval,
    releaseCleanup: () => cleanup.resolve(),
    openEvents: () => {
      const request = Object.assign(new EventEmitter(), {
        headers: {
          authorization: 'Bearer test-token',
          origin: 'http://127.0.0.1:4173',
        },
        method: 'GET',
        url: '/events',
      }) as unknown as IncomingMessage;
      const response = {
        end: vi.fn(),
        write: vi.fn(),
        writeHead: vi.fn(),
        setHeader: vi.fn(),
      } as unknown as ServerResponse;
      servers[0]?.emit('request', request, response);
      return response as unknown as { readonly end: ReturnType<typeof vi.fn> };
    },
  };
}

async function reachesStage(
  fixture: BrowserDevFixture,
  stage: StartupStage,
): Promise<void> {
  await vi.waitFor(() => {
    expect(fixture.servers).toHaveLength(1);
    expect(fixture.processes).toHaveLength(1);
    if (stage === 'listen') {
      return;
    }
    expect(fixture.timers).toHaveLength(1);
    expect(fixture.subscriptions).toHaveLength(4);
  });
}

describe('BrowserDevBridge startup cancellation', () => {
  it.each([
    ['listen', 'stop'],
    ['listen', 'dispose'],
    ['waitForVite', 'stop'],
    ['waitForVite', 'dispose'],
  ] as const)(
    'cancels %s startup through %s without publishing stale results',
    async (stage: StartupStage, action: StopAction) => {
      const fixture = createFixture(stage);
      const start = fixture.bridge.start('/fake/droidvisx');
      await reachesStage(fixture, stage);
      const events =
        stage === 'waitForVite' ? fixture.openEvents() : undefined;

      const stopped =
        action === 'stop'
          ? fixture.bridge.stop()
          : (() => {
              fixture.bridge.dispose();
              return fixture.bridge.stop();
            })();

      await vi.waitFor(() => {
        expect(fixture.closeServer).toHaveBeenCalledOnce();
        expect(fixture.stopProcess).toHaveBeenCalledOnce();
      });
      if (action === 'dispose') {
        await expect(fixture.bridge.start('/another/root')).rejects.toThrow(
          'disposed',
        );
        expect(fixture.servers).toHaveLength(1);
        expect(fixture.processes).toHaveLength(1);
      }
      if (stage === 'waitForVite') {
        expect(fixture.clearInterval).toHaveBeenCalledOnce();
        expect(fixture.subscriptions).toHaveLength(4);
        for (const subscription of fixture.subscriptions) {
          expect(subscription.dispose).toHaveBeenCalledOnce();
        }
        expect(events?.end).toHaveBeenCalledOnce();
      } else {
        expect(fixture.clearInterval).not.toHaveBeenCalled();
        expect(fixture.subscriptions).toHaveLength(0);
      }

      fixture.releaseCleanup();
      await Promise.all([start, stopped]);

      expect(fixture.clipboard).not.toHaveBeenCalled();
      expect(
        fixture.diagnostics.filter(
          (event) => event.name === 'host.browser-dev.started',
        ),
      ).toHaveLength(0);
      expect(
        fixture.diagnostics.filter(
          (event) => event.name === 'host.browser-dev.start-failed',
        ),
      ).toHaveLength(0);
    },
  );

  it('serializes start-stop-start and ignores first-generation callbacks', async () => {
    const servers: EventEmitter[] = [];
    const processes: EventEmitter[] = [];
    const diagnostics: RuntimeDiagnosticEvent[] = [];
    const subscriptions: FakeDisposable[] = [];
    const firstClose = deferred<void>();
    const controller = {
      subscribe: vi.fn(() => {
        const value = disposable();
        subscriptions.push(value);
        return value;
      }),
    } as unknown as ChatController;
    const missionControl = {
      onDidChangeWorkspaceSetup: vi.fn(() => {
        const value = disposable();
        subscriptions.push(value);
        return value;
      }),
    } as unknown as MissionControlPanelController;
    const closeServer = vi.fn((server: Server) =>
      server === (servers[0] as unknown as Server)
        ? firstClose.promise
        : Promise.resolve(),
    );
    const stopProcess = vi.fn(() => Promise.resolve());
    const bridge = new BrowserDevBridge(
      controller,
      missionControl,
      { record: (event) => diagnostics.push(event) },
      {
        assertSourceRoot: async () => undefined,
        createToken: () => `token-${servers.length + 1}`,
        createServer: () => {
          const server = fakeServer();
          servers.push(server as unknown as EventEmitter);
          return server;
        },
        startVite: () => {
          const process = fakeProcess();
          processes.push(process as unknown as EventEmitter);
          return process;
        },
        listen: async () => 43_000 + servers.length,
        waitForVite: async () => undefined,
        closeServer,
        stopProcess,
        setInterval: () => ({}) as ReturnType<typeof setInterval>,
        clearInterval: vi.fn(),
        writeClipboard: vi.fn(async () => undefined),
        showInformationMessage: vi.fn(async () => undefined),
        onDidChangeConfiguration: vi.fn(() => disposable()),
        onDidChangeActiveColorTheme: vi.fn(() => disposable()),
      },
    );

    await bridge.start('/fake/droidvisx');
    await bridge.start('/fake/droidvisx');
    expect(servers).toHaveLength(1);
    expect(
      diagnostics.filter((event) => event.name === 'host.browser-dev.started'),
    ).toHaveLength(1);
    const firstStop = bridge.stop();
    const repeatedStop = bridge.stop();
    await vi.waitFor(() => expect(closeServer).toHaveBeenCalledOnce());

    const secondStart = bridge.start('/fake/droidvisx');
    await Promise.resolve();
    expect(servers).toHaveLength(1);

    firstClose.resolve();
    await Promise.all([firstStop, repeatedStop, secondStart]);
    expect(servers).toHaveLength(2);
    expect(processes).toHaveLength(2);
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(stopProcess).toHaveBeenCalledTimes(1);

    processes[0]?.emit('exit', 1);
    await Promise.resolve();
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(stopProcess).toHaveBeenCalledTimes(1);
    expect(
      diagnostics.filter(
        (event) => event.name === 'host.browser-dev.vite-exited',
      ),
    ).toHaveLength(0);
    expect(
      diagnostics.filter((event) => event.name === 'host.browser-dev.started'),
    ).toHaveLength(2);
    await bridge.start('/fake/droidvisx');
    expect(servers).toHaveLength(2);

    await bridge.stop();
    expect(closeServer).toHaveBeenCalledTimes(2);
    expect(stopProcess).toHaveBeenCalledTimes(2);
    expect(subscriptions).toHaveLength(4);
  });
});
