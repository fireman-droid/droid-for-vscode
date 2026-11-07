import type { SubagentInspectMessage, SubagentSnapshotMessage } from '../../../shared/protocol/subagentInspectionProtocol';
import type { SubagentActivityMessage } from '../../../shared/protocol/subagentProtocol';
import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';

/** Illustrative child content only. No child session is created or read. */
export function previewSubagentSnapshot(
  request: SubagentInspectMessage & { toolUseId: string },
  transcript: readonly SessionTranscriptItem[],
  activity: SubagentActivityMessage | undefined,
): Omit<SubagentSnapshotMessage, 'sequence'> {
  const { sessionId, turnId, toolUseId } = request;
  const base = { type: 'subagent.snapshot' as const, sessionId, turnId, toolUseId,
    title: 'Simulated child conversation', truncated: false };
  const row = transcript.find(item => item.kind === 'tool' && item.turnId === turnId
    && item.toolUseId === toolUseId && item.subagent);
  if (row?.kind !== 'tool' || !row.subagent) return { ...base, status: 'unavailable',
    items: [], running: false, lifecycle: null, reason: 'This example has no child conversation for that Task.' };
  const status = row.status === 'stopped' ? 'cancelled' : row.subagent.status ?? row.status;
  const running = status === 'running' || status === 'pending';
  const lifecycle = status === 'completed' ? 'completed' : status === 'failed' ? 'failed'
    : running ? 'working' : 'cancelled';
  const childTurn = `preview-child:${turnId}:${toolUseId}`;
  const items: SessionTranscriptItem[] = [
    { id: `${childTurn}:user`, kind: 'user', text: `Simulated delegation: ${row.subagent.description}` },
    { id: `${childTurn}:intro`, kind: 'assistant', turnId: childTurn,
      text: 'This is fixed preview content. No subagent, model, file read or command was executed.' },
    ...(activity?.activities ?? []).map((item, index): SessionTranscriptItem => ({
      id: `${childTurn}:tool:${index}`, kind: 'tool', turnId: childTurn, toolUseId: `preview-child-tool:${index}`,
      toolName: index === 0 ? 'Read' : 'Grep', action: item.action, ...(item.target ? { target: item.target } : {}),
      status: lifecycle === 'cancelled' ? 'stopped' : lifecycle === 'failed' ? 'failed'
        : running && index === (activity?.activities.length ?? 0) - 1 ? 'running' : 'completed',
      progressCount: 0, latestUpdateKind: null,
    })),
  ];
  if (!running) items.push({ id: `${childTurn}:result`, kind: 'assistant', turnId: childTurn,
    text: lifecycle === 'completed' ? 'Simulated review complete. The parent reply can continue.' : 'The simulated child activity has ended.' });
  return { ...base, status: 'ready', items, running, lifecycle };
}
