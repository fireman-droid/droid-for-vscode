import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '../../../runtime/daemon/api';
import type { DaemonMissionCatalogRow } from '../../../runtime/daemon/DaemonMissionCatalog';
import { cancellingRuntimeInteractionHandler } from '../../../runtime/events/runtimeInteractions';
import { handleSessionSelect, UNKNOWN_SESSION_MESSAGE } from '../sessions/sessionDirectory';
import { MissionGateway } from './MissionGateway';
import { MissionPreferenceStore } from './MissionPreferences';
import { openCatalogMission } from './catalogSession';

const cwd = path.resolve('mission-catalog-workspace');

async function fixture(rows: readonly DaemonMissionCatalogRow[] = [{
  sessionId: 'older-mission', updatedAt: 10, cwd,
  mission: { state: 'paused', title: 'Older Mission' },
}], pageSize = 100) {
  let offset = 0;
  const listPage = vi.fn(async () => {
    const pageRows = rows.slice(offset, offset + pageSize);
    offset += pageSize;
    return { rows: pageRows, hasMore: offset < rows.length, nextCursor: 1_000 - offset };
  });
  const gateway = new MissionGateway({
    getDroid: async () => ({}) as DaemonApi,
    preferences: new MissionPreferenceStore({ get: () => undefined, update: async () => {} }),
    prepareInteractions: () => ({ handler: cancellingRuntimeInteractionHandler, activate() {} }),
    createRuntime: () => ({ runtime: {} as never, initialize: async () => {} }),
    catalogRuntime: { listPage },
  });
  const result = await gateway.listCatalog();
  if (result.status !== 'ready' || result.rows[0] === undefined) throw new Error('Invalid fixture');
  const ctl = {
    missionGateway: gateway,
    getWorkspaceContext: () => ({ cwd, trusted: true }),
    sessionState: { sessionId: 'current', activeRuntimeCwd: cwd },
    catalogState: {
      catalogCwd: cwd,
      sessions: { status: 'ready', items: [] },
    },
    recoveryStore: { resolveConversationId: () => undefined },
    effects: { canReplaceSession: vi.fn(() => true), startReplacement: vi.fn() },
    emitSnapshot: vi.fn(),
    emitSessionDiagnostic: vi.fn(),
  };
  const open = (catalogId = result.rows[0]!.catalogId) =>
    openCatalogMission(ctl as never, catalogId);
  return { ctl, gateway, listPage, rows: result.rows, catalogId: result.rows[0].catalogId, open };
}

