import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import { type ChangedFileSummary } from '../../shared/protocol/transcript';
import { hasFileChange, type ChangeStatsScope, type ChangeStatsReader, type FileChangeStat } from './changeStats';

/**
 * Trailing debounce per file before its line counts are (re)read.
 * Repeated edits to the same file within this window coalesce into
 * one reader call.
 */
export const CHANGES_STAT_DEBOUNCE_MS = 500;

/**
 * Live per-turn changes ledger (decard design §4, ledger slice).
 * Collects candidate paths from tools and disk events. Only measured changes
 * are published; a tool's intended path is never proof of a write.
 *
 * - a new path is measured before its row appears;
 * - line counts refresh through a per-file trailing debounce feeding
 *   one serial stats queue, so concurrent due files coalesce into a
 *   single reader invocation;
 * - `cancel()` (turn end/failure) stops timers and drops in-flight
 *   results, leaving the turn-end reconciliation as the only
 *   remaining publisher.
 */
export interface TurnChangesLedger {
  /** Feeds the target paths of one completed file-modifying tool. */
  recordPaths(paths: readonly string[]): void;
  /** Current cumulative ledger in first-observed order. */
  files(): readonly ChangedFileSummary[];
  /** Stops timers and suppresses every later publish. */
  cancel(): void;
}

export interface TurnChangesLedgerOptions {
  readonly reader: ChangeStatsReader;
  readonly scope: ChangeStatsScope;
  /** Receives the full cumulative ledger after each visible change. */
  readonly publish: (files: readonly ChangedFileSummary[]) => void;
  /** Receives attributed files whose current contents need to be reread. */
  readonly invalidate?: (paths: readonly string[]) => void;
  readonly debounceMs?: number;
}

export function createTurnChangesLedger(
  options: TurnChangesLedgerOptions,
): TurnChangesLedger {
  const debounceMs = options.debounceMs ?? CHANGES_STAT_DEBOUNCE_MS;
  const order: string[] = [];
  const stats = new Map<string, FileChangeStat>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const due = new Set<string>();
  let reading = false;
  let cancelled = false;
  let watcher: { dispose(): void } | undefined;

  const snapshot = (): readonly ChangedFileSummary[] =>
    order.filter((path) => hasFileChange(stats.get(path))).map((path) => {
      const stat = stats.get(path);
      return {
        path,
        additions: stat?.additions ?? null,
        deletions: stat?.deletions ?? null,
      };
    });

  // Serial queue: one stats read at a time; everything due when a read
  // finishes goes into the next single batch invocation.
  const drain = async (): Promise<void> => {
    if (reading) {
      return;
    }
    reading = true;
    while (due.size > 0 && !cancelled) {
      const batch = [...due];
      due.clear();
      await options.reader.captureTurnBaseline?.(options.scope, batch);
      const read = await options.reader.read(batch, options.scope);
      if (cancelled) {
        break;
      }
      let changed = false;
      const invalidated: string[] = [];
      for (const path of batch) {
        const previous = stats.get(path);
        const stat = read.get(path);
        // Missing results mean unreadable/unknown, not a measured reversion.
        if (stat === undefined) {
          if (previous !== undefined) invalidated.push(path);
          continue;
        }
        if (!hasFileChange(stat)) {
          changed = stats.delete(path) || changed;
          const index = order.indexOf(path);
          if (index >= 0) order.splice(index, 1);
          continue;
        }
        invalidated.push(path);
        if (!order.includes(path)) order.push(path);
        if (
          previous?.additions !== stat.additions ||
          previous?.deletions !== stat.deletions ||
          previous?.changed !== stat.changed
        ) {
          stats.set(path, stat);
          changed = true;
        }
      }
      if (changed) {
        options.publish(snapshot());
      }
      if (invalidated.length > 0) {
        options.invalidate?.(invalidated);
      }
    }
    reading = false;
  };

  const schedule = (path: string): void => {
    const existing = timers.get(path);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        due.add(path);
        void drain();
      }, debounceMs),
    );
  };

  const ledger: TurnChangesLedger = {
    recordPaths(paths) {
      if (cancelled) {
        return;
      }
      for (const path of paths) {
        if (!order.includes(path)) {
          if (order.length >= MAX_CHANGED_FILES_PER_TURN) {
            continue;
          }
          order.push(path);
        }
        schedule(path);
      }
    },
    files: snapshot,
    cancel() {
      cancelled = true;
      watcher?.dispose();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      due.clear();
    },
  };
  watcher = options.reader.watch?.((paths) => ledger.recordPaths(paths));
  return ledger;
}
