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

declare const __DVX_BUILD_ID__: string | undefined;

/** Build id stamped by esbuild; 'dev' under tests and harnesses. */
export const WEBVIEW_BUILD_ID =
  typeof __DVX_BUILD_ID__ === 'string' ? __DVX_BUILD_ID__ : 'dev';

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  // The boot beacon script in the webview HTML acquires the API first
  // (it can only be acquired once per page) and shares it here.
  api ??=
    (globalThis as { __dvxApi?: VsCodeApi }).__dvxApi ??
    acquireVsCodeApi();
  return api;
}

/**
 * Marks the bundle as booted for the HTML watchdog and reports the
 * running build so a stale cached bundle is visible in the logs.
 */
export function announceBooted(vscode: VsCodeApi): void {
  (globalThis as { __dvxBooted?: boolean }).__dvxBooted = true;
  vscode.postMessage({
    type: 'webview.diagnostic',
    kind: 'boot-ok',
    detail: `build ${WEBVIEW_BUILD_ID}`,
  });
}

/** Reports that the first non-empty transcript committed to the DOM. */
export function announceRendered(
  vscode: VsCodeApi,
  itemCount: number,
): void {
  vscode.postMessage({
    type: 'webview.diagnostic',
    kind: 'render-ok',
    detail: `items ${itemCount}`,
  });
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
