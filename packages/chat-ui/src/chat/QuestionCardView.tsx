import { useLayoutEffect, useRef, type ClipboardEventHandler, type DragEventHandler, type ReactNode, type RefObject } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '../ui/cn';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { DroidActivity } from '../ui/droid-motion';
import { UserMessageBubble } from './UserMessageView';
import { QuoteChips } from './QuoteChips';
import { formatSelectionQuotes, parseSelectionQuotes } from './selectionQuote';
export interface QuestionEditor {
  readonly draft: { readonly messageId: string; readonly text: string; readonly phase: 'editing' | 'resending'; readonly notice: string | null; readonly restoreFiles?: boolean; readonly resumeOnly?: boolean } | null;
  readonly selection: RefObject<{ messageId: string; start: number; end: number; direction: 'forward' | 'backward' | 'none'; scrollTop: number; focused: boolean } | null>;
  readonly begin: (id: string, text: string) => void;
  readonly cancel: () => void;
  readonly update: (id: string, patch: { text: string }) => void;
}
export interface QuestionCardViewProps {
  readonly item: { readonly id: string; readonly text: string; readonly messageId?: string; readonly timestamp?: number };
  readonly editor: QuestionEditor;
  readonly quote?: { readonly quote?: string; readonly quotes?: readonly string[]; readonly body: string } | null;
  readonly placeholder?: boolean;
  readonly placeholderHeight?: number;
  readonly canResend: boolean;
  readonly editAvailable?: boolean;
  readonly originalAttachments?: ReactNode;
  readonly stagedAttachments?: ReactNode;
  readonly editSettings?: ReactNode;
  readonly restoreFiles?: ReactNode;
  readonly plan?: ReactNode;
  readonly onResend: () => void;
  readonly onAttach?: () => void;
  readonly editDisabled?: boolean;
  readonly rejection?: string | null;
  readonly maxLength?: number;
  readonly onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  readonly onDrop?: DragEventHandler;
  readonly onDragOver?: DragEventHandler;
}
export function QuestionCardView({ item, editor, quote, placeholder, placeholderHeight, canResend, editAvailable = true, originalAttachments, stagedAttachments, editSettings, restoreFiles, plan, onResend, onAttach, editDisabled, rejection, maxLength, onPaste, onDrop, onDragOver }: QuestionCardViewProps) {
  const draft = editor.draft?.messageId === item.messageId ? editor.draft : null;
  const draftQuote = draft ? parseSelectionQuotes(draft.text) : null;
  const draftBody = draftQuote?.body ?? draft?.text ?? '';
  const draftPrefixLength = formatSelectionQuotes(draftQuote?.quotes ?? [], '').length;

  const editing = draft?.phase === 'editing' && !placeholder;
  const editable = editAvailable && item.messageId !== undefined && editor.draft?.phase !== 'resending';
  const input = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const messageId = item.messageId;
  const remember = (element: HTMLTextAreaElement, focused = document.activeElement === element) => {
    if (messageId === undefined) return;
    editor.selection.current = {
      messageId, start: element.selectionStart, end: element.selectionEnd,
      direction: element.selectionDirection, scrollTop: element.scrollTop, focused,
    };
  };
  useLayoutEffect(() => {
    const element = input.current;
    if (!editing || element === null) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(168, Math.max(27, element.scrollHeight))}px`;
  }, [editing, draft?.text]);
  useLayoutEffect(() => {
    const element = input.current;
    const selection = editor.selection.current;
    if (!editing || element === null || selection === null || selection.messageId !== messageId) return;
    if (selection.focused) element.focus({ preventScroll: true });
    element.setSelectionRange(selection.start, selection.end, selection.direction);
    element.scrollTop = selection.scrollTop;
    editor.selection.current = selection;
  }, [editing, editor.selection, messageId]);
  useLayoutEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || card.current?.contains(event.target)) return;
      if (event.target.closest('[data-webview-overlay]')) return;
      if (Array.from(document.querySelectorAll<HTMLElement>('[data-editor-popup-owner][data-state="open"]'))
        .some((element) => element.dataset.editorPopupOwner === messageId)) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.hasAttribute('data-transcript-scrollbar') &&
        event.clientX >= event.target.getBoundingClientRect().left + event.target.clientWidth
      ) return;
      editor.cancel();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [editing, editor.cancel, messageId]);
  const submit = () => { if (canResend && draft?.text.trim()) onResend(); };
  const shownQuote = draft?.phase === 'resending' ? draftQuote : quote;
  const shownQuotes = shownQuote?.quotes ?? (draft?.phase !== 'resending' && quote?.quote ? [quote.quote] : []);
  const messageCopy = <span className="block max-h-[4lh] overflow-hidden">{draft?.phase === 'resending' ? draftBody : quote?.body ?? item.text}</span>;
  return (
    <div
      ref={card}
      data-question-id={item.id}
      data-question-card=""
      inert={placeholder || undefined}
      aria-hidden={placeholder || undefined}
      aria-busy={draft?.phase === 'resending' || undefined}
      style={placeholder && draft?.phase === 'editing' && placeholderHeight ? { height: placeholderHeight } : undefined}
      className={cn('min-w-0', Boolean(plan) && draft?.phase !== 'resending' && 'dvx-question-plan-card', placeholder && 'invisible pointer-events-none')}
      onDragOver={editing ? onDragOver : undefined}
      onDrop={editing ? onDrop : undefined}
    >
      {editing && draft !== null ? (
        <div data-composer-surface="" className="v2-user-edit-card">
          {stagedAttachments}
          <QuoteChips quotes={draftQuote?.quotes ?? []} onRemove={(index) => {
            editor.update(draft.messageId, { text: formatSelectionQuotes(draftQuote?.quotes.filter((_, position) => position !== index) ?? [], draftBody) });
            input.current?.focus({ preventScroll: true });
          }} className="mb-1" />
          <Textarea variant="plain"
            ref={input}
            aria-label="Edit message and resend"
            rows={1}
            value={draftBody}
            maxLength={maxLength === undefined ? undefined : Math.max(0, maxLength - draftPrefixLength)}
            className="v2-user-edit-input"
            onChange={(event) => {
              editor.update(draft.messageId, { text: formatSelectionQuotes(draftQuote?.quotes ?? [], event.currentTarget.value) });
              remember(event.currentTarget);
            }}
            onSelect={(event) => remember(event.currentTarget)}
            onScroll={(event) => remember(event.currentTarget)}
            onFocus={(event) => remember(event.currentTarget, true)}
            onBlur={(event) => { if (event.relatedTarget !== null) remember(event.currentTarget, false); }}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if (event.key === 'Escape') editor.cancel();
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault(); submit();
              }
            }}
          />
          {draft.notice ? <p role="status" className="mt-1 text-xs text-muted-foreground">{draft.notice}</p> : null}
          {rejection ? <p role="status" className="mt-1 text-xs text-destructive">{rejection}</p> : null}
          <div className="v2-user-edit-footer">
            {onAttach ? <Button variant="plain" size="none" className="v2-user-edit-attach" aria-label="Attach files to edited message" title="Attach files"
              disabled={editDisabled} onClick={onAttach}>+</Button> : null}
            {editSettings}
            <Button variant="plain" size="none" className="v2-user-edit-send" aria-label="Resend edited message" disabled={!canResend || !draft.text.trim()} onClick={submit}><ArrowUp /></Button>
          </div>
        </div>
      ) : (
        <UserMessageBubble pending={draft?.phase === 'resending'} placeholder={placeholder} timestamp={item.timestamp ?? null}
          attachments={draft?.phase !== 'resending' ? originalAttachments : null}
          context={<QuoteChips quotes={shownQuotes} className="mb-1" />}
          onEdit={editable ? () => { if (messageId !== undefined) editor.begin(messageId, item.text); } : undefined}>
          {messageCopy}
        </UserMessageBubble>
      )}
      {draft !== null && !placeholder ? restoreFiles : null}
      {draft?.phase === 'resending' ? <p role="status" className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><DroidActivity phase="loading" />{draft.resumeOnly ? 'Reconnecting the restored conversation…' : draft.restoreFiles ? 'Restoring files and preparing the conversation…' : 'Preparing the conversation to resend…'}</p> : null}
      {draft?.phase !== 'resending' ? plan : null}
    </div>
  );
}
