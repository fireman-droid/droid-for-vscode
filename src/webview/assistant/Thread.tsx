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
  Children,
  createContext,
  Fragment,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

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
import { MAX_QUEUED_MESSAGES } from "../../shared/queueProtocol";
import type { SessionTokenUsageState } from "../../shared/tokenUsage";
import { isPreviewableFilePath } from "../../shared/validateMessage";
import type {
  ComposerNavRequest,
  McpAuthProgress,
  McpPanelState,
  McpServerAddParams,
  PluginsPanelState,
  SkillsPanelState,
} from "./ComposerControls";
import {
  ComposerControls,
  type SessionSettingSelection,
} from "./ComposerControls";
import { ComposerPopup } from "./ComposerPopup";
import {
  SLASH_NAV_COMMANDS,
  type SlashNavTarget,
} from "./slashBuiltins";
import {
  ACTIVITY_GROUP_KEY,
  activeTickerIndex,
  activityGroupBy,
  summarizeActivityGroup,
  type GroupCandidatePart,
} from "./activityGrouping";
import {
  DroidMarkdownText,
  InlineHtmlPreviewContext,
  PathPreviewContext,
  type PathPreviewWiring,
} from "./MarkdownText";
import { ChangesCommitEntry } from "./GitCommitPanel";
import { MessageTimestamp } from "./MessageTimestamp";
import { parsePlanSteps, type PlanAnchorState } from "./planAnchor";
import { PlanAnchorCard } from "./PlanAnchorCard";
import { TranscriptImage } from "./TranscriptImage";
import { getImagePreview, rememberImagePreview } from "./imagePreviewCache";
import {
  commandCardTitle,
  commandChips,
  tokenizeCommand,
} from "./commandCard";
import {
  ActivityGroup,
  PlanAnchorSlot,
  ToolActivityRow,
} from "./thread/activityRows";
import { AssistantMessage } from "./thread/AssistantMessage";
import { Composer } from "./thread/Composer";
import { UserMessage } from "./thread/UserMessage";
import {
  ActivityChevron,
  CopyActionContent,
  ForkIcon,
  RegenerateIcon,
  ScrollToBottomIcon,
  SendIcon,
} from "./thread/icons";
import {
  BTW_COMMAND,
  BUILT_IN_COMMANDS,
  MAX_SLASH_SKILL_MATCHES,
  filterSlashCommands,
  findMentionToken,
  findSlashToken,
  splitMentionPath,
  type MentionToken,
  type SlashEntry,
  type SlashToken,
} from "./thread/composerCommands";
import {
  ChangesSummary,
  Diagnostic,
  HistoryNotice,
  PendingResponse,
  ThinkingRow,
} from "./thread/transcriptRows";
import {
  firstLine,
  formatDuration,
  formatThinkingLabel,
  formatToolLifecycle,
  formatToolProgress,
  readDiagnostic,
  readMessageText,
  readReasoningDuration,
  readToolActivity,
  readUserAttachments,
  readUserMessageId,
  type ToolActivityPresentation,
} from "./thread/readers";

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
  readonly plugins: PluginsPanelState;
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
  readonly onPluginsRefresh: () => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
}

// Tool rows deep inside the transcript open native diffs through this
// context so the memoized message tree stays free of prop drilling.
export const FileDiffContext = createContext<(path: string) => void>(() => undefined);

// Previewing an .html/.htm prototype opens the sandboxed preview panel
// through this context, matching the FileDiffContext pattern so deep
// Changes/Tool rows stay free of prop drilling. Exported for focused
// tests that assert chip visibility and wiring.
export const PreviewContext = createContext<(path: string) => void>(
  () => undefined,
);

// Live execute rows offer the read-only terminal mirror through this
// context (native-terminal design slice A). Null means the entry is
// unavailable and stays hidden. Exported for focused entry tests.
export const TerminalMirrorContext = createContext<(() => void) | null>(
  null,
);

// Plan anchor cards for the transcript: the map keys creation
// todowrite toolUseIds to the plan's latest projected state, and
// `running` drives the card's warm "Building…" status while the turn
// streams. Exported for focused slot tests.
export const PlanAnchorContext = createContext<{
  readonly anchors: ReadonlyMap<string, PlanAnchorState> | null;
  readonly running: boolean;
}>({ anchors: null, running: false });

