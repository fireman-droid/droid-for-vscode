import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { DiffQuestionContext, DiffQuestionContentContext, type DiffQuestionAnchor } from '@droidvisx/chat-ui/review/diffQuestion';
import { InlineQuestion } from '@droidvisx/chat-ui/review/InlineQuestion';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { EMPTY_SESSION_BTW_STATE, MAX_BTW_TEXT_LENGTH, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import { MAX_REVIEW_QUESTION_CONTEXT, MAX_REVIEW_QUESTION_SELECTION, parseReviewQuestionResponse, type ReviewQuestionResponse } from '../../shared/protocol/reviewQuestionProtocol';
import type { ReviewPort } from './useReviewWorkbench';

type Models = Extract<ReviewQuestionResponse, { type: 'reviewQuestion.models' }>;
export function ReviewQuestions({ port, sessionId, scopeKey, enabled, children }: {
  port: ReviewPort; sessionId: string | null; scopeKey: string; enabled: boolean; children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DiffQuestionAnchor | null>(null);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const activeId = useRef<string | null>(null);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<SessionBtwState>(EMPTY_SESSION_BTW_STATE);
  const [pending, setPending] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  const [models, setModels] = useState<Models | null>(null);
  const [modelId, setModelId] = useState('');
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
    setModels(null); setModelId('');
    const receive = (event: MessageEvent) => {
      const message = parseReviewQuestionResponse(event.data);
      if (!message || message.sessionId !== sessionId) return;
      if (message.type === 'reviewQuestion.models') {
        setModels(message);
        if (message.status === 'ready') setModelId(previous => message.items.some(item => item.id === previous) ? previous
          : message.items.find(item => item.id === message.selectedId)?.id ?? message.items[0]?.id ?? '');
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
  const busy = pending || state.status === 'forking' || state.entries.some(entry => entry.state === 'streaming');
  const selectionError = anchor && anchor.selection.text.length > MAX_REVIEW_QUESTION_SELECTION ? 'Select a smaller excerpt (up to 8,000 characters).' : null;
  const modelError = models?.status === 'error' ? models.error ?? 'Models could not be loaded.'
    : models?.status === 'ready' && !models.items.length ? 'No models are enabled.' : null;
  const available = models?.status === 'ready' && models.items.some(item => item.id === modelId);
  const stateMessage = state.message === state.entries.at(-1)?.message ? null : state.message;
  const open = () => {
    if (!anchor || !sessionId) return;
    const id = crypto.randomUUID(); activeId.current = id; setQuestionId(id);
    setFocusRequested(true);
    window.getSelection()?.removeAllRanges();
  };
  const send = () => {
    if (!questionId || !anchor || !sessionId || !available || busy || selectionError || !enabled || !draft.trim()) return;
    setPending(true);
    port.postMessage({ type: 'reviewQuestion.ask', sessionId, questionId, modelId, text: draft.trim(),
      selection: { ...anchor.selection, context: anchor.selection.context.slice(0, MAX_REVIEW_QUESTION_CONTEXT) } });
    setDraft('');
  };
  const content = questionId ? <InlineQuestion entries={state.entries} draft={draft} onDraft={setDraft} busy={busy}
    disabled={!available || !!selectionError || !enabled} message={selectionError ?? stateMessage ?? modelError} maxLength={MAX_BTW_TEXT_LENGTH}
    focusRequested={focusRequested} onFocused={() => setFocusRequested(false)}
    onSend={send} onStop={() => port.postMessage({ type: 'reviewQuestion.stop', sessionId, questionId })} onClose={close}
    model={<>
      {!models || models.status === 'loading' ? <span className="review-question-progress" role="status" aria-label="Loading models"><LoaderCircle /></span> : null}
      {modelError ? <Button variant="plain" size="icon-sm" aria-label="Refresh models" onClick={refresh}><RotateCw /></Button> : null}
      <Select value={modelId} onValueChange={setModelId} disabled={!available || busy}>
        <SelectTrigger className="review-question-model" aria-label="Question model"><SelectValue placeholder="Select model" /></SelectTrigger>
        <SelectContent className="review-question-model-menu" align="end">{models?.items.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </>} /> : <Button variant="ghost" size="sm" className="review-question-start" onClick={open}>Ask a quick question</Button>;
  const context = useMemo(() => ({ enabled, anchor, select, close }), [enabled, anchor, select, close]);
  return <DiffQuestionContext.Provider value={context}><DiffQuestionContentContext.Provider value={content}>{children}</DiffQuestionContentContext.Provider></DiffQuestionContext.Provider>;
}
