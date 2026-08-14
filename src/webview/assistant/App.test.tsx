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

import {
  BRIDGE_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { App } from './App';
import {
  LIVE_THINKING_SMOOTH_OPTIONS,
  THINKING_RENDER_CHUNK_SIZE,
  THINKING_WAITING_AFTER_MS,
} from './thread/transcriptRows';

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
        specModeModelId: null,
        specModeReasoningEffort: null,
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
  it('prepares /btw when the side pane opens before any question', async () => {
    render(<App />);
    host({ ...snapshot(0), btwAvailable: true });
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));

    fireEvent.change(input, { target: { value: '/btw' } });
    await waitFor(() => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        screen.getByRole('complementary', { name: 'Side question' }),
      ).toBeDefined();
    });
    await waitFor(() => {
      expect(
        posted.filter((message) => message.type === 'btw.prepare'),
      ).toEqual([{ type: 'btw.prepare', sessionId: 'session-a' }]);
    });
    expect(
      posted.filter((message) => message.type === 'btw.ask'),
    ).toHaveLength(0);
  });

  it('routes /compact through the compaction RPC, not turn.send', async () => {
    render(<App />);
    host(snapshot(0));
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));

    fireEvent.change(input, { target: { value: '/compact' } });
    // The first Enter can be swallowed while the composer runtime
    // settles in jsdom, so keep pressing until the RPC goes out; the
    // pending latch must still collapse the repeats into one request.
    await waitFor(() => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        posted.some((message) => message.type === 'session.compact'),
      ).toBe(true);
    });
    expect(
      posted.filter((message) => message.type === 'session.compact'),
    ).toEqual([{ type: 'session.compact', sessionId: 'session-a' }]);
    // The command must not leak to Droid as prompt text: that path
    // acknowledges compaction without adopting the continuation
    // session or refreshing context stats.
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toHaveLength(0);
    expect(persistedState).toEqual({ draft: '' });
  });

  it('restores drafts and posts exact send, stop, retry, and settlements', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Boot beacons precede the handshake; the ready message must still
    // be posted exactly once.
    expect(posted).toContainEqual({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
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
        'Droid is active · Enter queues for after this turn',
      ),
    ).toBeDefined();
    expect(screen.getByText('Droid is responding')).toBeDefined();

    // Sending during the running turn queues instead of a second send.
    fireEvent.change(input, { target: { value: 'Queue this' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() =>
      expect(
        posted.some((message) => message.type === 'queue.add'),
      ).toBe(true),
    );
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toHaveLength(1);
    const queued = posted.find((message) => message.type === 'queue.add');
    if (queued?.type !== 'queue.add') {
      throw new Error('Expected queue.add');
    }
    expect(queued).toEqual({
      type: 'queue.add',
      sessionId: 'session-a',
      queueId: queued.queueId,
      text: 'Queue this',
    });
    await waitFor(() =>
      expect(screen.getByText('Queue this')).toBeDefined(),
    );

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

  it('shows subagent activity without exposing cancellation controls', async () => {
    const user = userEvent.setup();
    const taskRow = (toolUseId: string) => ({
      id: `tool:turn-live:${toolUseId}`,
      kind: 'tool' as const,
      turnId: 'turn-live',
      toolUseId,
      toolName: 'Task',
      action: 'Delegated focused work',
      status: 'running' as const,
      progressCount: 0,
      latestUpdateKind: null,
      subagent: {
        type: 'worker',
        description: `Work ${toolUseId}`,
        status: 'running' as const,
      },
    });
    render(<App />);
    host({
      ...snapshot(0, { turnId: 'turn-live', status: 'streaming' }),
      transcript: [taskRow('task-1'), taskRow('task-2')],
    });

    await user.click(
      await screen.findByRole('button', { name: '2 subagents working' }),
    );
    host({
      type: 'subagent.activity',
      sequence: 1,
      sessionId: 'session-a',
      turnId: 'turn-live',
      toolUseId: 'task-1',
      action: 'Read',
      stoppable: true,
    });
    host({
      type: 'subagent.activity',
      sequence: 2,
      sessionId: 'session-a',
      turnId: 'turn-live',
      toolUseId: 'task-2',
      action: 'Grep',
      stoppable: true,
    });
    expect(
      posted.filter((message) => message.type === 'subagent.stop'),
    ).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Stop All' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Stop this .* subagent/ }),
    ).toBeNull();
    expect(screen.getByText('Read')).toBeDefined();
    expect(screen.getByText('Grep')).toBeDefined();
    // Parent cancellation remains an independent Composer control.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined();
  });

  it('closes a subagent transcript before selecting another session', async () => {
    render(<App />);
    host({
      ...snapshot(0),
      sessions: {
        status: 'ready',
        items: [
          {
            id: 'session-a',
            title: 'Current',
            messageCount: 1,
            modifiedTime: '2026-08-15T00:00:00.000Z',
            active: true,
          },
          {
            id: 'session-b',
            title: 'Previous',
            messageCount: 2,
            modifiedTime: '2026-08-14T00:00:00.000Z',
            active: false,
          },
        ],
      },
      transcript: [
        {
          id: 'tool:turn-1:task-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'task-1',
          toolName: 'Task',
          action: 'Delegated focused work',
          status: 'completed',
          progressCount: 0,
          latestUpdateKind: null,
          subagent: {
            type: 'worker',
            description: 'Inspect the flow',
            status: 'completed',
          },
        },
      ],
    });

    fireEvent.click(await screen.findByText('View transcript'));
    expect(
      screen.getByRole('complementary', { name: 'Subagent transcript' }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(screen.getByRole('button', { name: /^Previous/ }));

    expect(
      screen.queryByRole('complementary', {
        name: 'Subagent transcript',
      }),
    ).toBeNull();
    expect(posted).toContainEqual({
      type: 'session.select',
      sessionId: 'session-b',
    });
  });

  it('edits a queued prompt through the Composer and replaces it in place', async () => {
    render(<App />);
    host(snapshot(0));
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));
    host({
      type: 'queue.state',
      sequence: 1,
      sessionId: 'session-a',
      items: [
        { queueId: 'queue-1', text: 'First follow-up', attachments: [] },
        { queueId: 'queue-2', text: 'Second follow-up', attachments: [] },
      ],
      paused: null,
    });

    // Expand the queue bar and load the second prompt into the
    // Composer ("Edit Queued" mode).
    fireEvent.click(
      await screen.findByRole('button', { name: /^2 queued messages/ }),
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Edit queued message' })[1]!,
    );
    await waitFor(() => expect(input.value).toBe('Second follow-up'));
    expect(screen.getByText('Edit Queued')).toBeDefined();
    expect(screen.getByText('Editing')).toBeDefined();
    expect(
      screen.getByText('Editing a queued message · Enter saves · Esc cancels'),
    ).toBeDefined();
    // The edited row's action triad is replaced by the Editing tag.
    expect(
      screen.getAllByRole('button', { name: 'Edit queued message' }),
    ).toHaveLength(1);

    // Saving posts queue.update for the same queueId — never a new
    // queue.add or turn.send.
    fireEvent.change(input, {
      target: { value: 'Second follow-up, revised' },
    });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() =>
      expect(
        posted.some((message) => message.type === 'queue.update'),
      ).toBe(true),
    );
    expect(
      posted.filter((message) => message.type === 'queue.update'),
    ).toEqual([
      {
        type: 'queue.update',
        sessionId: 'session-a',
        queueId: 'queue-2',
        text: 'Second follow-up, revised',
      },
    ]);
    expect(
      posted.filter(
        (message) =>
          message.type === 'queue.add' || message.type === 'turn.send',
      ),
    ).toHaveLength(0);
    // Edit mode ends: chip gone, composer cleared, text replaced in
    // the still-ordered list.
    await waitFor(() => expect(input.value).toBe(''));
    expect(screen.queryByText('Edit Queued')).toBeNull();
    expect(
      screen.getByText('Second follow-up, revised'),
    ).toBeDefined();

    // Cancelling via the chip restores the idle composer without a
    // queue.update.
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Edit queued message' })[0]!,
    );
    await waitFor(() => expect(input.value).toBe('First follow-up'));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel editing the queued message',
      }),
    );
    await waitFor(() => expect(input.value).toBe(''));
    expect(screen.queryByText('Edit Queued')).toBeNull();
    expect(
      posted.filter((message) => message.type === 'queue.update'),
    ).toHaveLength(1);

    // Send-now promotes the prompt to the head on the host.
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Send queued message now',
      })[1]!,
    );
    expect(posted).toContainEqual({
      type: 'queue.promote',
      sessionId: 'session-a',
      queueId: 'queue-2',
    });
  });

  it('recovers the skills panel across a panel-initiated new session', async () => {
    const user = userEvent.setup();
    render(<App />);
    host(snapshot(0));
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));

    // Entering the skills panel requests the catalog for the session.
    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Skills').closest('button')!);
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: 'skills.refresh',
        sessionId: 'session-a',
      }),
    );
    host({
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-a',
      skills: {
        status: 'ready',
        items: [
          {
            name: 'code-review',
            description: null,
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
        ],
      },
    });

    // The reported deadlock path: toggle a skill, then start a new
    // session from inside the panel.
    await user.click(
      await screen.findByRole('switch', { name: 'code-review enabled' }),
    );
    expect(posted).toContainEqual({
      type: 'skill.toggle',
      sessionId: 'session-a',
      name: 'code-review',
      disabled: true,
    });
    await user.click(
      await screen.findByRole('button', { name: 'Start a new session' }),
    );
    expect(posted).toContainEqual({ type: 'session.new' });
    // The popover returns to the root controls instead of pinning the
    // old session's skills list.
    expect(
      screen.getByRole('dialog', { name: 'Session controls' }),
    ).toBeDefined();

    // The host answers with the new session and (as on any session
    // activation) pushes its settings. Nothing may be stuck on
    // "Loading skills…" and re-entering the panel re-queries the new
    // session.
    host({
      type: 'host.connection',
      sequence: 2,
      sessionId: 'session-b',
      connection: { status: 'connected' },
    });
    host({
      type: 'session.settings',
      sequence: 3,
      sessionId: 'session-b',
      settings: snapshot(0).settings,
    });
    // Wait for the switched session's settings to render the root rows.
    await waitFor(() =>
      expect(screen.queryByText('Loading session settings…')).toBeNull(),
    );
    expect(screen.queryByText('Loading skills…')).toBeNull();
    await user.click(screen.getByText('Skills').closest('button')!);
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: 'skills.refresh',
        sessionId: 'session-b',
      }),
    );
  });

  it('auto-refreshes an open skills panel after a session switch', async () => {
    const user = userEvent.setup();
    render(<App />);
    host(snapshot(0));
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Skills').closest('button')!);
    host({
      type: 'session.skills',
      sequence: 1,
      sessionId: 'session-a',
      skills: {
        status: 'ready',
        items: [
          {
            name: 'code-review',
            description: null,
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
        ],
      },
    });
    await screen.findByRole('switch', { name: 'code-review enabled' });

    // A session switch resets the catalog to 'idle' while the panel
    // stays open; once the new session's settings arrive the panel
    // must re-request the catalog instead of deadlocking behind a
    // disabled Refresh button.
    host({
      type: 'host.connection',
      sequence: 2,
      sessionId: 'session-b',
      connection: { status: 'connected' },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('switch', { name: 'code-review enabled' }),
      ).toBeNull(),
    );
    host({
      type: 'session.settings',
      sequence: 3,
      sessionId: 'session-b',
      settings: snapshot(0).settings,
    });
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: 'skills.refresh',
        sessionId: 'session-b',
      }),
    );
    const refresh = screen.getByRole('button', {
      name: 'Refresh',
    }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(false);
  });

  it('shows a quiet reload hint when no host message arrives after webview.ready', () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      expect(posted).toContainEqual({
        type: 'webview.ready',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      });
      expect(screen.queryByRole('alert')).toBeNull();

      // A stale in-memory host (protocol mismatch after a VSIX
      // overwrite install) drops the ready and never answers.
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByRole('alert').textContent).toContain(
        'Reload Window',
      );
      expect(posted).toContainEqual({
        type: 'webview.diagnostic',
        kind: 'handshake-timeout',
        detail: expect.stringContaining('webview.ready'),
      });

      // A live host answering late clears the hint.
      host(snapshot(0));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the reload hint once a host snapshot arrived', () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      host(snapshot(0));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        posted.filter(
          (message) =>
            message.type === 'webview.diagnostic' &&
            message.kind === 'handshake-timeout',
        ),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies theme pushes immediately and follows the editor on auto', async () => {
    try {
      render(<App />);
      host(snapshot(0));
      const shell = document.querySelector('.dvx-shell')!;
      expect(shell.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.dataset.dvxTheme).toBe('light');

      // A manual preference pins the shell regardless of the editor,
      // and bypasses the store batch (no sequence, applied at once).
      host({ type: 'ui.theme', preference: 'dark', resolved: 'dark' });
      await waitFor(() =>
        expect(shell.getAttribute('data-theme')).toBe('dark'),
      );
      expect(document.documentElement.dataset.dvxTheme).toBe('dark');

      // Auto consumes the Host's authoritative resolution rather than
      // depending on webview body-class mutation timing.
      host({ type: 'ui.theme', preference: 'auto', resolved: 'dark' });
      await waitFor(() =>
        expect(shell.getAttribute('data-theme')).toBe('dark'),
      );
      host({ type: 'ui.theme', preference: 'auto', resolved: 'light' });
      await waitFor(() =>
        expect(shell.getAttribute('data-theme')).toBe('light'),
      );
      expect(document.documentElement.dataset.dvxTheme).toBe('light');
    } finally {
      document.body.className = '';
      delete document.documentElement.dataset.dvxTheme;
    }
  });

  it('keeps Thinking synchronized and allows setting changes while streaming', async () => {
    const user = userEvent.setup();
    const completedThinking =
      'a'.repeat(THINKING_RENDER_CHUNK_SIZE * 4) + 'b';
    render(<App />);
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: 'webview.ready',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
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
          id: 'thinking:turn-1:0',
          kind: 'thinking',
          turnId: 'turn-1',
          text: completedThinking,
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
          id: 'thinking:turn-2:0',
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
    expect(document.querySelector('.dvx-thinking-content')).toBeNull();
    expect(screen.getByText('· Receiving')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /copy full thinking/i }),
    ).toBeNull();

    // Expansion is per row: toggling one Thinking row must not open the
    // others, which stalled long transcripts when it expanded them all.
    const scheduledFrames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      });
    try {
      await user.click(thinkingLabels[0]!.closest('summary')!);
      await waitFor(() => expect(thinkingRows[0]?.open).toBe(true));
      expect(thinkingRows[1]?.open).toBe(false);
      expect(
        thinkingRows[0]?.querySelectorAll('.dvx-thinking-chunk'),
      ).toHaveLength(1);

      act(() => scheduledFrames.shift()?.(performance.now()));
      const chunks = thinkingRows[0]?.querySelectorAll(
        '.dvx-thinking-chunk',
      );
      expect(chunks).toHaveLength(5);
      expect(
        Array.from(chunks ?? [], (chunk) => chunk.textContent).join(''),
      ).toBe(completedThinking);
    } finally {
      requestFrame.mockRestore();
    }
    await user.click(thinkingLabels[0]!.closest('summary')!);
    await waitFor(() => expect(thinkingRows[0]?.open).toBe(false));
    expect(thinkingRows[1]?.open).toBe(false);
    expect(thinkingRows[0]?.querySelector('.dvx-thinking-content')).toBeNull();

    const liveFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    let now = 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const liveRequestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        liveFrames.set(frameId, callback);
        return frameId;
      });
    const liveCancelFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frameId) => {
        liveFrames.delete(frameId);
      });
    const runNextLiveFrame = (): void => {
      const next = liveFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (next === undefined) {
        throw new Error('Expected a pending animation frame');
      }
      liveFrames.delete(next[0]);
      next[1](now);
    };
    try {
      await user.click(thinkingLabels[1]!.closest('summary')!);
      expect(
        thinkingRows[1]?.querySelector('.dvx-thinking-content-live')
          ?.textContent,
      ).toBe('Second thought');

      host({
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-2',
        delta: ' incoming',
        truncated: true,
        segmentIndex: 0,
      });
      await act(async () => {
        runNextLiveFrame();
        await Promise.resolve();
      });
      expect(
        thinkingRows[1]?.querySelector('.dvx-thinking-content-live')
          ?.textContent,
      ).toBe('Second thought');
      await waitFor(() => expect(liveFrames.size).toBeGreaterThan(0));

      now += LIVE_THINKING_SMOOTH_OPTIONS.maxCharIntervalMs * 2;
      act(runNextLiveFrame);
      const partial = thinkingRows[1]?.querySelector(
        '.dvx-thinking-content-live',
      )?.textContent;
      expect(partial?.startsWith('Second thought')).toBe(true);
      expect(partial).not.toBe('Second thought');
      expect(partial).not.toBe('Second thought incoming');

      host({
        type: 'thinking.complete',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-2',
        durationMs: 420,
        segmentIndex: 0,
      });
      for (
        let frame = 0;
        frame < 5 &&
        !thinkingRows[1]
          ?.querySelector('summary')
          ?.textContent?.startsWith('Thought');
        frame += 1
      ) {
        await act(async () => {
          runNextLiveFrame();
          await Promise.resolve();
        });
      }
      expect(
        thinkingRows[1]
          ?.querySelector('summary')
          ?.textContent?.startsWith('Thought'),
      ).toBe(true);
      expect(
        thinkingRows[1]?.querySelector('.dvx-thinking-content-live')
          ?.textContent,
      ).toBe(partial);

      for (
        let frame = 0;
        frame < 10 &&
        thinkingRows[1]?.querySelector('.dvx-thinking-content-live')
          ?.textContent !== 'Second thought incoming';
        frame += 1
      ) {
        now += LIVE_THINKING_SMOOTH_OPTIONS.maxCharIntervalMs * 2;
        act(runNextLiveFrame);
      }
      expect(
        thinkingRows[1]?.querySelector('.dvx-thinking-content-live')
          ?.textContent,
      ).toBe('Second thought incoming');
      await user.click(thinkingRows[1]!.querySelector('summary')!);
    } finally {
      liveCancelFrame.mockRestore();
      liveRequestFrame.mockRestore();
      dateNow.mockRestore();
    }

    expect(await screen.findByText('· Safety limit reached')).toBeTruthy();
    await user.click(thinkingRows[1]!.querySelector('summary')!);
    expect(
      await screen.findByText(
        'Thinking reached the local safety limit; later reasoning is not retained.',
      ),
    ).toBeTruthy();

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

  it('distinguishes incoming Thinking from waiting for the model', async () => {
    render(<App />);
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: 'webview.ready',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      }),
    );
    vi.useFakeTimers();
    try {
      host({
        ...snapshot(0, { turnId: 'turn-1', status: 'streaming' }),
        transcript: [
          {
            id: 'thinking:turn-1:0',
            kind: 'thinking',
            turnId: 'turn-1',
            text: 'First',
            status: 'active',
            truncated: false,
          },
        ],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText('· Receiving')).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(THINKING_WAITING_AFTER_MS);
      });
      expect(screen.getByText('· Waiting for model')).toBeTruthy();

      host({
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-1',
        delta: ' thought',
        truncated: false,
        segmentIndex: 0,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText('· Receiving')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('swaps the composer placeholder while the session is in Spec mode', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid').value,
      ).toBe('Restored draft'),
    );
    const base = snapshot(0);
    host({
      ...base,
      settings: {
        status: 'ready',
        value: {
          interactionMode: 'spec',
          modelId: 'factory/gpt-5.6-sol',
          reasoningEffort: 'high',
          autonomyLevel: 'medium',
          specModeModelId: null,
          specModeReasoningEffort: null,
        },
      },
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid')
          .placeholder,
      ).toBe('Describe what to plan…'),
    );

    host(snapshot(1));
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid')
          .placeholder,
      ).toBe('Ask Droid about your workspace'),
    );
  });

  it('shows semantic tool activity and opens click-to-edit on user messages', async () => {
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
          messageId: 'sdk-user-1',
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

    // The Copy/Reuse/Edit action bar is gone; the full-width block
    // itself is the only edit entry point.
    expect(
      screen.queryByRole('button', { name: 'Copy message' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Reuse message in Composer',
      }),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: 'Edit message and resend from here',
      }),
    );
    expect(posted).toContainEqual({
      type: 'editStage.begin',
      sessionId: 'session-a',
      messageId: 'sdk-user-1',
    });
    expect(
      posted.filter((message) => message.type === 'turn.send'),
    ).toEqual([]);
  });

  it('auto-opens a running execute row and settles it closed', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid').value,
      ).toBe('Restored draft'),
    );
    const executeTranscript = (
      status: 'running' | 'completed',
      outputTail: string,
    ) => [
      {
        id: 'user-1',
        kind: 'user' as const,
        text: 'Run the tests',
        messageId: 'sdk-user-1',
      },
      {
        id: 'tool-exec',
        kind: 'tool' as const,
        turnId: 'turn-1',
        toolUseId: 'use-exec-1',
        toolName: 'Execute',
        action: 'Ran a local command',
        status,
        progressCount: 0,
        latestUpdateKind: null,
        detailKind: 'command' as const,
        detail: 'pnpm test',
        outputTail,
        ...(status === 'completed' ? { durationMs: 1200 } : {}),
      },
    ];
    host({
      ...snapshot(0, { turnId: 'turn-1', status: 'streaming' }),
      transcript: executeTranscript('running', 'suite booting'),
    });
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLDetailsElement>(
        'details.dvx-activity-row',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    // Running execute rows expose the output tail without a click.
    expect(row.open).toBe(true);
    expect(document.querySelector('.dvx-tool-output')?.textContent).toBe(
      'suite booting',
    );

    // Completion settles the row back to the collapsed form.
    host({
      ...snapshot(1),
      transcript: executeTranscript('completed', 'suite passed'),
    });
    await waitFor(() =>
      expect(
        document.querySelector<HTMLDetailsElement>(
          'details.dvx-activity-row',
        )?.open,
      ).toBe(false),
    );
  });

  it('respects a manual collapse of a running execute row', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid').value,
      ).toBe('Restored draft'),
    );
    const running = (sequence: number, outputTail: string) => ({
      ...snapshot(sequence, { turnId: 'turn-1', status: 'streaming' }),
      transcript: [
        {
          id: 'tool-exec',
          kind: 'tool' as const,
          turnId: 'turn-1',
          toolUseId: 'use-exec-1',
          toolName: 'Execute',
          action: 'Ran a local command',
          status: 'running' as const,
          progressCount: 0,
          latestUpdateKind: null,
          detailKind: 'command' as const,
          detail: 'pnpm build',
          outputTail,
        },
      ],
    });
    host(running(0, 'building'));
    const row = await waitFor(() => {
      const found = document.querySelector<HTMLDetailsElement>(
        'details.dvx-activity-row',
      );
      expect(found).not.toBeNull();
      expect(found!.open).toBe(true);
      return found!;
    });

    // The reader closes the running row; jsdom has no native
    // summary-click toggling, so flip the DOM state and fire the
    // toggle event the way the browser would.
    act(() => {
      row.open = false;
      fireEvent(row, new Event('toggle'));
    });
    expect(row.open).toBe(false);

    // Later output must not force the row back open.
    host(running(1, 'building still'));
    expect(
      document.querySelector<HTMLDetailsElement>('details.dvx-activity-row')
        ?.open,
    ).toBe(false);
  });

  it('closes an abandoned edit card when a new Composer message is sent', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));
    host({
      ...snapshot(0),
      transcript: [
        {
          id: 'user-1',
          kind: 'user',
          text: 'Earlier question',
          messageId: 'sdk-user-1',
        },
        {
          id: 'assistant-1',
          kind: 'assistant',
          turnId: 'turn-1',
          text: 'Earlier answer',
        },
      ],
    });

    await user.click(
      await screen.findByRole('button', {
        name: 'Edit message and resend from here',
      }),
    );
    expect(
      screen.getByLabelText('Edit message and resend'),
    ).toBeDefined();

    fireEvent.change(input, { target: { value: 'A brand new question' } });
    await waitFor(() => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      expect(
        posted.some((message) => message.type === 'turn.send'),
      ).toBe(true);
    });

    // Sending a new message abandons the open edit: the card returns
    // to its resting presentation and the host staging area is
    // discarded with the draft.
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Edit message and resend'),
      ).toBeNull(),
    );
    expect(posted).toContainEqual({
      type: 'editStage.cancel',
      sessionId: 'session-a',
    });
    expect(screen.getByText('Earlier question')).toBeDefined();
  });

  it('shows slash and mention popup states instead of staying silent', async () => {
    render(<App />);
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    await waitFor(() => expect(input.value).toBe('Restored draft'));
    host(snapshot(0));
    host({
      type: 'session.commands',
      sequence: 1,
      sessionId: 'session-a',
      commands: { status: 'ready', items: [], recent: [] },
    });

    // A ready-but-empty catalog keeps the popup visible with the
    // documented empty state (no .factory/commands directory).
    fireEvent.change(input, { target: { value: '/' } });
    expect(
      await screen.findByText('No custom commands (.factory/commands)'),
    ).toBeDefined();

    // `@` directly after CJK text still opens the mention flow: the
    // popup reports the pending search, then the empty result.
    fireEvent.change(input, { target: { value: '帮我看看@nomatch' } });
    expect(await screen.findByText('Searching files…')).toBeDefined();
    const search = await waitFor(() => {
      const message = posted.find(
        (
          candidate,
        ): candidate is Extract<
          WebviewToHostMessage,
          { type: 'workspace.searchFiles' }
        > => candidate.type === 'workspace.searchFiles',
      );
      expect(message).toBeDefined();
      return message!;
    });
    expect(search.query).toBe('nomatch');
    host({
      type: 'workspace.files',
      sequence: 2,
      sessionId: 'session-a',
      requestId: search.requestId,
      status: 'ok',
      files: [],
    });
    expect(await screen.findByText('No matching files')).toBeDefined();
  });

  it('keeps one live indicator: the working row is static behind a running tool', async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLTextAreaElement>('Message Droid').value,
      ).toBe('Restored draft'),
    );
    const toolRow = {
      id: 'tool-1',
      kind: 'tool' as const,
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      toolName: 'Create',
      action: 'Created workspace files',
      status: 'running' as const,
      progressCount: 0,
      latestUpdateKind: null,
    };
    host({
      ...snapshot(0, { turnId: 'turn-1', status: 'streaming' }),
      transcript: [toolRow],
    });

    const label = await screen.findByText('Droid is responding');
    expect(label.className).toContain('dvx-pending-label');
    expect(label.className).not.toContain('dvx-shimmer-text');

    host({
      ...snapshot(1, { turnId: 'turn-1', status: 'streaming' }),
      transcript: [{ ...toolRow, status: 'completed' as const }],
    });
    await waitFor(() => {
      expect(
        screen.getByText('Droid is responding').className,
      ).toContain('dvx-shimmer-text');
    });
  });
});
