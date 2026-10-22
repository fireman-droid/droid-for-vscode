import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import { LocalDiagnostics } from '../diagnostics/LocalDiagnostics';
import { projectFrontendEvent } from './projectFrontendEvent';

export const LOCAL_ANALYTICS_DIRECTORY = 'local-analytics';

/** A separate structured local log. This class has no network transport or remote identifiers. */
export class LocalFrontendAnalytics {
  private enabled = true;
  private readonly log: LocalDiagnostics;

  constructor(options: Pick<ConstructorParameters<typeof LocalDiagnostics>[0], 'directory' | 'output' | 'now'>) {
    this.log = new LocalDiagnostics({ ...options, maxTotalBytes: 16 * 1024 * 1024 });
  }

  configure(enabled: boolean): void { this.enabled = enabled; }

  record(event: RuntimeDiagnosticEvent): void {
    if (!this.enabled) return;
    const projected = projectFrontendEvent(event);
    if (projected) this.log.record({ level: projected.name === 'frontend.error' ? 'warn' : 'info', ...projected });
  }

  get directory(): string { return this.log.directory; }
  get filePath(): string { return this.log.filePath; }
  show(): void { this.log.show(); }
  flush(): Promise<void> { return this.log.flush(); }
  dispose(): void { this.enabled = false; this.log.dispose(); }
}
