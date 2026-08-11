import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  MAX_FILE_SEARCH_QUERY_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  type ModelCatalogState,
  type SessionHistoryStatus,
  type AttachmentSummary,
  type SessionContextState,
  type SessionSettingsState,
} from '../../shared/bridgeMessages';
import type {
  McpAuthProgress,
  McpPanelState,
  McpServerAddParams,
  SkillsPanelState,
} from './ComposerControls';
import {
  ComposerControls,
  type SessionSettingSelection,
} from './ComposerControls';
import { DroidMarkdownText } from './MarkdownText';

const THINKING_SMOOTH_OPTIONS = {
  drainMs: 480,
  maxCharIntervalMs: 12,
  maxCharsPerFrame: 12,
  minCommitMs: 48,
} as const;

/** Latest workspace search result delivered by the host. */
export interface FileSearchResult {
  readonly requestId: string;
  readonly files: readonly string[];
}

/** How rewinding to one user message would affect workspace files. */
export interface RewindFileInfo {
  readonly messageId: string;
  readonly restorableCount: number;
  readonly createdCount: number;
}

// Tool rows deep inside the transcript open native diffs through this
// context so the memoized message tree stays free of prop drilling.
const FileDiffContext = createContext<(path: string) => void>(
  () => undefined,
);

// Regenerating rewinds to the last user message and resends it. Null
// means the action is currently unavailable (no anchor or turn active).
const RegenerateContext = createContext<(() => void) | null>(null);

interface DroidThreadProps {
  readonly pending: boolean;
  readonly activity?: 'working' | 'responding';
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
  readonly hiddenMessageCount: number;
  readonly onShowEarlier: () => void;
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
  readonly attachments: readonly AttachmentSummary[];
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly onAttachPath: (path: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onReuseMessage: (text: string) => void;
  readonly onEditResend: (
    messageId: string,
    text: string,
    restoreFiles?: boolean,
  ) => void;
  readonly rewindInfo: RewindFileInfo | null;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly onRegenerate: (() => void) | null;
  readonly onOpenFileDiff: (path: string) => void;
  readonly editResendEnabled: boolean;
  readonly inlineInteraction?: ReactNode;
}

export const DroidThread = memo(function DroidThread({
  pending,
  activity,
  historyStatus,
  truncated,
  hiddenMessageCount,
  onShowEarlier,
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
  attachments,
  fileSearch,
  onFileSearch,
  onAttachPath,
  onAttachFiles,
  onAttachEditor,
  onAttachSelection,
  onAttachProblems,
  onAttachGitChanges,
  onAttachmentRemove,
  onDraftChange,
  onReuseMessage,
  onEditResend,
  rewindInfo,
  onRequestRewindInfo,
  onRegenerate,
  onOpenFileDiff,
  editResendEnabled,
  inlineInteraction,
}: DroidThreadProps): React.JSX.Element {
  return (
    <ThreadPrimitive.Root
      className={`dvx-thread${
        interactionPending ? ' dvx-thread-pending' : ''
      }`}
    >
      <ThreadPrimitive.Viewport
        className="dvx-thread-viewport"
        aria-label="Chat transcript"
        autoScroll
        turnAnchor="bottom"
        scrollToBottomOnRunStart
        scrollToBottomOnInitialize
        scrollToBottomOnThreadSwitch
      >
        <FileDiffContext.Provider value={onOpenFileDiff}>
        <RegenerateContext.Provider value={onRegenerate}>
          <div className="dvx-reading-column">
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
                  {historyStatus === 'unavailable'
                    ? 'Start a new message to continue this session.'
                    : 'Ask Droid to explain, inspect, or change your code.'}
                </p>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) =>
                message.role === 'user' ? (
                  <UserMessage
                    text={readMessageText(message.content)}
                    messageId={readUserMessageId(message.metadata)}
                    editResendEnabled={editResendEnabled}
                    rewindInfo={rewindInfo}
                    onRequestRewindInfo={onRequestRewindInfo}
                    onReuse={onReuseMessage}
                    onEditResend={onEditResend}
                  />
                ) : (
                  <AssistantMessage />
                )
              }
            </ThreadPrimitive.Messages>
            {pending ? <PendingResponse activity={activity} /> : null}
            {inlineInteraction}
          </div>
        </RegenerateContext.Provider>
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
            attachments={attachments}
            fileSearch={fileSearch}
            onFileSearch={onFileSearch}
            onAttachPath={onAttachPath}
            onAttachFiles={onAttachFiles}
            onAttachEditor={onAttachEditor}
            onAttachSelection={onAttachSelection}
            onAttachProblems={onAttachProblems}
            onAttachGitChanges={onAttachGitChanges}
            onAttachmentRemove={onAttachmentRemove}
            onDraftChange={onDraftChange}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
});

