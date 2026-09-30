import type { SessionTranscriptItem } from '../protocol/transcript';

type ToolItem = Extract<SessionTranscriptItem, { kind: 'tool' }>;

function uniqueTools(items: readonly SessionTranscriptItem[]): ReadonlyMap<string, ToolItem | null> {
  const tools = new Map<string, ToolItem | null>();
  for (const item of items) {
    if (item.kind === 'tool') tools.set(item.toolUseId, tools.has(item.toolUseId) ? null : item);
  }
  return tools;
}

/** Fill missing ledger metadata on an existing Task, never infer its outcome
 * from the Task tool's own status or pair repeated descriptions by position. */
export function preserveSubagentSummaries(
  loaded: readonly SessionTranscriptItem[],
  saved: readonly SessionTranscriptItem[],
): readonly SessionTranscriptItem[] {
  if (!saved.some((item) => item.kind === 'tool' && item.subagent !== undefined)) return loaded;
  const currentTools = uniqueTools(loaded), savedTools = uniqueTools(saved);
  let result: SessionTranscriptItem[] | undefined;
  loaded.forEach((item, index) => {
    if (item.kind !== 'tool' || item.subagent === undefined || currentTools.get(item.toolUseId) !== item) return;
    const previous = savedTools.get(item.toolUseId);
    if (!previous?.subagent || previous.toolName !== item.toolName) return;
    const current = item.subagent, prior = previous.subagent;
    const fields = {
      ...(current.status === undefined && prior.status !== undefined ? { status: prior.status } : {}),
      ...(current.toolUseCount === undefined && prior.toolUseCount !== undefined ? { toolUseCount: prior.toolUseCount } : {}),
      ...(current.durationMs === undefined && prior.durationMs !== undefined ? { durationMs: prior.durationMs } : {}),
      ...(current.startedAt === undefined && prior.startedAt !== undefined ? { startedAt: prior.startedAt } : {}),
    };
    if (Object.keys(fields).length === 0) return;
    result ??= [...loaded];
    result[index] = { ...item, subagent: { ...current, ...fields } };
  });
  return result ?? loaded;
}
