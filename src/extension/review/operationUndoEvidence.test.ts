import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import { applyOperationUndo } from './operationUndoFiles';
import { loadOperationReviewScope, preflightOperationRestore, type RecordedOperation } from './reviewOperationScope';

vi.mock('vscode', () => ({ workspace: { textDocuments: [] } }));

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (resolve(dirname(root)) !== resolve(tmpdir()) || !basename(root).startsWith('dvx-undo-evidence-')) {
      throw new Error('Unexpected undo test directory.');
    }
    await rm(root, { recursive: true, force: true });
  }
});

const currentText = 'header\nnew\nfooter\nmanual note\n';
const applied: RecordedOperation = {
  sequence: 2, sessionId: 'session-undo', toolUseId: 'applied', toolName: 'ApplyPatch',
  operationDiff: { status: 'ready', source: 'tool-result', files: [{
    path: 'example.txt', kind: 'modified', outcome: 'applied', reversible: true,
    patch: '@@ -1,3 +1,3 @@\n header\n-old\n+new\n footer',
  }] },
};

function scopeWith(reason: Extract<OperationDiff, { status: 'unavailable' }>['reason'], notices: readonly string[] = []) {
  return loadOperationReviewScope(
    { type: 'review.open', sessionId: 'session-undo', scopeKind: 'operations', turnId: 'turn-undo' },
    [{ sequence: 1, sessionId: 'session-undo', toolUseId: 'other', toolName: 'Edit',
      operationDiff: { status: 'unavailable', reason } }, applied],
    new Map(), notices,
  );
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'dvx-undo-evidence-'));
  roots.push(root);
  await writeFile(join(root, 'example.txt'), currentText);
  return root;
}

it('undoes an applied patch after a confirmed no-op while preserving unrelated manual text', async () => {
  const root = await workspace();
  const scope = scopeWith('unchanged');
  expect(scope.files).toMatchObject([{ path: 'example.txt', restorable: true }]);
  const plan = await preflightOperationRestore(root, scope, ['example.txt']);
  expect(plan[0]?.status).toBe('restorable');
  expect(await applyOperationUndo(join(root, 'recovery'), root, plan, () => true))
    .toEqual({ complete: true, written: 1 });
  expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe('header\nold\nfooter\nmanual note\n');
});

it.each(['not-recorded', 'unattributed', 'failed', 'too-large', 'restricted', 'evicted'] as const)(
  'still blocks undo when another operation has %s evidence', async (reason) => {
    const root = await workspace();
    const scope = scopeWith(reason);
    expect(scope.files[0]?.restorable).toBe(false);
    const plan = await preflightOperationRestore(root, scope, ['example.txt']);
    expect(plan[0]).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('evidence is unavailable') });
    expect(await applyOperationUndo(join(root, 'recovery'), root, plan, () => true))
      .toMatchObject({ complete: false, written: 0 });
    expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe(currentText);
  },
);

it('keeps incomplete child evidence blocking even when the direct no-op is confirmed', async () => {
  const root = await workspace();
  const scope = scopeWith('unchanged', ['Child operation history is incomplete.']);
  const plan = await preflightOperationRestore(root, scope, ['example.txt']);
  expect(plan[0]).toMatchObject({ status: 'unsupported', reason: 'Child operation history is incomplete.' });
  expect(await applyOperationUndo(join(root, 'recovery'), root, plan, () => true))
    .toMatchObject({ complete: false, written: 0 });
  expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe(currentText);
});
