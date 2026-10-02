import {
  BRIDGE_PROTOCOL_VERSION,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import type { AgentChatCommand } from '../../shared/protocol/agentChatProtocol';

export { readHostMessage } from './validateHostMessage';

export interface PersistedWebviewState {
  readonly draft?: string;
}

interface VsCodeApi {
  getState(): unknown;
  postMessage(message: WebviewToHostMessage | AgentChatCommand): void;
  setState(state: PersistedWebviewState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare const __DVX_BUILD_ID__: string | undefined;

/** Build id stamped by esbuild; 'dev' under tests and harnesses. */
export const WEBVIEW_BUILD_ID =
  typeof __DVX_BUILD_ID__ === 'string' ? __DVX_BUILD_ID__ : 'dev';

let api: VsCodeApi | undefined;
const pageIds = new WeakMap<object, string>();

export function getWebviewPageId(vscode: object): string {
  let id = pageIds.get(vscode);
  if (id === undefined) { id = crypto.randomUUID(); pageIds.set(vscode, id); }
  return id;
}

export function getVsCodeApi(): VsCodeApi {
  // The boot beacon script in the webview HTML acquires the API first
  // (it can only be acquired once per page) and shares it here.
  api ??= (globalThis as { __dvxApi?: VsCodeApi }).__dvxApi ?? acquireVsCodeApi();
  return api;
}

/**
 * Marks the bundle as booted for the HTML watchdog and reports the
 * running build so a stale cached bundle is visible in the logs.
 * `bootMs` measures timeOrigin -> bundle mount (P1).
 */
export function announceBooted(vscode: VsCodeApi): void {
  (globalThis as { __dvxBooted?: boolean }).__dvxBooted = true;
  vscode.postMessage({
    type: 'webview.diagnostic',
    kind: 'boot-ok',
    detail: `build ${WEBVIEW_BUILD_ID} bootMs ${Math.round(performance.now())}`,
  });
}

/**
 * Reports that the first non-empty transcript committed to the DOM.
 * `renderMs` measures timeOrigin -> first non-empty commit (P1).
 */
export function announceRendered(vscode: VsCodeApi, itemCount: number): void {
  vscode.postMessage({
    type: 'webview.diagnostic',
    kind: 'render-ok',
    detail: `items ${itemCount} renderMs ${Math.round(performance.now())}`,
  });
}

/**
 * Reports that no host message at all arrived within the handshake
 * window after `webview.ready` — the signature of a stale in-memory
 * host rejecting a newer bundle's protocol version after a VSIX
 * overwrite install (`host.bridge.protocol-mismatch` on the host
 * side). Best effort: a stale host also rejects this beacon, but it
 * still surfaces in its `host.bridge.rejected` log.
 */
export function announceHandshakeTimeout(vscode: VsCodeApi, waitedMs: number): void {
  vscode.postMessage({
    type: 'webview.diagnostic',
    kind: 'handshake-timeout',
    detail: `no host message within ${waitedMs}ms of webview.ready (protocol ${BRIDGE_PROTOCOL_VERSION})`,
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
    pageId: getWebviewPageId(vscode),
  });
}
