import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isSafeModelId } from '../validation/guards';
import { SESSION_REASONING_EFFORTS } from './bounds';
import type { SessionReasoningEffort } from './settings';

export const AUTOMATION_PROMPT_LIMIT = 240_000;
export const AUTOMATION_HISTORY_PAGE_SIZE = 20;
export const AUTOMATION_VISUAL_LIMIT = 2 * 1024 * 1024;
export const isAutomationSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export interface AutomationDraft {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly model: string;
  readonly reasoningEffort: SessionReasoningEffort | '';
  readonly workingDirectory: string;
  readonly targetSessionId: string | null;
}
export interface ManagedAutomation extends AutomationDraft {
  readonly id: string;
  readonly revision: string;
  readonly status: string;
  readonly valid: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
  readonly editable: boolean;
  readonly blockedReason: string | null;
}
export interface AutomationRun {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly error: string | null;
  readonly modelFallback: string | null;
  readonly type: 'create' | 'run' | null;
  readonly durationMs: number | null;
  readonly sessionId: string | null;
  readonly delivery: { readonly status: 'pending' | 'delivered' | 'failed' | null; readonly reason: string | null } | null;
  readonly originalRunId: string | null;
  readonly isRetry: boolean;
}
export interface AutomationHistory {
  readonly id: string;
  readonly offset: number;
  readonly total: number;
  readonly runs: readonly AutomationRun[];
}
export interface AutomationVisual {
  readonly id: string;
  readonly exists: boolean;
  readonly content: string | null;
  readonly stale: boolean | null;
}
export interface AutomationSessionChoice {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly current: boolean;
}
export interface AutomationSessionPage {
  readonly sessions: readonly AutomationSessionChoice[];
  readonly nextCursor: number | null;
}
export interface AutomationTarget extends AutomationSessionChoice {
  readonly archived: boolean;
  readonly canResume: boolean;
  readonly pendingPermissions: number | null;
  readonly pendingQuestions: number | null;
}
export type AutomationAction =
  | { readonly kind: 'automations.list' }
  | { readonly kind: 'automations.directory' }
  | { readonly kind: 'automations.sessions'; readonly cursor: number | null }
  | { readonly kind: 'automations.visual'; readonly id: string }
  | { readonly kind: 'automations.target'; readonly id: string }
  | { readonly kind: 'automations.session'; readonly id: string; readonly runId: string | null;
      readonly offset: number; readonly resume: boolean }
  | { readonly kind: 'automations.create'; readonly draft: AutomationDraft }
  | { readonly kind: 'automations.update'; readonly id: string; readonly revision: string; readonly draft: AutomationDraft }
  | { readonly kind: 'automations.run' | 'automations.pause' | 'automations.resume' | 'automations.delete'; readonly id: string; readonly revision: string }
  | { readonly kind: 'automations.history'; readonly id: string; readonly offset: number };

const line = (v: unknown, max = 512): v is string =>
  typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = (v: unknown): v is string => line(v, 256) && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nullableText = (v: unknown): boolean => v === null || typeof v === 'string';

/** Five-field numeric UTC cron. Scheduling itself remains daemon-owned. */
export function isAutomationSchedule(value: unknown): value is string {
  if (!line(value, 128)) return false;
  const fields = value.trim().split(/\s+/);
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.length === 5 && fields.every((field, i) => field.split(',').every(part => {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return false;
    const [min, max] = bounds[i];
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (step < 1 || step > max - min + 1) return false;
    if (match[1] === '*') return true;
    const [start, end = start] = match[1].split('-').map(Number);
    return start >= min && end <= max && start <= end;
  }));
}

