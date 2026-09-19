// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { useEditAttachmentIngress } from './useEditAttachmentIngress';
import { useMessageEditor } from '../../webview/assistant/editing/useMessageEditor';
import { useAttachmentActions } from '../../webview/assistant/attachments/useAttachmentActions';
import { prepareAttachment, type PreparedAttachment } from '../../webview/assistant/attachments/attachmentIngress';

vi.mock('../../webview/assistant/attachments/attachmentIngress', async (original) => ({
  ...await original<typeof import('../../webview/assistant/attachments/attachmentIngress')>(),
  prepareAttachment: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const port = { postMessage: vi.fn() };
const noop = () => {};

function Harness({ conversationId }: { conversationId: string }) {
  const editor = useMessageEditor({ conversationId, sendSignal: 0, rejection: null, onBegin: noop, onStageBegin: noop, onStageCancel: noop, onRequestRewindInfo: noop, onResend: noop });
  useEffect(() => { editor.begin('message-1', 'Question'); }, [conversationId]);
  const actions = useAttachmentActions(port, conversationId, 'connected');
  const ingress = useEditAttachmentIngress({ editor, actions, conversationId, count: 0, disabled: false });
  return <>
    <textarea aria-label="Editor" {...ingress} />
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
  await act(async () => finish({ kind: 'text', name: 'late.txt', text: 'Do not cross sessions', truncated: false }));
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});
