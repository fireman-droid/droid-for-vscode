import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { BtwScriptRequest, BtwScriptResult } from './btwAnalysisSandbox';

/** A stalled or cancelled guest never blocks the extension host. One job per side conversation. */
export class BtwAnalysisRunner {
  private cancelActive: (() => void) | null = null;
  constructor(private readonly workerFile = path.join(__dirname, 'btwAnalysisWorker.cjs')) {}

  run(request: BtwScriptRequest): Promise<BtwScriptResult> {
    if (this.cancelActive) return Promise.resolve({ ok: false, output: '', error: 'An analysis is already running. Wait for its result.' });
    return new Promise(resolve => {
      const worker = new Worker(this.workerFile, {
        workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      });
      let done = false;
      const finish = (result: BtwScriptResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.cancelActive = null;
        void worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, output: '', error: 'Analysis exceeded its time limit.' }), 5_000);
      this.cancelActive = () => finish({ ok: false, output: '', error: 'Analysis cancelled.' });
      worker.once('message', finish);
      worker.once('error', error => finish({ ok: false, output: '', error: error.message }));
      worker.once('exit', () => finish({ ok: false, output: '', error: 'Analysis worker exited without a result.' }));
    });
  }

  cancel(): void { this.cancelActive?.(); }
}
