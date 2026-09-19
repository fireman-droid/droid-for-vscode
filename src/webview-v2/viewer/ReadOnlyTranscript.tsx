import { ReadOnlyTranscriptView } from '@droidvisx/chat-ui/chat/ReadOnlyTranscriptView';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { describeTranscript } from '../../webview/assistant/transcript/transcriptGroups';
import { observeCompletion, resolveAssistantStatus, type CompletionClock } from '../../webview/assistant/transcript/transcriptStatus';
import { AssistantReply } from '../chat/AssistantReply';
import { ReadOnlyQuestion } from './ReadOnlyQuestion';
import { isPlanLive, selectPlanAnchors } from '../../webview/assistant/transcript/planAnchor';
import { PlanLine } from '../chat/PlanLine';

export function ReadOnlyTranscript({ items, running, truncated = false }: { readonly items: readonly SessionTranscriptItem[]; readonly running: boolean; readonly truncated?: boolean }) {
  const { descriptors, replyTails } = useMemo(() => describeTranscript(items), [items]);
  const plans = useMemo(() => selectPlanAnchors(items), [items]);
  const [planChoice, setPlanChoice] = useState<{ id: string; expanded: boolean } | null>(null);
  const ids = useMemo(() => descriptors.map((item) => item.kind === 'user' ? item.item.id : item.id), [descriptors]);
  const clock = useRef<CompletionClock>(new Map());
  const turnId = useMemo(() => {
    if (!running) return null;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind !== 'user' && 'turnId' in item && typeof item.turnId === 'string') return item.turnId;
    }
    return null;
  }, [running, items]);
  const active = turnId ? { turnId, status: 'streaming' as const } : null;
  useEffect(() => { const retained = new Set(ids); for (const id of clock.current.keys()) if (!retained.has(id)) clock.current.delete(id); }, [ids]);
  const byId = new Map(descriptors.map((descriptor) => [descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, descriptor]));
  const messages = descriptors.map((descriptor) => ({ id: descriptor.kind === 'user' ? descriptor.item.id : descriptor.id, role: descriptor.kind }));
  return <ReadOnlyTranscriptView messages={messages} truncated={truncated} renderMessage={(id, stopFollowing) => {
    const descriptor = byId.get(id)!;
    if (descriptor.kind === 'user') {
      const plan = plans.get(descriptor.item.id);
      return <><ReadOnlyQuestion item={descriptor.item} images={descriptor.images} />
        {plan ? <PlanLine anchor={plan} running={isPlanLive(plan, running, turnId)} override={planChoice?.id === plan.anchorToolUseId ? planChoice.expanded : null}
          onToggle={(id, expanded) => { stopFollowing(); setPlanChoice({ id, expanded }); }} /> : null}</>;
    }
    const status = resolveAssistantStatus(descriptor.items, descriptor.turnId, active);
    return <AssistantReply descriptor={descriptor} status={status} waiting={null} replyText={replyTails.get(descriptor.id)} readOnly
      completedAt={observeCompletion(clock.current, descriptor.id, status.type === 'running')} regenerate={undefined} fork={undefined} />;
  }} />;
}
