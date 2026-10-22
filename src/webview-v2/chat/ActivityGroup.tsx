import { useI18n } from '@droidvisx/chat-ui/i18n';
import { memo, useMemo, type ReactNode } from 'react';
import { ActivityGroupView } from '@droidvisx/chat-ui/chat/ActivityGroupView';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { presentActivity, type ProcessWaiting } from './transcript/activityPresentation';
import { type GroupCandidatePart } from './transcript/activityGrouping';

export type ActivityItem = Extract<SessionTranscriptItem, { kind: 'tool' | 'thinking' }>;
export interface ActivityCluster { readonly id: string; readonly items: readonly SessionTranscriptItem[]; readonly grouped: boolean }

export function clusterActivity(items: readonly SessionTranscriptItem[]): readonly ActivityCluster[] {
  const groups: { id: string; items: SessionTranscriptItem[]; grouped: boolean }[] = [];
  let boundary = 'start';
  for (const item of items) {
    if (item.kind === 'assistant' && item.text.trim().length === 0) continue;
    // Delegations outlive the parent reply and must remain visible outside folded activity.
    const grouped = item.kind === 'thinking' || item.kind === 'tool' && item.subagent === undefined;
    const prior = groups.at(-1);
    if (grouped && prior?.grouped) prior.items.push(item);
    else groups.push({ id: grouped ? `process:${boundary}` : item.id, items: [item], grouped });
    if (!grouped) boundary = item.id;
  }
  return groups;
}

function candidate(item: SessionTranscriptItem): GroupCandidatePart {
  if (item.kind === 'thinking') return {
    type: 'reasoning',
    text: item.text,
    status: { type: item.status === 'active' ? 'running' : item.status === 'stopped' || item.status === 'stopping' ? 'incomplete' : 'complete' },
    providerMetadata: { droidvisx: { durationMs: item.durationMs ?? null, truncated: item.truncated } },
  };
  return item.kind === 'tool' ? { type: 'tool-call', toolName: item.toolName, providerMetadata: { droidvisx: item } } : { type: item.kind };
}

const HistoryItems = memo(function HistoryItems({ items, renderItem }: {
  readonly items: readonly SessionTranscriptItem[];
  readonly renderItem: (item: SessionTranscriptItem, grouped: boolean) => ReactNode;
}) {
  return <>{items.map((item) => <div key={item.id}>{renderItem(item, true)}</div>)}</>;
}, (before, after) => before.renderItem === after.renderItem && before.items.length === after.items.length &&
  before.items.every((item, index) => item === after.items[index]));

export function ActivityGroup({ messageId, cluster, turnId, running, tail, incomplete, waiting, renderItem }: {
  readonly messageId: string;
  readonly cluster: ActivityCluster;
  readonly turnId: string;
  readonly running: boolean;
  readonly tail: boolean;
  readonly incomplete: string | null;
  readonly waiting: ProcessWaiting | null;
  readonly renderItem: (item: SessionTranscriptItem, grouped: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const members = useMemo(() => cluster.items.map(candidate), [cluster.items]);
  const presentation = presentActivity({ members, messageRunning: running, tail, incomplete, turnId, waiting, t });
  const latest = tail ? cluster.items.at(-1) : undefined;
  const latestHasTerminal = latest?.kind === 'tool'
    ? incomplete === 'error' ? latest.status === 'failed' : latest.status === 'stopped' || latest.status === 'stopping'
    : latest?.kind === 'thinking' && incomplete === 'cancelled' && latest.status !== 'complete';
  const notice = cluster.items.length === 0 && incomplete && !latestHasTerminal
    ? t(incomplete === 'error' ? 'failed' : 'stopped') : undefined;
  return <ActivityGroupView messageId={messageId} groupId={cluster.id}
    presentation={{ ...presentation, count: cluster.items.length, ...(notice ? { notice } : {}) }}>
    <HistoryItems items={cluster.items} renderItem={renderItem} />
  </ActivityGroupView>;
}
