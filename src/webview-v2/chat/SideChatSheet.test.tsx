// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { EMPTY_SESSION_BTW_STATE, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import { SideChatSheet } from './SideChatSheet';

afterEach(cleanup);
it('sends quoted side questions without touching main chat and preserves IME input', async () => {
  const user = userEvent.setup();
  const ask = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState('');
    const [quote, setQuote] = useState<string | null>('Selected context');
    return <SideChatSheet state={{ ...EMPTY_SESSION_BTW_STATE, status: 'ready' }} draft={draft} quote={quote} width={320}
      onDraftChange={setDraft} onQuoteClear={() => setQuote(null)} onAsk={ask} onStop={vi.fn()} onDismiss={vi.fn()} onWidthChange={vi.fn()} />;
  }
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: 'By the Way question' });
  await user.click(screen.getByRole('button', { name: 'Quoted context' }));
  expect(screen.getByRole('button', { name: 'Quoted context' }).getAttribute('aria-expanded')).toBe('true');
  await user.type(input, 'Explain this part');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect(ask).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(ask).toHaveBeenCalledExactlyOnceWith('> Selected context\n\nExplain this part');
  expect((input as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('button', { name: 'Remove quoted context' })).toBeNull();
});

it('keeps drafting available while a follow-up is queued and preserves stop and resize actions', async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn(), onStop = vi.fn(), onDismiss = vi.fn(), onWidthChange = vi.fn();
  const state: SessionBtwState = { ...EMPTY_SESSION_BTW_STATE, status: 'ready', pendingQuestion: 'Queued follow-up',
    entries: [{ id: 'side-1', question: 'Question', answer: '', state: 'streaming', message: null }] };
  function Harness({ state }: { state: SessionBtwState }) {
    const [draft, setDraft] = useState('');
    return <SideChatSheet state={state} draft={draft} quote={null} width={320} onDraftChange={setDraft} onQuoteClear={vi.fn()}
      onAsk={onAsk} onStop={onStop} onDismiss={onDismiss} onWidthChange={onWidthChange} />;
  }
  const view = render(<Harness state={state} />);
  expect(screen.getByTitle('Queued follow-up')).toBeDefined();
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(input.disabled).toBe(false);
  await user.type(input, 'Keep this next question{Enter}');
  expect(input.value).toBe('Keep this next question');
  expect(onAsk).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Send side question' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Stop side answer' }));
  expect(onStop).toHaveBeenCalledOnce();
  view.rerender(<Harness state={{ ...state, pendingQuestion: null }} />);
  await user.click(screen.getByRole('button', { name: 'Send side question' }));
  expect(onAsk).toHaveBeenCalledExactlyOnceWith('Keep this next question');
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
  expect(onWidthChange).toHaveBeenCalledWith(336);
  await user.keyboard('{Escape}');
  expect(onDismiss).toHaveBeenCalledOnce();
});

it('does not dismiss BTW when Escape belongs to the main chat or an IME composition', async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  render(<textarea aria-label="Main chat draft" />);
  const mainInput = screen.getByRole('textbox', { name: 'Main chat draft' });
  mainInput.focus();
  const view = render(<SideChatSheet state={EMPTY_SESSION_BTW_STATE} draft="" quote={null} width={320}
    onDraftChange={vi.fn()} onQuoteClear={vi.fn()} onAsk={vi.fn()} onStop={vi.fn()} onDismiss={onDismiss} onWidthChange={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: 'By the Way question' });
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  mainInput.focus();
  await user.keyboard('{Escape}');
  expect(onDismiss).not.toHaveBeenCalled();
  input.focus();
  await user.keyboard('{Escape}');
  expect(onDismiss).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(mainInput);
});
