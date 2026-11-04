import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { DaemonApi } from '../../runtime/daemon/api';
import { AUTOMATION_HISTORY_PAGE_SIZE, AUTOMATION_VISUAL_LIMIT, isAutomationAction,
  type AutomationAction, type AutomationDraft } from '../../shared/protocol/automationProtocol';
import type { ManagementResult } from '../../shared/protocol/managementPageProtocol';
import type { ModelAvailability } from '../models/DisabledModelsStore';
import { automationFields, isLocalAutomation, projectAutomation, projectAutomationRun, requireAutomationSuccess,
  sameAutomationBinding, type AutomationEntry, type AutomationIssue, type AutomationIssueStore } from './automationData';
import { automationSessionPage, findAutomationSession, type AutomationSessionAccess } from './AutomationSessions';

type CreateParams = Parameters<DaemonApi['automations']['create']>[0];
type Confirmation = 'resume' | 'delete';
const UNVERIFIED = 'Automation configuration could not be verified. Running is blocked; refresh and review the task.';

/** Scheduling and execution stay daemon-owned. Reads never attach or replace a chat. */
export class ManagementAutomationsService {
  private readonly memoryIssues = new Map<string, AutomationIssue>();
  constructor(
    private readonly getDroid: () => Promise<DaemonApi>,
    private readonly daemon: boolean,
    private readonly trusted: () => boolean,
    private readonly confirm: (action: Confirmation, name: string) => Promise<boolean>,
    private readonly availability?: ModelAvailability,
    private readonly sessions?: AutomationSessionAccess,
    private readonly issues: AutomationIssueStore = {
      get: id => this.memoryIssues.get(id),
      set: async (id, issue) => { if (issue) this.memoryIssues.set(id, issue); else this.memoryIssues.delete(id); },
    },
  ) {}

  async execute(action: AutomationAction): Promise<Partial<ManagementResult>> {
    if (!isAutomationAction(action)) throw new Error('Invalid automation request.');
    if (!this.daemon) throw new Error('Automations require daemon mode.');
    const api = await this.getDroid();
    const automations = api.automations;
    if (action.kind === 'automations.list') {
      return { automations: (await automations.list()).filter(isLocalAutomation)
        .map(row => projectAutomation(row, this.issues.get(row.id))) };
    }
    if (action.kind === 'automations.sessions') {
      return { automationSessions: await automationSessionPage(api, action.cursor, this.sessions?.activeId() ?? null) };
    }
    if (action.kind === 'automations.target') {
      const row = await this.target(api, action.id);
      if (!row.targetSessionId) throw new Error('No linked session');
      const session = await findAutomationSession(api, row.targetSessionId, false, this.sessions?.activeId() ?? null);
      return { automationTarget: {
        id: session.id, title: session.title, cwd: session.cwd, current: session.active,
        archived: session.archived, canResume: !session.archived && session.kind === 'chat',
        pendingPermissions: session.pendingPermissions, pendingQuestions: session.pendingQuestions,
      } };
    }
    if (action.kind === 'automations.history') {
      await this.target(api, action.id);
      const history = await automations.getHistory(action.id, AUTOMATION_HISTORY_PAGE_SIZE, action.offset);
      return { automationHistory: {
        id: action.id, offset: action.offset, total: history.totalCount, runs: history.runs.map(projectAutomationRun),
      } };
    }
    if (action.kind === 'automations.visual') {
      await this.target(api, action.id);
      const visual = await automations.getVisual(action.id);
      if (visual.content && Buffer.byteLength(visual.content, 'utf8') > AUTOMATION_VISUAL_LIMIT) {
        throw new Error('The result dashboard is too large to preview.');
      }
      return { automationVisual: { id: action.id, exists: visual.exists, content: visual.content ?? null, stale: visual.isStale ?? null } };
    }
    if (action.kind === 'automations.session') {
      const row = await this.target(api, action.id);
      let id = row.targetSessionId;
      if (action.runId !== null) {
        const history = await automations.getHistory(row.id, AUTOMATION_HISTORY_PAGE_SIZE, action.offset);
        id = history.runs.find(run => run.runId === action.runId)?.sessionId;
      }
      if (!id || !this.sessions) throw new Error('The linked session is unavailable on this machine.');
      const session = await findAutomationSession(api, id, false, this.sessions.activeId());
      if (action.resume) { this.assertTrusted(); await this.sessions.resume(session); }
      else this.sessions.view(session);
      return {};
    }
    this.assertTrusted();
    if (action.kind === 'automations.directory') {
      if (!this.sessions) throw new Error('The directory picker is unavailable.');
      return { automationDirectory: await this.sessions.chooseDirectory() };
    }
    if (action.kind === 'automations.create') return this.create(api, action.draft);
    let row = await this.target(api, action.id, action.revision);
    if (!projectAutomation(row).editable) throw new Error('This automation is managed elsewhere or has unsupported settings.');
    if (action.kind === 'automations.resume' || action.kind === 'automations.delete') {
      if (!await this.confirm(action.kind.slice('automations.'.length) as Confirmation, row.name)) {
        return { message: 'Automation action cancelled.' };
      }
      this.assertTrusted();
      row = await this.target(api, action.id, action.revision);
    }
    if (action.kind === 'automations.update') return this.update(api, row, action.draft, action.revision);
    if (action.kind === 'automations.run' || action.kind === 'automations.resume') {
      if (this.issues.get(row.id)) throw new Error(this.issues.get(row.id)!.reason);
      if (!row.isValid) throw new Error('Fix the automation settings before running or enabling it.');
      if (row.targetSessionId) await findAutomationSession(api, row.targetSessionId, true, this.sessions?.activeId() ?? null);
      else await this.validateModel(api, row.model ?? '', row.reasoningEffort ?? '');
      this.assertTrusted();
      row = await this.target(api, action.id, action.revision);
    }
    if (action.kind === 'automations.delete') {
      await this.assertNotRunning(api, row);
      row = await this.target(api, action.id, action.revision);
    }
    this.assertTrusted();
    switch (action.kind) {
      case 'automations.run': {
        if (row.status === 'running') throw new Error('This automation is already running.');
        let result;
        try { result = await automations.dispatch(row.id); }
        catch { throw new Error('Run dispatch could not be confirmed. Refresh run history before trying again.'); }
        if (!result.success) throw new Error(result.error.message);
        return { automationId: row.id, message: 'Run request accepted. Check run history for execution and delivery status.' };
      }
      case 'automations.pause':
        requireAutomationSuccess(await automations.pause(row.id));
        await this.verifyScheduleMutation(api, row, true);
        return { automationId: row.id, message: 'Schedule paused. An existing run is not stopped.' };
      case 'automations.resume':
        requireAutomationSuccess(await automations.resume(row.id));
        await this.verifyScheduleMutation(api, row, false);
        return { automationId: row.id, message: 'Automation schedule enabled.' };
      case 'automations.delete':
        requireAutomationSuccess(await automations.delete({ automationId: row.uuid ?? row.id, automationDirName: row.id }));
        await this.issues.set(row.id, undefined);
        return { message: 'Automation deleted. Previous sessions are retained.' };
    }
  }

