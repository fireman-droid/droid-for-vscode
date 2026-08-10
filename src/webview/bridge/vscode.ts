import {
  BRIDGE_PROTOCOL_VERSION,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { isStrictRecord } from '../../shared/strictValidation';

export { readHostMessage } from './validateHostMessage';

export interface PersistedWebviewState {
  readonly draft?: string;
}

interface VsCodeApi {
  getState(): unknown;
  postMessage(message: WebviewToHostMessage): void;
  setState(state: PersistedWebviewState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  api ??= acquireVsCodeApi();
  return api;
}

export function restoreDraft(vscode: VsCodeApi): string {
  const state = vscode.getState();
  if (!isStrictRecord(state) || typeof state.draft !== 'string') {
    return '';
  }

  return state.draft;
}

export function persistDraft(vscode: VsCodeApi, draft: string): void {
  vscode.setState({ draft });
}

export function announceReady(vscode: VsCodeApi): void {
  vscode.postMessage({
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
  });
}
