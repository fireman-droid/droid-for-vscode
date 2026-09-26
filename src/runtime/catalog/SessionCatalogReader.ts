import { Worker } from 'node:worker_threads';
import type { FactorySessionLister } from './FactorySessionCatalog';

interface PendingRead {
  readonly resolve: (rows: readonly unknown[]) => void;
  readonly reject: (error: Error) => void;
}

/** SDK listSessions uses synchronous filesystem reads despite its Promise API. */
export class SessionCatalogReader {
  private worker: Worker | undefined;
  private readonly pending = new Map<number, PendingRead>();
  private nextId = 0;
  private disposed = false;

  constructor(private readonly workerFile: string) {}

  readonly list: FactorySessionLister = async (options) => {
    if (this.disposed) throw new Error('Session catalog reader is disposed.');
    const worker = this.worker ?? this.start();
    const id = ++this.nextId;
    return new Promise<readonly unknown[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, options }); }
      catch {
        this.pending.delete(id);
        reject(new Error('Session catalog request could not be sent.'));
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
    worker.on('message', (message: { id: number; rows?: readonly unknown[] }) => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.rows) pending.resolve(message.rows);
      else pending.reject(new Error('Saved Droid sessions could not be read.'));
    });
    worker.on('error', () => this.fail(worker));
    worker.on('exit', () => this.fail(worker));
    return worker;
  }

  private fail(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Session catalog reader stopped.'));
    }
    this.pending.clear();
  }
}
