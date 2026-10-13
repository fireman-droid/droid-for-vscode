import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { DiffQuestionContext, DiffQuestionContentContext, type DiffQuestionAnchor } from '@droidvisx/chat-ui/review/diffQuestion';
import { InlineQuestion } from '@droidvisx/chat-ui/review/InlineQuestion';
import { Button } from '../ui/button';
import { EMPTY_SESSION_BTW_STATE, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import { MAX_REVIEW_QUESTION_CONTEXT, MAX_REVIEW_QUESTION_SELECTION, MAX_REVIEW_QUESTION_TEXT, parseReviewQuestionResponse, type ReviewQuestionResponse } from '../../shared/protocol/reviewQuestionProtocol';
import type { ReviewPort } from './useReviewWorkbench';
import { useUiEnvironment } from '@droidvisx/chat-ui/environment';
import { formatCodeReferences } from '@droidvisx/chat-ui/chat/codeReferences';

type Models = Extract<ReviewQuestionResponse, { type: 'reviewQuestion.models' }>;
export function ReviewQuestions({ port, sessionId, scopeKey, enabled, children }: {
  port: ReviewPort; sessionId: string | null; scopeKey: string; enabled: boolean; children: ReactNode;
}) {
  const { t } = useI18n();
  const { codeReferencePath } = useUiEnvironment();
  const [anchor, setAnchor] = useState<DiffQuestionAnchor | null>(null);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const activeId = useRef<string | null>(null);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<SessionBtwState>(EMPTY_SESSION_BTW_STATE);
  const [pending, setPending] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  const [models, setModels] = useState<Models | null>(null);
  const close = useCallback(() => {
    if (activeId.current && sessionId) port.postMessage({ type: 'reviewQuestion.close', sessionId, questionId: activeId.current });
    activeId.current = null; setQuestionId(null); setAnchor(null); setDraft(''); setPending(false); setFocusRequested(false); setState(EMPTY_SESSION_BTW_STATE);
  }, [port, sessionId]);
  const refresh = useCallback(() => {
    if (sessionId) port.postMessage({ type: 'reviewQuestion.models', sessionId });
  }, [port, sessionId]);
  useEffect(() => { if (!enabled) close(); }, [enabled, close]);
  useEffect(() => { close(); }, [scopeKey, close]);
  useEffect(() => {
    setModels(null);
    const receive = (event: MessageEvent) => {
      const message = parseReviewQuestionResponse(event.data);
      if (!message || message.sessionId !== sessionId) return;
      if (message.type === 'reviewQuestion.models') {
        setModels(message);
      } else if (message.questionId === activeId.current) { setState(message.state); setPending(false); }
    };
    window.addEventListener('message', receive); refresh();
    return () => {
      window.removeEventListener('message', receive);
      if (activeId.current && sessionId) port.postMessage({ type: 'reviewQuestion.close', sessionId, questionId: activeId.current });
    };
  }, [port, sessionId, refresh]);
  const select = useCallback((next: DiffQuestionAnchor) => {
    // A question stays attached to its original excerpt until explicitly closed.
    if (!activeId.current) setAnchor(next);
  }, []);
  const clearSelection = useCallback((key?: string) => {
    if (!activeId.current) setAnchor(previous => !key || previous?.key === key ? null : previous);
  }, []);
  useEffect(() => {
    const dismiss = () => clearSelection();
    const outside = (event: Event) => {
      if (event.target instanceof Element && !event.target.closest('[data-diff-question-control]')) dismiss();
    };
    window.addEventListener('blur', dismiss);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { window.removeEventListener('blur', dismiss); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [clearSelection]);
  const busy = pending || state.status === 'forking' || state.entries.some(entry => entry.state === 'streaming');
  const selectionError = anchor && anchor.selection.text.length > MAX_REVIEW_QUESTION_SELECTION ? 'Select a smaller excerpt (up to 8,000 characters).' : null;
  const modelError = models?.status === 'error' ? models.error ?? 'Models could not be loaded.'
    : models?.status === 'ready' && !models.items.some(item => item.id === models.selectedId)
      ? 'Choose an available question model in Settings > General > Code review questions.' : null;
  const available = models?.status === 'ready' && !modelError;
  const stateMessage = state.message === state.entries.at(-1)?.message ? null : state.message;
  const open = () => {
    if (!anchor || !sessionId) return;
    const id = crypto.randomUUID(); activeId.current = id; setQuestionId(id);
    const { path, side, startLine, endLine, text } = anchor.selection;
    setDraft(startLine !== null && endLine !== null ? formatCodeReferences([
      { path: codeReferencePath?.(path) ?? path, side, startLine, endLine, text },
    ], '') : text);
    setFocusRequested(true);
    window.getSelection()?.removeAllRanges();
  };
  const send = () => {
    if (!questionId || !anchor || !sessionId || !available || busy || selectionError || !enabled || !draft.trim()) return;
    setPending(true);
    port.postMessage({ type: 'reviewQuestion.ask', sessionId, questionId, text: draft.trim(),
      selection: { ...anchor.selection, context: anchor.selection.context.slice(0, MAX_REVIEW_QUESTION_CONTEXT) } });
    setDraft('');
  };
  const content = questionId ? <InlineQuestion entries={state.entries} draft={draft} onDraft={setDraft} busy={busy}
    disabled={!available || !!selectionError || !enabled} message={selectionError ?? stateMessage ?? modelError} maxLength={MAX_REVIEW_QUESTION_TEXT}
    focusRequested={focusRequested} onFocused={() => setFocusRequested(false)}
    onSend={send} onStop={() => port.postMessage({ type: 'reviewQuestion.stop', sessionId, questionId })} onClose={close}
    actions={<>
      {!models || models.status === 'loading' ? <span className="review-question-progress" role="status" aria-label={t("Loading models")}><LoaderCircle /></span> : null}
      {modelError ? <Button variant="plain" size="icon-sm" aria-label={t("Refresh models")} onClick={refresh}><RotateCw /></Button> : null}
    </>} /> : <Button variant="plain" size="none" className="review-question-start" aria-label={t("Ask about selected code")}
      onPointerDown={event => event.preventDefault()} onClick={open}>{t("Ask")}</Button>;
  const expanded = busy || state.entries.length > 0;
  const context = useMemo(() => ({ enabled, active: questionId !== null, expanded, anchor, select, close, clearSelection }), [enabled, questionId, expanded, anchor, select, close, clearSelection]);
  return <DiffQuestionContext.Provider value={context}><DiffQuestionContentContext.Provider value={content}>{children}</DiffQuestionContentContext.Provider></DiffQuestionContext.Provider>;
}
