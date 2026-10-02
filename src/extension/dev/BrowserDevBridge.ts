import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  get as httpGet,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { HostToWebviewMessage } from '../../shared/bridgeMessages';
import type { ChatController } from '../chat/ChatController';
import type { MissionControlPanelController } from '../panels/mission/MissionControlPanelController';
import { resolveBrowserDevSourceRoot } from './browserDevSourceRoot';
import { routeWebviewMessage } from '../webview/webviewMessageRouter';
import { createWebviewStateDelivery } from '../webview/webviewStateDelivery';
import { createModelSourcePreference } from '../webview/modelSourcePreference';
import { MODEL_SOURCE_VERSION } from '../../shared/protocol/modelSourceProtocol';
import {
  readWebviewBootTheme,
  readWebviewThemePreference,
} from '../webview/webviewTheme';

const VITE_HOST = '127.0.0.1';
const VITE_PORT = 4173;
const VITE_ORIGIN = `http://${VITE_HOST}:${VITE_PORT}`;
const START_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const START_COMMAND = 'droidvisx.startBrowserDevClient';
const STOP_COMMAND = 'droidvisx.stopBrowserDevClient';

interface BrowserDevRun {
  readonly owner: BrowserDevGeneration;
  readonly bridge: Server;
  readonly vite: ChildProcess;
  readonly url: string;
  readonly subscriptions: readonly vscode.Disposable[];
  eventResponse: ServerResponse | null;
  keepAlive: ReturnType<typeof setInterval> | null;
  delivery: ReturnType<typeof createWebviewStateDelivery> | null;
  modelSourcePreference: ReturnType<typeof createModelSourcePreference> | null;
}

interface BrowserDevGeneration {
  readonly generation: number;
  readonly abort: AbortController;
  bridge: Server | null;
  vite: ChildProcess | null;
  run: BrowserDevRun | null;
  cleanup: Promise<void> | null;
}

interface BrowserDevStart {
  readonly owner: BrowserDevGeneration;
  readonly promise: Promise<void>;
}

export interface BrowserDevBridgeDependencies {
  readonly assertSourceRoot: (sourceRoot: string) => Promise<void>;
  readonly createToken: () => string;
  readonly createServer: () => Server;
  readonly startVite: (sourceRoot: string) => ChildProcess;
  readonly listen: (server: Server, signal: AbortSignal) => Promise<number>;
  readonly waitForVite: (
    process: ChildProcess,
    readError: () => string,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly closeServer: (server: Server) => Promise<void>;
  readonly stopProcess: (process: ChildProcess) => Promise<void>;
  readonly setInterval: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  readonly writeClipboard: (value: string) => Thenable<void>;
  readonly showInformationMessage: (message: string) => Thenable<unknown>;
  readonly onDidChangeConfiguration: (
    listener: (event: vscode.ConfigurationChangeEvent) => void,
  ) => vscode.Disposable;
  readonly onDidChangeActiveColorTheme: (listener: () => void) => vscode.Disposable;
}

const browserDevDependencies: BrowserDevBridgeDependencies = {
  assertSourceRoot,
  createToken: () => randomBytes(32).toString('base64url'),
  createServer,
  startVite,
  listen,
  waitForVite,
  closeServer,
  stopProcess,
  setInterval,
  clearInterval,
  writeClipboard: (value) => vscode.env.clipboard.writeText(value),
  showInformationMessage: (message) => vscode.window.showInformationMessage(message),
  onDidChangeConfiguration: (listener) =>
    vscode.workspace.onDidChangeConfiguration(listener),
  onDidChangeActiveColorTheme: (listener) =>
    vscode.window.onDidChangeActiveColorTheme(listener),
};

class BrowserDevStartupCancelledError extends Error {
  constructor() {
    super('Browser Dev startup was cancelled.');
  }
}

export class BrowserDevBridge implements vscode.Disposable {
  private run: BrowserDevRun | null = null;
  private active: BrowserDevGeneration | null = null;
  private starting: BrowserDevStart | null = null;
  private cleanup: Promise<void> | null = null;
  private nextGeneration = 0;
  private disposed = false;
  private readonly dependencies: BrowserDevBridgeDependencies;

