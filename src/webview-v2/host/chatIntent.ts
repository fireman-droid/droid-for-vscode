import type { WebviewToHostMessage } from '../../shared/bridgeMessages';
import type { getVsCodeApi } from '../bridge/vscode';

export type ChatPort = ReturnType<typeof getVsCodeApi>;

export function post(port: ChatPort, message: WebviewToHostMessage): void {
  port.postMessage(message);
}

export function createTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
