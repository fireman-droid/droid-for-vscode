import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createTurnSnapshotStore } from '../changes/turnSnapshots';
import { readPendingWorkspaceTurn } from '../changes/workspaceTurnLease';
import {
  available, catalogEntry, createCatalog, createController, createMemoryPersistence,
  createMockRuntime, deferred, ready, send, successfulTurn, waitForConnected,
} from './controllerTestHarness';

const home = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => home.path }));
vi.mock('../changes/snapshotWorkspaceFiles', () => ({
  snapshotWorkspaceFiles: async () => [], isSnapshotWorkspacePath: () => true,
}));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dvx-preparation-'));
  home.path = join(directory, 'home');
  const root = join(directory, 'workspace');
  await mkdir(root);
  let beforeCapture: (() => Promise<void>) | undefined;
  const snapshots = createTurnSnapshotStore(() => root, join(directory, 'snapshots'), createMemoryPersistence(), {
    runGit: async args => {
      if (args.includes('write-tree')) {
        const pending = beforeCapture;
        beforeCapture = undefined;
        await pending?.();
      }
      return { stdout: Buffer.from(args.includes('rev-parse')
          ? join(root, '.git', ...(args.includes('--absolute-git-dir') ? [] : ['objects']))
          : args.includes('write-tree') ? 'a'.repeat(40) : ''),
        code: 0, timedOut: false };
    },
    copyFile: async () => { throw Object.assign(new Error('missing index'), { code: 'ENOENT' }); },
    mkdir: async () => {}, unlink: async () => {}, rm: async () => {},
    readdir: async () => [], stat: async () => ({ size: 0, isDirectory: () => false }),
  });
  const finish = deferred<void>();
  const first = Object.assign(createMockRuntime(async function* () {
    yield { type: 'text-delta' as const, text: 'working' };
    await finish.promise;
    yield successfulTurn();
  }), { supportsBackgroundTurns: () => true });
  const second = createMockRuntime();
  second.initialize.mockResolvedValue(available('session-2'));
  const { controller, messages } = createController(vi.fn().mockReturnValueOnce(first).mockReturnValue(second),
    { cwd: root, trusted: true }, createCatalog([catalogEntry('session-1'), catalogEntry('session-2')]), undefined,
    { loadHistory: async () => ({ status: 'available', state: { transcript: [], historyStatus: 'complete', truncated: false } }) });
  Object.defineProperty(controller, 'turnSnapshots', { value: snapshots });
  ready(controller);
  await waitForConnected(messages);
  const switchSession = async () => {
    controller.handleMessage({ type: 'session.select', sessionId: 'session-2' });
    await vi.waitFor(() => {
      expect(controller.sessionState.sessionId).toBe('session-2');
      expect(controller.sessionState.connection).toMatchObject({ status: 'connected' });
      expect(controller.sessionState.sessionOperationInProgress).toBe(false);
    });
  };
  return {
    controller, snapshots, first, second, root, switchSession,
    deferCapture: (pending: () => Promise<void>) => { beforeCapture = pending; },
    async close() {
      finish.resolve();
      await controller.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('session switching before runtime dispatch', () => {
  it.each(['before-capture', 'dispatch-reservation'] as const)(
    'releases the actual workspace lease after switching during %s', async phase => {
      const f = await fixture();
      const entered = deferred<void>();
      const release = deferred<void>();
      const pause = async (turnId: string) => {
        if (turnId === 'turn-a') { entered.resolve(); await release.promise; }
      };
      if (phase === 'before-capture') {
        f.deferCapture(() => pause('turn-a'));
      } else {
        const dispatch = f.snapshots.markDispatched!.bind(f.snapshots);
        f.snapshots.markDispatched = async scope => { await dispatch(scope); await pause(scope.turnId); };
      }
      try {
        send(f.controller, 'session-1', 'turn-a', 'Do not submit this');
        await entered.promise;
        await f.switchSession();
        send(f.controller, 'session-2', 'turn-b', 'Run after releasing A');
        expect(f.controller.turnState.turn).toMatchObject({ turnId: 'turn-b', status: 'submitting' });
        expect(f.first.sendTurn).not.toHaveBeenCalled();
        expect(f.second.sendTurn).not.toHaveBeenCalled();
        release.resolve();
        await vi.waitFor(() => expect(f.second.sendTurn).toHaveBeenCalledOnce());
        expect(f.first.sendTurn).not.toHaveBeenCalled();
        expect(f.snapshots.read('session-1', 'turn-a')?.after).toBeUndefined();
      } finally { release.resolve(); await f.close(); }
    },
  );

  it('keeps a dispatched daemon turn and its durable workspace owner on switch', async () => {
    const f = await fixture();
    try {
      send(f.controller, 'session-1', 'turn-a', 'Keep running');
      await vi.waitFor(() => expect(f.first.sendTurn).toHaveBeenCalledOnce());
      await f.switchSession();
      expect(await readPendingWorkspaceTurn(f.root)).toEqual({ sessionId: 'session-1', turnId: 'turn-a' });
      expect(f.first.interrupt).not.toHaveBeenCalled();
      expect(f.snapshots.read('session-1', 'turn-a')?.after).toBeUndefined();
    } finally { await f.close(); }
  });
});
