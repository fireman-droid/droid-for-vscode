import { useCallback, useEffect, useRef } from 'react';

import { type SessionViewerSnapshotMessage } from '../../shared/protocol/sessionViewerProtocol';
import { ReadOnlyTranscript } from '../assistant/transcript/ReadOnlyTranscript';
import { useSessionViewer } from './useSessionViewer';

interface SessionViewerPort {
  postMessage(message: unknown): void;
}

export function SessionViewerApp({
  vscode,
}: {
  readonly vscode: SessionViewerPort;
}): React.JSX.Element {
  const { snapshot, theme, canStop, stop } = useSessionViewer(vscode);
  const viewportRef = useRef<HTMLElement>(null);
  const followRef = useRef({ following: true });
  const getScroller = useCallback((): HTMLElement | null => viewportRef.current, []);

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
        {canStop ? (
          <button
            type="button"
            className="dvx-session-viewer-stop"
            disabled={snapshot?.stopping === true}
            onClick={stop}
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
            element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        <div className="dvx-session-viewer-content">
          {snapshot === null ? (
            <p className="dvx-session-viewer-status">Loading session…</p>
          ) : snapshot.status === 'unavailable' ? (
            <p className="dvx-session-viewer-status">{snapshot.reason}</p>
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

function lifecycleLabel(lifecycle: SessionViewerSnapshotMessage['lifecycle']): string {
  return lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1);
}
