const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Cursor-style relative age for a finished assistant message
 * ("just now", "2m ago", "3h ago", "2d ago"). Past one week an
 * absolute short date reads better than a large day count; the year
 * appears only when it differs from the current one. Clock skew
 * (completedAt in the future) clamps to "just now" instead of
 * inventing negative ages.
 */
export function formatRelativeTime(
  completedAt: number,
  now: number,
): string {
  const delta = Math.max(0, now - completedAt);
  if (delta < MINUTE_MS) {
    return 'just now';
  }
  if (delta < HOUR_MS) {
    return `${Math.floor(delta / MINUTE_MS)}m ago`;
  }
  if (delta < DAY_MS) {
    return `${Math.floor(delta / HOUR_MS)}h ago`;
  }
  if (delta < WEEK_MS) {
    return `${Math.floor(delta / DAY_MS)}d ago`;
  }
  const date = new Date(completedAt);
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear()
    ? label
    : `${label}, ${date.getFullYear()}`;
}

/**
 * Refresh cadence for a rendered relative-time label: minute-fresh
 * while the label changes by the minute, then hourly; a date-form
 * label never changes while mounted (null = no refresh needed).
 */
export function nextRefreshDelayMs(
  completedAt: number,
  now: number,
): number | null {
  const delta = Math.max(0, now - completedAt);
  if (delta < HOUR_MS) {
    return MINUTE_MS;
  }
  if (delta < WEEK_MS) {
    return HOUR_MS;
  }
  return null;
}
