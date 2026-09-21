import type { DaemonSessionController } from '@factory/droid-sdk';

export type DaemonTransportState = 'connected' | 'recovering' | 'failed';
export const DAEMON_RECOVERY_TIMEOUT_MS = 45_000;

/** One bounded recovery owns the authenticated socket and its session subscriptions. */
export class DaemonTransportRecovery {
  private state: DaemonTransportState = 'connected';
  private pending: Promise<void> | undefined;
  private resolve: (() => void) | undefined;
  private reject: ((error: Error) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private restoring = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly controller: DaemonSessionController,
    private readonly restoringSessions: () => Promise<void>,
    private readonly suspendSessions: () => void,
    private readonly failSessions: (error: Error) => void,
    private readonly onState?: (state: DaemonTransportState) => void,
  ) {
    controller.on('disconnected', this.disconnected);
    controller.on('connectionStatusChanged', this.changed);
  }

  private readonly disconnected = (): void => {
    if (this.disposed || this.state === 'failed') return;
    this.generation += 1;
    this.restoring = false;
    if (!this.pending) {
      this.pending = new Promise<void>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      void this.pending.catch(() => undefined);
      this.timer = setTimeout(() => this.fail(), DAEMON_RECOVERY_TIMEOUT_MS);
      this.state = 'recovering';
      this.suspendSessions();
      this.onState?.(this.state);
    }
    // The SDK schedules its retry after emitting the first disconnected state.
    queueMicrotask(this.changed);
  };

  private readonly changed = (): void => {
    if (this.disposed || this.state !== 'recovering') return;
    const status = this.controller.getConnectionStatus();
    if (status.lastConnectionFailure?.retryable === false ||
        status.recovery?.isReconnecting === false && status.transport === 'disconnected') {
      this.fail();
    } else if (status.transport === 'connected' && status.isAuthenticated && !this.restoring) {
      this.restoring = true;
      const generation = this.generation;
      void this.restoringSessions().then(() => {
        if (this.disposed || this.generation !== generation || this.state !== 'recovering') return;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.state = 'connected';
        this.restoring = false;
        this.resolve?.();
        this.pending = undefined;
        this.resolve = undefined;
        this.reject = undefined;
        this.onState?.(this.state);
        for (const listener of this.listeners) listener();
      }, () => {
        if (this.generation === generation && this.state === 'recovering') this.fail();
      });
    }
  };

  private fail(): void {
    if (this.disposed || this.state === 'failed') return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.state = 'failed';
    const error = new Error('The Droid transport could not restore its session subscriptions.');
    this.reject?.(error);
    this.failSessions(error);
    this.onState?.(this.state);
  }

  async waitUntilReady(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.disposed || this.state === 'failed') throw new Error('Droid connection is unavailable.');
    const pending = this.pending;
    if (!pending) return;
    let abort: (() => void) | undefined;
    try {
      await (signal ? Promise.race([pending, new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]) : pending);
      signal?.throwIfAborted();
    } finally {
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  revision(): number { return this.generation; }
  isReady(): boolean { return !this.disposed && this.state === 'connected'; }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.reject?.(new Error('Droid connection was disposed.'));
    this.listeners.clear();
    this.controller.off('disconnected', this.disconnected);
    this.controller.off('connectionStatusChanged', this.changed);
  }
}
