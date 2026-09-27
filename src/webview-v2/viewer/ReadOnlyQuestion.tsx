import { memo } from 'react';
import { QuoteChips } from '@droidvisx/chat-ui/chat/QuoteChips';
import type { ImageTranscriptItem } from '../../shared/protocol/attachments';
import type { UserTranscriptItem } from '../../shared/protocol/transcript';
import { parseDelegatedTask } from '../chat/transcript/delegatedTask';
import { parseSelectionQuotes } from '@droidvisx/chat-ui/chat/selectionQuote';
import { SentAttachments } from '../chat/EditAttachments';
import { formatExactMessageTime } from '@droidvisx/chat-ui/chat/MessageTimestamp';
import { ImageContent } from '../content/MediaPreview';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { Tooltip } from '../ui/overlays';

export const ReadOnlyQuestion = memo(function ReadOnlyQuestion({ item, images }: {
  readonly item: UserTranscriptItem;
  readonly images: readonly ImageTranscriptItem[];
}) {
  const delegated = parseDelegatedTask(item.text);
  const quote = parseSelectionQuotes(item.text);
  return <Tooltip content={formatExactMessageTime(item.timestamp ?? null)}><div tabIndex={0} className="v2-viewer-question space-y-2 overflow-hidden rounded-lg border border-border bg-input-background px-3.5 py-3 text-xs outline-none focus-visible:outline-1 focus-visible:outline-[var(--focus)]">
    {images.map((image) => image.data ? <ImageContent key={image.id} src={`data:${image.mediaType};base64,${image.data}`} alt="Message attachment" thumbnail /> : <p key={image.id}>Image preview unavailable</p>)}
    {delegated ? <div aria-label="Delegated task" className="grid gap-2">
      <header className="flex min-w-0 items-baseline justify-between gap-3"><span className="text-[11.5px] font-semibold">Delegated task</span><span className="shrink-0 text-[10.5px] text-muted-foreground">{delegated.type}{delegated.complexity === null ? '' : ` · ${delegated.complexity}`}</span></header>
      <strong className="text-[13px] font-semibold leading-[19px]">{delegated.description}</strong>
      <div className="whitespace-pre-wrap break-words leading-[19px]">{delegated.task}</div>
      <Collapsible className="v2-viewer-details border-t border-border/70 pt-0.5"><CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-viewer-details-trigger w-fit pt-[7px] text-[10.5px] text-muted-foreground hover:text-foreground">Invocation details</Button></CollapsibleTrigger>
        <CollapsibleContent>
        <pre className="mt-2 mb-0.5 py-1 font-mono text-[10.5px] leading-4 whitespace-pre-wrap break-words text-muted-foreground">{item.text}</pre>
        </CollapsibleContent>
      </Collapsible>
    </div> : <>
      {quote ? <QuoteChips quotes={quote.quotes} /> : null}
      <p className="whitespace-pre-wrap break-words">{quote?.body ?? item.text}</p>
    </>}
    {item.attachments ? <SentAttachments attachments={item.attachments.filter((attachment) => attachment.kind !== 'image')} /> : null}
  </div></Tooltip>;
});
