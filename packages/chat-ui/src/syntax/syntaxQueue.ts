import type { SyntaxRequest, SyntaxResponse, SyntaxWorkerFactory } from './syntaxProtocol';

interface Job { request: SyntaxRequest; receive: (result: SyntaxResponse) => void; cancelled: boolean }
let sequence = 0;
function createQueue(factory: SyntaxWorkerFactory) {
  const queued: Job[] = [];
  let worker: Worker | undefined;
  let active: Job | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function finish(result: SyntaxResponse) {
    if (active?.request.id !== result.id) return;
    clearTimeout(timer);
    const job = active;
    active = undefined;
    if (!job.cancelled) job.receive(result);
    pump();
  }
  function fail(message: string) {
    worker?.terminate();
    worker = undefined;
    if (active) finish({ id: active.request.id, documents: [], error: message });
  }
  function pump() {
    if (active || !queued.length) return;
    const job = queued.shift()!;
    active = job;
    timer = setTimeout(() => fail('Syntax highlighting timed out. Source is shown as plain text.'), 20_000);
    void (async () => {
      if (!worker) {
        const created = await factory();
        if (active !== job) { created.terminate(); return; }
        worker = created;
        worker.onmessage = (event: MessageEvent<SyntaxResponse>) => finish(event.data);
        worker.onerror = event => { event.preventDefault(); fail(event.message || 'Syntax worker failed.'); };
        worker.onmessageerror = () => fail('The syntax worker response could not be read.');
      }
      worker.postMessage(job.request);
    })().catch(error => { if (active === job) fail(error instanceof Error ? error.message : 'Syntax worker could not start.'); });
  }
  return (request: Omit<SyntaxRequest, 'id'>, receive: Job['receive']) => {
    const job: Job = { request: { ...request, id: ++sequence }, receive, cancelled: false };
    queued.push(job);
    pump();
    return () => {
      job.cancelled = true;
      const index = queued.indexOf(job);
      if (index !== -1) queued.splice(index, 1);
    };
  };
}
const queues = new WeakMap<SyntaxWorkerFactory, ReturnType<typeof createQueue>>();
export function requestSyntax(factory: SyntaxWorkerFactory, request: Omit<SyntaxRequest, 'id'>, receive: Job['receive']) {
  let queue = queues.get(factory);
  if (!queue) { queue = createQueue(factory); queues.set(factory, queue); }
  return queue(request, receive);
}
