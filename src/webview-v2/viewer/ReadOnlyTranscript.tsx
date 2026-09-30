import { ReadOnlyTranscriptView } from '@droidvisx/chat-ui/chat/ReadOnlyTranscriptView';
import { useMemo, useState } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { describeTranscript } from '../chat/transcript/transcriptGroups';
import { resolveAssistantStatus } from '../chat/transcript/transcriptStatus';
import { AssistantReply } from '../chat/AssistantReply';
import { ReadOnlyQuestion } from './ReadOnlyQuestion';
import { isPlanLive, selectPlanAnchors } from '../chat/transcript/planAnchor';
import { PlanLine } from '../chat/PlanLine';
import { summarizeOperations } from '../chat/operationSummary';

export function ReadOnlyTranscript({ items, running, truncated = false }: { readonly items: readonly SessionTranscriptItem[]; readonly running: boolean; readonly truncated?: boolean }) {
  const { descriptors, replyTails, replyTimestamps } = useMemo(() => describeTranscript(items), [items]);
  const plans = useMemo(() => selectPlanAnchors(items), [items]);
  const operationSummaries = useMemo(() => summarizeOperations(items), [items]);
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
  const byId = new Map(descriptors.map((descriptor) => [descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, descriptor]));
  const messages = descriptors.map((descriptor) => ({ id: descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, role: descriptor.kind }));
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
}
