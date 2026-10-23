import { useI18n } from '@droidvisx/chat-ui/i18n';
import { memo, useContext } from 'react';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import { Message, MessageContent } from '../ai-elements/message';
import { AssistantMessage } from '@droidvisx/chat-ui/chat/AssistantMessage';
import { ImageContent } from '../content/MediaPreview';
import { ToolRow } from './ToolRow';
import { ThinkingRow } from './ThinkingRow';
import { SelectSessionContext } from './thread/messageContexts';
import { Button } from '../ui/button';

export const TranscriptRow = memo(function TranscriptRow({ item, streaming, grouped, messageId, readOnly = false, hideConfirmedOperations = false, onInteract }: {
  readonly item: SessionTranscriptItem; readonly streaming: boolean; readonly grouped: boolean; readonly messageId: string; readonly readOnly?: boolean;
  readonly hideConfirmedOperations?: boolean;
  readonly onInteract?: () => void;
}) {
  const { t } = useI18n();
  const selectSession = useContext(SelectSessionContext);
  if (item.kind === 'user') return <Message from="user" className="rounded-md border border-[var(--panel-edge)] bg-muted/40 p-2.5"><MessageContent className="whitespace-pre-wrap">{item.text}</MessageContent></Message>;
  if (item.kind === 'assistant') return <AssistantMessage text={item.text} streaming={streaming} />;
  if (item.kind === 'thinking') return <ThinkingRow item={item} messageId={messageId} grouped={grouped} streaming={streaming} />;
  if (item.kind === 'tool') return <ToolRow item={item} messageId={messageId} grouped={grouped} hideConfirmedOperations={hideConfirmedOperations} onInteract={onInteract} />;
  if (item.kind === 'diagnostic') {
    if (item.code === 'history-note') return <section role="note" className="my-2 rounded-md border border-border p-3 text-xs">
      <p className="mb-2 text-muted-foreground">{t("Saved note · Not sent to the model")}</p>
      <p data-ui-copy-content="" className="whitespace-pre-wrap">{item.message}</p>
    </section>;
    if (item.code === 'session-compacted') {
      const count = /(\d+) earlier message/.exec(item.message)?.[1];
      return <div role="status" title={item.message} className="v2-history-divider my-4 select-none">
        <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">{count ? t('Summarized {count} earlier messages', { count }) : t("Conversation summarized")}
          {item.relatedSessionId && selectSession && !readOnly ? <><span aria-hidden="true">·</span><Button variant="plain" size="none" className="v2-history-trigger" onClick={() => selectSession(item.relatedSessionId!)}>{t("View full history")}</Button></> : null}
        </span>
      </div>;
    }
    return <p role={item.severity === 'error' ? 'alert' : 'status'} title={`${item.code}: ${item.message}`} className={`text-xs ${item.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{item.message}</p>;
  }
  if (item.kind === 'image') return item.data.length === 0 ? <p role="note" className="text-xs text-muted-foreground">{t("Image preview unavailable")}</p> : <ImageContent src={`data:${item.mediaType};base64,${item.data}`} alt={item.generated ? t("Generated image") : t("Message attachment")} generated={item.generated} />;
  if (item.kind === 'changes') return null;
  return item.status === 'cancelled' ? <p data-ui-notice="" className="my-2 rounded-lg border border-[var(--panel-edge)] p-3 text-xs text-muted-foreground">{t("Questions cancelled")}</p> : <dl className="my-2 max-w-[560px] divide-y divide-[var(--panel-edge)] rounded-lg border border-[var(--panel-edge)] text-[13px] leading-[21px]">
    {item.answers.map((answer, index) => <div key={index} className="grid gap-3 p-3"><dt><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Droid</span>{answer.question ?? answer.topic}</dt><dd className="whitespace-pre-wrap"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{t("You")}</span>{answer.answer}</dd></div>)}
  </dl>;
});