  private async create(api: DaemonApi, draft: AutomationDraft): Promise<Partial<ManagementResult>> {
    await this.validateDraft(api, draft);
    this.assertTrusted();
    const id = `automation-${randomUUID()}`;
    await this.issues.set(id, { targetSessionId: draft.targetSessionId, reason: UNVERIFIED });
    try {
      const result = await api.automations.create({
        id, name: draft.name.trim(), description: draft.description, instructions: draft.prompt, schedule: draft.schedule.trim(),
        ...(draft.targetSessionId ? { targetSessionId: draft.targetSessionId } : {
          ...(draft.model ? { model: draft.model } : {}),
          ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
        }),
        paused: true, skipFirstRun: true,
        // SDK 0.10 declares these wire enums but does not export their runtime values.
        privacyLevel: 'private' as CreateParams['privacyLevel'], sessionPrivacy: 'private' as CreateParams['sessionPrivacy'],
      });
      if (!result.success) { await this.issues.set(id, undefined); requireAutomationSuccess(result); }
      let row = await this.target(api, id);
      if (row.status !== 'paused') {
        requireAutomationSuccess(await api.automations.pause(id));
        row = await this.target(api, id);
      }
      if (row.status !== 'paused' || (row.targetSessionId ?? null) !== draft.targetSessionId) throw new Error(UNVERIFIED);
      if (!draft.targetSessionId && draft.workingDirectory) {
        requireAutomationSuccess(await api.automations.update({
          automationId: row.uuid ?? row.id, automationDirName: row.id, ...automationFields(draft), paused: true,
        }));
        const saved = await this.target(api, id);
        if (!sameAutomationBinding(row, saved) || saved.workingDirectory !== draft.workingDirectory) throw new Error(UNVERIFIED);
        row = saved;
      }
      if (row.schedule?.trim() !== draft.schedule.trim()) throw new Error(UNVERIFIED);
      await this.issues.set(id, undefined);
      return { automationId: id, message: 'Automation created paused. Enable its schedule when ready.' };
    } catch (error) {
      if (!this.issues.get(id)) throw error;
      // Never retry a create or delete a partial scaffold. Its ID remains navigable.
      try { return await this.pauseUnverified(api, id); }
      catch (pauseError) {
        return { ok: false, automationId: id, message: pauseError instanceof Error ? pauseError.message : UNVERIFIED };
      }
    }
  }

