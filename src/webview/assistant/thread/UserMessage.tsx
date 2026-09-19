// UserMessage: moved verbatim from Thread.tsx (structure-only refactor).

import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

import {
  MAX_ATTACHMENT_URI_COUNT,
  MAX_PENDING_ATTACHMENTS,
  MAX_TURN_TEXT_LENGTH,
} from '../../../shared/protocol/bounds';
import { type SentAttachmentSummary } from '../../../shared/protocol/attachments';
import { ComposerControls } from '../composer/ComposerControls';
import { parseSelectionQuote } from '../btw/selectionQuote';
import { parseDelegatedTask } from '../transcript/delegatedTask';
import { TranscriptImage } from '../images/TranscriptImage';
import {
  EDIT_REJECT_COPY,
  type EditResendRejection,
  type EditStageState,
  type RewindFileInfo,
} from '../editing/editTypes';
import { type UserEditorEnv } from '../editing/userEditorEnv';
import type { MessageEditor } from '../editing/useMessageEditor';
import { EditAttachmentChip, SentAttachmentChip } from '../attachments/AttachmentChip';
import { EditRestoreControl } from './EditRestoreControl';
import { SendIcon } from './icons';
import {
  isImageMediaType,
  readDroppedFileUris,
  readDroppedRemoteImageUrl,
  prepareAttachment,
} from '../attachments/attachmentIngress';

export { EDIT_REJECT_COPY } from '../editing/editTypes';

