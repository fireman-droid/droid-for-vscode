// editResend: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type { EditResendRejectReason } from '../../shared/bridgeMessages';
import { MAX_PENDING_ATTACHMENTS } from '../../shared/bridgeMessages';
import type { DroidRuntime } from '../../runtime/DroidRuntime';
import {
  truncateFromUserMessage,
  type HostTranscriptState,
} from '../hostTranscriptState';
import { clearPendingAttachments, emitEditAttachments } from './attachments';
import { withActiveSession } from './sessionDirectory';
import { ensureActiveRuntimeWorkspaceCurrent } from './runtimeLifecycle';
import { handleSend } from './turnFlow';
import {
  forkTitleFromText,
  isSafeBridgeId,
  isTurnActive,
  type ChatControllerInternals,
  type EditStagedAttachment,
  type PendingAttachment,
} from './internals';

export const EDIT_RESEND_BLOCKED_MESSAGE =
  'Finish the current Droid activity before editing an earlier message.';

export const EDIT_RESEND_QUEUE_BLOCKED_MESSAGE =
  'Clear the queued messages before editing an earlier message.';

export const EDIT_RESEND_UNSUPPORTED_MESSAGE =
  'This message cannot be edited and resent.';

export const EDIT_RESEND_FAILED_MESSAGE =
  'Droid could not rewind the session to that message.';

export function handleRewindInfo(
  ctl: ChatControllerInternals,
  sessionId: string, messageId: string): void {
    const runtime = ctl.runtime;
    if (
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId ||
      typeof runtime.getRewindInfo !== 'function'
    ) {
      return;
    }
    void runtime.getRewindInfo(messageId).then(
      (info) => {
        if (sessionId === ctl.sessionId) {
          ctl.emit({
            type: 'rewind.info',
            sessionId,
            messageId,
            restorableCount: info.restorableCount,
            createdCount: info.createdCount,
            restorablePaths: info.restorablePaths,
            createdPaths: info.createdPaths,
            evictedFiles: info.evictedFiles,
          });
        }
      },
      () => {
        // File info is advisory; the editor simply omits the option.
      },
    );
}

export function handleEditResend(
  ctl: ChatControllerInternals,
    sessionId: string,
    turnId: string,
    messageId: string,
    text: string,
    restoreFiles: boolean,
  ): void {
    const runtime = ctl.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId ||
      text.trim().length === 0 ||
      ctl.turn?.turnId === turnId
    ) {
      return;
    }
    if (
      isTurnActive(ctl.turn) ||
      ctl.interactions.hasPending() ||
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress ||
      ctl.settingsUpdate !== null
    ) {
      ctl.emitSessionDiagnostic(
        'edit-resend-blocked',
        EDIT_RESEND_BLOCKED_MESSAGE,
      );
      emitEditResendRejected(ctl, sessionId, messageId, 'busy');
      return;
    }
    // Edit-resend forks the session, which would silently discard the
    // queue (design §4.6): make the user resolve the queue first.
    if (ctl.queuedPrompts.items.length > 0) {
      ctl.emitSessionDiagnostic(
        'edit-resend-blocked',
        EDIT_RESEND_QUEUE_BLOCKED_MESSAGE,
      );
      emitEditResendRejected(ctl, sessionId, messageId, 'busy');
      return;
    }
    if (typeof runtime.rewind !== 'function') {
      ctl.emitSessionDiagnostic(
        'edit-resend-unsupported',
        EDIT_RESEND_UNSUPPORTED_MESSAGE,
      );
      emitEditResendRejected(ctl, sessionId, messageId, 'unsupported');
      return;
    }
    const truncated = truncateFromUserMessage(
      ctl.transcript,
      messageId,
    );
    if (truncated === null) {
      ctl.emitSessionDiagnostic(
        'edit-resend-unsupported',
        EDIT_RESEND_UNSUPPORTED_MESSAGE,
      );
      emitEditResendRejected(ctl, sessionId, messageId, 'unsupported');
      return;
    }

    // Resendable payloads staged for this message: kept originals plus
    // anything added in edit mode. Non-restorable chips resend nothing.
    const editAttachments: readonly PendingAttachment[] =
      ctl.editStage?.messageId === messageId
        ? ctl.editStage.attachments.flatMap(({ summary, runtime: payload }) =>
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

    ctl.sessionOperationInProgress = true;
    void performEditResend(ctl, 
      runtime,
      sessionId,
      messageId,
      text,
      truncated,
      restoreFiles,
    ).then((forkedSessionId) => {
      ctl.sessionOperationInProgress = false;
      if (forkedSessionId === null) {
        return;
      }
      // Send first, then snapshot: the single snapshot then carries the
      // forked session id, the truncated transcript with the edited
      // prompt, and the submitting turn, so the webview adopts the fork
      // atomically.
      handleSend(ctl, 
        forkedSessionId,
        turnId,
        text,
        'edit-resend',
        editAttachments,
      );
      ctl.emitSnapshot();
    });
}

