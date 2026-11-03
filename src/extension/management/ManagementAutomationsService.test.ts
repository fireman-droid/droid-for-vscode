import { describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '../../runtime/daemon/api';
import type { AutomationDraft } from '../../shared/protocol/automationProtocol';
import { ManagementAutomationsService } from './ManagementAutomationsService';

const draft: AutomationDraft = { name: 'Daily checks', description: 'Repository checks', prompt: 'Inspect and report.',
  schedule: '0 9 * * 1-5', model: '', reasoningEffort: '', workingDirectory: '' };
function harness() {
  const entry = { id: 'daily', uuid: 'uuid-daily', ...draft, status: 'paused', isValid: true, path: '/automations/daily',
    tags: ['keep'], privacyLevel: 'organization', sessionPrivacy: 'team' };
  const automations = {
    list: vi.fn().mockResolvedValue([entry]),
    create: vi.fn().mockResolvedValue({ success: true, automationId: 'created-uuid' }),
    update: vi.fn().mockResolvedValue({ success: true }),
    dispatch: vi.fn().mockResolvedValue({ success: true, sessionId: 'run-session' }),
    run: vi.fn(), pause: vi.fn().mockResolvedValue({ success: true }),
    resume: vi.fn().mockResolvedValue({ success: true }), delete: vi.fn().mockResolvedValue({ success: true }),
    getHistory: vi.fn().mockResolvedValue({ automationId: 'uuid-daily', runs: [], totalCount: 0 }),
  };
  const trusted = vi.fn(() => true);
  const confirm = vi.fn().mockResolvedValue(true);
  const models = { list: vi.fn().mockResolvedValue([{ id: 'model', supportedReasoningEfforts: ['low'], disabled: false }]) };
  const workspace = { validateDirectory: vi.fn().mockResolvedValue({ isValid: true }) };
  const api = { automations, models, workspace } as unknown as DaemonApi;
  const service = new ManagementAutomationsService(async () => api, true, trusted, confirm);
  const row = async () => (await service.execute({ kind: 'automations.list' })).automations![0];
  return { entry, automations, trusted, confirm, models, workspace, api, service, row };
}

describe('local Automation management', () => {
  it('lists local and registered-local entries, excluding remote targets without exposing owner PII', async () => {
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
  it('creates private paused scaffolds without starting a first run', async () => {
    const h = harness();
    await h.service.execute({ kind: 'automations.create', draft });
    expect(h.automations.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: draft.name, instructions: draft.prompt, schedule: draft.schedule,
      paused: true, skipFirstRun: true, privacyLevel: 'private', sessionPrivacy: 'private',
    }));
    expect(h.automations.dispatch).not.toHaveBeenCalled();
    expect(h.automations.resume).not.toHaveBeenCalled();
  });
  it('keeps a partially configured scaffold paused and reports the working-directory failure', async () => {
    const h = harness(); h.automations.update.mockResolvedValue({ success: false, error: 'cannot apply' });
    const result = await h.service.execute({ kind: 'automations.create', draft: { ...draft, workingDirectory: 'C:/repo' } });
    expect(result.message).toContain('not saved');
    expect(result.automationId).toBeDefined();
    expect(h.automations.update).toHaveBeenCalledWith(expect.objectContaining({ paused: true, workingDirectory: 'C:/repo' }));
    expect(h.automations.delete).not.toHaveBeenCalled();
  });
  it('uses real tracked dispatch after confirmation rather than the prompt preparation API', async () => {
    const h = harness(); const row = await h.row();
    await h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision });
    expect(h.confirm).toHaveBeenCalledWith('run', draft.name);
    expect(h.automations.dispatch).toHaveBeenCalledExactlyOnceWith('daily');
    expect(h.automations.run).not.toHaveBeenCalled();
  });
  it('does not dispatch on cancellation or retry an ambiguous transport failure', async () => {
    const h = harness(); const row = await h.row();
    h.confirm.mockResolvedValueOnce(false);
    await h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision });
    expect(h.automations.dispatch).not.toHaveBeenCalled();
    h.automations.dispatch.mockRejectedValueOnce(new Error('connection lost'));
    await expect(h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision })).rejects.toThrow('connection lost');
    expect(h.automations.dispatch).toHaveBeenCalledTimes(1);
  });
  it('rechecks configuration after confirmation and rejects stale writes', async () => {
    const h = harness(); const row = await h.row();
    h.confirm.mockImplementation(async () => {
      h.automations.list.mockResolvedValue([{ ...h.entry, prompt: 'Changed elsewhere' }]);
      return true;
    });
    await expect(h.service.execute({ kind: 'automations.delete', id: row.id, revision: row.revision })).rejects.toThrow('changed');
    expect(h.automations.delete).not.toHaveBeenCalled();
  });
  it('preserves schedule state, sharing and tags when editing supported fields', async () => {
    const h = harness(); const row = await h.row();
    await h.service.execute({ kind: 'automations.update', id: row.id, revision: row.revision, draft: { ...draft, name: 'Updated' } });
    const params = h.automations.update.mock.calls[0][0];
    expect(params).toMatchObject({ automationId: 'uuid-daily', automationDirName: 'daily', name: 'Updated' });
    expect(params).not.toHaveProperty('privacyLevel');
    expect(params).not.toHaveProperty('tags');
    expect(params).not.toHaveProperty('paused');
  });
  it('blocks untrusted writes and unavailable models before dispatch', async () => {
    const h = harness(); const row = await h.row();
    h.trusted.mockReturnValue(false);
    await expect(h.service.execute({ kind: 'automations.resume', id: row.id, revision: row.revision })).rejects.toThrow('Trust');
    expect(h.confirm).not.toHaveBeenCalled();
    h.trusted.mockReturnValue(true);
    h.models.list.mockResolvedValue([{ id: 'model', disabled: true }]);
    await expect(h.service.execute({ kind: 'automations.create', draft: { ...draft, model: 'model' } })).rejects.toThrow('unavailable');
    expect(h.automations.create).not.toHaveBeenCalled();
  });
  it('reports backend refusal instead of a successful mutation', async () => {
    const h = harness(); const row = await h.row();
    h.automations.pause.mockResolvedValue({ success: false, error: 'not paused' });
    await expect(h.service.execute({ kind: 'automations.pause', id: row.id, revision: row.revision })).rejects.toThrow('not paused');
    h.automations.dispatch.mockResolvedValue({ success: false, error: { code: 'already_running', message: 'Already running' } });
    await expect(h.service.execute({ kind: 'automations.run', id: row.id, revision: row.revision })).rejects.toThrow('Already running');
  });
  it('pages authoritative run history and retains model fallback information', async () => {
    const h = harness();
    h.automations.getHistory.mockResolvedValue({ totalCount: 25, runs: [{
      runId: 'run', status: 'failed', startedAt: '2026-11-04T09:00:00Z', errorMessage: 'Run failed',
      modelFallback: { requestedModel: 'old-model', reason: 'unknown' },
    }] });
    const result = await h.service.execute({ kind: 'automations.history', id: 'daily', offset: 20 });
    expect(h.automations.getHistory).toHaveBeenCalledExactlyOnceWith('daily', 20, 20);
    expect(result.automationHistory).toMatchObject({ offset: 20, total: 25, runs: [{
      id: 'run', error: 'Run failed', modelFallback: 'old-model: unknown',
    }] });
  });
});
