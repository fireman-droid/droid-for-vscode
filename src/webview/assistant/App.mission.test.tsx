// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import type { MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
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

function chatSnapshot(): Extract<HostToWebviewMessage, { type: 'host.snapshot' }> {
  return {
    type: 'host.snapshot',
    sequence: 0,
    conversationId: 'conversation-a',
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
  overrides: Partial<NonNullable<MissionSnapshotMessage['setup']>['preferences']> = {},
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
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');

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
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');
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

  it('does not expose or execute the removed /mission entry', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');

    fireEvent.change(input, { target: { value: '/mission' } });
    expect(
      screen.queryByRole('option', {
        name: /\/mission.*Open Mission Control/i,
      }),
    ).toBeNull();
    await enterComposer('/mission');
    expect(posted.some((message) => message.type === 'mission.panel.open')).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
    expect(input.value).toBe('');
    expect(
      posted.some(
        (message) => message.type === 'mission.start' || message.type === 'turn.send',
      ),
    ).toBe(false);
  });

  it('keeps the removed command unavailable with no Mission setup', async () => {
    render(<App />);
    host(chatSnapshot());
    host({ ...missionSnapshot(), setup: undefined });
    const input = screen.getByLabelText<HTMLTextAreaElement>('Message Droid');

    fireEvent.change(input, { target: { value: '/mission' } });
    expect(
      screen.queryByRole('option', {
        name: /\/mission.*Open Mission Control/i,
      }),
    ).toBeNull();
  });

  it('submits bare /mission without opening inline setup or sending', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    const input = await enterComposer('/mission');

    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
    expect(input.value).toBe('');
    expect(
      posted.some(
        (message) => message.type === 'mission.start' || message.type === 'turn.send',
      ),
    ).toBe(false);
    expect(
      posted.filter((message) => message.type === 'mission.panel.open'),
    ).toHaveLength(0);
  });

  it('does not forward a task-bearing removed command to a model', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    await enterComposer('/mission  Keep  punctuation: a/b?  ');

    expect(
      posted.some(
        (message) =>
          message.type === 'mission.panel.open' || message.type === 'turn.send',
      ),
    ).toBe(false);
    expect(posted.some((message) => message.type === 'mission.start')).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
  });

  it('does not revive removed command behavior through stale setup', async () => {
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
      posted.some(
        (message) =>
          message.type === 'mission.panel.open' || message.type === 'turn.send',
      ),
    ).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
    expect(posted.some((message) => message.type === 'mission.start')).toBe(false);
  });

  it('does not revive inline setup across selected chats', async () => {
    render(<App />);
    host(chatSnapshot());
    host(missionSnapshot());
    await enterComposer('/mission');
    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();

    const next = chatSnapshot();
    host({
      ...next,
      sequence: 2,
      conversationId: 'conversation-b',
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

    expect(screen.queryByRole('heading', { name: 'Start a Mission' })).toBeNull();
    expect(
      posted.filter((message) => message.type === 'mission.panel.open'),
    ).toHaveLength(0);
  });
});
