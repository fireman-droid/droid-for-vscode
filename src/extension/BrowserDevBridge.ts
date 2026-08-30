import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  get as httpGet,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import type { HostToWebviewMessage } from '../shared/bridgeMessages';
import type { ChatController } from './ChatController';
import type { MissionControlPanelController } from './MissionControlPanelController';
import { resolveBrowserDevSourceRoot } from './browserDevSourceRoot';
import { routeWebviewMessage } from './webviewMessageRouter';
import {
  readWebviewBootTheme,
  readWebviewThemePreference,
} from './webviewTheme';

const VITE_HOST = '127.0.0.1';
const VITE_PORT = 4173;
const VITE_ORIGIN = `http://${VITE_HOST}:${VITE_PORT}`;
const START_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const START_COMMAND = 'droidvisx.startBrowserDevClient';
const STOP_COMMAND = 'droidvisx.stopBrowserDevClient';

interface BrowserDevRun {
  readonly bridge: Server;
  readonly vite: ChildProcess;
  readonly url: string;
  readonly subscriptions: readonly vscode.Disposable[];
  eventResponse: ServerResponse | null;
  keepAlive: ReturnType<typeof setInterval>;
  stopping: boolean;
}

export class BrowserDevBridge implements vscode.Disposable {
  private run: BrowserDevRun | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly controller: ChatController,
    private readonly missionControl: MissionControlPanelController,
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {}

  async start(sourceRoot: string): Promise<void> {
    if (this.run !== null) {
      await this.copyUrl(this.run.url);
      return;
    }
    if (this.starting !== null) {
      await this.starting;
      return;
    }
    const starting = this.startRun(sourceRoot);
    this.starting = starting;
    try {
      await starting;
    } finally {
      if (this.starting === starting) {
        this.starting = null;
      }
    }
  }

  async stop(): Promise<void> {
    const run = this.run;
    this.run = null;
    if (run === null || run.stopping) {
      return;
    }
    run.stopping = true;
    clearInterval(run.keepAlive);
    run.eventResponse?.end();
    for (const subscription of run.subscriptions) {
      subscription.dispose();
    }
    await Promise.all([
      closeServer(run.bridge),
      stopProcess(run.vite),
    ]);
    this.diagnostics?.record({
      level: 'info',
      name: 'host.browser-dev.stopped',
    });
  }

  dispose(): void {
    void this.stop();
  }

