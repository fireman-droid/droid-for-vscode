import { parentPort } from 'node:worker_threads';
import { readPersistedHistory, type PersistedHistoryRequest } from './persistedHistory';

const port = parentPort;
if (!port) throw new Error('Session history worker requires a parent.');
// Keep simultaneous viewer/subagent reads from retaining several full logs at once.
let pending = Promise.resolve();
port.on('message', (request: { id: number; options: PersistedHistoryRequest }) => {
  pending = pending.then(async () => {
    try { port.postMessage({ id: request.id, result: await readPersistedHistory(request.options) }); }
    catch { port.postMessage({ id: request.id, error: true }); }
  });
});
