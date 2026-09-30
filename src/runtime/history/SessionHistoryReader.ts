import { Worker } from 'node:worker_threads';
import type { PersistedHistory, PersistedHistoryReader } from './persistedHistory';

interface PendingRead {
  resolve(value: PersistedHistory | null): void;
  reject(error: Error): void;
}

/** Isolates JSON decoding, parent repair and transcript projection from the extension host. */
export class SessionHistoryReader {
  private worker: Worker | undefined;
  private readonly pending = new Map<number, PendingRead>();
  private nextId = 0;
  private disposed = false;

  constructor(private readonly workerFile: string) {}

  readonly read: PersistedHistoryReader = async (options) => {
    if (this.disposed) throw new Error('Session history reader is disposed.');
    const worker = this.worker ?? this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, options }); }
      catch {
        this.pending.delete(id);
        reject(new Error('Session history request could not be sent.'));
      }
    });
  };

  dispose(): void {
    this.disposed = true;
    const worker = this.worker;
    if (!worker) return;
    this.fail(worker);
    void worker.terminate();
  }

  private start(): Worker {
    const worker = new Worker(this.workerFile, { execArgv: [] });
    this.worker = worker;
    worker.on('message', (message: { id: number; result?: PersistedHistory | null; error?: boolean }) => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error || message.result === undefined) pending.reject(new Error('Saved Droid history could not be read.'));
      else pending.resolve(message.result);
    });
    worker.on('error', () => { this.fail(worker); void worker.terminate(); });
    worker.on('exit', () => this.fail(worker));
    return worker;
  }

  private fail(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error('Session history reader stopped.'));
    this.pending.clear();
  }
}
