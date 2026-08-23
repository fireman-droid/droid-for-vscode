import {
  MISSION_CONTROL_CATALOG_FILTERS,
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  parseMissionControlPanelHostMessage,
  type MissionControlCatalogFilter,
  type MissionControlCatalogRow,
} from '../../shared/missionControlPanelProtocol';

declare global {
  interface Window {
    __dvxApi?: {
      postMessage(message: unknown): void;
    };
    __dvxBooted?: boolean;
  }
}

const root = document.getElementById('root');
const vscode = window.__dvxApi;
if (root === null || vscode === undefined) {
  throw new Error('Mission Control failed to initialize.');
}
const missionRoot = root;
const missionVscode = vscode;

let filter: MissionControlCatalogFilter = 'all';
let rows: readonly MissionControlCatalogRow[] = [];
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
    renderReady();
  } else {
    renderError(message.error.message, message.error.retryable);
  }
});

renderLoading();
window.__dvxBooted = true;
missionVscode.postMessage({
  type: 'missionControl.ready',
  protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
});

function requestCatalog(nextFilter: MissionControlCatalogFilter): void {
  filter = nextFilter;
  requestCounter += 1;
  latestRequestId = `catalog-webview-${Date.now()}-${requestCounter}`;
  renderLoading(rows.length > 0);
  missionVscode.postMessage({
    type: 'missionControl.catalog.request',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId: latestRequestId,
    filter,
  });
}

function renderLoading(stale = false): void {
  renderShell(
    stale ? 'Refreshing Missions…' : 'Loading Missions…',
    stale ? renderRows() : undefined,
  );
}

function renderReady(): void {
  renderShell(
    rows.length === 0 ? 'No Missions found.' : `${rows.length} Missions`,
    renderRows(),
  );
}

function renderError(message: string, retryable: boolean): void {
  const content = document.createElement('div');
  if (rows.length > 0) {
    content.append(renderRows());
  }
  const error = document.createElement('p');
  error.className = 'mission-control-error';
  error.textContent = message;
  content.append(error);
  if (retryable) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => requestCatalog(filter));
    content.append(retry);
  }
  renderShell('Mission catalog unavailable', content);
}

function renderShell(status: string, content?: HTMLElement): void {
  missionRoot.replaceChildren();
  const main = document.createElement('main');
  const heading = document.createElement('h1');
  heading.textContent = 'Mission Control';
  const description = document.createElement('p');
  description.textContent =
    'Browse Missions known to your local Droid daemon.';
  const filters = document.createElement('nav');
  filters.className = 'mission-control-filters';
  filters.setAttribute('aria-label', 'Mission filters');
  for (const value of MISSION_CONTROL_CATALOG_FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent =
      value.slice(0, 1).toUpperCase() + value.slice(1);
    button.setAttribute('aria-pressed', String(filter === value));
    button.addEventListener('click', () => requestCatalog(value));
    filters.append(button);
  }
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => requestCatalog(filter));
  filters.append(refresh);
  const liveStatus = document.createElement('p');
  liveStatus.className = 'mission-control-status';
  liveStatus.setAttribute('role', 'status');
  liveStatus.textContent = status;
  main.append(heading, description, filters, liveStatus);
  if (content !== undefined) {
    main.append(content);
  }
  missionRoot.append(main);
}

function renderRows(): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'mission-control-list';
  for (const row of rows) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = row.title;
    const details = document.createElement('span');
    details.textContent = `${row.workspaceLabel} · ${row.lifecycle}`;
    item.append(title, details);
    list.append(item);
  }
  return list;
}
