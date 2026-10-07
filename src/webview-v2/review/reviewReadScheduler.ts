/** Three background reads leave one slot for an explicitly selected file. */
export class ReviewReadScheduler {
  private readonly queued = new Map<string, { path: string; send(): void }>();
  private readonly active = new Set<string>();
  private priority: string | undefined;
  enqueue(id: string, path: string, send: () => void): void {
    this.queued.set(id, { path, send }); this.drain();
  }
  select(path: string): void { this.priority = path; this.drain(); }
  finish(id: string): void { this.active.delete(id); this.queued.delete(id); this.drain(); }
  cancel(id: string): void { this.queued.delete(id); }
  reset(): void { this.queued.clear(); this.active.clear(); this.priority = undefined; }
  private drain(): void {
    while (this.queued.size && this.active.size < 4) {
      const selected = [...this.queued].find(([, entry]) => entry.path === this.priority);
      if (!selected && this.active.size >= 3) break;
      const [id, entry] = selected ?? this.queued.entries().next().value!;
      this.queued.delete(id); this.active.add(id); entry.send();
    }
  }
}
