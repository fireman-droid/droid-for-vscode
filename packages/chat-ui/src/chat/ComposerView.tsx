import { useI18n } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEventHandler, type DragEventHandler, type KeyboardEventHandler, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { Popover, PopoverAnchor } from '../ui/overlays';
import { useUiEnvironment } from '../environment';
import { measureComposerInput } from './measureComposerInput';
import { QuoteChips } from './QuoteChips';
import { CodeReferenceInput } from './CodeReferenceInput';
import type { useCodeReferenceDraft } from './useCodeReferenceDraft';
import type { InlineInputHandle } from '../ui/inline-input';

export interface ComposerViewProps {
  readonly value: string;
  readonly codeDraft?: ReturnType<typeof useCodeReferenceDraft>;
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
  readonly onKeyDown?: KeyboardEventHandler<HTMLElement>;
  readonly onPaste?: ClipboardEventHandler<HTMLElement>;
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
  value, codeDraft, onChange, onSend, onStop, running, sendDisabled, sendLabel = 'Send', stopLabel = 'Stop', placeholder,
  maxLength, focusSignal = 0, quote, onQuoteClear, quotes, onQuoteRemove, notice, inputReplacement, attachments,
  suggestions, suggestionsOpen = false, onSuggestionsOpenChange, suggestionsListId, activeSuggestionId,
  onKeyDown, onPaste, onDrop, onDragOver, renderInputRow, onLayout,
}: ComposerViewProps) {
  const { t } = useI18n();
  const { assistantName } = useUiEnvironment();
  const quotedContext = quotes ?? (quote ? [quote] : []);
  const removeQuote = onQuoteRemove ?? (quotes === undefined ? onQuoteClear : undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const richInput = useRef<InlineInputHandle>(null);
  const widths = useRef({ row: 0, input: 0 });
  const rich = codeDraft !== undefined;
  const focusInput = () => (richInput.current ?? input.current)?.focus({ preventScroll: true });
  const surface = useRef<HTMLFormElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const change = (next: string, cursor: number) => { setLimitExceeded(false); onChange(next, cursor); };
  useLayoutEffect(() => {
    if (value.length === 0) { setExpanded(false); setLimitExceeded(false); }
  }, [value, focusSignal]);
  useEffect(() => {
    if (focusSignal > 0) focusInput();
  }, [focusSignal]);
  const resize = useCallback(() => {
    const element = richInput.current?.element ?? input.current;
    if (element === null) return;
    const row = element.parentElement!;
    const { multiline, height, scrollable } = measureComposerInput(row, element, expanded, value);
    const previousHeight = element.getBoundingClientRect().height;
    const previousMultiline = row.dataset.multiline === 'true';
    if (row.dataset.multiline !== String(multiline)) row.dataset.multiline = String(multiline);
    if (element.style.height !== `${height}px`) element.style.height = `${height}px`;
    element.style.overflowY = scrollable ? 'auto' : 'hidden';
    widths.current = { row: row.getBoundingClientRect().width, input: element.getBoundingClientRect().width };
    if (previousMultiline !== multiline || Math.abs(previousHeight - height) > 0.5)
      onLayout?.({ width: row.clientWidth, previousHeight, height, previousMultiline, multiline });
  }, [value, expanded, onLayout]);
  useLayoutEffect(() => {
    const element = richInput.current?.element ?? input.current;
    if (element === null) return;
    const row = element.parentElement!;
    if (!rich) resize();
    const observer = new ResizeObserver(() => {
      if (row.getBoundingClientRect().width === widths.current.row && element.getBoundingClientRect().width === widths.current.input) return;
      resize();
    });
    observer.observe(row);
    observer.observe(element);
    return () => observer.disconnect();
  }, [resize, rich, inputReplacement, placeholder, assistantName]);
  const submit = () => { if (!sendDisabled) onSend(); };
  const keyDown: KeyboardEventHandler<HTMLElement> = event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && event.shiftKey && !expanded && value.length === 0) {
      event.preventDefault(); setExpanded(true); return;
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  };
  const editor = inputReplacement != null ? <div className="v2-composer-replacement">{inputReplacement}</div>
    : codeDraft ? <CodeReferenceInput draft={codeDraft} ref={richInput} data-composer-input="" aria-label={t("Message {p0}", { p0: assistantName })}
      aria-autocomplete={suggestionsListId ? 'list' : undefined} aria-controls={suggestionsOpen ? suggestionsListId : undefined}
      aria-activedescendant={suggestionsOpen ? activeSuggestionId : undefined}
      placeholder={placeholder ?? t("Message {p0}", { p0: assistantName })} onChange={change} onKeyDown={keyDown} onPaste={onPaste} onContentLayout={resize}
      onLimitExceeded={() => setLimitExceeded(true)}
      className="min-h-[20px] max-h-42 rounded-none border-0 bg-transparent p-0 text-[13px] leading-[20px]" />
    : <Textarea variant="plain" ref={input} data-composer-input="" aria-label={t("Message {p0}", { p0: assistantName })}
    aria-autocomplete={suggestionsListId ? 'list' : undefined}
    aria-controls={suggestionsOpen ? suggestionsListId : undefined} aria-activedescendant={suggestionsOpen ? activeSuggestionId : undefined}
    placeholder={placeholder ?? t("Message {p0}", { p0: assistantName })} rows={1} maxLength={maxLength} value={value}
    onChange={(event) => change(event.target.value, event.target.selectionStart)}
    onKeyDown={keyDown}
    onPaste={onPaste} className="min-h-[20px] max-h-42 resize-none rounded-none border-0 bg-transparent p-0 text-[13px] leading-[20px] focus-visible:ring-0" />;
  const action = running && onStop ? <Button size="icon-sm" variant="plain" className="v2-composer-send" aria-label={t(stopLabel)} title={t(stopLabel)} onClick={onStop}><Square className="size-3 fill-current" /></Button>
    : <Button size="icon-sm" variant="plain" className="v2-composer-send" type="submit" aria-label={t(sendLabel)} disabled={sendDisabled}><ArrowUp className="size-3.5" /></Button>;
  return <Popover open={suggestionsOpen} onOpenChange={onSuggestionsOpenChange}>
    <PopoverAnchor asChild>
      <form ref={surface} data-composer-surface="" className="v2-chat-composer" onDrop={onDrop} onDragEnter={onDragOver} onDragOver={onDragOver}
        onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {inputReplacement == null ? <>
          <QuoteChips quotes={quotedContext} previewAnchor={surface} onRemove={removeQuote ? (index) => { removeQuote(index); focusInput(); } : undefined} className="px-3 pt-2" />
          {attachments}
        </> : null}
        {renderInputRow ? renderInputRow(editor, action) : <div className="v2-composer-input-row">{editor}{action}</div>}
        {limitExceeded ? <p role="alert" className="px-3 pb-2 text-xs text-destructive">{t("Input limit reached ({p0} characters, including code references). Excess text was not inserted.", { p0: codeDraft?.maxLength ?? maxLength ?? '' })}</p> : null}
        {notice ? <p role="status" className="px-3 text-xs text-muted-foreground">{t(notice)}</p> : null}
      </form>
    </PopoverAnchor>
    {suggestionsOpen ? suggestions : null}
  </Popover>;
}
