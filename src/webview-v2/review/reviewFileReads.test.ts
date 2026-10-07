import { expect, it, vi } from 'vitest';
import { ReviewFileReads } from './reviewFileReads';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { ReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';

const target = { type: 'reviewPanel.context' as const, sessionId: 's', latestTurnId: 't', valid: true, operation: null, operationPath: null };
const scope: ReviewScopeState = { sessionId: 's', reviewScopeId: 'scope', scopeKind: 'turn', baseline: 'before:after',
  baselineLabel: 'Turn', lifecycle: 'settled', currentIndex: 0, reviewedCount: 0, reviewableCount: 20,
  files: Array.from({ length: 20 }, (_, index) => ({ path: `file-${index}.ts`, version: `v-${index}`,
    status: 'unreviewed', additions: 1, deletions: 1, restorable: false })) };
function fixture() {
  const postMessage = vi.fn(); const reads = new ReviewFileReads({ postMessage }, vi.fn());
  reads.update(target, scope, 3);
  const reply = (request = postMessage.mock.calls.at(-1)![0]) => {
    const file: ReviewPanelFile = { ...request, type: 'reviewPanel.file', version: scope.files.find(file => file.path === request.path)!.version,
      patch: '@@ -1 +1 @@\n-before\n+after', truncated: false, error: null };
    reads.receive(file); return file;
  };
  return { reads, postMessage, reply };
}
it('limits background requests and reserves a slot for a selected file', () => {
  const f = fixture();
  scope.files.forEach(file => f.reads.watch(file.path));
  expect(f.postMessage).toHaveBeenCalledTimes(3);
  f.reads.prioritize('file-19.ts');
  expect(f.postMessage.mock.calls.at(-1)![0].path).toBe('file-19.ts');
  expect(f.postMessage).toHaveBeenCalledTimes(4); f.reads.dispose();
});
it('reuses a completed preview after reset but reloads changed revisions and rejects late replies', () => {
  const f = fixture(); f.reads.watch('file-0.ts'); const previous = f.reply();
  f.reads.reset(); f.reads.update(target, scope, 3); f.reads.watch('file-0.ts');
  expect(f.postMessage).toHaveBeenCalledOnce(); expect(f.reads.get('file-0.ts').file?.patch).toContain('+after');
  f.reads.update(target, { ...scope, files: [{ ...scope.files[0]!, version: 'changed' }] }, 3);
  expect(f.postMessage).toHaveBeenCalledTimes(2);
  f.reads.receive({ ...previous, patch: 'obsolete' });
  expect(f.reads.get('file-0.ts').file?.patch).not.toBe('obsolete'); f.reads.dispose();
});

it('retains a mounted file outside the preload margin and supplies cached contents before remount effects', () => {
  const f = fixture(); const path = 'file-1.ts';
  f.reads.retain(path); f.reads.watch(path); f.reply(); f.reads.unwatch(path);
  f.reads.update(target, scope, 3);
  expect(f.reads.get(path).file?.patch).toContain('+after');
  f.reads.forget(path);
  expect(f.reads.get(path).file?.patch).toContain('+after');
  f.reads.retain(path); f.reads.watch(path);
  expect(f.postMessage).toHaveBeenCalledOnce(); f.reads.dispose();
});
