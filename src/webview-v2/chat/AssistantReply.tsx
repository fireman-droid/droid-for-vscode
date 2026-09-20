import { memo, useMemo, type ReactNode } from 'react';
import { ReplyView } from '@droidvisx/chat-ui/chat/ReplyView';
import { shallow } from 'zustand/shallow';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { AssistantGroupDescriptor } from '../../webview/assistant/transcript/transcriptGroups';
import type { TranscriptStatus } from '../../webview/assistant/transcript/transcriptStatus';
import type { ProcessWaiting } from '../../webview/assistant/transcript/activityPresentation';
import { ActivityGroup, clusterActivity } from './ActivityGroup';
import { TranscriptRow } from './TranscriptRow';
import { AiOperationSummary } from './AiOperationSummary';
import { isFoldableFileOperation, type OperationSummary } from './operationSummary';

export const AssistantReply = memo(function AssistantReply({ descriptor, status, waiting, replyText, completedAt, regenerate, fork, renderItem, readOnly = false, operationSummary, operationsLive = status.type === 'running', onInteract }: {
  readonly descriptor: AssistantGroupDescriptor;
  readonly status: TranscriptStatus;
  readonly waiting: ProcessWaiting | null;
  readonly replyText: string | undefined;
  readonly completedAt: number | undefined;
  readonly regenerate: (() => void) | undefined;
  readonly fork: (() => void) | undefined;
  readonly renderItem?: (item: SessionTranscriptItem, grouped: boolean) => ReactNode;
  readonly readOnly?: boolean;
  readonly operationSummary?: OperationSummary;
  readonly operationsLive?: boolean;
  readonly onInteract?: () => void;
}) {
  const summarized = !operationsLive && !!operationSummary?.files.size;
  const clusters = useMemo(() => clusterActivity(summarized ? descriptor.items.filter((item) => !isFoldableFileOperation(item)) : descriptor.items).filter((cluster) => {
    const item = cluster.items[0]!;
    return item.kind !== 'assistant' || item.text.trim().length > 0;
  }), [descriptor.items, summarized]);
  const render = renderItem ?? ((item: SessionTranscriptItem, grouped: boolean) =>
    <TranscriptRow item={item} messageId={descriptor.id} streaming={status.type === 'running'} grouped={grouped} readOnly={readOnly} hideConfirmedOperations={summarized} onInteract={onInteract} />);
  const diagnosticOnly = descriptor.items.every((item) => item.kind === 'diagnostic');
  return <ReplyView label={diagnosticOnly ? 'System notice' : readOnly ? 'Subagent' : 'Droid'} diagnosticOnly={diagnosticOnly}
    readOnly={readOnly} replyText={replyText} running={status.type === 'running'} completedAt={completedAt} regenerate={regenerate} fork={fork}>
    {clusters.map((cluster, index) => cluster.grouped ? (
      <ActivityGroup
        key={cluster.id} messageId={descriptor.id} cluster={cluster} turnId={descriptor.turnId}
        running={status.type === 'running'} tail={index === clusters.length - 1}
        incomplete={status.type === 'incomplete' ? status.reason : null} waiting={waiting}
      >{cluster.items.map((item) => <div key={item.id}>{render(item, true)}</div>)}</ActivityGroup>
    ) : <div key={cluster.id} className="contents">{render(cluster.items[0]!, false)}</div>)}
    {summarized ? <AiOperationSummary summary={operationSummary!} onInteract={onInteract} /> : null}
  </ReplyView>;
}, (before, after) => {
  const { descriptor: a, status: aStatus, ...aRest } = before;
  const { descriptor: b, status: bStatus, ...bRest } = after;
  return a.id === b.id && a.turnId === b.turnId && shallow(a.items, b.items) &&
    shallow(aStatus, bStatus) && shallow(aRest, bRest);
});
