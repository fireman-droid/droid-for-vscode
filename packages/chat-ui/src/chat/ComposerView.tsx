import { useEffect, useLayoutEffect, useRef, type ClipboardEventHandler, type DragEventHandler, type KeyboardEventHandler, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Popover, PopoverAnchor } from '../ui/overlays';
import { useUiEnvironment } from '../environment';
import { measureComposerInput } from './measureComposerInput';

export interface ComposerViewProps {
  readonly value: string;
  readonly onChange: (value: string, cursor: number) => void;
  readonly onSend: () => void;
  readonly onStop?: () => void;
  readonly running?: boolean;
  readonly sendDisabled?: boolean;
  readonly sendLabel?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly focusSignal?: number;
  readonly quote?: string;
  readonly onQuoteClear?: () => void;
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
  value, onChange, onSend, onStop, running, sendDisabled, sendLabel = 'Send', placeholder,
  maxLength, focusSignal = 0, quote, onQuoteClear, notice, inputReplacement, attachments,
  suggestions, suggestionsOpen = false, onSuggestionsOpenChange, suggestionsListId, activeSuggestionId,
  onKeyDown, onPaste, onDrop, onDragOver, renderInputRow, onLayout,
}: ComposerViewProps) {
  const { assistantName } = useUiEnvironment();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusSignal > 0) input.current?.focus({ preventScroll: true });
  }, [focusSignal]);
  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    const row = element.parentElement!;
    const resize = () => {
      const { multiline, height } = measureComposerInput(row, element);
      const previousHeight = element.getBoundingClientRect().height;
      const previousMultiline = row.dataset.multiline === 'true';
      if (row.dataset.multiline !== String(multiline)) row.dataset.multiline = String(multiline);
      if (element.style.height !== `${height}px`) element.style.height = `${height}px`;
      if (previousMultiline !== multiline || Math.abs(previousHeight - height) > 0.5)
        onLayout?.({ width: row.clientWidth, previousHeight, height, previousMultiline, multiline });
    };
    resize();
    let width = row.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = row.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [value, inputReplacement, onLayout]);
  const submit = () => { if (!sendDisabled) onSend(); };
  const editor = inputReplacement ?? <Textarea variant="plain" ref={input} data-composer-input="" aria-label={`Message ${assistantName}`}
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
    onPaste={onPaste} className="min-h-[18px] max-h-42 resize-none rounded-none border-0 bg-transparent p-0 text-[13px] leading-[18px] focus-visible:ring-0" />;
  const action = running && onStop ? <Button size="icon-sm" variant="plain" className="v2-composer-send" aria-label="Stop" title="Stop" onClick={onStop}><Square className="size-3 fill-current" /></Button>
    : <Button size="icon-sm" variant="plain" className="v2-composer-send" type="submit" aria-label={sendLabel} disabled={sendDisabled}><ArrowUp className="size-3.5" /></Button>;
  return <Popover open={suggestionsOpen} onOpenChange={onSuggestionsOpenChange}>
    <PopoverAnchor asChild>
      <form data-composer-surface="" className="v2-chat-composer" onDrop={onDrop} onDragOver={onDragOver}
        onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {inputReplacement == null ? <>
          {quote ? <div className="flex min-w-0 items-start gap-2 px-3 pt-2 text-[11px] text-muted-foreground">
            <span className="line-clamp-2 min-w-0 flex-1 break-words">{quote}</span>
            {onQuoteClear ? <Button size="icon-sm" variant="ghost" className="size-4 shrink-0" aria-label="Remove quoted context" onClick={onQuoteClear}>×</Button> : null}
          </div> : null}
          {attachments}
        </> : null}
        {renderInputRow ? renderInputRow(editor, action) : <div className="v2-composer-input-row">{editor}{action}</div>}
        {notice ? <p role="status" className="px-3 text-xs text-muted-foreground">{notice}</p> : null}
      </form>
    </PopoverAnchor>
    {suggestionsOpen ? suggestions : null}
  </Popover>;
}