// Regenerating rewinds to the last user message and resends it. Null
// means the action is currently unavailable (no anchor or turn active).
export const RegenerateContext = createContext<(() => void) | null>(null);

// Forking branches a new session from the current session state. The
// SDK forks only the present state (no per-message anchor), so the
// action appears solely on the last assistant message; null means it
// is unavailable (disconnected or a turn is active).
export const ForkContext = createContext<(() => void) | null>(null);

// The compaction divider offers a jump to the pre-compaction session
// through this context, keeping the memoized message tree free of
// prop drilling (same pattern as FileDiffContext).
export const SelectSessionContext = createContext<
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
  readonly tokenUsage: SessionTokenUsageState;
  readonly modelCatalog: ModelCatalogState;
  readonly skills: SkillsPanelState;
  readonly mcp: McpPanelState;
  readonly plugins: PluginsPanelState;
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
  readonly onPluginsRefresh: () => void;
  /** Starts a fresh session (skill changes apply at session start). */
  readonly onNewSession: () => void;
  readonly attachments: readonly AttachmentSummary[];
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly commands: SlashCommandsState;
  readonly onCommandsRefresh: () => void;
  /** Latest `/command` panel-navigation request (ComposerControls). */
  readonly navSignal?: ComposerNavRequest | null;
  /** Opens the panel behind one `/` popup navigation row. */
  readonly onSlashNavigate?: (target: SlashNavTarget) => void;
  /**
   * Host-advertised `/btw` side-chat capability (process runtime
   * only); false keeps the popup row unrendered (fail closed).
   */
  readonly btwAvailable?: boolean;
  /**
   * Opens the side-chat card from the `/btw` popup row. Direct (no
   * composer send) so it stays usable while a main turn runs.
   */
  readonly onBtwOpen?: () => void;
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
  /** Forks a new session from the current state (last message only). */
  readonly onForkSession: (() => void) | null;
  readonly onOpenFileDiff: (path: string) => void;
  readonly onPreviewFile: (path: string) => void;
  /** Renders an assistant HTML code block in the sandbox panel. */
  readonly onPreviewInlineHtml: (html: string) => void;
  /**
   * Absolute workspace folder from the host snapshot; rebases absolute
   * transcript path links for the Preview entry. Null hides the entry.
   */
  readonly workspaceRoot: string | null;
  /** Reveals the read-only terminal mirror of execute output. */
  readonly onOpenTerminalMirror: () => void;
  readonly editResendEnabled: boolean;
  readonly inlineInteraction?: ReactNode;
  /**
   * Plan anchor cards keyed by the creation todowrite's toolUseId
   * (projected in App from transcript todowrites). Each plan renders
   * one Cursor-style "Created Plan" card at its creation position in
   * the transcript, updated in place by later todowrites.
   */
  readonly planAnchors?: ReadonlyMap<string, PlanAnchorState> | null;
  /**
   * The queued-prompts bar stacked directly above the Composer in
   * the viewport footer; null while the queue is empty. Built in App
   * so the thread stays free of queue state.
   */
  readonly queuedMessages?: ReactNode;
  /**
   * The floating "N Working" subagent pill hovering over the
   * Composer's left edge; null while no delegation is running. Built
   * in App from the transcript's subagent rows.
   */
  readonly workingBadge?: ReactNode;
  /** Prompts queued behind the running turn (Composer hint). */
  readonly queuedCount?: number;
  /** A queued prompt is loaded into the Composer ("Edit Queued"). */
  readonly queueEditing?: boolean;
  /** Leaves "Edit Queued" mode, clearing the Composer draft. */
  readonly onQueueEditCancel?: () => void;
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
  tokenUsage,
  modelCatalog,
  skills,
  mcp,
  plugins,
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
  onPluginsRefresh,
  onNewSession,
  attachments,
  fileSearch,
  onFileSearch,
  commands,
  onCommandsRefresh,
  navSignal = null,
  onSlashNavigate,
  btwAvailable = false,
  onBtwOpen,
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
  onForkSession,
  onOpenFileDiff,
  onPreviewFile,
  onPreviewInlineHtml,
  workspaceRoot,
  onOpenTerminalMirror,
  editResendEnabled,
  inlineInteraction,
  planAnchors = null,
  queuedMessages = null,
  workingBadge = null,
  queuedCount = 0,
  queueEditing = false,
  onQueueEditCancel,
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
    // Editing a sent message and editing a queued prompt are
    // mutually exclusive; the newer intent wins.
    if (queueEditing) {
      onQueueEditCancel?.();
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
  //
  // The scroll-to-bottom arrow shares the coordinator's rAF pass so
  // its visibility can never disagree with the follow state, and its
  // click re-latches `follow.following` rather than owning any
  // scroll state of its own.
  const readingColumnRef = useRef<HTMLDivElement | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scrollToBottomRef = useRef<() => void>(() => {});
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
      setAwayFromBottom(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >
          SCROLL_BOTTOM_SHOW_PX,
      );
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
    // The arrow's click: re-latch the follow state first so any
    // streaming growth during the (possibly smooth) descent keeps
    // gluing, and mark the write as programmatic for the latch.
    scrollToBottomRef.current = () => {
      follow.following = true;
      const maxTop = scroller.scrollHeight - scroller.clientHeight;
      follow.pendingProgrammaticTop = maxTop;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      scroller.scrollTo({
        top: maxTop,
        behavior: reduceMotion ? "auto" : "smooth",
      });
      schedule();
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
      plugins,
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
      onPluginsRefresh,
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
      plugins,
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
      onPluginsRefresh,
      onEditAttachFiles,
      onEditAttachEditor,
      onEditAttachSelection,
      onEditAttachProblems,
      onEditAttachGitChanges,
      onEditAttachmentRemove,
    ],
  );
  const pathPreviewWiring = useMemo<PathPreviewWiring>(
    () => ({ workspaceRoot, previewFile: onPreviewFile }),
    [workspaceRoot, onPreviewFile],
  );
  const planAnchorValue = useMemo(
    () => ({ anchors: planAnchors, running }),
    [planAnchors, running],
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
          <PathPreviewContext.Provider value={pathPreviewWiring}>
          <InlineHtmlPreviewContext.Provider value={onPreviewInlineHtml}>
          <TerminalMirrorContext.Provider value={onOpenTerminalMirror}>
          <PlanAnchorContext.Provider value={planAnchorValue}>
          <RegenerateContext.Provider value={onRegenerate}>
          <ForkContext.Provider value={onForkSession}>
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
          </ForkContext.Provider>
          </RegenerateContext.Provider>
          </PlanAnchorContext.Provider>
          </TerminalMirrorContext.Provider>
          </InlineHtmlPreviewContext.Provider>
          </PathPreviewContext.Provider>
          </PreviewContext.Provider>
        </FileDiffContext.Provider>
        <ThreadPrimitive.ViewportFooter className="dvx-thread-footer">
          <div className="dvx-scroll-bottom-dock">
            <button
              type="button"
              className={
                awayFromBottom
                  ? "dvx-scroll-bottom dvx-scroll-bottom-visible"
                  : "dvx-scroll-bottom"
              }
              aria-label="Scroll to bottom"
              aria-hidden={!awayFromBottom}
              tabIndex={awayFromBottom ? 0 : -1}
              onClick={() => scrollToBottomRef.current()}
            >
              <ScrollToBottomIcon />
            </button>
          </div>
          {/* Independent floating pill at the Composer's left edge
              (Cursor form factor) — not part of the stacked
              conversation-state bars below. */}
          {workingBadge}
          {/* Conversation-state bar family: the queue bar sits
              directly above the Composer, sharing the warm card
              language of the plan-era pins. */}
          {queuedMessages}
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
            tokenUsage={tokenUsage}
            modelCatalog={modelCatalog}
            skills={skills}
            mcp={mcp}
            plugins={plugins}
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
            onPluginsRefresh={onPluginsRefresh}
            onNewSession={onNewSession}
            attachments={attachments}
            fileSearch={fileSearch}
            onFileSearch={onFileSearch}
            commands={commands}
            onCommandsRefresh={onCommandsRefresh}
            navSignal={navSignal}
            onSlashNavigate={onSlashNavigate}
            btwAvailable={btwAvailable}
            onBtwOpen={onBtwOpen}
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
            queuedCount={queuedCount}
            queueEditing={queueEditing}
            onQueueEditCancel={onQueueEditCancel}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
});

// Plan parsing is shared with the pinned task plan; see planPin.ts.

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

/** The scroll-to-bottom arrow shows past this distance from the
 * bottom: far enough that the streaming glue's transient frame or two
 * of lag never flashes it, close enough to appear on any real
 * upward scroll. */
export const SCROLL_BOTTOM_SHOW_PX = 48;

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
