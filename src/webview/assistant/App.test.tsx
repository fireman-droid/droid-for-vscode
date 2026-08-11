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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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

beforeEach(() => {
  persistedState = { draft: 'Restored draft' };
  posted.length = 0;
  vscode.getState.mockClear();
  vscode.setState.mockClear();
  vscode.postMessage.mockClear();
});

afterEach(cleanup);

afterAll(() => {
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
    settings: {
      status: 'ready',
      value: {
        interactionMode: 'auto',
        modelId: 'factory/gpt-5.6-sol',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
      },
    },
    context: {
      status: 'ready',
      value: {
        used: 20_000,
        remaining: 180_000,
        limit: 200_000,
        accuracy: 'exact',
      },
    },
    modelCatalog: {
      status: 'unsupported',
      items: [],
      message: 'Model discovery is unavailable.',
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
    // Boot beacons precede the handshake; the ready message must still
    // be posted exactly once.
    expect(posted).toContainEqual({
      type: 'webview.ready',
      protocolVersion: 2,
    });
    expect(posted).toContainEqual({
      type: 'webview.diagnostic',
      kind: 'boot-ok',
      detail: expect.stringMatching(/^build dev bootMs \d+$/),
    });
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));

    host(snapshot(0));
    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Mode').closest('button')!);
    await user.click(screen.getByRole('radio', { name: /Spec/ }));
    expect(posted).toContainEqual({
      type: 'session.setting.update',
      sessionId: 'session-a',
      field: 'interactionMode',
      value: 'spec',
    });
    await user.click(screen.getByLabelText(/Context used/));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(posted).toContainEqual({
      type: 'session.context.refresh',
      sessionId: 'session-a',
    });

    fireEvent.change(input, { target: { value: 'Inspect this file' } });
    fireEvent.keyDown(input, {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
    });
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toHaveLength(0);
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
    expect(
      screen.getByText(
        'Droid is active · Stop before sending another message',
      ),
    ).toBeDefined();
    expect(screen.getByText('Droid is responding')).toBeDefined();

    fireEvent.change(input, { target: { value: 'Queue this' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toHaveLength(1);

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
    // Host messages flush on the next animation frame, so the Retry
    // button appears asynchronously.
    await user.click(
      await screen.findByRole('button', { name: 'Retry' }),
    );
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
      await screen.findByRole('button', { name: 'Allow once' }),
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
    await user.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(posted).toContainEqual({
      type: 'ask-user.respond',
      sessionId: 'session-a',
      turnId: 'turn-b',
      requestId: 'ask-a',
      cancelled: true,
      answers: [],
    });
  });

  it('keeps Thinking synchronized and allows setting changes while streaming', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: 'webview.ready',
        protocolVersion: 2,
      }),
    );
    host({
      ...snapshot(0, { turnId: 'turn-2', status: 'streaming' }),
      modelCatalog: {
        status: 'ready',
        items: [
          {
            id: 'factory/gpt-5.6-sol',
            displayName: 'Sol',
            supportedReasoningEfforts: ['high'],
          },
          {
            id: 'factory/model-next',
            displayName: 'Next',
            supportedReasoningEfforts: ['medium'],
          },
        ],
      },
      transcript: [
        {
          id: 'thinking-1',
          kind: 'thinking',
          turnId: 'turn-1',
          text: 'First thought',
          status: 'complete',
          truncated: false,
        },
        {
          id: 'assistant-1',
          kind: 'assistant',
          turnId: 'turn-1',
          text: 'First answer',
        },
        {
          id: 'thinking-2',
          kind: 'thinking',
          turnId: 'turn-2',
          text: 'Second thought',
          status: 'active',
          truncated: false,
        },
      ],
    });

    // Completed rows read as past tense; only running rows still say
    // "Thinking" (with the shimmer treatment).
    const completedLabel = await screen.findByText('Thought');
    const runningLabel = await screen.findByText('Thinking');
    expect(runningLabel.classList.contains('dvx-shimmer-text')).toBe(
      true,
    );
    const thinkingLabels = [completedLabel, runningLabel];
    const thinkingRows = thinkingLabels.map((label) =>
      label.closest('details'),
    );
    expect(thinkingRows).toHaveLength(2);
    expect(thinkingRows.every((row) => row?.open === false)).toBe(true);

    // Expansion is per row: toggling one Thinking row must not open the
    // others, which stalled long transcripts when it expanded them all.
    await user.click(thinkingLabels[0]!.closest('summary')!);
    await waitFor(() => expect(thinkingRows[0]?.open).toBe(true));
    expect(thinkingRows[1]?.open).toBe(false);
    await user.click(thinkingLabels[0]!.closest('summary')!);
    await waitFor(() => expect(thinkingRows[0]?.open).toBe(false));
    expect(thinkingRows[1]?.open).toBe(false);

    const sessionControls = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Session controls',
    });
    const context = screen.getByRole<HTMLButtonElement>('button', {
      name: /Context used/,
    });
    const model = screen.getByRole<HTMLButtonElement>('button', {
      name: /Model:/,
    });
    expect(sessionControls.disabled).toBe(false);
    expect(context.disabled).toBe(false);
    expect(model.disabled).toBe(false);

    await user.click(sessionControls);
    await user.click(screen.getByText('Mode').closest('button')!);
    expect(
      screen
        .getAllByRole<HTMLButtonElement>('radio')
        .every((option) => option.disabled),
    ).toBe(false);
    await user.click(screen.getByRole('radio', { name: /Spec/ }));
    expect(posted).toContainEqual({
      type: 'session.setting.update',
      sessionId: 'session-a',
      field: 'interactionMode',
      value: 'spec',
    });

    await user.click(sessionControls);
    await user.click(model);
    await user.click(
      screen.getByRole('button', {
        name: 'Next, factory/model-next',
      }),
    );
    expect(posted).toContainEqual({
      type: 'session.setting.update',
      sessionId: 'session-a',
      field: 'modelId',
      value: 'factory/model-next',
    });
  });

  it('shows semantic tool activity and supports Copy and draft-only Reuse', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid').value,
      ).toBe('Restored draft'),
    );
    host({
      ...snapshot(0),
      transcript: [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Inspect the active file',
        },
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'private-tool-call-id',
          toolName: 'Read',
          action: 'Read workspace files',
          status: 'completed',
          progressCount: 2,
          latestUpdateKind: 'tool-result',
        },
        {
          id: 'tool-2',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'private-ask-user-id',
          toolName: 'AskUser',
          action: 'Requested your input',
          status: 'failed',
          progressCount: 0,
          latestUpdateKind: null,
        },
      ],
    });

    expect(await screen.findByText('Read workspace files')).toBeDefined();
    expect(screen.queryByText('private-tool-call-id')).toBeNull();
    expect(
      screen.getByText('2 progress updates · Latest: tool result'),
    ).toBeDefined();
    expect(screen.getByText('Lifecycle: Failed')).toBeDefined();
    expect(screen.queryByText('No progress updates reported')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Copy message' }),
    );
    expect(await navigator.clipboard.readText()).toBe(
      'Inspect the active file',
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Reuse message in Composer',
      }),
    );
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() =>
      expect(input.value).toBe('Inspect the active file'),
    );
    expect(persistedState).toEqual({ draft: 'Inspect the active file' });
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toEqual([]);

    fireEvent.change(input, { target: { value: 'Different draft' } });
    await user.dblClick(screen.getByText('Inspect the active file'));
    await waitFor(() =>
      expect(input.value).toBe('Inspect the active file'),
    );
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toEqual([]);
  });
});
