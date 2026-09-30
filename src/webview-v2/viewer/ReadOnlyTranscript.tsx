import { ReadOnlyTranscriptView } from '@droidvisx/chat-ui/chat/ReadOnlyTranscriptView';
import { memo, useMemo, useState } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { createTranscriptSelector } from '../chat/transcript/transcriptGroups';
import { resolveAssistantStatus } from '../chat/transcript/transcriptStatus';
import { AssistantReply } from '../chat/AssistantReply';
import { ReadOnlyQuestion } from './ReadOnlyQuestion';
import { isPlanLive, selectPlanAnchors } from '../chat/transcript/planAnchor';
import { PlanLine } from '../chat/PlanLine';
import { createOperationSummarySelector } from '../chat/operationSummary';
import { createTranscriptMessagesSelector } from '../chat/transcriptProjection';

const NO_PENDING_REPLIES: ReadonlySet<string> = new Set();

export const ReadOnlyTranscript = memo(function ReadOnlyTranscript({ items, running, truncated = false }: { readonly items: readonly SessionTranscriptItem[]; readonly running: boolean; readonly truncated?: boolean }) {
  const selectors = useMemo(() => ({ transcript: createTranscriptSelector(), operations: createOperationSummarySelector(),
    messages: createTranscriptMessagesSelector() }), []);
  const { descriptors, replyTails, replyTimestamps } = useMemo(() => selectors.transcript(items), [items, selectors]);
  const plans = useMemo(() => selectPlanAnchors(items), [items]);
  const operationSummaries = useMemo(() => selectors.operations(items), [items, selectors]);
  const [planChoices, setPlanChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const turnId = useMemo(() => {
    if (!running) return null;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind !== 'user' && 'turnId' in item && typeof item.turnId === 'string') return item.turnId;
    }
    return null;
  }, [running, items]);
  const active = turnId ? { turnId, status: 'streaming' as const } : null;
  const byId = useMemo(() => new Map(descriptors.map((descriptor) => [descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, descriptor])), [descriptors]);
  const messages = useMemo(() => selectors.messages(descriptors, replyTails, NO_PENDING_REPLIES), [descriptors, replyTails, selectors]);
  return <ReadOnlyTranscriptView messages={messages} truncated={truncated} renderMessage={(id, stopFollowing) => {
    const descriptor = byId.get(id)!;
    if (descriptor.kind === 'user') {
      const plan = plans.get(descriptor.item.id);
      return <><ReadOnlyQuestion item={descriptor.item} images={descriptor.images} onInteract={stopFollowing} />
        {plan ? <PlanLine anchor={plan} running={isPlanLive(plan, running, turnId)} override={planChoices.get(plan.anchorToolUseId) ?? null}
          onToggle={(id, expanded) => { stopFollowing(); setPlanChoices((previous) => new Map(previous).set(id, expanded)); }} /> : null}</>;
    }
    const status = resolveAssistantStatus(descriptor.items, descriptor.turnId, active);
    return <AssistantReply descriptor={descriptor} status={status} waiting={null} replyText={replyTails.get(descriptor.id)} readOnly
      operationSummary={operationSummaries.get(descriptor.turnId)} operationsLive={status.type === 'running'} onInteract={stopFollowing}
      completedAt={status.type === 'running' ? undefined : replyTimestamps.get(descriptor.id)} regenerate={undefined} fork={undefined} />;
  }} />;
});
