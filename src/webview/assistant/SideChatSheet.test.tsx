// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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

  it('disables the input while an answer streams', () => {
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
        onAsk={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Ask a side question');
    expect(input).toHaveProperty('disabled', true);
    expect(input).toHaveProperty('placeholder', 'Answering…');
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

  it('closes via the header button but not via outside presses', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <SideChatSheet
          btw={readyState}
          onAsk={vi.fn()}
          onDismiss={onDismiss}
        />
      </div>,
    );
    await user.click(screen.getByText('outside'));
    expect(onDismiss).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Close side chat'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
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
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
