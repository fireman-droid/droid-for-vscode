// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';
import { useComposerFlow } from '../../webview/assistant/composer/useComposerFlow';
import { prepareAttachment, type PreparedAttachment } from '../../webview/assistant/attachments/attachmentIngress';
import { Composer } from './Composer';

vi.mock('../../webview/assistant/attachments/attachmentIngress', async (original) => ({
  ...await original<typeof import('../../webview/assistant/attachments/attachmentIngress')>(),
  prepareAttachment: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const port = { postMessage: vi.fn(), getState: () => ({}), setState: vi.fn() };
const routes = { blocked: false, compact: vi.fn(), navigate: vi.fn(), openBtw: vi.fn(), askBtw: vi.fn() };
const onFileSearch = vi.fn();
const state: AssistantWebviewState = {
  ...initialAssistantWebviewState, sessionId: 'session-1', conversationId: 'conversation-1', connection: { status: 'connected' },
};
function Harness({ current = state }: { current?: AssistantWebviewState }) {
  const flow = useComposerFlow(port, current, vi.fn(), routes);
  return <Composer key={current.conversationId} state={current} port={port} flow={flow} blocked={false} renderInputRow={(input, action) => <>{input}{action}</>}
    onFileSearch={onFileSearch} onNavigate={routes.navigate} onBtwOpen={routes.openBtw} />;
}

it('keeps Slash choices local, filters unsupported entries, and does not select or send during IME composition', async () => {
  const user = userEvent.setup();
  const catalog: AssistantWebviewState = { ...state, commands: { status: 'ready', recent: [], items: [
    { name: 'mission', description: null, argumentHint: null, isExecutable: false },
    { name: 'shell-command', description: null, argumentHint: null, isExecutable: true },
    { name: 'inspect', description: 'Inspect workspace', argumentHint: '<path>', isExecutable: false },
  ] }, skills: { status: 'ready', items: [{ name: 'frontend-design', description: 'Build the UI', enabled: true, location: 'user', userInvocable: false }] } };
  render(<Harness current={catalog} />);
  const input = screen.getByRole('textbox', { name: 'Message Droid' });
  await user.type(input, '/');
  expect(screen.queryByRole('option', { name: /^\/mission/ })).toBeNull();
  expect(screen.queryByRole('option', { name: /^\/shell-command/ })).toBeNull();
  expect(screen.queryByRole('option', { name: /^\/btw/ })).toBeNull();
  expect(screen.getByRole('option', { name: /^\/inspect/ })).toBeDefined();
  fireEvent.change(input, { target: { value: '/front' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect((input as HTMLTextAreaElement).value).toBe('/front');
  expect(port.postMessage).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect((input as HTMLTextAreaElement).value).toBe('Use the "frontend-design" skill: ');
  expect(port.postMessage).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '/model' } });
  await user.keyboard('{Tab}');
  expect(routes.navigate).toHaveBeenCalledExactlyOnceWith('model');
  expect((input as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(input, { target: { value: '/compact' } });
  await user.keyboard('{Enter}');
  expect(routes.compact).not.toHaveBeenCalled();
  expect((input as HTMLTextAreaElement).value).toBe('/compact ');
  await user.keyboard('{Enter}');
  expect(routes.compact).toHaveBeenCalledOnce();
  expect(port.postMessage).not.toHaveBeenCalled();
});

it('correlates mention results and attaches the selected path without sending the draft', async () => {
  const user = userEvent.setup();
  const view = render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Message Droid' });
  await user.type(input, '@');
  await waitFor(() => expect(onFileSearch).toHaveBeenCalledWith(expect.any(String), ''));
  const first = onFileSearch.mock.calls.at(-1)![0];
  view.rerender(<Harness current={{ ...state, fileSearch: { requestId: first, status: 'ok', files: ['src/open.ts'] } }} />);
  expect(screen.getByRole('option', { name: /open.ts/ })).toBeDefined();
  await user.type(input, 'notes');
  expect(screen.queryByRole('option', { name: /open.ts/ })).toBeNull();
  await waitFor(() => expect(onFileSearch).toHaveBeenLastCalledWith(expect.any(String), 'notes'));
  const second = onFileSearch.mock.calls.at(-1)![0];
  view.rerender(<Harness current={{ ...state, fileSearch: { requestId: second, status: 'ok', files: ['docs/notes.md', 'docs/notes-2.md'] } }} />);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'attachment.addPath', sessionId: 'session-1', path: 'docs/notes-2.md' });
  expect((input as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('listbox')).toBeNull();
});

it.each(['send', 'conversation switch'])('stages each paste once in the composer and drops unfinished reads after %s', async (reset) => {
  let finish!: (result: PreparedAttachment) => void;
  vi.mocked(prepareAttachment).mockResolvedValueOnce({ kind: 'image', name: 'shot.png', mediaType: 'image/png', data: 'aW1hZ2U=' })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Message Droid' });
  const file = new File(['image'], 'shot.png', { type: 'image/png' });
  const paste = { clipboardData: { files: [file], getData: () => 'keep native text' } };
  expect(fireEvent.paste(input, paste)).toBe(true);
  await waitFor(() => expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'attachment.addImage', sessionId: 'session-1', name: 'shot.png', mediaType: 'image/png', dataBase64: 'aW1hZ2U=',
  }));
  fireEvent.drop(input, { dataTransfer: { files: [file], getData: () => '' } });
  if (reset === 'send') {
    fireEvent.change(input, { target: { value: 'Send before the file has finished loading' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  } else view.rerender(<Harness current={{ ...state, sessionId: 'session-2', conversationId: 'conversation-2' }} />);
  await act(async () => finish({ kind: 'text', name: 'late.txt', text: 'Must not enter the next prompt', truncated: false }));
  expect(port.postMessage.mock.calls.filter(([message]) => message.type.startsWith('attachment.'))).toHaveLength(1);
});

it('switches the single action button to Stop while Enter still queues during an active turn', async () => {
  const user = userEvent.setup();
  render(<Harness current={{ ...state, turn: { turnId: 'turn-1', status: 'streaming' } }} />);
  await user.type(screen.getByRole('textbox', { name: 'Message Droid' }), 'Continue with the next step');
  expect(screen.queryByRole('button', { name: 'Queue message' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined();
  await user.keyboard('{Enter}');
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'queue.add', sessionId: 'session-1', queueId: expect.any(String), text: 'Continue with the next step' });
  await user.click(screen.getByRole('button', { name: 'Stop' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'turn.stop', sessionId: 'session-1', turnId: 'turn-1' });
});

it('removes quoted context without changing the message body', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'Message Droid' });
  fireEvent.change(input, { target: { value: '> Existing context\n> Second line\n\nMy follow-up question' } });
  await user.click(screen.getByRole('button', { name: 'Remove quoted context' }));
  expect((input as HTMLTextAreaElement).value).toBe('My follow-up question');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'turn.send', sessionId: 'session-1', turnId: expect.any(String), text: 'My follow-up question' });
});
