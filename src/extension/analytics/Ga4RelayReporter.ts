import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import {
  type Ga4EnvironmentMetadata, type Ga4EventPayload, type Ga4RelayBatchPayload,
  hashAnonymousClientId, normalizeRelayEndpoint, projectGa4Event,
} from './ga4Config';

export interface Ga4RelayReporterOptions {
  readonly metadata: Ga4EnvironmentMetadata;
  readonly enabled?: boolean;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Local-only delivery accounting. Never receives payloads, URLs or error prose. */
  readonly onDelivery?: (event: RuntimeDiagnosticEvent) => void;
}

const MAX_QUEUE = 250;
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 250;
const RETRY_DELAYS_MS = [250, 1000];
type Delivery = { ok: boolean; retryable: boolean; reason: string; status?: number };

/** Bounded, best-effort delivery. Retries may duplicate an accepted request whose response was lost. */
export class Ga4RelayReporter {
  private enabled: boolean;
  private endpoint: string | null;
  private disposed = false;
  private readonly clientId: string;
  private readonly queue: Ga4EventPayload[] = [];
  private running?: Promise<void>;
  private controller?: AbortController;
  private batchTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private wakeRetry?: () => void;
  private generation = 0;
  private overflow = 0;

  constructor(private readonly options: Ga4RelayReporterOptions) {
    this.clientId = hashAnonymousClientId(options.metadata.machineId);
    this.enabled = options.enabled ?? true;
    this.endpoint = normalizeRelayEndpoint(options.endpoint);
  }

  configure(options: { enabled: boolean; endpoint?: string }): void {
    const endpoint = normalizeRelayEndpoint(options.endpoint);
    if (!options.enabled || endpoint !== this.endpoint) this.cancelPending('configuration-changed');
    this.enabled = options.enabled;
    this.endpoint = endpoint;
  }

  record(event: RuntimeDiagnosticEvent): void {
    if (this.disposed || !this.enabled || !this.endpoint) return;
    const projected = projectGa4Event(event, this.options.metadata);
    if (!projected) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.overflow++;
      return;
    }
    this.queue.push(projected);
    this.schedule();
  }

  /** Drain promptly, but never keep editor shutdown waiting indefinitely. */
  async flush(timeoutMs = 1500): Promise<void> {
    this.start();
    if (!this.running) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.running,
        new Promise<void>(resolve => {
          timer = setTimeout(() => { this.cancelPending('flush-timeout'); resolve(); }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.cancelPending('disposed');
  }

  private schedule(): void {
    if (this.running || this.batchTimer || this.disposed || !this.enabled || !this.queue.length) return;
    this.batchTimer = setTimeout(() => { this.batchTimer = undefined; this.start(); }, BATCH_DELAY_MS);
    this.batchTimer.unref?.();
  }

  private start(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    if (this.running || this.disposed || !this.enabled || !this.endpoint || !this.queue.length) return;
    const generation = this.generation;
    this.running = this.drain(this.endpoint, generation).finally(() => {
      this.running = undefined;
      this.schedule();
    });
  }

  private async drain(endpoint: string, generation: number): Promise<void> {
    while (this.queue.length && generation === this.generation && this.enabled && !this.disposed) {
      this.reportOverflow();
      const events = this.queue.splice(0, BATCH_SIZE);
      const payload: Ga4RelayBatchPayload = { client_id: this.clientId, events };
      for (let attempt = 0; ; attempt++) {
        const result = await this.send(endpoint, payload);
        if (generation !== this.generation) {
          this.health('dropped', events.length, 'cancelled');
          return;
        }
        if (result.ok || !result.retryable || attempt >= RETRY_DELAYS_MS.length) {
          this.health(result.ok ? 'delivered' : 'failed', events.length, result.reason, result.status);
          break;
        }
        this.health('retrying', events.length, result.reason, result.status);
        await new Promise<void>(resolve => {
          this.wakeRetry = resolve;
          this.retryTimer = setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
        });
        this.retryTimer = undefined;
        this.wakeRetry = undefined;
        if (generation !== this.generation) {
          this.health('dropped', events.length, 'cancelled');
          return;
        }
      }
    }
  }

  private cancelPending(reason: string): void {
    this.generation++;
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.batchTimer = this.retryTimer = undefined;
    this.wakeRetry?.();
    this.wakeRetry = undefined;
    this.controller?.abort();
    const count = this.queue.length;
    this.queue.length = 0;
    if (count) this.health('dropped', count, reason);
    this.reportOverflow();
  }

  private reportOverflow(): void {
    if (!this.overflow) return;
    const count = this.overflow;
    this.overflow = 0;
    this.health('dropped', count, 'queue-full');
  }

  private async send(url: string, payload: Ga4RelayBatchPayload): Promise<Delivery> {
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 3000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      await response.body?.cancel();
      return { ok: response.ok, status: response.status, reason: response.ok ? 'accepted' : 'http',
        retryable: response.status === 408 || response.status === 429 || response.status >= 500 };
    } catch {
      return { ok: false, retryable: true, reason: controller.signal.aborted ? 'aborted' : 'network' };
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private health(outcome: string, records: number, reason: string, status?: number): void {
    try {
      this.options.onDelivery?.({
        level: outcome === 'delivered' ? 'debug' : 'warn', name: 'telemetry.delivery',
        attributes: { outcome, records, reason, queued: this.queue.length, ...(status === undefined ? {} : { status }) },
      });
    } catch { /* Delivery diagnostics must not affect the editor or recurse into telemetry. */ }
  }
}
