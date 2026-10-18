import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useMemo, type ReactNode } from 'react';
import { ActivityGroupView } from '@droidvisx/chat-ui/chat/ActivityGroupView';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { presentActivity, type ProcessWaiting } from './transcript/activityPresentation';
import { type GroupCandidatePart } from './transcript/activityGrouping';
import { commandCardTitle } from './composer/commandCard';
import { formatDuration, formatToolLifecycle } from './thread/readers';
import { resolveToolAction } from '../../shared/transcript/toolActivity';
import { formatThinkingLabel } from '@droidvisx/chat-ui/chat/thinkingLabel';

export type ActivityItem = Extract<SessionTranscriptItem, { kind: 'tool' | 'thinking' }>;
export interface ActivityCluster { readonly id: string; readonly items: readonly SessionTranscriptItem[]; readonly grouped: boolean }

export function clusterActivity(items: readonly SessionTranscriptItem[]): readonly ActivityCluster[] {
  const groups: { id: string; items: SessionTranscriptItem[]; grouped: boolean }[] = [];
  let boundary = 'start';
  for (const item of items) {
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
    type: 'reasoning', text: item.text,
    status: { type: item.status === 'active' ? 'running' : item.status === 'stopped' || item.status === 'stopping' ? 'incomplete' : 'complete' },
    providerMetadata: { droidvisx: { durationMs: item.durationMs ?? null, truncated: item.truncated } },
  };
  return item.kind === 'tool' ? { type: 'tool-call', toolName: item.toolName, providerMetadata: { droidvisx: item } } : { type: item.kind };
}

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
  const render = (item: SessionTranscriptItem) => <div key={item.id}>{renderItem(item, true)}</div>;
  const presentation = presentActivity({ members, messageRunning: running, tail, incomplete, turnId, waiting, t });
  const item = cluster.items.at(-1)!;
  const latest = item.kind === 'tool' ? {
    label: [t(item.detailKind === 'command' ? commandCardTitle(item.action, item.toolName, item.detail ?? null)
      : resolveToolAction(item.toolName, item.action)), item.filePath ?? item.target].filter(Boolean).join(' '),
    status: [t(incomplete && (item.status === 'running' || item.status === 'stopping') ? ''
      : item.status === 'stopping' ? 'Stopping' : formatToolLifecycle(item.status)),
      item.durationMs === undefined ? '' : formatDuration(item.durationMs)].filter(Boolean).join(' · '),
  } : item.kind === 'thinking' ? {
    label: item.status === 'active' && running ? t('Thinking')
      : formatThinkingLabel(item.status === 'complete' ? 'complete' : 'incomplete', item.durationMs ?? null, t),
    status: '',
  } : undefined;
  return <ActivityGroupView messageId={messageId} groupId={cluster.id} incomplete={incomplete}
    presentation={{ ...presentation, latest: presentation.waiting ? undefined : latest, count: cluster.items.length }}
    attention={cluster.items.filter((item) => item.kind === 'tool' && item.status === 'failed').map(render)}>
    {cluster.items.map(render)}
  </ActivityGroupView>;
}
