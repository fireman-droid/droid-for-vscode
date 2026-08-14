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
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionBtwState } from '../../shared/btwProtocol';
import { SideChatSheet } from './SideChatSheet';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const readyState: SessionBtwState = {
  status: 'ready',
  entries: [],
  message: null,
  pendingQuestion: null,
};

function streamingState(answer: string): SessionBtwState {
  return {
    status: 'ready',
    entries: [
      {
        id: 'e1',
        question: 'q',
        answer,
        state: 'streaming',
        message: null,
      },
    ],
    message: null,
    pendingQuestion: null,
  };
}

function installAnimationFrames(): {
  readonly runFrame: () => void;
  readonly restore: () => void;
} {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const request = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      const id = nextId;
      nextId += 1;
      frames.set(id, callback);
      return id;
    });
  const cancel = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((id) => {
      frames.delete(id);
    });
  return {
    runFrame: () => {
      const frame = frames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (frame === undefined) {
        return;
      }
      frames.delete(frame[0]);
      frame[1](performance.now());
    },
    restore: () => {
      request.mockRestore();
      cancel.mockRestore();
    },
  };
}

describe('SideChatSheet', () => {
  it('renders the panel with its title, hint, and empty transcript', () => {
    render(
      <SideChatSheet btw={readyState} onAsk={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(
      screen.getByRole('complementary', { name: 'Side question' }),
    ).toBeTruthy();
    expect(screen.getByText('Side question')).toBeTruthy();
    expect(
      screen.getByText(
        /Ask a quick side question below without interrupting/,
      ),
    ).toBeTruthy();
  });

  it('submits a trimmed question on Enter and clears the input', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    render(
      <SideChatSheet btw={readyState} onAsk={onAsk} onDismiss={vi.fn()} />,
    );
    const input = screen.getByLabelText('Ask a side question');
    await user.type(input, '  what is this error?  {Enter}');
    expect(onAsk).toHaveBeenCalledWith('what is this error?');
    expect(input).toHaveProperty('value', '');
  });

  it('submits through the send button and disables it while empty', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    render(
      <SideChatSheet btw={readyState} onAsk={onAsk} onDismiss={vi.fn()} />,
    );
    const send = screen.getByLabelText('Send side question');
    expect(send).toHaveProperty('disabled', true);
    await user.type(
      screen.getByLabelText('Ask a side question'),
      'what runs this?',
    );
    expect(send).toHaveProperty('disabled', false);
    await user.click(send);
    expect(onAsk).toHaveBeenCalledWith('what runs this?');
    expect(
      screen.getByLabelText('Ask a side question'),
    ).toHaveProperty('value', '');
  });

  it('ignores empty submissions', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    render(
      <SideChatSheet btw={readyState} onAsk={onAsk} onDismiss={vi.fn()} />,
    );
    await user.type(
      screen.getByLabelText('Ask a side question'),
      '   {Enter}',
    );
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('queues one follow-up on Enter while offering Stop', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <SideChatSheet
        btw={{
          status: 'ready',
          entries: [
            {
              id: 'e1',
              question: 'q',
              answer: '',
              state: 'streaming',
              message: null,
            },
          ],
          message: null,
          pendingQuestion: null,
        }}
        onAsk={onAsk}
        onStop={onStop}
        onDismiss={vi.fn()}
      />,
    );
    // Typing and Enter stay available while the current answer runs.
    const input = screen.getByLabelText('Ask a side question');
    expect(input).toHaveProperty('disabled', false);
    expect(input).toHaveProperty(
      'placeholder',
      'Queue next question…',
    );
    await user.type(input, 'next question{Enter}');
    expect(onAsk).toHaveBeenCalledWith('next question');
    expect(input).toHaveProperty('value', '');

    rerender(
      <SideChatSheet
        btw={{
          status: 'ready',
          entries: [
            {
              id: 'e1',
              question: 'q',
              answer: '',
              state: 'streaming',
              message: null,
            },
          ],
          message: null,
          pendingQuestion: 'next question',
        }}
        onAsk={onAsk}
        onStop={onStop}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('next question')).toBeTruthy();
    expect(input).toHaveProperty(
      'placeholder',
      'Replace queued question…',
    );
    // Send is replaced by a working Stop that keeps the partial text.
    expect(
      screen.queryByRole('button', { name: 'Send side question' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop answering' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Answering…')).toBeTruthy();
  });

  it('renders answers as markdown and error entries with their copy', () => {
    render(
      <SideChatSheet
        btw={{
          status: 'ready',
          entries: [
            {
              id: 'e1',
              question: 'first question',
              answer: 'Answer with `code`.',
              state: 'done',
              message: null,
            },
            {
              id: 'e2',
              question: 'second question',
              answer: '',
              state: 'error',
              message: 'Ask this one in the main chat.',
            },
          ],
          message: null,
          pendingQuestion: null,
        }}
        onAsk={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('first question')).toBeTruthy();
    expect(screen.getByText('code')).toBeTruthy();
    expect(
      screen.getByText('Ask this one in the main chat.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Ask a side question'),
    ).toHaveProperty('disabled', false);
  });

  it('follows streaming growth over animation frames instead of jumping', () => {
    const animation = installAnimationFrames();
    try {
      const { container, rerender } = render(
        <SideChatSheet
          btw={streamingState('first')}
          onAsk={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const entries = container.querySelector(
        '.dvx-btw-entries',
      ) as HTMLDivElement;
      Object.defineProperties(entries, {
        clientHeight: { configurable: true, value: 400 },
        scrollHeight: { configurable: true, value: 1000 },
      });
      rerender(
        <SideChatSheet
          btw={streamingState('first, then more')}
          onAsk={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );

      act(() => animation.runFrame());
      expect(entries.scrollTop).toBeGreaterThan(0);
      expect(entries.scrollTop).toBeLessThan(600);
      act(() => animation.runFrame());
      expect(entries.scrollTop).toBeGreaterThan(100);
    } finally {
      animation.restore();
    }
  });

  it('stops following when the reader scrolls upward', () => {
    const animation = installAnimationFrames();
    try {
      const { container, rerender } = render(
        <SideChatSheet
          btw={streamingState('first')}
          onAsk={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      const entries = container.querySelector(
        '.dvx-btw-entries',
      ) as HTMLDivElement;
      Object.defineProperties(entries, {
        clientHeight: { configurable: true, value: 400 },
        scrollHeight: { configurable: true, value: 1000 },
      });
      rerender(
        <SideChatSheet
          btw={streamingState('first, then more')}
          onAsk={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      act(() => animation.runFrame());
      const followedTop = entries.scrollTop;

      fireEvent.wheel(entries, { deltaY: -80 });
      rerender(
        <SideChatSheet
          btw={streamingState('first, then considerably more')}
          onAsk={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      act(() => animation.runFrame());
      expect(entries.scrollTop).toBe(followedTop);
    } finally {
      animation.restore();
    }
  });

  it('shows the unsupported message and disables the input', () => {
    render(
      <SideChatSheet
        btw={{
          status: 'unsupported',
          entries: [],
          message: 'Side chat needs the process runtime mode.',
          pendingQuestion: null,
        }}
        onAsk={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Side chat needs the process runtime mode.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Ask a side question'),
    ).toHaveProperty('disabled', true);
  });

  it('closes via the header button after the slide-out plays', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <SideChatSheet
        btw={readyState}
        onAsk={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByLabelText('Close side chat'));
    expect(onDismiss).not.toHaveBeenCalled();
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('closes without an idle delay when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <SideChatSheet
        btw={readyState}
        onAsk={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByLabelText('Close side chat'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('renders no scrim and ignores presses inside the pane (split-pane)', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { container } = render(
      <SideChatSheet
        btw={readyState}
        onAsk={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    expect(container.querySelector('.dvx-btw-scrim')).toBeNull();
    expect(container.querySelector('.dvx-btw-overlay')).toBeNull();
    await user.click(screen.getByText('Side question'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <SideChatSheet
        btw={readyState}
        onAsk={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });
});
