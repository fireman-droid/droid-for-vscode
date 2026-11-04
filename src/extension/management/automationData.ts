import { createHash } from 'node:crypto';
import type { DaemonApi } from '../../runtime/daemon/api';
import { isAutomationSessionId, type AutomationDraft, type AutomationRun,
  type ManagedAutomation } from '../../shared/protocol/automationProtocol';

export type AutomationEntry = Awaited<ReturnType<DaemonApi['automations']['list']>>[number];
type Run = Awaited<ReturnType<DaemonApi['automations']['getHistory']>>['runs'][number];
export interface AutomationIssue { readonly targetSessionId: string | null; readonly reason: string }
export interface AutomationIssueStore {
  get(id: string): AutomationIssue | undefined;
  set(id: string, issue: AutomationIssue | undefined): Promise<void>;
}
export function isLocalAutomation(entry: AutomationEntry): boolean {
  return !entry.executionTemplateId && (entry.machineId === 'local' || !entry.machineId && !entry.computerId);
}
export function automationFields(draft: AutomationDraft) {
  const { targetSessionId: _, ...fields } = draft;
  return { ...fields, name: draft.name.trim(), schedule: draft.schedule.trim() };
}
export function requireAutomationSuccess(result: { success: boolean; error?: string }): void {
  if (!result.success) throw new Error(result.error || 'Droid did not confirm the automation change.');
}
export function projectAutomation(entry: AutomationEntry, issue?: AutomationIssue): ManagedAutomation {
  const draft = {
    name: entry.name, description: entry.description ?? '', prompt: entry.prompt ?? '', schedule: entry.schedule ?? '',
    model: entry.model ?? '', reasoningEffort: entry.reasoningEffort ?? '', workingDirectory: entry.workingDirectory ?? '',
    targetSessionId: isAutomationSessionId(entry.targetSessionId) ? entry.targetSessionId : null,
  };
  const revision = createHash('sha256').update(JSON.stringify({
    ...draft, uuid: entry.uuid, status: entry.status, tags: entry.tags, privacy: entry.privacyLevel,
    sessionPrivacy: entry.sessionPrivacy, target: entry.targetSessionId, workstream: entry.workstreamId,
  })).digest('hex');
  return {
    ...draft, reasoningEffort: draft.reasoningEffort as AutomationDraft['reasoningEffort'],
    id: entry.id, revision, status: entry.status, valid: entry.isValid,
    nextRunAt: entry.nextRunAt ?? null, lastRunAt: entry.lastRunAt ?? null, lastRunStatus: entry.lastRunStatus ?? null,
    editable: !entry.workstreamId && (!entry.targetSessionId || isAutomationSessionId(entry.targetSessionId)),
    blockedReason: issue?.reason ?? null,
  };
}
export function projectAutomationRun(run: Run): AutomationRun {
  return {
    id: run.runId, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt ?? null,
    error: run.errorMessage ?? null, type: run.type ?? null,
    durationMs: run.durationMs !== undefined && Number.isFinite(run.durationMs) && run.durationMs >= 0 ? run.durationMs : null,
    modelFallback: run.modelFallback ? `${run.modelFallback.requestedModel}: ${run.modelFallback.reason}` : null,
    sessionId: isAutomationSessionId(run.sessionId) ? run.sessionId : null,
    delivery: run.delivery ? { status: run.delivery.status ?? null, reason: run.delivery.reason ?? null } : null,
    isRetry: run.isRetry ?? false, originalRunId: run.originalRunId ?? null,
  };
}
export function sameAutomationBinding(before: AutomationEntry, after: AutomationEntry): boolean {
  return (before.targetSessionId ?? null) === (after.targetSessionId ?? null)
    && (before.privacyLevel ?? 'private') === (after.privacyLevel ?? 'private')
    && (before.sessionPrivacy ?? 'private') === (after.sessionPrivacy ?? 'private')
    && JSON.stringify([...(before.tags ?? [])].sort()) === JSON.stringify([...(after.tags ?? [])].sort())
    && (before.status === 'paused') === (after.status === 'paused');
}
