// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION, type HostSnapshotMessage, type HostToWebviewMessage } from '../../shared/bridgeMessages';
import { useComposerFlow } from './composer/useComposerFlow';
import { useSessionActions } from './sessions/useSessionActions';
import { useHostMessageFlow } from '../host/useHostMessageFlow';
import type { ChatPort } from '../host/chatIntent';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewState } from '../state/types';
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

function requests(port: ReturnType<typeof fixture>['port']) {
  return port.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type !== 'webview.state-applied');
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
    getSequence: () => store.getState().state.sequence,
    appendCanvasDraft: composer.appendCanvasDraft, settleSend: composer.settleSend,
  });
  return <>
    <output aria-label="Draft">{composer.draft}</output>
    <output aria-label="Attachments">{state.attachments.map((attachment) => attachment.name).join(', ')}</output>
    {recovery ? <SessionRecovery state={state} blocked={false} onReconnect={sessions.handleRetry} port={port} />
      : <ConversationWait phase="restoring" hasSnapshot handshakeTimedOut connection={state.connection} port={port} sequence={state.sequence} conversationId={state.conversationId} sessionId={state.sessionId} />}
  </>;
}

describe('session connection recovery', () => {
  it('refreshes once until a new snapshot arrives and preserves the unsent draft and attachments', () => {
    const { store, port } = fixture();
    render(<Harness store={store} port={port} />);
    port.postMessage.mockClear();
    const draft = screen.getByLabelText('Draft');
    const attachments = store.getState().state.attachments;
    expect(screen.queryByRole('button', { name: 'Refresh session state' })).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    port.postMessage.mockClear();
    const refresh = screen.getByRole('button', { name: 'Refresh session state' });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    act(() => vi.advanceTimersByTime(1_000));
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION }));
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

  it('ends an unanswered refresh after ten seconds and retries only on another click', () => {
    const { store, port } = fixture({ status: 'unavailable' });
    const state = store.getState().state;
    render(<ConversationWait phase="restoring" hasSnapshot handshakeTimedOut={false} connection={state.connection}
      port={port} sequence={state.sequence} conversationId={state.conversationId} sessionId={state.sessionId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session state' }));
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByRole('button', { name: 'Waiting for session state…' }).hasAttribute('disabled')).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText('No session state received after 10 seconds. You can refresh again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh session state' }).hasAttribute('disabled')).toBe(false);
    act(() => vi.advanceTimersByTime(20_000));
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session state' }));
    expect(screen.queryByText('No session state received after 10 seconds. You can refresh again.')).toBeNull();
    expect(port.postMessage).toHaveBeenCalledTimes(2);
    expect(port.postMessage.mock.calls.every(([message]) => message.type === 'webview.ready')).toBe(true);
    receive(snapshot(state, state.sequence));
    receive({ ...snapshot(state, state.sequence + 1), sessionId: 'another-session', sessions: { status: 'ready', items: [] } });
    expect(screen.getByRole('button', { name: 'Waiting for session state…' }).hasAttribute('disabled')).toBe(true);
    receive(snapshot(state, state.sequence + 2));
    expect(screen.getByText('Latest host state received.')).toBeTruthy();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText('No session state received after 10 seconds. You can refresh again.')).toBeNull();
    expect(port.postMessage).toHaveBeenCalledTimes(2);
  });

  it.each(['sessionId', 'conversationId'] as const)('cancels the old refresh when %s changes', (field) => {
    const { store, port } = fixture({ status: 'unavailable' });
    const state = store.getState().state;
    const view = (identity: Pick<AssistantWebviewState, 'conversationId' | 'sessionId'>) =>
      <ConversationWait phase="restoring" hasSnapshot handshakeTimedOut={false} connection={state.connection}
        port={port} sequence={state.sequence} {...identity} />;
    const { rerender } = render(view(state));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session state' }));
    act(() => vi.advanceTimersByTime(5_000));
    const next = { ...state, [field]: 'new-identity', sessions: { status: 'ready' as const, items: [] } };
    rerender(view(next));
    expect(screen.getByRole('button', { name: 'Refresh session state' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session state' }));
    receive(snapshot(state, state.sequence + 1));
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('button', { name: 'Waiting for session state…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Latest host state received.')).toBeNull();
    receive(snapshot(next, state.sequence + 2));
    expect(screen.getByText('Latest host state received.')).toBeTruthy();
    expect(port.postMessage).toHaveBeenCalledTimes(2);
  });

  it('cancels the refresh timeout and subscription when the view unmounts', () => {
    const { store, port } = fixture({ status: 'unavailable' });
    const state = store.getState().state;
    const { unmount } = render(<ConversationWait phase="restoring" hasSnapshot handshakeTimedOut={false}
      connection={state.connection} port={port} sequence={state.sequence}
      conversationId={state.conversationId} sessionId={state.sessionId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session state' }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    receive(snapshot(state, state.sequence + 1));
    act(() => vi.advanceTimersByTime(10_000));
    expect(port.postMessage).toHaveBeenCalledTimes(1);
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
    expect(requests(port)).toEqual([{ type: 'runtime.retry', sessionId: 'session-a' }]);
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
    expect(requests(port)).toEqual([{ type: 'runtime.retry', sessionId: 'session-a' }]);
    receive({ ...snapshot(store.getState().state, 12), sessions: { status: 'ready', items: [] } });
    expect(screen.getByRole('button', { name: 'Reconnect Droid session' }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['connected', 'unavailable'] as const)('keeps the draft through IDE preparation and restoration, then handles %s', status => {
    const { store, port } = fixture({ status: 'connected' });
    render(<Harness store={store} port={port} recovery />);
    port.postMessage.mockClear();
    const attachments = store.getState().state.attachments;
    receive({ type: 'host.ide', sequence: 11, conversationId: 'conversation-a', sessionId: 'session-a',
      ide: { status: 'reconnecting', canReconnect: false, message: 'Reconnecting this conversation to the IDE…' } });
    expect(screen.getByText('Reconnecting this conversation to the IDE…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.queryByRole('button', { name: 'Refresh session state' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect Droid session' })).toBeNull();
    receive({ ...snapshot(store.getState().state, 12), connection: { status: 'connecting' },
      ide: { status: 'reconnecting', canReconnect: false, message: 'Restoring this conversation on its new IDE connection…' } });
    expect(screen.getByText('Restoring this conversation on its new IDE connection…')).toBeTruthy();
    expect(screen.queryByText('Waiting for the Droid session…')).toBeNull();
    act(() => vi.advanceTimersByTime(40_000));
    expect(screen.getByRole('button', { name: 'Refresh session state' })).toBeTruthy();
    receive({ ...snapshot(store.getState().state, 13), connection: { status },
      ide: status === 'connected' ? { status: 'connected', canReconnect: true, message: 'Connected to IDE.' }
        : { status: 'error', canReconnect: false, message: 'Could not restore the session. Retry to restore it.' } });
    expect(screen.queryByText('Restoring this conversation on its new IDE connection…')).toBeNull();
    if (status === 'unavailable') {
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect Droid session' }));
      expect(requests(port)).toEqual([{ type: 'runtime.retry', sessionId: 'session-a' }]);
    } else expect(requests(port)).toEqual([]);
    expect(screen.getByLabelText('Draft').textContent).toBe('Unsent work');
    expect(store.getState().state.attachments).toBe(attachments);
    expect(port.setState).not.toHaveBeenCalled();
  });
});
