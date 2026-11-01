import { ReadOnlyTranscriptView } from '@droidvisx/chat-ui/chat/ReadOnlyTranscriptView';
import { memo, useCallback, useMemo, useState } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { createTranscriptSelector } from '../chat/transcript/transcriptGroups';
import { matchesAssistantTurn, replyOperationsLive, resolveAssistantStatus } from '../chat/transcript/transcriptStatus';
import { AssistantReply } from '../chat/AssistantReply';
import { ReadOnlyQuestion } from './ReadOnlyQuestion';
import { createPlanAnchorSelector, isPlanLive } from '../chat/transcript/planAnchor';
import { PlanLine } from '../chat/PlanLine';
import { createOperationSummarySelector, summarizeReplyOperations } from '../chat/operationSummary';
import { createTranscriptMessagesSelector, createTranscriptStructureSelector } from '../chat/transcriptProjection';

export const ReadOnlyTranscript = memo(function ReadOnlyTranscript({ items, running, truncated = false }: { readonly items: readonly SessionTranscriptItem[]; readonly running: boolean; readonly truncated?: boolean }) {
  const selectors = useMemo(() => ({ transcript: createTranscriptSelector(), operations: createOperationSummarySelector(),
    plans: createPlanAnchorSelector(), structure: createTranscriptStructureSelector(), messages: createTranscriptMessagesSelector() }), []);
  const { descriptors, replyTails, replyTimestamps } = useMemo(() => selectors.transcript(items), [items, selectors]);
  const plans = useMemo(() => selectors.plans(items), [items, selectors]);
  const operationSummaries = useMemo(() => selectors.operations(items), [items, selectors]);
  const replySummaries = useMemo(() => summarizeReplyOperations(operationSummaries, descriptors), [operationSummaries, descriptors]);
  const [planChoices, setPlanChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const turnId = useMemo(() => {
    if (!running) return null;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind !== 'user' && 'turnId' in item && typeof item.turnId === 'string') return item.turnId;
    }
    return null;
  }, [running, items]);
  const active = useMemo(() => turnId ? { turnId, status: 'streaming' as const } : null, [turnId]);
  const { turns } = useMemo(() => selectors.structure(descriptors), [descriptors, selectors]);
  const byId = useMemo(() => new Map(descriptors.map((descriptor) => [descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, descriptor])), [descriptors]);
  const pendingReplyRow = useMemo(() => running
    ? (turns.find((row) => row.messageIds.some((id) => {
      const descriptor = byId.get(id)!;
      return descriptor.kind === 'assistant' && matchesAssistantTurn(descriptor.items, descriptor.turnId, turnId);
    })) ?? turns.at(-1))?.id : undefined, [running, turnId, turns, byId]);
  const lastReplyId = [...replyTails.keys()].at(-1);
  const pendingIds = useMemo(() => new Set(turns.find((row) => row.id === pendingReplyRow)?.messageIds ?? []), [turns, pendingReplyRow]);
  const messages = useMemo(() => selectors.messages(descriptors, replyTails, pendingIds), [descriptors, replyTails, pendingIds, selectors]);
  const renderMessage = useCallback((id: string, stopFollowing: () => void) => {
    const descriptor = byId.get(id)!;
    if (descriptor.kind === 'user') {
      const plan = plans.get(descriptor.item.id);
      return <><ReadOnlyQuestion item={descriptor.item} images={descriptor.images} onInteract={stopFollowing} />
        {plan ? <PlanLine anchor={plan} running={isPlanLive(plan, running, turnId)} override={planChoices.get(plan.anchorToolUseId) ?? null}
          onToggle={(planId, expanded) => { stopFollowing(); setPlanChoices((previous) => new Map(previous).set(planId, expanded)); }} /> : null}</>;
    }
    const replyPending = pendingIds.has(id);
    const isPendingTail = replyPending && descriptor.id === lastReplyId;
    const activeTurn = isPendingTail ? { turnId: descriptor.turnId, status: 'streaming' as const } : active;
    const status = resolveAssistantStatus(descriptor.items, descriptor.turnId, activeTurn);
    const operationsLive = replyOperationsLive(status, replyPending, running && turnId === descriptor.turnId);
    return <AssistantReply descriptor={descriptor} status={status} waiting={null}
      replyText={replyPending ? undefined : replyTails.get(descriptor.id)} readOnly
      operationSummary={replySummaries.get(descriptor.id)} operationsLive={operationsLive} onInteract={stopFollowing}
      completedAt={replyPending || status.type === 'running' ? undefined : replyTimestamps.get(descriptor.id)} regenerate={undefined} fork={undefined} />;
  }, [byId, plans, running, turnId, planChoices, pendingIds, lastReplyId, active, replyTails, replySummaries, replyTimestamps]);
  return <ReadOnlyTranscriptView messages={messages} truncated={truncated} renderMessage={renderMessage} />;
});
