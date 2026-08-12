import {
  MAX_SUBAGENT_DESCRIPTION_LENGTH,
  MAX_SUBAGENT_TYPE_LENGTH,
  SUBAGENT_STATUSES,
  type SubagentStatus,
  type ToolSubagentSummary,
} from '../shared/bridgeMessages';
import { isStrictRecord } from '../shared/strictValidation';

const SUBAGENT_STATUS_SET: ReadonlySet<string> = new Set(
  SUBAGENT_STATUSES,
);

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
 * Key that pairs one Task tool call with one ledger invocation. The
 * public `subagentInvocations` payload does not expose the parent
 * tool-use id, so pairing is FIFO per (type, description) identity —
 * both sides sanitized by the helpers above.
 */
export function subagentIdentityKey(
  type: string,
  description: string,
): string {
  return `${type}\u0000${description}`;
}

/**
 * Projects `loadSession().subagentInvocations` into bridge-safe
 * subagent summaries in ledger order. The child session id is
 * dropped here on purpose so it never leaves the Runtime. Malformed
 * entries are skipped instead of failing the whole load.
 */
export function readSubagentInvocations(
  loaded: unknown,
): readonly ToolSubagentSummary[] {
  if (!isStrictRecord(loaded)) {
    return [];
  }
  const result = loaded.result;
  if (
    !isStrictRecord(result) ||
    !Array.isArray(result.subagentInvocations)
  ) {
    return [];
  }

  const summaries: ToolSubagentSummary[] = [];
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
    if (
      type === null ||
      typeof status !== 'string' ||
      !SUBAGENT_STATUS_SET.has(status)
    ) {
      continue;
    }
    const toolUseCount = readCount(entry.toolUseCount);
    const durationMs = readCount(entry.durationMs);
    summaries.push({
      type,
      description: sanitizeSubagentDescription(entry.description),
      status: status as SubagentStatus,
      ...(toolUseCount === undefined ? {} : { toolUseCount }),
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }
  return summaries;
}

function readCount(value: unknown): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return undefined;
  }
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? rounded : undefined;
}
