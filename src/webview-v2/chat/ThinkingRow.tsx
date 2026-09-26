import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import type { ThinkingTranscriptItem } from '../../shared/protocol/transcript';
import { formatThinkingLabel } from '../../webview/assistant/thread/readers';
import { Tool, ToolContent, ToolHeader } from '../ai-elements/tool';
import { Markdown } from '../content/Markdown';
import { ActivityItem } from './ActivityItem';

export function ThinkingRow({ item, messageId, grouped, streaming }: { readonly item: ThinkingTranscriptItem; readonly messageId: string; readonly grouped: boolean; readonly streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const running = item.status === 'active' && streaming;
  useEffect(() => {
    setWaiting(false);
    if (!running || item.truncated) return;
    const timer = setTimeout(() => setWaiting(true), 10_000);
    return () => clearTimeout(timer);
  }, [running, item.text.length, item.truncated]);
  const text = item.text.replace(/(?<=\S)\*{4}(?=\S)/gu, '**\n\n**');
  const body = <div className="v2-thinking-detail select-none text-muted-foreground [&_*]:select-none"><Markdown text={text} streaming={running} thinking />
    {item.truncated ? <p role="note" className="mt-2 text-[11px]">Thinking reached the local safety limit; later reasoning is not retained.</p> : null}
  </div>;
  if (grouped) return <ActivityItem textSelectable={false} id={item.id} messageId={messageId} icon={<Brain />} title={running ? 'Thinking' : formatThinkingLabel(item.status === 'complete' ? 'complete' : 'incomplete', item.durationMs ?? null)}
    status={item.truncated ? 'Safety limit' : running ? waiting ? 'Waiting' : 'Receiving' : undefined}>{body}</ActivityItem>;
  return <Tool open={expanded} onOpenChange={setExpanded}>
    <ToolHeader className="select-none" title={running ? 'Thinking' : formatThinkingLabel(item.status === 'complete' ? 'complete' : 'incomplete', item.durationMs ?? null)}
      status={item.truncated ? 'Safety limit reached' : running ? waiting ? 'Waiting for model' : 'Receiving' : ''} />
    <ToolContent className="pb-1">{body}</ToolContent>
  </Tool>;
}
