import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  parseMissionControlPanelHostMessage,
  type MissionControlCatalogFilter,
  type MissionControlCatalogRow,
} from '../../shared/missionControlPanelProtocol';
import {
  MissionCatalog,
  type MissionCatalogNavigation,
  type MissionCatalogState,
} from './MissionCatalog';

declare global {
  interface Window {
    __dvxApi?: {
      postMessage(message: unknown): void;
    };
    __dvxBooted?: boolean;
  }
}

const rootElement = document.getElementById('root');
const vscode = window.__dvxApi;
if (rootElement === null || vscode === undefined) {
  throw new Error('Mission Control failed to initialize.');
}
const root = createRoot(rootElement);
const missionVscode = vscode;

let filter: MissionControlCatalogFilter = 'all';
let rows: readonly MissionControlCatalogRow[] = [];
let state: MissionCatalogState = { status: 'loading', rows };
let requestCounter = 0;
let latestRequestId: string | null = null;

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = parseMissionControlPanelHostMessage(event.data);
  if (message === undefined) {
    return;
  }
  if (message.type === 'missionControl.theme') {
    document.documentElement.dataset.dvxTheme = message.resolved;
    document.documentElement.dataset.dvxThemePreference = message.preference;
    return;
  }
  if (message.type === 'missionControl.route') {
    if (message.route === 'catalog') {
      latestRequestId = null;
      state =
        rows.length > 0
          ? { status: 'refreshing', rows }
          : { status: 'loading', rows: [] };
      renderCatalog();
    }
    focusHeading();
    return;
  }
  if (message.type === 'missionControl.setup.snapshot') {
    return;
  }
  if (
    latestRequestId !== null &&
    message.requestId !== latestRequestId
  ) {
    return;
  }
  latestRequestId = message.requestId;
  filter = message.filter;
  if (message.status === 'ready') {
    rows = message.rows;
    state = { status: 'ready', rows };
  } else {
    state = {
      status: 'error',
      rows,
      message: message.error.message,
      retryable: message.error.retryable,
    };
  }
  renderCatalog();
});

renderCatalog();
window.__dvxBooted = true;
missionVscode.postMessage({
  type: 'missionControl.ready',
  protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
});

function requestCatalog(nextFilter: MissionControlCatalogFilter): void {
  filter = nextFilter;
  requestCounter += 1;
  latestRequestId = `catalog-webview-${Date.now()}-${requestCounter}`;
  state =
    rows.length > 0
      ? { status: 'refreshing', rows }
      : { status: 'loading', rows: [] };
  renderCatalog();
  missionVscode.postMessage({
    type: 'missionControl.catalog.request',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId: latestRequestId,
    filter,
  });
}

function navigate(navigation: MissionCatalogNavigation): void {
  requestCounter += 1;
  const requestId = `navigate-webview-${Date.now()}-${requestCounter}`;
  if (navigation.route === 'catalog') {
    latestRequestId = requestId;
    state =
      rows.length > 0
        ? { status: 'refreshing', rows }
        : { status: 'loading', rows: [] };
  }
  missionVscode.postMessage({
    type: 'missionControl.navigate',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId,
    ...navigation,
  });
  if (navigation.route === 'catalog') {
    renderCatalog();
  }
  focusHeading();
}

function renderCatalog(): void {
  root.render(
    createElement(MissionCatalog, {
      state,
      filter,
      onFilter: requestCatalog,
      onRefresh: () => requestCatalog(filter),
      onNavigate: navigate,
    }),
  );
}

function focusHeading(): void {
  queueMicrotask(() => {
    document.querySelector<HTMLElement>('h1')?.focus();
  });
}