export function UserMessage({
  text,
  messageId,
  attachments,
  planLine = null,
  pinnedPlaceholder = false,
  placeholderHeight = 0,
  editor,
  editStage,
  rejection,
  editorEnv,
  editResendEnabled,
  rewindInfo,
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
  readonly placeholderHeight?: number;
  readonly editor: MessageEditor;
  readonly editStage: EditStageState | null;
  readonly rejection: EditResendRejection | null;
  readonly editorEnv: UserEditorEnv;
  readonly editResendEnabled: boolean;
  readonly rewindInfo: RewindFileInfo | null;
}): React.JSX.Element {
  const runtimeMessageId = useAuiState((state) => state.message.id);
  const draft = editor.draft?.messageId === messageId ? editor.draft : null;
  const editing = !pinnedPlaceholder && draft?.phase === 'editing';
  const resending = draft?.phase === 'resending';
  const editText = draft?.text ?? text;
  const restoreFiles = draft?.restoreFiles ?? false;
  const dropNotice = draft?.notice ?? null;
  const setDropNotice = (notice: string): void => {
    if (messageId !== null) editor.update(messageId, { notice });
  };
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const rememberSelection = (input: HTMLTextAreaElement, focused = true): void => {
    if (messageId === null) return;
    editor.selection.current = {
      messageId,
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
      scrollTop: input.scrollTop,
      focused,
    };
  };
  useLayoutEffect(() => {
    const input = editInputRef.current;
    if (!editing || input === null) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(168, Math.max(27, input.scrollHeight))}px`;
  }, [editText, editing]);
  useLayoutEffect(() => {
    const input = editInputRef.current;
    const selection = editor.selection.current;
    if (!editing || input === null || selection?.messageId !== messageId) return;
    if (selection.focused) {
      input.focus({ preventScroll: true });
    }
    input.setSelectionRange(selection.start, selection.end, selection.direction);
    input.scrollTop = selection.scrollTop;
    // Restoring focus can synchronously report the new element's default selection.
    editor.selection.current = selection;
  }, [editing, editor.selection, messageId]);
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
        event.target.closest('.dvx-image-lightbox') !== null
      ) {
        return;
      }
      // Dragging the transcript's native scrollbar is scrolling, not dismissal.
      if (
        event.target instanceof HTMLElement &&
        event.target.matches('.dvx-thread-viewport') &&
        event.clientX >=
          event.target.getBoundingClientRect().left + event.target.clientWidth
      ) {
        return;
      }
      if (
        card.querySelector('.dvx-composer-popover') !== null &&
        card.querySelector('[data-popover-closing]') === null
      ) {
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && card.contains(active)) {
        active.blur();
      }
      editor.cancel();
    };
    document.addEventListener('pointerdown', cancelOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', cancelOnOutsidePointerDown);
  }, [editing, editor.cancel]);
  const openEditor = (): void => {
    if (messageId !== null) {
      editor.begin(messageId, text);
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
    fileImpact === null ? 0 : fileImpact.restorableCount + fileImpact.createdCount;
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
  const settingsUpdating = editorEnv.settings.status === 'updating';
  const sendDisabled =
    !editResendEnabled || settingsUpdating || editText.trim().length === 0;
  const submitEdit = (): void => {
    if (messageId === null || sendDisabled) {
      return;
    }
    editor.submit(messageId, restoreFiles && affectedFiles > 0);
  };
  const stageEditFiles = (files: readonly File[]): void => {
    const remaining = Math.max(0, MAX_PENDING_ATTACHMENTS - stagedAttachments.length);
    if (files.length > remaining)
      setDropNotice(
        `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
      );
    for (const file of files.slice(0, remaining)) {
      void prepareAttachment(file).then((prepared) => {
        switch (prepared.kind) {
          case 'notice':
            setDropNotice(prepared.message);
            break;
          case 'image':
            editorEnv.onAttachImage(prepared.name, prepared.mediaType, prepared.data);
            break;
          case 'pdf':
            editorEnv.onAttachPdf(prepared.name, prepared.data);
            break;
          case 'text':
            editorEnv.onAttachTextFile(prepared.name, prepared.text, prepared.truncated);
            break;
        }
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
      <span
        className="dvx-question-anchor"
        data-question-id={runtimeMessageId}
        aria-hidden="true"
      />
      <MessagePrimitive.Root
        className={`dvx-message dvx-message-user${editing ? ' dvx-message-editing' : ''}${
          planLine !== null && !resending ? ' dvx-message-with-plan' : ''
        }${pinnedPlaceholder ? ' dvx-pinned-user-placeholder' : ''}`}
        data-aui-quote-selectable="false"
        data-pinned-placeholder={pinnedPlaceholder ? '' : undefined}
        inert={pinnedPlaceholder || undefined}
        style={
          pinnedPlaceholder && draft?.phase === 'editing' && placeholderHeight > 0
            ? { height: placeholderHeight }
            : undefined
        }
        aria-hidden={pinnedPlaceholder || undefined}
        aria-label={pinnedPlaceholder ? undefined : 'You'}
      >
        <div className="dvx-user-message-content">
          {editing ? (
            <div className="dvx-user-edit" ref={editCardRef}>
              <div
                className="dvx-user-edit-card"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(event) => {
                  if (handleEditDrop(event.dataTransfer)) {
                    event.preventDefault();
                  }
                }}
              >
                {stagedAttachments.length > 0 ? (
                  <div
                    className="dvx-attachment-chips dvx-user-edit-attachments"
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
                <textarea
                  ref={editInputRef}
                  className="dvx-user-edit-input"
                  aria-label="Edit message and resend"
                  value={editText}
                  maxLength={MAX_TURN_TEXT_LENGTH}
                  rows={1}
                  onChange={(event) => {
                    if (messageId !== null) {
                      editor.update(messageId, { text: event.currentTarget.value });
                      rememberSelection(event.currentTarget);
                    }
                  }}
                  onFocus={(event) => rememberSelection(event.currentTarget)}
                  onSelect={(event) =>
                    rememberSelection(
                      event.currentTarget,
                      document.activeElement === event.currentTarget,
                    )
                  }
                  onScroll={(event) =>
                    rememberSelection(
                      event.currentTarget,
                      document.activeElement === event.currentTarget,
                    )
                  }
                  onBlur={(event) => {
                    if (event.relatedTarget !== null) {
                      rememberSelection(event.currentTarget, false);
                    }
                  }}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData?.files ?? []).filter(
                      (file) => isImageMediaType(file.type),
                    );
                    if (files.length > 0) {
                      if (
                        (event.clipboardData?.getData('text/plain') ?? '').length === 0
                      ) {
                        event.preventDefault();
                      }
                      stageEditFiles(files);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitEdit();
                    } else if (event.key === 'Escape') {
                      editor.cancel();
                    }
                  }}
                />
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
                onRestoreFilesChange={(value) => {
                  if (messageId !== null) {
                    editor.update(messageId, { restoreFiles: value });
                  }
                }}
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
              className={`dvx-user-block${editable ? ' dvx-user-block-editable' : ''}`}
              title={editable ? 'Click to edit and resend from here' : undefined}
              role={editable ? 'button' : undefined}
              tabIndex={editable ? 0 : undefined}
              aria-label={editable ? 'Edit message and resend from here' : undefined}
              onClick={editable ? handleCardClick : undefined}
              onKeyDown={
                editable
                  ? (event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        openEditor();
                      }
                    }
                  : undefined
              }
            >
              <UserMessageParts />
              {attachments.some((attachment) => attachment.kind !== 'image') ? (
                <div
                  className="dvx-user-sent-attachments"
                  aria-label="Attachments sent with this message"
                >
                  {attachments
                    .filter((attachment) => attachment.kind !== 'image')
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
        if (part.type === 'data' && part.name === 'droid-image') {
          return <TranscriptImage data={part.data} />;
        }
        if (part.type !== 'text') {
          return null;
        }
        const delegated = parseDelegatedTask(part.text);
        return delegated === null ? (
          <div className="dvx-user-text">{part.text}</div>
        ) : (
          <div className="dvx-delegated-task">
            <div className="dvx-delegated-task-head">
              <span className="dvx-delegated-task-eyebrow">Delegated task</span>
              <span className="dvx-delegated-task-meta">
                {delegated.type}
                {delegated.complexity === null ? '' : ` · ${delegated.complexity}`}
              </span>
            </div>
            <strong className="dvx-delegated-task-title">{delegated.description}</strong>
            <div className="dvx-delegated-task-body">{delegated.task}</div>
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

function UserMessageParts(): React.JSX.Element {
  const runtimeQuote = useAuiState((state) => {
    const quote = state.message.metadata.custom?.quote;
    return typeof quote === 'object' &&
      quote !== null &&
      'text' in quote &&
      typeof quote.text === 'string'
      ? quote.text
      : null;
  });
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        if (part.type === 'data' && part.name === 'droid-image') {
          return <TranscriptImage data={part.data} />;
        }
        if (part.type !== 'text') {
          return null;
        }
        const parsed = parseSelectionQuote(part.text);
        const quote = runtimeQuote ?? parsed?.quote ?? null;
        return (
          <>
            {quote === null ? null : (
              <div className="dvx-user-quote" data-aui-quote-selectable>
                {quote}
              </div>
            )}
            <div className="dvx-user-text" data-aui-quote-selectable>
              {parsed?.body ?? part.text}
            </div>
          </>
        );
      }}
    </MessagePrimitive.Parts>
  );
}
