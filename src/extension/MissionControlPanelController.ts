import * as vscode from 'vscode';

import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  parseMissionControlPanelWebviewMessage,
  type MissionControlCatalogFilter,
  type MissionControlCatalogRow,
  type MissionControlPanelHostMessage,
} from '../shared/missionControlPanelProtocol';
import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import type { MissionCatalogResult } from './chat/mission/MissionGateway';
import { getWebviewHtml } from './webviewHtml';
import {
  readWebviewBootTheme,
  readWebviewThemePreference,
} from './webviewTheme';

const VIEW_TYPE = 'droidvisx.missionControl';
const PANEL_TITLE = 'Mission Control';
export const MISSION_CONTROL_CATALOG_DEADLINE_MS = 20_000;

export type MissionControlRoute = 'catalog' | 'new-mission' | 'detail';

export interface MissionControlCatalogSource {
  listCatalog(): Promise<MissionCatalogResult>;
}

export interface MissionControlPanelControllerOptions {
  readonly deadlineMs?: number;
}

interface CatalogState {
  readonly filter: MissionControlCatalogFilter;
  readonly rows: readonly MissionControlCatalogRow[];
  readonly revision: number;
}

interface CatalogOperation {
  readonly owner: object;
  readonly panelInstance: number;
  readonly routeRevision: number;
  readonly requestId: string;
  readonly filter: MissionControlCatalogFilter;
  readonly revision: number;
}

interface PanelEntry {
  readonly instance: number;
  readonly panel: vscode.WebviewPanel;
  readonly disposables: vscode.Disposable[];
  readonly seenRequestIds: Set<string>;
  ready: boolean;
}

