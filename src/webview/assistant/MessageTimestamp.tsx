import { useEffect, useState } from 'react';

import { formatRelativeTime, nextRefreshDelayMs } from './relativeTime';

/**
 * Quiet relative age ("2m ago") for a finished assistant message,
 * shown inside the message action bar. Completion times exist only
 * where the host observed the turn finish (live turns and recovery
 * checkpoints); messages rebuilt from public CLI history carry no
 * timestamp, so the component renders nothing rather than inventing
 * one. The label re-renders on the cadence the current granularity
 * needs (minute-fresh, then hourly, then static).
 */
export function MessageTimestamp({
  completedAt,
}: {
  readonly completedAt: number | null;
}): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (completedAt === null) {
      return undefined;
    }
    const delay = nextRefreshDelayMs(completedAt, Date.now());
    if (delay === null) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), delay);
    return () => clearInterval(timer);
  }, [completedAt, now]);
  if (completedAt === null) {
    return null;
  }
  return (
    <span
      className="dvx-message-time"
      title={new Date(completedAt).toLocaleString()}
    >
      {formatRelativeTime(completedAt, now)}
    </span>
  );
}
