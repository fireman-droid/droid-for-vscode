import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SESSION_VIEWER_PROTOCOL_VERSION,
  type SessionViewerSnapshotMessage,
} from '../../shared/sessionViewerProtocol';
import { ReadOnlyTranscript } from '../assistant/ReadOnlyTranscript';
import { parseSessionViewerHostMessage } from './validateSessionViewerHostMessage';

interface SessionViewerPort {
  postMessage(message: unknown): void;
}

export function SessionViewerApp({
  vscode,
}: {
  readonly vscode: SessionViewerPort;
}): React.JSX.Element {
  const [snapshot, setSnapshot] =
    useState<SessionViewerSnapshotMessage | null>(null);
  const [theme, setTheme] = useState(() => ({
    resolved:
      document.documentElement.dataset.dvxTheme === 'dark'
        ? ('dark' as const)
        : ('light' as const),
    preference: readThemePreference(),
  }));
  const viewportRef = useRef<HTMLElement>(null);
  const followRef = useRef({ following: true });
  const getScroller = useCallback(
    (): HTMLElement | null => viewportRef.current,
    [],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const message = parseSessionViewerHostMessage(event.data);
      if (message === null) {
        return;
      }
      if (message.type === 'sessionViewer.theme') {
        document.documentElement.dataset.dvxTheme = message.resolved;
        document.documentElement.dataset.dvxThemePreference =
          message.preference;
        setTheme({
          resolved: message.resolved,
          preference: message.preference,
        });
        return;
      }
      setSnapshot(message);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({
      type: 'sessionViewer.ready',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });
    window.__dvxBooted = true;
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);

  useEffect(() => {
    if (!followRef.current.following) {
      return;
    }
    const viewport = viewportRef.current;
    if (viewport !== null) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [snapshot]);

  const title = snapshot?.target.title ?? 'Session activity';
  const running = snapshot?.running === true;
  const readOnly =
    snapshot?.target.mode === 'mission-readonly' ||
    snapshot?.target.mode === 'subagent-readonly';
  return (
    <main
      className="dvx-shell dvx-session-viewer"
      data-running={running}
      data-theme={theme.resolved}
      data-dvx-theme-preference={theme.preference}
    >
      <header className="dvx-session-viewer-header">
        <div className="dvx-session-viewer-heading">
          <h1>{title}</h1>
          <span className="dvx-session-viewer-state" role="status">
            {snapshot === null
              ? 'Loading'
              : snapshot.stopping
              ? 'Stopping…'
              : lifecycleLabel(snapshot.lifecycle)}
          </span>
        </div>
        {running && !readOnly ? (
          <button
            type="button"
            className="dvx-session-viewer-stop"
            disabled={snapshot?.stopping === true}
            onClick={() => {
              vscode.postMessage({
                type: 'sessionViewer.stop',
                protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
              });
            }}
          >
            Stop
          </button>
        ) : null}
      </header>
      {snapshot?.stopError ? (
        <p className="dvx-session-viewer-error" role="alert">
          Stop failed. The session may still be working.
        </p>
      ) : null}
      <section
        ref={viewportRef}
        className="dvx-session-viewer-viewport"
        aria-label="Read-only session transcript"
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current.following =
            element.scrollHeight -
              element.scrollTop -
              element.clientHeight <
            48;
        }}
      >
        <div className="dvx-session-viewer-content">
          {snapshot === null ? (
            <p className="dvx-session-viewer-status">
              Loading session…
            </p>
          ) : snapshot.status === 'unavailable' ? (
            <p className="dvx-session-viewer-status">
              {snapshot.reason}
            </p>
          ) : (
            <>
              {snapshot.truncated ? (
                <p className="dvx-session-viewer-note">
                  Older transcript items were omitted.
                </p>
              ) : null}
              <ReadOnlyTranscript
                items={snapshot.items}
                running={snapshot.running}
                className="dvx-session-viewer-thread"
                getScroller={getScroller}
                followingRef={followRef}
              />
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function lifecycleLabel(
  lifecycle: SessionViewerSnapshotMessage['lifecycle'],
): string {
  return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);
}

function readThemePreference(): 'light' | 'dark' | 'auto' {
  const preference =
    document.documentElement.dataset.dvxThemePreference;
  return preference === 'light' || preference === 'dark'
    ? preference
    : 'auto';
}
