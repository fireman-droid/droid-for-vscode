import { EDIT_RESEND_REJECT_REASONS, TURN_STATUSES } from './bounds';
import type { RewindDetailFields } from './rewindDetails';

export type TurnStatus = (typeof TURN_STATUSES)[number];

/** A direct send was never accepted. Correlate the existing turn.error envelope by turnId. */
export const TURN_SEND_REJECTED_CODE = 'turn-send-rejected';

export interface TurnSendMessage {
  readonly type: 'turn.send';
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
}

export interface TurnStopMessage {
  readonly type: 'turn.stop';
  readonly sessionId: string;
  readonly turnId: string;
}

/**
 * Rewinds the session to the user message identified by `messageId`
 * (SDK message id), then resends `text` as a fresh turn in the forked
 * session.
 */
export interface TurnEditResendMessage {
  readonly type: 'turn.editResend';
  readonly sessionId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly text: string;
  /**
   * When true, the rewind also restores files Droid changed after the
   * anchor message and deletes files it created since then.
   */
  readonly restoreFiles?: boolean;
}

/**
 * Asks how rewinding to `messageId` would affect workspace files.
 * The host answers with a `rewind.info` message carrying counts.
 */
export interface RewindInfoRequestMessage {
  readonly type: 'rewind.info';
  readonly sessionId: string;
  readonly messageId: string;
}

export type EditResendRejectReason = (typeof EDIT_RESEND_REJECT_REASONS)[number];

/**
 * Structured rejection of one `turn.editResend` request so the
 * editing card returns to its edit state deterministically instead
 * of waiting out a recovery timer.
 */
export interface TurnEditResendRejectedMessage {
  readonly type: 'turn.editResendRejected';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly reason: EditResendRejectReason;
}

/** A file a rewind cannot restore, with the backend's reason. */
export interface RewindEvictedFile {
  readonly path: string;
  readonly reason: string;
}

/**
 * How rewinding to `messageId` would affect workspace files. The path
 * lists are capped at `MAX_REWIND_INFO_FILES` and omit files outside
 * the workspace, so they can be shorter than the counts.
 */
export interface RewindFileImpact extends RewindDetailFields {
  readonly messageId: string;
  /** Files Droid changed after the anchor that a rewind can restore. */
  readonly restorableCount: number;
  /** Files Droid created after the anchor that a rewind can delete. */
  readonly createdCount: number;
  readonly restorablePaths: readonly string[];
  readonly createdPaths: readonly string[];
  /**
   * Files Droid changed after the anchor but can no longer restore, so
   * a rewind leaves them at their current contents.
   */
  readonly evictedFiles: readonly RewindEvictedFile[];
}

/** Answers a webview `rewind.info` request. */
export interface RewindInfoStateMessage extends RewindFileImpact {
  readonly type: 'rewind.info';
  readonly sequence: number;
  readonly sessionId: string;
}

export interface TurnStateMessage {
  readonly type: 'turn.state';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly status: TurnStatus;
  readonly compacting?: boolean;
}

export interface TurnErrorMessage {
  readonly type: 'turn.error';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}
