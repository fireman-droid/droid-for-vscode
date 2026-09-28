import type { EditResendPort } from './editResendPort';
import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { RewindAnchorConflictError, RewindAttachmentError } from '../../../runtime/session/rewindErrors';
import { MAX_PENDING_ATTACHMENTS } from '../../../shared/protocol/bounds';
import { type EditResendRejectReason } from '../../../shared/protocol/turns';
import {
  truncateFromUserMessage,
  type HostTranscriptState,
} from '../../recovery/hostTranscriptState';
import {
  forkTitleFromText,
  isSafeBridgeId,
  isTurnActive,
  type EditStagedAttachment,
  type PendingAttachment,
} from '../internals';

export const EDIT_RESEND_BLOCKED_MESSAGE =
  'Finish the current Droid activity before editing an earlier message.';

export const EDIT_RESEND_QUEUE_BLOCKED_MESSAGE =
  'Clear the queued messages before editing an earlier message.';

export const EDIT_RESEND_UNSUPPORTED_MESSAGE =
  'This message cannot be edited and resent.';

export const EDIT_RESEND_FAILED_MESSAGE =
  'Droid could not rewind the session to that message.';

const EDIT_RESEND_RESUME_FAILED_MESSAGE =
  'The rewind completed, but its conversation could not be opened. Retry from the same message to resume it without restoring files again.';
const EDIT_RESEND_PENDING_MESSAGE =
  'A previous rewind already completed. Retry the original edited message before editing a different message.';
const pendingRewinds = new WeakMap<DroidRuntime, {
  sessionId: string; messageId: string; newSessionId: string;
}>();

export function handleRewindInfo(
  ctl: EditResendPort,
  sessionId: string,
  messageId: string,
): void {
  const runtime = ctl.sessionState.runtime;
  if (
    runtime === null ||
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId ||
    typeof runtime.getRewindInfo !== 'function'
  ) {
    return;
  }
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (cwd === null) return;
  void runtime.getRewindInfo(messageId).then(
    (info) => {
      if (ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        ctl.diagnostics?.record({ level: 'info', name: 'host.rewind.preview', attributes: {
          restorableCount: info.restorableCount, createdCount: info.createdCount,
          shownCount: info.details?.length ?? info.restorablePaths.length + info.createdPaths.length + info.evictedFiles.length,
          outsideCount: info.details?.filter((file) => file.location === 'outside-workspace').length ?? 0,
          evictedCount: info.evictedCount ?? info.evictedFiles.length,
        } });
        ctl.emit({
          type: 'rewind.info',
          sessionId,
          messageId,
          restorableCount: info.restorableCount,
          createdCount: info.createdCount,
          restorablePaths: info.restorablePaths,
          createdPaths: info.createdPaths,
          evictedFiles: info.evictedFiles,
          ...(info.details === undefined ? {} : { details: info.details }),
          ...(info.evictedCount === undefined ? {} : { evictedCount: info.evictedCount }),
        });
      }
    },
    () => {
      // File info is advisory; the editor simply omits the option.
    },
  );
}

