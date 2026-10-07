import { memo } from 'react';
import { QuoteChips } from '@droidvisx/chat-ui/chat/QuoteChips';
import { UserMessageBubble } from '@droidvisx/chat-ui/chat/UserMessageView';
import type { ImageTranscriptItem } from '../../shared/protocol/attachments';
import type { UserTranscriptItem } from '../../shared/protocol/transcript';
import { parseDelegatedTask } from '../chat/transcript/delegatedTask';
import { parseSelectionQuotes } from '@droidvisx/chat-ui/chat/selectionQuote';
import { SentAttachments } from '../chat/EditAttachments';
import { ImageContent } from '../content/MediaPreview';
import { Markdown } from '../content/Markdown';

export const ReadOnlyQuestion = memo(function ReadOnlyQuestion({ item, images }: {
  readonly item: UserTranscriptItem;
  readonly images: readonly ImageTranscriptItem[];
  readonly onInteract?: () => void;
}) {
  const delegated = parseDelegatedTask(item.text);
  const quote = parseSelectionQuotes(item.text);
  return <UserMessageBubble timestamp={item.timestamp ?? null} attachments={<>
    {images.length ? <div className="v2-sent-attachments">{images.map((image) => image.data ? <ImageContent key={image.id} src={`data:${image.mediaType};base64,${image.data}`} alt="Message attachment" thumbnail /> : <p key={image.id}>Image preview unavailable</p>)}</div> : null}
    {item.attachments?.some((attachment) => attachment.kind !== 'image') ? <SentAttachments attachments={item.attachments.filter((attachment) => attachment.kind !== 'image')} /> : null}
  </>}>
    {delegated ? <div aria-label="Task from parent agent" className="min-w-0 select-text whitespace-normal">
      <Markdown text={delegated.task} />
    </div> : <>
      {quote ? <QuoteChips quotes={quote.quotes} /> : null}
      <p className="select-text whitespace-pre-wrap break-words">{quote?.body ?? item.text}</p>
    </>}
  </UserMessageBubble>;
});
