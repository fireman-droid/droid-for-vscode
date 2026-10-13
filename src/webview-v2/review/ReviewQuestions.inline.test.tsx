// @vitest-environment jsdom
import { useContext } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReviewQuestions } from './ReviewQuestions';
import { DiffQuestionContext, DiffQuestionContentContext } from '@droidvisx/chat-ui/review/diffQuestion';
import { parseCodeReferences } from '@droidvisx/chat-ui/chat/codeReferences';
import { Button } from '@droidvisx/chat-ui/ui/button';
import { DiffReferenceContext } from '../../../packages/chat-ui/src/review/diffReference';
import { DiffView } from '../../../packages/chat-ui/src/review/DiffView';
import { MAX_REVIEW_QUESTION_TEXT, parseReviewQuestionRequest, parseReviewQuestionResponse } from '../../shared/protocol/reviewQuestionProtocol';
import { EMPTY_SESSION_BTW_STATE, parseSessionBtwMessage } from '../../shared/protocol/btwProtocol';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const selection = { path: 'src/file.ts', side: 'before' as const, startLine: 3, endLine: 4, text: 'previous code\nnext line', context: '' };
function Selection() {
  const question = useContext(DiffQuestionContext)!;
  const content = useContext(DiffQuestionContentContext);
  return <><Button data-diff-question-control="" onClick={() => question.select({ key: 'file', source: 'patch', startRow: 0, row: 1,
    range: document.createRange(), selection })}>Select excerpt</Button><div data-diff-question-control="">{content}</div></>;
}
it('includes the first selected excerpt when Ask opens, before any paste or model request', () => {
  const port = { postMessage: vi.fn() };
  render(<ReviewQuestions port={port} sessionId="session-1" scopeKey="scope" enabled><Selection /></ReviewQuestions>);
  act(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'reviewQuestion.models', sessionId: 'session-1',
    status: 'ready', selectedId: 'model-1', items: [{ id: 'model-1', label: 'Model' }], error: null } })));
  fireEvent.click(screen.getByRole('button', { name: 'Select excerpt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ask about selected code' }));
  expect(screen.getByRole('textbox').textContent).toBe('file.ts (3–4)');
  expect(port.postMessage.mock.calls.some(([message]) => message.type === 'reviewQuestion.ask')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
  const request = port.postMessage.mock.calls.find(([message]) => message.type === 'reviewQuestion.ask')![0];
  expect(parseCodeReferences(request.text).references).toEqual([{ path: selection.path, side: selection.side,
    startLine: 3, endLine: 4, text: selection.text }]);
  expect(request.selection).toEqual(selection);
});

it.each([true, false])('reveals the before-side range in the comparison (split=%s)', split => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const reference = { ...selection, request: 1 };
  const view = render(<DiffReferenceContext.Provider value={null}><div className="review-code-scroll">
    <DiffView path={selection.path} split={split} patch={'@@ -3,2 +3,2 @@\n-old\n+new\n same'} />
  </div></DiffReferenceContext.Provider>);
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  view.rerender(<DiffReferenceContext.Provider value={reference}><div className="review-code-scroll">
    <DiffView path={selection.path} split={split} patch={'@@ -3,2 +3,2 @@\n-old\n+new\n same'} />
  </div></DiffReferenceContext.Provider>);
  const highlighted = [...view.container.querySelectorAll('[data-reference-highlight]')].map(node => node.textContent);
  expect(highlighted).toHaveLength(2);
  expect(highlighted.join('')).toContain('old');
  expect(highlighted.join('')).not.toContain('new');
});

it('mounts an offscreen reference range before locating its line', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const patch = '@@ -1,300 +1,300 @@\n' + Array.from({ length: 300 }, (_, index) => ` line ${index + 1}`).join('\n');
  const view = render(<DiffReferenceContext.Provider value={null}><DiffView path={selection.path} patch={patch} /></DiffReferenceContext.Provider>);
  expect(screen.queryByText('line 250')).toBeNull();
  view.rerender(<DiffReferenceContext.Provider value={{ ...selection, startLine: 250, endLine: 251, request: 1 }}>
    <DiffView path={selection.path} patch={patch} />
  </DiffReferenceContext.Provider>);
  expect(view.container.querySelector('[data-reference-highlight]')?.textContent).toContain('line 250');
});

it('allows the initial 8k selection plus a question on Review while retaining BTW bounds', () => {
  const text = 'x'.repeat(8_500);
  const request = { type: 'reviewQuestion.ask', sessionId: 'session-1', questionId: 'question-1', selection, text };
  expect(parseReviewQuestionRequest(request)).not.toBeNull();
  expect(parseReviewQuestionRequest({ ...request, text: 'x'.repeat(MAX_REVIEW_QUESTION_TEXT + 1) })).toBeNull();
  const state = { ...EMPTY_SESSION_BTW_STATE, entries: [{ id: 'entry-1', question: text, answer: '', state: 'done' }] };
  expect(parseReviewQuestionResponse({ type: 'reviewQuestion.state', sessionId: 'session-1', questionId: 'question-1', state })).not.toBeNull();
  expect(parseSessionBtwMessage({ type: 'session.btw', sessionId: 'session-1', sequence: 0, btw: state })).toBeNull();
});
