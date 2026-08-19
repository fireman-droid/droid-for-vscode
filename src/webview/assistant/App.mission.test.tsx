// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostToWebviewMessage, WebviewToHostMessage } from '../../shared/bridgeMessages';
import type { MissionSnapshotMessage } from '../../shared/missionProtocol';
import { App } from './App';

let persistedState: unknown = { draft: '' };
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
      disconnect(): void {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  persistedState = { draft: '' };
  posted.length = 0;
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

function chatSnapshot(): Extract<
  HostToWebviewMessage,
  { type: 'host.snapshot' }
> {
  return {
    type: 'host.snapshot',
    sequence: 0,
    sessionId: 'session-a',
    connection: { status: 'connected' },
    turn: null,
    sessions: {
      status: 'ready',
      items: [
        {
          id: 'session-a',
          title: 'Current',
          messageCount: 1,
          modifiedTime: '2026-08-17T00:00:00.000Z',
          active: true,
          isFavorite: false,
        },
      ],
    },
    settings: {
      status: 'ready',
      value: {
        interactionMode: 'auto',
        modelId: 'model-a',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      },
    },
    context: {
      status: 'ready',
      value: {
        availability: 'available',
        used: 10,
        remaining: 90,
        limit: 100,
      },
    },
    modelCatalog: {
      status: 'ready',
      items: [
        {
          id: 'model-a',
          displayName: 'Model A',
          supportedReasoningEfforts: ['medium', 'high'],
        },
      ],
    },
    transcript: [
      {
        id: 'assistant-existing',
        kind: 'assistant',
        turnId: 'turn-existing',
        text: 'Existing transcript',
      },
    ],
    historyStatus: 'complete',
    truncated: false,
  };
}

function missionSnapshot(
  overrides: Partial<
    NonNullable<MissionSnapshotMessage['setup']>['preferences']
  > = {},
): MissionSnapshotMessage {
  return {
    type: 'mission.snapshot',
    protocolVersion: 25,
    sequence: 1,
    scope: 'selected-chat',
    revision: 0,
    availability: 'attached',
    features: [],
    completedFeatureCount: 0,
    controls: {
      canPause: false,
      canResume: false,
      canStopCurrentFeature: false,
    },
    validator: {
      scrutinyEnabled: true,
      userTestingEnabled: true,
    },
    setup: {
      currentChat: { modelId: 'model-a', reasoningEffort: 'high' },
      catalogStatus: 'ready',
      catalog: [
        {
          id: 'model-a',
          displayName: 'Model A',
          supportedReasoningEfforts: ['medium', 'high'],
        },
      ],
      preferences: {
        worker: {
          mode: 'same-as-orchestrator',
          modelId: 'model-a',
          reasoningEffort: 'high',
        },
        validator: {
          mode: 'same-as-orchestrator',
          modelId: 'model-a',
          reasoningEffort: 'high',
        },
        scrutinyEnabled: true,
        userTestingEnabled: true,
        ...overrides,
      },
    },
  };
}

async function enterComposer(text: string): Promise<HTMLTextAreaElement> {
  const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
  fireEvent.change(input, { target: { value: text } });
  input.focus();
  await waitFor(() => {
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(input.value).toBe('');
  });
  return input;
}

describe('App Mission entry', () => {
  it('discovers /canvas and inserts a visible request template without sending', async () => {
    render(<App />);
    host(chatSnapshot());
    const input =
      screen.getByLabelText<HTMLTextAreaElement>('Message Droid');

    fireEvent.change(input, { target: { value: '/canvas' } });
    expect(
      await screen.findByRole('option', {
        name: /\/canvas.*Create an interactive result artifact/i,
      }),
    ).toBeDefined();
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(input.value).toContain('Create an interactive Canvas artifact for:');
      expect(input.value).toContain('[Describe the result');
    });
    expect(posted.some((message) => message.type === 'turn.send')).toBe(false);
  });

  it('appends Canvas feedback to the current Composer draft without sending', async () => {
    render(<App />);
    host(chatSnapshot());
    const input =
      screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
    fireEvent.change(input, { target: { value: 'Keep this note.' } });

    host({
      type: 'canvas.feedbackDraft',
      sequence: 1,
      text: 'Canvas feedback:\n\nReduce the card radius.',
    });

    await waitFor(() => {
      expect(input.value).toBe(
        'Keep this note.\n\nCanvas feedback:\n\nReduce the card radius.',
      );
    });
    host({
      type: 'canvas.feedbackDraft',
      sequence: 1,
      text: 'Duplicate feedback',
    });
    expect(input.value).not.toContain('Duplicate feedback');
    expect(posted.some((message) => message.type === 'turn.send')).toBe(false);
  });

  it('discovers /mission in the slash popup and opens setup directly', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    const input =
      screen.getByLabelText<HTMLTextAreaElement>('Message Droid');

    fireEvent.change(input, { target: { value: '/mission' } });
    const command = await screen.findByRole('option', {
      name: /\/mission.*Start a Factory Mission/i,
    });
    expect(screen.queryByText('No matching commands')).toBeNull();

    input.focus();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(
      await screen.findByRole('heading', { name: 'Start a Mission' }),
    ).toBeDefined();
    expect(input.value).toBe('');
    expect(
      posted.some(
        (message) =>
          message.type === 'mission.start' || message.type === 'turn.send',
      ),
    ).toBe(false);
  });

  it('hides the built-in when Mission setup is unavailable', async () => {
    render(<App />);
    host(chatSnapshot());
    host({ ...missionSnapshot(), setup: undefined });
    const input =
      screen.getByLabelText<HTMLTextAreaElement>('Message Droid');

    fireEvent.change(input, { target: { value: '/mission' } });
    expect(await screen.findByText('No matching commands')).toBeDefined();
    expect(
      screen.queryByRole('option', {
        name: /\/mission.*Start a Factory Mission/i,
      }),
    ).toBeNull();
  });

  it('preserves chat around setup and dismisses locally', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    const transcript = await screen.findByText('Existing transcript');
    const input = await enterComposer('/mission');

    expect(await screen.findByRole('heading', { name: 'Start a Mission' })).toBeDefined();
    expect(screen.getByText('Existing transcript')).toBe(transcript);
    expect(screen.getByLabelText('Message Droid')).toBe(input);
    expect(document.activeElement).toBe(
      screen.getByLabelText('Mission task'),
    );

    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss Mission setup' }),
    );
    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
    expect(input.value).toBe('Keep this draft');
    expect(
      posted.some(
        (message) =>
          message.type === 'mission.start' || message.type === 'turn.send',
      ),
    ).toBe(false);
  });

  it('direct starts once with valid effective preferences', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    await enterComposer('/mission  Keep  punctuation: a/b?  ');

    await waitFor(() => {
      const starts = posted.filter(
        (message): message is Extract<
          WebviewToHostMessage,
          { type: 'mission.start' }
        > => message.type === 'mission.start',
      );
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({
        task: 'Keep  punctuation: a/b?',
        worker: {
          mode: 'same-as-orchestrator',
          modelId: 'model-a',
          reasoningEffort: 'high',
        },
        validator: {
          mode: 'same-as-orchestrator',
          modelId: 'model-a',
          reasoningEffort: 'high',
        },
        scrutinyEnabled: true,
        userTestingEnabled: true,
      });
    });
    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
  });

  it('keeps invalid direct start editable without fallback', async () => {
    render(<App />);
    host(chatSnapshot());
    host(
      missionSnapshot({
        worker: {
          mode: 'override',
          modelId: 'removed-worker',
          reasoningEffort: 'max',
        },
      }),
    );
    await enterComposer('/mission Preserve this exact task!');

    expect(
      await screen.findByDisplayValue('Preserve this exact task!'),
    ).toBeDefined();
    expect(
      screen.getByRole('status', { name: 'Mission setup status' }).textContent,
    ).toContain(
      'The Worker model is unavailable.',
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Start Mission',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(posted.some((message) => message.type === 'mission.start')).toBe(
      false,
    );
  });

  it('does not carry setup across selected chats', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    await enterComposer('/mission');
    expect(await screen.findByRole('heading', { name: 'Start a Mission' })).toBeDefined();

    const next = chatSnapshot();
    host({
      ...next,
      sequence: 2,
      sessionId: 'session-b',
      sessions: {
        status: 'ready',
        items: [
          {
            ...next.sessions.items[0]!,
            id: 'session-b',
          },
        ],
      },
    });
    host({ ...missionSnapshot(), sequence: 3 });

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Start a Mission' }),
      ).toBeNull();
    });
  });
});
