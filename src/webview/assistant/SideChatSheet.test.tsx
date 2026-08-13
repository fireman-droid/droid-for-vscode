// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionBtwState } from '../../shared/btwProtocol';
import { SideChatSheet } from './SideChatSheet';

afterEach(cleanup);

const readyState: SessionBtwState = {
  status: 'ready',
  entries: [],
  message: null,
};

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

  it('keeps typing available and offers Stop while an answer streams', async () => {
    const user = userEvent.setup();
    const onAsk = vi.fn();
    const onStop = vi.fn();
    render(
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
        }}
        onAsk={onAsk}
        onStop={onStop}
        onDismiss={vi.fn()}
      />,
    );
    // Typing stays available (user report 2026-08-13); only sending
    // waits for the stream, so Enter is a no-op mid-stream.
    const input = screen.getByLabelText('Ask a side question');
    expect(input).toHaveProperty('disabled', false);
    expect(input).toHaveProperty('placeholder', 'Answering…');
    await user.type(input, 'next question{Enter}');
    expect(onAsk).not.toHaveBeenCalled();
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

  it('shows the unsupported message and disables the input', () => {
    render(
      <SideChatSheet
        btw={{
          status: 'unsupported',
          entries: [],
          message: 'Side chat needs the process runtime mode.',
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
