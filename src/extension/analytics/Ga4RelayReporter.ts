import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import {
  type Ga4EnvironmentMetadata,
  type Ga4RelayBatchPayload,
  hashAnonymousClientId,
  normalizeRelayEndpoint,
  projectGa4Event,
} from './ga4Config';

export interface Ga4RelayReporterOptions {
  readonly metadata: Ga4EnvironmentMetadata;
  readonly enabled?: boolean;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class Ga4RelayReporter {
  private enabled: boolean;
  private endpoint: string | null;
  private disposed = false;
  private readonly clientId: string;
  private readonly metadata: Ga4EnvironmentMetadata;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly pending = new Set<Promise<void>>();

  constructor(options: Ga4RelayReporterOptions) {
    this.metadata = options.metadata;
    this.clientId = hashAnonymousClientId(options.metadata.machineId);
    this.enabled = options.enabled ?? true;
    this.endpoint = normalizeRelayEndpoint(options.endpoint);
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  configure(options: { enabled: boolean; endpoint?: string }): void {
    this.enabled = options.enabled;
    this.endpoint = normalizeRelayEndpoint(options.endpoint);
  }

  record(event: RuntimeDiagnosticEvent): void {
    if (this.disposed || !this.enabled || !this.endpoint) return;
    const ga4Event = projectGa4Event(event, this.metadata);
    if (!ga4Event) return;

    const payload: Ga4RelayBatchPayload = {
      client_id: this.clientId,
      events: [ga4Event],
    };
    const targetUrl = this.endpoint;
    const task = this.send(targetUrl, payload).finally(() => {
      this.pending.delete(task);
    });
    this.pending.add(task);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
  }

  private async send(url: string, payload: Ga4RelayBatchPayload): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      // Telemetry relay failures must always be silent and never affect editor behavior.
    } finally {
      clearTimeout(timer);
    }
  }
}
