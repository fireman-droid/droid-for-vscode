// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { useEditAttachmentIngress } from './useEditAttachmentIngress';
import { useMessageEditor } from './editing/useMessageEditor';
import { useAttachmentActions } from './attachments/useAttachmentActions';
import { prepareAttachment, type PreparedAttachment } from './attachments/attachmentIngress';
import { QuestionCard } from './QuestionCard';

vi.mock('./attachments/attachmentIngress', async (original) => ({
  ...await original<typeof import('./attachments/attachmentIngress')>(),
  prepareAttachment: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(prepareAttachment).mockReset(); });
const port = { postMessage: vi.fn() };
const noop = () => {};
const onResend = vi.fn();

function Harness({ conversationId }: { conversationId: string }) {
  const editor = useMessageEditor({ conversationId, sendSignal: 0, rejection: null, onBegin: noop, onStageBegin: noop, onStageCancel: noop, onRequestRewindInfo: noop, onResend });
  useEffect(() => { editor.begin('message-1', 'Question'); }, [conversationId]);
  const actions = useAttachmentActions(port, conversationId, 'connected');
  const ingress = useEditAttachmentIngress({ editor, actions, conversationId, count: 0, disabled: false });
  return <>
    <QuestionCard item={{ kind: 'user', id: 'question-1', messageId: 'message-1', text: 'Question' }} editor={editor} canResend
      edit={{ actions, disabled: false, stage: { messageId: 'message-1', attachments: [] }, images: {}, impact: null, rejection: null, ...ingress }} />
    <button onClick={editor.cancel}>Cancel edit</button>
    <button onClick={() => editor.begin('message-1', 'Question')}>Begin edit</button>
  </>;
}

it.each(['conversation switch', 'cancel and reopen'])('stages files in the edit stage, but drops late reads after %s', async (reset) => {
  let finish!: (result: PreparedAttachment) => void;
  vi.mocked(prepareAttachment).mockResolvedValueOnce({ kind: 'image', name: 'shot.png', mediaType: 'image/png', data: 'dGVzdA==' })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<Harness conversationId="first" />);
  const file = new File(['image'], 'shot.png', { type: 'image/png' });
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [file], getData: () => '' } });
  await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({
    type: 'attachment.addImage', sessionId: 'first', stage: 'edit', name: 'shot.png', mediaType: 'image/png', dataBase64: 'dGVzdA==',
  }));
  fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [], getData: (type: string) => type === 'text/uri-list' ? 'file:///workspace/notes.txt' : '' } });
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'attachment.addUris', sessionId: 'first', stage: 'edit', uris: ['file:///workspace/notes.txt'] });
  fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [file], getData: () => '' } });
  if (reset === 'conversation switch') rerender(<Harness conversationId="second" />);
  else {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Begin edit' }));
  }
  expect((screen.getByRole('button', { name: 'Resend edited message' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => finish({ kind: 'text', name: 'late.txt', text: 'Do not cross sessions', truncated: false }));
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});

it('blocks an immediate historical resend until prepared attachments reach its edit stage', async () => {
  let finish!: (result: PreparedAttachment) => void;
  vi.mocked(prepareAttachment).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<Harness conversationId="first" />);
  const input = screen.getByRole('textbox');
  act(() => {
    fireEvent.paste(input, { clipboardData: { files: [new File(['image'], 'shot.png', { type: 'image/png' })], getData: () => '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend edited message' }));
  });
  expect(onResend).not.toHaveBeenCalled();
  expect(screen.getByText('Preparing attachments…')).toBeDefined();
  expect((screen.getByRole('button', { name: 'Resend edited message' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ kind: 'image', name: 'shot.png', mediaType: 'image/png', data: 'dGVzdA==' }));
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'attachment.addImage', sessionId: 'first', stage: 'edit', name: 'shot.png', mediaType: 'image/png', dataBase64: 'dGVzdA==' });
  expect(screen.queryByText('Preparing attachments…')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onResend).toHaveBeenCalledExactlyOnceWith('message-1', 'Question', false);
  expect(port.postMessage.mock.invocationCallOrder[0]).toBeLessThan(onResend.mock.invocationCallOrder[0]!);
});

it('releases the historical resend gate when attachment preparation fails', async () => {
  vi.mocked(prepareAttachment).mockRejectedValueOnce(new Error('File read failed'));
  render(<Harness conversationId="first" />);
  const input = screen.getByRole('textbox');
  fireEvent.paste(input, { clipboardData: { files: [new File(['image'], 'shot.png', { type: 'image/png' })], getData: () => '' } });
  await screen.findByText('shot.png could not be attached.');
  expect((input as HTMLTextAreaElement).value).toBe('Question');
  expect((screen.getByRole('button', { name: 'Resend edited message' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Resend edited message' }));
  expect(onResend).toHaveBeenCalledExactlyOnceWith('message-1', 'Question', false);
});