export function handleEditResend(
  ctl: EditResendPort,
  sessionId: string,
  turnId: string,
  messageId: string,
  text: string,
  restoreFiles: boolean,
): void {
  const runtime = ctl.sessionState.runtime;
  if (runtime !== null && !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    emitEditResendRejected(ctl, sessionId, messageId, 'failed');
    return;
  }
  if (
    runtime === null ||
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId ||
    text.trim().length === 0 ||
    ctl.turnState.turn?.turnId === turnId
  ) {
    if (sessionId === ctl.sessionState.sessionId && ctl.turnState.turn?.turnId !== turnId) {
      emitEditResendRejected(ctl, sessionId, messageId, 'failed');
    }
    return;
  }
  if (
    isTurnActive(ctl.turnState.turn) ||
    ctl.interactions.hasPending() ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.catalogState.refreshInProgress ||
    ctl.metadata.settingsUpdate !== null
  ) {
    ctl.emitSessionDiagnostic('edit-resend-blocked', EDIT_RESEND_BLOCKED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, 'busy');
    return;
  }
  // Edit-resend forks the session, which would silently discard the
  // queue (design §4.6): make the user resolve the queue first.
  if (ctl.queueState.queuedPrompts.items.length > 0) {
    ctl.emitSessionDiagnostic('edit-resend-blocked', EDIT_RESEND_QUEUE_BLOCKED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, 'busy');
    return;
  }
  if (typeof runtime.rewind !== 'function') {
    ctl.emitSessionDiagnostic('edit-resend-unsupported', EDIT_RESEND_UNSUPPORTED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, 'unsupported');
    return;
  }
  const truncated = truncateFromUserMessage(ctl.recoveryState.transcript, messageId);
  if (truncated === null) {
    ctl.emitSessionDiagnostic('edit-resend-unsupported', EDIT_RESEND_UNSUPPORTED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, 'unsupported');
    return;
  }

  // Resendable payloads staged for this message: kept originals plus
  // anything added in edit mode. Non-restorable chips resend nothing.
  const editAttachments: readonly PendingAttachment[] =
    ctl.attachmentState.editStage?.messageId === messageId
      ? ctl.attachmentState.editStage.attachments.flatMap(
          ({ summary, runtime: payload }) =>
            payload === null
              ? []
              : [
                  {
                    summary: {
                      id: summary.id,
                      kind: summary.kind,
                      name: summary.name,
                      sizeBytes: summary.sizeBytes,
                      truncated: summary.truncated,
                    },
                    runtime: payload,
                  },
                ],
        )
      : [];

  ctl.sessionState.sessionOperationInProgress = true;
  const generation = ctl.sessionState.runtimeGeneration;
  void performEditResend(
    ctl,
    runtime,
    sessionId,
    messageId,
    text,
    truncated,
    restoreFiles,
  ).finally(() => {
    if (ctl.sessionState.runtimeGeneration === generation) ctl.sessionState.sessionOperationInProgress = false;
  }).then((forkedSessionId) => {
    if (forkedSessionId === null || ctl.sessionState.runtime !== runtime ||
      ctl.sessionState.runtimeGeneration !== generation || ctl.sessionState.sessionId !== forkedSessionId) {
      return;
    }
    // Send first, then snapshot: the single snapshot then carries the
    // forked session id, the truncated transcript with the edited
    // prompt, and the submitting turn, so the webview adopts the fork
    // atomically.
    ctl.effects.handleSend(forkedSessionId, turnId, text, 'edit-resend', editAttachments);
    ctl.emitSnapshot();
  }).catch((error: unknown) => {
    ctl.diagnostics?.record({ level: 'error', name: 'host.edit-resend.failed',
      detail: error instanceof Error ? error.stack ?? error.message : String(error) });
    if (ctl.sessionState.runtime !== runtime || ctl.sessionState.runtimeGeneration !== generation) return;
    const completed = pendingRewinds.has(runtime);
    ctl.emitSessionDiagnostic('edit-resend-failed', completed ? EDIT_RESEND_RESUME_FAILED_MESSAGE : EDIT_RESEND_FAILED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, completed ? 'resume-failed' : 'failed');
  });
}

export function emitEditResendRejected(
  ctl: EditResendPort,
  sessionId: string,
  messageId: string,
  reason: EditResendRejectReason,
): void {
  ctl.emit({
    type: 'turn.editResendRejected',
    sessionId,
    messageId,
    reason,
  });
}

/**
 * Rewinds the runtime to `messageId` and adopts the forked session.
 * Returns the forked session id when the controller should resend the
 * edited prompt, or null when the operation failed or became stale.
 */
export async function performEditResend(
  ctl: EditResendPort,
  runtime: DroidRuntime,
  sessionId: string,
  messageId: string,
  text: string,
  truncated: HostTranscriptState,
  restoreFiles: boolean,
): Promise<string | null> {
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  const sourceConversationId = ctl.sessionState.conversationId;
  if (cwd === null || sourceConversationId === null) {
    emitEditResendRejected(ctl, sessionId, messageId, 'unsupported');
    return null;
  }

  let forkedSessionId: string;
  try {
    const pending = pendingRewinds.get(runtime);
    if (pending !== undefined && (pending.sessionId !== sessionId || pending.messageId !== messageId)) {
      throw new RewindAnchorConflictError(pending.messageId);
    }
    forkedSessionId = pending?.newSessionId ?? (await runtime.rewind!({
      messageId, forkTitle: forkTitleFromText(text), restoreFiles,
    })).sessionId;
    if (isSafeBridgeId(forkedSessionId)) pendingRewinds.set(runtime, { sessionId, messageId, newSessionId: forkedSessionId });
  } catch (error) {
    if (ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
      const reason = error instanceof RewindAttachmentError ? 'resume-failed'
        : error instanceof RewindAnchorConflictError ? 'rewind-pending' : 'failed';
      ctl.emitSessionDiagnostic('edit-resend-failed', reason === 'resume-failed' ? EDIT_RESEND_RESUME_FAILED_MESSAGE
        : reason === 'rewind-pending' ? EDIT_RESEND_PENDING_MESSAGE : EDIT_RESEND_FAILED_MESSAGE);
      emitEditResendRejected(ctl, sessionId, messageId, reason);
    }
    return null;
  }
  if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
    return null;
  }
  if (!isSafeBridgeId(forkedSessionId)) {
    ctl.emitSessionDiagnostic('edit-resend-failed', EDIT_RESEND_FAILED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, 'failed');
    return null;
  }

  const forkedConversationId = await ctl.effects.createDurableForkConversation(
    sourceConversationId,
    sessionId,
    forkedSessionId,
    'rewind',
    truncated,
  );
  if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) return null;
  if (forkedConversationId === null) {
    ctl.emitSessionDiagnostic('edit-resend-failed', EDIT_RESEND_RESUME_FAILED_MESSAGE);
    emitEditResendRejected(ctl, sessionId, messageId, 'resume-failed');
    return null;
  }

  ctl.sessionState.conversationId = forkedConversationId;
  ctl.sessionState.sessionId = forkedSessionId;
  ctl.recoveryState.transcript = truncated;
  ctl.turnState.turn = null;
  ctl.effects.clearPendingAttachments();
  ctl.catalogState.sessions = ctl.effects.withActiveSession(ctl.catalogState.sessions, {
    id: forkedSessionId,
    title: forkTitleFromText(text),
    messageCount: 0,
    modifiedTime: new Date().toISOString(),
    active: true,
    isFavorite: false,
  });
  pendingRewinds.delete(runtime);
  ctl.effects.armReplayedSubagentWatch(forkedSessionId, cwd, truncated);
  return forkedSessionId;
}

