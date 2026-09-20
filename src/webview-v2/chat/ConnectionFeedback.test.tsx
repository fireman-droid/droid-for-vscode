// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION, type HostSnapshotMessage, type HostToWebviewMessage } from '../../shared/bridgeMessages';
import { useComposerFlow } from '../../webview/assistant/composer/useComposerFlow';
import { useSessionActions } from '../../webview/assistant/sessions/useSessionActions';
import { useHostMessageFlow } from '../../webview/assistant/shell/useHostMessageFlow';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import { initialAssistantWebviewState } from '../../webview/assistant/state/initialState';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import { ConversationWait, SessionRecovery } from './ConnectionFeedback';
import { createChatStore, type ChatStore } from './store';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(connection: AssistantWebviewState['connection'] = { status: 'connecting' }) {
  const state: AssistantWebviewState = {
    ...initialAssistantWebviewState, sequence: 10, sessionId: 'session-a', conversationId: 'conversation-a', connection,
    sessions: { status: 'ready', items: [{ id: 'session-a', title: 'Current session', messageCount: 1, modifiedTime: '2026-09-20T00:00:00.000Z', active: true, isFavorite: false }] },
    historyStatus: 'complete',
    attachments: [{ id: 'attachment-a', kind: 'text', name: 'notes.md', sizeBytes: 12, truncated: false }],
    transcript: [{ id: 'user-a', kind: 'user', text: 'Existing message' }],
  };
  const port = { getState: vi.fn(() => ({ draft: 'Unsent work' })), setState: vi.fn(), postMessage: vi.fn() };
  return { store: createChatStore(state), port };
}

function snapshot(state: AssistantWebviewState, sequence: number): HostSnapshotMessage {
  return {
    type: 'host.snapshot', sequence, conversationId: state.conversationId, sessionId: state.sessionId,
    connection: state.connection, turn: state.turn, sessions: state.sessions, settings: state.settings,
    context: state.context, modelCatalog: state.modelCatalog, transcript: state.transcript,
    historyStatus: state.historyStatus ?? 'complete', truncated: state.truncated,
  };
}

function receive(message: HostToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
    vi.advanceTimersByTime(50);
  });
}

function Harness({ store, port, recovery = false }: { store: ChatStore; port: ChatPort; recovery?: boolean }) {
  const { state, dispatch } = useStore(store);
  const composer = useComposerFlow(port, state, dispatch, {
    blocked: !recovery, compact: () => {}, navigate: () => {}, openBtw: () => {}, askBtw: () => {},
  });
  const sessions = useSessionActions({
    vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status, transcript: state.transcript,
    conversationTransitionBlocking: !recovery, beginConversationSwitch: () => {},
  });
  useHostMessageFlow(port, state, {
    dispatch, observeTransitionMessage: () => {}, applyHostTheme: () => {},
    appendCanvasDraft: composer.appendCanvasDraft, settleSend: composer.settleSend,
  });
  return <>
    <output aria-label="Draft">{composer.draft}</output>
    <output aria-label="Attachments">{state.attachments.map((attachment) => attachment.name).join(', ')}</output>
    {recovery ? <SessionRecovery state={state} blocked={false} onReconnect={sessions.handleRetry} port={port} />
      : <ConversationWait phase="restoring" hasSnapshot handshakeTimedOut connection={state.connection} port={port} sequence={state.sequence} />}
  </>;
}

describe('session connection recovery', () => {
  it('refreshes once until a new snapshot arrives and preserves the unsent draft and attachments', () => {
    const { store, port } = fixture();
    render(<Harness store={store} port={port} />);
    port.postMessage.mockClear();
    const draft = screen.getByLabelText('Draft');
    const attachments = store.getState().state.attachments;
    const refresh = screen.getByRole('button', { name: 'Refresh session state' });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    act(() => vi.advanceTimersByTime(60_000));
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION });
    expect(refresh.hasAttribute('disabled')).toBe(true);
    receive(snapshot(store.getState().state, 11));
    expect(screen.getByRole('button', { name: 'Refresh session state' }).hasAttribute('disabled')).toBe(false);
    expect(store.getState().state.connection.status).toBe('connecting');
    expect(screen.getByLabelText('Draft')).toBe(draft);
    expect(draft.textContent).toBe('Unsent work');
    expect(store.getState().state.attachments).toBe(attachments);
    expect(screen.getByLabelText('Attachments').textContent).toBe('notes.md');
    expect(port.setState).not.toHaveBeenCalled();
  });

  it.each(['connected', 'unavailable'] as const)('releases reconnect after a %s outcome without resending the previous message', (status) => {
    const { store, port } = fixture({ status: 'unavailable', message: 'Runtime stopped' });
    render(<Harness store={store} port={port} recovery />);
    port.postMessage.mockClear();
    const reconnect = screen.getByRole('button', { name: 'Reconnect Droid session' });
    fireEvent.click(reconnect);
    fireEvent.click(reconnect);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'runtime.retry', sessionId: 'session-a' });
    receive({ type: 'host.connection', sequence: 11, conversationId: 'conversation-a', sessionId: 'session-a', connection: { status: 'connecting' } });
    expect(screen.getByText('Waiting for the Droid session…')).toBeTruthy();
    const sessionId = status === 'connected' ? 'session-b' : 'session-a';
    receive({ ...snapshot(store.getState().state, 12), sessionId, connection: { status }, sessions: {
      status: 'ready', items: [{ id: sessionId, title: 'Current session', messageCount: 1, modifiedTime: '2026-09-20T00:00:00.000Z', active: true, isFavorite: false }],
    } });
    expect(screen.queryByText('Waiting for the Droid session…')).toBeNull();
    if (status === 'unavailable') expect(screen.getByRole('button', { name: 'Reconnect Droid session' }).hasAttribute('disabled')).toBe(false);
    else expect(screen.queryByRole('button', { name: 'Reconnect Droid session' })).toBeNull();
    expect(store.getState().state.transcript).toEqual([{ id: 'user-a', kind: 'user', text: 'Existing message' }]);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.setState).not.toHaveBeenCalled();
  });

  it('keeps reconnect pending while the host reloads the session catalog', () => {
    const { store, port } = fixture({ status: 'unavailable' });
    render(<Harness store={store} port={port} recovery />);
    port.postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Droid session' }));
    receive({ ...snapshot(store.getState().state, 11), sessions: { status: 'loading', items: [] } });
    const reconnect = screen.getByRole('button', { name: 'Reconnect Droid session' });
    expect(reconnect.hasAttribute('disabled')).toBe(true);
    fireEvent.click(reconnect);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    receive({ ...snapshot(store.getState().state, 12), sessions: { status: 'ready', items: [] } });
    expect(screen.getByRole('button', { name: 'Reconnect Droid session' }).hasAttribute('disabled')).toBe(false);
  });
});
