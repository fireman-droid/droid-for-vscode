/** One active read per preview identity; later invalidations collapse into one follow-up. */
export function createDiffRefreshQueue<Result>(options: {
  createId(): string;
  send(requestId: string): void;
  pending(): void;
  receive(result: Result): void;
  timeout(): void;
}) {
  let generation = 0;
  let dirty = false;
  let disposed = false;
  let active: { id: string; generation: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const finish = (requestId: string, result: { value: Result } | null): void => {
    if (disposed || active?.id !== requestId) return;
    const current = active.generation === generation;
    clearTimeout(timeout);
    active = null;
    if (current) {
      if (result) options.receive(result.value);
      else options.timeout();
    }
    if (dirty && timer === undefined) request();
  };
  const request = (): void => {
    if (disposed || active !== null || !dirty) return;
    dirty = false;
    const id = options.createId();
    active = { id, generation };
    options.pending();
    timeout = setTimeout(() => finish(id, null), 35_000);
    options.send(id);
  };
  return {
    discardInFlight(): void {
      if (!disposed) generation += 1;
    },
    refresh(delay = 200, discardInFlight = false): void {
      if (disposed) return;
      // A live invalidation schedules a newer read without starving the current
      // preview. Only a phase boundary makes an in-flight response obsolete.
      if (discardInFlight) generation += 1;
      dirty = true;
      options.pending();
      if (delay === 0) {
        clearTimeout(timer);
        timer = undefined;
        request();
      } else if (timer === undefined) {
        timer = setTimeout(() => { timer = undefined; request(); }, delay);
      }
    },
    receive(requestId: string, value: Result): void { finish(requestId, { value }); },
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      active = null;
    },
  };
}
