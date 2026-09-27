import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { DaemonApi } from '../../runtime/daemon/api';
import type { ChatController } from '../chat/ChatController';
import { readModelApplyState } from '../models/modelChatApply';
import { ManagementError } from '../management/managementUi';

export type DroidTerminalInfo = Awaited<ReturnType<DaemonApi['terminals']['list']>>[number];

export class DaemonTerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, DaemonTerminal>();
  constructor(private readonly controller: ChatController) {}

  open(droid: DaemonApi, existing?: DroidTerminalInfo): void {
    const state = this.controller.sessionState;
    const sessionId = state.sessionId, cwd = state.activeRuntimeCwd, generation = state.runtimeGeneration;
    if (sessionId === null || cwd === null || !vscode.workspace.isTrusted || !readModelApplyState(this.controller).canApply)
      throw new ManagementError('Connect an idle chat in a trusted workspace before opening a Droid terminal.');
    const terminalId = existing?.id ?? `droidvisx-${randomUUID()}`;
    const key = `${sessionId}:${terminalId}`;
    const opened = this.terminals.get(key);
    if (opened) { opened.show(); return; }
    const current = () => !this.controller.sessionState.disposed && vscode.workspace.isTrusted &&
      this.controller.sessionState.sessionId === sessionId && this.controller.sessionState.runtimeGeneration === generation &&
      this.controller.sessionState.activeRuntimeCwd === cwd && this.controller.sessionState.workspaceContext.cwd === cwd &&
      this.controller.sessionState.connection.status === 'connected';
    const terminal = new DaemonTerminal({
      droid, sessionId, terminalId, cwd, existing, current,
      subscribe: (listener) => this.controller.subscribe(listener),
      onClosed: () => { if (this.terminals.get(key) === terminal) this.terminals.delete(key); },
    });
    this.terminals.set(key, terminal);
    terminal.show();
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) terminal.dispose();
    this.terminals.clear();
  }
}

interface TerminalOptions {
  readonly droid: DaemonApi;
  readonly sessionId: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly existing?: DroidTerminalInfo;
  readonly current: () => boolean;
  readonly subscribe: (listener: () => void) => vscode.Disposable;
  readonly onClosed: () => void;
}

class DaemonTerminal implements vscode.Pseudoterminal {
  private readonly output = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.output.event;
  private readonly exit = new vscode.EventEmitter<number | void>();
  readonly onDidClose = this.exit.event;
  private readonly terminal: vscode.Terminal;
  private unsubscribe: (() => void) | undefined;
  private ownerSubscription: vscode.Disposable | undefined;
  private ready = false;
  private closed = false;
  private opened = false;
  private pendingOutput = '';
  private outputDropped = false;
  private queuedInput = 0;
  private inputQueue = Promise.resolve();
  private inputPaused = false;
  private dimensions: vscode.TerminalDimensions | undefined;
  private resizing = false;

  constructor(private readonly options: TerminalOptions) {
    this.terminal = vscode.window.createTerminal({ name: 'Droid: interactive shell', pty: this, isTransient: true });
  }

  show(): void { this.terminal.show(); }

  open(dimensions?: vscode.TerminalDimensions): void {
    if (this.closed) return;
    this.opened = true;
    this.dimensions = dimensions;
    this.note('Interactive Droid session terminal. Input runs in its shell, not through model approval.');
    this.note('Closing this editor terminal detaches only. Use Droid session terminals to explicitly close the daemon shell.');
    void this.start();
  }

  private listen(): void {
    const o = this.options;
    this.unsubscribe = o.droid.notifications.subscribeTerminal((event) => {
      if (event.type === 'disconnected') { this.stop('Droid disconnected. Reopen the terminal from runtime management.'); return; }
      if (event.sessionId !== o.sessionId || event.terminalId !== o.terminalId || this.closed) return;
      if (!o.current()) { this.stop('Chat or workspace changed. The daemon shell was not closed.'); return; }
      if (event.type === 'exit') {
        this.note(`Droid terminal exited with code ${event.exitCode}.`);
        this.stop(undefined, event.exitCode);
      } else if (!this.ready) {
        const text = this.pendingOutput + event.data;
        this.outputDropped ||= text.length > 262_144;
        this.pendingOutput = text.slice(-262_144);
      } else this.output.fire(event.data);
    });
    this.ownerSubscription = o.subscribe(() => {
      if (!o.current()) this.stop('Chat or workspace changed. The daemon shell was not closed.');
    });
  }