  constructor(
    private readonly controller: ChatController,
    private readonly missionControl: MissionControlPanelController,
    private readonly diagnostics?: RuntimeDiagnosticSink,
    dependencies?: Partial<BrowserDevBridgeDependencies>,
    private readonly openModels?: () => void,
  ) {
    this.dependencies = {
      ...browserDevDependencies,
      ...dependencies,
    };
  }

  async start(sourceRoot: string): Promise<void> {
    if (this.disposed) {
      throw new Error('Browser Dev bridge is disposed.');
    }
    while (true) {
      const cleanup = this.cleanup;
      if (cleanup !== null) {
        await cleanup;
        continue;
      }
      if (this.disposed) {
        throw new Error('Browser Dev bridge is disposed.');
      }
      const run = this.run;
      if (run !== null) {
        await this.copyUrl(run.owner, run.url);
        return;
      }
      const starting = this.starting;
      if (starting !== null && this.isActive(starting.owner)) {
        await starting.promise;
        return;
      }
      const owner: BrowserDevGeneration = {
        generation: ++this.nextGeneration,
        abort: new AbortController(),
        bridge: null,
        vite: null,
        run: null,
        cleanup: null,
      };
      this.active = owner;
      const promise = this.startRun(owner, sourceRoot);
      const nextStart = { owner, promise };
      this.starting = nextStart;
      try {
        await promise;
        return;
      } finally {
        if (this.starting === nextStart) {
          this.starting = null;
        }
      }
    }
  }

