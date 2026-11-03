import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { DaemonApi } from '../../runtime/daemon/api';
import { AUTOMATION_HISTORY_PAGE_SIZE, isAutomationAction, type AutomationAction,
  type AutomationDraft, type ManagedAutomation } from '../../shared/protocol/automationProtocol';
import type { ManagementResult } from '../../shared/protocol/managementPageProtocol';
import type { ModelAvailability } from '../models/DisabledModelsStore';

type Entry = Awaited<ReturnType<DaemonApi['automations']['list']>>[number];
type CreateParams = Parameters<DaemonApi['automations']['create']>[0];
type Confirmation = 'run' | 'resume' | 'delete';

/** Uses daemon-owned scheduling and dispatch; no extension timer or private-file writes. */
export class ManagementAutomationsService {
  constructor(
    private readonly getDroid: () => Promise<DaemonApi>,
    private readonly daemon: boolean,
    private readonly trusted: () => boolean,
    private readonly confirm: (action: Confirmation, name: string) => Promise<boolean>,
    private readonly availability?: ModelAvailability,
  ) {}

  async execute(action: AutomationAction): Promise<Partial<ManagementResult>> {
    if (!isAutomationAction(action)) throw new Error('Invalid automation request.');
    if (!this.daemon) throw new Error('Automations require daemon mode.');
    const api = await this.getDroid();
    const automations = api.automations;
    if (action.kind === 'automations.list') {
      return { automations: (await automations.list()).filter(isLocal).map(project) };
    }
    if (action.kind === 'automations.history') {
      await this.target(api, action.id);
      const history = await automations.getHistory(action.id, AUTOMATION_HISTORY_PAGE_SIZE, action.offset);
      return { automationHistory: {
        id: action.id, offset: action.offset, total: history.totalCount,
        runs: history.runs.map(run => ({
          id: run.runId, status: run.status, startedAt: run.startedAt,
          completedAt: run.completedAt ?? null, error: run.errorMessage ?? null,
          modelFallback: run.modelFallback
            ? `${run.modelFallback.requestedModel}: ${run.modelFallback.reason}` : null,
        })),
      } };
    }
    this.assertTrusted();
    if (action.kind === 'automations.create') {
      await this.validateDraft(api, action.draft);
      this.assertTrusted();
      const id = `automation-${randomUUID()}`;
      const draft = action.draft;
      const created = await automations.create({
        id, name: draft.name.trim(), description: draft.description,
        instructions: draft.prompt, schedule: draft.schedule.trim(),
        ...(draft.model ? { model: draft.model } : {}),
        ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
        paused: true, skipFirstRun: true,
        // SDK 0.10 declares these wire enums but does not export their values.
        privacyLevel: 'private' as CreateParams['privacyLevel'],
        sessionPrivacy: 'private' as CreateParams['sessionPrivacy'],
      });
      requireSuccess(created);
      // create has no workingDirectory field. Keep the scaffold paused while applying it.
      if (draft.workingDirectory) {
        try {
          this.assertTrusted();
          requireSuccess(await automations.update({
            automationId: created.automationId ?? id, automationDirName: id, ...writeFields(draft), paused: true,
          }));
        } catch {
          return { automationId: id, message: 'Automation created paused, but its working directory was not saved. Refresh and edit it before enabling.' };
        }
      }
      return { automationId: id, message: 'Automation created paused. Enable its schedule when ready.' };
    }
    let row = await this.target(api, action.id, action.revision);
    if (!project(row).editable) throw new Error('This automation is managed elsewhere or has unsupported settings.');
    if (action.kind === 'automations.run' || action.kind === 'automations.resume' || action.kind === 'automations.delete') {
      if (!await this.confirm(action.kind.slice('automations.'.length) as Confirmation, row.name)) {
        return { message: 'Automation action cancelled.' };
      }
      this.assertTrusted();
      row = await this.target(api, action.id, action.revision);
    }
    if (action.kind === 'automations.update') {
      await this.validateDraft(api, action.draft);
      this.assertTrusted();
      requireSuccess(await automations.update({
        automationId: row.uuid ?? row.id, automationDirName: row.id, ...writeFields(action.draft),
      }));
      return { automationId: row.id, message: 'Automation saved.' };
    }
    if (action.kind === 'automations.run' || action.kind === 'automations.resume') {
      if (!row.isValid) throw new Error('Fix the automation settings before running or enabling it.');
      await this.validateModel(api, row.model ?? '', row.reasoningEffort ?? '');
      this.assertTrusted();
    }
    this.assertTrusted();
    switch (action.kind) {
      case 'automations.run': {
        const result = await automations.dispatch(row.id);
        if (!result.success) throw new Error(result.error.message);
        return { automationId: row.id, message: 'Automation run started. Refresh run history to follow its result.' };
      }
      case 'automations.pause':
        requireSuccess(await automations.pause(row.id));
        return { automationId: row.id, message: 'Schedule paused. An existing run is not stopped.' };
      case 'automations.resume':
        requireSuccess(await automations.resume(row.id));
        return { automationId: row.id, message: 'Automation schedule enabled.' };
      case 'automations.delete':
        requireSuccess(await automations.delete({ automationId: row.uuid ?? row.id, automationDirName: row.id }));
        return { message: 'Automation deleted. Previous sessions are retained.' };
    }
  }