  private async start(): Promise<void> {
    const o = this.options;
    try {
      if (!o.current()) throw new Error('unavailable');
      this.listen();
      if (o.existing) {
        const fresh = (await o.droid.terminals.list(o.sessionId, {})).find((item) => item.id === o.terminalId);
        if (!fresh || fresh.pid !== o.existing.pid || fresh.createdAt.getTime() !== o.existing.createdAt.getTime())
          throw new Error('terminal changed');
        this.note('Live output only. Earlier shell output is not replayed.');
      } else {
        const result = await o.droid.terminals.create(o.sessionId, {
          terminalId: o.terminalId, cwd: o.cwd, cols: this.dimensions?.columns ?? 80, rows: this.dimensions?.rows ?? 24,
        });
        if (!result.success) throw new Error('creation not confirmed');
      }
      if (this.closed) return;
      if (!o.current()) { this.stop('Chat changed during terminal opening. Refresh the terminal list to inspect the daemon shell.'); return; }
      this.ready = true;
      this.note('Terminal connected. Input is sent directly to this shell.');
      if (this.outputDropped) this.note('Some startup output exceeded the local buffer and was omitted.');
      this.output.fire(this.pendingOutput);
      this.pendingOutput = '';
      void this.resize();
    } catch {
      if (!this.closed) this.stop('Droid could not confirm terminal opening. Refresh the daemon terminal list before retrying.');
    }
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (!this.ready) {
      if (!this.inputPaused) this.note('Terminal is still opening. Input was not sent; retry when it is ready.');
      this.inputPaused = true;
      return;
    }
    if (!this.options.current()) { this.stop('Chat or workspace changed. Input was not sent.'); return; }
    this.inputPaused = false;
    if (this.queuedInput + data.length > 65_536) {
      this.note('Input not sent: the terminal input queue is full. Wait before retrying this input.');
      return;
    }
    this.queuedInput += data.length;
    this.inputQueue = this.inputQueue.then(async () => {
      try {
        if (this.closed) return;
        if (!this.options.current()) { this.stop('Queued input was not sent because the chat or workspace changed.'); return; }
        const result = await this.options.droid.terminals.write(this.options.sessionId, { terminalId: this.options.terminalId, data });
        if (!result.success) this.stop('Droid did not confirm terminal input. It was not retried; reopen and inspect the shell before continuing.');
      } catch {
        this.stop('Terminal input could not be confirmed. It was not retried; inspect the shell before repeating a command.');
      } finally { this.queuedInput -= data.length; }
    });
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.dimensions = dimensions;
    void this.resize();
  }

  private async resize(): Promise<void> {
    if (this.resizing || !this.ready || this.closed) return;
    this.resizing = true;
    try {
      while (this.dimensions && !this.closed) {
        const size = this.dimensions;
        this.dimensions = undefined;
        if (!this.options.current()) { this.stop('Chat or workspace changed. Reopen the terminal from runtime management.'); return; }
        const result = await this.options.droid.terminals.resize(this.options.sessionId, {
          terminalId: this.options.terminalId, cols: size.columns, rows: size.rows,
        });
        if (!result.success) { this.stop('Droid did not confirm terminal resizing. Reopen the terminal from runtime management.'); return; }
      }
    } catch {
      this.stop('Droid terminal connection failed. The daemon shell was not explicitly closed.');
    } finally { this.resizing = false; }
  }

  private note(text: string): void {
    if (this.opened && !this.closed) this.output.fire(`\r\n\x1b[2m[Droid] ${text}\x1b[0m\r\n`);
  }

  private stop(message?: string, code?: number): void {
    if (this.closed) return;
    if (message) this.note(message);
    this.closed = true;
    this.ready = false;
    this.pendingOutput = '';
    this.unsubscribe?.();
    this.ownerSubscription?.dispose();
    this.options.onClosed();
    this.exit.fire(code);
    this.output.dispose();
    this.exit.dispose();
  }

  close(): void { this.stop(); }
  dispose(): void { this.stop(); this.terminal.dispose(); }
}
