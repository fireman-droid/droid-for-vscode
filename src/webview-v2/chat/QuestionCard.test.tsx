// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { useMessageEditor } from '../../webview/assistant/editing/useMessageEditor';
import type { EditResendRejection, EditStageState, RewindFileInfo } from '../../webview/assistant/editing/editTypes';
import type { SentAttachmentSummary } from '../../shared/protocol/attachments';
import { useAttachmentActions } from '../../webview/assistant/attachments/useAttachmentActions';
import { QuestionCard } from './QuestionCard';
import { EditorSettings } from './SettingsMenu';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';

afterEach(cleanup);

it('shows outside-file restore effects before resending and explains omitted entries', async () => {
  const user = userEvent.setup();
  const events = callbacks();
  const external: RewindFileInfo = {
    messageId: 'message-1', restorableCount: 1, createdCount: 1,
    restorablePaths: [], createdPaths: [], evictedFiles: [], evictedCount: 0,
    details: [
      { label: 'settings.json', action: 'restore', location: 'outside-workspace' },
      { label: 'new.json', action: 'delete', location: 'outside-workspace' },
    ],
  };
  const view = render(<Harness events={events} rewind={external} />);
  await user.click(screen.getByRole('button', { name: 'Edit message and resend from here' }));
  await user.click(screen.getByRole('button', { name: 'Restorable files' }));
  expect(screen.getByText('settings.json')).toBeDefined();
  expect(screen.getByText('Delete newly created file')).toBeDefined();
  expect(screen.getByText(/also affects the listed files outside/)).toBeDefined();
  expect(events.onResend).not.toHaveBeenCalled();
  view.rerender(<Harness events={events} rewind={{ ...external, details: external.details!.slice(0, 1) }} />);
  expect(screen.getByText(/1 additional affected file is not listed/)).toBeDefined();
  await user.click(screen.getByRole('checkbox', { name: 'Restore 2 files changed after this point' }));
  await user.click(screen.getByRole('button', { name: 'Resend edited message' }));
  expect(events.onResend).toHaveBeenCalledExactlyOnceWith('message-1', 'Original question', true);
});

function callbacks() {
  return { onBegin: vi.fn(), onStageBegin: vi.fn(), onStageCancel: vi.fn(), onRequestRewindInfo: vi.fn(), onResend: vi.fn() };
}

const impact: RewindFileInfo = {
  messageId: 'message-1', restorableCount: 1, createdCount: 1,
  restorablePaths: ['src/app.ts'], createdPaths: ['src/new.ts'],
  evictedFiles: [{ path: 'src/old.ts', reason: 'Original contents no longer retained' }],
};
const port = { postMessage: vi.fn() };
function Harness({ surface = 'flow', events, rejection = null, rewind = impact, stageOwner = 'message-1', conversationId = 'conversation-1', stage, sentAttachments = [] }: {
  surface?: 'flow' | 'pinned' | 'unmounted';
  events: ReturnType<typeof callbacks>;
  rejection?: EditResendRejection | null;
  rewind?: RewindFileInfo;
  stageOwner?: string;
  conversationId?: string;
  stage?: EditStageState | null;
  sentAttachments?: readonly SentAttachmentSummary[];
}) {
  const editor = useMessageEditor({ ...events, rejection, conversationId, sendSignal: 0 });
  const actions = useAttachmentActions(port, 'session-1', 'connected');
  const props = {
    item: { kind: 'user' as const, id: 'question-1', messageId: 'message-1', text: 'Original question', attachments: sentAttachments },
    editor, canResend: true, planChoice: null, onPlanToggle: vi.fn(),
    edit: {
      actions, disabled: false, impact: rewind, rejection, images: {},
      stage: stage === undefined ? { messageId: stageOwner, attachments: [{ id: 'file', name: 'notes.txt', kind: 'text' as const, sizeBytes: 10, truncated: false, restorable: true }] } : stage,
      onDrop: vi.fn(), onDragOver: vi.fn(), onPaste: vi.fn(),
      settings: <EditorSettings owner="message-1" port={port} blocked={false} state={{
        ...initialAssistantWebviewState, sessionId: 'session-1', connection: { status: 'connected' },
        settings: { status: 'ready', value: { modelId: 'model-1', reasoningEffort: 'medium', interactionMode: 'auto', autonomyLevel: 'low', specModeModelId: null, specModeReasoningEffort: null } },
      }} />,
    },
  };
  return surface === 'unmounted' ? null : <>
    <QuestionCard key="flow" {...props} placeholder={surface === 'pinned'} />
    {surface === 'pinned' ? <QuestionCard key="pinned" {...props} /> : null}
  </>;
}

