import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FactorySessionCatalog } from '../../runtime/catalog/FactorySessionCatalog';
import {
  available, createCatalog, createController, createHostTranscriptState, createMockRuntime,
  deferred, ready, seededRecoveryStore, snapshots, waitForConnected,
} from './controllerTestHarness';

describe('cold startup selection', () => {
  it('restores the selected session beyond the recent 50 rows across workspace aliases', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dvx-cold-selection-'));
    try {
      const actual = path.join(root, 'workspace');
      const alias = path.join(root, 'workspace-alias');
      const sessions = path.join(root, 'sessions');
      const stored = path.join(sessions, '-persisted-long-workspace');
      await Promise.all([mkdir(actual), mkdir(stored, { recursive: true })]);
      await symlink(actual, alias, 'junction');
      await writeFile(path.join(stored, 'saved-mission.jsonl'), JSON.stringify({
        type: 'session_start', id: 'saved-mission', title: 'Saved Mission', version: 2, cwd: actual,
      }) + '\n');
      const listSdkSessions = vi.fn(async () => Array.from({ length: 50 }, (_, index) => ({
        id: `recent-${index}`, title: `Recent ${index}`, messageCount: 1,
        modifiedTime: new Date(), createdTime: new Date(),
      })));
      const catalog = new FactorySessionCatalog({
        sessionsDirectory: sessions, listSdkSessions, readWorkerSessionIds: async () => new Set(),
      });
      const runtime = createMockRuntime();
      runtime.initialize.mockResolvedValue(available('saved-mission'));
      const history = { loadHistory: vi.fn(async () => ({ status: 'available' as const,
        state: createHostTranscriptState('complete'),
      })) };
      const recovery = await seededRecoveryStore('saved-mission');
      const { controller, messages } = createController(
        () => runtime, { cwd: alias, trusted: true }, catalog, recovery, history,
      );
      try {
        ready(controller);
        await waitForConnected(messages);
        expect(runtime.initialize).toHaveBeenCalledExactlyOnceWith({
          kind: 'resume', cwd: alias, sessionId: 'saved-mission',
        });
        expect(history.loadHistory).toHaveBeenCalledOnce();
        expect(recovery.getSelectedSessionId()).toBe('saved-mission');
        expect(listSdkSessions).toHaveBeenCalledOnce();
      } finally { await controller.dispose(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not restore an out-of-list selected id when ownership verification fails', async () => {
    const catalog = { ...createCatalog([]), canResumeSession: vi.fn(async () => false) };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('fresh-session'));
    const { controller, messages } = createController(
      () => runtime, undefined, catalog, await seededRecoveryStore('wrong-workspace'),
    );
    try {
      ready(controller);
      await waitForConnected(messages);
      expect(runtime.initialize).toHaveBeenCalledExactlyOnceWith({ kind: 'new', cwd: 'C:\\workspace' });
      expect(catalog.canResumeSession).toHaveBeenCalledExactlyOnceWith('C:\\workspace', 'wrong-workspace');
    } finally { await controller.dispose(); }
  });

  it('discards ownership verification when the workspace becomes untrusted', async () => {
    const verified = deferred<boolean>();
    const workspace = { cwd: 'C:\\workspace', trusted: true };
    const catalog = { ...createCatalog([]), canResumeSession: vi.fn(() => verified.promise) };
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime, workspace, catalog, await seededRecoveryStore('saved-session'),
    );
    try {
      ready(controller);
      await vi.waitFor(() => expect(catalog.canResumeSession).toHaveBeenCalledOnce());
      workspace.trusted = false;
      verified.resolve(true);
      await vi.waitFor(() => expect(snapshots(messages).at(-1)?.connection.status).toBe('unavailable'));
      expect(runtime.initialize).not.toHaveBeenCalled();
    } finally { await controller.dispose(); }
  });
});
