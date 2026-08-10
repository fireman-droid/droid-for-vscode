// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { App } from './App';

let persistedState: unknown = { draft: 'Restored draft' };
const posted: WebviewToHostMessage[] = [];
const vscode = {
  getState: vi.fn(() => persistedState),
  setState: vi.fn((state: unknown) => {
    persistedState = state;
  }),
  postMessage: vi.fn((message: WebviewToHostMessage) => posted.push(message)),
};

beforeAll(() => {
  vi.stubGlobal('acquireVsCodeApi', () => vscode);
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  vi.unstubAllGlobals();
});

function host(message: HostToWebviewMessage): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

function snapshot(
  sequence: number,
  turn: Extract<
    HostToWebviewMessage,
    { type: 'host.snapshot' }
  >['turn'] = null,
): Extract<HostToWebviewMessage, { type: 'host.snapshot' }> {
  return {
    type: 'host.snapshot',
    sequence,
    sessionId: 'session-a',
    connection: { status: 'connected' },
    turn,
    sessions: {
      status: 'ready',
      items: [
        {
          id: 'session-a',
          title: 'Current',
          messageCount: 0,
          modifiedTime: '2026-02-20T10:00:00.000Z',
          active: true,
        },
      ],
    },
    transcript: [],
    historyStatus: 'complete',
    truncated: false,
  };
}

describe('assistant-ui App bridge commands', () => {
  it('restores drafts and posts exact send, stop, retry, and settlements', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(posted[0]).toEqual({
      type: 'webview.ready',
      protocolVersion: 1,
    });
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));

    host(snapshot(0));
    fireEvent.change(input, { target: { value: 'Inspect this file' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() =>
      expect(
        posted.some((message) => message.type === 'turn.send'),
      ).toBe(true),
    );
    const sent = posted.find((message) => message.type === 'turn.send');
    if (sent?.type !== 'turn.send') {
      throw new Error('Expected turn.send');
    }
    expect(sent).toEqual({
      type: 'turn.send',
      sessionId: 'session-a',
      turnId: sent.turnId,
      text: 'Inspect this file',
    });
    expect(persistedState).toEqual({ draft: '' });

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(posted).toContainEqual({
      type: 'turn.stop',
      sessionId: 'session-a',
      turnId: sent.turnId,
    });
    host({
      type: 'turn.error',
      sequence: 1,
      sessionId: 'session-a',
      turnId: sent.turnId,
      code: 'FAILED',
      message: 'Runtime failed',
      retryable: true,
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(posted).toContainEqual({
      type: 'runtime.retry',
      sessionId: 'session-a',
    });

    host(snapshot(2, { turnId: 'turn-b', status: 'streaming' }));
    host({
      type: 'interaction.request',
      sequence: 3,
      sessionId: 'session-a',
      turnId: 'turn-b',
      request: {
        kind: 'permission',
        requestId: 'permission-a',
        tools: [
          {
            toolUseId: 'tool-a',
            toolName: 'Execute',
            confirmationKind: 'exec',
            title: 'Run tests',
          },
        ],
        options: [
          {
            label: 'Allow once',
            value: 'allow-once',
            requiresEditedSpec: false,
          },
        ],
      },
    });
    await user.dblClick(
      screen.getByRole('button', { name: 'Allow once' }),
    );
    expect(
      posted.filter((message) => message.type === 'permission.respond'),
    ).toEqual([
      {
        type: 'permission.respond',
        sessionId: 'session-a',
        turnId: 'turn-b',
        requestId: 'permission-a',
        selectedOption: 'allow-once',
      },
    ]);

    host({
      type: 'interaction.closed',
      sequence: 4,
      sessionId: 'session-a',
      turnId: 'turn-b',
      requestId: 'permission-a',
    });
    host({
      type: 'interaction.request',
      sequence: 5,
      sessionId: 'session-a',
      turnId: 'turn-b',
      request: {
        kind: 'ask-user',
        requestId: 'ask-a',
        toolCallId: 'ask-tool',
        questions: [
          {
            index: 7,
            topic: '',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(posted).toContainEqual({
      type: 'ask-user.respond',
      sessionId: 'session-a',
      turnId: 'turn-b',
      requestId: 'ask-a',
      cancelled: true,
      answers: [],
    });
  });
});
