import { memo, useContext } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { Message, MessageContent } from '../ai-elements/message';
import { Markdown } from '../content/Markdown';
import { ImageContent } from '../content/MediaPreview';
import { Changes } from './Changes';
import { ToolRow } from './ToolRow';
import { ThinkingRow } from './ThinkingRow';
import { SelectSessionContext } from '../../webview/assistant/thread/messageContexts';
import { Button } from '../ui/button';

export const TranscriptRow = memo(function TranscriptRow({ item, streaming, grouped, messageId, readOnly = false }: {
  readonly item: SessionTranscriptItem; readonly streaming: boolean; readonly grouped: boolean; readonly messageId: string; readonly readOnly?: boolean;
}) {
  const selectSession = useContext(SelectSessionContext);
  if (item.kind === 'user') return <Message from="user" className="rounded-md border border-border bg-muted/40 p-2.5"><MessageContent className="whitespace-pre-wrap">{item.text}</MessageContent></Message>;
  if (item.kind === 'assistant') return <Message from="assistant"><MessageContent><Markdown text={item.text} streaming={streaming} /></MessageContent></Message>;
  if (item.kind === 'thinking') return <ThinkingRow item={item} messageId={messageId} grouped={grouped} streaming={streaming} />;
  if (item.kind === 'tool') return <ToolRow item={item} messageId={messageId} grouped={grouped} />;
  if (item.kind === 'diagnostic') {
    if (item.code === 'session-compacted') {
      const count = /(\d+) earlier message/.exec(item.message)?.[1];
      return <div role="status" title={item.message} className="my-4 flex items-center gap-3 text-[10.5px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        <span>{count ? `Summarized ${count} earlier ${count === '1' ? 'message' : 'messages'}` : 'Conversation summarized'}
          {item.relatedSessionId && selectSession && !readOnly ? <> · <Button variant="plain" size="none" className="hover:text-foreground hover:underline" onClick={() => selectSession(item.relatedSessionId!)}>View full history</Button></> : null}
        </span>
      </div>;
    }
    return <p role={item.severity === 'error' ? 'alert' : 'status'} title={`${item.code}: ${item.message}`} className={`text-xs ${item.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.message}</p>;
  }
  if (item.kind === 'image') return item.data.length === 0 ? <p role="note" className="text-xs text-muted-foreground">Image preview unavailable</p> : <ImageContent src={`data:${item.mediaType};base64,${item.data}`} alt={item.generated ? 'Generated image' : 'Message attachment'} generated={item.generated} />;
  if (item.kind === 'changes') return readOnly ? null : <Changes item={item} messageId={messageId} />;
  return item.status === 'cancelled' ? <p className="my-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">Questions cancelled</p> : <dl className="my-2 max-w-[560px] divide-y divide-border rounded-lg border border-border text-[13px] leading-[21px]">
    {item.answers.map((answer, index) => <div key={index} className="grid gap-3 p-3"><dt><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Droid</span>{answer.question ?? answer.topic}</dt><dd className="whitespace-pre-wrap"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">You</span>{answer.answer}</dd></div>)}
  </dl>;
});
