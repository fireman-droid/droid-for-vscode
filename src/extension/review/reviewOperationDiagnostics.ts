import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ReviewWebviewMessage } from '../../shared/protocol/reviewProtocol';
import { classifyOperationError, recordOperation, type OperationResultDiagnostic } from '../diagnostics/operationDiagnostics';

/** Outcome state is scoped to the coordinator's serial user-action queue. */
export class ReviewOperationDiagnostics {
  private current: OperationResultDiagnostic | undefined;
  constructor(private readonly diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>) {}

  async run(message: ReviewWebviewMessage, task: () => Promise<void>, isCurrent: () => boolean): Promise<void> {
    const started = performance.now();
    if (!isCurrent()) {
      recordOperation(this.diagnostics, 'review', message.type, started, { outcome: 'blocked', failureKind: 'conflict' });
      return;
    }
    this.current = { outcome: 'success' };
    try {
      await task();
      if (!isCurrent() && this.current.outcome === 'success') this.current = { outcome: 'cancelled', failureKind: 'cancelled' };
      // The agent runner owns its accepted request and eventual execution result.
      if (message.type !== 'review.runAgentReview') recordOperation(this.diagnostics, 'review', message.type, started, this.current);
    } catch (error) {
      recordOperation(this.diagnostics, 'review', message.type, started, classifyOperationError(error));
      throw error;
    } finally { this.current = undefined; }
  }
  set(result: OperationResultDiagnostic): void { if (this.current) this.current = result; }
  failed(): void { if (this.current?.outcome === 'success') this.current = { outcome: 'failed', failureKind: 'unknown' }; }

  queueFailed(started: number): void {
    recordOperation(this.diagnostics, 'review', 'review.queue', started, { outcome: 'failed', failureKind: 'queue' });
    try { this.diagnostics?.record({ level: 'warn', name: 'host.review.queue-failed' }); } catch {}
  }
  async recover(task: () => Promise<void>): Promise<void> {
    const started = performance.now();
    try { await task(); }
    catch (error) {
      recordOperation(this.diagnostics, 'review', 'review.recovery', started, { outcome: 'blocked', failureKind: 'recovery' });
      try { this.diagnostics?.record({ level: 'warn', name: 'host.review.recovery-blocked',
        detail: error instanceof Error ? error.message : String(error) }); } catch {}
    }
  }
}
