import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import {
  createContext,
  memo,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  MAX_TURN_TEXT_LENGTH,
  type ModelCatalogState,
  type SessionHistoryStatus,
  type SessionContextState,
  type SessionSettingsState,
} from '../../shared/bridgeMessages';
import type { McpPanelState, SkillsPanelState } from './ComposerControls';
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

interface ThinkingExpansion {
  readonly expanded: boolean;
  readonly setExpanded: (expanded: boolean) => void;
}

// Holding the shared Thinking expansion in a dedicated provider keeps a
// toggle from re-rendering the whole transcript: only Thinking rows
// subscribe to this context.
const ThinkingExpansionContext = createContext<ThinkingExpansion>({
  expanded: false,
  setExpanded: () => undefined,
});

function ThinkingExpansionProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const value = useMemo(
    () => ({ expanded, setExpanded }),
    [expanded],
  );
  return (
    <ThinkingExpansionContext.Provider value={value}>
      {children}
    </ThinkingExpansionContext.Provider>
  );
}

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
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onReuseMessage: (text: string) => void;
  readonly onEditResend: (messageId: string, text: string) => void;
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
  onSettingUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
  onDraftChange,
  onReuseMessage,
  onEditResend,
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
        <ThinkingExpansionProvider>
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
        </ThinkingExpansionProvider>
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
            onSettingUpdate={onSettingUpdate}
            onSkillsRefresh={onSkillsRefresh}
            onSkillToggle={onSkillToggle}
            onMcpRefresh={onMcpRefresh}
            onMcpServerToggle={onMcpServerToggle}
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
  onReuse,
  onEditResend,
}: {
  readonly text: string;
  readonly messageId: string | null;
  readonly editResendEnabled: boolean;
  readonly onReuse: (text: string) => void;
  readonly onEditResend: (messageId: string, text: string) => void;
}): React.JSX.Element {
  const [reused, setReused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const editable = messageId !== null;
  const reuse = (): void => {
    onReuse(text);
    setReused(true);
  };
  const openEditor = (): void => {
    setEditText(text);
    setEditing(true);
  };
  const submitEdit = (): void => {
    if (
      messageId === null ||
      !editResendEnabled ||
      editText.trim().length === 0
    ) {
      return;
    }
    setEditing(false);
    onEditResend(messageId, editText);
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
        {editing ? null : (
          <ActionBarPrimitive.Root className="dvx-user-actions">
            <ActionBarPrimitive.Copy
              className="dvx-message-action"
              aria-label="Copy message"
            >
              <CopyIcon />
              <span>Copy</span>
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
            case 'tool-call': {
              const activity = readToolActivity(part);
              return (
                <details className="dvx-activity-row">
                  <summary>
                    <span className="dvx-activity-indicator" />
                    <span className="dvx-tool-action">
                      {activity.action}
                    </span>
                    <span className="dvx-activity-state">
                      {formatToolLifecycle(activity.status)}
                      {activity.durationMs === null
                        ? ''
                        : ` · ${formatDuration(activity.durationMs)}`}
                    </span>
                    <ActivityChevron />
                  </summary>
                  <div className="dvx-tool-summary">
                    <code>{part.toolName}</code>
                    <span>{formatToolProgress(activity)}</span>
                  </div>
                </details>
              );
            }
            case 'data':
              return part.name === 'droid-diagnostic' ? (
                <Diagnostic data={part.data} />
              ) : null;
            default:
              return null;
          }
        }}
      </MessagePrimitive.Parts>
      <ActionBarPrimitive.Root className="dvx-assistant-actions">
        <ActionBarPrimitive.Copy
          className="dvx-message-action"
          aria-label="Copy response"
        >
          <CopyIcon />
          <span>Copy</span>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
});

function ThinkingRow({
  statusType,
  durationMs,
}: {
  readonly statusType: string | undefined;
  readonly durationMs: number | null;
}): React.JSX.Element {
  const { expanded, setExpanded } = useContext(ThinkingExpansionContext);
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
  onSettingUpdate,
  onSkillsRefresh,
  onSkillToggle,
  onMcpRefresh,
  onMcpServerToggle,
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
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onSkillsRefresh: () => void;
  readonly onSkillToggle: (name: string, disabled: boolean) => void;
  readonly onMcpRefresh: () => void;
  readonly onMcpServerToggle: (name: string, enabled: boolean) => void;
  readonly onDraftChange: (draft: string) => void;
}): React.JSX.Element {
  return (
    <div className="dvx-composer-wrap">
      <div className="dvx-composer-seam" aria-hidden="true" />
      <ComposerPrimitive.Root
        className={`dvx-composer${
          interactionPending ? ' dvx-composer-pending' : ''
        }`}
      >
        {interactionPending ? null : (
          <>
            <label className="dvx-visually-hidden" htmlFor="dvx-prompt">
              Message Droid
            </label>
            <ComposerPrimitive.Input
              id="dvx-prompt"
              className="dvx-composer-input"
              placeholder="Ask Droid about your workspace"
              rows={1}
              maxLength={MAX_TURN_TEXT_LENGTH}
              submitMode="enter"
              addAttachmentOnPaste={false}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
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
            onSettingUpdate={onSettingUpdate}
            onSkillsRefresh={onSkillsRefresh}
            onSkillToggle={onSkillToggle}
            onMcpRefresh={onMcpRefresh}
            onMcpServerToggle={onMcpServerToggle}
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
}

function readToolActivity(part: unknown): ToolActivityPresentation {
  const fallback: ToolActivityPresentation = {
    action: 'Used a workspace tool',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
    durationMs: null,
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
    return {
      ...(metadata as Omit<ToolActivityPresentation, 'durationMs'>),
      durationMs: readMetadataDuration(metadata),
    };
  }
  return fallback;
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
