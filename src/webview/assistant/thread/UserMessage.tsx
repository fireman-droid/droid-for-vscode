// UserMessage: moved verbatim from Thread.tsx (structure-only refactor).

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  MAX_TURN_TEXT_LENGTH,
  type EditResendRejectReason,
  type SentAttachmentSummary,
} from "../../../shared/bridgeMessages";
import { ComposerControls } from "../ComposerControls";
import { TranscriptImage } from "../TranscriptImage";
import type {
  EditResendRejection,
  EditStageState,
  RewindFileInfo,
  UserEditorEnv,
} from "../Thread";
import { EditAttachmentChip, SentAttachmentChip } from "./AttachmentChip";
import { EditRestoreControl } from "./EditRestoreControl";
import { SendIcon } from "./icons";

export const EDIT_REJECT_COPY: Record<EditResendRejectReason, string> = {
  busy: "Droid is busy — stop or finish the current work, then resend.",
  unsupported: "This message can no longer anchor a resend.",
  failed: "Rewinding to this message failed. You can try again.",
};

export function UserMessage({
  text,
  messageId,
  attachments,
  planLine = null,
  editing,
  editStage,
  rejection,
  editorEnv,
  editResendEnabled,
  rewindInfo,
  onRequestRewindInfo,
  onEditResend,
  onBeginEdit,
  onCancelEdit,
  onSubmitEdit,
  onReopenEdit,
}: {
  readonly text: string;
  readonly messageId: string | null;
  readonly attachments: readonly SentAttachmentSummary[];
  /**
   * The session's single latest plan line, when anchored here, rendered
   * directly under the question inside the same sticky block so the
   * pin coordinator carries it (built in Thread from planAnchors).
   */
  readonly planLine?: ReactNode;
  readonly editing: boolean;
  readonly editStage: EditStageState | null;
  readonly rejection: EditResendRejection | null;
  readonly editorEnv: UserEditorEnv;
  readonly editResendEnabled: boolean;
  readonly rewindInfo: RewindFileInfo | null;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly onEditResend: (
    messageId: string,
    text: string,
    restoreFiles?: boolean,
  ) => void;
  readonly onBeginEdit: (messageId: string) => void;
  readonly onCancelEdit: () => void;
  readonly onSubmitEdit: () => void;
  readonly onReopenEdit: (messageId: string) => void;
}): React.JSX.Element {
  const runtimeMessageId = useAuiState((state) => state.message.id);
  const [editText, setEditText] = useState(text);
  const [restoreFiles, setRestoreFiles] = useState(false);
  const [resending, setResending] = useState(false);
  const resendResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearResendTimer = (): void => {
    if (resendResetRef.current !== null) {
      clearTimeout(resendResetRef.current);
      resendResetRef.current = null;
    }
  };
  useEffect(() => clearResendTimer, []);
  // Opening the editor from viewing resets the draft to the sent text;
  // reopening after a rejection keeps the user's edited draft.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      if (!resending) {
        setEditText(text);
        setRestoreFiles(false);
      }
      setResending(false);
      clearResendTimer();
      if (messageId !== null) {
        onRequestRewindInfo(messageId);
      }
    }
    wasEditing.current = editing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  // A structured rejection of this card's resend returns it to the
  // editor deterministically; the 8s timer stays as a fallback only.
  useEffect(() => {
    if (rejection !== null && rejection.messageId === messageId && resending) {
      onReopenEdit(rejection.messageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rejection]);
  const editable = messageId !== null && !resending;
  // Clicking anywhere outside the edit card cancels the edit without
  // a confirmation (Cursor's light dismissal; Escape does the same
  // from the textarea). A popover open inside the card (mode/model
  // picker) consumes the first outside click to dismiss itself; the
  // editor only closes once no popover remains.
  const editCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!editing) {
      return undefined;
    }
    const cancelOnOutsidePointerDown = (event: PointerEvent): void => {
      const card = editCardRef.current;
      if (
        card === null ||
        !(event.target instanceof Node) ||
        card.contains(event.target)
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(".dvx-image-lightbox") !== null
      ) {
        return;
      }
      if (
        card.querySelector(".dvx-composer-popover") !== null &&
        card.querySelector("[data-popover-closing]") === null
      ) {
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && card.contains(active)) {
        active.blur();
      }
      onCancelEdit();
    };
    document.addEventListener("pointerdown", cancelOnOutsidePointerDown);
    return () =>
      document.removeEventListener(
        "pointerdown",
        cancelOnOutsidePointerDown,
      );
  }, [editing, onCancelEdit]);
  const openEditor = (): void => {
    if (messageId !== null) {
      onBeginEdit(messageId);
    }
  };
  const handleCardClick = (): void => {
    // A click that ends a text selection must not open the editor.
    if (window.getSelection()?.toString()) {
      return;
    }
    openEditor();
  };
  const fileImpact =
    editing && messageId !== null && rewindInfo?.messageId === messageId
      ? rewindInfo
      : null;
  const affectedFiles =
    fileImpact === null
      ? 0
      : fileImpact.restorableCount + fileImpact.createdCount;
  const affectedPaths =
    fileImpact === null
      ? []
      : [
          ...fileImpact.restorablePaths.map((path) => ({
            path,
            created: false,
          })),
          ...fileImpact.createdPaths.map((path) => ({
            path,
            created: true,
          })),
        ];
  const evictedFiles = fileImpact?.evictedFiles ?? [];
  const stagedAttachments =
    editing && editStage !== null && editStage.messageId === messageId
      ? editStage.attachments
      : [];
  const rejectionCopy =
    editing && rejection !== null && rejection.messageId === messageId
      ? EDIT_REJECT_COPY[rejection.reason]
      : null;
  const settingsUpdating = editorEnv.settings.status === "updating";
  const sendDisabled =
    !editResendEnabled || settingsUpdating || editText.trim().length === 0;
  const submitEdit = (): void => {
    if (messageId === null || sendDisabled) {
      return;
    }
    onSubmitEdit();
    setResending(true);
    onEditResend(messageId, editText, restoreFiles && affectedFiles > 0);
    // On success this component unmounts with the forked snapshot; a
    // structured rejection reopens the editor. The timer only recovers
    // the normal presentation if neither ever arrives.
    clearResendTimer();
    resendResetRef.current = setTimeout(() => setResending(false), 8000);
  };
  return (
    <>
    <span className="dvx-question-anchor" data-question-id={runtimeMessageId}
      aria-hidden="true" />
    <MessagePrimitive.Root
      className={`dvx-message dvx-message-user${
        editing ? " dvx-message-editing" : ""
      }${
        planLine !== null && !resending
          ? " dvx-message-with-plan"
          : ""
      }`}
      aria-label="You"
    >
      <div className="dvx-user-message-content">
        {editing ? (
          <div className="dvx-user-edit" ref={editCardRef}>
            <div className="dvx-user-edit-card">
              <div className="dvx-user-edit-images">
                <UserMessageImages />
              </div>
              <textarea
                className="dvx-user-edit-input"
                aria-label="Edit message and resend"
                value={editText}
                maxLength={MAX_TURN_TEXT_LENGTH}
                rows={Math.min(8, Math.max(2, editText.split("\n").length))}
                autoFocus
                onChange={(event) => setEditText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitEdit();
                  } else if (event.key === "Escape") {
                    onCancelEdit();
                  }
                }}
              />
              {stagedAttachments.some(
                (attachment) => attachment.kind !== "image",
              ) ? (
                <div
                  className="dvx-user-edit-attachments"
                  aria-label="Attachments to resend"
                >
                  {stagedAttachments
                    .filter((attachment) => attachment.kind !== "image")
                    .map((attachment) => (
                    <EditAttachmentChip
                      key={attachment.id}
                      attachment={attachment}
                      onRemove={editorEnv.onAttachmentRemove}
                    />
                  ))}
                </div>
              ) : null}
              {rejectionCopy !== null ? (
                <div className="dvx-user-edit-rejection" role="status">
                  {rejectionCopy}
                </div>
              ) : null}
              <div className="dvx-user-edit-footer">
                <ComposerControls
                  showSessionControls={false}
                  showContext={false}
                  settings={editorEnv.settings}
                  context={editorEnv.context}
                  modelCatalog={editorEnv.modelCatalog}
                  skills={editorEnv.skills}
                  mcp={editorEnv.mcp}
                  plugins={editorEnv.plugins}
                  disabled={editorEnv.controlsDisabled}
                  settingUpdatesDisabled={editorEnv.settingUpdatesDisabled}
                  onContextRefresh={editorEnv.onContextRefresh}
                  onCompact={editorEnv.onCompact}
                  onSettingUpdate={editorEnv.onSettingUpdate}
                  onSkillsRefresh={editorEnv.onSkillsRefresh}
                  onSkillToggle={editorEnv.onSkillToggle}
                  onMcpRefresh={editorEnv.onMcpRefresh}
                  onMcpServerToggle={editorEnv.onMcpServerToggle}
                  onMcpServerAdd={editorEnv.onMcpServerAdd}
                  onMcpServerRemove={editorEnv.onMcpServerRemove}
                  mcpAuth={editorEnv.mcpAuth}
                  onMcpServerAuthenticate={editorEnv.onMcpServerAuthenticate}
                  onPluginsRefresh={editorEnv.onPluginsRefresh}
                  onAttachFiles={editorEnv.onAttachFiles}
                  onAttachEditor={editorEnv.onAttachEditor}
                  onAttachSelection={editorEnv.onAttachSelection}
                  onAttachProblems={editorEnv.onAttachProblems}
                  onAttachGitChanges={editorEnv.onAttachGitChanges}
                />
                <div className="dvx-user-edit-actions">
                  <button
                    className="dvx-composer-action dvx-send-action"
                    type="button"
                    aria-label="Resend edited message"
                    disabled={sendDisabled}
                    onClick={submitEdit}
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
            </div>
            <EditRestoreControl
              affectedFiles={affectedFiles}
              affectedPaths={affectedPaths}
              evictedFiles={evictedFiles}
              restoreFiles={restoreFiles}
              onRestoreFilesChange={setRestoreFiles}
            />
          </div>
        ) : resending ? (
          <div className="dvx-user-resending">
            <div className="dvx-user-block">
              <div className="dvx-user-text">{editText}</div>
            </div>
            <div className="dvx-user-resending-note" role="status">
              <span className="dvx-user-resending-dot" aria-hidden="true" />
              Resending from here…
            </div>
          </div>
        ) : (
          <div
            className={`dvx-user-block${
              editable ? " dvx-user-block-editable" : ""
            }`}
            title={editable ? "Click to edit and resend from here" : undefined}
            role={editable ? "button" : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={
              editable ? "Edit message and resend from here" : undefined
            }
            onClick={editable ? handleCardClick : undefined}
            onKeyDown={
              editable
                ? (event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      openEditor();
                    }
                  }
                : undefined
            }
          >
            <UserMessageParts />
            {attachments.some((attachment) => attachment.kind !== "image") ? (
              <div
                className="dvx-user-sent-attachments"
                aria-label="Attachments sent with this message"
              >
                {attachments
                  .filter((attachment) => attachment.kind !== "image")
                  .map((attachment, index) => (
                    <SentAttachmentChip
                      key={`${attachment.name}-${index}`}
                      attachment={attachment}
                    />
                  ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {planLine}
    </MessagePrimitive.Root>
    </>
  );
}

/** Main user-bubble presentation without edit, rewind, or resend actions. */
export function ReadOnlyUserMessage(): React.JSX.Element {
  return (
    <MessagePrimitive.Root
      className="dvx-message dvx-message-user"
      aria-label="Delegated task"
    >
      <div className="dvx-user-message-content">
        <div className="dvx-user-block">
          <UserMessageParts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessageImages(): React.JSX.Element {
  return (
    <MessagePrimitive.Parts>
      {({ part }) =>
        part.type === "data" && part.name === "droid-image" ? (
          <TranscriptImage data={part.data} />
        ) : null
      }
    </MessagePrimitive.Parts>
  );
}

function UserMessageParts(): React.JSX.Element {
  return (
    <MessagePrimitive.Parts>
      {({ part }) =>
        part.type === "data" && part.name === "droid-image" ? (
          <TranscriptImage data={part.data} />
        ) : part.type === "text" ? (
          <div className="dvx-user-text">{part.text}</div>
        ) : null
      }
    </MessagePrimitive.Parts>
  );
}
