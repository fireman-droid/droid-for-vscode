import * as vscode from 'vscode';
import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  parseMissionControlPanelWebviewMessage,
  type MissionControlCatalogFilter,
  type MissionControlPanelHostMessage,
} from '../../../shared/protocol/missionControlPanelProtocol';
import type {
  MissionControlSetupContinueMessage,
  MissionControlSetupDraft,
  MissionControlSetupPhase,
  MissionControlSetupSnapshotMessage,
  MissionControlSetupUpdateMessage,
} from '../../../shared/protocol/missionControlSetupProtocol';
import { parseMissionControlSetupWebviewMessage } from '../../../shared/protocol/missionControlSetupProtocol';
import type {
  MissionSetupCapabilities,
  MissionStartMessage,
} from '../../../shared/protocol/missionProtocol';
import type { RuntimeDiagnosticSink } from '../../../runtime/runtimeDiagnostics';
import type { MissionCatalogResult } from '../../chat/mission/MissionGateway';
import { createCatalogId } from '../../chat/mission/MissionCatalogProjection';
import { MissionWorkspaceState } from '../../chat/mission/MissionWorkspaceState';
import type { ChatController, ControllerHostMessage } from '../../chat/ChatController';
import { getWebviewHtml } from '../../webview/webviewHtml';
import { handleWebviewClipboard } from '../../webview/webviewClipboard';
import {
  readWebviewBootTheme,
  readWebviewThemePreference,
} from '../../webview/webviewTheme';
import { parseWebviewMessage } from '../../../shared/validateMessage';
import type {
  MissionControlCatalogSource,
  MissionControlCatalogOperation as CatalogOperation,
  MissionControlCatalogState as CatalogState,
  MissionControlPanelEntry as PanelEntry,
  MissionControlPanelControllerOptions,
  MissionControlRoute,
  MissionControlSetupAuthority,
  MissionWorkspaceHostMessage,
} from './missionControlTypes';
export type {
  MissionControlCatalogSource,
  MissionControlPanelControllerOptions,
  MissionControlRoute,
  MissionControlSetupAuthority,
} from './missionControlTypes';
const VIEW_TYPE = 'droidvisx.missionControl';
const PANEL_TITLE = 'Mission Control';
export const MISSION_CONTROL_CATALOG_DEADLINE_MS = 20_000;

export class MissionControlPanelController implements vscode.Disposable {
  private readonly setupEmitter = new vscode.EventEmitter<MissionWorkspaceHostMessage>();
  readonly onDidChangeWorkspaceSetup = this.setupEmitter.event;
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
  private setupRevision = 0;
  private setupDraft: MissionControlSetupDraft | null = null;
  private setupPhase: MissionControlSetupPhase = 'draft';
  private readiness: MissionControlSetupSnapshotMessage['readiness'] = null;
  private pendingMissionStart: MissionStartMessage | null = null;
  private readonly workspaceState = new MissionWorkspaceState();
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly source: MissionControlCatalogSource,
    options: MissionControlPanelControllerOptions = {},
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {
    this.deadlineMs = options.deadlineMs ?? MISSION_CONTROL_CATALOG_DEADLINE_MS;
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
    const setupSubscription = this.source.subscribeSetup?.(() => {
      if (this.route === 'new-mission') {
        this.hydrateSetupProfiles(this.readSetupAuthority().capabilities);
        this.postSetupSnapshot();
      }
    });
    if (setupSubscription !== undefined) {
      this.subscriptions.push(setupSubscription);
    }
    const chatSubscription = this.source.chatController?.subscribe((message) => {
      this.handleChatControllerMessage(message);
    });
    if (chatSubscription !== undefined) {
      this.subscriptions.push(chatSubscription);
    }
  }

  open(): void {
    this.openRoute('catalog');
    this.postWorkspaceRoute('catalog');
  }

