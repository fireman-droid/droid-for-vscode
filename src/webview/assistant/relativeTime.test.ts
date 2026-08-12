import { describe, expect, it } from 'vitest';

import { formatRelativeTime, nextRefreshDelayMs } from './relativeTime';

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

describe('formatRelativeTime', () => {
  it('labels anything under a minute as just now', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('just now');
  });

  it('clamps future timestamps to just now instead of negative ages', () => {
    expect(formatRelativeTime(NOW + 120_000, NOW)).toBe('just now');
  });

  it('uses minutes up to an hour', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1m ago');
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('2m ago');
    expect(formatRelativeTime(NOW - 59 * 60_000 - 59_000, NOW)).toBe(
      '59m ago',
    );
  });

  it('uses hours up to a day', () => {
    expect(formatRelativeTime(NOW - 3_600_000, NOW)).toBe('1h ago');
    expect(formatRelativeTime(NOW - 23 * 3_600_000, NOW)).toBe('23h ago');
  });

  it('uses days up to a week', () => {
    expect(formatRelativeTime(NOW - 86_400_000, NOW)).toBe('1d ago');
    expect(formatRelativeTime(NOW - 6 * 86_400_000, NOW)).toBe('6d ago');
  });

  it('switches to a short date past one week', () => {
    const completedAt = new Date(2026, 6, 5, 9, 30).getTime();
    const now = new Date(2026, 7, 12, 12, 0).getTime();
    expect(formatRelativeTime(completedAt, now)).toBe('Jul 5');
  });

  it('appends the year when it differs from the current one', () => {
    const completedAt = new Date(2025, 11, 24, 9, 30).getTime();
    const now = new Date(2026, 7, 12, 12, 0).getTime();
    expect(formatRelativeTime(completedAt, now)).toBe('Dec 24, 2025');
  });
});

describe('nextRefreshDelayMs', () => {
  it('refreshes by the minute while the label is minute-grained', () => {
    expect(nextRefreshDelayMs(NOW - 30_000, NOW)).toBe(60_000);
    expect(nextRefreshDelayMs(NOW - 59 * 60_000, NOW)).toBe(60_000);
  });

  it('refreshes hourly for hour and day labels', () => {
    expect(nextRefreshDelayMs(NOW - 2 * 3_600_000, NOW)).toBe(3_600_000);
    expect(nextRefreshDelayMs(NOW - 3 * 86_400_000, NOW)).toBe(3_600_000);
  });

  it('never refreshes a date-form label', () => {
    expect(nextRefreshDelayMs(NOW - 8 * 86_400_000, NOW)).toBeNull();
  });
});
