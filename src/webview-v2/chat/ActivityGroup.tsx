import { useI18n } from '@droidvisx/chat-ui/i18n';
import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { ActivityGroupView } from '@droidvisx/chat-ui/chat/ActivityGroupView';
import { FileChangeRecord } from '@droidvisx/chat-ui/chat/FileChangeRecord';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { isConfirmedWorkspaceChange, operationDiffWithChanges } from '../../shared/protocol/operationDiff';
import { OperationDiff } from '../content/OperationDiff';
import { isFoldableFileOperation, operationFileStats } from './operationSummary';
import { presentActivity, type ProcessWaiting } from './transcript/activityPresentation';
import { type GroupCandidatePart } from './transcript/activityGrouping';

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
    type: 'reasoning',
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

export function ActivityGroup({ messageId, cluster, turnId, running, tail, incomplete, waiting, renderItem, onInteract }: {
  readonly messageId: string;
  readonly cluster: ActivityCluster;
  readonly turnId: string;
  readonly running: boolean;
  readonly tail: boolean;
  readonly incomplete: string | null;
  readonly waiting: ProcessWaiting | null;
  readonly renderItem: (item: SessionTranscriptItem, grouped: boolean) => ReactNode;
  readonly onInteract?: () => void;
}) {
  const { t } = useI18n();
  const members = useMemo(() => cluster.items.map(candidate), [cluster.items]);
  const presentation = presentActivity({ members, messageRunning: running, tail, incomplete, turnId, waiting, t });
  const results = useMemo(() => cluster.items.flatMap(item => {
    if (item.kind !== 'tool' || !item.operationDiff) return [];
    const result = operationDiffWithChanges(item.operationDiff);
    if (result.status !== 'ready' || result.source !== 'tool-result') return [];
    const files = result.files.filter(file => isConfirmedWorkspaceChange(result, file));
    return files.length ? [{ item, files }] : [];
  }), [cluster.items]);
  const resultById = useMemo(() => new Map(results.map(result => [result.item.id, result])), [results]);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const renderProcessItem = useCallback((item: SessionTranscriptItem, grouped: boolean) => {
    const result = resultById.get(item.id);
    if (!result || !isFoldableFileOperation(item)) return renderItem(item, grouped);
    return <>{result.files.map(file => <FileChangeRecord key={file.path} file={operationFileStats(file)} onSelect={() => {
      onInteract?.();
      const card = cards.current.get(item.id);
      card?.scrollIntoView({ block: 'nearest' });
      card?.focus({ preventScroll: true });
    }} />)}</>;
  }, [resultById, renderItem, onInteract]);
  const last = cluster.items.at(-1);
  const latest = tail && (running || incomplete !== null) && last && !isFoldableFileOperation(last) ? last : undefined;
  const history = latest ? cluster.items.slice(0, -1) : cluster.items;
  const latestHasTerminal = latest?.kind === 'tool'
    ? incomplete === 'error' ? latest.status === 'failed' : latest.status === 'stopped' || latest.status === 'stopping'
    : latest?.kind === 'thinking' && incomplete === 'cancelled' && latest.status !== 'complete';
  const notice = history.length === 0 && incomplete && !latestHasTerminal
    ? t(incomplete === 'error' ? 'failed' : 'stopped') : undefined;
  return <>
    <ActivityGroupView messageId={messageId} groupId={cluster.id}
    presentation={{ ...presentation, count: history.length, ...(notice ? { notice } : {}) }}
    latest={latest ? <div key={latest.id}>{renderProcessItem(latest, true)}</div> : null}
    attention={<HistoryItems items={history.filter((item) => item.kind === 'tool' && item.status === 'failed')} renderItem={renderProcessItem} />}>
    <HistoryItems items={history} renderItem={renderProcessItem} />
    </ActivityGroupView>
    {results.map(({ item }) => <div key={item.id} tabIndex={-1} className="min-w-0"
      ref={element => { if (element) cards.current.set(item.id, element); else cards.current.delete(item.id); }}>
      <OperationDiff item={item} messageId={messageId} confirmedOnly onInteract={onInteract} />
    </div>)}
  </>;
}
