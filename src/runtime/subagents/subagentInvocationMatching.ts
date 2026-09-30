import type { ToolSubagentSummary } from '../../shared/protocol/transcript';
import type { HostTranscriptState } from '../../shared/transcript/hostTranscriptState';
import { subagentIdentityKey, type SubagentInvocationRecord } from './subagentSummary';

interface SubagentInvocationRow {
  readonly toolUseId: string;
  readonly type: string;
  readonly description: string;
}

/** Exact invocation ids win; old ledgers may only match an unambiguous identity. */
export function matchSubagentInvocations(
  rows: readonly SubagentInvocationRow[],
  records: readonly SubagentInvocationRecord[],
): ReadonlyMap<string, SubagentInvocationRecord> {
  const rowCounts = new Map<string, number>();
  for (const row of rows) rowCounts.set(row.toolUseId, (rowCounts.get(row.toolUseId) ?? 0) + 1);
  const direct = new Map<string, SubagentInvocationRecord[]>();
  const legacy = new Map<string, SubagentInvocationRecord[]>();
  for (const record of records) {
    const index = record.parentToolUseId === undefined ? legacy : direct;
    const key = record.parentToolUseId ?? subagentIdentityKey(record.summary.type, record.summary.description);
    const group = index.get(key) ?? [];
    group.push(record);
    index.set(key, group);
  }
  const matches = new Map<string, SubagentInvocationRecord>();
  const unmatched = new Map<string, SubagentInvocationRow[]>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const identity = subagentIdentityKey(row.type, row.description);
    if (rowCounts.get(row.toolUseId) !== 1) { ambiguous.add(identity); continue; }
    const exact = direct.get(row.toolUseId);
    if (exact !== undefined) {
      if (exact.length === 1) matches.set(row.toolUseId, exact[0]!);
      else ambiguous.add(identity);
      continue;
    }
    const group = unmatched.get(identity) ?? [];
    group.push(row);
    unmatched.set(identity, group);
  }
  for (const [identity, candidates] of unmatched) {
    const invocations = legacy.get(identity);
    if (!ambiguous.has(identity) && candidates.length === 1 && invocations?.length === 1)
      matches.set(candidates[0]!.toolUseId, invocations[0]!);
  }
  return matches;
}

/** Add ledger facts to bounded display history without exposing private child ids. */
export function withSubagentInvocationSummaries(
  state: HostTranscriptState,
  records: readonly SubagentInvocationRecord[],
): HostTranscriptState {
  const rows = state.transcript.flatMap(item => item.kind === 'tool' && item.subagent !== undefined
    ? [{ toolUseId: item.toolUseId, type: item.subagent.type, description: item.subagent.description }] : []);
  if (rows.length === 0 || records.length === 0) return state;
  const matches = matchSubagentInvocations(rows, records);
  let changed = false;
  const transcript = state.transcript.map(item => {
    if (item.kind !== 'tool' || item.subagent === undefined) return item;
    const match = matches.get(item.toolUseId);
    if (match === undefined) return item;
    // The Task input owns its displayed identity; the ledger owns lifecycle facts.
    const subagent: ToolSubagentSummary = { ...item.subagent, ...match.summary,
      type: item.subagent.type, description: item.subagent.description };
    if (item.subagent.status === subagent.status && item.subagent.toolUseCount === subagent.toolUseCount &&
      item.subagent.durationMs === subagent.durationMs && item.subagent.startedAt === subagent.startedAt) return item;
    changed = true;
    return { ...item, subagent };
  });
  return changed ? { ...state, transcript } : state;
}
