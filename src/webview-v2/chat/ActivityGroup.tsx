import { useMemo, type ReactNode } from 'react';
import { ActivityGroupView } from '@droidvisx/chat-ui/chat/ActivityGroupView';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { presentActivity, type ProcessWaiting } from '../../webview/assistant/transcript/activityPresentation';
import { type GroupCandidatePart } from '../../webview/assistant/transcript/activityGrouping';

export type ActivityItem = Extract<SessionTranscriptItem, { kind: 'tool' | 'thinking' }>;
export interface ActivityCluster { readonly id: string; readonly items: readonly SessionTranscriptItem[]; readonly grouped: boolean }

export function clusterActivity(items: readonly SessionTranscriptItem[]): readonly ActivityCluster[] {
  const groups: { id: string; items: SessionTranscriptItem[]; grouped: boolean }[] = [];
  for (const item of items) {
    const grouped = item.kind === 'thinking' || item.kind === 'tool';
    const prior = groups.at(-1);
    if (grouped && prior?.grouped) prior.items.push(item);
    else groups.push({ id: item.id, items: [item], grouped });
  }
  return groups;
}

function candidate(item: SessionTranscriptItem): GroupCandidatePart {
  if (item.kind === 'thinking') return {
    type: 'reasoning', text: item.text,
    status: { type: item.status === 'active' ? 'running' : item.status === 'stopped' || item.status === 'stopping' ? 'incomplete' : 'complete' },
    providerMetadata: { droidvisx: { durationMs: item.durationMs ?? null, truncated: item.truncated } },
  };
  return item.kind === 'tool' ? { type: 'tool-call', toolName: item.toolName, providerMetadata: { droidvisx: item } } : { type: item.kind };
}

export function ActivityGroup({ messageId, cluster, turnId, running, tail, incomplete, waiting, children }: {
  readonly messageId: string;
  readonly cluster: ActivityCluster;
  readonly turnId: string;
  readonly running: boolean;
  readonly tail: boolean;
  readonly incomplete: string | null;
  readonly waiting: ProcessWaiting | null;
  readonly children: ReactNode;
}) {
  const members = useMemo(() => cluster.items.map(candidate), [cluster.items]);
  if (members.length === 1) return <>{children}</>;
  const presentation = presentActivity({ members, messageRunning: running, tail, incomplete, turnId, waiting });
  const toolCount = cluster.items.filter((item) => item.kind === 'tool').length;
  return <ActivityGroupView messageId={messageId} groupId={cluster.id} incomplete={incomplete}
    presentation={{ ...presentation, action: presentation.action || `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}` }}>{children}</ActivityGroupView>;
}