describe('Mission catalog selection', () => {
  it('opens a verified old Mission absent from the recent-chat directory', async () => {
    const { ctl, open } = await fixture();
    expect(open()).toBe('older-mission');
    expect(ctl.effects.startReplacement).toHaveBeenCalledWith({
      kind: 'resume', cwd, sessionId: 'older-mission',
    });
    expect(ctl.catalogState.sessions.items).toEqual([]);
  });

  it('keeps ordinary session selection restricted to its own workspace directory', async () => {
    const { ctl } = await fixture();
    handleSessionSelect(ctl as never, 'older-mission');
    expect(ctl.effects.startReplacement).not.toHaveBeenCalled();
    expect(ctl.emitSessionDiagnostic).toHaveBeenCalledWith(
      'session-selection-invalid', UNKNOWN_SESSION_MESSAGE,
    );
  });

  it('rejects an id that was not returned by the Host Mission catalog', async () => {
    const { ctl, open } = await fixture();
    expect(open('forged-catalog-id')).toBeNull();
    expect(ctl.effects.startReplacement).not.toHaveBeenCalled();
  });

  it.each([undefined, 'relative/workspace', path.resolve('another-workspace')])(
    'does not resume a Mission with an unavailable or different workspace (%s)', async targetCwd => {
      const { ctl, open } = await fixture([{
        sessionId: 'other-mission', updatedAt: 10, hostId: 'local-host', cwd: targetCwd,
        mission: { state: 'paused' },
      }]);
      expect(open()).toBeNull();
      expect(ctl.effects.startReplacement).not.toHaveBeenCalled();
    },
  );

  it('respects session replacement eligibility', async () => {
    const { ctl, open } = await fixture();
    ctl.effects.canReplaceSession.mockReturnValue(false);
    expect(open()).toBeNull();
    expect(ctl.effects.startReplacement).not.toHaveBeenCalled();
  });

  it('does not open a Mission in an untrusted workspace', async () => {
    const { ctl, open } = await fixture();
    ctl.getWorkspaceContext = () => ({ cwd, trusted: false });
    expect(open()).toBeNull();
    expect(ctl.effects.startReplacement).not.toHaveBeenCalled();
  });

  it('replays the current Mission without replacing its runtime', async () => {
    const { ctl, open } = await fixture();
    ctl.sessionState.sessionId = 'older-mission';
    expect(open()).toBe('older-mission');
    expect(ctl.effects.startReplacement).not.toHaveBeenCalled();
    expect(ctl.emitSnapshot).toHaveBeenCalledOnce();
  });

  it('opens the workspace recorded by the selected newest Mission metadata', async () => {
    const { ctl, gateway, catalogId, open } = await fixture([{
      sessionId: 'duplicate', updatedAt: 20, cwd: path.resolve('old-workspace'),
      mission: { state: 'paused', workingDirectory: cwd, updatedAt: '2026-09-22T01:00:00.000Z' },
    }, {
      sessionId: 'duplicate', updatedAt: 10, cwd: path.resolve('old-workspace'),
      mission: { state: 'running', updatedAt: '2026-09-21T01:00:00.000Z' },
    }]);
    expect(gateway.targetForCatalogId(catalogId)).toEqual({ sessionId: 'duplicate', cwd });
    expect(open()).toBe('duplicate');
    expect(ctl.effects.startReplacement).toHaveBeenCalledWith({ kind: 'resume', cwd, sessionId: 'duplicate' });
  });

  it('joins the daemon session and Mission-record pairs without exposing Mission ids as sessions', async () => {
    const recordTime = '2026-09-22T02:47:31.359Z';
    const session = (sessionId: string, missionId: string): DaemonMissionCatalogRow => ({
      sessionId, hostId: 'local-host', updatedAt: 100, cwd, repoRoot: cwd,
      messagesCount: 4, title: 'Duration library',
      tags: [{ name: 'mission-orchestrator' }, { name: 'sdk' },
        { name: 'mission-session', metadata: { role: 'orchestrator', missionId } }],
      mission: { state: 'planning', title: 'Duration library', workingDirectory: cwd },
    });
    const { ctl, gateway, listPage, rows, open } = await fixture([
      session('session-a', 'mission-a'), session('session-b', 'mission-b'),
      { sessionId: 'mission-a', updatedAt: 90, mission: {
        state: 'paused', workingDirectory: cwd, createdAt: recordTime, updatedAt: recordTime,
      } },
      { sessionId: 'mission-b', updatedAt: 80, mission: {
        state: 'awaiting_input', workingDirectory: cwd, createdAt: recordTime, updatedAt: recordTime,
      } },
      // Same directory/title is not evidence that this orphan has a session.
      { sessionId: 'orphan-mission', updatedAt: 200, mission: {
        state: 'completed', title: 'Duration library', workingDirectory: cwd,
      } },
    ], 2);
    expect(rows).toHaveLength(2);
    expect(listPage).toHaveBeenCalledTimes(3);
    expect(rows.map(row => row.lifecycle).sort()).toEqual(['awaiting_input', 'paused']);
    for (const row of rows) {
      expect(row).toMatchObject({ title: 'Duration library', createdAt: recordTime, updatedAt: recordTime });
      const target = gateway.targetForCatalogId(row.catalogId);
      expect(['session-a', 'session-b']).toContain(target?.sessionId);
      expect(open(row.catalogId)).toBe(target?.sessionId);
    }
    expect(ctl.effects.startReplacement.mock.calls.map(([target]) => target.sessionId).sort())
      .toEqual(['session-a', 'session-b']);
  });

  it('accepts two filesystem aliases for the same workspace', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'droidvisx-mission-alias-'));
    const actual = path.join(root, 'actual');
    const alias = path.join(root, 'alias');
    try {
      mkdirSync(actual);
      symlinkSync(actual, alias, 'junction');
      const { ctl, open } = await fixture([{
        sessionId: 'aliased-mission', updatedAt: 10, cwd: actual,
        mission: { state: 'paused', workingDirectory: actual },
      }]);
      ctl.getWorkspaceContext = () => ({ cwd: alias, trusted: true });
      expect(open()).toBe('aliased-mission');
      expect(ctl.effects.startReplacement).toHaveBeenCalledWith({
        kind: 'resume', cwd: alias, sessionId: 'aliased-mission',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
