import type { ServerResponse } from 'node:http';
import * as vscode from 'vscode';
import { ManagementBinding, type ManagementServices } from '../management/ManagementBinding';
import type { ModelManager } from '../models/ModelManager';
import { ModelsBinding } from '../models/ModelsBinding';

/** A separate stream keeps the management page from replacing a live chat connection. */
export class BrowserManagementChannel implements vscode.Disposable {
  private response: ServerResponse | null = null;
  private readonly receive = new vscode.EventEmitter<unknown>();
  private readonly bindings: readonly vscode.Disposable[];
  constructor(services: ManagementServices, manager: ModelManager) {
    const port = {
      onDidReceiveMessage: this.receive.event,
      postMessage: async (message: unknown) => this.post(message),
    };
    this.bindings = [new ManagementBinding(port, services, 'missions'), new ModelsBinding(port, manager)];
  }
  connect(response: ServerResponse): void {
    this.response?.end();
    this.response = response;
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    });
    response.write(': connected\n\n');
    response.on('close', () => { if (this.response === response) this.response = null; });
  }
  handleMessage(value: unknown): void { this.receive.fire(value); }
  keepAlive(): void { this.response?.write(': keepalive\n\n'); }
  private post(message: unknown): boolean {
    if (!this.response || this.response.destroyed) return false;
    return this.response.write(`data: ${JSON.stringify(message)}\n\n`);
  }
  dispose(): void {
    for (const binding of this.bindings) binding.dispose();
    this.receive.dispose();
    this.response?.end();
    this.response = null;
  }
}
