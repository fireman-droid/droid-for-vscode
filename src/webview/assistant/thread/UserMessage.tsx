// UserMessage: moved verbatim from Thread.tsx (structure-only refactor).

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_PDF_BYTES,
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_COUNT,
  MAX_PENDING_ATTACHMENTS,
  MAX_TURN_TEXT_LENGTH,
  type EditResendRejectReason,
  type SentAttachmentSummary,
} from "../../../shared/bridgeMessages";
import { ComposerControls } from "../ComposerControls";
import { parseSelectionQuote } from "../selectionQuote";
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
import {
  isImageMediaType,
  readDroppedFileUris,
  readDroppedRemoteImageUrl,
  readFileAsBase64,
} from "../attachmentIngress";

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
  pinnedPlaceholder = false,
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
   * directly under the question inside the same message surface (built
   * in Thread from planAnchors).
   */
  readonly planLine?: ReactNode;
  /**
   * The original message remains in the virtualized document as an
   * invisible layout placeholder while its pinned copy is painted at
   * the viewport edge.
   */
  readonly pinnedPlaceholder?: boolean;
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
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const resendResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearResendTimer = (): void => {
    if (resendResetRef.current !== null) {
      clearTimeout(resendResetRef.current);
      resendResetRef.current = null;
    }
  };
  useEffect(() => clearResendTimer, []);
  useLayoutEffect(() => {
    const input = editInputRef.current;
    if (!editing || input === null) {
      return;
    }
    input.style.height = "auto";
    input.style.height = `${Math.min(69, Math.max(42, input.scrollHeight))}px`;
  }, [editText, editing]);
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
  const stageEditFiles = (files: readonly File[]): void => {
    const remaining = Math.max(
      0,
      MAX_PENDING_ATTACHMENTS - stagedAttachments.length,
    );
    if (files.length > remaining) {
      setDropNotice(
        `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
      );
    }
    for (const file of files.slice(0, remaining)) {
      if (isImageMediaType(file.type)) {
        const mediaType = file.type;
        if (file.size === 0 || file.size > MAX_ATTACHMENT_IMAGE_BYTES) {
          setDropNotice(`${file.name || "Image"} is too large to attach.`);
          continue;
        }
        void readFileAsBase64(file).then((dataBase64) => {
          if (dataBase64 !== null) {
            editorEnv.onAttachImage(
              file.name || "pasted-image",
              mediaType,
              dataBase64,
            );
          }
        });
        continue;
      }
      if (
        file.type === "application/pdf" ||
        file.name.toLocaleLowerCase().endsWith(".pdf")
      ) {
        if (file.size === 0 || file.size > MAX_ATTACHMENT_PDF_BYTES) {
          setDropNotice(`${file.name || "PDF"} is too large to attach.`);
          continue;
        }
        void readFileAsBase64(file).then((dataBase64) => {
          if (dataBase64 !== null) {
            editorEnv.onAttachPdf(file.name || "document.pdf", dataBase64);
          }
        });
        continue;
      }
      const byteCap = MAX_ATTACHMENT_TEXT_FILE_CHARS * 4;
      const blob = file.size > byteCap ? file.slice(0, byteCap) : file;
      void blob.text().then((raw) => {
        if (raw.includes("\u0000")) {
          setDropNotice(`${file.name} is not a supported text file.`);
          return;
        }
        const truncated =
          file.size > byteCap || raw.length > MAX_ATTACHMENT_TEXT_FILE_CHARS;
        editorEnv.onAttachTextFile(
          file.name,
          truncated ? raw.slice(0, MAX_ATTACHMENT_TEXT_FILE_CHARS) : raw,
          truncated,
        );
      });
    }
  };
  const handleEditDrop = (dataTransfer: DataTransfer): boolean => {
    const uris = readDroppedFileUris(dataTransfer);
    if (uris.length > 0) {
      editorEnv.onAttachUris(uris.slice(0, MAX_ATTACHMENT_URI_COUNT));
      return true;
    }
    const files = Array.from(dataTransfer.files);
    if (files.length > 0) {
      stageEditFiles(files);
      return true;
    }
    const remote = readDroppedRemoteImageUrl(dataTransfer);
    if (remote !== null) {
      editorEnv.onAttachRemoteImage(remote);
      return true;
    }
    return false;
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
      }${pinnedPlaceholder ? " dvx-pinned-user-placeholder" : ""}`}
      data-aui-quote-selectable="false"
      data-pinned-placeholder={pinnedPlaceholder ? "" : undefined}
      aria-hidden={pinnedPlaceholder || undefined}
      aria-label={pinnedPlaceholder ? undefined : "You"}
    >
      <div className="dvx-user-message-content">
        {editing ? (
          <div className="dvx-user-edit" ref={editCardRef}>
            <div
              className="dvx-user-edit-card"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                if (handleEditDrop(event.dataTransfer)) {
                  event.preventDefault();
                }
              }}
            >
              <textarea
                ref={editInputRef}
                className="dvx-user-edit-input"
                aria-label="Edit message and resend"
                value={editText}
                maxLength={MAX_TURN_TEXT_LENGTH}
                rows={Math.min(3, Math.max(2, editText.split("\n").length))}
                autoFocus
                onChange={(event) => setEditText(event.currentTarget.value)}
                onPaste={(event) => {
                  const files = Array.from(
                    event.clipboardData?.files ?? [],
                  ).filter((file) => isImageMediaType(file.type));
                  if (files.length > 0) {
                    if (
                      (event.clipboardData?.getData("text/plain") ?? "")
                        .length === 0
                    ) {
                      event.preventDefault();
                    }
                    stageEditFiles(files);
                  }
                }}
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
                      image={editorEnv.attachmentImages[attachment.id]}
                      onRequestImage={editorEnv.onAttachmentReadImage}
                      onReplaceImage={editorEnv.onAttachmentReplaceImage}
                      onRemove={editorEnv.onAttachmentRemove}
                    />
                  ))}
                </div>
              ) : null}
              {dropNotice !== null ? (
                <div className="dvx-user-edit-rejection" role="status">
                  {dropNotice}
                </div>
              ) : null}
              {rejectionCopy !== null ? (
                <div className="dvx-user-edit-rejection" role="status">
                  {rejectionCopy}
                </div>
              ) : null}
              <div className="dvx-user-edit-footer">
                <button
                  className="dvx-composer-tool-button dvx-plus-button"
                  type="button"
                  aria-label="Attach files to edited message"
                  title="Attach files"
                  disabled={editorEnv.controlsDisabled}
                  onClick={editorEnv.onAttachFiles}
                >
                  +
                </button>
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
      data-aui-quote-selectable="false"
    >
      <div className="dvx-user-message-content">
        <div className="dvx-user-block">
          <ReadOnlyUserMessageParts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function ReadOnlyUserMessageParts(): React.JSX.Element {
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        if (part.type === "data" && part.name === "droid-image") {
          return <TranscriptImage data={part.data} />;
        }
        if (part.type !== "text") {
          return null;
        }
        const delegated = parseDelegatedTask(part.text);
        return delegated === null ? (
          <div className="dvx-user-text">{part.text}</div>
        ) : (
          <div className="dvx-delegated-task">
            <div className="dvx-delegated-task-head">
              <span className="dvx-delegated-task-eyebrow">
                Delegated task
              </span>
              <span className="dvx-delegated-task-meta">
                {delegated.type}
                {delegated.complexity === null
                  ? ""
                  : ` · ${delegated.complexity}`}
              </span>
            </div>
            <strong className="dvx-delegated-task-title">
              {delegated.description}
            </strong>
            <div className="dvx-delegated-task-body">
              {delegated.task}
            </div>
            <details className="dvx-delegated-task-details">
              <summary>Invocation details</summary>
              <pre>{part.text}</pre>
            </details>
          </div>
        );
      }}
    </MessagePrimitive.Parts>
  );
}