export function isAutomationDraft(value: unknown): value is AutomationDraft {
  return isStrictRecord(value) && hasExactKeys(value,
    ['name', 'description', 'prompt', 'schedule', 'model', 'reasoningEffort', 'workingDirectory', 'targetSessionId'])
    && line(value.name, 200) && value.name.trim().length > 0 && line(value.description, 1024)
    && typeof value.prompt === 'string' && value.prompt.trim().length > 0
    && value.prompt.length <= AUTOMATION_PROMPT_LIMIT && !value.prompt.includes('\0')
    && isAutomationSchedule(value.schedule)
    && (value.model === '' || isSafeModelId(value.model))
    && (value.reasoningEffort === '' || SESSION_REASONING_EFFORTS.some(e => e === value.reasoningEffort))
    && line(value.workingDirectory, 4096)
    && (value.targetSessionId === null || isAutomationSessionId(value.targetSessionId));
}
export function isAutomationAction(value: unknown): value is AutomationAction {
  if (!isStrictRecord(value)) return false;
  if (value.kind === 'automations.list' || value.kind === 'automations.directory') return hasExactKeys(value, ['kind']);
  if (value.kind === 'automations.sessions') return hasExactKeys(value, ['kind', 'cursor'])
    && (value.cursor === null || typeof value.cursor === 'number' && Number.isFinite(value.cursor) && value.cursor >= 0);
  if (value.kind === 'automations.visual' || value.kind === 'automations.target') return hasExactKeys(value, ['kind', 'id']) && id(value.id);
  if (value.kind === 'automations.session') return hasExactKeys(value, ['kind', 'id', 'runId', 'offset', 'resume'])
    && id(value.id) && (value.runId === null || line(value.runId, 256) && value.runId.length > 0)
    && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0 && typeof value.resume === 'boolean';
  if (value.kind === 'automations.create') return hasExactKeys(value, ['kind', 'draft']) && isAutomationDraft(value.draft);
  if (value.kind === 'automations.history') return hasExactKeys(value, ['kind', 'id', 'offset']) && id(value.id)
    && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0;
  if (value.kind === 'automations.update') return hasExactKeys(value, ['kind', 'id', 'revision', 'draft'])
    && id(value.id) && revision(value.revision) && isAutomationDraft(value.draft);
  return ['automations.run', 'automations.pause', 'automations.resume', 'automations.delete'].includes(String(value.kind))
    && hasExactKeys(value, ['kind', 'id', 'revision']) && id(value.id) && revision(value.revision);
}
export function isManagedAutomation(value: unknown): value is ManagedAutomation {
  if (!isStrictRecord(value)) return false;
  return id(value.id) && revision(value.revision) && typeof value.status === 'string'
    && typeof value.valid === 'boolean' && typeof value.editable === 'boolean'
    && nullableText(value.nextRunAt) && nullableText(value.lastRunAt)
    && nullableText(value.lastRunStatus) && nullableText(value.blockedReason)
    && (value.targetSessionId === null || isAutomationSessionId(value.targetSessionId))
    // Invalid legacy entries must remain visible without making the entire list unreadable.
    && ['name', 'description', 'prompt', 'schedule', 'model', 'reasoningEffort', 'workingDirectory']
      .every(key => typeof value[key] === 'string');
}
export function isAutomationHistory(value: unknown): value is AutomationHistory {
  return isStrictRecord(value) && id(value.id) && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0
    && Number.isSafeInteger(value.total) && (value.total as number) >= 0 && Array.isArray(value.runs)
    && value.runs.length <= AUTOMATION_HISTORY_PAGE_SIZE && value.runs.every(run => isStrictRecord(run)
      && typeof run.id === 'string' && typeof run.status === 'string' && typeof run.startedAt === 'string'
      && nullableText(run.completedAt) && nullableText(run.error) && nullableText(run.modelFallback)
      && (run.type === null || run.type === 'create' || run.type === 'run') && nullableText(run.originalRunId) && typeof run.isRetry === 'boolean'
      && (run.durationMs === null || typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs >= 0)
      && (run.sessionId === null || isAutomationSessionId(run.sessionId))
      && (run.delivery === null || isStrictRecord(run.delivery) && (run.delivery.status === null || run.delivery.status === 'pending'
        || run.delivery.status === 'delivered' || run.delivery.status === 'failed')
        && nullableText(run.delivery.reason)));
}
export function isAutomationVisual(value: unknown): value is AutomationVisual {
  return isStrictRecord(value) && id(value.id) && typeof value.exists === 'boolean'
    && (value.content === null || typeof value.content === 'string' && value.content.length <= AUTOMATION_VISUAL_LIMIT)
    && (value.stale === null || typeof value.stale === 'boolean');
}
export function isAutomationSessionPage(value: unknown): value is AutomationSessionPage {
  return isStrictRecord(value) && Array.isArray(value.sessions) && value.sessions.length <= 100
    && value.sessions.every(row => isStrictRecord(row) && isAutomationSessionId(row.id)
      && typeof row.title === 'string' && typeof row.cwd === 'string' && typeof row.current === 'boolean')
    && (value.nextCursor === null || typeof value.nextCursor === 'number' && Number.isFinite(value.nextCursor) && value.nextCursor >= 0);
}
export function isAutomationTarget(value: unknown): value is AutomationTarget {
  return isStrictRecord(value) && isAutomationSessionPage({ sessions: [value], nextCursor: null })
    && typeof value.archived === 'boolean' && typeof value.canResume === 'boolean'
    && [value.pendingPermissions, value.pendingQuestions].every(count => count === null || Number.isSafeInteger(count) && (count as number) >= 0);
}
