import { useEffect, useLayoutEffect, useRef, type ClipboardEventHandler, type DragEventHandler, type KeyboardEventHandler, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Popover, PopoverAnchor } from '../ui/overlays';
import { useUiEnvironment } from '../environment';
import { measureComposerInput } from './measureComposerInput';
import { QuoteChips } from './QuoteChips';

export interface ComposerViewProps {
  readonly value: string;
  readonly onChange: (value: string, cursor: number) => void;
  readonly onSend: () => void;
  readonly onStop?: () => void;
  readonly running?: boolean;
  readonly sendDisabled?: boolean;
  readonly sendLabel?: string;
  readonly stopLabel?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly focusSignal?: number;
  readonly quote?: string;
  readonly onQuoteClear?: () => void;
  readonly quotes?: readonly string[];
  readonly onQuoteRemove?: (index: number) => void;
  readonly notice?: string | null;
  readonly inputReplacement?: ReactNode;
  readonly attachments?: ReactNode;
  readonly suggestions?: ReactNode;
  readonly suggestionsOpen?: boolean;
  readonly onSuggestionsOpenChange?: (open: boolean) => void;
  readonly suggestionsListId?: string;
  readonly activeSuggestionId?: string;
  readonly onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  readonly onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  readonly onDrop?: DragEventHandler;
  readonly onDragOver?: DragEventHandler;
  readonly renderInputRow?: (input: ReactNode, action: ReactNode) => ReactNode;
  readonly onLayout?: (sample: ComposerLayout) => void;
}

export interface ComposerLayout {
  readonly width: number;
  readonly previousHeight: number;
  readonly height: number;
  readonly previousMultiline: boolean;
  readonly multiline: boolean;
}

export function ComposerView({
  value, onChange, onSend, onStop, running, sendDisabled, sendLabel = 'Send', stopLabel = 'Stop', placeholder,
  maxLength, focusSignal = 0, quote, onQuoteClear, quotes, onQuoteRemove, notice, inputReplacement, attachments,
  suggestions, suggestionsOpen = false, onSuggestionsOpenChange, suggestionsListId, activeSuggestionId,
  onKeyDown, onPaste, onDrop, onDragOver, renderInputRow, onLayout,
}: ComposerViewProps) {
  const { assistantName } = useUiEnvironment();
  const quotedContext = quotes ?? (quote ? [quote] : []);
  const removeQuote = onQuoteRemove ?? (quotes === undefined ? onQuoteClear : undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusSignal > 0) input.current?.focus({ preventScroll: true });
  }, [focusSignal]);
  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    const row = element.parentElement!;
    let rowWidth = 0;
    let inputWidth = 0;
    const resize = () => {
      const { multiline, height, scrollable } = measureComposerInput(row, element);
      const previousHeight = element.getBoundingClientRect().height;
      const previousMultiline = row.dataset.multiline === 'true';
      if (row.dataset.multiline !== String(multiline)) row.dataset.multiline = String(multiline);
      if (element.style.height !== `${height}px`) element.style.height = `${height}px`;
      element.style.overflowY = scrollable ? 'auto' : 'hidden';
      rowWidth = row.getBoundingClientRect().width;
      inputWidth = element.getBoundingClientRect().width;
      if (previousMultiline !== multiline || Math.abs(previousHeight - height) > 0.5)
        onLayout?.({ width: row.clientWidth, previousHeight, height, previousMultiline, multiline });
    };
    resize();
    const observer = new ResizeObserver(() => {
      if (row.getBoundingClientRect().width === rowWidth && element.getBoundingClientRect().width === inputWidth) return;
      resize();
    });
    observer.observe(row);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, inputReplacement, placeholder, assistantName, onLayout]);
  const submit = () => { if (!sendDisabled) onSend(); };
  const editor = inputReplacement != null ? <div className="v2-composer-replacement">{inputReplacement}</div>
    : <Textarea variant="plain" ref={input} data-composer-input="" aria-label={`Message ${assistantName}`}
    aria-autocomplete={suggestionsListId ? 'list' : undefined}
    aria-controls={suggestionsOpen ? suggestionsListId : undefined} aria-activedescendant={suggestionsOpen ? activeSuggestionId : undefined}
    placeholder={placeholder ?? `Message ${assistantName}`} rows={1} maxLength={maxLength} value={value}
    onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    }}
    onPaste={onPaste} className="min-h-[20px] max-h-42 resize-none rounded-none border-0 bg-transparent p-0 text-[14px] leading-[20px] focus-visible:ring-0" />;
  const action = running && onStop ? <Button size="icon-sm" variant="plain" className="v2-composer-send" aria-label={stopLabel} title={stopLabel} onClick={onStop}><Square className="size-3 fill-current" /></Button>
    : <Button size="icon-sm" variant="plain" className="v2-composer-send" type="submit" aria-label={sendLabel} disabled={sendDisabled}><ArrowUp className="size-3.5" /></Button>;
  return <Popover open={suggestionsOpen} onOpenChange={onSuggestionsOpenChange}>
    <PopoverAnchor asChild>
      <form data-composer-surface="" className="v2-chat-composer" onDrop={onDrop} onDragOver={onDragOver}
        onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {inputReplacement == null ? <>
          <QuoteChips quotes={quotedContext} onRemove={removeQuote ? (index) => { removeQuote(index); input.current?.focus({ preventScroll: true }); } : undefined} className="px-3 pt-2" />
          {attachments}
        </> : null}
        {renderInputRow ? renderInputRow(editor, action) : <div className="v2-composer-input-row">{editor}{action}</div>}
        {notice ? <p role="status" className="px-3 text-xs text-muted-foreground">{notice}</p> : null}
      </form>
    </PopoverAnchor>
    {suggestionsOpen ? suggestions : null}
  </Popover>;
}
