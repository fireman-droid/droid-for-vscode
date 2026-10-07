import './reviewBrowserTestSetup';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ReviewApp } from './ReviewApp';
import { ReviewCoordinator } from '../../extension/review/reviewCoordinator';
import { createTurnSnapshotStore, type TurnSnapshotStore } from '../../extension/changes/turnSnapshots';
import type { ChangeStatsPersistence } from '../../extension/changes/changeStats';
import { parseReviewWebviewMessage, type ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import { parseReviewPanelRequest } from '../../shared/protocol/reviewPanelProtocol';
import { isId, isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type { RecordedOperation } from '../../extension/review/reviewOperationScope';

// Keep Host imports in Node mode; provide a DOM only for the React workbench.
const environment = await vi.hoisted(async () => {
  const { builtinEnvironments } = await import('vitest/runtime');
  return builtinEnvironments.jsdom.setup(globalThis, {});
});
afterAll(() => environment.teardown(globalThis));
configure({ asyncUtilTimeout: 5_000 });
beforeEach(() => {
  // This Node/Host suite creates its DOM after setupFiles, so install its browser APIs here.
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

vi.mock('vscode', () => {
  const disposable = () => ({ dispose() {} });
  return { workspace: {
    createFileSystemWatcher: () => ({ dispose() {}, onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable }),
    onDidChangeTextDocument: disposable, textDocuments: [],
  } };
});
const roots: string[] = [];
let snapshots: TurnSnapshotStore | undefined;
let coordinator: ReviewCoordinator | undefined;
const pending = new Set<Promise<void>>();
afterEach(async () => {
  cleanup();
  await coordinator?.replay('s1');
  await Promise.allSettled(pending);
  coordinator?.dispose();
  await snapshots?.dispose();
  for (const root of roots.splice(0)) {
    if (resolve(dirname(root)) !== resolve(tmpdir()) || !basename(root).startsWith('dvx-review-flow-'))
      throw new Error('Unexpected review test directory.');
    await rm(root, { recursive: true, force: true });
  }
});

it('round-trips snapshot review and guarded confirmed-operation undo through Host, UI and real files', async () => {
  const user = userEvent.setup();
  const directory = await mkdtemp(join(tmpdir(), 'dvx-review-flow-'));
  roots.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root);
  const a = join(root, 'a.ts');
  const b = join(root, 'b.ts');
  await writeFile(a, 'original a\n');
  await writeFile(b, 'original b\n');
  const values = new Map<string, unknown>();
  const persistence: ChangeStatsPersistence = {
    get: <T,>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => { values.set(key, value); },
  };
  const turn = { sessionId: 's1', turnId: 't1' };
  snapshots = createTurnSnapshotStore(() => root, join(directory, 'snapshots'), persistence);
  expect(await snapshots.capture(turn, 'before')).toBeDefined();
  await writeFile(a, 'changed a\n');
  await writeFile(b, 'changed b\n');
  expect(await snapshots.capture(turn, 'after')).toBeDefined();
  const operations: RecordedOperation[] = ['a', 'b'].map((name, index) => ({
    sequence: index + 1, sessionId: 's1', toolUseId: `edit-${name}`, toolName: 'ApplyPatch',
    operationDiff: { status: 'ready', source: 'tool-result', files: [{
      path: `${name}.ts`, kind: 'modified', outcome: 'applied', reversible: true,
      patch: `@@ -1 +1 @@\n-original ${name}\n+changed ${name}`,
    }] },
  }));
  let state: ReviewScopeState | undefined;
  let sequence = 0;
  const deliver = (message: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); });
  coordinator = new ReviewCoordinator({
    getWorkspaceRoot: () => root, snapshots, persistence, storageDir: join(directory, 'restore'),
    openSelectionInEditor: false,
    fileDiff: { openDiff: async () => 'opened-diff' },
    readCanonicalTurnFiles: () => ['a.ts', 'b.ts'].map((path) => ({ path, additions: 1, deletions: 1 })),
    readTurnOperations: () => operations,
    readWorkspaceFiles: async () => undefined, readBranchDiff: async () => undefined,
    publish(message) {
      if (message.type === 'review.state') state = message.state;
      deliver({ ...message, sequence: ++sequence });
    },
  });
  const failures: unknown[] = [];
  const port = { postMessage(value: unknown) {
    const panel = parseReviewPanelRequest(value);
    if (panel?.type === 'reviewPanel.readFile') {
      const task = coordinator!.readFile({ ...panel, sessionId: 's1' }).then((result) => {
        deliver({ type: 'reviewPanel.file', ...result, requestId: panel.requestId,
          reviewScopeId: panel.reviewScopeId, path: panel.path, error: null });
      });
      pending.add(task);
      void task.catch((error) => { failures.push(error); }).finally(() => pending.delete(task));
    } else {
      const message = parseReviewWebviewMessage(value, isId, isSafeWorkspaceRelativePath);
      if (message) coordinator!.handle(message);
    }
  } };
  render(<ReviewApp port={port} />);
  deliver({ type: 'reviewPanel.context', sessionId: 's1', valid: true, latestTurnId: 't1', operation: null, operationPath: null });
  coordinator.handle({ type: 'review.open', ...turn, scopeKind: 'turn' });
  await waitFor(() => expect(screen.getByRole('region', { name: 'Diff for a.ts' }).textContent).toContain('changed a'));
  expect(state?.files[0]?.version).not.toBe('unavailable');
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark a.ts viewed' }).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Actions for a.ts' }));
  await user.click(screen.getByRole('menuitem', { name: 'Mark viewed & next' }));
  await waitFor(() => expect(state?.currentIndex).toBe(1));
  expect(screen.getByRole('region', { name: 'Diff for b.ts' }).textContent).toContain('changed b');
  expect(state?.reviewedCount).toBe(1);
  expect(state?.currentIndex).toBe(1);
  expect(screen.queryByRole('button', { name: 'Undo file operations…' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Undo turn operations…' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Agent Turn/ }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Recorded Edits', exact: true }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Diff for a.ts' }).textContent).toContain('changed a'));
  await waitFor(() => expect(state?.scopeKind).toBe('operations'));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark a.ts viewed' }).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: 'Actions for a.ts' }));
  await user.click(screen.getByRole('menuitem', { name: 'Mark viewed & next' }));
  await waitFor(() => expect(state?.currentIndex).toBe(1));
  expect(screen.getByRole('region', { name: 'Diff for b.ts' }).textContent).toContain('changed b');
  expect(state?.reviewedCount).toBe(1);
  expect(state?.currentIndex).toBe(1);
  await writeFile(b, 'changed b\nmanual note\n');
  await user.click(screen.getByRole('button', { name: 'Actions for b.ts' }));
  await user.click(screen.getByRole('menuitem', { name: 'Undo this file…' }));
  await screen.findByRole('button', { name: 'Confirm undo' });
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm undo' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm undo' }));
  await screen.findByText('The confirmed file operation was undone.');
  expect(await readFile(b, 'utf8')).toBe('original b\nmanual note\n');
  expect(await readFile(a, 'utf8')).toBe('changed a\n');
  // Recorded evidence stays readable after undo; unrelated manual text is preserved.
  await waitFor(() => expect(screen.getByRole('region', { name: 'Diff for b.ts' }).textContent).toContain('changed b'));
  await user.click(screen.getByRole('button', { name: 'Actions for b.ts' }));
  await user.click(screen.getByRole('menuitem', { name: 'Previous file' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Diff for a.ts' }).textContent).toContain('changed a'));
  await user.click(screen.getByRole('button', { name: 'Actions for a.ts' }));
  await user.click(screen.getByRole('menuitem', { name: 'Undo this file…' }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm undo' }).disabled).toBe(false));
  await writeFile(a, 'newer user edit\n');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm undo' }));
  await screen.findByText('Undo stopped because 1 file(s) changed or are unavailable. Preview again.');
  expect(await readFile(a, 'utf8')).toBe('newer user edit\n');
  await coordinator.replay('s1');
  await Promise.all(pending);
  expect(failures).toEqual([]);
}, 30_000);