  async stop(): Promise<void> {
    const owner = this.active;
    if (owner === null) {
      await this.cleanup;
      return;
    }
    const wasRunning = this.run?.owner === owner;
    await this.cancel(owner);
    if (wasRunning) {
      this.diagnostics?.record({
        level: 'info',
        name: 'host.browser-dev.stopped',
      });
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const owner = this.active;
    if (owner !== null) {
      void this.cancel(owner).catch((error: unknown) => {
        this.recordCleanupFailure(error);
      });
    }
  }

  private async startRun(owner: BrowserDevGeneration, sourceRoot: string): Promise<void> {
    try {
      await this.dependencies.assertSourceRoot(sourceRoot);
      this.requireActive(owner);
      const token = this.dependencies.createToken();
      const bridge = this.dependencies.createServer();
      owner.bridge = bridge;
      const vite = this.dependencies.startVite(sourceRoot);
      owner.vite = vite;
      let viteError = '';
      vite.stderr?.on('data', (chunk: Buffer) => {
        viteError = `${viteError}${chunk.toString('utf8')}`.slice(-2_048);
      });
      const bridgePort = await this.dependencies.listen(bridge, owner.abort.signal);
      this.requireActive(owner);
      const url =
        `${VITE_ORIGIN}/live#bridgePort=${bridgePort}` +
        `&token=${encodeURIComponent(token)}`;
      const subscriptions: vscode.Disposable[] = [];
      const run: BrowserDevRun = {
        owner,
        bridge,
        vite,
        url,
        subscriptions,
        eventResponse: null,
        keepAlive: null,
        delivery: null,
        modelSourcePreference: null,
      };
      run.modelSourcePreference = createModelSourcePreference({
        postMessage: async (message) => this.send(run, message),
      });
      subscriptions.push(run.modelSourcePreference);
      run.delivery = createWebviewStateDelivery({
        isCurrent: () => this.isActive(owner),
        isVisible: () => run.eventResponse !== null,
        postMessage: async (message) => this.send(run, message),
        replayTo: (listener) => this.controller.replayTo(listener),
        ...(this.diagnostics === undefined ? {} : { diagnostics: this.diagnostics }),
      });
      run.keepAlive = this.dependencies.setInterval(() => {
        run.eventResponse?.write(': keepalive\n\n');
      }, 15_000);
      owner.run = run;
      bridge.on('request', (request, response) => {
        this.handleRequest(run, token, request, response);
      });
      subscriptions.push(
        this.controller.subscribe((message) => {
          run.delivery?.post(message);
        }),
        this.missionControl.onDidChangeWorkspaceSetup((message) => {
          this.send(run, message);
        }),
        this.dependencies.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('droidvisx.theme')) {
            this.sendTheme(run);
          }
        }),
        this.dependencies.onDidChangeActiveColorTheme(() => {
          if (readWebviewThemePreference() === 'auto') {
            this.sendTheme(run);
          }
        }),
      );
      await this.dependencies.waitForVite(vite, () => viteError, owner.abort.signal);
      this.requireActive(owner);
      this.run = run;
      vite.once('exit', (code) => {
        if (this.run !== run || !this.isActive(owner)) {
          return;
        }
        this.diagnostics?.record({
          level: 'error',
          name: 'host.browser-dev.vite-exited',
          attributes: { code: code ?? -1 },
        });
        void this.cancel(owner).catch((error: unknown) => {
          this.recordCleanupFailure(error);
        });
        void vscode.window.showErrorMessage(
          'Droid browser dev client stopped because Vite exited.',
        );
      });
      if (!(await this.copyUrl(owner, url))) {
        throw new BrowserDevStartupCancelledError();
      }
      this.requireActive(owner);
      this.diagnostics?.record({
        level: 'info',
        name: 'host.browser-dev.started',
        attributes: { bridgePort, vitePort: VITE_PORT },
      });
    } catch (error) {
      const cancelled =
        error instanceof BrowserDevStartupCancelledError ||
        owner.abort.signal.aborted ||
        !this.isActive(owner);
      try {
        await this.cancel(owner);
      } catch (cleanupError) {
        this.recordCleanupFailure(cleanupError);
      }
      if (cancelled) {
        return;
      }
      this.diagnostics?.record({
        level: 'error',
        name: 'host.browser-dev.start-failed',
        detail: formatError(error),
      });
      throw error;
    }
  }

  private isActive(owner: BrowserDevGeneration): boolean {
    return (
      !this.disposed &&
      this.active?.generation === owner.generation &&
      !owner.abort.signal.aborted
    );
  }

  private requireActive(owner: BrowserDevGeneration): void {
    if (!this.isActive(owner)) {
      throw new BrowserDevStartupCancelledError();
    }
  }

  private cancel(owner: BrowserDevGeneration): Promise<void> {
    owner.abort.abort();
    if (this.active === owner) {
      this.active = null;
    }
    if (this.run?.owner === owner) {
      this.run = null;
    }
    if (owner.cleanup !== null) {
      return owner.cleanup;
    }
    let cleanup: Promise<void>;
    cleanup = this.disposeGeneration(owner).finally(() => {
      if (this.cleanup === cleanup) {
        this.cleanup = null;
      }
    });
    owner.cleanup = cleanup;
    this.cleanup = cleanup;
    return cleanup;
  }

  private async disposeGeneration(owner: BrowserDevGeneration): Promise<void> {
    const run = owner.run;
    owner.run = null;
    const bridge = owner.bridge;
    owner.bridge = null;
    const vite = owner.vite;
    owner.vite = null;
    if (run !== null) {
      await disposeRun(run, this.dependencies);
      return;
    }
    await settleBrowserDevCleanup([
      ...(bridge === null ? [] : [() => this.dependencies.closeServer(bridge)]),
      ...(vite === null ? [] : [() => this.dependencies.stopProcess(vite)]),
    ]);
  }

  private recordCleanupFailure(error: unknown): void {
    this.diagnostics?.record({
      level: 'error',
      name: 'host.browser-dev.cleanup-failed',
      detail: formatError(error),
    });
  }

  private async copyUrl(owner: BrowserDevGeneration, url: string): Promise<boolean> {
    if (!this.isActive(owner)) {
      return false;
    }
    await this.dependencies.writeClipboard(url);
    if (!this.isActive(owner)) {
      return false;
    }
    void this.dependencies.showInformationMessage(
      'Droid browser dev client URL copied to the clipboard.',
    );
    return true;
  }

  private handleRequest(
    run: BrowserDevRun,
    token: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const origin = request.headers.origin;
    if (origin !== VITE_ORIGIN) {
      respond(response, 403);
      return;
    }
    setCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      respond(response, 401);
      return;
    }
    if (request.method === 'GET' && request.url === '/events') {
      run.eventResponse?.end();
      response.writeHead(200, {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      response.write(': connected\n\n');
      run.eventResponse = response;
      run.delivery?.onVisible();
      request.on('close', () => {
        if (run.eventResponse === response) {
          run.eventResponse = null;
        }
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/message') {
      void readJson(request).then(
        (message) => {
          if (run.modelSourcePreference?.handleMessage(message)) {
            respond(response, 204);
            return;
          }
          routeWebviewMessage(message, {
            controller: this.controller,
            diagnostics: this.diagnostics,
            ...(this.openModels === undefined ? {} : { openModels: this.openModels }),
            missionWorkspace: {
              handleMessage: (value) => this.missionControl.handleWorkspaceMessage(value),
              replay: () => {
                this.missionControl.replayWorkspaceSetupTo((item) => {
                  this.send(run, item);
                });
              },
            },
            openMissionControl: (target, task) => {
              if (target === 'catalog') {
                this.missionControl.open();
              } else {
                this.missionControl.openMission(task);
              }
            },
            postTheme: () => {
              this.sendTheme(run);
            },
            onReady: (message) => {
              run.delivery?.onReady(message);
              run.modelSourcePreference?.handleMessage({ type: 'ui.modelSource.read', version: MODEL_SOURCE_VERSION });
            },
            onStateApplied: (message) => run.delivery?.onStateApplied(message),
          });
          respond(response, 204);
        },
        () => {
          respond(response, 400);
        },
      );
      return;
    }
    respond(response, 404);
  }

  private send(run: BrowserDevRun | null, message: unknown): boolean {
    if (run?.eventResponse === null || run?.eventResponse === undefined) {
      return false;
    }
    try {
      run.eventResponse.write(`data: ${JSON.stringify(message)}\n\n`);
      return true;
    } catch {
      run.eventResponse.end();
      run.eventResponse = null;
      return false;
    }
  }

  private sendTheme(run: BrowserDevRun | null): void {
    const theme = readWebviewBootTheme();
    this.send(run, {
      type: 'ui.theme',
      ...theme,
    } satisfies Extract<HostToWebviewMessage, { type: 'ui.theme' }>);
  }
}

export function registerBrowserDevCommands(
  bridge: BrowserDevBridge,
  readSourceRoot: () => string | null,
): readonly vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(START_COMMAND, async () => {
      const sourceRoot = readSourceRoot();
      if (sourceRoot === null) {
        void vscode.window.showErrorMessage(
          'Configure droidvisx.browserDev.sourceRoot to the Droid source repository.',
        );
        return;
      }
      try {
        await bridge.start(sourceRoot);
      } catch {
        void vscode.window.showErrorMessage(
          'Droid browser dev client failed to start. See Droid Logs.',
        );
      }
    }),
    vscode.commands.registerCommand(STOP_COMMAND, async () => {
      await bridge.stop();
    }),
  ];
}