export class MissionControlPanelController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[];
  private readonly deadlineMs: number;
  private panelEntry: PanelEntry | null = null;
  private route: MissionControlRoute = 'catalog';
  private detailCatalogId: string | null = null;
  private routeRevision = 0;
  private catalog: CatalogState = {
    filter: 'all',
    rows: [],
    revision: 0,
  };
  private activeOperation: CatalogOperation | null = null;
  private nextPanelInstance = 1;
  private nextSequence = 1;
  private nextCatalogRevision = 1;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly source: MissionControlCatalogSource,
    options: MissionControlPanelControllerOptions = {},
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {
    this.deadlineMs =
      options.deadlineMs ?? MISSION_CONTROL_CATALOG_DEADLINE_MS;
    this.subscriptions = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('droidvisx.theme')) {
          this.postTheme();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        if (readWebviewThemePreference() === 'auto') {
          this.postTheme();
        }
      }),
    ];
  }

  open(): void {
    if (this.disposed) {
      return;
    }
    if (this.panelEntry !== null) {
      this.navigate('catalog');
      this.post({
        type: 'missionControl.route',
        protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        route: 'catalog',
      });
      this.panelEntry.panel.reveal(undefined, false);
      return;
    }

    this.route = 'catalog';
    this.routeRevision += 1;
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'resources'),
        ],
      },
    );
    const instance = this.nextPanelInstance;
    this.nextPanelInstance += 1;
    const entry: PanelEntry = {
      instance,
      panel,
      disposables: [],
      seenRequestIds: new Set(),
      ready: false,
    };
    this.panelEntry = entry;
    entry.disposables.push(
      panel.webview.onDidReceiveMessage((value: unknown) => {
        this.handleMessage(entry, value);
      }),
      panel.onDidDispose(() => {
        this.disposePanel(entry);
      }),
    );
    const webviewDistUri = vscode.Uri.joinPath(
      this.extensionUri,
      'dist',
      'webview',
    );
    panel.webview.html = getWebviewHtml(
      panel.webview,
      {
        script: vscode.Uri.joinPath(
          webviewDistUri,
          'mission-control.js',
        ),
        style: vscode.Uri.joinPath(
          webviewDistUri,
          'mission-control.css',
        ),
      },
      undefined,
      readWebviewBootTheme(),
    );
  }

  navigate(route: 'catalog' | 'new-mission'): void;
  navigate(route: 'detail', catalogId: string): void;
  navigate(route: MissionControlRoute, catalogId: string | null = null): void {
    const nextCatalogId = route === 'detail' ? catalogId : null;
    if (this.route === route && this.detailCatalogId === nextCatalogId) {
      return;
    }
    this.route = route;
    this.detailCatalogId = nextCatalogId;
    this.routeRevision += 1;
    this.activeOperation = null;
  }

  routeState(): {
    readonly route: MissionControlRoute;
    readonly catalogId: string | null;
  } {
    return { route: this.route, catalogId: this.detailCatalogId };
  }

  catalogState(): CatalogState {
    return this.catalog;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeOperation = null;
    this.panelEntry?.panel.dispose();
    this.panelEntry = null;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private handleMessage(entry: PanelEntry, value: unknown): void {
    if (!this.isCurrentPanel(entry)) {
      return;
    }
    const message = parseMissionControlPanelWebviewMessage(value);
    if (message === undefined) {
      this.diagnostics?.record({
        level: 'warn',
        name: 'host.missionControl.rejected',
      });
      return;
    }
    if (message.type === 'missionControl.ready') {
      if (entry.ready) {
        return;
      }
      entry.ready = true;
      this.postTheme();
      const requestId = `catalog-${entry.instance}-initial`;
      entry.seenRequestIds.add(requestId);
      this.startCatalogRequest(entry, requestId, this.catalog.filter);
      return;
    }
    if (
      !entry.ready ||
      entry.seenRequestIds.has(message.requestId)
    ) {
      return;
    }
    entry.seenRequestIds.add(message.requestId);
    if (message.type === 'missionControl.navigate') {
      if (message.route === 'detail') {
        this.navigate('detail', message.catalogId);
      } else {
        this.navigate(message.route);
      }
      return;
    }
    this.navigate('catalog');
    this.startCatalogRequest(entry, message.requestId, message.filter);
  }

  private startCatalogRequest(
    entry: PanelEntry,
    requestId: string,
    filter: MissionControlCatalogFilter,
  ): void {
    const operation: CatalogOperation = {
      owner: {},
      panelInstance: entry.instance,
      routeRevision: this.routeRevision,
      requestId,
      filter,
      revision: this.nextCatalogRevision++,
    };
    this.catalog = { ...this.catalog, filter };
    this.activeOperation = operation;
    void this.loadCatalog(operation);
  }

  private async loadCatalog(operation: CatalogOperation): Promise<void> {
    let result: MissionCatalogResult | null;
    try {
      result = await this.withDeadline(this.source.listCatalog());
    } catch {
      result = {
        status: 'error',
        code: 'incomplete-list',
        message: '',
      };
    }
    if (!this.owns(operation)) {
      return;
    }
    this.activeOperation = null;
    if (result === null) {
      this.postCatalogError(operation, 'unavailable');
      return;
    }
    if (result.status === 'error') {
      this.postCatalogError(operation, result.code);
      return;
    }
    this.catalog = {
      filter: operation.filter,
      rows: result.rows,
      revision: operation.revision,
    };
    this.post({
      type: 'missionControl.catalog.result',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      sequence: this.nextSequence++,
      requestId: operation.requestId,
      status: 'ready',
      revision: operation.revision,
      filter: operation.filter,
      rows: result.rows,
    });
  }

  private postCatalogError(
    operation: CatalogOperation,
    code: 'incomplete-list' | 'invalid-data' | 'unavailable',
  ): void {
    this.catalog = {
      ...this.catalog,
      filter: operation.filter,
      revision: operation.revision,
    };
    const message =
      code === 'incomplete-list'
        ? 'The complete Mission catalog could not be loaded.'
        : code === 'invalid-data'
          ? 'Mission catalog data was invalid.'
          : 'Mission catalog is unavailable.';
    this.post({
      type: 'missionControl.catalog.result',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      sequence: this.nextSequence++,
      requestId: operation.requestId,
      status: 'error',
      revision: operation.revision,
      filter: operation.filter,
      error: { code, message, retryable: true },
    });
  }

  private withDeadline(
    request: Promise<MissionCatalogResult>,
  ): Promise<MissionCatalogResult | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      request,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.deadlineMs);
      }),
    ]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
  }

  private owns(operation: CatalogOperation): boolean {
    return (
      !this.disposed &&
      this.route === 'catalog' &&
      this.routeRevision === operation.routeRevision &&
      this.panelEntry?.instance === operation.panelInstance &&
      this.activeOperation?.owner === operation.owner
    );
  }

  private postTheme(): void {
    const theme = readWebviewBootTheme();
    this.post({
      type: 'missionControl.theme',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      ...theme,
    });
  }

  private post(message: MissionControlPanelHostMessage): void {
    const entry = this.panelEntry;
    if (entry === null || !entry.ready) {
      return;
    }
    void entry.panel.webview.postMessage(message).then(
      () => undefined,
      () => undefined,
    );
  }

  private isCurrentPanel(entry: PanelEntry): boolean {
    return !this.disposed && this.panelEntry === entry;
  }

  private disposePanel(entry: PanelEntry): void {
    if (this.panelEntry !== entry) {
      return;
    }
    this.panelEntry = null;
    this.activeOperation = null;
    this.routeRevision += 1;
    this.route = 'catalog';
    this.detailCatalogId = null;
    this.catalog = { filter: 'all', rows: [], revision: 0 };
    this.nextSequence = 1;
    this.nextCatalogRevision = 1;
    for (const disposable of entry.disposables) {
      disposable.dispose();
    }
  }
}