interface DelegatedTask {
  readonly type: string;
  readonly complexity: string | null;
  readonly description: string;
  readonly task: string;
}

function parseDelegatedTask(text: string): DelegatedTask | null {
  if (!text.startsWith("# Task Tool Invocation")) {
    return null;
  }
  const type = readInvocationField(text, "Subagent type");
  const description = readInvocationField(text, "Task description");
  const task = text.match(
    /## Task\s*\r?\n---BEGIN TASK FROM PARENT AGENT---\s*\r?\n([\s\S]*?)\r?\n---END TASK FROM PARENT AGENT---/,
  )?.[1]?.trim();
  if (type === null || description === null || !task) {
    return null;
  }
  return {
    type,
    complexity: readInvocationField(text, "Task complexity"),
    description,
    task,
  };
}

function readInvocationField(text: string, label: string): string | null {
  const prefix = `${label}:`;
  const line = text
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length).trim() ?? "";
  return value.length === 0 ? null : value;
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
  const runtimeQuote = useAuiState((state) => {
    const quote = state.message.metadata.custom?.quote;
    return typeof quote === "object" &&
      quote !== null &&
      "text" in quote &&
      typeof quote.text === "string"
      ? quote.text
      : null;
  });
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        if (part.type === "data" && part.name === "droid-image") {
          return <TranscriptImage data={part.data} />;
        }
        if (part.type !== "text") {
          return null;
        }
        const parsed = parseSelectionQuote(part.text);
        const quote = runtimeQuote ?? parsed?.quote ?? null;
        return (
          <>
            {quote === null ? null : (
              <div
                className="dvx-user-quote"
                data-aui-quote-selectable
              >
                {quote}
              </div>
            )}
            <div
              className="dvx-user-text"
              data-aui-quote-selectable
            >
              {parsed?.body ?? part.text}
            </div>
          </>
        );
      }}
    </MessagePrimitive.Parts>
  );
}
