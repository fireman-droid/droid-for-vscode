import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import { LocalDiagnostics } from '../diagnostics/LocalDiagnostics';
import type { Ga4RelayReporter } from './Ga4RelayReporter';
import { projectFrontendEvent } from './projectFrontendEvent';

export const LOCAL_ANALYTICS_DIRECTORY = 'local-analytics';

export class LocalFrontendAnalytics {
  private enabled = true;
  private readonly log: LocalDiagnostics;
  private readonly relay?: Ga4RelayReporter;

  constructor(
    options: Pick<ConstructorParameters<typeof LocalDiagnostics>[0], 'directory' | 'output' | 'now'> & {
      readonly relay?: Ga4RelayReporter;
    },
  ) {
    this.log = new LocalDiagnostics({ ...options, maxTotalBytes: 16 * 1024 * 1024 });
    this.relay = options.relay;
  }

  configure(enabled: boolean): void { this.enabled = enabled; }

  record(event: RuntimeDiagnosticEvent): void {
    this.relay?.record(event);
    if (!this.enabled) return;
    const projected = projectFrontendEvent(event);
    if (projected) this.log.record({ level: projected.name === 'frontend.error' ? 'warn' : 'info', ...projected });
  }

  get directory(): string { return this.log.directory; }
  get filePath(): string { return this.log.filePath; }
  show(): void { this.log.show(); }
  async flush(): Promise<void> {
    await Promise.all([this.log.flush(), this.relay?.flush()]);
  }
  dispose(): void {
    this.enabled = false;
    this.relay?.dispose();
    this.log.dispose();
  }
}
