// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMPTY_SESSION_BTW_STATE, type SessionBtwState, type BtwAskMessage } from '../../../shared/protocol/btwProtocol';
import { prepareAttachment, type PreparedAttachment } from '../attachments/attachmentIngress';
import { SideChatSheet } from '../SideChatSheet';
import { useBtwPanel } from './useBtwPanel';

vi.mock('../attachments/attachmentIngress', async (importOriginal) => ({
  ...await importOriginal<typeof import('../attachments/attachmentIngress')>(), prepareAttachment: vi.fn(),
}));
const ready: SessionBtwState = { ...EMPTY_SESSION_BTW_STATE, status: 'ready' };
const file = () => new File(['synthetic image'], 'diagram.png', { type: 'image/png' });
const prepared: PreparedAttachment = { kind: 'image', name: 'diagram.png', mediaType: 'image/png', data: 'aW1hZ2U=' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.mocked(prepareAttachment).mockReset().mockResolvedValue(prepared);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps text, quotes, images and an explicit model when the sheet unmounts on close', async () => {
  const postMessage = vi.fn();
  const port = { postMessage };
  const read = deferred<PreparedAttachment>();
  vi.mocked(prepareAttachment).mockReturnValueOnce(read.promise);
  let panel!: ReturnType<typeof useBtwPanel>;
  function Harness({ available = true, defaultModelId = 'main-model' }) {
    panel = useBtwPanel(port, 'session-a', { state: ready, available, defaultModelId });
    return panel.open && available ? <SideChatSheet state={ready} draft={panel.draft} quotes={panel.quotes} width={panel.width}
      images={panel.images} selectedModel={panel.selectedModel} onModelChange={panel.setChosenModel}
      sending={panel.sending} onDraftChange={panel.setDraft} onQuoteClear={panel.clearQuote}
      onAsk={panel.sendDraft} onStop={panel.stop} onDismiss={panel.dismiss} onWidthChange={panel.setWidth} /> : null;
  }
  const view = render(<Harness />);
  act(() => { panel.openWithQuote('Keep this context'); panel.setDraft('Keep this question'); panel.setChosenModel('chosen-model'); panel.images.add([file()]); });
  expect(panel.images.reading).toBe(1);
  act(() => panel.dismiss());
  expect(screen.queryByRole('textbox')).toBeNull();
  await act(async () => read.resolve(prepared));
  // Capability availability may disappear during recovery without changing the bound session.
  view.rerender(<Harness available={false} defaultModelId="different-main-model" />);
  view.rerender(<Harness defaultModelId="different-main-model" />);
  act(() => panel.openPanel());
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this question');
  expect(screen.getByRole('button', { name: 'View quoted context: Keep this context' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Preview diagram.png' })).toBeDefined();
  expect(screen.getByRole('combobox').textContent).toBe('chosen-model');
  expect(postMessage.mock.calls.some(([message]) => message.type === 'btw.dismiss' || message.type === 'btw.stop')).toBe(false);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    type: 'btw.ask', sessionId: 'session-a', text: '> Keep this context\n\nKeep this question', modelId: 'chosen-model',
    images: [expect.objectContaining({ name: 'diagram.png', dataBase64: 'aW1hZ2U=' })],
  }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this question');
});

it('cleans the previous session and ignores its late reads without corrupting the new pending count', async () => {
  const oldRead = deferred<PreparedAttachment>(), newRead = deferred<PreparedAttachment>();
  vi.mocked(prepareAttachment).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
  const port = { postMessage: vi.fn() };
  const { result, rerender } = renderHook(({ sessionId }) => useBtwPanel(port, sessionId, { state: ready, defaultModelId: 'main-model' }), {
    initialProps: { sessionId: 'session-a' },
  });
  act(() => { result.current.setDraft('old draft'); result.current.setChosenModel('old-model'); result.current.images.add([file()]); });
  const oldPreviews = result.current.images.previews;
  rerender({ sessionId: 'session-b' });
  expect(result.current.draft).toBe('');
  expect(result.current.selectedModel).toBe('main-model');
  expect(result.current.open).toBe(false);
  act(() => result.current.images.add([file()]));
  await act(async () => oldRead.resolve(prepared));
  expect(result.current.images.reading).toBe(1);
  expect(result.current.images.images).toHaveLength(0);
  expect(oldPreviews.size).toBe(0);
  await act(async () => newRead.resolve(prepared));
  expect(result.current.images.reading).toBe(0);
  expect(result.current.images.images).toHaveLength(1);
  rerender({ sessionId: 'session-a' });
  expect(result.current.draft).toBe('');
  expect(result.current.images.images).toHaveLength(0);
});

it('clears only the accepted submission and keeps later typing and image previews', async () => {
  const port = { postMessage: vi.fn() };
  const { result, rerender } = renderHook(({ state }) => useBtwPanel(port, 'session-a', { state, defaultModelId: 'main-model' }), {
    initialProps: { state: ready },
  });
  act(() => { result.current.setDraft('Question'); result.current.images.add([file()]); });
  await waitFor(() => expect(result.current.images.reading).toBe(0));
  act(() => result.current.sendDraft('Question'));
  expect(result.current.draft).toBe('Question');
  expect(result.current.images.images).toHaveLength(1);
  expect(result.current.sending).toBe(true);
  const request = port.postMessage.mock.calls.at(-1)![0] as BtwAskMessage;
  act(() => result.current.setDraft('Next question'));
  rerender({ state: { ...ready, entries: [{ id: 'new-entry', question: request.text, modelId: request.modelId,
    images: request.images, answer: '', state: 'streaming', message: null }] } });
  expect(result.current.draft).toBe('Next question');
  expect(result.current.images.images).toHaveLength(0);
  expect(result.current.images.previews.has(request.images![0]!.id)).toBe(true);
  expect(result.current.sending).toBe(false);
});

it('waits for a new entry or matching queued acknowledgement, not an old question with the same text', () => {
  const port = { postMessage: vi.fn() };
  const initial: SessionBtwState = { ...ready, entries: [{ id: 'old-entry', question: 'Repeated question', answer: 'Old answer', state: 'done', message: null }] };
  const { result, rerender } = renderHook(({ state }) => useBtwPanel(port, 'session-a', { state }), { initialProps: { state: initial } });
  act(() => result.current.setDraft('Repeated question'));
  act(() => { result.current.sendDraft('Repeated question'); result.current.sendDraft('Repeated question'); });
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  expect(result.current.draft).toBe('Repeated question');
  rerender({ state: { ...initial, pendingQuestion: 'Repeated question' } });
  expect(result.current.draft).toBe('');
  expect(result.current.sending).toBe(false);
});

it.each(['throw', 'reject'] as const)('retains text and images when bridge delivery fails by %s', async (failure) => {
  const delivery = deferred<void>();
  const postMessage = vi.fn(() => { if (failure === 'throw') throw new Error('disconnected'); return delivery.promise; });
  const { result } = renderHook(() => useBtwPanel({ postMessage }, 'session-a', { state: ready }));
  act(() => { result.current.setDraft('Retry this'); result.current.images.add([file()]); });
  await waitFor(() => expect(result.current.images.reading).toBe(0));
  act(() => result.current.sendDraft('Retry this'));
  if (failure === 'reject') await act(async () => delivery.reject(new Error('disconnected')));
  expect(result.current.draft).toBe('Retry this');
  expect(result.current.images.images).toHaveLength(1);
  expect(result.current.notice).toContain('could not be sent');
  expect(result.current.sending).toBe(false);
});

it('keeps the draft when the Host becomes unavailable before acknowledgement', () => {
  const port = { postMessage: vi.fn() };
  const { result, rerender } = renderHook(({ state }) => useBtwPanel(port, 'session-a', { state }), { initialProps: { state: ready } });
  act(() => result.current.setDraft('Keep this'));
  act(() => result.current.sendDraft('Keep this'));
  rerender({ state: { ...ready, status: 'error', message: 'Unavailable' } });
  expect(result.current.draft).toBe('Keep this');
  expect(result.current.sending).toBe(false);
  expect(result.current.notice).toContain('not been confirmed');
});

it('keeps existing input and images when a later image cannot be read', async () => {
  const { result } = renderHook(() => useBtwPanel({ postMessage: vi.fn() }, 'session-a', { state: ready }));
  act(() => { result.current.setDraft('Still here'); result.current.images.add([file()]); });
  await waitFor(() => expect(result.current.images.reading).toBe(0));
  vi.mocked(prepareAttachment).mockRejectedValueOnce(new Error('read failed'));
  act(() => result.current.images.add([file()]));
  await waitFor(() => expect(result.current.images.reading).toBe(0));
  expect(result.current.draft).toBe('Still here');
  expect(result.current.images.images).toHaveLength(1);
  expect(result.current.images.notice).toContain('could not be attached');
});

it.each(['add', 'paste'] as const)('blocks sending in the same event as %s until the image finishes reading', async (method) => {
  const read = deferred<PreparedAttachment>();
  vi.mocked(prepareAttachment).mockReturnValueOnce(read.promise);
  const port = { postMessage: vi.fn() };
  const { result } = renderHook(() => useBtwPanel(port, 'session-a', { state: ready }));
  act(() => result.current.setDraft('Describe this'));
  act(() => {
    if (method === 'add') result.current.images.add([file()]);
    else result.current.images.onPaste({
      clipboardData: { files: [file()], getData: () => '' }, preventDefault: vi.fn(),
    } as unknown as Parameters<typeof result.current.images.onPaste>[0]);
    result.current.sendDraft('Describe this');
  });
  expect(port.postMessage).not.toHaveBeenCalled();
  expect(result.current.sending).toBe(false);
  expect(result.current.draft).toBe('Describe this');
  await act(async () => read.resolve(prepared));
  act(() => result.current.sendDraft('Describe this'));
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: 'btw.ask', text: 'Describe this', images: [expect.objectContaining({ name: 'diagram.png' })],
  }));
});

