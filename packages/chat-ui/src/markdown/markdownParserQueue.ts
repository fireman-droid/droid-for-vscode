import { markdownWorkerSource } from './markdownWorkerSource';
import type { MarkdownParseRequest, MarkdownParseResponse } from './markdownWorkerProtocol';

interface Client {
  retain: boolean;
  disposed: boolean;
  readonly receive: (value: MarkdownParseResponse) => void;
  readonly fail: (error: Error, unavailable: boolean) => void;
}
interface Job { readonly client: Client; readonly request: MarkdownParseRequest }
const clients = new Set<Client>();
const queued: Job[] = [];
let worker: Worker | null = null;
let active: Job | null = null;
let previous: Client | null = null;

function stopWorker() {
  if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
  worker = null;
  active = null;
  previous = null;
}
function releaseIdle() {
  if (!active && !queued.length && ![...clients].some((client) => client.retain)) stopWorker();
}
function pump() {
  if (active) return;
  const job = queued.shift();
  if (!job) { releaseIdle(); return; }
  if (job.client.disposed) { pump(); return; }
  if (!worker) {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([markdownWorkerSource!], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (cause) {
      job.client.fail(cause instanceof Error ? cause : new Error(String(cause)), true);
      pump();
      return;
    } finally { if (url) URL.revokeObjectURL(url); }
    worker.onmessage = ({ data }: MessageEvent<MarkdownParseResponse>) => {
      const completed = active;
      if (!completed || data.id !== completed.request.id) return;
      active = null;
      previous = completed.client;
      if (!completed.client.disposed) completed.client.receive(data);
      pump();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      const failed = active;
      stopWorker();
      failed?.client.fail(new Error(event.message || 'Background Markdown parsing failed.'), false);
      pump();
    };
  }
  active = job;
  worker.postMessage({ ...job.request, reset: previous !== job.client });
}

/** One worker per webview; mounted history replies queue fairly instead of
 * each allocating a parser thread. A live stream retains the idle worker, but
 * does not monopolize it between requests. Completed history releases it. */
export function createMarkdownParser(
  receive: Client['receive'], fail: Client['fail'],
) {
  const client: Client = { receive, fail, retain: false, disposed: false };
  clients.add(client);
  return {
    postMessage(request: MarkdownParseRequest) { queued.push({ client, request }); pump(); },
    retain(value: boolean) { client.retain = value; },
    terminate() {
      client.disposed = true;
      clients.delete(client);
      for (let index = queued.length - 1; index >= 0; index -= 1)
        if (queued[index]!.client === client) queued.splice(index, 1);
      if (active?.client === client) stopWorker();
      pump();
    },
  };
}
