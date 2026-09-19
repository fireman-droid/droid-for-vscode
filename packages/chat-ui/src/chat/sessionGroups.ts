import type { SessionSummary } from './sessions';

interface SessionGroup<T extends SessionSummary> {
  readonly key: string;
  readonly label: string | null;
  readonly items: readonly T[];
}

const DAY_MS = 86_400_000;
type TimeBucket = 'today' | 'yesterday' | 'week' | 'older';
const TIME_BUCKETS: readonly { readonly key: TimeBucket; readonly label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Previous 7 days' },
  { key: 'older', label: 'Older' },
];

function timeBucket(stamp: number, startOfToday: number): TimeBucket {
  if (stamp >= startOfToday) return 'today';
  if (stamp >= startOfToday - DAY_MS) return 'yesterday';
  if (stamp >= startOfToday - 7 * DAY_MS) return 'week';
  return 'older';
}

/** Favorites first, then newest-first relative-time groups, independent of catalog order. */
export function groupSessions<T extends SessionSummary>(items: readonly T[], now = new Date()): readonly SessionGroup<T>[] {
  const sorted = [...items].sort((a, b) => modifiedStamp(b) - modifiedStamp(a));
  const groups: SessionGroup<T>[] = [];
  const favorites = sorted.filter((session) => session.isFavorite);
  if (favorites.length > 0) groups.push({ key: 'favorites', label: 'Favorites', items: favorites });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = new Map<TimeBucket, T[]>();
  for (const session of sorted) {
    if (session.isFavorite) continue;
    const bucket = timeBucket(modifiedStamp(session), startOfToday);
    const members = buckets.get(bucket);
    if (members === undefined) buckets.set(bucket, [session]);
    else members.push(session);
  }
  for (const { key, label } of TIME_BUCKETS) {
    const members = buckets.get(key);
    if (members !== undefined) groups.push({ key, label, items: members });
  }
  return groups;
}

function modifiedStamp(session: SessionSummary): number {
  const stamp = Date.parse(session.modifiedTime);
  return Number.isNaN(stamp) ? 0 : stamp;
}
