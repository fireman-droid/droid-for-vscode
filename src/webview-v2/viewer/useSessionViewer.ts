import { useEffect, useState } from 'react';
import { SESSION_VIEWER_PROTOCOL_VERSION, type SessionViewerSnapshotMessage } from '../../shared/protocol/sessionViewerProtocol';
import { parseSessionViewerHostMessage } from './validateSessionViewerHostMessage';
import type { ThemePreference } from '../../shared/protocol/shell';
import { reconcileViewerSnapshot } from './reconcileViewerSnapshot';

export function useSessionViewer(vscode: { postMessage(message: unknown): void }) {
  const [snapshot, setSnapshot] = useState<SessionViewerSnapshotMessage | null>(null);
  const [theme, setTheme] = useState<{ resolved: 'light' | 'dark'; preference: ThemePreference }>(() => {
    const preference = document.documentElement.dataset.dvxThemePreference;
    return {
      resolved: document.documentElement.dataset.dvxTheme === 'dark' ? 'dark' as const : 'light' as const,
      preference: preference === 'dark' || preference === 'light' ? preference : 'auto' as const,
    };
  });
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = parseSessionViewerHostMessage(event.data);
      if (message === null) return;
      if (message.type === 'sessionViewer.theme') {
        document.documentElement.dataset.dvxTheme = message.resolved;
        document.documentElement.dataset.dvxThemePreference = message.preference;
        setTheme({ resolved: message.resolved, preference: message.preference });
      } else setSnapshot((previous) => reconcileViewerSnapshot(previous, message));
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'sessionViewer.ready', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION });
    (window as Window & { __dvxBooted?: boolean }).__dvxBooted = true;
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);
  const canStop = snapshot?.running === true && snapshot.target.mode === 'standard';
  const stop = () => {
    if (canStop && snapshot?.stopping !== true) vscode.postMessage({ type: 'sessionViewer.stop', protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION });
  };
  return { snapshot, theme, canStop, stop };
}
