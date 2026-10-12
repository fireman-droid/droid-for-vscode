import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, LoaderCircle, Square, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Message, MessageContent } from '../ai-elements/message';
import { Markdown } from '../content/Markdown';

export interface InlineQuestionEntry {
  id: string;
  question: string;
  answer: string;
  state: 'streaming' | 'done' | 'error';
  message: string | null;
}
export function InlineQuestion({ entries, draft, onDraft, busy, disabled, message, model, onSend, onStop, onClose, maxLength, focusRequested, onFocused }: {
  entries: readonly InlineQuestionEntry[];
  draft: string;
  onDraft(value: string): void;
  busy: boolean;
  disabled: boolean;
  message: string | null;
  model: ReactNode;
  onSend(): void;
  onStop(): void;
  onClose(): void;
  maxLength: number;
  focusRequested: boolean;
  onFocused(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (focusRequested && input.current) { input.current.focus(); onFocused(); }
  }, [focusRequested, onFocused]);
  useEffect(() => {
    const node = history.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [entries]);
  useEffect(() => {
    const node = input.current;
    if (node) { node.style.height = '0px'; node.style.height = `${Math.min(120, Math.max(27, node.scrollHeight))}px`; }
  }, [draft]);
  const send = () => { if (!disabled && !busy && draft.trim()) onSend(); };
  return <section className="review-inline-question" aria-label="Ask about selected code">
    {entries.length > 0 ? <div ref={history} className="review-question-history" onScroll={event => {
      const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    }}>{entries.map(entry => <div key={entry.id} className="review-question-exchange">
      <Message from="user"><MessageContent className="review-question-prompt">{entry.question}</MessageContent></Message>
      {entry.answer ? <Message from="assistant"><MessageContent><Markdown text={entry.answer} streaming={entry.state === 'streaming'} /></MessageContent></Message> : null}
      {entry.message ? <p className="review-question-error" role="alert">{entry.message}</p> : null}
    </div>)}</div> : null}
    <div className="review-question-composer">
      <Textarea ref={input} variant="plain" className="review-question-input" aria-label="Question about selected code"
        placeholder={entries.length ? 'Add a follow-up…' : 'Ask a quick question…'} value={draft} maxLength={maxLength}
        onChange={event => onDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
        }} />
      <Button variant="plain" size="icon-sm" className="review-question-close" aria-label="Close question" onClick={onClose}><X /></Button>
      {message ? <p className="review-question-error" role="alert">{message}</p> : null}
      <div className="review-question-actions">
        {busy ? <span className="review-question-progress" role="status" aria-label="Answering"><LoaderCircle /></span> : null}
        {model}
        <Button variant="plain" size="icon-sm" className="review-question-send" disabled={!busy && (disabled || !draft.trim())}
          aria-label={busy ? 'Stop answer' : 'Send question'} onClick={busy ? onStop : send}>{busy ? <Square /> : <ArrowUp />}</Button>
      </div>
    </div>
  </section>;
}
