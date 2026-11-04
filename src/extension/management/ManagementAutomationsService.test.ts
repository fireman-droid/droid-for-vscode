import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '../../runtime/daemon/api';
import type { AutomationDraft } from '../../shared/protocol/automationProtocol';
import { ManagementAutomationsService } from './ManagementAutomationsService';
import type { AutomationEntry, AutomationIssue } from './automationData';

const targetId = 'ab5f3b8e-34bb-4aca-80b9-a7c391cb80a6';
const runSessionId = '1066984a-82ee-4cb5-a570-378516837048';
const draft: AutomationDraft = { name: 'Daily checks', description: 'Repository checks', prompt: 'Inspect and report.',
  schedule: '0 9 * * 1-5', model: '', reasoningEffort: '', workingDirectory: '', targetSessionId: null };
function harness() {
  const entry: AutomationEntry = { id: 'daily', uuid: 'uuid-daily', name: draft.name, description: draft.description,
    prompt: draft.prompt, schedule: draft.schedule, status: 'paused', isValid: true, path: '/automations/daily',
    tags: ['keep'], privacyLevel: 'organization', sessionPrivacy: 'team' };
  const entries = [entry];
  const find = (id: string) => entries.find(row => row.id === id || row.uuid === id)!;
  const automations = {
    list: vi.fn().mockImplementation(async () => structuredClone(entries)),
    create: vi.fn().mockImplementation(async params => {
      entries.push({ id: params.id, uuid: `uuid-${params.id}`, name: params.name, prompt: params.instructions,
        description: params.description, schedule: params.schedule, status: params.paused ? 'paused' : 'active',
        targetSessionId: params.targetSessionId, model: params.model, reasoningEffort: params.reasoningEffort,
        privacyLevel: params.privacyLevel, sessionPrivacy: params.sessionPrivacy, isValid: true, path: `/automations/${params.id}` });
      return { success: true, automationId: `uuid-${params.id}` };
    }),
    update: vi.fn().mockImplementation(async params => {
      const row = find(params.automationDirName ?? params.automationId);
      for (const key of ['name', 'description', 'prompt', 'schedule', 'model', 'reasoningEffort', 'workingDirectory'] as const) {
        if (params[key] !== undefined) row[key] = params[key];
      }
      if (params.paused !== undefined) row.status = params.paused ? 'paused' : 'active';
      return { success: true };
    }),
    dispatch: vi.fn().mockResolvedValue({ success: true, sessionId: runSessionId }),
    run: vi.fn(), pause: vi.fn().mockImplementation(async id => { find(id).status = 'paused'; return { success: true }; }),
    resume: vi.fn().mockImplementation(async id => { find(id).status = 'active'; return { success: true }; }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getHistory: vi.fn().mockResolvedValue({ automationId: 'uuid-daily', runs: [], totalCount: 0 }),
    getVisual: vi.fn().mockResolvedValue({ exists: true, content: '<p>Report</p>', isStale: true, s3Url: 'https://private.invalid/token' }),
  };
  const trusted = vi.fn(() => true);
  const confirm = vi.fn().mockResolvedValue(true);
  const models = { list: vi.fn().mockResolvedValue([{ id: 'model', supportedReasoningEfforts: ['low'], disabled: false }]) };
  const workspace = { validateDirectory: vi.fn().mockResolvedValue({ isValid: true }) };
  const sessionRows = [targetId, runSessionId].map(sessionId => ({ sessionId, title: `Chat ${sessionId}`, cwd: 'C:/repo', updatedAt: 100 }));
  const sessions = { listPage: vi.fn().mockResolvedValue({ sessions: sessionRows, hasMore: false }) };
  const access = { activeId: () => targetId, view: vi.fn(), resume: vi.fn().mockResolvedValue(undefined), chooseDirectory: vi.fn().mockResolvedValue('C:/repo') };
  const issueMap = new Map<string, AutomationIssue>();
  const issues = { get: (id: string) => issueMap.get(id), set: async (id: string, issue: AutomationIssue | undefined) => {
    if (issue) issueMap.set(id, issue); else issueMap.delete(id);
  } };
  const api = { automations, models, workspace, sessions } as unknown as DaemonApi;
  const service = new ManagementAutomationsService(async () => api, true, trusted, confirm, undefined, access, issues);
  const row = async (id = 'daily') => (await service.execute({ kind: 'automations.list' })).automations!.find(item => item.id === id)!;
  return { entry, entries, automations, trusted, confirm, models, workspace, sessions, sessionRows, access, issues, api, service, row };
}

describe('local Automation management', () => {
  it('lists local and registered-local entries without exposing owner PII', async () => {
    const h = harness();
    h.automations.list.mockResolvedValue([
      h.entry, { ...h.entry, id: 'registered', machineId: 'local', computerId: 'byom', createdBy: { email: 'private@example.invalid' } },
      { ...h.entry, id: 'remote', machineId: 'remote', computerId: 'computer' },
      { ...h.entry, id: 'environment', executionTemplateId: 'template' },
    ]);
    const result = await h.service.execute({ kind: 'automations.list' });
    expect(result.automations?.map(row => row.id)).toEqual(['daily', 'registered']);
    expect(JSON.stringify(result)).not.toContain('private@example.invalid');
  });
  it('creates and verifies private paused scaffolds without starting a first run', async () => {
    const h = harness();
    const result = await h.service.execute({ kind: 'automations.create', draft });
    expect(h.automations.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: draft.name, instructions: draft.prompt, schedule: draft.schedule,
      paused: true, skipFirstRun: true, privacyLevel: 'private', sessionPrivacy: 'private',
    }));
    expect(result.automationId).toBe(h.entries[1].id);
    expect((await h.row(result.automationId)).blockedReason).toBeNull();
    expect(h.automations.dispatch).not.toHaveBeenCalled();
    expect(h.automations.resume).not.toHaveBeenCalled();
  });
  it('keeps a partial scaffold paused, navigable and blocked rather than retrying or deleting it', async () => {
    const h = harness(); h.automations.update.mockResolvedValue({ success: false, error: 'cannot apply' });
    const result = await h.service.execute({ kind: 'automations.create', draft: { ...draft, workingDirectory: 'C:/repo' } });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('paused') });
    const row = await h.row(result.automationId);
    expect(row.blockedReason).toBeTruthy();
    await expect(h.service.execute({ kind: 'automations.resume', id: row.id, revision: row.revision })).rejects.toThrow('verified');
    expect(h.automations.create).toHaveBeenCalledTimes(1);
    expect(h.automations.delete).not.toHaveBeenCalled();
  });
  it('creates bound tasks without model overrides and rejects silent target loss across service recreation', async () => {
    const h = harness();
    const saved = await h.service.execute({ kind: 'automations.create', draft: { ...draft, targetSessionId: targetId, model: 'missing' } });
    expect((await h.row(saved.automationId)).targetSessionId).toBe(targetId);
    expect(h.automations.create.mock.calls[0][0]).not.toHaveProperty('model');
    const create = h.automations.create.getMockImplementation()!;
    h.automations.create.mockImplementation(async params => { const result = await create(params); delete h.entries.at(-1)!.targetSessionId; return result; });
    const result = await h.service.execute({ kind: 'automations.create', draft: { ...draft, targetSessionId: targetId } });
    expect(result.ok).toBe(false);
    const service = new ManagementAutomationsService(async () => h.api, true, h.trusted, h.confirm, undefined, h.access, h.issues);
    const row = await h.row(result.automationId);
    await expect(service.execute({ kind: 'automations.resume', id: row.id, revision: row.revision })).rejects.toThrow('verified');
    expect(h.automations.resume).not.toHaveBeenCalled();
  });
  it('dispatches immediately without confirmation and never prepares a prompt instead', async () => {
    const h = harness(); const row = await h.row();
    h.confirm.mockResolvedValue(false);
    await h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.automations.dispatch).toHaveBeenCalledExactlyOnceWith('daily');
    expect(h.automations.run).not.toHaveBeenCalled();
  });
  it('retains enable/delete confirmation and never retries an ambiguous dispatch failure', async () => {
    const h = harness(); const row = await h.row();
    h.confirm.mockResolvedValue(false);
    for (const kind of ['automations.resume', 'automations.delete'] as const) {
      await h.service.execute({ kind, id: row.id, revision: row.revision });
    }
    expect(h.confirm.mock.calls).toEqual([['resume', draft.name], ['delete', draft.name]]);
    expect(h.automations.resume).not.toHaveBeenCalled();
    expect(h.automations.delete).not.toHaveBeenCalled();
    expect(h.automations.dispatch).not.toHaveBeenCalled();
    h.automations.dispatch.mockRejectedValueOnce(new Error('connection lost'));
    await expect(h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision })).rejects.toThrow('Refresh run history');
    expect(h.automations.dispatch).toHaveBeenCalledTimes(1);
  });
  it('rechecks configuration after confirmation and rejects stale writes', async () => {
    const h = harness(); const row = await h.row();
    h.confirm.mockImplementation(async () => { h.entry.prompt = 'Changed elsewhere'; return true; });
    await expect(h.service.execute({ kind: 'automations.delete', id: row.id, revision: row.revision })).rejects.toThrow('changed');
    expect(h.automations.delete).not.toHaveBeenCalled();
  });
  it('edits bound tasks while preserving target, schedule state, privacy and tags', async () => {
    const h = harness(); h.entry.targetSessionId = targetId; const row = await h.row();
    await h.service.execute({ kind: 'automations.update', id: row.id, revision: row.revision, draft: { ...draft, targetSessionId: targetId, name: 'Updated' } });
    const params = h.automations.update.mock.calls[0][0];
    expect(params).toMatchObject({ automationId: 'uuid-daily', automationDirName: 'daily', name: 'Updated' });
    for (const key of ['privacyLevel', 'tags', 'paused', 'targetSessionId', 'model', 'reasoningEffort', 'workingDirectory']) expect(params).not.toHaveProperty(key);
    expect(h.entry).toMatchObject({ targetSessionId: targetId, tags: ['keep'], privacyLevel: 'organization', sessionPrivacy: 'team', status: 'paused' });
  });
  it('pauses and blocks a bound task when an update unexpectedly drops its binding', async () => {
    const h = harness(); h.entry.targetSessionId = targetId; h.entry.status = 'active'; const row = await h.row();
    h.automations.update.mockImplementation(async () => { delete h.entry.targetSessionId; return { success: true }; });
    await expect(h.service.execute({ kind: 'automations.update', id: row.id, revision: row.revision, draft: { ...draft, targetSessionId: targetId } })).rejects.toThrow('paused');
    expect(h.entry.status).toBe('paused');
    expect((await h.row()).blockedReason).toBeTruthy();
    expect(h.automations.update).toHaveBeenCalledTimes(1);
  });
  it('does not claim paused when safety pausing also fails', async () => {
    const h = harness(); h.entry.status = 'active'; const row = await h.row();
    h.automations.update.mockRejectedValue(new Error('offline'));
    h.automations.pause.mockRejectedValue(new Error('offline'));
    await expect(h.service.execute({ kind: 'automations.update', id: row.id, revision: row.revision, draft })).rejects.toThrow('could not be confirmed paused');
  });
  it('blocks untrusted writes and unavailable independent models before dispatch', async () => {
    const h = harness(); const row = await h.row();
    h.trusted.mockReturnValue(false);
    for (const kind of ['automations.run', 'automations.resume'] as const) {
      await expect(h.service.execute({ kind, id: row.id, revision: row.revision })).rejects.toThrow('Trust');
    }
    expect(h.automations.dispatch).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
    h.trusted.mockReturnValue(true); h.models.list.mockResolvedValue([{ id: 'model', disabled: true }]);
    await expect(h.service.execute({ kind: 'automations.create', draft: { ...draft, model: 'model' } })).rejects.toThrow('unavailable');
    expect(h.automations.create).not.toHaveBeenCalled();
  });
  it('reports backend refusals instead of successful mutations', async () => {
    const h = harness(); const row = await h.row();
    h.automations.pause.mockResolvedValue({ success: false, error: 'not paused' });
    await expect(h.service.execute({ kind: 'automations.pause', id: row.id, revision: row.revision })).rejects.toThrow('not paused');
    h.automations.dispatch.mockResolvedValue({ success: false, error: { code: 'already_running', message: 'Already running' } });
    await expect(h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision })).rejects.toThrow('Already running');
  });
  it('retains delivery identity even when the daemon drops a future delivery status', async () => {
    const h = harness();
    h.automations.getHistory.mockResolvedValue({ totalCount: 25, runs: [{
      runId: 'run', type: 'run', status: 'failed', startedAt: '2026-11-04T09:00:00Z', errorMessage: 'Run failed',
      sessionId: targetId, delivery: { reason: 'future-state' }, durationMs: 1234, isRetry: true, originalRunId: 'first',
      modelFallback: { requestedModel: 'old-model', reason: 'unknown' },
    }] });
    const result = await h.service.execute({ kind: 'automations.history', id: 'daily', offset: 20 });
    expect(h.automations.getHistory).toHaveBeenCalledExactlyOnceWith('daily', 20, 20);
    expect(result.automationHistory?.runs[0]).toMatchObject({
      sessionId: targetId, delivery: { status: null, reason: 'future-state' }, modelFallback: 'old-model: unknown',
      durationMs: 1234, originalRunId: 'first', isRetry: true,
    });
  });
  it('opens only the session belonging to the selected authoritative run, without replacing chat', async () => {
    const h = harness(); h.entry.targetSessionId = targetId;
    h.automations.getHistory.mockResolvedValue({ totalCount: 1, runs: [{ runId: 'old-run', sessionId: runSessionId }] });
    await h.service.execute({ kind: 'automations.session', id: 'daily', runId: 'old-run', offset: 0, resume: false });
    expect(h.access.view).toHaveBeenCalledWith(expect.objectContaining({ id: runSessionId, cwd: 'C:/repo' }));
    expect(h.access.resume).not.toHaveBeenCalled();
    await expect(h.service.execute({ kind: 'automations.session', id: 'daily', runId: 'other-run', offset: 0, resume: false })).rejects.toThrow('unavailable');
    expect(h.access.view).toHaveBeenCalledTimes(1);
    await h.service.execute({ kind: 'automations.session', id: 'daily', runId: null, offset: 0, resume: true });
    expect(h.access.resume).toHaveBeenCalledWith(expect.objectContaining({ id: targetId }));
  });
  it('reads target titles and pending prompts without attaching or approving anything', async () => {
    const h = harness(); h.entry.targetSessionId = targetId;
    h.sessions.listPage.mockResolvedValue({ sessions: [{ ...h.sessionRows[0], pendingPermissionRequestCount: 2, pendingAskUserRequestCount: 1 }], hasMore: false });
    const result = await h.service.execute({ kind: 'automations.target', id: 'daily' });
    expect(result.automationTarget).toMatchObject({ id: targetId, current: true, pendingPermissions: 2, pendingQuestions: 1 });
    expect(h.access.view).not.toHaveBeenCalled(); expect(h.access.resume).not.toHaveBeenCalled();
  });
  it('blocks deletion for unfinished delivery even while the schedule is paused', async () => {
    const h = harness(); const row = await h.row();
    h.automations.getHistory.mockResolvedValue({ totalCount: 1, runs: [{ status: 'success', delivery: { status: 'pending' } }] });
    await expect(h.service.execute({ kind: 'automations.delete', id: row.id, revision: row.revision })).rejects.toThrow('unfinished');
    expect(h.automations.delete).not.toHaveBeenCalled();
  });
  it('reads local dashboard content without forwarding remote URLs or invoking a run', async () => {
    const h = harness();
    const result = await h.service.execute({ kind: 'automations.visual', id: 'daily' });
    expect(result.automationVisual).toEqual({ id: 'daily', exists: true, content: '<p>Report</p>', stale: true });
    expect(JSON.stringify(result)).not.toContain('private.invalid');
    expect(h.automations.dispatch).not.toHaveBeenCalled();
  });
});
