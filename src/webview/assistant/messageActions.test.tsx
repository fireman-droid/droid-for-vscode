// @vitest-environment jsdom

// Message-area polish behaviors: the user edit card cancels from an
// outside click (no Cancel button), the assistant action bar carries
// Fork chat only on the last reply, and completion times are stamped
// only for replies seen finishing inside this webview.

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

type Snapshot = Extract<HostToWebviewMessage, { type: 'host.snapshot' }>;

function snapshot(sequence: number, turn: Snapshot['turn'] = null): Snapshot {
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

const twoTurnTranscript: Snapshot['transcript'] = [
  {
    id: 'user-1',
    kind: 'user',
    text: 'First question',
    messageId: 'sdk-user-1',
  },
  {
    id: 'assistant-1',
    kind: 'assistant',
    turnId: 'turn-1',
    text: 'First answer',
  },
  {
    id: 'user-2',
    kind: 'user',
    text: 'Second question',
    messageId: 'sdk-user-2',
  },
  {
    id: 'assistant-2',
    kind: 'assistant',
    turnId: 'turn-2',
    text: 'Second answer',
  },
];

describe('user edit card dismissal', () => {
  it('cancels from an outside click instead of a Cancel button', async () => {
    const user = userEvent.setup();
    render(<App />);
    host({ ...snapshot(0), transcript: twoTurnTranscript });

    await user.click(
      (await screen.findAllByRole('button', {
        name: 'Edit message and resend from here',
      }))[0],
    );
    const editor = screen.getByLabelText('Edit message and resend');

    // No Cancel button anywhere in the edit card.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    // A pointerdown inside the card keeps the editor open.
    fireEvent.pointerDown(editor);
    expect(screen.getByLabelText('Edit message and resend')).toBeDefined();

    // A pointerdown on blank space outside cancels silently and
    // discards the host staging area.
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Edit message and resend'),
      ).toBeNull(),
    );
    expect(posted).toContainEqual({
      type: 'editStage.cancel',
      sessionId: 'session-a',
    });
    expect(screen.getByText('First question')).toBeDefined();
  });
});

describe('assistant action bar', () => {
  it('offers Fork chat only on the last reply and posts session.fork', async () => {
    const user = userEvent.setup();
    render(<App />);
    host({ ...snapshot(0), transcript: twoTurnTranscript });

    // Fork follows the SDK boundary: sessions fork from their current
    // state only, so the action exists solely on the newest reply.
    const forkButtons = await screen.findAllByRole('button', {
      name: 'Fork chat',
    });
    expect(forkButtons).toHaveLength(1);

    await user.click(forkButtons[0]);
    expect(posted).toContainEqual({
      type: 'session.fork',
      sessionId: 'session-a',
    });
  });

  it('hides Fork chat while a turn is active', async () => {
    render(<App />);
    host({
      ...snapshot(0, { turnId: 'turn-2', status: 'streaming' }),
      transcript: twoTurnTranscript,
    });
    await screen.findByText('Second answer');
    expect(screen.queryByRole('button', { name: 'Fork chat' })).toBeNull();
  });

  it('stamps a relative time only for replies seen finishing live', async () => {
    const { container } = render(<App />);
    host({
      ...snapshot(0, { turnId: 'turn-2', status: 'streaming' }),
      transcript: twoTurnTranscript,
    });
    await screen.findByText('Second answer');
    // History (turn-1) settled before this webview ever saw it: no
    // fabricated age, and the streaming reply carries no bar yet.
    expect(container.querySelector('.dvx-message-time')).toBeNull();

    host({ ...snapshot(1), transcript: twoTurnTranscript });
    await screen.findByText('just now');
    expect(
      container.querySelectorAll('.dvx-message-time'),
    ).toHaveLength(1);
  });
});
