import { useEffect, useRef, useState } from 'react';

import { ComposerPopup } from './ComposerPopup';
import {
  formatElapsed,
  type WorkingSubagent,
} from './subagentWorking';

/**
 * Cursor-style "N Working" pill hovering at the Composer's left edge
 * while subagent delegations run, with a quiet activity popup.
 *
 * The pill exists exactly while `rows` is non-empty — including the
 * window after the parent turn finished but background delegations
 * are still running (probed 2026-08-12: the ledger keeps reporting
 * `running` and no other UI element moves during that window).
 *
 * Stop All reuses the existing turn-stop channel and therefore only
 * works while a turn is active. Out of turn there is no kill switch:
 * `session.interrupt()` resolves but demonstrably does not cancel a
 * background child (probe-zombie-subagent.out.json, phase B), so the
 * button disables with an honest note instead of faking a control.
 * Per-row stop buttons are omitted for the same reason.
 */
export function WorkingBadge({
  rows,
  turnActive,
  onStopAll,
}: {
  readonly rows: readonly WorkingSubagent[];
  /** True while the current turn can still be interrupted. */
  readonly turnActive: boolean;
  readonly onStopAll: () => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  // Elapsed time is a pure webview measurement: each delegation is
  // stamped when this component first sees it running. Entries for
  // settled rows are pruned so identities can never leak across
  // repeated delegations of the same tool-use id.
  const startTimesRef = useRef(new Map<string, number>());
  const startTimes = startTimesRef.current;
  const keys = new Set<string>();
  for (const row of rows) {
    const key = `${row.turnId}:${row.toolUseId}`;
    keys.add(key);
    if (!startTimes.has(key)) {
      startTimes.set(key, Date.now());
    }
  }
  for (const key of startTimes.keys()) {
    if (!keys.has(key)) {
      startTimes.delete(key);
    }
  }

  const empty = rows.length === 0;
  useEffect(() => {
    if (empty) {
      setOpen(false);
    }
  }, [empty]);

  // Wall-clock tick drives the per-row elapsed labels only while the
  // popup is open; the collapsed pill has nothing time-based.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const timer = setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => clearInterval(timer);
  }, [open]);

  if (empty) {
    return null;
  }

  return (
    <div className="dvx-working-dock">
      <div className="dvx-working-anchor">
        {open ? (
          <ComposerPopup
            className="dvx-working-popup"
            label="Working subagents"
            role="dialog"
            onDismiss={() => setOpen(false)}
          >
            <div className="dvx-working-popup-head">
              <span className="dvx-working-popup-title">
                {rows.length} Working
              </span>
              <button
                type="button"
                className="dvx-working-stop-all"
                disabled={!turnActive}
                onClick={() => {
                  onStopAll();
                  setOpen(false);
                }}
              >
                Stop All
              </button>
            </div>
            <ul className="dvx-working-list">
              {rows.map((row) => (
                <li
                  key={`${row.turnId}:${row.toolUseId}`}
                  className="dvx-working-row"
                >
                  <span
                    className="dvx-working-spinner"
                    aria-hidden="true"
                  />
                  <span className="dvx-working-row-type">
                    {`${row.type} subagent`}
                  </span>
                  {row.description.length > 0 ? (
                    <span className="dvx-working-row-desc">
                      {row.description}
                    </span>
                  ) : null}
                  <span className="dvx-working-row-elapsed">
                    {formatElapsed(
                      Date.now() -
                        (startTimes.get(
                          `${row.turnId}:${row.toolUseId}`,
                        ) ?? Date.now()),
                    )}
                  </span>
                  {/* View hook: the subagent transcript playback slice
                      (subagent-transcript-playback-design.md §6.1)
                      mounts its read-only transcript entry point here,
                      keyed by this row's toolUseId. Not rendered in
                      this slice. */}
                </li>
              ))}
            </ul>
            {turnActive ? null : (
              <div className="dvx-working-popup-note">
                Running in background — cannot be stopped from here.
              </div>
            )}
          </ComposerPopup>
        ) : null}
        <button
          type="button"
          className="dvx-working-badge"
          aria-expanded={open}
          aria-label={`${rows.length} subagents working`}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="dvx-working-spinner" aria-hidden="true" />
          {`${rows.length} Working`}
        </button>
      </div>
    </div>
  );
}
