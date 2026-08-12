// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionQueueState } from '../../shared/queueProtocol';
import { QueuedMessages, type QueuedMessagesProps } from './QueuedMessages';

function makeQueue(
  overrides: Partial<SessionQueueState> = {},
): SessionQueueState {
  return {
    items: [
      { queueId: 'queue-1', text: 'First follow-up', attachments: [] },
      {
        queueId: 'queue-2',
        text: 'Second follow-up',
        attachments: [
          { kind: 'image', name: 'shot.png', sizeBytes: 2048 },
        ],
      },
    ],
    paused: null,
    ...overrides,
  };
}

function renderQueue(
  overrides: Partial<QueuedMessagesProps> = {},
): QueuedMessagesProps {
  const props: QueuedMessagesProps = {
    queue: makeQueue(),
    editingId: null,
    onEditBegin: vi.fn(),
    onPromote: vi.fn(),
    onRemove: vi.fn(),
    onResume: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<QueuedMessages {...props} />);
  return props;
}

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /^\d+ queued message/ });
}

afterEach(cleanup);

describe('QueuedMessages', () => {
  it('renders nothing while the queue is empty', () => {
    renderQueue({ queue: { items: [], paused: null } });
    expect(screen.queryByLabelText('Queued messages')).toBeNull();
  });

  it('collapses to one header line and expands on click', () => {
    renderQueue();
    const header = toggle();
    expect(header.textContent).toContain('2 Queued');
    expect(header.textContent).toContain('⏎ to Send');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    // The list stays mounted for the grid-rows transition but is
    // hidden from the accessibility tree while collapsed.
    const body = document.querySelector('.dvx-queue-body');
    expect(body?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(body?.getAttribute('data-open')).toBe('true');
    expect(screen.getByText('First follow-up')).toBeDefined();
    expect(screen.getByText('[image]')).toBeDefined();

    // Escape collapses again (same dismissal language as the pin).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('offers edit, send-now, and remove on each expanded row', () => {
    const props = renderQueue();
    fireEvent.click(toggle());

    const edits = screen.getAllByRole('button', {
      name: 'Edit queued message',
    });
    const sends = screen.getAllByRole('button', {
      name: 'Send queued message now',
    });
    const removes = screen.getAllByRole('button', {
      name: 'Remove queued message',
    });
    expect(edits).toHaveLength(2);
    expect(sends).toHaveLength(2);
    expect(removes).toHaveLength(2);

    fireEvent.click(edits[1] as HTMLElement);
    expect(props.onEditBegin).toHaveBeenCalledWith('queue-2');
    fireEvent.click(sends[0] as HTMLElement);
    expect(props.onPromote).toHaveBeenCalledWith('queue-1');
    fireEvent.click(removes[0] as HTMLElement);
    expect(props.onRemove).toHaveBeenCalledWith('queue-1');
  });

  it('replaces the action triad with an Editing tag on the edited row', () => {
    renderQueue({ editingId: 'queue-1' });
    fireEvent.click(toggle());

    expect(screen.getByText('Editing')).toBeDefined();
    // The other row keeps its actions; the edited one loses them.
    expect(
      screen.getAllByRole('button', { name: 'Edit queued message' }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Send queued message now' }),
    ).toHaveLength(1);
  });

  it('surfaces the paused state in the header and auto-expands with actions', () => {
    const { rerender } = render(
      <QueuedMessagesHarness paused={null} />,
    );
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    // A fresh pause opens the bar once so Send now / Clear are visible.
    rerender(<QueuedMessagesHarness paused="stopped" />);
    expect(toggle().textContent).toContain('paused after stop');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Send now' }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined();
  });

  it('wires the paused actions to resume and clear', () => {
    const props = renderQueue({
      queue: makeQueue({ paused: 'turn-failed' }),
    });
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(props.onResume).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it('folds the full-queue hint into the header line', () => {
    renderQueue({
      queue: {
        items: Array.from({ length: 10 }, (_, index) => ({
          queueId: `queue-${index}`,
          text: `Prompt ${index}`,
          attachments: [],
        })),
        paused: null,
      },
    });
    expect(toggle().textContent).toContain('10 Queued');
    expect(toggle().textContent).toContain('queue full');
  });
});

function QueuedMessagesHarness({
  paused,
}: {
  readonly paused: SessionQueueState['paused'];
}): React.JSX.Element {
  return (
    <QueuedMessages
      queue={makeQueue({ paused })}
      editingId={null}
      onEditBegin={() => {}}
      onPromote={() => {}}
      onRemove={() => {}}
      onResume={() => {}}
      onClear={() => {}}
    />
  );
}