export function emitEditResendRejected(
  ctl: ChatControllerInternals,
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
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    sessionId: string,
    messageId: string,
    text: string,
    truncated: HostTranscriptState,
    restoreFiles: boolean,
  ): Promise<string | null> {
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd;
    if (cwd === null) {
      return null;
    }

    let forkedSessionId: string;
    try {
      const result = await runtime.rewind!({
        messageId,
        forkTitle: forkTitleFromText(text),
        restoreFiles,
      });
      forkedSessionId = result.sessionId;
    } catch {
      if (
        ctl.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        )
      ) {
        ctl.emitSessionDiagnostic(
          'edit-resend-failed',
          EDIT_RESEND_FAILED_MESSAGE,
        );
        emitEditResendRejected(ctl, sessionId, messageId, 'failed');
      }
      return null;
    }
    if (
      !ctl.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    ) {
      return null;
    }
    if (!isSafeBridgeId(forkedSessionId)) {
      ctl.emitSessionDiagnostic(
        'edit-resend-failed',
        EDIT_RESEND_FAILED_MESSAGE,
      );
      emitEditResendRejected(ctl, sessionId, messageId, 'failed');
      return null;
    }

    ctl.sessionId = forkedSessionId;
    ctl.transcript = truncated;
    ctl.turn = null;
    clearPendingAttachments(ctl);
    ctl.sessions = withActiveSession(ctl, ctl.sessions, {
      id: forkedSessionId,
      title: forkTitleFromText(text),
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    });
    ctl.recoveryStore.writeSession(forkedSessionId, truncated);
    ctl.recoveryStore.selectSession(forkedSessionId);
    void ctl.recoveryStore.flush();
    return forkedSessionId;
}

/**
 * Enters edit mode for one sent user message: initializes the edit
 * staging area from the retention area when the payloads are still
 * held, otherwise from the message's chip metadata (removable-only)
 * plus user-echo image items whose base64 is still in the transcript.
 */
export function handleEditStageBegin(
  ctl: ChatControllerInternals,
    sessionId: string,
    messageId: string,
  ): void {
    if (
      sessionId !== ctl.sessionId ||
      ctl.connection.status !== 'connected'
    ) {
      return;
    }
    const index = ctl.transcript.transcript.findIndex(
      (item) => item.kind === 'user' && item.messageId === messageId,
    );
    if (index < 0) {
      return;
    }
    ctl.editStage = {
      messageId,
      attachments: buildEditStageAttachments(ctl, messageId, index),
    };
    emitEditAttachments(ctl);
}

export function handleEditStageCancel(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    if (sessionId !== ctl.sessionId) {
      return;
    }
    ctl.editStage = null;
}

export function buildEditStageAttachments(
  ctl: ChatControllerInternals,
    messageId: string,
    userItemIndex: number,
  ): readonly EditStagedAttachment[] {
    const retained = ctl.sentAttachments.get(messageId);
    if (retained !== undefined) {
      return retained.map(({ summary, runtime }) => ({
        summary: { ...summary, restorable: true },
        runtime,
      }));
    }
    const staged: EditStagedAttachment[] = [];
    const userItem = ctl.transcript.transcript[userItemIndex];
    if (userItem?.kind === 'user' && userItem.attachments !== undefined) {
      for (const meta of userItem.attachments) {
        ctl.attachmentIdCounter += 1;
        staged.push({
          summary: {
            id: `attachment-${ctl.attachmentIdCounter}`,
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
    const transcript = ctl.transcript.transcript;
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
      ctl.attachmentIdCounter += 1;
      const restorable = item.data.length > 0;
      staged.push({
        summary: {
          id: `attachment-${ctl.attachmentIdCounter}`,
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
