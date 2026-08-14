import {
  MAX_CHANGED_FILES_PER_TURN,
  type ChangedFileSummary,
} from '../shared/bridgeMessages';
import type {
  ChangeStatsScope,
  ChangeStatsReader,
  FileChangeStat,
} from './changeStats';

/**
 * Trailing debounce per file before its line counts are (re)read.
 * Repeated edits to the same file within this window coalesce into
 * one reader call.
 */
export const CHANGES_STAT_DEBOUNCE_MS = 500;

/**
 * Live per-turn changes ledger (decard design §4, ledger slice).
 * Collects the file paths of completed file-modifying tool calls in
 * first-observed order and publishes the full cumulative ledger:
 *
 * - a new path publishes immediately (row appears without counts);
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

  const snapshot = (): readonly ChangedFileSummary[] =>
    order.map((path) => {
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
      // Production readers fail soft with an empty map, so rows
      // quietly keep their previous counts.
      const read = await options.reader.read(batch, options.scope);
      if (cancelled) {
        break;
      }
      let changed = false;
      for (const path of batch) {
        const stat = read.get(path);
        if (stat === undefined) {
          continue;
        }
        const previous = stats.get(path);
        if (
          previous?.additions !== stat.additions ||
          previous?.deletions !== stat.deletions
        ) {
          stats.set(path, stat);
          changed = true;
        }
      }
      if (changed) {
        options.publish(snapshot());
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

  return {
    recordPaths(paths) {
      if (cancelled) {
        return;
      }
      let appended = false;
      for (const path of paths) {
        if (!order.includes(path)) {
          if (order.length >= MAX_CHANGED_FILES_PER_TURN) {
            continue;
          }
          order.push(path);
          appended = true;
        }
        schedule(path);
      }
      if (appended) {
        options.publish(snapshot());
      }
    },
    files: snapshot,
    cancel() {
      cancelled = true;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      due.clear();
    },
  };
}