it('preserves a single editable draft, selection, attachments and restore choice through pinning and eviction', async () => {
  const user = userEvent.setup();
  const events = callbacks();
  const { rerender } = render(<Harness events={events} />);
  await user.click(screen.getByRole('button', { name: 'Edit message and resend from here' }));
  await user.click(screen.getByRole('checkbox', { name: 'Restore 2 files changed after this point' }));
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'Keep this edited question' } });
  input.setSelectionRange(2, 8, 'backward');
  fireEvent.select(input);
  input.scrollTop = 21;
  fireEvent.scroll(input);
  for (const surface of ['pinned', 'flow', 'unmounted', 'pinned'] as const) {
    rerender(<Harness events={events} surface={surface} />);
    if (surface === 'unmounted') continue;
    const restored = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(restored.value).toBe('Keep this edited question');
    expect([restored.selectionStart, restored.selectionEnd, restored.selectionDirection, restored.scrollTop]).toEqual([2, 8, 'backward', 21]);
    expect(document.activeElement).toBe(restored);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Preview notes.txt' })).toBeDefined();
  }
  expect(events.onStageBegin).toHaveBeenCalledExactlyOnceWith('message-1');
  expect(events.onStageCancel).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Resend edited message' }));
  expect(events.onResend).toHaveBeenCalledExactlyOnceWith('message-1', 'Keep this edited question', true);
  expect(screen.queryByRole('button', { name: 'Edit message and resend from here' })).toBeNull();
});

it('retains original attachments until the edit stage arrives and respects an empty staged list', async () => {
  const user = userEvent.setup();
  const events = callbacks();
  const sentAttachments: readonly SentAttachmentSummary[] = [
    { kind: 'text', name: 'ui-notes.md', sizeBytes: 8420 },
    { kind: 'selection', name: 'Thread.tsx selection', sizeBytes: 2180 },
  ];
  const { rerender } = render(<Harness events={events} sentAttachments={sentAttachments} stage={null} />);
  await user.click(screen.getByRole('button', { name: 'Edit message and resend from here' }));
  expect(screen.getByRole('textbox')).toBeDefined();
  for (const attachment of sentAttachments) {
    expect(screen.getByRole('button', { name: `Preview ${attachment.name}` })).toBeDefined();
    expect(screen.queryByRole('button', { name: `Remove attachment ${attachment.name}` })).toBeNull();
  }
  await user.click(screen.getByRole('button', { name: 'Preview ui-notes.md' }));
  await screen.findByRole('dialog', { name: 'ui-notes.md' });
  await user.keyboard('{Escape}');
  expect(screen.getByRole('textbox')).toBeDefined();
  rerender(<Harness events={events} sentAttachments={sentAttachments} stage={{ messageId: 'message-1', attachments: [] }} />);
  expect(screen.queryByRole('button', { name: 'Preview ui-notes.md' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview Thread.tsx selection' })).toBeNull();
  expect(events.onStageCancel).not.toHaveBeenCalled();
});

it('scopes restore data and rejection copy to the edited message, preserving the draft after rejection', async () => {
  const user = userEvent.setup();
  const events = callbacks();
  const { rerender } = render(<Harness events={events} />);
  await user.click(screen.getByRole('button', { name: 'Edit message and resend from here' }));
  await user.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '中文草稿' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter', isComposing: true });
  expect(events.onResend).not.toHaveBeenCalled();
  rerender(<Harness events={events} rewind={{ ...impact, messageId: 'other-message' }} stageOwner="other-message" />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview notes.txt' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Resend edited message' }));
  expect(events.onResend).toHaveBeenCalledExactlyOnceWith('message-1', '中文草稿', false);
  rerender(<Harness events={events} rejection={{ messageId: 'message-1', reason: 'busy', sequence: 3 }} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('中文草稿');
  expect(screen.getByText(/Droid is busy/)).toBeDefined();
  rerender(<Harness events={events} rejection={{ messageId: 'other-message', reason: 'failed', sequence: 4 }} />);
  expect(screen.queryByText(/Rewinding to this message failed/)).toBeNull();
  await user.click(screen.getByRole('textbox'));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(events.onStageCancel).toHaveBeenCalledOnce();
});

it('keeps the editor alive while attachment portals open and close, and sends edit-stage actions', async () => {
  port.postMessage.mockClear();
  const user = userEvent.setup();
  const events = callbacks();
  render(<Harness events={events} />);
  await user.click(screen.getByRole('button', { name: 'Edit message and resend from here' }));
  await user.click(screen.getByRole('button', { name: 'Attach files to edited message' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'attachment.pick', sessionId: 'session-1', stage: 'edit' });
  const preview = screen.getByRole('button', { name: 'Preview notes.txt' });
  await user.click(preview);
  await screen.findByRole('dialog', { name: 'notes.txt' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(preview));
  expect(screen.getByRole('textbox')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Remove attachment notes.txt' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'attachment.remove', sessionId: 'session-1', attachmentId: 'file', stage: 'edit' });
  await user.click(screen.getByRole('button', { name: 'Edit message settings' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Mode' }), { key: 'Enter' });
  await user.click(screen.getByRole('option', { name: 'spec' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'session.setting.update', sessionId: 'session-1', field: 'interactionMode', value: 'spec' });
  expect(screen.getByRole('textbox')).toBeDefined();
  expect(events.onStageCancel).not.toHaveBeenCalled();
});