/**
 * Enters edit mode for one sent user message: initializes the edit
 * staging area from the retention area when the payloads are still
 * held, otherwise from the message's chip metadata (removable-only)
 * plus user-echo image items whose base64 is still in the transcript.
 */
export function handleEditStageBegin(
  ctl: EditResendPort,
  sessionId: string,
  messageId: string,
): void {
  if (
    sessionId !== ctl.sessionState.sessionId ||
    ctl.sessionState.connection.status !== 'connected'
  ) {
    return;
  }
  const index = ctl.recoveryState.transcript.transcript.findIndex(
    (item) => item.kind === 'user' && item.messageId === messageId,
  );
  if (index < 0) {
    return;
  }
  ctl.attachmentState.editStage = {
    messageId,
    attachments: buildEditStageAttachments(ctl, messageId, index),
  };
  ctl.effects.emitEditAttachments();
}

export function handleEditStageCancel(ctl: EditResendPort, sessionId: string): void {
  if (sessionId !== ctl.sessionState.sessionId) {
    return;
  }
  ctl.attachmentState.editStage = null;
}

export function buildEditStageAttachments(
  ctl: EditResendPort,
  messageId: string,
  userItemIndex: number,
): readonly EditStagedAttachment[] {
  const retained = ctl.attachmentState.sentAttachments.get(messageId);
  if (retained !== undefined) {
    return retained.map(({ summary, runtime }) => ({
      summary: { ...summary, restorable: true },
      runtime,
    }));
  }
  const staged: EditStagedAttachment[] = [];
  const userItem = ctl.recoveryState.transcript.transcript[userItemIndex];
  if (userItem?.kind === 'user' && userItem.attachments !== undefined) {
    for (const meta of userItem.attachments) {
      ctl.attachmentState.attachmentIdCounter += 1;
      staged.push({
        summary: {
          id: `attachment-${ctl.attachmentState.attachmentIdCounter}`,
          kind: meta.kind,
          name: meta.name,
          sizeBytes: meta.sizeBytes,
          truncated: false,
          restorable: false,
        },
        runtime: null,
      });
    }
  }
  // User-echo image items directly follow their prompt in both live
  // and loaded transcripts; ones still carrying full base64 can be
  // rebuilt into resendable payloads.
  const transcript = ctl.recoveryState.transcript.transcript;
  for (
    let index = userItemIndex + 1;
    index < transcript.length && staged.length < MAX_PENDING_ATTACHMENTS;
    index += 1
  ) {
    const item = transcript[index]!;
    if (item.kind === 'user') {
      break;
    }
    if (item.kind !== 'image' || item.origin !== 'user') {
      continue;
    }
    ctl.attachmentState.attachmentIdCounter += 1;
    const restorable = item.data.length > 0;
    staged.push({
      summary: {
        id: `attachment-${ctl.attachmentState.attachmentIdCounter}`,
        kind: 'image',
        name: `image.${item.mediaType.slice('image/'.length)}`,
        sizeBytes: item.byteLength,
        truncated: false,
        restorable,
      },
      runtime: restorable
        ? {
            kind: 'image',
            data: item.data,
            mediaType: item.mediaType,
          }
        : null,
    });
  }
  return staged.slice(0, MAX_PENDING_ATTACHMENTS);
}
