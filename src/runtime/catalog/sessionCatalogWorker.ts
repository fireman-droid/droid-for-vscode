import { parentPort } from 'node:worker_threads';
import { listSessions } from '@factory/droid-sdk/node';
import type { FactorySessionLister } from './FactorySessionCatalog';

const port = parentPort;
if (!port) throw new Error('Session catalog worker requires a parent.');
port.on('message', async (request: { id: number; options: Parameters<FactorySessionLister>[0] }) => {
  try {
    const rows = await listSessions(request.options);
    port.postMessage({ id: request.id, rows });
  } catch {
    // File contents and SDK error details never cross into host diagnostics.
    port.postMessage({ id: request.id });
  }
});