  openNewMission(task?: string): void {
    if (this.disposed) {
      return;
    }
    this.panelEntry?.panel.dispose();
    this.workspaceState.openDraft(this.source.readActiveSession?.(), {
      select: this.source.selectSession,
      create: this.source.createSession,
    });
    this.resetSetupOperation();
    this.prepareSetupDraft(task);
    this.navigate('new-mission');
    this.postWorkspaceRoute('new-mission', undefined, 'overview');
    this.postSetupSnapshot();
    this.source.focusChat?.();
  }

  openMission(task?: string): void {
    const active = this.source.readActiveSession?.();
    if (active?.sessionId !== null && active?.missionRole === 'orchestrator') {
      this.workspaceState.activate(active.sessionId);
      const catalogId = createCatalogId(active.sessionId);
      this.navigate('detail', catalogId);
      this.postWorkspaceRoute('detail', catalogId, 'overview');
      this.source.focusChat?.();
      return;
    }
    this.openNewMission(task);
  }

  private openRoute(route: 'catalog' | 'new-mission', task?: string): void {
    if (this.disposed) {
      return;
    }
    if (route === 'new-mission') {
      if (this.route !== 'new-mission') {
        this.resetSetupOperation();
      }
      this.prepareSetupDraft(task);
    }
    if (this.panelEntry !== null) {
      const routeChanged = this.route !== route;
      this.navigate(route);
      if (route === 'catalog' && routeChanged && this.panelEntry.ready) {
        const requestId = `catalog-${this.panelEntry.instance}-route-${this.nextCatalogRevision}`;
        this.panelEntry.seenRequestIds.add(requestId);
        this.startCatalogRequest(this.panelEntry, requestId, this.catalog.filter);
        this.post({
          type: 'missionControl.route',
          protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
          route: 'catalog',
        });
      } else if (route === 'new-mission' && this.panelEntry.ready) {
        this.post({
          type: 'missionControl.route',
          protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
          route: 'new-mission',
        });
        this.postSetupSnapshot();
      }
      this.panelEntry.panel.reveal(undefined, false);
      return;
    }

    this.route = route;
    this.detailCatalogId = null;
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
    const webviewDistUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    panel.webview.html = getWebviewHtml(
      panel.webview,
      {
        script: vscode.Uri.joinPath(webviewDistUri, 'mission-control.js'),
        style: vscode.Uri.joinPath(webviewDistUri, 'webview.css'),
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
    this.setupEmitter.dispose();
  }

  replayWorkspaceSetup(): void {
    this.replayWorkspaceSetupTo((message) => {
      this.setupEmitter.fire(message);
    });
  }

  replayWorkspaceSetupTo(listener: (message: MissionWorkspaceHostMessage) => void): void {
    const route = this.createWorkspaceRouteMessage();
    if (route !== null) {
      listener(route);
    }
    const setup = this.createSetupSnapshot();
    if (setup !== null) {
      listener(setup);
    }
  }

  handleWorkspaceMessage(value: unknown): boolean {
    const setupMessage = parseMissionControlSetupWebviewMessage(value);
    if (setupMessage !== undefined) {
      this.handleSetupMessage(setupMessage);
      return true;
    }
    const message = parseWebviewMessage(value);
    if (message?.type === 'mission.dismissSetup') {
      this.closeMissionWorkspace();
      return true;
    }
    if (message?.type !== 'mission.start') {
      return false;
    }
    void this.inspectAndStartMission(message);
    return true;
  }

  private handleMessage(entry: PanelEntry, value: unknown): void {
    if (handleWebviewClipboard(value, entry.panel.webview)) return;
    if (!this.isCurrentPanel(entry)) {
      return;
    }
    const message = parseMissionControlPanelWebviewMessage(value);
    if (message === undefined) {
      return;
    }
    if (message.type === 'webview.diagnostic') {
      this.diagnostics?.record({
        level: 'warn',
        name: `missionControl.${message.kind}`,
        detail: message.detail,
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
    if (!entry.ready || entry.seenRequestIds.has(message.requestId)) {
      return;
    }
    entry.seenRequestIds.add(message.requestId);
    if (message.type === 'missionControl.setup.update') {
      this.handleSetupMessage(message);
      return;
    }
    if (message.type === 'missionControl.setup.continue') {
      this.handleSetupMessage(message);
      return;
    }
    if (message.type === 'missionControl.navigate') {
      if (this.setupPhase === 'starting') {
        this.post({ type: 'missionControl.navigationRejected', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
          requestId: message.requestId, reason: 'busy' });
        return;
      }
      if (message.route === 'detail') {
        this.workspaceState.remember(this.source.readActiveSession?.());
        const sessionId = this.source.openCatalogMission?.(message.catalogId) ?? null;
        if (sessionId === null) {
          this.post({ type: 'missionControl.navigationRejected', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
            requestId: message.requestId, reason: 'unavailable' });
          this.diagnostics?.record({
            level: 'warn',
            name: 'host.missionControl.open-rejected',
            attributes: { reason: 'unknown-catalog-id' },
          });
          return;
        }
        entry.panel.dispose();
        this.resetSetupOperation();
        this.workspaceState.activate(sessionId);
        this.navigate('detail', message.catalogId);
        this.postWorkspaceRoute('detail', message.catalogId, 'overview');
        this.source.focusChat?.();
        return;
      }
      if (message.route === 'new-mission') {
        entry.panel.dispose();
        this.openNewMission();
        return;
      }
      this.resetSetupOperation();
      this.navigate('catalog');
      this.startCatalogRequest(entry, message.requestId, this.catalog.filter);
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

  private prepareSetupDraft(task?: string): void {
    const capabilities = this.readSetupAuthority().capabilities;
    if (this.setupDraft === null) {
      this.setupDraft = createSetupDraft(capabilities, task ?? '');
      this.setupRevision += 1;
      this.resetSetupOperation();
      return;
    }
    if (task !== undefined && task !== this.setupDraft.task) {
      this.setupDraft = { ...this.setupDraft, task };
      this.setupRevision += 1;
      this.resetSetupOperation();
    }
    this.hydrateSetupProfiles(capabilities);
  }

  private hydrateSetupProfiles(capabilities: MissionSetupCapabilities | null): void {
    if (
      capabilities === null ||
      this.setupDraft === null ||
      this.setupDraft.orchestrator !== null
    ) {
      return;
    }
    this.setupDraft = {
      ...this.setupDraft,
      orchestrator: capabilities.currentChat,
      worker: capabilities.preferences.worker,
      validator: capabilities.preferences.validator,
    };
    this.setupRevision += 1;
  }

  private postSetupSnapshot(authority = this.readSetupAuthority()): void {
    const message = this.createSetupSnapshot(authority);
    if (message !== null) {
      this.setupEmitter.fire(message);
    }
  }

  private createSetupSnapshot(
    authority = this.readSetupAuthority(),
  ): MissionControlSetupSnapshotMessage | null {
    if (this.route !== 'new-mission' || this.setupDraft === null) {
      return null;
    }
    return {
      type: 'missionControl.setup.snapshot',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      sequence: this.nextSequence++,
      setupRevision: this.setupRevision,
      workspaceAuthorityRevision: authority.workspaceAuthorityRevision,
      chatOwnerRevision: authority.chatOwnerRevision,
      phase: this.setupPhase,
      availability: authority.availability,
      reason: authority.reason,
      readiness: this.readiness,
      draft: this.setupDraft,
      capabilities: authority.capabilities,
    };
  }

  private postWorkspaceRoute(route: MissionControlRoute, catalogId?: string, view?: 'chat' | 'overview'): void {
    this.setupEmitter.fire(this.workspaceRouteMessage(route, catalogId, view));
  }

  private createWorkspaceRouteMessage(): MissionWorkspaceHostMessage | null {
    if (this.route === 'detail' && this.detailCatalogId !== null) {
      return this.workspaceRouteMessage('detail', this.detailCatalogId);
    }
    return this.route === 'new-mission'
      ? this.workspaceRouteMessage('new-mission')
      : null;
  }

  private workspaceRouteMessage(
    route: MissionControlRoute,
    catalogId?: string,
    view?: 'chat' | 'overview',
  ): Extract<MissionWorkspaceHostMessage, { type: 'missionControl.route' }> {
    return route === 'detail'
      ? {
          type: 'missionControl.route',
          protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
          route,
          catalogId: catalogId!,
          ...(view === undefined ? {} : { view }),
        }
      : {
          type: 'missionControl.route',
          protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
          route,
          ...(view === undefined ? {} : { view }),
        };
  }

  private handleSetupMessage(
    message: MissionControlSetupUpdateMessage | MissionControlSetupContinueMessage,
  ): void {
    if (message.type === 'missionControl.setup.continue') {
      if (
        this.route === 'new-mission' &&
        this.setupPhase === 'advisory' &&
        this.pendingMissionStart !== null &&
        message.setupRevision === this.setupRevision
      ) {
        void this.continueMissionStart(this.pendingMissionStart);
      }
      return;
    }
    const authority = this.readSetupAuthority();
    if (
      this.route !== 'new-mission' ||
      (this.setupPhase !== 'draft' && this.setupPhase !== 'indeterminate') ||
      message.setupRevision !== this.setupRevision ||
      message.workspaceAuthorityRevision !== authority.workspaceAuthorityRevision ||
      message.chatOwnerRevision !== authority.chatOwnerRevision
    ) {
      this.postSetupSnapshot(authority);
      return;
    }
    this.setupDraft = message.draft;
    this.setupRevision += 1;
    this.postSetupSnapshot(authority);
  }

  private readSetupAuthority(): MissionControlSetupAuthority {
    return (
      this.source.readSetup?.() ?? {
        workspaceAuthorityRevision: 0,
        chatOwnerRevision: 0,
        availability: 'unavailable',
        reason: 'gateway-unavailable',
        capabilities: null,
      }
    );
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
    this.post({ type: 'ui.theme', ...theme });
  }

  private post(
    message:
      | MissionControlPanelHostMessage
      | ControllerHostMessage
      | {
          readonly type: 'ui.theme';
          readonly preference: 'auto' | 'light' | 'dark';
          readonly resolved: 'light' | 'dark';
        },
  ): void {
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

  private handleChatControllerMessage(message: ControllerHostMessage): void {
    if (message.type === 'host.snapshot') {
      this.handleActiveSessionSnapshot(message);
    }
    if (message.type === 'mission.controlResult' && message.action === 'start') {
      const readinessIndeterminate = this.setupPhase === 'indeterminate';
      this.pendingMissionStart = null;
      this.readiness = null;
      if (message.status === 'accepted') {
        this.setupPhase = 'draft';
        const sessionId = this.source.readActiveSession?.().sessionId;
        if (sessionId !== null && sessionId !== undefined) {
          this.workspaceState.activate(sessionId);
          const catalogId = createCatalogId(sessionId);
          this.navigate('detail', catalogId);
          this.postWorkspaceRoute('detail', catalogId, 'chat');
        }
      } else {
        this.setupPhase = readinessIndeterminate ? 'indeterminate' : 'draft';
        this.postSetupSnapshot();
      }
    }
  }

  private async inspectAndStartMission(message: MissionStartMessage): Promise<void> {
    const authority = this.readSetupAuthority();
    const cwd = this.source.readWorkspaceCwd?.() ?? null;
    if (
      this.route !== 'new-mission' ||
      (this.setupPhase !== 'draft' && this.setupPhase !== 'indeterminate') ||
      authority.availability !== 'ready' ||
      cwd === null ||
      this.source.inspectReadiness === undefined
    ) {
      this.rejectMissionStart(message.requestId);
      return;
    }
    this.pendingMissionStart = message;
    this.setupDraft = { task: message.task, orchestrator: message.orchestrator,
      worker: message.worker, validator: message.validator,
      scrutinyEnabled: message.scrutinyEnabled, userTestingEnabled: message.userTestingEnabled };
    this.setupPhase = 'inspecting';
    this.readiness = null;
    const revision = this.setupRevision;
    this.postSetupSnapshot(authority);
    const result = await this.source.inspectReadiness(cwd);
    if (
      this.pendingMissionStart !== message ||
      this.setupRevision !== revision ||
      this.route !== 'new-mission'
    ) {
      return;
    }
    if (result.status === 'error') {
      this.setupPhase = 'indeterminate';
      this.pendingMissionStart = null;
      this.postSetupSnapshot();
      this.rejectMissionStart(message.requestId);
      return;
    }
    if (result.warning !== null) {
      this.setupPhase = 'advisory';
      this.readiness = {
        warning: result.warning.state,
        level: result.warning.level,
      };
      this.postSetupSnapshot();
      return;
    }
    this.forwardMissionStart(message);
  }

  private async continueMissionStart(message: MissionStartMessage): Promise<void> {
    const cwd = this.source.readWorkspaceCwd?.() ?? null;
    if (cwd === null || this.source.acknowledgeReadinessWarning === undefined) {
      this.rejectMissionStart(message.requestId);
      return;
    }
    this.setupPhase = 'starting';
    this.postSetupSnapshot();
    if (!(await this.source.acknowledgeReadinessWarning(cwd))) {
      this.setupPhase = 'indeterminate';
      this.pendingMissionStart = null;
      this.postSetupSnapshot();
      this.rejectMissionStart(message.requestId);
      return;
    }
    if (this.pendingMissionStart === message && this.route === 'new-mission') {
      this.forwardMissionStart(message);
    }
  }

  private forwardMissionStart(message: MissionStartMessage): void {
    this.setupPhase = 'starting';
    this.postSetupSnapshot();
    this.source.chatController?.handleMessage(message);
  }

  private rejectMissionStart(requestId: string): void {
    this.source.chatController?.emit({
      type: 'mission.controlResult',
      protocolVersion: 25,
      scope: 'selected-chat',
      requestId,
      action: 'start',
      status: 'rejected',
      rejectionCode: 'unavailable',
    });
  }

  private closeMissionWorkspace(): void {
    this.resetSetupOperation();
    this.navigate('catalog');
    this.postWorkspaceRoute('catalog');
    this.workspaceState.close(this.source.readActiveSession?.(), {
      select: this.source.selectSession,
      create: this.source.createSession,
    });
    this.source.focusChat?.();
  }

  private handleActiveSessionSnapshot(
    message: Extract<ControllerHostMessage, { type: 'host.snapshot' }>,
  ): void {
    const observation = this.workspaceState.observe(message);
    if (observation.kind === 'mission') {
      if (this.route === 'catalog' && this.panelEntry === null) {
        const catalogId = createCatalogId(observation.sessionId);
        this.navigate('detail', catalogId);
        this.postWorkspaceRoute('detail', catalogId);
      }
      return;
    }
    if (observation.kind === 'normal' && this.route === 'detail') {
      this.navigate('catalog');
      this.postWorkspaceRoute('catalog');
    }
  }

  private resetSetupOperation(): void {
    this.pendingMissionStart = null;
    this.setupPhase = 'draft';
    this.readiness = null;
  }
}

function createSetupDraft(
  capabilities: MissionSetupCapabilities | null,
  task: string,
): MissionControlSetupDraft {
  if (capabilities === null) {
    return {
      task,
      orchestrator: null,
      worker: null,
      validator: null,
      scrutinyEnabled: true,
      userTestingEnabled: true,
    };
  }
  return {
    task,
    orchestrator: capabilities.currentChat,
    worker: capabilities.preferences.worker,
    validator: capabilities.preferences.validator,
    scrutinyEnabled: capabilities.preferences.scrutinyEnabled,
    userTestingEnabled: capabilities.preferences.userTestingEnabled,
  };
}
