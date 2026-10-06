import type { ReviewContext, ReviewPanelContext, ReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import { createDiffRefreshQueue } from './diffRefreshQueue';

export interface ReviewFileRead {
  readonly file: ReviewPanelFile | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly toolUseId?: string;
}
interface Reader {
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
  private scope: ReviewScopeState | null = null;
  private target: ReviewPanelContext | null = null;
  private context: ReviewContext = 3;
  private key = '';
  private sequence = 0;
  constructor(private readonly port: { postMessage(value: unknown): void }, private readonly changed: () => void) {}

  reset(): void {
    for (const reader of this.readers.values()) reader.queue.dispose();
    this.epoch++;
    this.readers.clear(); this.scope = null; this.key = '';
  }
  update(target: ReviewPanelContext | null, scope: ReviewScopeState | null, context: ReviewContext): void {
    const key = target?.valid && !target.operation && scope
      ? JSON.stringify([target.sessionId, scope.reviewScopeId, scope.baseline, context, target.operationPath, target.toolUseId]) : '';
    const phaseChanged = this.scope?.lifecycle !== scope?.lifecycle;
    if (key !== this.key) { this.reset(); this.key = key; this.changed(); }
    this.target = target; this.scope = key ? scope : null; this.context = context;
    if (!this.scope) return;
    const files = new Map(this.scope.files.map(file => [file.path, file]));
    for (const [path, reader] of this.readers) {
      if (!files.has(path)) { reader.queue.dispose(); this.readers.delete(path); this.changed(); continue; }
      // Invalidate synchronously: a late file message may follow this scope
      // message before React renders the new lifecycle.
      if (phaseChanged) reader.queue.discardInFlight();
      if (reader.visible || path === this.scope.files[this.scope.currentIndex ?? -1]?.path) this.refreshVersion(path, reader);
    }
  }
  get(path: string | null | undefined): ReviewFileRead { return path ? this.readers.get(path)?.view ?? EMPTY : EMPTY; }
  watch(path: string): void {
    const reader = this.ensure(path);
    if (reader) { reader.visible = true; this.refreshVersion(path, reader); }
  }
  unwatch(path: string): void { const reader = this.readers.get(path); if (reader) reader.visible = false; }
  ensure(path: string): Reader | undefined {
    const existing = this.readers.get(path);
    if (existing) { this.refreshVersion(path, existing); return existing; }
    const scope = this.scope;
    if (!scope?.files.some(file => file.path === path)) return;
    const toolUseId = (scope.scopeKind === 'operations' || scope.scopeKind === 'turn') &&
      (!this.target?.operationPath || this.target.operationPath === path) ? this.target?.toolUseId : undefined;
    const reader: Reader = { version: '', visible: false, view: { ...EMPTY, toolUseId }, queue: createDiffRefreshQueue<ReviewPanelFile>({
      createId: () => `review-file-${++this.sequence}`,
      send: requestId => this.port.postMessage({ type: 'reviewPanel.readFile', requestId,
        reviewScopeId: scope.reviewScopeId, baseline: scope.baseline, path, context: this.context,
        ...(reader.view.toolUseId ? { toolUseId: reader.view.toolUseId } : {}) }),
      pending: () => { reader.view = { ...reader.view, pending: true, error: null }; this.changed(); },
      receive: file => {
        const latest = file.recordedOperations && ([...file.recordedOperations].reverse()
          .find(entry => entry.source === 'tool-result' && entry.outcome === 'applied') ?? file.recordedOperations.at(-1));
        reader.view = { file: file.error && reader.view.file && !reader.view.file.error ? reader.view.file : file,
          pending: false, error: file.error, toolUseId: reader.view.toolUseId ?? latest?.toolUseId };
        this.changed();
      },
      timeout: () => { reader.view = { ...reader.view, pending: false, error: 'Could not refresh this diff. Try again.' }; this.changed(); },
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
    reader.queue.refresh(first || this.scope?.lifecycle !== 'writing' ? 0 : 200);
  }
  receive(file: ReviewPanelFile): void {
    if (this.scope?.reviewScopeId === file.reviewScopeId) this.readers.get(file.path)?.queue.receive(file.requestId, file);
  }
  selectEdit(path: string, toolUseId: string | undefined): void {
    const reader = this.ensure(path);
    if (!reader || reader.view.toolUseId === toolUseId) return;
    reader.view = { ...reader.view, toolUseId };
    reader.queue.refresh(0, true);
  }
  retry(path: string): void { this.ensure(path)?.queue.refresh(0); }
}
