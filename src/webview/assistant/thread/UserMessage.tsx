// UserMessage: moved verbatim from Thread.tsx (structure-only refactor).

import { MessagePrimitive } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";

import {
  MAX_TURN_TEXT_LENGTH,
  type EditAttachmentSummary,
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
import { ATTACHMENT_KIND_LABELS } from "./Composer";
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
        card.querySelector(".dvx-composer-popover") !== null &&
        card.querySelector("[data-popover-closing]") === null
      ) {
        return;
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
    <MessagePrimitive.Root
      className={`dvx-message dvx-message-user${
        editing ? " dvx-message-editing" : ""
      }`}
      aria-label="You"
    >
      <div className="dvx-user-message-content">
        {editing ? (
          <div className="dvx-user-edit" ref={editCardRef}>
            <div className="dvx-user-edit-card">
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
              {stagedAttachments.length > 0 ? (
                <div
                  className="dvx-user-edit-attachments"
                  aria-label="Attachments to resend"
                >
                  {stagedAttachments.map((attachment) => (
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
              {affectedFiles > 0 ? (
                <label
                  className="dvx-user-edit-restore"
                  title={`Resending rewinds the conversation to this message. Also restore the ${affectedFiles} workspace ${
                    affectedFiles === 1 ? "file" : "files"
                  } Droid changed after it.`}
                >
                  <input
                    type="checkbox"
                    className="dvx-restore-input"
                    checked={restoreFiles}
                    onChange={(event) =>
                      setRestoreFiles(event.currentTarget.checked)
                    }
                  />
                  <span className="dvx-restore-box" aria-hidden="true">
                    <svg viewBox="0 0 10 10" fill="none">
                      <path
                        d="m2 5.2 2.2 2.2L8 3.2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="dvx-restore-copy">
                    Restore {affectedFiles}{" "}
                    {affectedFiles === 1 ? "file" : "files"} changed after this
                    point
                  </span>
                </label>
              ) : null}
              <div className="dvx-user-edit-footer">
                <ComposerControls
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
            <MessagePrimitive.Parts>
              {({ part }) =>
                part.type === "data" && part.name === "droid-image" ? (
                  <TranscriptImage data={part.data} />
                ) : part.type === "text" ? (
                  <div className="dvx-user-text">{part.text}</div>
                ) : null
              }
            </MessagePrimitive.Parts>
            {attachments.length > 0 ? (
              <div
                className="dvx-user-sent-attachments"
                aria-label="Attachments sent with this message"
              >
                {attachments.map((attachment, index) => (
                  <span
                    key={`${attachment.name}-${index}`}
                    className="dvx-attachment-chip dvx-attachment-sent"
                  >
                    <span className="dvx-attachment-kind">
                      {ATTACHMENT_KIND_LABELS[attachment.kind]}
                    </span>
                    <span
                      className="dvx-attachment-name"
                      title={attachment.name}
                    >
                      {attachment.name}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

export function EditAttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: EditAttachmentSummary;
  readonly onRemove: (attachmentId: string) => void;
}): React.JSX.Element {
  return (
    <span
      className={`dvx-attachment-chip${
        attachment.restorable ? "" : " dvx-attachment-unrestorable"
      }`}
    >
      <span className="dvx-attachment-kind">
        {ATTACHMENT_KIND_LABELS[attachment.kind]}
      </span>
      <span className="dvx-attachment-name" title={attachment.name}>
        {attachment.name}
      </span>
      {attachment.truncated ? (
        <span className="dvx-attachment-truncated">truncated</span>
      ) : null}
      {attachment.restorable ? null : (
        <span className="dvx-attachment-readd">re-add to include</span>
      )}
      <button
        type="button"
        className="dvx-attachment-remove"
        aria-label={`Remove attachment ${attachment.name}`}
        onClick={() => onRemove(attachment.id)}
      >
        ×
      </button>
    </span>
  );
}