  private assertTrusted(): void {
    if (!this.trusted()) throw new Error('Trust this workspace before changing or running automations.');
  }
  private async target(api: DaemonApi, id: string, revision?: string): Promise<Entry> {
    const row = (await api.automations.list()).find(item => item.id === id && isLocal(item));
    if (!row) throw new Error('Automation is no longer available on this machine. Refresh the list.');
    if (revision !== undefined && project(row).revision !== revision) {
      throw new Error('Automation changed. Refresh it before trying again.');
    }
    return row;
  }
  private async validateDraft(api: DaemonApi, draft: AutomationDraft): Promise<void> {
    if (Buffer.byteLength(draft.prompt, 'utf8') > 240_000) throw new Error('Automation instructions are too large.');
    if (draft.workingDirectory) {
      if (!isAbsolute(draft.workingDirectory)) throw new Error('The working directory must be an absolute path.');
      const result = await api.workspace.validateDirectory(draft.workingDirectory);
      if (!result.isValid) throw new Error('The working directory is unavailable.');
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

function isLocal(entry: Entry): boolean {
  return !entry.executionTemplateId && (entry.machineId === 'local' || !entry.machineId && !entry.computerId);
}
function writeFields(draft: AutomationDraft) {
  return { ...draft, name: draft.name.trim(), schedule: draft.schedule.trim() };
}
function requireSuccess(result: { success: boolean; error?: string }): void {
  if (!result.success) throw new Error(result.error || 'Droid did not confirm the automation change.');
}
function project(entry: Entry): ManagedAutomation {
  const draft = {
    name: entry.name, description: entry.description ?? '', prompt: entry.prompt ?? '', schedule: entry.schedule ?? '',
    model: entry.model ?? '', reasoningEffort: entry.reasoningEffort ?? '', workingDirectory: entry.workingDirectory ?? '',
  };
  // Ignore changing run timestamps; include all configuration that another client can edit.
  const revision = createHash('sha256').update(JSON.stringify({
    ...draft, uuid: entry.uuid, status: entry.status, tags: entry.tags, privacy: entry.privacyLevel,
    sessionPrivacy: entry.sessionPrivacy, target: entry.targetSessionId, workstream: entry.workstreamId,
  })).digest('hex');
  return {
    ...draft, reasoningEffort: draft.reasoningEffort as AutomationDraft['reasoningEffort'],
    id: entry.id, revision, status: entry.status, valid: entry.isValid,
    nextRunAt: entry.nextRunAt ?? null, lastRunAt: entry.lastRunAt ?? null,
    editable: !entry.workstreamId && !entry.targetSessionId,
  };
}
