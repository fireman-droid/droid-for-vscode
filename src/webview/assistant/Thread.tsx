import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { memo } from 'react';

import {
  MAX_TURN_TEXT_LENGTH,
  type SessionHistoryStatus,
} from '../../shared/bridgeMessages';
import { DroidMarkdownText } from './MarkdownText';

interface DroidThreadProps {
  readonly pending: boolean;
  readonly activity?: 'working' | 'responding';
  readonly historyStatus: SessionHistoryStatus | null;
  readonly truncated: boolean;
  readonly statusMessage?: string;
  readonly showRetry: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly onRetry: () => void;
  readonly onDraftChange: (draft: string) => void;
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
  onRetry,
  onDraftChange,
}: DroidThreadProps): React.JSX.Element {
  return (
    <ThreadPrimitive.Root className="dvx-thread">
      <ThreadPrimitive.Viewport
        className="dvx-thread-viewport"
        aria-label="Chat transcript"
      >
        <div className="dvx-reading-column">
          <HistoryNotice
            historyStatus={historyStatus}
            truncated={truncated}
          />
          <ThreadPrimitive.Empty>
            <div className="dvx-empty-state">
              <span className="dvx-empty-mark" aria-hidden="true">
                D
              </span>
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
                <UserMessage />
              ) : (
                <AssistantMessage />
              )
            }
          </ThreadPrimitive.Messages>
          {pending ? <PendingResponse activity={activity} /> : null}
        </div>
        <ThreadPrimitive.ScrollToBottom
          className="dvx-scroll-bottom"
          aria-label="Scroll to latest message"
        >
          ↓
        </ThreadPrimitive.ScrollToBottom>
        <ThreadPrimitive.ViewportFooter className="dvx-thread-footer">
          <Composer
            statusMessage={statusMessage}
            showRetry={showRetry}
            running={running}
            stopping={stopping}
            onRetry={onRetry}
            onDraftChange={onDraftChange}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
});

function UserMessage(): React.JSX.Element {
  return (
    <MessagePrimitive.Root
      className="dvx-message dvx-message-user"
      aria-label="You"
    >
      <MessagePrimitive.Parts>
        {({ part }) =>
          part.type === 'text' ? (
            <div className="dvx-user-bubble">{part.text}</div>
          ) : null
        }
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage(): React.JSX.Element {
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
                <details className="dvx-activity-row">
                  <summary>
                    <span className="dvx-activity-indicator" />
                    Thinking
                    <span className="dvx-activity-state">
                      {formatPartStatus(part.status?.type)}
                    </span>
                  </summary>
                  <pre>{part.text}</pre>
                </details>
              );
            case 'tool-call': {
              const lifecycle = readToolLifecycle(part);
              return (
                <details className="dvx-activity-row">
                  <summary>
                    <span className="dvx-activity-indicator" />
                    <code>{part.toolName}</code>
                    <span className="dvx-activity-state">
                      {lifecycle}
                    </span>
                  </summary>
                  <div className="dvx-tool-identity">
                    Tool call <code>{part.toolCallId}</code>
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
    >
      <code>{diagnostic.code}</code>
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
  onRetry,
  onDraftChange,
}: {
  readonly statusMessage?: string;
  readonly showRetry: boolean;
  readonly running: boolean;
  readonly stopping: boolean;
  readonly onRetry: () => void;
  readonly onDraftChange: (draft: string) => void;
}): React.JSX.Element {
  return (
    <div className="dvx-composer-wrap">
      <div className="dvx-composer-seam" aria-hidden="true" />
      <ComposerPrimitive.Root className="dvx-composer">
        <label className="dvx-visually-hidden" htmlFor="dvx-prompt">
          Message Droid
        </label>
        <ComposerPrimitive.Input
          id="dvx-prompt"
          className="dvx-composer-input"
          placeholder="Ask about your workspace"
          rows={1}
          maxLength={MAX_TURN_TEXT_LENGTH}
          submitMode="enter"
          addAttachmentOnPaste={false}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <div className="dvx-composer-footer">
          <span className="dvx-composer-status" aria-live="polite">
            {statusMessage}
          </span>
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
            <ComposerPrimitive.Send className="dvx-composer-action">
              Send
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
      <div className="dvx-composer-hint">
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
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
      <div className="dvx-history-notices">
        {historyStatus === 'partial' ? (
          <aside className="dvx-history-notice" role="note">
            Some earlier session content is not shown.
          </aside>
        ) : null}
        {truncated ? (
          <aside className="dvx-history-notice" role="note">
            Older messages are not shown.
          </aside>
        ) : null}
      </div>
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

function readToolLifecycle(part: unknown): string {
  if (
    typeof part === 'object' &&
    part !== null &&
    'providerMetadata' in part &&
    typeof part.providerMetadata === 'object' &&
    part.providerMetadata !== null &&
    'droidvisx' in part.providerMetadata &&
    typeof part.providerMetadata.droidvisx === 'object' &&
    part.providerMetadata.droidvisx !== null &&
    'status' in part.providerMetadata.droidvisx &&
    typeof part.providerMetadata.droidvisx.status === 'string'
  ) {
    return part.providerMetadata.droidvisx.status;
  }
  return 'complete';
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
