import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { parseWebviewDiagnostic } from '../../shared/validation/shell';
import { isStrictRecord } from '../../shared/validation/strictValidation';

type Surface = 'models' | 'management' | 'review' | 'sessionViewer' | 'missionControl';
export const WEBVIEW_HANDSHAKE_TIMEOUT_MS = 15_000;

export function recordWebviewDiagnostic(value: unknown, surface: Surface, diagnostics?: RuntimeDiagnosticSink): boolean {
  const message = isStrictRecord(value) && value.type === 'webview.diagnostic' ? parseWebviewDiagnostic(value) : undefined;
  if (!message) return false;
  try {
    diagnostics?.record({ level: message.kind === 'boot-ok' || message.kind === 'render-ok' ? 'info' : 'warn',
      name: `${surface}.${message.kind}`, detail: message.detail });
  } catch { /* Diagnostics must not interrupt the message router. */ }
  return true;
}

/** One owner per webview, cleared by its validated ready request or disposal. */
export class WebviewStartupDiagnostics {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly surface: Surface, private readonly diagnostics?: RuntimeDiagnosticSink, watchStartup = true) {
    if (diagnostics && watchStartup) this.timer = setTimeout(() => {
      this.timer = undefined;
      recordWebviewDiagnostic({ type: 'webview.diagnostic', kind: 'handshake-timeout',
        detail: 'No ready request received within 15s.' }, surface, diagnostics);
    }, WEBVIEW_HANDSHAKE_TIMEOUT_MS);
  }
  handle(value: unknown): boolean { return recordWebviewDiagnostic(value, this.surface, this.diagnostics); }
  ready(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  dispose(): void { this.ready(); }
}
