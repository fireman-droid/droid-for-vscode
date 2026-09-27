import type {
  GitStatusFile,
  GitUnavailableReason,
} from '../../shared/protocol/gitCommitFlow';

export type GitAvailability = 'unknown' | 'available' | 'unavailable';

export type GitCommitResultState =
  | { readonly ok: true; readonly hash: string; readonly subject: string }
  | { readonly ok: false; readonly error: string };

/** Inline commit panel state (git/PR workflow slice A). */
export interface GitCommitFlowState {
  readonly availability: GitAvailability;
  readonly unavailableReason: GitUnavailableReason | null;
  readonly statusPending: boolean;
  readonly statusTurnId: string | null;
  readonly branch: string | null;
  readonly files: readonly GitStatusFile[];
  readonly committedHash: string | null;
  readonly commitPending: boolean;
  /** Changes-card turn whose panel submitted the last commit. */
  readonly commitTurnId: string | null;
  readonly lastResult: GitCommitResultState | null;
}

export const initialGitCommitFlowState: GitCommitFlowState = {
  availability: 'unknown',
  unavailableReason: null,
  statusPending: false,
  statusTurnId: null,
  branch: null,
  files: [],
  committedHash: null,
  commitPending: false,
  commitTurnId: null,
  lastResult: null,
};
