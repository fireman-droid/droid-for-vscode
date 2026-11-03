import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isSafeModelId } from '../validation/guards';
import { SESSION_REASONING_EFFORTS } from './bounds';
import type { SessionReasoningEffort } from './settings';

export const AUTOMATION_PROMPT_LIMIT = 240_000;
export const AUTOMATION_HISTORY_PAGE_SIZE = 20;
export interface AutomationDraft {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly schedule: string;
  readonly model: string;
  readonly reasoningEffort: SessionReasoningEffort | '';
  readonly workingDirectory: string;
}
export interface ManagedAutomation extends AutomationDraft {
  readonly id: string;
  readonly revision: string;
  readonly status: string;
  readonly valid: boolean;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly editable: boolean;
}
export interface AutomationRun {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly error: string | null;
  readonly modelFallback: string | null;
}
export interface AutomationHistory {
  readonly id: string;
  readonly offset: number;
  readonly total: number;
  readonly runs: readonly AutomationRun[];
}
export type AutomationAction =
  | { readonly kind: 'automations.list' }
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
    ['name', 'description', 'prompt', 'schedule', 'model', 'reasoningEffort', 'workingDirectory'])
    && line(value.name, 200) && value.name.trim().length > 0 && line(value.description, 1024)
    && typeof value.prompt === 'string' && value.prompt.trim().length > 0
    && value.prompt.length <= AUTOMATION_PROMPT_LIMIT && !value.prompt.includes('\0')
    && isAutomationSchedule(value.schedule)
    && (value.model === '' || isSafeModelId(value.model))
    && (value.reasoningEffort === '' || SESSION_REASONING_EFFORTS.some(e => e === value.reasoningEffort))
    && line(value.workingDirectory, 4096);
}
export function isAutomationAction(value: unknown): value is AutomationAction {
  if (!isStrictRecord(value)) return false;
  if (value.kind === 'automations.list') return hasExactKeys(value, ['kind']);
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
    // Invalid legacy entries must remain visible without making the entire list unreadable.
    && ['name', 'description', 'prompt', 'schedule', 'model', 'reasoningEffort', 'workingDirectory']
      .every(key => typeof value[key] === 'string');
}
export function isAutomationHistory(value: unknown): value is AutomationHistory {
  return isStrictRecord(value) && id(value.id) && Number.isSafeInteger(value.offset) && (value.offset as number) >= 0
    && Number.isSafeInteger(value.total) && (value.total as number) >= 0 && Array.isArray(value.runs)
    && value.runs.length <= AUTOMATION_HISTORY_PAGE_SIZE && value.runs.every(run => isStrictRecord(run)
      && typeof run.id === 'string' && typeof run.status === 'string' && typeof run.startedAt === 'string'
      && nullableText(run.completedAt) && nullableText(run.error) && nullableText(run.modelFallback));
}
