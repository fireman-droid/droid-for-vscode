// Live changes-ledger protocol (Bridge v10, decard design §4),
// split out of bridgeMessages.ts like the other message domains.
import { type ChangedFileSummary } from './transcript';

/**
 * Lifecycle of the live changes ledger: `writing` while the turn is
 * still editing files, `settled` once the turn-end git
 * reconciliation produced the final ledger.
 */
export const CHANGES_UPDATE_STATES = ['writing', 'settled'] as const;
export type ChangesUpdateState = (typeof CHANGES_UPDATE_STATES)[number];

/**
 * Streams the turn's changed-files ledger. Every message carries the
 * full cumulative file list in first-observed order (idempotent
 * replace, never a delta), so the webview keeps DOM keys stable and
 * updates rows in place. `writing` updates are emitted when a
 * file-modifying tool completes (new rows immediately, per-file line
 * counts after a debounced serial git read); the single `settled`
 * update follows the existing turn-end reconciliation pass.
 */
export interface ChangesUpdateMessage {
  readonly type: 'changes.update';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly state: ChangesUpdateState;
  readonly files: readonly ChangedFileSummary[];
}