export function readBrowserDevSourceRoot(
  context: vscode.ExtensionContext,
): string | null {
  return resolveBrowserDevSourceRoot(
    vscode.workspace.getConfiguration('droidvisx').get<string>('browserDev.sourceRoot'),
    context.extensionMode === vscode.ExtensionMode.Development
      ? context.extensionPath
      : null,
  );
}

async function assertSourceRoot(sourceRoot: string): Promise<void> {
  const packagePath = join(sourceRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    readonly name?: unknown;
  };
  if (packageJson.name !== 'droidvisx') {
    throw new Error(
      'The configured Browser Dev source directory is not the Droid repository.',
    );
  }
}

function startVite(sourceRoot: string): ChildProcess {
  // Keep the live Bridge origin; V2's standalone preview defaults to 4176.
  return spawn(
    process.execPath,
    [
      join(sourceRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config',
      join(sourceRoot, 'vite.webview-v2.config.ts'),
      '--host',
      VITE_HOST,
      '--port',
      String(VITE_PORT),
      '--strictPort',
    ],
    {
      cwd: sourceRoot,
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
}

function listen(server: Server, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error, port?: number): void => {
      if (finished) {
        return;
      }
      finished = true;
      server.off('error', fail);
      server.off('listening', ready);
      signal.removeEventListener('abort', cancelled);
      if (error === undefined) {
        resolve(port!);
      } else {
        reject(error);
      }
    };
    const fail = (error: Error): void => {
      finish(error);
    };
    const ready = (): void => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        finish(new Error('Browser dev bridge did not expose a TCP port.'));
        return;
      }
      finish(undefined, address.port);
    };
    const cancelled = (): void => {
      finish(new BrowserDevStartupCancelledError());
    };
    if (signal.aborted) {
      cancelled();
      return;
    }
    server.once('error', fail);
    server.once('listening', ready);
    signal.addEventListener('abort', cancelled, { once: true });
    try {
      server.listen(0, '127.0.0.1');
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function waitForVite(
  process: ChildProcess,
  readError: () => string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let request: ClientRequest | null = null;
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) {
        return;
      }
      finished = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      request?.destroy();
      process.off('exit', exited);
      process.off('error', failed);
      signal.removeEventListener('abort', cancelled);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const exited = (code: number | null): void => {
      const detail = readError().trim();
      finish(
        new Error(
          `Vite exited before startup (code ${code ?? -1}).` +
            (detail.length === 0 ? '' : ` ${detail}`),
        ),
      );
    };
    const failed = (error: Error): void => {
      finish(error);
    };
    const cancelled = (): void => {
      finish(new BrowserDevStartupCancelledError());
    };
    const probe = (): void => {
      if (finished) {
        return;
      }
      if (Date.now() - startedAt >= START_TIMEOUT_MS) {
        finish(new Error('Vite did not start within 15 seconds.'));
        return;
      }
      try {
        const probeRequest = httpGet(`${VITE_ORIGIN}/live`, (response) => {
          if (request === probeRequest) {
            request = null;
          }
          response.resume();
          if ((response.statusCode ?? 500) < 500) {
            finish();
          } else if (!finished) {
            timer = setTimeout(probe, 150);
          }
        });
        request = probeRequest;
        probeRequest.once('error', () => {
          if (request === probeRequest) {
            request = null;
          }
          if (!finished) {
            timer = setTimeout(probe, 150);
          }
        });
        probeRequest.setTimeout(1_000, () => {
          probeRequest.destroy();
        });
      } catch (error) {
        failed(error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (signal.aborted) {
      cancelled();
      return;
    }
    process.once('exit', exited);
    process.once('error', failed);
    signal.addEventListener('abort', cancelled, { once: true });
    probe();
  });
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        reject(new Error('Browser dev message exceeded the size limit.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function setCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', VITE_ORIGIN);
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Vary', 'Origin');
}

function respond(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end();
}

async function disposeRun(
  run: BrowserDevRun,
  dependencies: BrowserDevBridgeDependencies,
): Promise<void> {
  run.delivery?.dispose();
  run.delivery = null;
  await settleBrowserDevCleanup([
    () => {
      if (run.keepAlive !== null) {
        const timer = run.keepAlive;
        run.keepAlive = null;
        dependencies.clearInterval(timer);
      }
    },
    () => {
      const response = run.eventResponse;
      run.eventResponse = null;
      response?.end();
    },
    ...run.subscriptions.map((subscription) => () => subscription.dispose()),
    () => dependencies.closeServer(run.bridge),
    () => dependencies.stopProcess(run.vite),
  ]);
}

async function settleBrowserDevCleanup(
  cleanup: readonly (() => void | Promise<void>)[],
): Promise<void> {
  const results = await Promise.allSettled(
    cleanup.map((release) => Promise.resolve().then(release)),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure !== undefined) {
    throw failure.reason;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      resolve();
    }, 2_000);
    process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    process.kill();
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
