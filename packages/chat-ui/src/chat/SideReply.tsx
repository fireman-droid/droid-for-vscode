import { useI18n } from '../i18n';
import type { SideConversation, SideReplyPart, SideToolActivity } from './sideChat';
import { DroidActivity } from '../ui/droid-motion';
import { ActivityGroupView } from './ActivityGroupView';
import { AssistantMessage } from './AssistantMessage';
import { ReplyView } from './ReplyView';
import { ThinkingView } from './ThinkingView';
import { SIDE_TOOL_LABELS, SideAnalysisResult, SideToolItem, summarizeSideTools } from './SideToolRecords';

type Entry = SideConversation['entries'][number];
type Progress = NonNullable<Entry['progress']>;
type ThinkingPart = Extract<SideReplyPart, { kind: 'thinking' }>;
type ProcessItem = { readonly thinking: ThinkingPart } | { readonly tool: SideToolActivity };
type Segment =
  | { readonly kind: 'process'; readonly id: string; readonly items: ProcessItem[] }
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | { readonly kind: 'analysis'; readonly tool: SideToolActivity };

const PROGRESS_LABELS = {
  waiting: 'Waiting for reply…', thinking: 'Thinking…', tool: 'Using tools…', answering: 'Receiving reply…',
} as const;

/** Adjacent thinking and tool parts share one process group; prose and finished examples break it. */
function segmentsOf(entry: Entry): readonly Segment[] {
  const tools = new Map((entry.tools ?? []).map((tool) => [tool.id, tool]));
  const parts = entry.parts ?? [];
  const starts = parts.flatMap((part) => part.kind === 'text' ? [part.start] : []);
  const segments: Segment[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      const end = starts.find((start) => start > part.start) ?? entry.answer.length;
      segments.push({ kind: 'text', id: `text:${part.start}`, text: entry.answer.slice(part.start, end) });
      continue;
    }
    const tool = part.kind === 'tool' ? tools.get(part.id) : undefined;
    if (part.kind === 'tool' && tool === undefined) continue;
    if (tool?.kind === 'analysis' && tool.state !== 'running') {
      segments.push({ kind: 'analysis', tool });
      continue;
    }
    const item: ProcessItem = tool ? { tool } : { thinking: part as ThinkingPart };
    const last = segments.at(-1);
    if (last?.kind === 'process') last.items.push(item);
    else segments.push({ kind: 'process', id: `process:${part.id}`, items: [item] });
  }
  if (!starts.length && entry.answer) segments.push({ kind: 'text', id: 'text:0', text: entry.answer });
  return segments;
}

function ProcessSegment({ entry, items, groupId, live, progress }: {
  readonly entry: Entry; readonly items: readonly ProcessItem[]; readonly groupId: string;
  readonly live: boolean; readonly progress: Progress;
}) {
  const { t } = useI18n();
  const tools = items.flatMap((item) => 'tool' in item ? [item.tool] : []);
  const thoughts = items.length - tools.length;
  const failed = tools.filter((tool) => tool.state === 'error').length;
  const unconfirmed = !live && tools.some((tool) => tool.state === 'running' || tool.state === 'incomplete');
  const summary = [thoughts ? t(thoughts === 1 ? '{count} thought' : '{count} thoughts', { count: thoughts }) : '',
    summarizeSideTools(tools, t)].filter(Boolean).join(', ');
  const activeTool = [...tools].reverse().find((tool) => tool.state === 'running');
  const thinking = items.some((item) => 'thinking' in item && item.thinking.active);
  return <ActivityGroupView messageId={entry.id} groupId={groupId} presentation={{
    running: live,
    action: activeTool ? SIDE_TOOL_LABELS[activeTool.kind][0] : thinking ? 'Thinking…' : PROGRESS_LABELS[progress],
    target: activeTool?.target ?? null,
    summary,
    facts: failed ? [t('{count} failed', { count: failed })] : unconfirmed ? [t('Result unconfirmed')] : [],
    failed: failed > 0,
    count: items.length,
  }}>
    {items.map((item) => 'tool' in item
      ? <SideToolItem key={item.tool.id} messageId={entry.id} tool={item.tool} />
      : <ThinkingView key={item.thinking.id} text={item.thinking.text} durationMs={item.thinking.durationMs}
        truncated={item.thinking.truncated} activity={{ id: item.thinking.id, messageId: entry.id }}
        status={item.thinking.active && entry.state === 'streaming' ? 'active'
          : item.thinking.active || entry.state === 'error' ? 'incomplete' : 'complete'} />)}
  </ActivityGroupView>;
}

export function SideReply({ entry, preparing }: { readonly entry: Entry; readonly preparing: boolean }) {
  const { t } = useI18n();
  const running = entry.state === 'streaming';
  const progress = entry.progress ?? (entry.answer ? 'answering' : 'waiting');
  const segments = segmentsOf(entry);
  const tail = segments.at(-1);
  const liveProcess = running && tail?.kind === 'process' && progress !== 'answering';
  const waiting = running && !liveProcess && (preparing || progress !== 'answering' || !entry.answer)
    ? { label: t(preparing ? 'Preparing' : PROGRESS_LABELS[progress]), loading: preparing || progress === 'waiting' }
    : undefined;
  return <ReplyView replyText={entry.answer || undefined} running={running} readOnly showTimestamp={false}>
    {segments.map((segment, index) => segment.kind === 'process'
      ? <ProcessSegment key={segment.id} entry={entry} items={segment.items} groupId={segment.id}
        live={liveProcess && index === segments.length - 1} progress={progress} />
      : segment.kind === 'analysis' ? <SideAnalysisResult key={segment.tool.id} tool={segment.tool} />
      : segment.text.trim() ? <AssistantMessage key={segment.id} text={segment.text} streaming={running && index === segments.length - 1} />
      : null)}
    {waiting ? <p role="status" aria-live="polite" data-ui-notice="" className="v2-btw-progress">
      <DroidActivity phase={waiting.loading ? 'loading' : 'working'} />
      <span title={waiting.label}>{waiting.label}</span>
    </p> : null}
    {entry.stopped ? <p role="status" data-ui-notice="" className="text-[11px] text-muted-foreground">{t('Stopped')}</p> : null}
  </ReplyView>;
}