function UserMessage({
  text,
  messageId,
  editResendEnabled,
  rewindInfo,
  onRequestRewindInfo,
  onReuse,
  onEditResend,
}: {
  readonly text: string;
  readonly messageId: string | null;
  readonly editResendEnabled: boolean;
  readonly rewindInfo: RewindFileInfo | null;
  readonly onRequestRewindInfo: (messageId: string) => void;
  readonly onReuse: (text: string) => void;
  readonly onEditResend: (
    messageId: string,
    text: string,
    restoreFiles?: boolean,
  ) => void;
}): React.JSX.Element {
  const [reused, setReused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [restoreFiles, setRestoreFiles] = useState(false);
  const [resending, setResending] = useState(false);
  const resendResetRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(
    () => () => {
      if (resendResetRef.current !== null) {
        clearTimeout(resendResetRef.current);
      }
    },
    [],
  );
  const editable = messageId !== null && !resending;
  const reuse = (): void => {
    onReuse(text);
    setReused(true);
  };
  const openEditor = (): void => {
    setEditText(text);
    setRestoreFiles(false);
    setEditing(true);
    if (messageId !== null) {
      onRequestRewindInfo(messageId);
    }
  };
  const fileImpact =
    editing && messageId !== null && rewindInfo?.messageId === messageId
      ? rewindInfo
      : null;
  const affectedFiles =
    fileImpact === null
      ? 0
      : fileImpact.restorableCount + fileImpact.createdCount;
  const submitEdit = (): void => {
    if (
      messageId === null ||
      !editResendEnabled ||
      editText.trim().length === 0
    ) {
      return;
    }
    setEditing(false);
    setResending(true);
    onEditResend(messageId, editText, restoreFiles && affectedFiles > 0);
    // On success this component unmounts with the forked snapshot. If the
    // host declines the resend it only emits a diagnostic, so recover the
    // normal presentation after a grace period instead of sticking.
    if (resendResetRef.current !== null) {
      clearTimeout(resendResetRef.current);
    }
    resendResetRef.current = setTimeout(() => setResending(false), 8000);
  };
  return (
    <MessagePrimitive.Root
      className="dvx-message dvx-message-user"
      aria-label="You"
    >
      <div className="dvx-user-message-content">
        {editing ? (
          <div className="dvx-user-edit">
            <textarea
              className="dvx-user-edit-input"
              aria-label="Edit message and resend"
              value={editText}
              maxLength={MAX_TURN_TEXT_LENGTH}
              rows={Math.min(
                8,
                Math.max(2, editText.split('\n').length),
              )}
              autoFocus
              onChange={(event) =>
                setEditText(event.currentTarget.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitEdit();
                } else if (event.key === 'Escape') {
                  setEditing(false);
                }
              }}
            />
            <div className="dvx-user-edit-hint">
              Resending starts a new conversation branch from this
              message.
            </div>
            {affectedFiles > 0 ? (
              <label className="dvx-user-edit-restore">
                <input
                  type="checkbox"
                  checked={restoreFiles}
                  onChange={(event) =>
                    setRestoreFiles(event.currentTarget.checked)
                  }
                />
                <span>
                  Also restore {affectedFiles}{' '}
                  {affectedFiles === 1 ? 'file' : 'files'} Droid changed
                  after this message
                </span>
              </label>
            ) : null}
            <div className="dvx-user-edit-actions">
              <button
                className="dvx-message-action"
                type="button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                className="dvx-message-action dvx-user-edit-send"
                type="button"
                disabled={
                  !editResendEnabled ||
                  editText.trim().length === 0
                }
                onClick={submitEdit}
              >
                Resend
              </button>
            </div>
          </div>
        ) : resending ? (
          <div className="dvx-user-resending">
            <div className="dvx-user-bubble">{editText}</div>
            <div className="dvx-user-resending-note" role="status">
              <span className="dvx-user-resending-dot" aria-hidden="true" />
              Resending from here…
            </div>
          </div>
        ) : (
          <MessagePrimitive.Parts>
            {({ part }) =>
              part.type === 'text' ? (
                <div
                  className="dvx-user-bubble"
                  title={
                    editable
                      ? 'Double-click to edit and resend from here'
                      : 'Double-click to reuse in Composer'
                  }
                  onDoubleClick={editable ? openEditor : reuse}
                >
                  {part.text}
                </div>
              ) : null
            }
          </MessagePrimitive.Parts>
        )}
        {editing || resending ? null : (
          <ActionBarPrimitive.Root className="dvx-user-actions">
            <ActionBarPrimitive.Copy
              className="dvx-message-action dvx-copy-action"
              aria-label="Copy message"
              copiedDuration={1500}
            >
              <CopyActionContent />
            </ActionBarPrimitive.Copy>
            <button
              className="dvx-message-action"
              type="button"
              aria-label="Reuse message in Composer"
              onClick={reuse}
            >
              <ReuseIcon />
              <span>Reuse</span>
            </button>
            {editable ? (
              <button
                className="dvx-message-action"
                type="button"
                aria-label="Edit message and resend from here"
                onClick={openEditor}
              >
                <EditIcon />
                <span>Edit</span>
              </button>
            ) : null}
          </ActionBarPrimitive.Root>
        )}
        <span className="dvx-visually-hidden" aria-live="polite">
          {reused ? 'Message added to Composer.' : ''}
        </span>
      </div>
    </MessagePrimitive.Root>
  );
}