it('bounds missing acknowledgement without retrying and preserves the complete draft across unrelated updates', async () => {
  vi.useFakeTimers();
  const port = { postMessage: vi.fn() };
  const { result, rerender } = renderHook(({ state }) => useBtwPanel(port, 'session-a', { state }), { initialProps: { state: ready } });
  await act(async () => {
    result.current.openWithQuote('Context');
    result.current.setDraft('Unconfirmed question');
    result.current.setChosenModel('chosen-model');
    result.current.images.add([file()]);
  });
  port.postMessage.mockClear();
  const imageId = result.current.images.images[0]!.id;
  act(() => result.current.sendDraft('> Context\n\nUnconfirmed question'));
  act(() => vi.advanceTimersByTime(4_999));
  expect(result.current.sending).toBe(true);
  rerender({ state: { ...ready, entries: [{ id: 'unrelated', question: 'Other question', answer: 'Updated answer', state: 'done', message: null }] } });
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.sending).toBe(false);
  expect(result.current.notice).toContain('not been confirmed');
  expect(result.current.draft).toBe('Unconfirmed question');
  expect(result.current.quotes).toEqual(['Context']);
  expect(result.current.selectedModel).toBe('chosen-model');
  expect(result.current.images.images.map((image) => image.id)).toEqual([imageId]);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(60_000));
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  // Only an explicit user action may send again after checking the conversation.
  act(() => result.current.sendDraft('> Context\n\nUnconfirmed question'));
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});

