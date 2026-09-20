// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UiEnvironmentProvider } from '@droidvisx/chat-ui/environment';
import { afterEach, expect, it, vi } from 'vitest';
import type { HostSnapshotMessage, HostToWebviewMessage } from '../../shared/bridgeMessages';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';
import { ChatApp } from './ChatApp';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function receive(message: HostToWebviewMessage) {
  act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
}

it('blocks session mutations during IDE preparation while retaining a sendable draft after recovery', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const port = { postMessage: vi.fn(), getState: () => ({ draft: 'Continue with my changes' }), setState: vi.fn() };
  render(<UiEnvironmentProvider value={{ assistantName: 'Droid', copyText: async () => undefined }}>
    <ChatApp port={port} />
  </UiEnvironmentProvider>);
  const initial = initialAssistantWebviewState;
  const snapshot: HostSnapshotMessage = {
    type: 'host.snapshot', sequence: 1, conversationId: 'conversation-a', sessionId: 'session-a',
    connection: { status: 'connected' }, turn: { turnId: 'prior-turn', status: 'interrupted' },
    sessions: { status: 'ready', items: [{ id: 'session-a', title: 'Current session', messageCount: 1,
      modifiedTime: '2026-09-20T00:00:00.000Z', active: true, isFavorite: false }] },
    settings: initial.settings, context: initial.context, modelCatalog: initial.modelCatalog,
    transcript: [], historyStatus: 'complete', truncated: false,
    ide: { status: 'reconnect-required', canReconnect: true, message: 'Reconnect this conversation to IDE.' },
  };
  receive(snapshot);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false));
  const send = screen.getByRole('button', { name: 'Send' });
  expect(screen.getByText('Stopped')).toBeTruthy();
  port.postMessage.mockClear();
  receive({ type: 'host.ide', sequence: 2, conversationId: 'conversation-a', sessionId: 'session-a',
    ide: { status: 'reconnecting', canReconnect: false, message: 'Reconnecting this conversation to the IDE…' } });
  await waitFor(() => expect(send.hasAttribute('disabled')).toBe(true));
  expect(screen.queryByText('Stopped')).toBeNull();
  expect(screen.getByText('Reconnecting this conversation to the IDE…')).toBeTruthy();
  const draft = screen.getByRole('textbox', { name: 'Message Droid' }) as HTMLTextAreaElement;
  fireEvent.keyDown(draft, { key: 'Enter' });
  fireEvent.click(send);
  const newChat = screen.getByRole('button', { name: 'New session' });
  expect(newChat.hasAttribute('disabled')).toBe(true);
  fireEvent.click(newChat);
  expect(port.postMessage.mock.calls.some(([message]) => ['turn.send', 'session.new', 'queue.add'].includes(message.type))).toBe(false);
  expect(draft.value).toBe('Continue with my changes');
  receive({ ...snapshot, sequence: 3, ide: { status: 'connected', canReconnect: true, message: 'Native IDE tools are connected.' } });
  await waitFor(() => expect(send.hasAttribute('disabled')).toBe(false));
  expect(draft.value).toBe('Continue with my changes');
  fireEvent.click(send);
  await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({
    type: 'turn.send', sessionId: 'session-a', turnId: expect.any(String), text: 'Continue with my changes',
  }));
});
