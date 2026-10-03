// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UiEnvironmentProvider } from '@droidvisx/chat-ui/environment';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSnapshotMessage, HostToWebviewMessage, ToolActivityMessage, ToolTranscriptItem } from '../../shared/bridgeMessages';
import { initialAssistantWebviewState } from '../state/initialState';
import { ChatApp } from './ChatApp';
import type { ChatSurfaceRole } from '../../shared/chatSurfacePolicy';
import { AGENT_CHAT_PROTOCOL_VERSION, type AgentChatNavigationMessage } from '../../shared/protocol/agentChatProtocol';
import { TooltipProvider } from '../ui/overlays';

const sessionId = 'session-recovery';
const turnId = 'turn-recovery';
const draft = 'Keep this unsent follow-up';
const answer = 'The terminal check has finished. Here is the explanation.';
const question = { kind: 'user' as const, id: 'question', messageId: 'message-1', text: 'Run checks and explain the result.' };
const command: ToolTranscriptItem = {
  kind: 'tool', id: 'terminal-row', turnId, toolUseId: 'terminal-1', toolName: 'Execute',
  action: 'Run checks', status: 'running', progressCount: 0, latestUpdateKind: null,
  detailKind: 'command', detail: 'pnpm check', outputTail: 'Running checks…',
};
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  // JSDOM has no layout. Give the real virtualizer a viewport and one measured
  // turn, retaining the production ChatApp, message bridge and row rendering.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-label') === 'Chat transcript' ? 640 : this.hasAttribute('data-index') ? 300 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(640);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0; },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

function snapshot(overrides: Partial<HostSnapshotMessage> = {}): HostSnapshotMessage {
  const initial = initialAssistantWebviewState;
  return {
    type: 'host.snapshot', sequence: 1, conversationId: 'conversation-recovery', sessionId,
    connection: { status: 'connected' }, turn: { turnId, status: 'streaming' },
    sessions: { status: 'ready', items: [{ id: sessionId, title: 'Current session', messageCount: 1,
      modifiedTime: '2026-09-21T00:00:00.000Z', active: true, isFavorite: false }] },
    settings: initial.settings, context: initial.context, modelCatalog: initial.modelCatalog,
    transcript: [question], historyStatus: 'complete', truncated: false, interactions: [],
    ide: { status: 'connected', canReconnect: true, message: 'Native IDE tools are connected.' },
    ...overrides,
  };
}

function tool(sequence: number, status: ToolActivityMessage['status']): ToolActivityMessage {
  const { id: _id, kind: _kind, ...fields } = command;
  return { ...fields, type: 'tool.activity', sequence, sessionId, status,
    ...(status === 'failed' ? { errorMessage: 'The command exited with code 1.' } : {}),
  };
}

function receive(message: HostToWebviewMessage | AgentChatNavigationMessage) {
  act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
}

function mountChat(role: ChatSurfaceRole = 'main') {
  const port = { postMessage: vi.fn(), getState: () => ({ draft }), setState: vi.fn() };
  render(<UiEnvironmentProvider value={{ assistantName: 'Droid', copyText: async () => undefined }}>
    <TooltipProvider><ChatApp port={port} role={role} /></TooltipProvider>
  </UiEnvironmentProvider>);
  return port;
}