const AssistantMessage = memo(function AssistantMessage():
  React.JSX.Element {
  return (
    <MessagePrimitive.Root
      className="dvx-message dvx-message-assistant"
      aria-label="Droid"
    >
      <MessagePrimitive.Parts>
        {({ part }) => {
          switch (part.type) {
            case 'text':
              return <DroidMarkdownText />;
            case 'reasoning':
              return (
                <ThinkingRow
                  statusType={part.status?.type}
                  durationMs={readReasoningDuration(part)}
                />
              );
            case 'tool-call':
              return (
                <ToolActivityRow
                  activity={readToolActivity(part)}
                  toolName={part.toolName}
                />
              );
            case 'data':
              if (part.name === 'droid-diagnostic') {
                return <Diagnostic data={part.data} />;
              }
              if (part.name === 'droid-changes') {
                return <ChangesSummary data={part.data} />;
              }
              return null;
            default:
              return null;
          }
        }}
      </MessagePrimitive.Parts>
      <ActionBarPrimitive.Root
        className="dvx-assistant-actions"
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
  const busyResetRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
      <span>{busy ? 'Regenerating…' : 'Regenerate'}</span>
    </button>
  );
}

function ToolFilePath({
  path,
}: {
  readonly path: string;
}): React.JSX.Element {
  const openFileDiff = useContext(FileDiffContext);
  const fileName = path.split('/').at(-1) ?? path;
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
        Thinking
        <span className="dvx-activity-state">
          {formatPartStatus(statusType)}
          {durationMs !== null && statusType !== 'running'
            ? ` · ${formatDuration(durationMs)}`
            : ''}
        </span>
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
    typeof data !== 'object' ||
    data === null ||
    !Array.isArray((data as { files?: unknown }).files)
  ) {
    return [];
  }
  const files: ChangedFileEntry[] = [];
  for (const entry of (data as { files: unknown[] }).files) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== 'string'
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
      additions: typeof additions === 'number' ? additions : null,
      deletions: typeof deletions === 'number' ? deletions : null,
    });
  }
  return files;
}

