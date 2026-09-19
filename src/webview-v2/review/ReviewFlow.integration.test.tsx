import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { ReviewApp } from './ReviewApp';
import { ReviewCoordinator } from '../../extension/review/reviewCoordinator';
import { createTurnSnapshotStore, type TurnSnapshotStore } from '../../extension/changes/turnSnapshots';
import type { ChangeStatsPersistence } from '../../extension/changes/changeStats';
import { parseReviewWebviewMessage, type ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import { parseReviewPanelRequest } from '../../shared/protocol/reviewPanelProtocol';
import { isId, isSafeWorkspaceRelativePath } from '../../shared/validation/guards';

// Keep Host imports in Node mode; provide a DOM only for the React workbench.
const environment = await vi.hoisted(async () => {
  const { builtinEnvironments } = await import('vitest/runtime');
  return builtinEnvironments.jsdom.setup(globalThis, {});
});
afterAll(() => environment.teardown(globalThis));
configure({ asyncUtilTimeout: 5_000 });

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
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('round-trips real snapshot Diff, mark-and-next and guarded restore through the workbench', async () => {
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
  let state: ReviewScopeState | undefined;
  let sequence = 0;
  const deliver = (message: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); });
  coordinator = new ReviewCoordinator({
    getWorkspaceRoot: () => root, snapshots, persistence, storageDir: join(directory, 'restore'),
    openSelectionInEditor: false,
    fileDiff: { openDiff: async () => 'opened-diff' },
    readCanonicalTurnFiles: () => ['a.ts', 'b.ts'].map((path) => ({ path, additions: 1, deletions: 1 })),
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
  await screen.findByText('changed a');
  expect(state?.files[0]?.version).not.toBe('unavailable');
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark & next' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Mark & next' }));
  await screen.findByText('changed b');
  expect(state?.reviewedCount).toBe(1);
  expect(state?.currentIndex).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Restore file…' }));
  await screen.findByRole('button', { name: 'Confirm restore' });
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm restore' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
  await screen.findByText('File restored to its before-turn state.');
  expect(await readFile(b, 'utf8')).toBe('original b\n');
  expect(await readFile(a, 'utf8')).toBe('changed a\n');
  // The displayed comparison remains frozen after the worktree restore.
  await screen.findByText('changed b');
  fireEvent.click(screen.getByRole('button', { name: 'Previous file' }));
  await screen.findByText('changed a');
  fireEvent.click(screen.getByRole('button', { name: 'Restore file…' }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm restore' }).disabled).toBe(false));
  await writeFile(a, 'newer user edit\n');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
  await screen.findByText('Restore stopped because 1 file(s) changed or are unavailable.');
  expect(await readFile(a, 'utf8')).toBe('newer user edit\n');
  await coordinator.replay('s1');
  await Promise.all(pending);
  expect(failures).toEqual([]);
}, 30_000);
