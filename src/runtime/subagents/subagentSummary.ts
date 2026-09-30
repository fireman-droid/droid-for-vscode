import {
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  SUBAGENT_STATUSES,
} from '../../shared/protocol/bounds';
import {
  type SubagentStatus,
  type ToolSubagentSummary,
} from '../../shared/protocol/transcript';
import { isStrictRecord } from '../../shared/validation/strictValidation';

const SUBAGENT_STATUS_SET: ReadonlySet<string> = new Set(SUBAGENT_STATUSES);

/** Most raw ledger entries one projection scans. */
const MAX_SUBAGENT_INVOCATIONS_TO_PROJECT = 10_000;

/**
 * Collapses control characters and whitespace runs, trims, and
 * bounds one externally sourced display string.
 */
function collapseBounded(value: string, limit: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .trim();
}

/**
 * Sanitizes an externally sourced subagent type name: collapses
 * control characters and whitespace runs, trims, and bounds. Returns
 * null when nothing displayable remains.
 */
export function sanitizeSubagentType(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const type = collapseBounded(value, MAX_SUBAGENT_TYPE_LENGTH);
  return type.length > 0 ? type : null;
}

/**
 * Sanitizes an externally sourced subagent description the same way;
 * an empty description is representable, so this never returns null.
 */
export function sanitizeSubagentDescription(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return collapseBounded(value, MAX_SUBAGENT_DESCRIPTION_LENGTH);
}

/**
 * Fallback key that pairs one Task tool call with one invocation when
 * the source does not expose its parent tool-use id.
 */
export function subagentIdentityKey(type: string, description: string): string {
  return `${type}\u0000${description}`;
}

/**
 * One ledger invocation with its host-only child session id. The
 * summary half is bridge-safe; the child id must never leave the
 * Runtime/Host boundary (the webview addresses rows by toolUseId and
 * the validators reject any payload carrying a childSessionId).
 */
export interface SubagentInvocationRecord {
  readonly summary: ToolSubagentSummary;
  readonly childSessionId: string | null;
  readonly parentToolUseId?: string;
  /** Host-only start boundary when a Task continues an existing child session. */
  readonly promptMessageId?: string;
}

/** Host-only CLI identifiers are opaque; anything unprintable is dropped. */
const SAFE_OPAQUE_ID = /^[\w.:-]{1,128}$/u;

/**
 * Projects `loadSession().subagentInvocations` into host-only
 * invocation records in ledger order (待办 B: the child session id is
 * the handle for per-row stop, live activity and transcript replay).
 * Malformed entries are skipped instead of failing the whole load.
 */
export function readSubagentInvocationRecords(
  loaded: unknown,
): readonly SubagentInvocationRecord[] {
  if (!isStrictRecord(loaded)) {
    return [];
  }
  const result = loaded.result;
  if (!isStrictRecord(result) || !Array.isArray(result.subagentInvocations)) {
    return [];
  }

  const records: SubagentInvocationRecord[] = [];
  const count = Math.min(
    result.subagentInvocations.length,
    MAX_SUBAGENT_INVOCATIONS_TO_PROJECT,
  );
  for (let index = 0; index < count; index += 1) {
    const entry: unknown = result.subagentInvocations[index];
    if (!isStrictRecord(entry)) {
      continue;
    }
    const type = sanitizeSubagentType(entry.subagentType);
    const status = entry.status;
    if (type === null || typeof status !== 'string' || !SUBAGENT_STATUS_SET.has(status)) {
      continue;
    }
    const toolUseCount = readCount(entry.toolUseCount);
    const durationMs = readCount(entry.durationMs);
    const startedAt = readSubagentTimestamp(entry.createdAt);
    records.push({
      summary: {
        type,
        description: sanitizeSubagentDescription(entry.description),
        status: status as SubagentStatus,
        ...(toolUseCount === undefined ? {} : { toolUseCount }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(startedAt === undefined ? {} : { startedAt }),
      },
      childSessionId:
        typeof entry.childSessionId === 'string' &&
        SAFE_OPAQUE_ID.test(entry.childSessionId)
          ? entry.childSessionId
          : null,
      ...(typeof entry.parentToolUseId === 'string' &&
      SAFE_OPAQUE_ID.test(entry.parentToolUseId)
        ? { parentToolUseId: entry.parentToolUseId }
        : {}),
      ...(typeof entry.promptMessageId === 'string' && SAFE_OPAQUE_ID.test(entry.promptMessageId)
        ? { promptMessageId: entry.promptMessageId }
        : {}),
    });
  }
  return records;
}

/**
 * Bridge-safe view of the same ledger: the invocation summaries in
 * ledger order with every child session id already stripped.
 */
export function readSubagentInvocations(loaded: unknown): readonly ToolSubagentSummary[] {
  return readSubagentInvocationRecords(loaded).map((record) => record.summary);
}

function readCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : undefined;
}

/** Recorded CLI timestamps are integer Unix milliseconds; absent data stays absent. */
export function readSubagentTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value : undefined;
}

/**
 * The delegation identity a Task tool call carries in its own input
 * (`subagent_type` + `description`), sanitized exactly like ledger
 * entries so the two sides key identically. Null for non-Task tools
 * and unusable inputs.
 */
export function readTaskDelegation(
  toolName: string,
  input: unknown,
): { readonly type: string; readonly description: string } | null {
  const normalized = toolName.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
  if (normalized !== 'task' || !isStrictRecord(input)) {
    return null;
  }
  const type = sanitizeSubagentType(input.subagent_type);
  if (type === null) {
    return null;
  }
  return {
    type,
    description: sanitizeSubagentDescription(input.description),
  };
}

/**
 * FIFO queues of ledger summaries keyed by delegation identity. The
 * public ledger omits the parent tool-use id, so repeated identical
 * delegations pair with ledger entries in order of appearance.
 */
export type SubagentSummaryQueues = Map<string, ToolSubagentSummary[]>;

export function createSubagentQueues(
  invocations: readonly ToolSubagentSummary[],
): SubagentSummaryQueues {
  const queues: SubagentSummaryQueues = new Map();
  for (const invocation of invocations) {
    const key = subagentIdentityKey(invocation.type, invocation.description);
    const queue = queues.get(key);
    if (queue === undefined) {
      queues.set(key, [invocation]);
    } else {
      queue.push(invocation);
    }
  }
  return queues;
}

/**
 * Takes the oldest unconsumed ledger summary matching one delegation
 * identity, or undefined when the ledger has no entry for it. Used
 * when the whole session is replayed front to back.
 */
export function takeSubagentSummary(
  queues: SubagentSummaryQueues,
  type: string,
  description: string,
): ToolSubagentSummary | undefined {
  const queue = queues.get(subagentIdentityKey(type, description));
  if (queue === undefined || queue.length === 0) {
    return undefined;
  }
  return queue.shift();
}

/**
 * Takes the newest unconsumed ledger summary for one delegation
 * identity. Used at turn end, where the whole-session ledger may
 * also contain older invocations from earlier turns.
 */
export function takeSubagentSummaryLast(
  queues: SubagentSummaryQueues,
  type: string,
  description: string,
): ToolSubagentSummary | undefined {
  const queue = queues.get(subagentIdentityKey(type, description));
  if (queue === undefined || queue.length === 0) {
    return undefined;
  }
  return queue.pop();
}