  private async startRun(sourceRoot: string): Promise<void> {
    await assertSourceRoot(sourceRoot);
    const token = randomBytes(32).toString('base64url');
    const bridge = createServer();
    const vite = startVite(sourceRoot);
    let viteError = '';
    vite.stderr?.on('data', (chunk: Buffer) => {
      viteError = `${viteError}${chunk.toString('utf8')}`.slice(-2_048);
    });
    const subscriptions: vscode.Disposable[] = [];
    let run: BrowserDevRun | null = null;

    try {
      const bridgePort = await listen(bridge);
      const url =
        `${VITE_ORIGIN}/live#bridgePort=${bridgePort}` +
        `&token=${encodeURIComponent(token)}`;
      run = {
        bridge,
        vite,
        url,
        subscriptions,
        eventResponse: null,
        keepAlive: setInterval(() => {
          run?.eventResponse?.write(': keepalive\n\n');
        }, 15_000),
        stopping: false,
      };
      bridge.on('request', (request, response) => {
        if (run !== null) {
          this.handleRequest(run, token, request, response);
        }
      });
      subscriptions.push(
        this.controller.subscribe((message) => {
          this.send(run, message);
        }),
        this.missionControl.onDidChangeWorkspaceSetup((message) => {
          this.send(run, message);
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('droidvisx.theme')) {
            this.sendTheme(run);
          }
        }),
        vscode.window.onDidChangeActiveColorTheme(() => {
          if (readWebviewThemePreference() === 'auto') {
            this.sendTheme(run);
          }
        }),
      );
      await waitForVite(vite, () => viteError);
      this.run = run;
      vite.once('exit', (code) => {
        const exitedRun = run;
        if (
          exitedRun === null ||
          this.run !== exitedRun ||
          exitedRun.stopping
        ) {
          return;
        }
        this.diagnostics?.record({
          level: 'error',
          name: 'host.browser-dev.vite-exited',
          attributes: { code: code ?? -1 },
        });
        this.run = null;
        void disposeRun(exitedRun);
        void vscode.window.showErrorMessage(
          'DroidVisX browser dev client stopped because Vite exited.',
        );
      });
      await this.copyUrl(url);
      this.diagnostics?.record({
        level: 'info',
        name: 'host.browser-dev.started',
        attributes: { bridgePort, vitePort: VITE_PORT },
      });
    } catch (error) {
      if (this.run === run) {
        this.run = null;
      }
      if (run === null) {
        await Promise.all([
          closeServer(bridge),
          stopProcess(vite),
        ]);
      } else {
        await disposeRun(run);
      }
      this.diagnostics?.record({
        level: 'error',
        name: 'host.browser-dev.start-failed',
        detail: formatError(error),
      });
      throw error;
    }
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
          routeWebviewMessage(message, {
            controller: this.controller,
            diagnostics: this.diagnostics,
            missionWorkspace: {
              handleMessage: (value) =>
                this.missionControl.handleWorkspaceMessage(value),
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
            onReady: () => {
              void this.controller.replayTo((item) => {
                this.send(run, item);
              });
            },
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

  private send(
    run: BrowserDevRun | null,
    message: unknown,
  ): void {
    if (run?.eventResponse === null || run?.eventResponse === undefined) {
      return;
    }
    try {
      run.eventResponse.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch {
      run.eventResponse.end();
      run.eventResponse = null;
    }
  }

  private sendTheme(run: BrowserDevRun | null): void {
    const theme = readWebviewBootTheme();
    this.send(run, {
      type: 'ui.theme',
      ...theme,
    } satisfies Extract<HostToWebviewMessage, { type: 'ui.theme' }>);
  }

  private async copyUrl(url: string): Promise<void> {
    await vscode.env.clipboard.writeText(url);
    void vscode.window.showInformationMessage(
      'DroidVisX browser dev client URL copied to the clipboard.',
    );
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
          'Configure droidvisx.browserDev.sourceRoot to the DroidVisX source repository.',
        );
        return;
      }
      try {
        await bridge.start(sourceRoot);
      } catch {
        void vscode.window.showErrorMessage(
          'DroidVisX browser dev client failed to start. See DroidVisX Logs.',
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
    vscode.workspace
      .getConfiguration('droidvisx')
      .get<string>('browserDev.sourceRoot'),
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
      'The configured Browser Dev source directory is not the DroidVisX repository.',
    );
  }
}

function startVite(sourceRoot: string): ChildProcess {
  return spawn(
    process.execPath,
    [
      join(sourceRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config',
      join(sourceRoot, 'vite.webview.config.ts'),
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

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => {
      server.off('listening', ready);
      reject(error);
    };
    const ready = (): void => {
      server.off('error', fail);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Browser dev bridge did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', fail);
    server.once('listening', ready);
    server.listen(0, '127.0.0.1');
  });
}

function waitForVite(
  process: ChildProcess,
  readError: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      process.off('exit', exited);
      process.off('error', failed);
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
    const probe = (): void => {
      if (Date.now() - startedAt >= START_TIMEOUT_MS) {
        finish(new Error('Vite did not start within 15 seconds.'));
        return;
      }
      const request = httpGet(`${VITE_ORIGIN}/live`, (response) => {
        response.resume();
        if ((response.statusCode ?? 500) < 500) {
          finish();
        } else {
          timer = setTimeout(probe, 150);
        }
      });
      request.once('error', () => {
        timer = setTimeout(probe, 150);
      });
      request.setTimeout(1_000, () => {
        request.destroy();
      });
    };
    process.once('exit', exited);
    process.once('error', failed);
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

async function disposeRun(run: BrowserDevRun): Promise<void> {
  if (run.stopping) {
    return;
  }
  run.stopping = true;
  clearInterval(run.keepAlive);
  run.eventResponse?.end();
  for (const subscription of run.subscriptions) {
    subscription.dispose();
  }
  await Promise.all([
    closeServer(run.bridge),
    stopProcess(run.vite),
  ]);
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
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
