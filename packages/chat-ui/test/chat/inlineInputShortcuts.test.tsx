// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { UiEnvironmentProvider, type UiEnvironment } from '../../src/environment';
import { ComposerView } from '../../src/chat/ComposerView';
import { SideChatSheet } from '../../src/chat/SideChatSheet';
import { InlineQuestion } from '../../src/review/InlineQuestion';
import { useCodeReferenceDraft } from '../../src/chat/useCodeReferenceDraft';
import { formatCodeReferences } from '../../src/chat/codeReferences';

afterEach(cleanup);
const ref = { path: 'app.ts', startLine: 1, endLine: 1, text: 'const n = 1;' };
const snapshot = formatCodeReferences([ref], '');
const environment: UiEnvironment = { assistantName: 'Droid', copyText: async () => undefined };

type Surface = 'main' | 'diff' | 'btw';
function Conversation({ surface, send, close }: { surface: Surface; send(): void; close(): void }) {
  const [value, setValue] = useState(snapshot + ' explain');
  const draft = useCodeReferenceDraft(value, setValue, 4000);
  if (surface === 'main') return <ComposerView value={draft.body} codeDraft={draft} onChange={draft.change} onSend={send}
    onKeyDown={event => { if (event.key === 'Escape') close(); }} />;
  if (surface === 'diff') return <InlineQuestion entries={[]} draft={value} onDraft={setValue} busy={false} disabled={false} message={null}
    onSend={send} onStop={vi.fn()} onClose={close} maxLength={4000} focusRequested={false} onFocused={vi.fn()} />;
  return <SideChatSheet state={{ status: 'ready', entries: [], message: null, pendingQuestion: null }} draft={value} onDraftChange={setValue}
    width={400} maxTextLength={4000} onQuoteClear={vi.fn()} onWidthChange={vi.fn()} onDismiss={close} onAsk={send} onStop={vi.fn()} />;
}

it.each<Surface>(['main', 'diff', 'btw'])('opens a focused reference on Enter without sending from %s', async surface => {
  const user = userEvent.setup(), send = vi.fn(), openCodeReference = vi.fn();
  render(<UiEnvironmentProvider value={{ ...environment, openCodeReference }}><Conversation surface={surface} send={send} close={vi.fn()} /></UiEnvironmentProvider>);
  screen.getByRole('button', { name: 'Open app.ts (1)' }).focus();
  await user.keyboard('{Enter}');
  expect(send).not.toHaveBeenCalled();
  expect(openCodeReference).toHaveBeenCalledExactlyOnceWith(ref);
});

it.each<Surface>(['main', 'diff', 'btw'])('keeps IME confirmation and Escape away from %s shortcuts', surface => {
  const send = vi.fn(), close = vi.fn();
  render(<UiEnvironmentProvider value={environment}><Conversation surface={surface} send={send} close={close} /></UiEnvironmentProvider>);
  const input = screen.getByRole('textbox'); input.focus();
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: false });
  fireEvent.compositionStart(input);
  // Some confirmation events no longer carry isComposing. The local IME
  // lifecycle must still protect shortcuts until compositionEnd arrives.
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(send).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(send).toHaveBeenCalledOnce();
});
