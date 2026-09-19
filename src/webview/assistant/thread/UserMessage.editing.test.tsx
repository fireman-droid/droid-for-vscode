// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { UserEditorEnv } from '../editing/userEditorEnv';
import type { EditResendRejection } from '../editing/editTypes';
import { useMessageEditor } from '../editing/useMessageEditor';
import { UserMessage } from './UserMessage';

vi.mock('@assistant-ui/react', () => ({
  MessagePrimitive: {
    Root: ({ children, ...props }: { children: ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    Parts: ({ children }: { children: (value: unknown) => ReactNode }) =>
      children({ part: { type: 'text', text: 'Original question' } }),
  },
  useAuiState: (selector: (state: unknown) => unknown) =>
    selector({ message: { id: 'visible-user-1', metadata: {} } }),
}));
vi.mock('../composer/ComposerControls', () => ({
  ComposerControls: () => null,
}));

const env = {
  settings: { status: 'ready' },
  controlsDisabled: false,
  attachmentImages: {
    image: { status: 'ready', mediaType: 'image/png', dataBase64: 'dGVzdA==' },
  },
  onAttachmentReadImage: vi.fn(),
  onAttachmentReplaceImage: vi.fn(),
  onAttachmentRemove: vi.fn(),
  onAttachFiles: vi.fn(),
} as unknown as UserEditorEnv;

function createCallbacks() {
  return {
    onBegin: vi.fn(),
    onStageBegin: vi.fn(),
    onStageCancel: vi.fn(),
    onRequestRewindInfo: vi.fn(),
    onResend: vi.fn(),
  };
}
function Harness({
  surface,
  callbacks,
  rejection = null,
  conversationId = 'conversation-1',
  sendSignal = 0,
}: {
  surface: 'flow' | 'pinned' | 'unmounted';
  callbacks: ReturnType<typeof createCallbacks>;
  rejection?: EditResendRejection | null;
  conversationId?: string;
  sendSignal?: number;
}) {
  const editor = useMessageEditor({
    ...callbacks,
    rejection,
    conversationId,
    sendSignal,
  });
  const props = {
    text: 'Original question',
    messageId: 'message-1',
    attachments: [],
    editor,
    editStage: {
      messageId: 'message-1',
      attachments: [
        {
          id: 'image',
          kind: 'image' as const,
          name: 'shot.png',
          sizeBytes: 4,
          restorable: true,
        },
        {
          id: 'file',
          kind: 'text' as const,
          name: 'notes.txt',
          sizeBytes: 10,
          restorable: true,
        },
      ],
    },
    rejection,
    editorEnv: env,
    editResendEnabled: true,
    rewindInfo: {
      messageId: 'message-1',
      restorableCount: 1,
      createdCount: 0,
      restorablePaths: ['src/app.ts'],
      createdPaths: [],
      evictedFiles: [],
    },
  };
  return surface === 'unmounted' ? null : (
    <>
      <UserMessage {...props} key="flow" pinnedPlaceholder={surface === 'pinned'} />
      {surface === 'pinned' ? <UserMessage {...props} key="pinned" /> : null}
    </>
  );
}

afterEach(cleanup);

describe('historical message editor ownership', () => {
  it('keeps text, selection, attachments and restore choice across surfaces and virtual eviction', async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    const { rerender } = render(<Harness surface="pinned" callbacks={callbacks} />);
    await user.click(
      screen.getByRole('button', { name: 'Edit message and resend from here' }),
    );
    await user.click(screen.getByRole('checkbox'));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'Edited question with attachments' } });
    input.setSelectionRange(2, 8, 'forward');
    fireEvent.select(input);
    input.scrollTop = 21;
    fireEvent.scroll(input);

    for (const surface of ['flow', 'pinned'] as const) {
      rerender(<Harness surface={surface} callbacks={callbacks} />);
      const restored = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(restored.value).toBe('Edited question with attachments');
      expect([restored.selectionStart, restored.selectionEnd]).toEqual([2, 8]);
      expect(restored.scrollTop).toBe(21);
      expect(document.activeElement).toBe(restored);
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    }

    rerender(<Harness surface="unmounted" callbacks={callbacks} />);
    rerender(<Harness surface="pinned" callbacks={callbacks} />);
    const restored = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(restored.value).toBe('Edited question with attachments');
    expect([restored.selectionStart, restored.selectionEnd]).toEqual([2, 8]);
    expect(screen.getByRole('button', { name: 'Preview shot.png' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Preview notes.txt' })).toBeDefined();
    expect(callbacks.onStageBegin).toHaveBeenCalledOnce();
    expect(callbacks.onRequestRewindInfo).toHaveBeenCalledOnce();
    expect(callbacks.onStageCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Resend edited message' }));
    expect(callbacks.onResend).toHaveBeenCalledWith(
      'message-1',
      'Edited question with attachments',
      true,
    );
  });

  it('reopens a rejected resend with its draft after the surface changes, and Escape cancels it', async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    const { rerender } = render(<Harness surface="pinned" callbacks={callbacks} />);
    await user.click(
      screen.getByRole('button', { name: 'Edit message and resend from here' }),
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Retry this edit' },
    });
    await user.click(screen.getByRole('button', { name: 'Resend edited message' }));
    rerender(<Harness surface="unmounted" callbacks={callbacks} />);
    rerender(
      <Harness
        surface="flow"
        callbacks={callbacks}
        rejection={{ messageId: 'message-1', reason: 'busy', sequence: 1 }}
      />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Retry this edit',
    );
    expect(callbacks.onStageBegin).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(callbacks.onStageCancel).toHaveBeenCalledOnce();
  });

  it('drops the previous draft on conversation change and cancels an open edit on a new send', async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    const { rerender } = render(<Harness surface="flow" callbacks={callbacks} />);
    await user.click(
      screen.getByRole('button', { name: 'Edit message and resend from here' }),
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Old conversation' },
    });
    rerender(
      <Harness surface="flow" callbacks={callbacks} conversationId="conversation-2" />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(callbacks.onStageCancel).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Edit message and resend from here' }),
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Original question',
    );
    rerender(
      <Harness
        surface="flow"
        callbacks={callbacks}
        conversationId="conversation-2"
        sendSignal={1}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(callbacks.onStageCancel).toHaveBeenCalledOnce();
  });
});
