import { useEffect, useState } from 'react';

import { formatRelativeTime, nextRefreshDelayMs } from './relativeTime';
import { Tooltip } from '../ui/overlays';

export function formatExactMessageTime(timestamp: number | null): string {
  const date = timestamp === null ? null : new Date(timestamp);
  if (timestamp === null || timestamp <= 0 || date === null || Number.isNaN(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });
}

/**
 * Compact relative age with the recorded local date, time and timezone
 * available on hover or keyboard focus. Missing source times stay unknown;
 * mounting or reloading a message never supplies its timestamp.
 */
export function MessageTimestamp({
  completedAt,
}: {
  readonly completedAt: number | null;
}): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  const date = completedAt === null ? null : new Date(completedAt);
  const available = completedAt !== null && completedAt > 0 && date !== null && !Number.isNaN(date.getTime());
  useEffect(() => {
    if (!available || completedAt === null) {
      return undefined;
    }
    const delay = nextRefreshDelayMs(completedAt, Date.now());
    if (delay === null) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), delay);
    return () => clearInterval(timer);
  }, [completedAt, available, now]);
  if (!available || date === null || completedAt === null) {
    return <span className="dvx-message-time">Time unavailable</span>;
  }
  const exact = formatExactMessageTime(completedAt);
  return (
    <Tooltip content={exact}>
      <time dateTime={date.toISOString()} tabIndex={0} aria-label={exact}
        className="dvx-message-time cursor-default rounded-sm outline-none focus-visible:outline-1 focus-visible:outline-[var(--focus)]">
        {formatRelativeTime(completedAt, now)}
      </time>
    </Tooltip>
  );
}
