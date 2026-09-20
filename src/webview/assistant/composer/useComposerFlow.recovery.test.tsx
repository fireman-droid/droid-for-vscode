// @vitest-environment jsdom
import { useReducer } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TURN_SEND_REJECTED_CODE } from '../../../shared/protocol/turns';
import { initialAssistantWebviewState } from '../state/initialState';
import { assistantWebviewReducer } from '../state/store';
import type { AssistantWebviewState, StoreHostMessage } from '../state/types';
import { useComposerFlow } from './useComposerFlow';

afterEach(cleanup);
const connected: AssistantWebviewState = {
  ...initialAssistantWebviewState, sessionId: 'session-1', conversationId: 'conversation-1',
  connection: { status: 'connected' },
};
function mount(initial = connected, saved = { draft: '' }) {
  const port = { getState: () => saved, setState: vi.fn((next: { draft?: string }) => { saved.draft = next.draft ?? ''; }), postMessage: vi.fn() };
  const routes = { blocked: false, compact: vi.fn(), navigate: vi.fn(), openBtw: vi.fn(), askBtw: vi.fn() };
  const hook = renderHook(() => {
    const [state, dispatch] = useReducer(assistantWebviewReducer, initial);
    return { state, dispatch, flow: useComposerFlow(port, state, dispatch, routes) };
  });
  return { ...hook, port };
}
function rejection(turnId: string): StoreHostMessage {
  return { type: 'turn.error', sessionId: 'session-1', turnId, sequence: 10,
    code: TURN_SEND_REJECTED_CODE, message: 'Message was not sent while settings were updating.', retryable: true };
}

it('blocks sending during a settings update without clearing the draft', async () => {
  const view = mount({ ...connected, settings: { status: 'updating', value: null } });
  act(() => view.result.current.flow.handleDraftChange('Keep this question'));
  expect(view.result.current.flow.callbacks.isSendDisabled).toBe(true);
  await act(() => view.result.current.flow.callbacks.onSend('Keep this question'));
  expect(view.port.postMessage).not.toHaveBeenCalled();
  expect(view.result.current.flow.draft).toBe('Keep this question');
  expect(view.result.current.state.turn).toBeNull();
});

it.each([false, true])('ends a rejected send and restores only an untouched draft (new input: %s)', async (newInput) => {
  const view = mount();
  act(() => view.result.current.flow.handleDraftChange('Original question'));
  await act(() => view.result.current.flow.callbacks.onSend('Original question'));
  const turnId = view.result.current.state.turn!.turnId;
  expect(view.result.current.state.turn?.status).toBe('submitting');
  if (newInput) act(() => view.result.current.flow.handleDraftChange('New unfinished question'));
  const message = rejection(turnId);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
    view.result.current.dispatch({ type: 'host.message', message });
  });
  expect(view.result.current.state.turn?.status).toBe('failed');
  expect(view.result.current.flow.draft).toBe(newInput ? 'New unfinished question' : 'Original question');
  expect(view.port.setState).toHaveBeenLastCalledWith({ draft: newInput ? 'New unfinished question' : 'Original question' });
  expect(view.result.current.state.transcript.some((item) => item.kind === 'user' && item.text === 'Original question')).toBe(true);
  expect(view.result.current.flow.callbacks.isSendDisabled).toBe(false);
});

it('ignores a late rejection for another request without settling the current turn', async () => {
  const view = mount();
  await act(() => view.result.current.flow.callbacks.onSend('Current request'));
  const current = view.result.current.state.turn;
  act(() => {
    const message = rejection('stale-turn');
    window.dispatchEvent(new MessageEvent('message', { data: message }));
    view.result.current.dispatch({ type: 'host.message', message });
  });
  expect(view.result.current.state.turn).toEqual(current);
  expect(view.result.current.state.terminalTurnId).toBeNull();
  expect(view.result.current.flow.draft).toBe('');
});

const withQueue: AssistantWebviewState = {
  ...connected, turn: { turnId: 'working', status: 'streaming' },
  queue: { paused: null, items: [
    { queueId: 'queued-1', text: 'First queued question', attachments: [] },
    { queueId: 'queued-2', text: 'Second queued question', attachments: [] },
  ] },
};

it.each(['cancel', 'save', 'dispatched'] as const)('restores the ordinary draft when queue editing ends through %s', async (end) => {
  const view = mount(withQueue);
  act(() => view.result.current.flow.handleDraftChange('Unsent draft to keep'));
  act(() => view.result.current.flow.handleQueueEditBegin('queued-1'));
  act(() => view.result.current.flow.handleDraftChange('Edited queued question'));
  if (end === 'cancel') act(() => view.result.current.flow.handleQueueEditCancel());
  else if (end === 'save') await act(() => view.result.current.flow.callbacks.onSend('Edited queued question'));
  else act(() => view.result.current.dispatch({ type: 'host.message', message: {
    type: 'queue.state', sequence: 10, sessionId: 'session-1', paused: null, items: [],
  } }));
  expect(view.result.current.flow.draft).toBe('Unsent draft to keep');
  expect(view.port.setState).toHaveBeenLastCalledWith({ draft: 'Unsent draft to keep' });
  expect(view.result.current.flow.queueEditingId).toBeNull();
  if (end === 'save') expect(view.port.postMessage).toHaveBeenCalledWith({
    type: 'queue.update', sessionId: 'session-1', queueId: 'queued-1', text: 'Edited queued question',
  });
});

it('keeps the original draft while moving directly between queued messages', () => {
  const view = mount(withQueue);
  act(() => view.result.current.flow.handleDraftChange('Original unsent draft'));
  act(() => view.result.current.flow.handleQueueEditBegin('queued-1'));
  act(() => view.result.current.flow.handleQueueEditBegin('queued-2'));
  expect(view.result.current.flow.draft).toBe('Second queued question');
  act(() => view.result.current.flow.handleQueueEditCancel());
  expect(view.result.current.flow.draft).toBe('Original unsent draft');
});

it('restores the ordinary draft after reloading during an unfinished queue edit', () => {
  const saved = { draft: 'Original unsent draft' };
  const view = mount(withQueue, saved);
  act(() => view.result.current.flow.handleQueueEditBegin('queued-1'));
  act(() => view.result.current.flow.handleDraftChange('Temporary queue edit'));
  view.unmount();
  const restored = mount(withQueue, saved);
  expect(restored.result.current.flow.draft).toBe('Original unsent draft');
  expect(restored.result.current.flow.queueEditingId).toBeNull();
});
