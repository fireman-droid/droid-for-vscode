import { useI18n } from '../i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronRight, X } from 'lucide-react';
import { AnswerStopButton } from '../chat/AnswerStopButton';
import { Button } from '../ui/button';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import type { InlineInputHandle } from '../ui/inline-input';
import { useUiEnvironment } from '../environment';
import { parseCodeReferences } from '../chat/codeReferences';
import { ReferencedText } from '../chat/CodeReferenceChips';
import { CodeReferenceInput } from '../chat/CodeReferenceInput';
import { useCodeReferenceDraft } from '../chat/useCodeReferenceDraft';
import { PROGRESS_LABELS, SideReply } from '../chat/SideReply';
import type { SideConversation } from '../chat/sideChat';

export type InlineQuestionEntry = SideConversation['entries'][number];

function formatCollapsedSummary(raw: string): string {
  const { references, inline, tokens } = parseCodeReferences(raw);
  return inline
    .split(/([\ue000-\uf8ff])/)
    .map((part) => {
      const idx = tokens.indexOf(part);
      if (idx < 0) return part;
      const ref = references[idx]!;
      const name = ref.path.split(/[\\/]/).at(-1) ?? ref.path;
      const range = ref.startLine === ref.endLine ? `${ref.startLine}` : `${ref.startLine}–${ref.endLine}`;
      return `${name} (${range})`;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function InlineQuestion({ entries, draft, onDraft, busy, stopping, disabled, message, actions, onSend, onStop, onClose, maxLength, focusRequested, onFocused }: {
  entries: readonly InlineQuestionEntry[];
  draft: string;
  onDraft(value: string): void;
  busy: boolean;
  stopping?: boolean;
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
  const { assistantName } = useUiEnvironment();
  const bodyId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const initialDraft = useRef(draft);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const input = useRef<InlineInputHandle>(null);
  const references = useCodeReferenceDraft(draft, onDraft, maxLength);
  const activeEntry = entries.find((entry) => entry.state === 'streaming');
  const activeProgress = activeEntry ? (activeEntry.progress ?? (activeEntry.answer ? 'answering' : 'waiting')) : undefined;
  const runningLabel = stopping && busy
    ? t('Stopping…')
    : activeProgress
      ? t(PROGRESS_LABELS[activeProgress])
      : busy
        ? t('Thinking…')
        : null;
  useEffect(() => {
    if (focusRequested && input.current) {
      setCollapsed(false);
      input.current.focus({ preventScroll: true });
      input.current.setSelectionRange(input.current.value.length, input.current.value.length);
      onFocused();
    }
  }, [focusRequested, onFocused]);
  const send = () => {
    if (!disabled && !busy && draft.trim()) {
      setCollapsed(false);
      onSend();
    }
  };
  const latestEntry = entries.at(-1);
  const collapsedSummary = formatCollapsedSummary(latestEntry ? latestEntry.question : draft) || t('Code question');
  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)} asChild>
      <section
        className="review-inline-question v2-chat-surface"
        data-empty={entries.length === 0 || undefined}
        data-collapsed={collapsed || undefined}
        aria-label={t("Ask about selected code")}
      >
        <header className="review-question-bar" data-ui-notice="">
          <CollapsibleTrigger asChild>
            <Button
              ref={triggerRef}
              variant="plain"
              size="none"
              className="review-question-toggle"
              aria-controls={bodyId}
              aria-label={collapsed ? t("Expand code question") : t("Collapse code question")}
            >
              <ChevronRight aria-hidden="true" className="review-question-chevron" />
              <span className="review-question-summary">
                {collapsed ? collapsedSummary : t("Code question")}
              </span>
              {collapsed && runningLabel ? (
                <span className="review-question-state-pill" role="status" aria-live="polite">
                  {runningLabel}
                </span>
              ) : entries.length > 0 ? (
                <span className="review-question-count">
                  {entries.length} {entries.length === 1 ? t("reply") : t("replies")}
                </span>
              ) : null}
            </Button>
          </CollapsibleTrigger>
          {actions ? <div className="review-question-status-actions">{actions}</div> : null}
          {collapsed && busy ? (
            <AnswerStopButton className="v2-btw-send review-question-send" stopping={stopping} onStop={onStop} />
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="review-question-close"
            aria-label={t("Close question")}
            title={t("Close")}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </header>
        <AnimatedCollapsibleContent id={bodyId} open={!collapsed}>
          <div className="review-question-body">
            {entries.length > 0 || busy ? (
              <div className="review-question-thread">
                {entries.map((entry) => {
                  const showEntryThinking =
                    entry.state === 'streaming' &&
                    !entry.answer.trim() &&
                    !(entry.parts && entry.parts.length > 0);
                  return (
                    <article key={entry.id} className="review-question-exchange">
                      <div className="review-question-prompt-row">
                        <div role="region" aria-label={t("Your question")} tabIndex={0} className="v2-btw-question-content review-question-prompt">
                          <div className="select-text"><ReferencedText text={entry.question} /></div>
                        </div>
                      </div>
                      <div aria-label={t("{p0} answer", { p0: assistantName })} className="v2-btw-answer review-question-answer">
                        {showEntryThinking ? (
                          <div role="status" aria-live="polite" data-ui-notice="" className="review-question-thinking">
                            <span className="review-question-thinking-dots" aria-hidden="true"><span /><span /><span /></span>
                            <span>{runningLabel ?? t('Thinking…')}</span>
                          </div>
                        ) : null}
                        <SideReply entry={entry} />
                      </div>
                      {entry.message ? <p data-ui-notice="" className="v2-btw-error review-question-error" role="alert">{entry.message}</p> : null}
                    </article>
                  );
                })}
                {busy && !activeEntry ? (
                  <div role="status" aria-live="polite" data-ui-notice="" className="review-question-thinking">
                    <span className="review-question-thinking-dots" aria-hidden="true"><span /><span /><span /></span>
                    <span>{runningLabel ?? t('Thinking…')}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {message ? (
              <p data-ui-notice="" className="v2-btw-error review-question-error review-question-banner" role="alert">{message}</p>
            ) : null}
            <div data-composer-surface="" className="review-question-compose-row">
              <div className="review-question-editor">
                <CodeReferenceInput
                  ref={input}
                  draft={references}
                  className="dvx-btw-input v2-btw-input review-question-input"
                  aria-label={t("Question about selected code")}
                  placeholder={entries.length || busy ? t("Add a follow-up…") : t("Ask a quick question…")}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      const hasDraftEdit = Boolean(draft.trim()) && draft !== initialDraft.current;
                      if (entries.length > 0 || busy || hasDraftEdit) {
                        setCollapsed(true);
                        queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
                      } else {
                        onClose();
                      }
                    }
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
              </div>
              <div className="review-question-compose-controls">
                {maxLength - draft.length < 200 ? (
                  <span data-ui-notice="" className="v2-btw-compose-hint">{t("{p0} left", { p0: maxLength - draft.length })}</span>
                ) : null}
                {busy ? (
                  <AnswerStopButton className="v2-btw-send review-question-send" stopping={stopping} onStop={onStop} />
                ) : (
                  <Button
                    variant="plain"
                    size="icon-sm"
                    className="v2-btw-send review-question-send"
                    disabled={disabled || !draft.trim()}
                    aria-label={t("Send question")}
                    title={t("Send · Enter")}
                    onClick={send}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </AnimatedCollapsibleContent>
      </section>
    </Collapsible>
  );
}
