import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import { applyOperationUndo, readOperationUndoState } from './operationUndoFiles';
import { loadOperationReviewScope, preflightOperationRestore, type RecordedOperation } from './reviewOperationScope';
import { parseOperationResult } from '../../runtime/tools/operationResult';

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

it.each(['exact', 'changed', 'ambiguous', 'missing-edit'] as const)(
  'checks the actual file before undoing a count-corrected ApplyPatch result: %s', async mode => {
    const root = await workspace();
    const input = `*** Begin Patch\n*** Update File: ${join(root, 'example.txt')}\n@@\n-old\n+new\n${mode === 'missing-edit' ? '-omitted old\n+omitted new\n' : ''}*** End Patch`;
    const operationDiff = parseOperationResult('applypatch', { input }, JSON.stringify({ success: true,
      files: [{ file_path: join(root, 'example.txt'), display_operation: 'update',
        diff: '@@ -1,4 +1,4 @@\n header\n-old\n+new\n footer' }] }), root, 'applied', 'session-undo');
    const scope = loadOperationReviewScope(
      { type: 'review.open', sessionId: 'session-undo', scopeKind: 'operations', turnId: 'turn-undo' },
      [{ ...applied, operationDiff }], new Map());
    const current = mode === 'changed' ? currentText.replace('new', 'manual edit')
      : mode === 'ambiguous' ? currentText + currentText : currentText;
    await writeFile(join(root, 'example.txt'), current);
    const plan = await preflightOperationRestore(root, scope, ['example.txt']);
    expect(plan[0]?.status).toBe(mode === 'exact' ? 'restorable' : mode === 'missing-edit' ? 'unsupported' : 'conflicted');
    const result = await applyOperationUndo(join(root, 'recovery'), root, plan, () => true);
    expect(result).toMatchObject({ complete: mode === 'exact', written: mode === 'exact' ? 1 : 0 });
    expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe(mode === 'exact' ? currentText.replace('new', 'old') : current);
  },
);

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

it.each([false, true])('deletes a confirmed new file only while its exact contents match (manual edits: %s)', async changed => {
  const root = await workspace();
  const created = 'AI-created file\n';
  await writeFile(join(root, 'created.txt'), created + (changed ? 'manual addition\n' : ''));
  const scope = loadOperationReviewScope(
    { type: 'review.open', sessionId: 'session-undo', scopeKind: 'operations', turnId: 'turn-create' },
    [{ ...applied, toolUseId: 'create', operationDiff: { status: 'ready', source: 'tool-result', files: [{
      path: 'created.txt', kind: 'added', outcome: 'applied', patch: '@@ -0,0 +1 @@\n+AI-created file',
      createdContentHash: createHash('sha256').update(created).digest('hex'),
    }] } }], new Map());
  const plan = await preflightOperationRestore(root, scope, ['created.txt']);
  expect(plan[0]?.status).toBe(changed ? 'conflicted' : 'restorable');
  expect(await applyOperationUndo(join(root, 'recovery'), root, plan, () => true))
    .toMatchObject({ complete: !changed, written: changed ? 0 : 1 });
  if (changed) expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe(created + 'manual addition\n');
  else await expect(readFile(join(root, 'created.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe(currentText);
});

it('retains undo receipts after reloading and rejects replay even if the same bytes reappear', async () => {
  const root = await workspace(), storage = join(root, 'recovery');
  const scope = scopeWith('unchanged');
  const plan = await preflightOperationRestore(root, scope, ['example.txt']);
  expect(await applyOperationUndo(storage, root, plan, () => true)).toMatchObject({ complete: true });
  const recovered = await readOperationUndoState(storage, root);
  expect([...recovered.undone]).toEqual(plan[0]?.operationKeys);
  await writeFile(join(root, 'example.txt'), currentText);
  expect(await applyOperationUndo(storage, root, plan, () => true))
    .toMatchObject({ complete: false, written: 0, reason: expect.stringContaining('already undone') });
  expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe(currentText);
});
