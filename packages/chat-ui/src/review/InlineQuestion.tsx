import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { ArrowUp, LoaderCircle, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Message, MessageContent } from '../ai-elements/message';
import { Markdown } from '../content/Markdown';

function QuestionInput({ inputRef, ...props }: ComponentProps<typeof Textarea> & {
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node) { node.style.height = '0px'; node.style.height = `${Math.min(120, Math.max(27, node.scrollHeight))}px`; }
  }, [inputRef, props.value]);
  return <Textarea {...props} ref={inputRef} />;
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
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const historyContent = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const followedOffset = useRef<number | null>(null);
  const followBottom = () => {
    const node = history.current;
    if (node && follow.current) { node.scrollTop = node.scrollHeight; followedOffset.current = node.scrollTop; }
  };
  useEffect(() => {
    if (focusRequested && input.current) { input.current.focus({ preventScroll: true }); onFocused(); }
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
  return <section className="review-inline-question" aria-label="Ask about selected code">
    <div ref={history} className="review-question-history" onScroll={event => {
      const node = event.currentTarget;
      if (followedOffset.current !== null && Math.abs(node.scrollTop - followedOffset.current) < 1) return;
      followedOffset.current = null;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    }}><div ref={historyContent}>{entries.map(entry => <div key={entry.id} className="review-question-exchange">
      <Message from="user"><MessageContent className="review-question-prompt text-[var(--review-question-ink,var(--link-ink))]">{entry.question}</MessageContent></Message>
      {entry.answer ? <Message from="assistant"><MessageContent><Markdown text={entry.answer} streaming={entry.state === 'streaming'} /></MessageContent></Message> : null}
      {entry.message ? <p className="review-question-error" role="alert">{entry.message}</p> : null}
    </div>)}</div></div>
    <div className="review-question-composer">
      <QuestionInput inputRef={input} variant="plain" className="review-question-input" aria-label="Question about selected code"
        placeholder={entries.length ? 'Add a follow-up…' : 'Ask a quick question…'} value={draft} maxLength={maxLength}
        onChange={event => onDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
        }} />
      {message ? <p className="review-question-error" role="alert">{message}</p> : null}
      <div className="review-question-actions">
        {busy ? <span className="review-question-progress" role="status" aria-label="Answering"><LoaderCircle /></span> : null}
        {actions}
        <Button variant="plain" size="none" className="review-question-send" disabled={!busy && (disabled || !draft.trim())}
          aria-label={busy ? 'Stop answer' : 'Send question'} onClick={busy ? onStop : send}>{busy ? <Square /> : <ArrowUp />}</Button>
      </div>
    </div>
  </section>;
}
