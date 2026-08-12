import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_COUNT,
  MAX_ATTACHMENT_URI_LENGTH,
  MAX_COMMAND_NAME_LENGTH,
  MAX_FILE_SEARCH_QUERY_LENGTH,
  MAX_PENDING_ATTACHMENTS,
  MAX_TURN_TEXT_LENGTH,
  type CommandSummary,
  type EditAttachmentSummary,
  type EditResendRejectReason,
  type ImageMediaType,
  type ModelCatalogState,
  type SentAttachmentSummary,
  type SessionCommandsState,
  type SessionHistoryStatus,
  type AttachmentSummary,
  type SessionContextState,
  type SessionSettingsState,
} from "../../shared/bridgeMessages";
import { isPreviewableFilePath } from "../../shared/validateMessage";
import type {
  McpAuthProgress,
  McpPanelState,
  McpServerAddParams,
  SkillsPanelState,
} from "./ComposerControls";
import {
  ComposerControls,
  type SessionSettingSelection,
} from "./ComposerControls";
import {
  ACTIVITY_GROUP_KEY,
  activityGroupBy,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from "./activityGrouping";
import { DroidMarkdownText } from "./MarkdownText";
import { ChangesCommitEntry } from "./GitCommitPanel";
import { TranscriptImage } from "./TranscriptImage";
import { getImagePreview, rememberImagePreview } from "./imagePreviewCache";

const THINKING_SMOOTH_OPTIONS = {
  drainMs: 480,
  maxCharIntervalMs: 12,
  maxCharsPerFrame: 12,
  minCommitMs: 48,
} as const;

/** Latest workspace search result delivered by the host. */
export interface FileSearchResult {
  readonly requestId: string;
  /** 'no-workspace' means no folder is open, so search cannot run. */
  readonly status: "ok" | "no-workspace";
  readonly files: readonly string[];
}

/** Command catalog for the `/` popup; 'idle' means not requested yet. */
export type SlashCommandsState =
  | SessionCommandsState
  | {
      readonly status: "idle";
      readonly items: readonly [];
      readonly recent: readonly [];
    };

/** How rewinding to one user message would affect workspace files. */
export interface RewindFileInfo {
  readonly messageId: string;
  readonly restorableCount: number;
  readonly createdCount: number;
}

/** Edit staging area contents for the message being edited. */
export interface EditStageState {
  readonly messageId: string;
  readonly attachments: readonly EditAttachmentSummary[];
}

/** Latest structured edit-resend rejection from the host. */
export interface EditResendRejection {
  readonly messageId: string;
  readonly reason: EditResendRejectReason;
  readonly sequence: number;
}

/**
 * Session-scoped controls and edit-scoped attachment callbacks the
 * in-card message editor needs; grouped so each user message takes a
 * single prop.
 */
export interface UserEditorEnv {
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly mcpAuth: McpAuthProgress | null;
  readonly controlsDisabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly onContextRefresh: () => void;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly onMcpServerAuthenticate: (name: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
}

// Tool rows deep inside the transcript open native diffs through this
// context so the memoized message tree stays free of prop drilling.
const FileDiffContext = createContext<(path: string) => void>(() => undefined);

// Previewing an .html/.htm prototype opens the sandboxed preview panel
// through this context, matching the FileDiffContext pattern so deep
// Changes/Tool rows stay free of prop drilling. Exported for focused
// tests that assert chip visibility and wiring.
export const PreviewContext = createContext<(path: string) => void>(
  () => undefined,
);

// Regenerating rewinds to the last user message and resends it. Null
// means the action is currently unavailable (no anchor or turn active).
const RegenerateContext = createContext<(() => void) | null>(null);

// The compaction divider offers a jump to the pre-compaction session
// through this context, keeping the memoized message tree free of
// prop drilling (same pattern as FileDiffContext).
const SelectSessionContext = createContext<
  ((sessionId: string) => void) | null
>(null);

interface DroidThreadProps {
  readonly pending: boolean;
  readonly activity?: "working" | "responding";
  /** True while a transcript activity row is live (see PendingResponse). */
  readonly activityLive: boolean;
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
  readonly hiddenMessageCount: number;
  readonly onShowEarlier: () => void;
  /** Switches to another session (compact divider history jump). */
  readonly onSelectSession: (sessionId: string) => void;
  readonly statusMessage?: string;
  readonly showRetry: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly interactionPending: boolean;
  readonly controlsDisabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly onRetry: () => void;
  readonly onContextRefresh: () => void;
  readonly compactPending: boolean;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  /** Starts a fresh session (skill changes apply at session start). */
  readonly onNewSession: () => void;
  readonly attachments: readonly AttachmentSummary[];
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly commands: SlashCommandsState;
  readonly onCommandsRefresh: () => void;
  readonly onAttachPath: (path: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachImage: (
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onAttachUris: (uris: readonly string[]) => void;
  readonly onAttachTextFile: (
    name: string,
    text: string,
    truncated: boolean,
  ) => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onEditResend: (
    messageId: string,
    text: string,
    restoreFiles?: boolean,
  ) => void;
  readonly rewindInfo: RewindFileInfo | null;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly editStage: EditStageState | null;
  readonly editResendRejection: EditResendRejection | null;
  /**
   * Committed-Composer-send counter. Each change closes any open
   * user-message edit card: sending a new message is an explicit
   * signal the user abandoned that edit, so its draft is discarded.
   */
  readonly sendSignal: number;
  readonly onEditStageBegin: (messageId: string) => void;
  readonly onEditStageCancel: () => void;
  readonly onEditAttachFiles: () => void;
  readonly onEditAttachEditor: () => void;
  readonly onEditAttachSelection: () => void;
  readonly onEditAttachProblems: () => void;
  readonly onEditAttachGitChanges: () => void;
  readonly onEditAttachmentRemove: (attachmentId: string) => void;
  readonly onRegenerate: (() => void) | null;
  readonly onOpenFileDiff: (path: string) => void;
  readonly onPreviewFile: (path: string) => void;
  readonly editResendEnabled: boolean;
  readonly inlineInteraction?: ReactNode;
}

export const DroidThread = memo(function DroidThread({
  pending,
  activity,
  activityLive,
  historyStatus,
  truncated,
  hiddenMessageCount,
  onShowEarlier,
  onSelectSession,
  statusMessage,
  showRetry,
  running,
  stopping,
  interactionPending,
  controlsDisabled,
  settingUpdatesDisabled,
  settings,
  context,
  modelCatalog,
  skills,
  mcp,
  onRetry,
  onContextRefresh,
  compactPending,
  onCompact,
  onSettingUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  onMcpServerAdd,
  onMcpServerRemove,
  mcpAuth,
  onMcpServerAuthenticate,
  onNewSession,
  attachments,
  fileSearch,
  onFileSearch,
  commands,
  onCommandsRefresh,
  onAttachPath,
  onAttachFiles,
  onAttachEditor,
  onAttachSelection,
  onAttachProblems,
  onAttachGitChanges,
  onAttachImage,
  onAttachUris,
  onAttachTextFile,
  onAttachmentRemove,
  onDraftChange,
  onEditResend,
  rewindInfo,
  onRequestRewindInfo,
  editStage,
  editResendRejection,
  sendSignal,
  onEditStageBegin,
  onEditStageCancel,
  onEditAttachFiles,
  onEditAttachEditor,
  onEditAttachSelection,
  onEditAttachProblems,
  onEditAttachGitChanges,
  onEditAttachmentRemove,
  onRegenerate,
  onOpenFileDiff,
  onPreviewFile,
  editResendEnabled,
  inlineInteraction,
}: DroidThreadProps): React.JSX.Element {
  // Only one message may be in edit mode at a time. Opening a new
  // target cancels the previous edit staging area on the host first.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const beginEditing = (messageId: string): void => {
    if (editingMessageId === messageId) {
      return;
    }
    if (editingMessageId !== null) {
      onEditStageCancel();
    }
    onEditStageBegin(messageId);
    setEditingMessageId(messageId);
  };
  const cancelEditing = (): void => {
    if (editingMessageId !== null) {
      onEditStageCancel();
    }
    setEditingMessageId(null);
  };
  // Submit keeps the host edit stage alive so the resend can consume
  // it; a structured rejection reopens the editor with the stage intact.
  const submitEditing = (): void => {
    setEditingMessageId(null);
  };
  const reopenEditing = (messageId: string): void => {
    setEditingMessageId(messageId);
  };
  // A committed Composer send closes any edit card left open above it,
  // discarding the abandoned edit draft and its host staging area.
  const lastSendSignalRef = useRef(sendSignal);
  useEffect(() => {
    if (lastSendSignalRef.current === sendSignal) {
      return;
    }
    lastSendSignalRef.current = sendSignal;
    if (editingMessageId !== null) {
      onEditStageCancel();
      setEditingMessageId(null);
    }
    // Runs only when a send commits; the guards above make the extra
    // dependencies inert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendSignal]);
  // Cursor-style pinned questions: every user message is CSS-sticky at
  // the viewport top; this coordinator marks the last stuck one as
  // `data-pinned` (opaque backdrop, separator), pushes it out when the
  // next user message reaches it, and hides fully covered ones.
  //
  // The same effect owns stick-to-bottom (the primitive's autoScroll
  // is disabled: its isAtBottom latch loses a race between async
  // scroll events and fast streaming growth, see applyFollowScroll).
  const readingColumnRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const column = readingColumnRef.current;
    if (column === null) {
      return undefined;
    }
    const scroller = column.closest(".dvx-thread-viewport");
    if (!(scroller instanceof HTMLElement)) {
      return undefined;
    }
    let frame = 0;
    const follow = createFollowState();
    const updatePins = (): void => {
      frame = 0;
      const viewportTop = scroller.getBoundingClientRect().top;
      const messages = [
        ...column.querySelectorAll<HTMLElement>(".dvx-message-user"),
      ];
      const rects = messages.map((element) => element.getBoundingClientRect());
      // An open edit card is exempt from the push-out hand-off (see
      // computeStickyLayout): it stays fully visible while pinned.
      const editingIndex = messages.findIndex((element) =>
        element.classList.contains("dvx-message-editing"),
      );
      const layout = computeStickyLayout(
        rects.map((rect) => rect.top),
        rects.map((rect) => rect.height),
        viewportTop,
        editingIndex,
      );
      messages.forEach((element, index) => {
        toggleDataAttribute(
          element,
          "data-pinned",
          index === layout.pinnedIndex,
        );
        toggleDataAttribute(
          element,
          "data-covered",
          layout.covered[index] === true,
        );
        const transform =
          index === layout.pinnedIndex && layout.pushPx > 0
            ? `translateY(${-layout.pushPx}px)`
            : "";
        if (element.style.transform !== transform) {
          element.style.transform = transform;
        }
      });
    };
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(updatePins);
      }
    };
    // Content growth (streaming rows, CSS height transitions, composer
    // resizes) glues the viewport to the bottom while following. The
    // write is marked so the resulting scroll event is never mistaken
    // for a user scroll.
    const followBottom = (): void => {
      if (follow.following) {
        const maxTop = scroller.scrollHeight - scroller.clientHeight;
        if (scroller.scrollTop < maxTop - 0.5) {
          follow.pendingProgrammaticTop = maxTop;
          scroller.scrollTop = maxTop;
        }
      }
      schedule();
    };
    const onScroll = (): void => {
      applyFollowScroll(follow, {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
      schedule();
    };
    // Wheel-up is an unambiguous user intent even when the scroll
    // event itself races a same-frame content growth.
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) {
        follow.following = false;
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(followBottom);
    resizeObserver?.observe(column);
    // The sticky footer (composer) lives inside the same scroller, so
    // its growth also moves the bottom edge.
    const footer = scroller.querySelector(".dvx-thread-footer");
    if (footer instanceof HTMLElement) {
      resizeObserver?.observe(footer);
    }
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    mutationObserver?.observe(column, { childList: true });
    updatePins();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
  const editorEnv = useMemo<UserEditorEnv>(
    () => ({
      settings,
      context,
      modelCatalog,
      skills,
      mcp,
      mcpAuth,
      controlsDisabled,
      settingUpdatesDisabled,
      onContextRefresh,
      onCompact,
      onSettingUpdate,
      onSkillsRefresh,
      onSkillToggle,
      onMcpRefresh,
      onMcpServerToggle,
      onMcpServerAdd,
      onMcpServerRemove,
      onMcpServerAuthenticate,
      onAttachFiles: onEditAttachFiles,
      onAttachEditor: onEditAttachEditor,
      onAttachSelection: onEditAttachSelection,
      onAttachProblems: onEditAttachProblems,
      onAttachGitChanges: onEditAttachGitChanges,
      onAttachmentRemove: onEditAttachmentRemove,
    }),
    [
      settings,
      context,
      modelCatalog,
      skills,
      mcp,
      mcpAuth,
      controlsDisabled,
      settingUpdatesDisabled,
      onContextRefresh,
      onCompact,
      onSettingUpdate,
      onSkillsRefresh,
      onSkillToggle,
      onMcpRefresh,
      onMcpServerToggle,
      onMcpServerAdd,
      onMcpServerRemove,
      onMcpServerAuthenticate,
      onEditAttachFiles,
      onEditAttachEditor,
      onEditAttachSelection,
      onEditAttachProblems,
      onEditAttachGitChanges,
      onEditAttachmentRemove,
    ],
  );
  return (
    <ThreadPrimitive.Root
      className={`dvx-thread${interactionPending ? " dvx-thread-pending" : ""}`}
    >
      <ThreadPrimitive.Viewport
        className="dvx-thread-viewport"
        aria-label="Chat transcript"
        // Continuous follow is owned by the coordinator above; the
        // primitive keeps only its one-shot scrolls (run start,
        // initialize, thread switch). See applyFollowScroll.
        autoScroll={false}
        turnAnchor="bottom"
        scrollToBottomOnRunStart
        scrollToBottomOnInitialize
        scrollToBottomOnThreadSwitch
      >
        <FileDiffContext.Provider value={onOpenFileDiff}>
          <PreviewContext.Provider value={onPreviewFile}>
          <RegenerateContext.Provider value={onRegenerate}>
            <SelectSessionContext.Provider value={onSelectSession}>
            <div className="dvx-reading-column" ref={readingColumnRef}>
              <HistoryNotice
                historyStatus={historyStatus}
                truncated={truncated}
              />
              {hiddenMessageCount > 0 ? (
                <button
                  type="button"
                  className="dvx-show-earlier"
                  onClick={onShowEarlier}
                >
                  Show earlier messages ({hiddenMessageCount} hidden)
                </button>
              ) : null}
              <ThreadPrimitive.Empty>
                <div className="dvx-empty-state">
                  <h2>Ready in your workspace</h2>
                  <p>
                    {historyStatus === "unavailable"
                      ? "Start a new message to continue this session."
                      : "Ask Droid to explain, inspect, or change your code."}
                  </p>
                </div>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  if (message.role !== "user") {
                    return <AssistantMessage />;
                  }
                  const messageId = readUserMessageId(message.metadata);
                  return (
                    <UserMessage
                      text={readMessageText(message.content)}
                      messageId={messageId}
                      attachments={readUserAttachments(message.metadata)}
                      editing={
                        messageId !== null && messageId === editingMessageId
                      }
                      editStage={editStage}
                      rejection={editResendRejection}
                      editorEnv={editorEnv}
                      editResendEnabled={editResendEnabled}
                      rewindInfo={rewindInfo}
                      onRequestRewindInfo={onRequestRewindInfo}
                      onEditResend={onEditResend}
                      onBeginEdit={beginEditing}
                      onCancelEdit={cancelEditing}
                      onSubmitEdit={submitEditing}
                      onReopenEdit={reopenEditing}
                    />
                  );
                }}
              </ThreadPrimitive.Messages>
              {pending ? (
                <PendingResponse
                  activity={activity}
                  activityLive={activityLive}
                />
              ) : null}
              {inlineInteraction}
            </div>
            </SelectSessionContext.Provider>
          </RegenerateContext.Provider>
          </PreviewContext.Provider>
        </FileDiffContext.Provider>
        <ThreadPrimitive.ViewportFooter className="dvx-thread-footer">
          <Composer
            statusMessage={statusMessage}
            showRetry={showRetry}
            running={running}
            stopping={stopping}
            interactionPending={interactionPending}
            controlsDisabled={controlsDisabled}
            settingUpdatesDisabled={settingUpdatesDisabled}
            settings={settings}
            context={context}
            modelCatalog={modelCatalog}
            skills={skills}
            mcp={mcp}
            onRetry={onRetry}
            onContextRefresh={onContextRefresh}
            compactPending={compactPending}
            onCompact={onCompact}
            onSettingUpdate={onSettingUpdate}
            onSkillsRefresh={onSkillsRefresh}
            onSkillToggle={onSkillToggle}
            onMcpRefresh={onMcpRefresh}
            onMcpServerToggle={onMcpServerToggle}
            onMcpServerAdd={onMcpServerAdd}
            onMcpServerRemove={onMcpServerRemove}
            mcpAuth={mcpAuth}
            onMcpServerAuthenticate={onMcpServerAuthenticate}
            onNewSession={onNewSession}
            attachments={attachments}
            fileSearch={fileSearch}
            onFileSearch={onFileSearch}
            commands={commands}
            onCommandsRefresh={onCommandsRefresh}
            onAttachPath={onAttachPath}
            onAttachFiles={onAttachFiles}
            onAttachEditor={onAttachEditor}
            onAttachSelection={onAttachSelection}
            onAttachProblems={onAttachProblems}
            onAttachGitChanges={onAttachGitChanges}
            onAttachImage={onAttachImage}
            onAttachUris={onAttachUris}
            onAttachTextFile={onAttachTextFile}
            onAttachmentRemove={onAttachmentRemove}
            onDraftChange={onDraftChange}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
});

const EDIT_REJECT_COPY: Record<EditResendRejectReason, string> = {
  busy: "Droid is busy — stop or finish the current work, then resend.",
  unsupported: "This message can no longer anchor a resend.",
  failed: "Rewinding to this message failed. You can try again.",
};

function UserMessage({
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
          <div className="dvx-user-edit">
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
                  onAttachFiles={editorEnv.onAttachFiles}
                  onAttachEditor={editorEnv.onAttachEditor}
                  onAttachSelection={editorEnv.onAttachSelection}
                  onAttachProblems={editorEnv.onAttachProblems}
                  onAttachGitChanges={editorEnv.onAttachGitChanges}
                />
                <div className="dvx-user-edit-actions">
                  <button
                    className="dvx-message-action"
                    type="button"
                    onClick={onCancelEdit}
                  >
                    Cancel
                  </button>
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

function EditAttachmentChip({
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

const AssistantMessage = memo(function AssistantMessage(): React.JSX.Element {
  // Entry animations are double-gated: the shell needs dvx-anim-live
  // (connected + active turn) and the message itself must be the one
  // streaming, so attaching the root class at turn start never
  // replays history rows. The action bar mounts after streaming
  // ends, so its fade keys off "was live in this mount" instead —
  // recovered history can never satisfy that.
  const running = useAuiState((s) => s.message.status?.type === "running");
  const wasRunningRef = useRef(false);
  if (running) {
    wasRunningRef.current = true;
  }
  return (
    <MessagePrimitive.Root
      className={`dvx-message dvx-message-assistant${
        running ? " dvx-message-live" : ""
      }`}
      aria-label="Droid"
    >
      <MessagePrimitive.GroupedParts
        groupBy={activityGroupBy}
        indicator="never"
      >
        {({ part, children }) => {
          switch (part.type) {
            case ACTIVITY_GROUP_KEY:
              return (
                <ActivityGroup indices={part.indices}>{children}</ActivityGroup>
              );
            case "text":
              return <DroidMarkdownText />;
            case "reasoning":
              return (
                <ThinkingRow
                  statusType={part.status?.type}
                  durationMs={readReasoningDuration(part)}
                />
              );
            case "tool-call":
              return (
                <ToolActivityRow
                  activity={readToolActivity(part)}
                  toolName={part.toolName}
                />
              );
            case "data":
              if (part.name === "droid-diagnostic") {
                return <Diagnostic data={part.data} />;
              }
              if (part.name === "droid-changes") {
                return <ChangesSummary data={part.data} />;
              }
              if (part.name === "droid-image") {
                return <TranscriptImage data={part.data} />;
              }
              return null;
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      <ActionBarPrimitive.Root
        className={`dvx-assistant-actions${
          !running && wasRunningRef.current ? " dvx-actions-entry" : ""
        }`}
        hideWhenRunning
      >
        <ActionBarPrimitive.Copy
          className="dvx-message-action dvx-copy-action"
          aria-label="Copy response"
          copiedDuration={1500}
        >
          <CopyActionContent />
        </ActionBarPrimitive.Copy>
        <MessagePrimitive.If last>
          <RegenerateAction />
        </MessagePrimitive.If>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
});

function RegenerateAction(): React.JSX.Element | null {
  const regenerate = useContext(RegenerateContext);
  const [busy, setBusy] = useState(false);
  const busyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (busyResetRef.current !== null) {
        clearTimeout(busyResetRef.current);
      }
    },
    [],
  );
  if (regenerate === null) {
    return null;
  }
  return (
    <button
      className="dvx-message-action"
      type="button"
      aria-label="Regenerate response"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        regenerate();
        // The forked snapshot replaces this thread on success; if the
        // host declines it only emits a diagnostic, so recover the
        // button after a grace period.
        if (busyResetRef.current !== null) {
          clearTimeout(busyResetRef.current);
        }
        busyResetRef.current = setTimeout(() => setBusy(false), 8000);
      }}
    >
      <RegenerateIcon />
      <span>{busy ? "Regenerating…" : "Regenerate"}</span>
    </button>
  );
}

function ToolFilePath({ path }: { readonly path: string }): React.JSX.Element {
  const openFileDiff = useContext(FileDiffContext);
  const fileName = path.split("/").at(-1) ?? path;
  return (
    <button
      type="button"
      className="dvx-tool-file"
      title={`Open changes for ${path}`}
      onClick={(event) => {
        // Keep the surrounding <details> row from toggling.
        event.preventDefault();
        event.stopPropagation();
        openFileDiff(path);
      }}
    >
      {fileName}
    </button>
  );
}

// Quiet sibling chip that opens the sandboxed preview panel. Only shown
// for self-contained .html/.htm prototypes, so the UI never offers a
// preview the host cannot render.
function PreviewChip({ path }: { readonly path: string }): React.JSX.Element {
  const openPreview = useContext(PreviewContext);
  return (
    <button
      type="button"
      className="dvx-preview-chip"
      title={`Preview ${path} in a sandboxed panel`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openPreview(path);
      }}
    >
      Preview
    </button>
  );
}

function ThinkingRow({
  statusType,
  durationMs,
}: {
  readonly statusType: string | undefined;
  readonly durationMs: number | null;
}): React.JSX.Element {
  // Expansion is per row: a shared toggle used to open every Thinking
  // row in the session at once, which stalled long transcripts for
  // seconds on a single click.
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="dvx-activity-row dvx-thinking-row"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span className="dvx-activity-indicator" />
        {statusType === "running" ? (
          <span className="dvx-shimmer-text">Thinking</span>
        ) : (
          formatThinkingLabel(statusType, durationMs)
        )}
        <ActivityChevron />
      </summary>
      <MessagePartPrimitive.Text
        className="dvx-thinking-content"
        component="pre"
        smooth={THINKING_SMOOTH_OPTIONS}
      />
    </details>
  );
}

interface ChangedFileEntry {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

function readChangedFiles(data: unknown): readonly ChangedFileEntry[] {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { files?: unknown }).files)
  ) {
    return [];
  }
  const files: ChangedFileEntry[] = [];
  for (const entry of (data as { files: unknown[] }).files) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== "string"
    ) {
      continue;
    }
    const { path, additions, deletions } = entry as {
      path: string;
      additions?: unknown;
      deletions?: unknown;
    };
    files.push({
      path,
      additions: typeof additions === "number" ? additions : null,
      deletions: typeof deletions === "number" ? deletions : null,
    });
  }
  return files;
}

function readChangesTurnId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const turnId = (data as { turnId?: unknown }).turnId;
  return typeof turnId === "string" && turnId !== "" ? turnId : null;
}

export function ChangesSummary({
  data,
}: {
  readonly data: unknown;
}): React.JSX.Element | null {
  const openFileDiff = useContext(FileDiffContext);
  const files = readChangedFiles(data);
  const turnId = readChangesTurnId(data);
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="dvx-changes" role="group" aria-label="Changed files">
      <span className="dvx-changes-label">
        Changes · {files.length} {files.length === 1 ? "file" : "files"}
      </span>
      <div className="dvx-changes-files">
        {files.map((file) => (
          <span key={file.path} className="dvx-changes-file-row">
            <button
              type="button"
              className="dvx-changes-file"
              title={`Open changes for ${file.path}`}
              onClick={() => openFileDiff(file.path)}
            >
              <span className="dvx-changes-name">
                {file.path.split("/").at(-1) ?? file.path}
              </span>
              {file.additions !== null || file.deletions !== null ? (
                <span className="dvx-changes-stats">
                  {file.additions !== null ? (
                    <span className="dvx-changes-add">+{file.additions}</span>
                  ) : null}
                  {file.deletions !== null ? (
                    <span className="dvx-changes-del">−{file.deletions}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
            {isPreviewableFilePath(file.path) ? (
              <PreviewChip path={file.path} />
            ) : null}
          </span>
        ))}
      </div>
      <ChangesCommitEntry turnId={turnId} />
    </div>
  );
}

function Diagnostic({ data }: { readonly data: unknown }): React.JSX.Element {
  const diagnostic = readDiagnostic(data);
  if (diagnostic.code === "session-compacted") {
    return (
      <CompactDivider
        message={diagnostic.message}
        previousSessionId={diagnostic.relatedSessionId}
      />
    );
  }
  return (
    <div
      className={`dvx-diagnostic dvx-diagnostic-${diagnostic.severity}`}
      role={diagnostic.severity === "error" ? "alert" : "status"}
      title={`${diagnostic.code}: ${diagnostic.message}`}
    >
      <code aria-hidden="true">{diagnostic.code}</code>
      <span>{diagnostic.message}</span>
    </div>
  );
}

/**
 * Short centered label for the compaction divider, derived from the
 * host's `session-compacted` diagnostic message ("Conversation
 * compacted: N earlier messages summarized.").
 */
export function formatCompactDividerLabel(message: string): string {
  const match = /(\d+) earlier message/.exec(message);
  if (match === null) {
    return "Conversation summarized";
  }
  const count = Number(match[1]);
  return `Summarized ${count} earlier ${count === 1 ? "message" : "messages"}`;
}

/**
 * Compaction record rendered as a quiet transcript divider (hairline
 * + centered label), Cursor-style, instead of a notice bar. Applies
 * to live compactions and reloaded history alike.
 */
function CompactDivider({
  message,
  previousSessionId,
}: {
  readonly message: string;
  readonly previousSessionId: string | null;
}): React.JSX.Element {
  const selectSession = useContext(SelectSessionContext);
  return (
    <div className="dvx-compact-divider" role="status" title={message}>
      <span className="dvx-compact-divider-label">
        <svg
          className="dvx-compact-divider-icon"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 1.5 6 4l3-2.5M3 10.5 6 8l3 2.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2.2 6h7.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        {formatCompactDividerLabel(message)}
        {previousSessionId !== null && selectSession !== null ? (
          <>
            {" · "}
            <button
              type="button"
              className="dvx-compact-divider-link"
              onClick={() => selectSession(previousSessionId)}
            >
              View full history
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}

export function PendingResponse({
  activity,
  activityLive = false,
}: {
  readonly activity?: "working" | "responding";
  /**
   * True while some transcript activity row (running tool, streaming
   * thinking) is already shimmering; the pending row then renders
   * statically so each turn keeps a single live indicator.
   */
  readonly activityLive?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`dvx-message dvx-message-assistant dvx-pending${
        activityLive ? " dvx-pending-quiet" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="dvx-runtime-pulse" aria-hidden="true" />
      <span className={activityLive ? "dvx-pending-label" : "dvx-shimmer-text"}>
        {activity === "working" ? "Droid is working" : "Droid is responding"}
      </span>
    </div>
  );
}

function Composer({
  statusMessage,
  showRetry,
  running,
  stopping,
  interactionPending,
  controlsDisabled,
  settingUpdatesDisabled,
  settings,
  context,
  modelCatalog,
  skills,
  mcp,
  onRetry,
  onContextRefresh,
  compactPending,
  onCompact,
  onSettingUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  onMcpServerAdd,
  onMcpServerRemove,
  mcpAuth,
  onMcpServerAuthenticate,
  onNewSession,
  attachments,
  fileSearch,
  onFileSearch,
  commands,
  onCommandsRefresh,
  onAttachPath,
  onAttachFiles,
  onAttachEditor,
  onAttachSelection,
  onAttachProblems,
  onAttachGitChanges,
  onAttachImage,
  onAttachUris,
  onAttachTextFile,
  onAttachmentRemove,
  onDraftChange,
}: {
  readonly statusMessage?: string;
  readonly showRetry: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly interactionPending: boolean;
  readonly controlsDisabled: boolean;
  readonly settingUpdatesDisabled: boolean;
  readonly settings: SessionSettingsState;
  readonly context: SessionContextState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly onRetry: () => void;
  readonly onContextRefresh: () => void;
  readonly compactPending: boolean;
  readonly onCompact: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onMcpServerAdd: (params: McpServerAddParams) => void;
  readonly onMcpServerRemove: (name: string) => void;
  readonly mcpAuth: McpAuthProgress | null;
  readonly onMcpServerAuthenticate: (name: string) => void;
  /** Starts a fresh session (skill changes apply at session start). */
  readonly onNewSession: () => void;
  readonly attachments: readonly AttachmentSummary[];
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly commands: SlashCommandsState;
  readonly onCommandsRefresh: () => void;
  readonly onAttachPath: (path: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachImage: (
    name: string,
    mediaType: ImageMediaType,
    dataBase64: string,
  ) => void;
  readonly onAttachUris: (uris: readonly string[]) => void;
  readonly onAttachTextFile: (
    name: string,
    text: string,
    truncated: boolean,
  ) => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
  readonly onDraftChange: (draft: string) => void;
}): React.JSX.Element {
  const aui = useAui();
  const draftRef = useRef("");
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const searchCounterRef = useRef(0);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  // Transient user-visible feedback for drops that stage nothing
  // (binary files, oversized images, staging area full).
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const dropNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (dropNoticeTimer.current !== null) {
        clearTimeout(dropNoticeTimer.current);
      }
    },
    [],
  );
  const showDropNotice = (message: string): void => {
    setDropNotice(message);
    if (dropNoticeTimer.current !== null) {
      clearTimeout(dropNoticeTimer.current);
    }
    dropNoticeTimer.current = setTimeout(() => setDropNotice(null), 5000);
  };

  /**
   * Stages one image file through the host attachment pipeline and
   * remembers its data URL locally so the pending chip can render a
   * thumbnail without the bytes crossing the bridge again.
   */
  const stageImageFile = (file: File): void => {
    if (file.size === 0 || file.size > MAX_ATTACHMENT_IMAGE_BYTES) {
      showDropNotice(
        `${file.name || "Image"} is too large to attach (4 MB max).`,
      );
      return;
    }
    const mediaType = file.type as ImageMediaType;
    const name = file.name.trim().length > 0 ? file.name : "pasted-image";
    void readFileAsBase64(file).then((dataBase64) => {
      if (dataBase64 !== null) {
        rememberImagePreview(
          name,
          file.size,
          `data:${mediaType};base64,${dataBase64}`,
        );
        onAttachImage(name, mediaType, dataBase64);
      }
    });
  };

  /**
   * Stages one non-image dropped file as a text attachment. The bytes
   * never leave the webview unless they decode as NUL-free text within
   * the shared character cap; binary or unreadable files produce a
   * visible notice instead.
   */
  const stageDroppedTextFile = async (file: File): Promise<void> => {
    if (file.size === 0) {
      showDropNotice(`${file.name} is empty and was not attached.`);
      return;
    }
    // UTF-16 length ≤ UTF-8 byte length, so 4× the character cap is
    // always enough bytes to fill the cap; larger files are cut here
    // to avoid decoding unbounded content in the webview.
    const byteCap = MAX_ATTACHMENT_TEXT_FILE_CHARS * 4;
    const blob = file.size > byteCap ? file.slice(0, byteCap) : file;
    let raw: string;
    try {
      raw = await blob.text();
    } catch {
      showDropNotice(`${file.name} could not be read.`);
      return;
    }
    if (raw.includes("\u0000")) {
      showDropNotice(
        `${file.name} is not a text file. Use “+” → Attach files instead.`,
      );
      return;
    }
    const truncated =
      file.size > byteCap || raw.length > MAX_ATTACHMENT_TEXT_FILE_CHARS;
    const text = truncated ? raw.slice(0, MAX_ATTACHMENT_TEXT_FILE_CHARS) : raw;
    onAttachTextFile(file.name, text, truncated);
  };

  /**
   * Stages dropped or pasted files: images through the base64 image
   * path, everything else as decoded text files. The list is truncated
   * to the remaining staging slots so the host limit diagnostic never
   * fires from a single multi-file drop.
   */
  const stageDroppedFiles = (files: readonly File[]): void => {
    const remaining = MAX_PENDING_ATTACHMENTS - attachments.length;
    if (files.length > remaining) {
      showDropNotice(
        `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
      );
    }
    for (const file of files.slice(0, Math.max(remaining, 0))) {
      if (isImageMediaType(file.type)) {
        stageImageFile(file);
      } else {
        void stageDroppedTextFile(file);
      }
    }
  };

  /**
   * Routes one composer drop. Editor explorer drags carry `file://`
   * URIs that the host resolves against the workspace; system file
   * manager drags carry the file bytes directly.
   */
  const handleComposerDrop = (dataTransfer: DataTransfer): boolean => {
    const uris = readDroppedFileUris(dataTransfer);
    if (uris.length > 0) {
      const remaining = MAX_PENDING_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showDropNotice(
          `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
        );
        return true;
      }
      if (uris.length > remaining) {
        showDropNotice(
          `Up to ${MAX_PENDING_ATTACHMENTS} attachments can be staged for one message.`,
        );
      }
      onAttachUris(
        uris.slice(0, Math.min(remaining, MAX_ATTACHMENT_URI_COUNT)),
      );
      return true;
    }
    const files = Array.from(dataTransfer.files);
    if (files.length > 0) {
      stageDroppedFiles(files);
      return true;
    }
    return false;
  };

  // Load the command catalog lazily when the `/` popup first opens;
  // reopening after an error retries the fetch. `controlsDisabled`
  // mirrors the host guard that swallows the refresh while the bridge
  // is not connected, so a popup opened early re-requests the catalog
  // once the connection comes up. Enabled skills fill the popup's
  // Skills section, so they load on the same trigger.
  const slashOpen = slash !== null;
  const commandsStatus = commands.status;
  const skillsStatus = skills.status;
  useEffect(() => {
    if (slashOpen && !controlsDisabled) {
      if (commandsStatus === "idle" || commandsStatus === "error") {
        onCommandsRefresh();
      }
      if (skillsStatus === "idle") {
        onSkillsRefresh();
      }
    }
    // Refetch only on open/close and connection transitions.
  }, [slashOpen, controlsDisabled]);

  const commandMatches =
    slash !== null ? filterSlashCommands(commands, slash.query) : [];
  const builtInMatches =
    slash !== null
      ? BUILT_IN_COMMANDS.filter((command) =>
          command.name.startsWith(slash.query.toLocaleLowerCase()),
        )
      : [];
  // Enabled skills surface here as prompt helpers: Droid has no
  // native skill-invocation RPC (`userInvocable` exists on SkillInfo
  // but no channel executes it), so selecting one inserts guiding
  // text instead of pretending to run the skill.
  const skillMatches =
    slash !== null
      ? skills.items
          .filter(
            (skill) =>
              skill.enabled &&
              skill.name
                .toLocaleLowerCase()
                .startsWith(slash.query.toLocaleLowerCase()),
          )
          .slice(0, MAX_SLASH_SKILL_MATCHES)
      : [];
  // One flat list drives keyboard navigation across the sections.
  const slashEntries: readonly SlashEntry[] = [
    ...builtInMatches.map(
      (command): SlashEntry => ({ kind: "builtin", ...command }),
    ),
    ...commandMatches.map(
      (command): SlashEntry => ({ kind: "command", command }),
    ),
    ...skillMatches.map(
      (skill): SlashEntry => ({
        kind: "skill",
        name: skill.name,
        description: skill.description,
      }),
    ),
  ];
  // Built-ins are always available, so the popup shows whenever a
  // `/` token is active; the custom section keeps its own
  // loading/error/empty feedback rows.
  const slashVisible = slashOpen;

  const closeSlash = (): void => {
    setSlash(null);
    setSlashIndex(0);
  };

  /** Completes the draft to `/name ` without sending. */
  const selectCommand = (name: string): void => {
    if (slash === null) {
      return;
    }
    const next = `/${name} ` + draftRef.current.slice(slash.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeSlash();
  };

  /** Replaces the `/` token with guiding text for one skill. */
  const selectSkillGuide = (name: string): void => {
    if (slash === null) {
      return;
    }
    const next =
      `Use the "${name}" skill: ` + draftRef.current.slice(slash.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeSlash();
  };

  const selectSlashEntry = (entry: SlashEntry): void => {
    if (entry.kind === "skill") {
      selectSkillGuide(entry.name);
    } else {
      selectCommand(
        entry.kind === "command" ? entry.command.name : entry.name,
      );
    }
  };

  // Debounce host searches while the user types the mention query.
  useEffect(() => {
    if (mention === null || mention.query.length === 0) {
      setActiveRequestId(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      searchCounterRef.current += 1;
      const requestId = `file-search-${searchCounterRef.current}`;
      setActiveRequestId(requestId);
      onFileSearch(requestId, mention.query);
    }, 150);
    return () => clearTimeout(timer);
  }, [mention, onFileSearch]);

  const results =
    mention !== null &&
    activeRequestId !== null &&
    fileSearch !== null &&
    fileSearch.requestId === activeRequestId
      ? fileSearch.files
      : [];
  // True from the first typed query character until the host answers
  // the active search request (covers the debounce window too).
  const searchPending =
    mention !== null &&
    mention.query.length > 0 &&
    (activeRequestId === null ||
      fileSearch === null ||
      fileSearch.requestId !== activeRequestId);

  const closeMention = (): void => {
    setMention(null);
    setActiveRequestId(null);
    setActiveIndex(0);
  };

  const selectMention = (path: string): void => {
    if (mention === null) {
      return;
    }
    onAttachPath(path);
    const draft = draftRef.current;
    const next = draft.slice(0, mention.start) + draft.slice(mention.end);
    draftRef.current = next;
    aui.thread.composer().setText(next);
    onDraftChange(next);
    closeMention();
  };

  return (
    <div className="dvx-composer-wrap">
      <div className="dvx-composer-seam" aria-hidden="true" />
      <ComposerPrimitive.Root
        className={`dvx-composer${
          interactionPending ? " dvx-composer-pending" : ""
        }${dragActive ? " dvx-composer-dragover" : ""}`}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          if (
            types.includes("Files") ||
            types.includes("text/uri-list") ||
            types.includes("application/vnd.code.uri-list")
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          setDragActive(false);
          if (handleComposerDrop(event.dataTransfer)) {
            event.preventDefault();
          }
        }}
      >
        {attachments.length > 0 && !interactionPending ? (
          <div
            className="dvx-attachment-chips"
            aria-label="Pending attachments"
          >
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={onAttachmentRemove}
              />
            ))}
          </div>
        ) : null}
        {interactionPending ? null : (
          <>
            <label className="dvx-visually-hidden" htmlFor="dvx-prompt">
              Message Droid
            </label>
            {slashVisible ? (
              <div
                className="dvx-mention-popup dvx-command-popup"
                role="listbox"
                aria-label="Droid commands"
              >
                {builtInMatches.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Built-in
                  </div>
                ) : null}
                {builtInMatches.map((command, index) => (
                  <button
                    key={`builtin:${command.name}`}
                    type="button"
                    role="option"
                    aria-selected={index === slashIndex}
                    className={`dvx-mention-item${
                      index === slashIndex ? " dvx-mention-active" : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectCommand(command.name);
                    }}
                    onMouseEnter={() => setSlashIndex(index)}
                  >
                    <span className="dvx-command-title">
                      <span className="dvx-command-name">/{command.name}</span>
                    </span>
                    <span className="dvx-command-desc">
                      {command.description}
                    </span>
                  </button>
                ))}
                {commandMatches.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Commands (.factory/commands)
                  </div>
                ) : null}
                {commandMatches.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    role="option"
                    aria-selected={
                      builtInMatches.length + index === slashIndex
                    }
                    className={`dvx-mention-item${
                      builtInMatches.length + index === slashIndex
                        ? " dvx-mention-active"
                        : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectCommand(command.name);
                    }}
                    onMouseEnter={() =>
                      setSlashIndex(builtInMatches.length + index)
                    }
                  >
                    <span className="dvx-command-title">
                      <span className="dvx-command-name">/{command.name}</span>
                      {command.argumentHint !== null ? (
                        <span className="dvx-command-hint">
                          {command.argumentHint}
                        </span>
                      ) : null}
                    </span>
                    {command.description !== null ? (
                      <span className="dvx-command-desc">
                        {command.description}
                      </span>
                    ) : null}
                  </button>
                ))}
                {commandMatches.length === 0 ? (
                  <div className="dvx-command-status" role="status">
                    {commands.status === "loading"
                      ? "Loading commands…"
                      : commands.status === "error"
                        ? commands.message
                        : slash !== null && slash.query.length === 0
                          ? "No custom commands (.factory/commands)"
                          : "No matching commands"}
                  </div>
                ) : null}
                {skillMatches.length > 0 ? (
                  <div className="dvx-command-section" role="presentation">
                    Skills (inserts a prompt)
                  </div>
                ) : null}
                {skillMatches.map((skill, index) => (
                  <button
                    key={`skill:${skill.name}`}
                    type="button"
                    role="option"
                    aria-selected={
                      builtInMatches.length + commandMatches.length + index ===
                      slashIndex
                    }
                    className={`dvx-mention-item${
                      builtInMatches.length + commandMatches.length + index ===
                      slashIndex
                        ? " dvx-mention-active"
                        : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectSkillGuide(skill.name);
                    }}
                    onMouseEnter={() =>
                      setSlashIndex(
                        builtInMatches.length + commandMatches.length + index,
                      )
                    }
                  >
                    <span className="dvx-command-title">
                      <span className="dvx-command-name">{skill.name}</span>
                    </span>
                    {skill.description !== null ? (
                      <span className="dvx-command-desc">
                        {skill.description}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            {mention !== null ? (
              <div
                className="dvx-mention-popup"
                role="listbox"
                aria-label="Attach workspace file"
              >
                {results.map((path, index) => (
                  <button
                    key={path}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`dvx-mention-item${
                      index === activeIndex ? " dvx-mention-active" : ""
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectMention(path);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="dvx-mention-name">
                      {path.split("/").at(-1)}
                    </span>
                    <span className="dvx-mention-path">{path}</span>
                  </button>
                ))}
                {results.length === 0 ? (
                  <div className="dvx-command-status" role="status">
                    {mention.query.length === 0
                      ? "Type to search workspace files"
                      : searchPending
                        ? "Searching files…"
                        : activeRequestId !== null &&
                            fileSearch?.requestId === activeRequestId &&
                            fileSearch.status === "no-workspace"
                          ? "No folder is open in this window."
                          : "No matching files"}
                  </div>
                ) : null}
              </div>
            ) : null}
            <ComposerPrimitive.Input
              id="dvx-prompt"
              className="dvx-composer-input"
              placeholder={
                settings.value?.interactionMode === "spec"
                  ? "Describe what to plan…"
                  : "Ask Droid about your workspace"
              }
              rows={1}
              maxLength={MAX_TURN_TEXT_LENGTH}
              submitMode="enter"
              addAttachmentOnPaste={false}
              onPaste={(event) => {
                // Screenshots and copied image files stage as
                // attachments; plain-text pastes keep default
                // behavior.
                const files = Array.from(
                  event.clipboardData?.files ?? [],
                ).filter((file) => isImageMediaType(file.type));
                if (files.length > 0) {
                  event.preventDefault();
                  stageDroppedFiles(files);
                }
              }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                draftRef.current = value;
                onDraftChange(value);
                const caret =
                  event.currentTarget.selectionStart ?? value.length;
                const nextMention = findMentionToken(value, caret);
                setMention(nextMention);
                setActiveIndex(0);
                setSlash(findSlashToken(value, caret));
                setSlashIndex(0);
              }}
              onKeyDown={(event) => {
                if (slashVisible) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSlash();
                    return;
                  }
                  if (slashEntries.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSlashIndex(
                        (index) => (index + 1) % slashEntries.length,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSlashIndex(
                        (index) =>
                          (index - 1 + slashEntries.length) %
                          slashEntries.length,
                      );
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      const entry = slashEntries[slashIndex];
                      if (entry !== undefined) {
                        selectSlashEntry(entry);
                      }
                      return;
                    }
                  }
                }
                if (mention === null) {
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMention();
                  return;
                }
                if (results.length === 0) {
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % results.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (index) => (index - 1 + results.length) % results.length,
                  );
                } else if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  const path = results[activeIndex];
                  if (path !== undefined) {
                    selectMention(path);
                  }
                }
              }}
            />
          </>
        )}
        {dropNotice !== null && !interactionPending ? (
          <div className="dvx-composer-notice" role="status">
            {dropNotice}
          </div>
        ) : null}
        {statusMessage !== undefined && !interactionPending ? (
          <div className="dvx-composer-status" aria-live="polite">
            {statusMessage}
          </div>
        ) : null}
        <div className="dvx-composer-footer">
          <ComposerControls
            settings={settings}
            context={context}
            modelCatalog={modelCatalog}
            skills={skills}
            mcp={mcp}
            disabled={controlsDisabled}
            settingUpdatesDisabled={settingUpdatesDisabled}
            onContextRefresh={onContextRefresh}
            compactPending={compactPending}
            onCompact={onCompact}
            onSettingUpdate={onSettingUpdate}
            onSkillsRefresh={onSkillsRefresh}
            onSkillToggle={onSkillToggle}
            onMcpRefresh={onMcpRefresh}
            onMcpServerToggle={onMcpServerToggle}
            onMcpServerAdd={onMcpServerAdd}
            onMcpServerRemove={onMcpServerRemove}
            mcpAuth={mcpAuth}
            onMcpServerAuthenticate={onMcpServerAuthenticate}
            onNewSession={onNewSession}
            onAttachFiles={onAttachFiles}
            onAttachEditor={onAttachEditor}
            onAttachSelection={onAttachSelection}
            onAttachProblems={onAttachProblems}
            onAttachGitChanges={onAttachGitChanges}
          />
          {showRetry ? (
            <button
              className="dvx-composer-action"
              type="button"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : running ? (
            <ComposerPrimitive.Cancel
              className="dvx-composer-action dvx-stop-action"
              disabled={stopping}
            >
              Stop
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send
              className="dvx-composer-action dvx-send-action"
              aria-label="Send"
            >
              <SendIcon />
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
      <div className="dvx-composer-hint">
        {interactionPending
          ? "Pending request · Complete the action above"
          : running
            ? "Droid is active · Stop before sending another message"
            : "Enter to send · Shift+Enter for a new line"}
      </div>
    </div>
  );
}

interface MentionToken {
  /** Index of the `@` character in the draft. */
  readonly start: number;
  /** Caret position; the token spans start..end. */
  readonly end: number;
  readonly query: string;
}

/**
 * Finds an `@file` mention token ending at the caret. The `@` must
 * not directly follow an ASCII word character, `@`, or the email-like
 * `.`/`-` (so `user@host` never triggers); anything else — start of
 * draft, whitespace, CJK text, punctuation — allows the mention.
 */
export function findMentionToken(
  value: string,
  caret: number,
): MentionToken | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) {
    return null;
  }
  const preceding = before[at - 1];
  if (preceding !== undefined && /[A-Za-z0-9_@.-]/.test(preceding)) {
    return null;
  }
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query) || query.length > MAX_FILE_SEARCH_QUERY_LENGTH) {
    return null;
  }
  return { start: at, end: caret, query };
}

interface SlashToken {
  /** Caret position; the token spans 0..end. */
  readonly end: number;
  readonly query: string;
}

/**
 * GUI-provided slash commands. Both route through existing bridge
 * channels (`session.compact`, `session.new`) via the `handleSend`
 * interception in App.tsx — no invented Droid capabilities.
 */
export const BUILT_IN_COMMANDS = [
  {
    name: "compact",
    description: "Summarize earlier messages to free context",
  },
  { name: "new", description: "Start a new session" },
] as const;

/** Most enabled skills offered in the `/` popup Skills section. */
const MAX_SLASH_SKILL_MATCHES = 5;

/** One selectable row in the `/` popup, across all three sections. */
type SlashEntry =
  | { readonly kind: "builtin"; readonly name: string; readonly description: string }
  | { readonly kind: "command"; readonly command: CommandSummary }
  | {
      readonly kind: "skill";
      readonly name: string;
      readonly description: string | null;
    };

/**
 * Finds a `/command` token when the draft starts with `/` and the
 * caret is still inside the command slug (no whitespace typed yet).
 */
export function findSlashToken(
  value: string,
  caret: number,
): SlashToken | null {
  if (!value.startsWith("/") || caret < 1) {
    return null;
  }
  const query = value.slice(1, caret);
  if (/[\s/@]/.test(query) || query.length > MAX_COMMAND_NAME_LENGTH) {
    return null;
  }
  return { end: caret, query };
}

/**
 * Filters the catalog to non-executable commands matching the typed
 * query, recent commands first, the rest alphabetical.
 */
export function filterSlashCommands(
  commands: SlashCommandsState,
  query: string,
): readonly CommandSummary[] {
  const lowered = query.toLowerCase();
  const matches = commands.items.filter(
    (item) =>
      !item.isExecutable &&
      (lowered.length === 0 || item.name.toLowerCase().includes(lowered)),
  );
  const recentRank = new Map(
    commands.recent.map((name, index) => [name, index]),
  );
  return [...matches].sort((a, b) => {
    const rankA = recentRank.get(a.name) ?? Number.POSITIVE_INFINITY;
    const rankB = recentRank.get(b.name) ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.name.localeCompare(b.name);
  });
}

const ATTACHMENT_KIND_LABELS: Record<AttachmentSummary["kind"], string> = {
  image: "Image",
  pdf: "PDF",
  text: "File",
  editor: "Editor",
  selection: "Selection",
};

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: AttachmentSummary;
  readonly onRemove: (attachmentId: string) => void;
}): React.JSX.Element {
  const preview =
    attachment.kind === "image"
      ? getImagePreview(attachment.name, attachment.sizeBytes)
      : undefined;
  if (preview !== undefined) {
    return (
      <span className="dvx-attachment-thumb" title={attachment.name}>
        <img
          className="dvx-attachment-thumb-image"
          src={preview}
          alt={attachment.name}
        />
        <button
          type="button"
          className="dvx-attachment-thumb-remove"
          aria-label={`Remove attachment ${attachment.name}`}
          onClick={() => onRemove(attachment.id)}
        >
          ×
        </button>
      </span>
    );
  }
  return (
    <span className="dvx-attachment-chip">
      <span className="dvx-attachment-kind">
        {ATTACHMENT_KIND_LABELS[attachment.kind]}
      </span>
      <span className="dvx-attachment-name" title={attachment.name}>
        {attachment.name}
      </span>
      {attachment.truncated ? (
        <span className="dvx-attachment-truncated">truncated</span>
      ) : null}
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

function ActivityChevron(): React.JSX.Element {
  return (
    <svg
      className="dvx-activity-chevron"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4.25 5.75 2.75 2.75 2.75-2.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon(): React.JSX.Element {
  return (
    <svg
      className="dvx-send-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 12.667V3.333M4.333 7 8 3.333 11.667 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="6" height="6" rx="1" stroke="currentColor" />
      <path
        d="M3 9.5H2.75A1.25 1.25 0 0 1 1.5 8.25v-5.5A1.25 1.25 0 0 1 2.75 1.5h5.5A1.25 1.25 0 0 1 9.5 2.75V3"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyActionContent(): React.JSX.Element {
  return (
    <>
      <span className="dvx-copy-idle">
        <CopyIcon />
        <span>Copy</span>
      </span>
      <span className="dvx-copy-done" aria-hidden="true">
        <CheckIcon />
        <span>Copied</span>
      </span>
    </>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="m3.25 7.25 2.35 2.35L10.75 4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RegenerateIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M11.5 7a4.5 4.5 0 1 1-1.32-3.18M11.5 2.5v2.75h-2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HistoryNotice({
  historyStatus,
  truncated,
}: {
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
}): React.JSX.Element | null {
  if (historyStatus === "unavailable") {
    return (
      <aside className="dvx-history-notice" role="note">
        Earlier CLI messages are unavailable here. You can continue this
        session.
      </aside>
    );
  }
  if (historyStatus === "partial" || truncated) {
    return (
      <aside className="dvx-history-notice" role="note">
        {historyStatus === "partial" && truncated
          ? "Some earlier session content is unavailable, and older locally retained messages were trimmed."
          : historyStatus === "partial"
            ? "Some earlier session content is unavailable through the public Droid history."
            : "Older messages were trimmed from the local display."}
      </aside>
    );
  }
  return null;
}

interface ToolActivityPresentation {
  readonly action: string;
  readonly status: string;
  readonly progressCount: number;
  readonly latestUpdateKind: string | null;
  readonly durationMs: number | null;
  readonly filePath: string | null;
  readonly detailKind: "command" | "plan" | null;
  readonly detail: string | null;
  /** Error excerpt from a failed tool_result, shown when expanded. */
  readonly errorMessage: string | null;
  /**
   * Live trailing output of an execute-class tool (tier1 §1). Present
   * only in live sessions — history and recovery replays never carry
   * it — so playback stays previewless by construction.
   */
  readonly outputTail: string | null;
  /**
   * Subagent summary of a delegating Task tool: identity from the
   * delegation, terminal status and counters from the CLI's durable
   * invocation ledger. One level only — child sessions never stream
   * their internals into the parent transcript.
   */
  readonly subagent: {
    readonly type: string;
    readonly description: string;
    readonly status: string | null;
    readonly toolUseCount: number | null;
    readonly durationMs: number | null;
  } | null;
}

function readToolActivity(part: unknown): ToolActivityPresentation {
  const fallback: ToolActivityPresentation = {
    action: "Used a workspace tool",
    status: "completed",
    progressCount: 0,
    latestUpdateKind: null,
    durationMs: null,
    filePath: null,
    detailKind: null,
    detail: null,
    errorMessage: null,
    outputTail: null,
    subagent: null,
  };
  const metadata = readDroidvisxMetadata(part);
  if (
    metadata !== null &&
    "action" in metadata &&
    typeof metadata.action === "string" &&
    "status" in metadata &&
    typeof metadata.status === "string" &&
    "progressCount" in metadata &&
    Number.isSafeInteger(metadata.progressCount) &&
    "latestUpdateKind" in metadata &&
    (metadata.latestUpdateKind === null ||
      typeof metadata.latestUpdateKind === "string")
  ) {
    const detailKind =
      metadata["detailKind"] === "command" || metadata["detailKind"] === "plan"
        ? metadata["detailKind"]
        : null;
    return {
      ...(metadata as Omit<
        ToolActivityPresentation,
        | "durationMs"
        | "filePath"
        | "detailKind"
        | "detail"
        | "errorMessage"
        | "outputTail"
        | "subagent"
      >),
      durationMs: readMetadataDuration(metadata),
      filePath:
        typeof metadata["filePath"] === "string" &&
        metadata["filePath"].length > 0
          ? metadata["filePath"]
          : null,
      detailKind,
      detail:
        detailKind !== null &&
        typeof metadata["detail"] === "string" &&
        metadata["detail"].length > 0
          ? metadata["detail"]
          : null,
      errorMessage:
        typeof metadata["errorMessage"] === "string" &&
        metadata["errorMessage"].length > 0
          ? metadata["errorMessage"]
          : null,
      outputTail:
        typeof metadata["outputTail"] === "string" &&
        metadata["outputTail"].length > 0
          ? metadata["outputTail"]
          : null,
      subagent: readMetadataSubagent(metadata["subagent"]),
    };
  }
  return fallback;
}

function readMetadataSubagent(
  value: unknown,
): ToolActivityPresentation["subagent"] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    typeof value.type !== "string" ||
    value.type.length === 0 ||
    !("description" in value) ||
    typeof value.description !== "string"
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    type: value.type,
    description: value.description,
    status:
      typeof record["status"] === "string" ? record["status"] : null,
    toolUseCount: Number.isSafeInteger(record["toolUseCount"])
      ? (record["toolUseCount"] as number)
      : null,
    durationMs: Number.isSafeInteger(record["durationMs"])
      ? (record["durationMs"] as number)
      : null,
  };
}

interface PlanStep {
  readonly status: "pending" | "in_progress" | "completed";
  readonly text: string;
}

/**
 * Parses the free-form todo text a task-plan tool wrote. The SDK sends
 * it as a numbered list where each line looks like
 * "1. [in_progress] Do the thing".
 */
function parsePlanSteps(detail: string): readonly PlanStep[] {
  const steps: PlanStep[] = [];
  for (const rawLine of detail.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(?:\d+[.)]\s*)?\[([^\]]*)\]\s*(.*)$/u.exec(line);
    const label = match?.[1]?.toLowerCase().replace(/[\s_-]/gu, "") ?? "";
    const text = (match?.[2] ?? line.replace(/^\d+[.)]\s*/u, "")).trim();
    if (text.length === 0) {
      continue;
    }
    const status: PlanStep["status"] =
      label.includes("progress") || label === "active" || label === "doing"
        ? "in_progress"
        : label.includes("complete") ||
            label.includes("done") ||
            label === "x" ||
            label === "checked"
          ? "completed"
          : "pending";
    steps.push({ status, text });
  }
  return steps;
}

/**
 * Terminal-style tail of a running execute command (tier1 §1). Pinned
 * to the bottom like a terminal; scrolling up unpins until the reader
 * returns to the bottom. Completion freezes the final tail in place.
 */
function ToolOutputPreview({
  text,
  running,
  open,
}: {
  readonly text: string;
  readonly running: boolean;
  readonly open: boolean;
}): React.JSX.Element {
  const preRef = useRef<HTMLPreElement | null>(null);
  const pinnedRef = useRef(true);
  // `open` re-pins after a closed row (zero scrollHeight) reopens.
  useEffect(() => {
    const pre = preRef.current;
    if (running && open && pinnedRef.current && pre !== null) {
      pre.scrollTop = pre.scrollHeight;
    }
  }, [text, running, open]);
  return (
    <pre
      ref={preRef}
      className="dvx-tool-output"
      onScroll={(event) => {
        const pre = event.currentTarget;
        pinnedRef.current =
          pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
      }}
    >
      {text}
    </pre>
  );
}

function ToolActivityRow({
  activity,
  toolName,
}: {
  readonly activity: ToolActivityPresentation;
  readonly toolName: string;
}): React.JSX.Element {
  // Plan rows open by default only when they appear inside a live
  // turn, so the checklist is visible while Droid works but recovered
  // histories mount collapsed and stay cheap to lay out. `open` is
  // always a defined boolean so React never leaves a stale `open`
  // attribute on a reused <details> node.
  const messageRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );
  const [open, setOpen] = useState(
    activity.detailKind === "plan" && messageRunning,
  );
  const running = activity.status === "running";
  // Collapsed plans keep their position visible: "3/7 · current item"
  // replaces scanning a full checklist (streaming design item E).
  const planSummary =
    !open && activity.detailKind === "plan" && activity.detail !== null
      ? formatPlanSummary(activity.detail)
      : null;
  const row = (
    <details
      className={`dvx-activity-row${running ? " dvx-activity-running" : ""}${
        activity.subagent !== null ? " dvx-activity-row-delegating" : ""
      }`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="dvx-activity-indicator" />
        <span className="dvx-tool-action">{activity.action}</span>
        {planSummary === null ? null : (
          <span className="dvx-plan-summary">{planSummary}</span>
        )}
        {activity.detailKind === "command" && activity.detail !== null ? (
          <code className="dvx-tool-command-inline">
            {firstLine(activity.detail)}
          </code>
        ) : null}
        {activity.filePath === null ? null : (
          <ToolFilePath path={activity.filePath} />
        )}
        {activity.filePath !== null &&
        activity.status === "completed" &&
        isPreviewableFilePath(activity.filePath) ? (
          <PreviewChip path={activity.filePath} />
        ) : null}
        <span className="dvx-activity-state">
          {formatToolLifecycle(activity.status)}
          {activity.durationMs === null
            ? ""
            : ` · ${formatDuration(activity.durationMs)}`}
        </span>
        <ActivityChevron />
      </summary>
      {activity.detailKind === "plan" && activity.detail !== null ? (
        <TaskPlan detail={activity.detail} />
      ) : activity.detailKind === "command" && activity.detail !== null ? (
        <pre className="dvx-tool-command">{activity.detail}</pre>
      ) : (
        <div className="dvx-tool-summary">
          <code>{toolName}</code>
          <span>{formatToolProgress(activity)}</span>
        </div>
      )}
      {activity.outputTail === null ? null : (
        <ToolOutputPreview
          text={activity.outputTail}
          running={running}
          open={open}
        />
      )}
      {activity.status === "failed" && activity.errorMessage !== null ? (
        <p className="dvx-tool-error">{activity.errorMessage}</p>
      ) : null}
    </details>
  );
  if (activity.subagent === null) {
    return row;
  }
  // The delegated subagent hangs one level under its Task row. One
  // level only: child sessions never stream their internals into the
  // parent transcript, so no deeper hierarchy is fabricated. The
  // parent running row owns the turn's shimmer; the sub-row stays
  // static (animations only belong to what is happening now).
  return (
    <>
      {row}
      <SubagentSummaryRow subagent={activity.subagent} />
    </>
  );
}

/** One quiet indented summary row for a delegated subagent. */
export function SubagentSummaryRow({
  subagent,
}: {
  readonly subagent: NonNullable<ToolActivityPresentation["subagent"]>;
}): React.JSX.Element {
  return (
    <div className="dvx-subagent-row">
      <span className="dvx-subagent-label">
        {`Delegated to ${subagent.type} subagent`}
      </span>
      {subagent.status === null ? null : (
        <span className="dvx-activity-state">
          {formatSubagentSummary(subagent)}
        </span>
      )}
      {subagent.description.length > 0 ? (
        <span className="dvx-subagent-description">
          {subagent.description}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "running" / "completed · 7 tool uses · 4.2s"; counters only appear
 * when the invocation ledger reported them.
 */
export function formatSubagentSummary(subagent: {
  readonly status: string | null;
  readonly toolUseCount: number | null;
  readonly durationMs: number | null;
}): string {
  const pieces = [subagent.status ?? ""];
  if (subagent.toolUseCount !== null) {
    pieces.push(
      `${subagent.toolUseCount} tool ${
        subagent.toolUseCount === 1 ? "use" : "uses"
      }`,
    );
  }
  if (subagent.durationMs !== null) {
    pieces.push(formatDuration(subagent.durationMs));
  }
  return pieces.filter((piece) => piece.length > 0).join(" · ");
}

/**
 * A coalesced run of exploration tools (and swallowed short Thinking).
 * While any member runs it shows an "Exploring" header over a bounded
 * auto-scrolling preview of the live rows; once finished it collapses
 * to an "Explored 3 files, 2 searches" summary that expands on click.
 * Runs below the batch threshold render their rows unchanged.
 */
function ActivityGroup({
  indices,
  children,
}: {
  readonly indices: readonly number[];
  readonly children: ReactNode;
}): React.JSX.Element {
  const parts = useAuiState((s) => s.message.parts);
  const summary = useMemo(() => {
    const members: GroupCandidatePart[] = [];
    for (const index of indices) {
      const member = parts[index];
      if (member !== undefined) {
        members.push(member);
      }
    }
    return summarizeActivityGroup(members);
  }, [parts, indices]);
  const [expanded, setExpanded] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest activity visible in the bounded preview; the
  // browser clamps scrollTop, and reduced-motion already forces
  // scroll-behavior to auto so this never animates there.
  useEffect(() => {
    const preview = previewRef.current;
    if (preview !== null) {
      preview.scrollTop = preview.scrollHeight;
    }
  }, [summary.memberCount, summary.anyRunning]);

  if (!summary.renderAsGroup) {
    return <>{children}</>;
  }

  if (summary.anyRunning) {
    return (
      <div className="dvx-activity-group dvx-activity-group-running">
        <div className="dvx-activity-group-header">
          <span className="dvx-activity-indicator" />
          <span className="dvx-shimmer-text">Exploring</span>
        </div>
        <div
          className="dvx-activity-group-preview"
          ref={previewRef}
          aria-label="Exploration in progress"
        >
          {children}
        </div>
      </div>
    );
  }

  const stateBits: string[] = [];
  if (summary.failedCount > 0) {
    stateBits.push(`${summary.failedCount} failed`);
  }
  if (summary.stoppedCount > 0) {
    stateBits.push("stopped");
  }
  if (summary.durationMs !== null) {
    stateBits.push(formatDuration(summary.durationMs));
  }
  return (
    <div className="dvx-activity-group">
      <button
        type="button"
        className="dvx-activity-group-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dvx-activity-indicator" />
        <span className="dvx-tool-action">Explored {summary.countsLabel}</span>
        {stateBits.length > 0 ? (
          <span
            className={`dvx-activity-state${
              summary.failedCount > 0 ? " dvx-activity-state-failed" : ""
            }`}
          >
            {stateBits.join(" · ")}
          </span>
        ) : null}
        <ActivityChevron />
      </button>
      <div
        className={`dvx-activity-group-details${
          expanded ? " dvx-activity-group-details-open" : ""
        }`}
      >
        <div className="dvx-activity-group-details-inner">{children}</div>
      </div>
    </div>
  );
}

/**
 * Collapsed-plan position line: `3/7 · <current item>`. The current
 * item is the in-progress step, falling back to the next pending one
 * so a just-advanced plan still reads usefully; fully completed plans
 * show the count alone.
 */
export function formatPlanSummary(detail: string): string | null {
  const steps = parsePlanSteps(detail);
  if (steps.length === 0) {
    return null;
  }
  const completed = steps.filter((step) => step.status === "completed").length;
  const current =
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending");
  return current === undefined
    ? `${completed}/${steps.length}`
    : `${completed}/${steps.length} · ${firstLine(current.text)}`;
}

function TaskPlan({ detail }: { readonly detail: string }): React.JSX.Element {
  const steps = parsePlanSteps(detail);
  if (steps.length === 0) {
    return <pre className="dvx-tool-command">{detail}</pre>;
  }
  const completed = steps.filter((step) => step.status === "completed").length;
  return (
    <div className="dvx-plan">
      <div className="dvx-plan-progress">
        {completed}/{steps.length} done
      </div>
      <ol className="dvx-plan-list">
        {steps.map((step, index) => (
          <li
            key={index}
            className={`dvx-plan-step dvx-plan-step-${step.status}`}
          >
            <span className="dvx-plan-marker" aria-hidden="true" />
            <span className="dvx-plan-text">{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function readDroidvisxMetadata(part: unknown): Record<string, unknown> | null {
  if (
    typeof part === "object" &&
    part !== null &&
    "providerMetadata" in part &&
    typeof part.providerMetadata === "object" &&
    part.providerMetadata !== null &&
    "droidvisx" in part.providerMetadata &&
    typeof part.providerMetadata.droidvisx === "object" &&
    part.providerMetadata.droidvisx !== null
  ) {
    return part.providerMetadata.droidvisx as Record<string, unknown>;
  }
  return null;
}

function readMetadataDuration(
  metadata: Record<string, unknown>,
): number | null {
  return typeof metadata["durationMs"] === "number" &&
    Number.isFinite(metadata["durationMs"]) &&
    metadata["durationMs"] >= 0
    ? metadata["durationMs"]
    : null;
}

function readReasoningDuration(part: unknown): number | null {
  const metadata = readDroidvisxMetadata(part);
  return metadata === null ? null : readMetadataDuration(metadata);
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? text;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

// Completed Thinking rows read as a past-tense fact, mirroring the
// Cursor "Thought for Xs" affordance; sub-500ms runs are too short
// for a number to be meaningful.
export function formatThinkingLabel(
  statusType: string | undefined,
  durationMs: number | null,
): string {
  if (statusType === "incomplete") {
    return "Thinking stopped";
  }
  if (durationMs === null) {
    return "Thought";
  }
  if (durationMs < 500) {
    return "Thought briefly";
  }
  if (durationMs < 1_000) {
    return `Thought for ${(durationMs / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) {
    return `Thought for ${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0
    ? `Thought for ${minutes}m`
    : `Thought for ${minutes}m ${seconds}s`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${(durationMs / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = durationMs / 1_000;
  if (totalSeconds < 60) {
    return totalSeconds < 10
      ? `${totalSeconds.toFixed(1)}s`
      : `${Math.round(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatToolLifecycle(status: string): string {
  switch (status) {
    case "running":
      return "Working";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return "Completed";
  }
}

function formatToolProgress(activity: ToolActivityPresentation): string {
  if (activity.progressCount === 0 || activity.latestUpdateKind === null) {
    return `Lifecycle: ${formatToolLifecycle(activity.status)}`;
  }
  const count = `${activity.progressCount} progress ${
    activity.progressCount === 1 ? "update" : "updates"
  }`;
  return `${count} · Latest: ${formatUpdateKind(activity.latestUpdateKind)}`;
}

function formatUpdateKind(kind: string): string {
  switch (kind) {
    case "tool-call":
      return "tool started";
    case "tool-result":
      return "tool result";
    case "error":
      return "error";
    case "status":
      return "status";
    default:
      return "message";
  }
}

function readUserMessageId(metadata: unknown): string | null {
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "custom" in metadata &&
    typeof metadata.custom === "object" &&
    metadata.custom !== null &&
    "messageId" in metadata.custom &&
    typeof metadata.custom.messageId === "string" &&
    metadata.custom.messageId.length > 0
  ) {
    return metadata.custom.messageId;
  }
  return null;
}

function readUserAttachments(
  metadata: unknown,
): readonly SentAttachmentSummary[] {
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "custom" in metadata &&
    typeof metadata.custom === "object" &&
    metadata.custom !== null &&
    "attachments" in metadata.custom &&
    Array.isArray(metadata.custom.attachments)
  ) {
    return metadata.custom.attachments as readonly SentAttachmentSummary[];
  }
  return [];
}

function readMessageText(content: readonly unknown[]): string {
  return content
    .filter(
      (
        part,
      ): part is {
        readonly type: "text";
        readonly text: string;
      } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
}

function readDiagnostic(data: unknown): {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly relatedSessionId: string | null;
} {
  if (
    typeof data === "object" &&
    data !== null &&
    "severity" in data &&
    (data.severity === "info" ||
      data.severity === "warning" ||
      data.severity === "error") &&
    "code" in data &&
    typeof data.code === "string" &&
    "message" in data &&
    typeof data.message === "string"
  ) {
    const relatedSessionId =
      "relatedSessionId" in data &&
      typeof data.relatedSessionId === "string" &&
      data.relatedSessionId.length > 0
        ? data.relatedSessionId
        : null;
    return {
      severity: data.severity,
      code: data.code,
      message: data.message,
      relatedSessionId,
    };
  }
  return {
    severity: "warning",
    code: "DIAGNOSTIC_UNAVAILABLE",
    message: "Diagnostic details are unavailable.",
    relatedSessionId: null,
  };
}

/** Original file-size cap for one image attachment (host mirror). */
const MAX_ATTACHMENT_IMAGE_BYTES = 4 * 1024 * 1024;

function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * Extracts bounded `file://` URIs from a drop. Editor explorer drags
 * populate `text/uri-list` (newline separated, `#` comments) and
 * sometimes `application/vnd.code.uri-list` (JSON array); anything
 * that is not a file URI is dropped here before crossing the bridge.
 */
export function readDroppedFileUris(
  dataTransfer: Pick<DataTransfer, "getData">,
): readonly string[] {
  const plain = dataTransfer.getData("text/uri-list");
  let entries = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (entries.length === 0) {
    const code = dataTransfer.getData("application/vnd.code.uri-list");
    if (code.length > 0) {
      try {
        const parsed: unknown = JSON.parse(code);
        entries = Array.isArray(parsed)
          ? parsed.filter((entry): entry is string => typeof entry === "string")
          : [];
      } catch {
        entries = code
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }
    }
  }
  return entries.filter(
    (uri) =>
      uri.startsWith("file://") && uri.length <= MAX_ATTACHMENT_URI_LENGTH,
  );
}

/**
 * Index of the user message currently pinned to the viewport top: the
 * last one whose rendered top edge sits at or above the viewport top
 * (CSS sticky keeps every passed message there). -1 when none is
 * pinned.
 */
export function computePinnedUserIndex(
  tops: readonly number[],
  viewportTop: number,
): number {
  let pinned = -1;
  tops.forEach((top, index) => {
    if (top <= viewportTop + 1) {
      pinned = index;
    }
  });
  return pinned;
}

/** Sticky pin/cover/push-out decisions for one coordinator frame. */
export interface StickyLayout {
  readonly pinnedIndex: number;
  /** Older stuck messages fully hidden behind the pinned one. */
  readonly covered: readonly boolean[];
  /**
   * How far (px) the pinned message is pushed up because the next
   * user message has reached its bottom edge. Emulates the section
   * header hand-off: the incoming block cleanly pushes the pinned one
   * out instead of sliding text over text.
   */
  readonly pushPx: number;
}

/**
 * Computes the pinned message, covered set, and push-out offset from
 * user message rects. `tops`/`heights` come from live rects; only the
 * pinned element carries a translate, and its untransformed sticky
 * position is the viewport top, so the push math stays feedback-free.
 *
 * `editingIndex` (when not -1) marks a message whose edit card is
 * open. An open editor owns the pinned slot outright: it is never
 * pushed out by the next message and later messages never take over
 * the top (they hide behind it as covered instead). Without this the
 * push-out hand-off — designed for line-clamped resting blocks —
 * translates the hundreds-of-pixels-tall edit card up until only its
 * footer controls remain on screen.
 */
export function computeStickyLayout(
  tops: readonly number[],
  heights: readonly number[],
  viewportTop: number,
  editingIndex = -1,
): StickyLayout {
  const pinnedIndex = computePinnedUserIndex(tops, viewportTop);
  if (editingIndex !== -1 && pinnedIndex >= editingIndex) {
    return {
      pinnedIndex: editingIndex,
      covered: tops.map(
        (top, index) => index !== editingIndex && top <= viewportTop + 1,
      ),
      pushPx: 0,
    };
  }
  const covered = tops.map(
    (top, index) => index < pinnedIndex && top <= viewportTop + 1,
  );
  let pushPx = 0;
  if (pinnedIndex !== -1) {
    const nextTop = tops[pinnedIndex + 1];
    const height = heights[pinnedIndex] ?? 0;
    if (nextTop !== undefined) {
      pushPx = Math.min(
        Math.max(0, viewportTop + height - Math.max(nextTop, viewportTop)),
        height,
      );
    }
  }
  return { pinnedIndex, covered, pushPx };
}

/** A viewport is "at bottom" within this tolerance (fractional
 * scrollTop under display scaling never lands exactly on 0). */
export const FOLLOW_REJOIN_PX = 4;

/** One viewport scroll sample fed to the follow latch. */
export interface FollowScrollSample {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Mutable stick-to-bottom latch owned by the scroll coordinator. */
export interface FollowState {
  following: boolean;
  lastScrollTop: number;
  lastScrollHeight: number;
  /** scrollTop the coordinator itself just wrote; the next matching
   * scroll event is programmatic, not a user gesture. */
  pendingProgrammaticTop: number | null;
}

export function createFollowState(): FollowState {
  return {
    following: true,
    lastScrollTop: 0,
    lastScrollHeight: 0,
    pendingProgrammaticTop: null,
  };
}

/**
 * Applies one scroll event to the follow latch with Cursor semantics:
 * only a genuine upward user scroll releases the latch, and returning
 * to the bottom restores it. Programmatic writes (the coordinator's
 * own glue scrolls, the primitive's run-start jumps) and clamp events
 * from shrinking content never release it. This replaces assistant-ui's
 * isAtBottom bookkeeping, which flips false when the async scroll
 * event of its own bottom-glue write lands after further content
 * growth (scrollTop unchanged + taller scrollHeight reads as a user
 * scroll there), permanently stopping auto-follow mid-stream.
 */
export function applyFollowScroll(
  state: FollowState,
  sample: FollowScrollSample,
): void {
  const distance = sample.scrollHeight - sample.scrollTop - sample.clientHeight;
  const programmatic =
    state.pendingProgrammaticTop !== null &&
    Math.abs(sample.scrollTop - state.pendingProgrammaticTop) <= 1;
  if (programmatic) {
    state.pendingProgrammaticTop = null;
  } else {
    const shrank = sample.scrollHeight < state.lastScrollHeight;
    const scrolledUp = sample.scrollTop < state.lastScrollTop - 0.5;
    const scrolledDown = sample.scrollTop > state.lastScrollTop + 0.5;
    if (scrolledUp && !shrank) {
      state.following = false;
    }
    // A downward scroll that reaches at least the previous bottom is
    // a return-to-bottom even when streaming grew the content between
    // the user's gesture and this event (the live distance is then
    // whatever just streamed in, not user intent).
    const previousMaxTop = state.lastScrollHeight - sample.clientHeight;
    if (
      distance <= FOLLOW_REJOIN_PX ||
      (scrolledDown && sample.scrollTop >= previousMaxTop - FOLLOW_REJOIN_PX)
    ) {
      state.following = true;
    }
  }
  state.lastScrollTop = sample.scrollTop;
  state.lastScrollHeight = sample.scrollHeight;
}

function toggleDataAttribute(
  element: HTMLElement,
  name: string,
  on: boolean,
): void {
  if (on) {
    if (!element.hasAttribute(name)) {
      element.setAttribute(name, "");
    }
  } else if (element.hasAttribute(name)) {
    element.removeAttribute(name);
  }
}

/**
 * Reads one image file into raw base64 for the `attachment.addImage`
 * bridge message. Returns null when the read fails or the result is
 * not the expected data-URI shape.
 */
function readFileAsBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        resolve(null);
        return;
      }
      const separator = result.indexOf(",");
      resolve(separator === -1 ? null : result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}
