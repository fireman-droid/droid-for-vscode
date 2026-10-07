import type { ReviewContext, ReviewPanelContext, ReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import { createDiffRefreshQueue } from './diffRefreshQueue';
import { ReviewReadScheduler } from './reviewReadScheduler';

export interface ReviewFileRead {
  readonly file: ReviewPanelFile | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly toolUseId?: string;
}
interface Reader {
  requestId?: string;
  view: ReviewFileRead;
  version: string;
  visible: boolean;
  queue: ReturnType<typeof createDiffRefreshQueue<ReviewPanelFile>>;
}
const EMPTY: ReviewFileRead = { file: null, pending: false, error: null };

/** One request queue per visible file, scoped to the accepted comparison. */
export class ReviewFileReads {
  epoch = 0;
  private readers = new Map<string, Reader>();
  private readonly mounted = new Set<string>();
  private scope: ReviewScopeState | null = null;
  private target: ReviewPanelContext | null = null;
  private context: ReviewContext = 3;
  private key = '';
  private sequence = 0;
  private readonly scheduler = new ReviewReadScheduler();
  private readonly cache = new Map<string, { file: ReviewPanelFile; bytes: number }>();
  private cacheBytes = 0;
  constructor(private readonly port: { postMessage(value: unknown): void }, private readonly changed: () => void) {}

  reset(): void {
    this.scheduler.reset();
    for (const reader of this.readers.values()) reader.queue.dispose();
    this.epoch++;
    this.readers.clear(); this.scope = null; this.key = '';
  }
  dispose(): void { this.reset(); this.cache.clear(); this.cacheBytes = 0; this.mounted.clear(); }
  retain(path: string): void { this.mounted.add(path); }
  prioritize(path: string): void { this.scheduler.select(path); this.ensure(path); }
  update(target: ReviewPanelContext | null, scope: ReviewScopeState | null, context: ReviewContext): void {
    const key = target?.valid && !target.operation && scope
      ? JSON.stringify([target.sessionId, scope.reviewScopeId, scope.baseline, context, target.operationPath, target.toolUseId]) : '';
    const phaseChanged = this.scope?.lifecycle !== scope?.lifecycle;
    if (key !== this.key) { this.reset(); this.key = key; this.changed(); }
    this.target = target; this.scope = key ? scope : null; this.context = context;
    if (!this.scope) return;
    const selected = this.scope.files[this.scope.currentIndex ?? -1]?.path;
    if (selected) this.scheduler.select(selected);
    const files = new Map(this.scope.files.map(file => [file.path, file]));
    for (const [path, reader] of this.readers) {
      if (!files.has(path) || !reader.visible && !this.mounted.has(path) && path !== selected) {
        this.release(reader); this.readers.delete(path); this.changed(); continue;
      }
      // Invalidate synchronously: a late file message may follow this scope
      // message before React renders the new lifecycle.
      if (phaseChanged) reader.queue.discardInFlight();
      if (reader.visible || path === this.scope.files[this.scope.currentIndex ?? -1]?.path) this.refreshVersion(path, reader);
    }
  }
  get(path: string | null | undefined): ReviewFileRead {
    if (!path) return EMPTY;
    const reader = this.readers.get(path);
    if (reader) return reader.view;
    const file = this.scope?.files.find(file => file.path === path);
    const toolUseId = !this.target?.operationPath || this.target.operationPath === path ? this.target?.toolUseId : undefined;
    const cached = file && this.scope?.lifecycle !== 'writing' ? this.cache.get(this.cacheKey(path, file.version, toolUseId)) : undefined;
    return cached ? { ...EMPTY, file: cached.file, toolUseId } : EMPTY;
  }
  watch(path: string): void {
    const reader = this.ensure(path);
    if (reader) { reader.visible = true; this.refreshVersion(path, reader); }
  }
  unwatch(path: string): void {
    const reader = this.readers.get(path);
    if (!reader) return;
    reader.visible = false;
  }
  forget(path: string): void {
    this.mounted.delete(path);
    const reader = this.readers.get(path);
    if (!reader) return;
    if (path !== this.scope?.files[this.scope.currentIndex ?? -1]?.path) {
      this.release(reader); this.readers.delete(path);
    }
  }
  private release(reader: Reader): void {
    reader.queue.dispose();
    if (reader.requestId) this.scheduler.cancel(reader.requestId);
  }
  private cacheKey(path: string, version: string, toolUseId?: string): string {
    return JSON.stringify([this.key, path, version, toolUseId]);
  }
  ensure(path: string): Reader | undefined {
    const existing = this.readers.get(path);
    if (existing) { this.refreshVersion(path, existing); return existing; }
    const scope = this.scope;
    if (!scope?.files.some(file => file.path === path)) return;
    const toolUseId = (scope.scopeKind === 'operations' || scope.scopeKind === 'turn') &&
      (!this.target?.operationPath || this.target.operationPath === path) ? this.target?.toolUseId : undefined;
    const reader: Reader = { version: '', visible: false, view: { ...EMPTY, toolUseId }, queue: createDiffRefreshQueue<ReviewPanelFile>({
      createId: () => `review-file-${++this.sequence}`,
      send: requestId => {
        reader.requestId = requestId;
        const message = { type: 'reviewPanel.readFile', requestId,
          reviewScopeId: scope.reviewScopeId, baseline: scope.baseline, path, context: this.context,
          ...(reader.view.toolUseId ? { toolUseId: reader.view.toolUseId } : {}) };
        this.scheduler.enqueue(requestId, path, () => this.port.postMessage(message));
      },
      pending: () => { reader.view = { ...reader.view, pending: true, error: null }; this.changed(); },
      receive: file => {
        if (!file.error && this.scope?.lifecycle !== 'writing') {
          const key = this.cacheKey(path, file.version, reader.view.toolUseId);
          const bytes = JSON.stringify(file).length * 2;
          this.cacheBytes -= this.cache.get(key)?.bytes ?? 0; this.cache.delete(key);
          this.cache.set(key, { file, bytes }); this.cacheBytes += bytes;
          while (this.cache.size > 128 || this.cacheBytes > 32 * 1024 * 1024) {
            const oldest = this.cache.keys().next().value!;
            this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
          }
        }
        const latest = file.recordedOperations && ([...file.recordedOperations].reverse()
          .find(entry => entry.source === 'tool-result' && entry.outcome === 'applied') ?? file.recordedOperations.at(-1));
        reader.view = { file: file.error && reader.view.file && !reader.view.file.error ? reader.view.file : file,
          pending: false, error: file.error, toolUseId: reader.view.toolUseId ?? latest?.toolUseId };
        this.changed();
      },
      timeout: () => {
        if (reader.requestId) this.scheduler.finish(reader.requestId);
        reader.view = { ...reader.view, pending: false, error: 'Could not refresh this diff. Try again.' }; this.changed();
      },
    }) };
    this.readers.set(path, reader);
    this.refreshVersion(path, reader);
    return reader;
  }
  private refreshVersion(path: string, reader: Reader): void {
    const file = this.scope?.files.find(file => file.path === path);
    if (!file) return;
    const version = JSON.stringify([file.version, this.scope?.lifecycle]);
    if (version === reader.version) return;
    const first = !reader.version;
    reader.version = version;
    const key = this.cacheKey(path, file.version, reader.view.toolUseId);
    const cached = this.cache.get(key);
    if (cached && this.scope?.lifecycle !== 'writing') {
      this.cache.delete(key); this.cache.set(key, cached);
      reader.view = { ...reader.view, file: cached.file, pending: false, error: null }; this.changed(); return;
    }
    reader.queue.refresh(first || this.scope?.lifecycle !== 'writing' ? 0 : 200);
  }
  receive(file: ReviewPanelFile): void {
    this.scheduler.finish(file.requestId);
    if (this.scope?.reviewScopeId === file.reviewScopeId) this.readers.get(file.path)?.queue.receive(file.requestId, file);
  }
  selectEdit(path: string, toolUseId: string | undefined): void {
    const reader = this.ensure(path);
    if (!reader || reader.view.toolUseId === toolUseId) return;
    reader.view = { ...reader.view, toolUseId };
    reader.queue.refresh(0, true);
  }
  retry(path: string): void { this.prioritize(path); this.ensure(path)?.queue.refresh(0); }
}