describe('ChatApp transcript delivery recovery', () => {
  it('keeps a connected child chat usable without exposing parent actions when navigation is absent or removed', async () => {
    const port = mountChat('child');
    receive(snapshot({ turn: { turnId, status: 'completed' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();

    receive({ type: 'agent.chat.navigation', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION,
      parentSessionId: 'parent-session', currentKey: 'child-key',
      agents: [{ key: 'child-key', title: 'Child work', role: 'worker', status: 'completed' }],
    });
    receive({ type: 'agent.chat.navigation', protocolVersion: AGENT_CHAT_PROTOCOL_VERSION,
      parentSessionId: 'parent-session', currentKey: null, agents: [],
    });
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();
    const editor = screen.getByRole('textbox', { name: 'Message Droid' });
    port.postMessage.mockClear();
    for (const command of ['/new', '/compact', '/sessions']) {
      fireEvent.change(editor, { target: { value: command } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('Return to the main chat to switch sessions, start a new task, or compact the conversation.');
    }
    expect(port.postMessage.mock.calls.some(([message]) =>
      ['session.new', 'session.compact', 'session.select', 'turn.send'].includes(message.type))).toBe(false);

    fireEvent.change(editor, { target: { value: 'Continue the child task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({
      type: 'turn.send', sessionId, turnId: expect.any(String), text: 'Continue the child task',
    }));
    const sent = port.postMessage.mock.calls.map(([message]) => message).find((message) => message.type === 'turn.send');
    receive({ type: 'turn.state', sequence: 2, sessionId, turnId: sent.turnId, status: 'streaming' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'turn.stop', sessionId, turnId: sent.turnId });
  });

  it.each(['completed', 'failed'] as const)('renders follow-up prose after a %s terminal tool', async (status) => {
    mountChat();
    receive(snapshot());
    await screen.findByText(question.text);
    receive(tool(2, 'running'));
    await screen.findByRole('button', { name: /Run checks/ });
    receive(tool(3, status));
    receive({ type: 'assistant.delta', sequence: 4, sessionId, turnId, delta: answer });
    await waitFor(() => expect(screen.getAllByText(answer)).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    receive({ type: 'turn.state', sequence: 5, sessionId, turnId, status: 'completed' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(screen.getAllByText(answer)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Run checks/ })).toHaveLength(1);
    expect((screen.getByRole('textbox', { name: 'Message Droid' }) as HTMLTextAreaElement).value).toBe(draft);
  });

  it('recovers missed prose from an authoritative snapshot without duplicating the reply or command', async () => {
    mountChat();
    receive(snapshot());
    await screen.findByText(question.text);
    receive(tool(2, 'running'));
    await screen.findByRole('button', { name: /Run checks/ });
    receive(tool(3, 'completed'));
    // The assistant delta at sequence 4 never reached this page.
    receive({ type: 'turn.state', sequence: 5, sessionId, turnId, status: 'completed' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(screen.queryByText(answer)).toBeNull();
    const recovered = snapshot({ sequence: 6, turn: { turnId, status: 'completed' }, transcript: [
      question, { ...command, status: 'completed' }, { kind: 'assistant', id: 'recovered-answer', turnId, text: answer },
    ] });
    receive(recovered);
    await waitFor(() => expect(screen.getAllByText(answer)).toHaveLength(1));
    receive({ ...recovered, sequence: 7 });
    receive({ type: 'assistant.delta', sequence: 4, sessionId, turnId, delta: answer });
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    await waitFor(() => expect(screen.getAllByText(answer)).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: /Run checks/ })).toHaveLength(1);
    expect((screen.getByRole('textbox', { name: 'Message Droid' }) as HTMLTextAreaElement).value).toBe(draft);
  });

  it('restores a pending question from a snapshot alone and answers its original request once', async () => {
    const user = userEvent.setup();
    const port = mountChat();
    const waiting = snapshot({ transcript: [question, { ...command, status: 'completed' }], interactions: [{
      sessionId, turnId, request: { kind: 'ask-user', requestId: 'scope-question', toolCallId: 'ask-1',
        questions: [{ index: 0, topic: 'Scope', question: 'Which scope should I check next?',
          options: ['Current file', 'All files'], multiSelect: false }],
      },
    }] });
    receive(waiting);
    await screen.findByText('Which scope should I check next?');
    receive({ ...waiting, sequence: 2 });
    await user.click(screen.getByRole('radio', { name: 'Current file' }));
    expect(screen.getAllByText('Which scope should I check next?')).toHaveLength(1);
    await user.dblClick(screen.getByRole('button', { name: 'Submit answers' }));
    expect(port.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === 'ask-user.respond')).toEqual([{
      type: 'ask-user.respond', sessionId, turnId, requestId: 'scope-question', cancelled: false,
      answers: [{ index: 0, answer: 'Current file' }],
    }]);
  });
});