function ChangesSummary({
  data,
}: {
  readonly data: unknown;
}): React.JSX.Element | null {
  const openFileDiff = useContext(FileDiffContext);
  const files = readChangedFiles(data);
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="dvx-changes" role="group" aria-label="Changed files">
      <span className="dvx-changes-label">
        Changes · {files.length} {files.length === 1 ? 'file' : 'files'}
      </span>
      <div className="dvx-changes-files">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className="dvx-changes-file"
            title={`Open changes for ${file.path}`}
            onClick={() => openFileDiff(file.path)}
          >
            <span className="dvx-changes-name">
              {file.path.split('/').at(-1) ?? file.path}
            </span>
            {file.additions !== null || file.deletions !== null ? (
              <span className="dvx-changes-stats">
                {file.additions !== null ? (
                  <span className="dvx-changes-add">
                    +{file.additions}
                  </span>
                ) : null}
                {file.deletions !== null ? (
                  <span className="dvx-changes-del">
                    −{file.deletions}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Diagnostic({ data }: { readonly data: unknown }): React.JSX.Element {
  const diagnostic = readDiagnostic(data);
  return (
    <div
      className={`dvx-diagnostic dvx-diagnostic-${diagnostic.severity}`}
      role={diagnostic.severity === 'error' ? 'alert' : 'status'}
      title={`${diagnostic.code}: ${diagnostic.message}`}
    >
      <code aria-hidden="true">{diagnostic.code}</code>
      <span>{diagnostic.message}</span>
    </div>
  );
}

function PendingResponse({
  activity,
}: {
  readonly activity?: 'working' | 'responding';
}): React.JSX.Element {
  return (
    <div
      className="dvx-message dvx-message-assistant dvx-pending"
      role="status"
      aria-live="polite"
    >
      <span className="dvx-runtime-pulse" aria-hidden="true" />
      {activity === 'working'
        ? 'Droid is working'
        : 'Droid is responding'}
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
  attachments,
  fileSearch,
  onFileSearch,
  onAttachPath,
  onAttachFiles,
  onAttachEditor,
  onAttachSelection,
  onAttachProblems,
  onAttachGitChanges,
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
  readonly attachments: readonly AttachmentSummary[];
  readonly fileSearch: FileSearchResult | null;
  readonly onFileSearch: (requestId: string, query: string) => void;
  readonly onAttachPath: (path: string) => void;
  readonly onAttachFiles: () => void;
  readonly onAttachEditor: () => void;
  readonly onAttachSelection: () => void;
  readonly onAttachProblems: () => void;
  readonly onAttachGitChanges: () => void;
  readonly onAttachmentRemove: (attachmentId: string) => void;
  readonly onDraftChange: (draft: string) => void;
}): React.JSX.Element {
  const aui = useAui();
  const draftRef = useRef('');
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(
    null,
  );
  const searchCounterRef = useRef(0);

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
    const next =
      draft.slice(0, mention.start) + draft.slice(mention.end);
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
          interactionPending ? ' dvx-composer-pending' : ''
        }`}
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
            {mention !== null && results.length > 0 ? (
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
                      index === activeIndex ? ' dvx-mention-active' : ''
                    }`}
                    onMouseDown={(event) => {
                      // Keep focus in the textarea while selecting.
                      event.preventDefault();
                      selectMention(path);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="dvx-mention-name">
                      {path.split('/').at(-1)}
                    </span>
                    <span className="dvx-mention-path">{path}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <ComposerPrimitive.Input
              id="dvx-prompt"
              className="dvx-composer-input"
              placeholder="Ask Droid about your workspace"
              rows={1}
              maxLength={MAX_TURN_TEXT_LENGTH}
              submitMode="enter"
              addAttachmentOnPaste={false}
              onChange={(event) => {
                const value = event.currentTarget.value;
                draftRef.current = value;
                onDraftChange(value);
                const caret =
                  event.currentTarget.selectionStart ?? value.length;
                const nextMention = findMentionToken(value, caret);
                setMention(nextMention);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (mention === null) {
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeMention();
                  return;
                }
                if (results.length === 0) {
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex(
                    (index) => (index + 1) % results.length,
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex(
                    (index) =>
                      (index - 1 + results.length) % results.length,
                  );
                } else if (
                  event.key === 'Enter' ||
                  event.key === 'Tab'
                ) {
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
          ? 'Pending request · Complete the action above'
          : running
            ? 'Droid is active · Stop before sending another message'
          : 'Enter to send · Shift+Enter for a new line'}
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
 * Finds an `@file` mention token ending at the caret. The `@` must be
 * at the start of the draft or preceded by whitespace, and the query
 * cannot contain whitespace or another `@`.
 */
function findMentionToken(
  value: string,
  caret: number,
): MentionToken | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) {
    return null;
  }
  const preceding = before[at - 1];
  if (preceding !== undefined && !/\s/.test(preceding)) {
    return null;
  }
  const query = before.slice(at + 1);
  if (
    /[\s@]/.test(query) ||
    query.length > MAX_FILE_SEARCH_QUERY_LENGTH
  ) {
    return null;
  }
  return { start: at, end: caret, query };
}

const ATTACHMENT_KIND_LABELS: Record<AttachmentSummary['kind'], string> = {
  image: 'Image',
  pdf: 'PDF',
  text: 'File',
  editor: 'Editor',
  selection: 'Selection',
};

function AttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: AttachmentSummary;
  readonly onRemove: (attachmentId: string) => void;
}): React.JSX.Element {
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
      <rect
        x="4.5"
        y="4.5"
        width="6"
        height="6"
        rx="1"
        stroke="currentColor"
      />
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

function EditIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="m9.6 2.2 2.2 2.2-6.6 6.6-2.7.5.5-2.7 6.6-6.6Z"
        stroke="currentColor"
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

function ReuseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 4.25h5.25a2.75 2.75 0 0 1 0 5.5H6.5M3 4.25l2-2m-2 2 2 2"
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
  if (historyStatus === 'unavailable') {
    return (
      <aside className="dvx-history-notice" role="note">
        Earlier CLI messages are unavailable here. You can continue this
        session.
      </aside>
    );
  }
  if (historyStatus === 'partial' || truncated) {
    return (
      <aside className="dvx-history-notice" role="note">
        {historyStatus === 'partial' && truncated
          ? 'Some earlier session content is unavailable, and older locally retained messages were trimmed.'
          : historyStatus === 'partial'
            ? 'Some earlier session content is unavailable through the public Droid history.'
            : 'Older messages were trimmed from the local display.'}
      </aside>
    );
  }
  return null;
}

function formatPartStatus(status: string | undefined): string {
  switch (status) {
    case 'running':
      return 'active';
    case 'incomplete':
      return 'stopped';
    default:
      return 'complete';
  }
}

interface ToolActivityPresentation {
  readonly action: string;
  readonly status: string;
  readonly progressCount: number;
  readonly latestUpdateKind: string | null;
  readonly durationMs: number | null;
  readonly filePath: string | null;
  readonly detailKind: 'command' | 'plan' | null;
  readonly detail: string | null;
}

function readToolActivity(part: unknown): ToolActivityPresentation {
  const fallback: ToolActivityPresentation = {
    action: 'Used a workspace tool',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    durationMs: null,
    filePath: null,
    detailKind: null,
    detail: null,
  };
  const metadata = readDroidvisxMetadata(part);
  if (
    metadata !== null &&
    'action' in metadata &&
    typeof metadata.action === 'string' &&
    'status' in metadata &&
    typeof metadata.status === 'string' &&
    'progressCount' in metadata &&
    Number.isSafeInteger(metadata.progressCount) &&
    'latestUpdateKind' in metadata &&
    (metadata.latestUpdateKind === null ||
      typeof metadata.latestUpdateKind === 'string')
  ) {
    const detailKind =
      metadata['detailKind'] === 'command' ||
      metadata['detailKind'] === 'plan'
        ? metadata['detailKind']
        : null;
    return {
      ...(metadata as Omit<
        ToolActivityPresentation,
        'durationMs' | 'filePath' | 'detailKind' | 'detail'
      >),
      durationMs: readMetadataDuration(metadata),
      filePath:
        typeof metadata['filePath'] === 'string' &&
        metadata['filePath'].length > 0
          ? metadata['filePath']
          : null,
      detailKind,
      detail:
        detailKind !== null &&
        typeof metadata['detail'] === 'string' &&
        metadata['detail'].length > 0
          ? metadata['detail']
          : null,
    };
  }
  return fallback;
}

interface PlanStep {
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly text: string;
}

/**
 * Parses the free-form todo text a task-plan tool wrote. The SDK sends
 * it as a numbered list where each line looks like
 * "1. [in_progress] Do the thing".
 */
function parsePlanSteps(detail: string): readonly PlanStep[] {
  const steps: PlanStep[] = [];
  for (const rawLine of detail.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(?:\d+[.)]\s*)?\[([^\]]*)\]\s*(.*)$/u.exec(line);
    const label = match?.[1]?.toLowerCase().replace(/[\s_-]/gu, '') ?? '';
    const text = (match?.[2] ?? line.replace(/^\d+[.)]\s*/u, '')).trim();
    if (text.length === 0) {
      continue;
    }
    const status: PlanStep['status'] =
      label.includes('progress') || label === 'active' || label === 'doing'
        ? 'in_progress'
        : label.includes('complete') ||
            label.includes('done') ||
            label === 'x' ||
            label === 'checked'
          ? 'completed'
          : 'pending';
    steps.push({ status, text });
  }
  return steps;
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
    (s) => s.message.status?.type === 'running',
  );
  const [open, setOpen] = useState(
    activity.detailKind === 'plan' && messageRunning,
  );
  const running = activity.status === 'running';
  return (
    <details
      className={`dvx-activity-row${
        running ? ' dvx-activity-running' : ''
      }`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="dvx-activity-indicator" />
        <span className="dvx-tool-action">{activity.action}</span>
        {activity.detailKind === 'command' && activity.detail !== null ? (
          <code className="dvx-tool-command-inline">
            {firstLine(activity.detail)}
          </code>
        ) : null}
        {activity.filePath === null ? null : (
          <ToolFilePath path={activity.filePath} />
        )}
        <span className="dvx-activity-state">
          {formatToolLifecycle(activity.status)}
          {activity.durationMs === null
            ? ''
            : ` · ${formatDuration(activity.durationMs)}`}
        </span>
        <ActivityChevron />
      </summary>
      {activity.detailKind === 'plan' && activity.detail !== null ? (
        <TaskPlan detail={activity.detail} />
      ) : activity.detailKind === 'command' && activity.detail !== null ? (
        <pre className="dvx-tool-command">{activity.detail}</pre>
      ) : (
        <div className="dvx-tool-summary">
          <code>{toolName}</code>
          <span>{formatToolProgress(activity)}</span>
        </div>
      )}
    </details>
  );
}

function TaskPlan({ detail }: { readonly detail: string }): React.JSX.Element {
  const steps = parsePlanSteps(detail);
  if (steps.length === 0) {
    return <pre className="dvx-tool-command">{detail}</pre>;
  }
  const completed = steps.filter(
    (step) => step.status === 'completed',
  ).length;
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

function readDroidvisxMetadata(
  part: unknown,
): Record<string, unknown> | null {
  if (
    typeof part === 'object' &&
    part !== null &&
    'providerMetadata' in part &&
    typeof part.providerMetadata === 'object' &&
    part.providerMetadata !== null &&
    'droidvisx' in part.providerMetadata &&
    typeof part.providerMetadata.droidvisx === 'object' &&
    part.providerMetadata.droidvisx !== null
  ) {
    return part.providerMetadata.droidvisx as Record<string, unknown>;
  }
  return null;
}

function readMetadataDuration(
  metadata: Record<string, unknown>,
): number | null {
  return typeof metadata['durationMs'] === 'number' &&
    Number.isFinite(metadata['durationMs']) &&
    metadata['durationMs'] >= 0
    ? metadata['durationMs']
    : null;
}

function readReasoningDuration(part: unknown): number | null {
  const metadata = readDroidvisxMetadata(part);
  return metadata === null ? null : readMetadataDuration(metadata);
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0] ?? text;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
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
    case 'running':
      return 'Working';
    case 'failed':
      return 'Failed';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Completed';
  }
}

function formatToolProgress(
  activity: ToolActivityPresentation,
): string {
  if (
    activity.progressCount === 0 ||
    activity.latestUpdateKind === null
  ) {
    return `Lifecycle: ${formatToolLifecycle(activity.status)}`;
  }
  const count = `${activity.progressCount} progress ${
    activity.progressCount === 1 ? 'update' : 'updates'
  }`;
  return `${count} · Latest: ${formatUpdateKind(
    activity.latestUpdateKind,
  )}`;
}

function formatUpdateKind(kind: string): string {
  switch (kind) {
    case 'tool-call':
      return 'tool started';
    case 'tool-result':
      return 'tool result';
    case 'error':
      return 'error';
    case 'status':
      return 'status';
    default:
      return 'message';
  }
}

function readUserMessageId(metadata: unknown): string | null {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'custom' in metadata &&
    typeof metadata.custom === 'object' &&
    metadata.custom !== null &&
    'messageId' in metadata.custom &&
    typeof metadata.custom.messageId === 'string' &&
    metadata.custom.messageId.length > 0
  ) {
    return metadata.custom.messageId;
  }
  return null;
}

function readMessageText(content: readonly unknown[]): string {
  return content
    .filter(
      (
        part,
      ): part is {
        readonly type: 'text';
        readonly text: string;
      } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('');
}

function readDiagnostic(data: unknown): {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
} {
  if (
    typeof data === 'object' &&
    data !== null &&
    'severity' in data &&
    (data.severity === 'info' ||
      data.severity === 'warning' ||
      data.severity === 'error') &&
    'code' in data &&
    typeof data.code === 'string' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data as {
      severity: 'info' | 'warning' | 'error';
      code: string;
      message: string;
    };
  }
  return {
    severity: 'warning',
    code: 'DIAGNOSTIC_UNAVAILABLE',
    message: 'Diagnostic details are unavailable.',
  };
}
