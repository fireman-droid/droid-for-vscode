import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { memo, type ReactNode, useState } from 'react';

import {
  MAX_TURN_TEXT_LENGTH,
  type ModelCatalogState,
  type SessionHistoryStatus,
  type SessionContextState,
  type SessionSettingsState,
} from '../../shared/bridgeMessages';
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

interface DroidThreadProps {
  readonly pending: boolean;
  readonly activity?: 'working' | 'responding';
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
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
  readonly onRetry: () => void;
  readonly onContextRefresh: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onReuseMessage: (text: string) => void;
  readonly inlineInteraction?: ReactNode;
}

export const DroidThread = memo(function DroidThread({
  pending,
  activity,
  historyStatus,
  truncated,
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
  onRetry,
  onContextRefresh,
  onSettingUpdate,
  onDraftChange,
  onReuseMessage,
  inlineInteraction,
}: DroidThreadProps): React.JSX.Element {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

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
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize
        scrollToBottomOnThreadSwitch
      >
        <div className="dvx-reading-column">
          <HistoryNotice
            historyStatus={historyStatus}
            truncated={truncated}
          />
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
                  onReuse={onReuseMessage}
                />
              ) : (
                <AssistantMessage
                  thinkingExpanded={thinkingExpanded}
                  onThinkingExpandedChange={setThinkingExpanded}
                />
              )
            }
          </ThreadPrimitive.Messages>
          {pending ? <PendingResponse activity={activity} /> : null}
          {inlineInteraction}
        </div>
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
            onRetry={onRetry}
            onContextRefresh={onContextRefresh}
            onSettingUpdate={onSettingUpdate}
            onDraftChange={onDraftChange}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
});

function UserMessage({
  text,
  onReuse,
}: {
  readonly text: string;
  readonly onReuse: (text: string) => void;
}): React.JSX.Element {
  const [reused, setReused] = useState(false);
  const reuse = (): void => {
    onReuse(text);
    setReused(true);
  };
  return (
    <MessagePrimitive.Root
      className="dvx-message dvx-message-user"
      aria-label="You"
    >
      <div className="dvx-user-message-content">
        <MessagePrimitive.Parts>
          {({ part }) =>
            part.type === 'text' ? (
              <div
                className="dvx-user-bubble"
                title="Double-click to reuse in Composer"
                onDoubleClick={reuse}
              >
                {part.text}
              </div>
            ) : null
          }
        </MessagePrimitive.Parts>
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
        </ActionBarPrimitive.Root>
        <span className="dvx-visually-hidden" aria-live="polite">
          {reused ? 'Message added to Composer.' : ''}
        </span>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage({
  thinkingExpanded,
  onThinkingExpandedChange,
}: {
  readonly thinkingExpanded: boolean;
  readonly onThinkingExpandedChange: (expanded: boolean) => void;
}): React.JSX.Element {
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
                <details
                  className="dvx-activity-row dvx-thinking-row"
                  open={thinkingExpanded}
                  onToggle={(event) =>
                    onThinkingExpandedChange(event.currentTarget.open)
                  }
                >
                  <summary>
                    <span className="dvx-activity-indicator" />
                    Thinking
                    <span className="dvx-activity-state">
                      {formatPartStatus(part.status?.type)}
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
    </MessagePrimitive.Root>
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
  onRetry,
  onContextRefresh,
  onSettingUpdate,
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
  readonly onRetry: () => void;
  readonly onContextRefresh: () => void;
  readonly onSettingUpdate: (update: SessionSettingSelection) => void;
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
            disabled={controlsDisabled}
            settingUpdatesDisabled={settingUpdatesDisabled}
            onContextRefresh={onContextRefresh}
            onSettingUpdate={onSettingUpdate}
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
}

function readToolActivity(part: unknown): ToolActivityPresentation {
  const fallback: ToolActivityPresentation = {
    action: 'Used a workspace tool',
    status: 'completed',
    progressCount: 0,
    latestUpdateKind: null,
  };
  if (
    typeof part === 'object' &&
    part !== null &&
    'providerMetadata' in part &&
    typeof part.providerMetadata === 'object' &&
    part.providerMetadata !== null &&
    'droidvisx' in part.providerMetadata &&
    typeof part.providerMetadata.droidvisx === 'object' &&
    part.providerMetadata.droidvisx !== null &&
    'action' in part.providerMetadata.droidvisx &&
    typeof part.providerMetadata.droidvisx.action === 'string' &&
    'status' in part.providerMetadata.droidvisx &&
    typeof part.providerMetadata.droidvisx.status === 'string' &&
    'progressCount' in part.providerMetadata.droidvisx &&
    Number.isSafeInteger(
      part.providerMetadata.droidvisx.progressCount,
    ) &&
    'latestUpdateKind' in part.providerMetadata.droidvisx &&
    (part.providerMetadata.droidvisx.latestUpdateKind === null ||
      typeof part.providerMetadata.droidvisx.latestUpdateKind ===
        'string')
  ) {
    return part.providerMetadata.droidvisx as ToolActivityPresentation;
  }
  return fallback;
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