it('cancels the acceptance deadline after acknowledgement and keeps later typing', () => {
  vi.useFakeTimers();
  const port = { postMessage: vi.fn() };
  const { result, rerender } = renderHook(({ state }) => useBtwPanel(port, 'session-a', { state }), { initialProps: { state: ready } });
  act(() => result.current.setDraft('Question'));
  act(() => result.current.sendDraft('Question'));
  act(() => vi.advanceTimersByTime(4_000));
  rerender({ state: { ...ready, pendingQuestion: 'Question' } });
  expect(result.current.draft).toBe('');
  act(() => result.current.setDraft('Next draft'));
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.draft).toBe('Next draft');
  expect(result.current.notice).toBeNull();
  expect(result.current.sending).toBe(false);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
});

it('does not let the previous session deadline settle a new session submission', () => {
  vi.useFakeTimers();
  const port = { postMessage: vi.fn() };
  const { result, rerender } = renderHook(({ sessionId }) => useBtwPanel(port, sessionId, { state: ready }), {
    initialProps: { sessionId: 'session-a' },
  });
  act(() => result.current.sendDraft('Old question'));
  act(() => vi.advanceTimersByTime(2_000));
  rerender({ sessionId: 'session-b' });
  act(() => result.current.setDraft('New question'));
  act(() => result.current.sendDraft('New question'));
  act(() => vi.advanceTimersByTime(3_000));
  expect(result.current.sending).toBe(true);
  expect(result.current.draft).toBe('New question');
  act(() => vi.advanceTimersByTime(2_000));
  expect(result.current.sending).toBe(false);
  expect(result.current.notice).toContain('not been confirmed');
  expect(result.current.draft).toBe('New question');
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});
