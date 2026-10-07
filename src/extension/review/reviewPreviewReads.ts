import type { ReviewContext } from '../../shared/protocol/reviewPanelProtocol';
import type { ActiveScope } from './reviewCoordinatorSupport';
import type { ReviewCoordinatorOptions } from './reviewCoordinatorOptions';
import { readReviewPatch, reviewFileVersion, type ReviewContentSource } from './reviewContent';
import { ReviewReadCache, reviewDisplayVersion, reviewReadKey } from './reviewReadCache';

/** Display caching never supplies the evidence for a write or reviewed action. */
export class ReviewPreviewReads {
  private readonly contents = new ReviewReadCache<{ before: Buffer; after: Buffer }>(value => value.before.length + value.after.length);
  private readonly patches = new ReviewReadCache<Awaited<ReturnType<typeof readReviewPatch>>>(value => Buffer.byteLength(JSON.stringify(value)));
  private readonly versions = new Map<string, string>();
  private readonly source: ReviewContentSource;
  constructor(private readonly options: ReviewCoordinatorOptions) {
    this.source = { ...options, contentCache: this.contents };
  }
  async read(scope: ActiveScope, request: { path: string; context: ReviewContext; toolUseId?: string }, current: () => boolean) {
    const started = performance.now();
    const key = await reviewReadKey(this.options, scope, request.path);
    const result = await this.patches.read(JSON.stringify([key, request.context, request.toolUseId]), () =>
      readReviewPatch(this.source, scope, request.path, request.context, request.toolUseId));
    if (!current() || key !== await reviewReadKey(this.options, scope, request.path))
      throw new Error('The comparison changed while loading. Refresh Review.');
    const version = this.options.openSelectionInEditor === false
      ? await reviewDisplayVersion(this.options, scope, request.path) : result.version;
    this.versions.delete(key); this.versions.set(key, result.version);
    if (this.versions.size > 128) this.versions.delete(this.versions.keys().next().value!);
    this.options.diagnostics?.record({ level: 'debug', name: 'host.review.file_ready',
      attributes: { reviewScopeId: scope.reviewScopeId, path: request.path, context: request.context,
        elapsedMs: Math.round(performance.now() - started) } });
    return { ...result, version };
  }
  async verify(scope: ActiveScope, current: ActiveScope, path: string): Promise<boolean> {
    const shown = this.versions.get(await reviewReadKey(this.options, scope, path));
    const actual = await reviewFileVersion(this.options, current, path, true);
    if (shown && shown === actual) return true;
    this.clear(); return false;
  }
  clear(): void { this.contents.clear(); this.patches.clear(); this.versions.clear(); }
}
