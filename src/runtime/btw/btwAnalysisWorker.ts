import { parentPort, workerData } from 'node:worker_threads';
import { evaluateBtwScript, type BtwScriptRequest } from './btwAnalysisSandbox';

void evaluateBtwScript(workerData as BtwScriptRequest).then(
  result => parentPort?.postMessage(result),
  error => parentPort?.postMessage({ ok: false, output: '', error: error instanceof Error ? error.message : String(error) }),
);