  private async update(api: DaemonApi, row: AutomationEntry, draft: AutomationDraft, revision: string): Promise<Partial<ManagementResult>> {
    const issue = this.issues.get(row.id);
    const expectedTarget = issue ? issue.targetSessionId : row.targetSessionId ?? null;
    if (draft.targetSessionId !== (row.targetSessionId ?? null) || expectedTarget !== draft.targetSessionId) {
      throw new Error('The session binding cannot be changed. Create a separate task instead.');
    }
    await this.validateDraft(api, draft);
    this.assertTrusted();
    row = await this.target(api, row.id, revision);
    const fields = automationFields(draft);
    // Bound runs inherit the session's settings. Do not clear legacy model/cwd fields while editing instructions.
    const { model: _, reasoningEffort: __, workingDirectory: ___, ...boundFields } = fields;
    await this.issues.set(row.id, { targetSessionId: expectedTarget, reason: UNVERIFIED });
    try {
      requireAutomationSuccess(await api.automations.update({
        automationId: row.uuid ?? row.id, automationDirName: row.id, ...(row.targetSessionId ? boundFields : fields),
      }));
      const saved = await this.target(api, row.id);
      if (!sameAutomationBinding(row, saved) || saved.name !== fields.name || saved.schedule?.trim() !== fields.schedule
        || saved.prompt?.trim() !== fields.prompt.trim() || (saved.description ?? '') !== fields.description
        || !row.targetSessionId && ((saved.model ?? '') !== fields.model || (saved.reasoningEffort ?? '') !== fields.reasoningEffort
          || (saved.workingDirectory ?? '') !== fields.workingDirectory)) throw new Error(UNVERIFIED);
      await this.issues.set(row.id, undefined);
    } catch {
      // A failed/ambiguous update may already have changed the file. Do not leave
      // an unverified configuration scheduled, and do not replay the update.
      await this.pauseUnverified(api, row.id);
    }
    return { automationId: row.id, message: 'Automation saved.' };
  }

  private async verifyScheduleMutation(api: DaemonApi, row: AutomationEntry, paused: boolean): Promise<void> {
    try {
      const saved = await this.target(api, row.id);
      if ((paused ? saved.status !== 'paused' : !['active', 'running'].includes(saved.status))
        || !sameAutomationBinding({ ...row, status: paused ? 'paused' : 'active' }, saved)) throw new Error(UNVERIFIED);
    } catch {
      await this.issues.set(row.id, { targetSessionId: row.targetSessionId ?? null, reason: UNVERIFIED });
      await this.pauseUnverified(api, row.id);
    }
  }
  private async pauseUnverified(api: DaemonApi, id: string): Promise<never> {
    try {
      requireAutomationSuccess(await api.automations.pause(id));
      if ((await this.target(api, id)).status !== 'paused') throw new Error(UNVERIFIED);
    } catch {
      throw new Error('Configuration is unverified and the schedule could not be confirmed paused. Check it in Droid before leaving it unattended.');
    }
    throw new Error('Configuration could not be verified. The schedule was paused; review it before enabling.');
  }
  private async assertNotRunning(api: DaemonApi, row: AutomationEntry): Promise<void> {
    if (row.status === 'running') throw new Error('Wait for the current run to finish before deleting this task.');
    let offset = 0;
    do {
      const page = await api.automations.getHistory(row.id, AUTOMATION_HISTORY_PAGE_SIZE, offset);
      if (page.runs.some(run => run.delivery?.status === 'pending'
        || !['success', 'failed', 'completed', 'cancelled', 'canceled', 'skipped'].includes(run.status))) {
        throw new Error('A run is unfinished or its state is unknown. Refresh history before deleting this task.');
      }
      offset += page.runs.length;
      if (offset >= page.totalCount) return;
      if (!page.runs.length) throw new Error('Run history could not be loaded.');
    } while (true);
  }
  private assertTrusted(): void {
    if (!this.trusted()) throw new Error('Trust this workspace before changing or running automations.');
  }
  private async target(api: DaemonApi, id: string, revision?: string): Promise<AutomationEntry> {
    const row = (await api.automations.list()).find(item => item.id === id && isLocalAutomation(item));
    if (!row) throw new Error('Automation is no longer available on this machine. Refresh the list.');
    if (revision !== undefined && projectAutomation(row).revision !== revision) {
      throw new Error('Automation changed. Refresh it before trying again.');
    }
    return { ...row, ...(row.tags ? { tags: [...row.tags] } : {}) };
  }
  private async validateDraft(api: DaemonApi, draft: AutomationDraft): Promise<void> {
    if (Buffer.byteLength(draft.prompt, 'utf8') > 240_000) throw new Error('Automation instructions are too large.');
    if (draft.targetSessionId) {
      await findAutomationSession(api, draft.targetSessionId, true, this.sessions?.activeId() ?? null);
      return;
    }
    if (draft.workingDirectory) {
      if (!isAbsolute(draft.workingDirectory)) throw new Error('The working directory must be an absolute path.');
      if (!(await api.workspace.validateDirectory(draft.workingDirectory)).isValid) throw new Error('The working directory is unavailable.');
    }
    await this.validateModel(api, draft.model, draft.reasoningEffort);
  }
  private async validateModel(api: DaemonApi, id: string, effort: string): Promise<void> {
    if (!id) {
      if (effort) throw new Error('Choose a model before setting reasoning effort.');
      return;
    }
    const model = (await api.models.list({ includeDisabled: true })).find(item => item.id === id);
    if (!model || model.disabled) throw new Error('The automation model is unavailable. Choose another model.');
    await this.availability?.assertEnabled(id);
    if (effort && !model.supportedReasoningEfforts?.some(value => value === effort)) {
      throw new Error('The automation model does not support this reasoning effort.');
    }
  }
}
