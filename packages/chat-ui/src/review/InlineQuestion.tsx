import { useI18n } from '../i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, LoaderCircle, Square } from 'lucide-react';
import { Button } from '../ui/button';
import type { InlineInputHandle } from '../ui/inline-input';
import { Message, MessageContent } from '../ai-elements/message';
import { Markdown } from '../content/Markdown';
import { useSmoothedAnswer } from './useSmoothedAnswer';
import { ScrollArea } from '../ui/scroll-area';
import { ReferencedText } from '../chat/CodeReferenceChips';
import { CodeReferenceInput } from '../chat/CodeReferenceInput';
import { useCodeReferenceDraft } from '../chat/useCodeReferenceDraft';

function QuestionAnswer({ answer, state }: Pick<InlineQuestionEntry, 'answer' | 'state'>) {
  const displayed = useSmoothedAnswer(answer, state === 'streaming');
  return <Message from="assistant"><MessageContent>
    <Markdown text={displayed} streaming={state === 'streaming' || displayed !== answer} />
  </MessageContent></Message>;
}

export interface InlineQuestionEntry {
  id: string;
  question: string;
  answer: string;
  state: 'streaming' | 'done' | 'error';
  message: string | null;
}
export function InlineQuestion({ entries, draft, onDraft, busy, disabled, message, actions, onSend, onStop, onClose, maxLength, focusRequested, onFocused }: {
  entries: readonly InlineQuestionEntry[];
  draft: string;
  onDraft(value: string): void;
  busy: boolean;
  disabled: boolean;
  message: string | null;
  actions?: ReactNode;
  onSend(): void;
  onStop(): void;
  onClose(): void;
  maxLength: number;
  focusRequested: boolean;
  onFocused(): void;
}) {
  const { t } = useI18n();
  const input = useRef<InlineInputHandle>(null);
  const references = useCodeReferenceDraft(draft, onDraft, maxLength);
  const history = useRef<HTMLDivElement>(null);
  const historyContent = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const followedOffset = useRef<number | null>(null);
  const followBottom = () => {
    const node = history.current;
    if (node && follow.current) { node.scrollTop = node.scrollHeight; followedOffset.current = node.scrollTop; }
  };
  useEffect(() => {
    if (focusRequested && input.current) {
      input.current.focus({ preventScroll: true });
      input.current.setSelectionRange(input.current.value.length, input.current.value.length); onFocused();
    }
  }, [focusRequested, onFocused]);
  useEffect(followBottom, [entries]);
  useEffect(() => {
    const node = history.current;
    const content = historyContent.current;
    if (!node || !content) return;
    const observer = new ResizeObserver(followBottom);
    observer.observe(content); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const send = () => { if (!disabled && !busy && draft.trim()) { follow.current = true; onSend(); } };
  return <section className="review-inline-question" data-empty={entries.length === 0 || undefined} aria-label={t("Ask about selected code")}>
    <ScrollArea className="review-question-history" viewportClassName="review-question-history-viewport" viewportRef={history}
      viewportProps={{ onScroll: event => {
      const node = event.currentTarget;
      if (followedOffset.current !== null && Math.abs(node.scrollTop - followedOffset.current) < 1) return;
      followedOffset.current = null;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    } }}><div ref={historyContent}>{entries.map(entry => <div key={entry.id} className="review-question-exchange">
      <Message from="user"><MessageContent className="review-question-prompt text-[var(--review-question-ink,var(--link-ink))]"><ReferencedText text={entry.question} /></MessageContent></Message>
      {entry.answer ? <QuestionAnswer answer={entry.answer} state={entry.state} /> : null}
      {entry.message ? <p className="review-question-error" role="alert">{entry.message}</p> : null}
    </div>)}</div></ScrollArea>
    <div className="review-question-composer">
      <CodeReferenceInput ref={input} draft={references} className="review-question-input" aria-label={t("Question about selected code")}
        placeholder={entries.length ? t("Add a follow-up…") : t("Ask a quick question…")}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
        }} />
      {message ? <p className="review-question-error" role="alert">{message}</p> : null}
      <div className="review-question-actions">
        {busy ? <span className="review-question-progress" role="status" aria-label={t("Answering")}><LoaderCircle /></span> : null}
        {actions}
        <Button variant="plain" size="none" className="review-question-send" disabled={!busy && (disabled || !draft.trim())}
          data-busy={busy || undefined}
          aria-label={busy ? t("Stop answer") : t("Send question")} onClick={busy ? onStop : send}>{busy ? <Square /> : <ArrowUp />}</Button>
      </div>
    </div>
  </section>;
}
