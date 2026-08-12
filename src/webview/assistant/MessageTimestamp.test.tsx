// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageTimestamp } from './MessageTimestamp';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MessageTimestamp', () => {
  it('renders nothing when the completion time is unknown', () => {
    const { container } = render(<MessageTimestamp completedAt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the relative age with the absolute time as tooltip', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 12, 0, 0));
    const completedAt = new Date(2026, 7, 12, 11, 58, 0).getTime();
    render(<MessageTimestamp completedAt={completedAt} />);
    const label = screen.getByText('2m ago');
    expect(label.title).toBe(new Date(completedAt).toLocaleString());
    expect(label.className).toBe('dvx-message-time');
  });

  it('advances the label as time passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 12, 0, 0));
    const completedAt = Date.now();
    render(<MessageTimestamp completedAt={completedAt} />);
    expect(screen.getByText('just now')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(screen.getByText('3m ago')).toBeDefined();
  });
});
