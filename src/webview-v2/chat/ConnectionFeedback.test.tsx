// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react';
import { useStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION, type HostSnapshotMessage, type HostToWebviewMessage } from '../../shared/bridgeMessages';
import { useComposerFlow } from './composer/useComposerFlow';
import { useSessionActions } from './sessions/useSessionActions';
import { useHostMessageFlow } from '../host/useHostMessageFlow';
import type { ChatPort } from '../host/chatIntent';
import { initialAssistantWebviewState } from '../state/initialState';
import type { AssistantWebviewState } from '../state/types';
import { SessionRecovery } from './ConnectionFeedback';
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
  return port.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type !== 'webview.state-applied' && message.type !== 'ide.refresh');
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
    <SessionRecovery state={state} blocked={!recovery} onReconnect={sessions.handleRetry} port={port} phase={recovery ? 'idle' : 'restoring'} />
  </>;
}

describe('session connection recovery', () => {
  it('refreshes once until a new snapshot arrives and preserves the draft and attachments', () => {
    const { store, port } = fixture();
    render(<Harness store={store} port={port} />);
    const attachments = store.getState().state.attachments;
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    port.postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    const waiting = screen.getByRole('button', { name: 'Reconnecting…' });
    expect(waiting.hasAttribute('disabled')).toBe(true);
    fireEvent.click(waiting);
    expect(requests(port)).toEqual([expect.objectContaining({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION })]);
    receive(snapshot(store.getState().state, 11));
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('Draft').textContent).toBe('Unsent work');
    expect(store.getState().state.attachments).toBe(attachments);
  });

  it('ends an unanswered refresh after ten seconds and retries only on another click', () => {
    const { store, port } = fixture();
    render(<SessionRecovery state={store.getState().state} blocked={false} onReconnect={vi.fn()} port={port} handshakeTimedOut />);
    act(() => vi.advanceTimersByTime(60_000));
    port.postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(false);
    expect(requests(port)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(30_000));
    expect(requests(port)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(requests(port)).toHaveLength(2);
  });

  it.each(['sessionId', 'conversationId'] as const)('cancels the old refresh when %s changes', field => {
    const { store, port } = fixture();
    const state = store.getState().state;
    const view = (identity: typeof state) => <SessionRecovery state={identity} blocked={false} onReconnect={vi.fn()} port={port} handshakeTimedOut />;
    const { rerender } = render(view(state));
    port.postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    act(() => vi.advanceTimersByTime(5_000));
    const next = { ...state, [field]: 'new-identity', sessions: { ...state.sessions, items: state.sessions.items.map(item => ({ ...item, id: field === 'sessionId' ? 'new-identity' : item.id })) } };
    rerender(view(next));
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    receive(snapshot(state, 11));
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
    receive(snapshot(next, 12));
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(false);
    expect(requests(port)).toHaveLength(2);
  });

  it('cancels the refresh timeout and subscription when unmounted', () => {
    const { store, port } = fixture();
    const { unmount } = render(<SessionRecovery state={store.getState().state} blocked={false} onReconnect={vi.fn()} port={port} handshakeTimedOut />);
    port.postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    receive(snapshot(store.getState().state, 11));
    act(() => vi.advanceTimersByTime(10_000));
    expect(requests(port)).toHaveLength(1);
  });

  it.each(['connected', 'unavailable'] as const)('releases reconnect after a %s outcome without resending the previous message', (status) => {
    const { store, port } = fixture({ status: 'unavailable', message: 'Runtime stopped' });
    render(<Harness store={store} port={port} recovery />);
    port.postMessage.mockClear();
    const reconnect = screen.getByRole('button', { name: /^Reconnect/  });
    fireEvent.click(reconnect);
    fireEvent.click(reconnect);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'runtime.retry', sessionId: 'session-a' });
    receive({ type: 'host.connection', sequence: 11, conversationId: 'conversation-a', sessionId: 'session-a', connection: { status: 'connecting' } });
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
    const sessionId = status === 'connected' ? 'session-b' : 'session-a';
    receive({ ...snapshot(store.getState().state, 12), sessionId, connection: { status }, sessions: {
      status: 'ready', items: [{ id: sessionId, title: 'Current session', messageCount: 1, modifiedTime: '2026-09-20T00:00:00.000Z', active: true, isFavorite: false }],
    } });
    expect(screen.queryByRole('button', { name: 'Reconnecting…' })).toBeNull();
    if (status === 'unavailable') expect(screen.getByRole('button', { name: /^Reconnect/  }).hasAttribute('disabled')).toBe(false);
    else expect(screen.queryByRole('button', { name: /^Reconnect/  })).toBeNull();
    expect(store.getState().state.transcript).toEqual([{ id: 'user-a', kind: 'user', text: 'Existing message' }]);
    expect(requests(port)).toEqual([{ type: 'runtime.retry', sessionId: 'session-a' }]);
    expect(port.setState).not.toHaveBeenCalled();
  });

  it('keeps reconnect pending while the host reloads the session catalog', () => {
    const { store, port } = fixture({ status: 'unavailable' });
    render(<Harness store={store} port={port} recovery />);
    port.postMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Reconnect/  }));
    receive({ ...snapshot(store.getState().state, 11), sessions: { status: 'loading', items: [] } });
    const reconnect = screen.getByRole('button', { name: /^Reconnect/  });
    expect(reconnect.hasAttribute('disabled')).toBe(true);
    fireEvent.click(reconnect);
    expect(requests(port)).toEqual([{ type: 'runtime.retry', sessionId: 'session-a' }]);
    receive({ ...snapshot(store.getState().state, 12), sessions: { status: 'ready', items: [] } });
    expect(screen.getByRole('button', { name: /^Reconnect/  }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['connected', 'unavailable'] as const)('keeps the draft through IDE preparation and restoration, then handles %s', status => {
    const { store, port } = fixture({ status: 'connected' });
    render(<Harness store={store} port={port} recovery />);
    port.postMessage.mockClear();
    const attachments = store.getState().state.attachments;
    receive({ type: 'host.ide', sequence: 11, conversationId: 'conversation-a', sessionId: 'session-a',
      ide: { status: 'reconnecting', canReconnect: false, message: 'Reconnecting this conversation to the IDE…' } });
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
    receive({ ...snapshot(store.getState().state, 12), connection: { status: 'connecting' },
      ide: { status: 'reconnecting', canReconnect: false, message: 'Restoring this conversation on its new IDE connection…' } });
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Waiting for the Droid session…')).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(false);
    receive({ ...snapshot(store.getState().state, 13), connection: { status },
      ide: status === 'connected' ? { status: 'connected', canReconnect: true, message: 'Connected to IDE.' }
        : { status: 'error', canReconnect: false, message: 'Could not restore the session. Retry to restore it.' } });
    expect(screen.queryByText('Restoring this conversation on its new IDE connection…')).toBeNull();
    if (status === 'unavailable') {
      fireEvent.click(screen.getByRole('button', { name: /^Reconnect/  }));
      expect(requests(port)).toEqual([{ type: 'runtime.retry', sessionId: 'session-a' }]);
    } else expect(requests(port)).toEqual([]);
    expect(screen.getByLabelText('Draft').textContent).toBe('Unsent work');
    expect(store.getState().state.attachments).toBe(attachments);
    expect(port.setState).not.toHaveBeenCalled();
  });
});


import { TooltipProvider } from '@droidvisx/chat-ui/ui/overlays';
import type { ReactNode } from 'react';
const render = (node: ReactNode) => renderBase(node, { wrapper: TooltipProvider });
