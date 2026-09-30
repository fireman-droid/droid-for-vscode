import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { QuoteChips } from '@droidvisx/chat-ui/chat/QuoteChips';
import { UserMessageBubble } from '@droidvisx/chat-ui/chat/UserMessageView';
import { useProcessDisclosure } from '@droidvisx/chat-ui/chat/processPresentation';
import type { ImageTranscriptItem } from '../../shared/protocol/attachments';
import type { UserTranscriptItem } from '../../shared/protocol/transcript';
import { parseDelegatedTask } from '../chat/transcript/delegatedTask';
import { parseSelectionQuotes } from '@droidvisx/chat-ui/chat/selectionQuote';
import { SentAttachments } from '../chat/EditAttachments';
import { ImageContent } from '../content/MediaPreview';
import { Markdown } from '../content/Markdown';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';

export const ReadOnlyQuestion = memo(function ReadOnlyQuestion({ item, images, onInteract }: {
  readonly item: UserTranscriptItem;
  readonly images: readonly ImageTranscriptItem[];
  readonly onInteract?: () => void;
}) {
  const delegated = parseDelegatedTask(item.text);
  const quote = parseSelectionQuotes(item.text);
  const task = useProcessDisclosure(item.id, 'task-instructions');
  const invocation = useProcessDisclosure(item.id, 'task-invocation');
  return <UserMessageBubble timestamp={item.timestamp ?? null} attachments={<>
    {images.length ? <div className="v2-sent-attachments">{images.map((image) => image.data ? <ImageContent key={image.id} src={`data:${image.mediaType};base64,${image.data}`} alt="Message attachment" thumbnail /> : <p key={image.id}>Image preview unavailable</p>)}</div> : null}
    {item.attachments?.some((attachment) => attachment.kind !== 'image') ? <SentAttachments attachments={item.attachments.filter((attachment) => attachment.kind !== 'image')} /> : null}
  </>}>
    {delegated ? <div aria-label="Delegated task" className="min-w-0 select-text space-y-2 whitespace-normal">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="min-w-0 flex-1 break-words text-[13px] font-medium">{delegated.description}</strong><span className="text-[11px] text-muted-foreground">{delegated.type}{delegated.complexity === null ? '' : ` · ${delegated.complexity}`}</span></div>
      <Collapsible open={task.expanded} onOpenChange={() => { onInteract?.(); task.toggle(); }}>
        <CollapsibleTrigger asChild><Button ref={task.buttonRef} variant="plain" size="none" className="v2-viewer-details-trigger flex min-h-6 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight aria-hidden="true" className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${task.expanded ? 'rotate-90' : ''}`} />Task instructions
        </Button></CollapsibleTrigger>
        <CollapsibleContent ref={task.contentRef} className="pt-3">
          <Markdown text={delegated.task} />
          <Collapsible open={invocation.expanded} onOpenChange={() => { onInteract?.(); invocation.toggle(); }} className="v2-viewer-details mt-3 border-t border-border/70 pt-2">
            <CollapsibleTrigger asChild><Button ref={invocation.buttonRef} variant="plain" size="none" className="v2-viewer-details-trigger flex min-h-6 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight aria-hidden="true" className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${invocation.expanded ? 'rotate-90' : ''}`} />Invocation details
            </Button></CollapsibleTrigger>
            <CollapsibleContent ref={invocation.contentRef}><pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[18px] text-muted-foreground">{item.text}</pre></CollapsibleContent>
          </Collapsible>
        </CollapsibleContent>
      </Collapsible>
    </div> : <>
      {quote ? <QuoteChips quotes={quote.quotes} /> : null}
      <p className="select-text whitespace-pre-wrap break-words">{quote?.body ?? item.text}</p>
    </>}
  </UserMessageBubble>;
});
