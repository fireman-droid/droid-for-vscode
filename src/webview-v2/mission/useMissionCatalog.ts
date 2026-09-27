import { useCallback, useEffect, useRef, useState } from 'react';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION, parseMissionControlPanelHostMessage, type MissionControlCatalogFilter, type MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import type { MissionCatalogNavigation, MissionCatalogState } from './catalogPresentation';
import type { ThemePreference } from '../../shared/protocol/shell';

export function useMissionCatalog(vscode: { postMessage(message: unknown): void }) {
  const current = useRef({ filter: 'all' as MissionControlCatalogFilter, rows: [] as readonly MissionControlCatalogRow[], request: null as string | null, counter: 0 });
  const [state, setState] = useState<MissionCatalogState>({ status: 'loading', rows: [] });
  const [filter, setFilter] = useState<MissionControlCatalogFilter>('all');
  const navigationRequest = useRef<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [theme, setTheme] = useState<{ preference: ThemePreference; resolved: 'light' | 'dark' } | null>(null);
  const refreshState = () => setState(current.current.rows.length > 0 ? { status: 'refreshing', rows: current.current.rows } : { status: 'loading', rows: [] });
  const focusHeading = () => queueMicrotask(() => document.querySelector<HTMLElement>('h1')?.focus());
  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      const message = parseMissionControlPanelHostMessage(event.data);
      if (message === undefined) return;
      if (message.type === 'missionControl.theme') {
        document.documentElement.dataset.dvxTheme = message.resolved;
        document.documentElement.dataset.dvxThemePreference = message.preference;
        setTheme({ preference: message.preference, resolved: message.resolved });
      } else if (message.type === 'missionControl.navigationRejected') {
        if (message.requestId !== navigationRequest.current) return;
        setNavigationError(message.reason === 'busy'
          ? 'A Mission is starting. Wait for startup to finish, then try again.'
          : 'This Mission cannot be opened in the current chat catalog. Open its repository workspace, then refresh. Archived or unavailable sessions may remain listed here.');
      } else if (message.type === 'missionControl.route') {
        if (message.route === 'catalog') { current.current.request = null; refreshState(); }
        focusHeading();
      } else if (message.type !== 'missionControl.setup.snapshot') {
        if (current.current.request !== null && message.requestId !== current.current.request) return;
        current.current.request = message.requestId;
        current.current.filter = message.filter;
        setFilter(message.filter);
        if (message.status === 'ready') { current.current.rows = message.rows; setState({ status: 'ready', rows: message.rows }); }
        else setState({ status: 'error', rows: current.current.rows, message: message.error.message, retryable: message.error.retryable });
      }
    };
    window.addEventListener('message', listener);
    (window as Window & { __dvxBooted?: boolean }).__dvxBooted = true;
    vscode.postMessage({ type: 'missionControl.ready', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION });
    return () => window.removeEventListener('message', listener);
  }, [vscode]);
  const requestCatalog = useCallback((next: MissionControlCatalogFilter) => {
    const flow = current.current;
    navigationRequest.current = null;
    setNavigationError(null);
    flow.filter = next; setFilter(next);
    flow.request = `catalog-webview-${Date.now()}-${++flow.counter}`;
    refreshState();
    vscode.postMessage({ type: 'missionControl.catalog.request', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION, requestId: flow.request, filter: next });
  }, [vscode]);
  const navigate = useCallback((navigation: MissionCatalogNavigation) => {
    const requestId = `navigate-webview-${Date.now()}-${++current.current.counter}`;
    navigationRequest.current = requestId;
    setNavigationError(null);
    if (navigation.route === 'catalog') { current.current.request = requestId; refreshState(); }
    vscode.postMessage({ type: 'missionControl.navigate', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION, requestId, ...navigation });
    focusHeading();
  }, [vscode]);
  return { state, filter, theme, navigationError, onFilter: requestCatalog, onRefresh: () => requestCatalog(current.current.filter), onNavigate: navigate };
}
