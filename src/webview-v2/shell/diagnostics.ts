import type { WebviewDiagnosticKind } from '../../shared/protocol/transcript';

let cancelHandshake: (() => void) | undefined;
const HANDSHAKE_TIMEOUT_MS = 15_000;

/** Covers a mounted bundle whose ready/refresh request receives no valid host reply. */
export function watchWebviewHandshake(isHostMessage: (value: unknown) => boolean): () => void {
  cancelHandshake?.();
  const dispose = () => {
    clearTimeout(timer);
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', dispose);
    if (cancelHandshake === dispose) cancelHandshake = undefined;
  };
  const receive = (event: MessageEvent<unknown>) => { if (isHostMessage(event.data)) dispose(); };
  const timer = setTimeout(() => {
    dispose();
    const port = (globalThis as { __dvxApi?: { postMessage(message: unknown): void } }).__dvxApi;
    if (port) postWebviewDiagnostic(port, 'handshake-timeout', 'No valid host reply received within 15s.');
  }, HANDSHAKE_TIMEOUT_MS);
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', dispose, { once: true });
  cancelHandshake = dispose;
  return dispose;
}

export function postWebviewDiagnostic(port: { postMessage(message: unknown): void }, kind: WebviewDiagnosticKind, detail: string): void {
  port.postMessage({ type: 'webview.diagnostic', kind, detail: detail.slice(0, 2048) });
}

/** React catches these errors, so the global error listener cannot report them. */
export function reportWebviewRenderError(detail: string): void {
  cancelHandshake?.();
  console.error(detail);
  const global = globalThis as { __dvxBeacon?: (kind: string, detail: string) => void;
    __dvxApi?: { postMessage(message: unknown): void } };
  if (global.__dvxBeacon) global.__dvxBeacon('error', detail.slice(0, 2048));
  else if (global.__dvxApi) postWebviewDiagnostic(global.__dvxApi, 'error', detail);
}
