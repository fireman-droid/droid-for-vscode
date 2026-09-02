import * as vscode from 'vscode';
import type { ConnectedDroid } from '@factory/droid-sdk';

import { FactoryDroidRuntime } from '../runtime/FactoryDroidRuntime';
import { createBtwSidecar } from '../runtime/btw/BtwSidecar';
import { createDaemonBtwSidecar } from '../runtime/btw/DaemonBtwSidecar';
import { FactorySessionCatalog } from '../runtime/FactorySessionCatalog';
import { FactorySessionHistoryLoader } from '../runtime/history/FactorySessionHistoryLoader';
import { createDaemonFirstHistoryLoader } from '../runtime/history/DaemonSessionHistoryLoader';
import {
  createDaemonSessionFactory,
  type SessionLeaseHooks,
} from '../runtime/daemon/createDaemonDroidSession';
import {
  acquireSessionLease,
  defaultLeaseFile,
  releaseSessionLease,
} from '../runtime/daemon/sessionLease';
import { ChatController } from './ChatController';
import { DroidViewProvider } from './DroidViewProvider';
import { exportDiagnosticsBundle } from './exportDiagnostics';
import { LocalDiagnostics } from './LocalDiagnostics';
import {
  SESSION_RECOVERY_STORAGE_KEY,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import { createPersistentSessionRecoveryStore } from './createPersistentSessionRecoveryStore';
import {
  exportActiveSessionAsMarkdown,
  readPersistedSelectedSessionId,
} from './sessionExporter';
import { RecentCommandsStore } from './RecentCommandsStore';
import { createGitChangeStatsReader } from './changeStats';
import { createTurnSnapshotStore } from './turnSnapshots';
import { createVscodeExternalUrlOpener } from './vscodeExternalUrlOpener';
import { createVscodePathOpener } from './vscodePathOpener';
import { PreviewPanelController } from './PreviewPanelController';
import { PlanDocumentController } from './planDocumentController';
import {
  createWorktreeSessionsFeature,
  type WorktreeSessionsFeature,
} from './worktreeSessions';
import { createTerminalMirror } from './terminalMirror';
import { createHttpCustomModelDiscovery } from './chat/modelDiscovery';
import { ProviderRegistry } from './chat/providerRegistry';
import { MissionGateway } from './chat/mission/MissionGateway';
import { MissionPreferenceStore } from './chat/mission/MissionPreferences';
import { createMissionRuntime } from './chat/mission/MissionRuntime';
import { createMissionControlSetupProjection } from './chat/mission/setupProjection';
import { SessionViewerPanelController } from './SessionViewerPanelController';
import { MissionControlPanelController } from './MissionControlPanelController';
import { SubagentTranscriptService } from './SubagentTranscriptService';
import { BrowserDevBridge, readBrowserDevSourceRoot, registerBrowserDevCommands } from './BrowserDevBridge';
import { createReviewFeature, createReviewFoundation } from './createReviewFeature';
import {
  createDaemonSidecar,
  shutdownSharedDroidVisxDaemon,
  warmDaemonSidecar,
} from './DaemonSidecar';
const focusViewCommand = 'droidvisx.focusView';
const openLogsCommand = 'droidvisx.openLogs';
const exportDiagnosticsCommand = 'droidvisx.exportDiagnostics';
const shutdownDaemonCommand = 'droidvisx.shutdownDaemon';
const exportSessionCommand = 'droidvisx.exportSessionMarkdown';
const addSelectionToChatCommand = 'droidvisx.addSelectionToChat';
const openMissionControlCommand = 'droidvisx.openMissionControl';

/**
 * How long `addSelectionToChat` holds an invoke-time capture while a
 * cold-starting session connects. Real cold starts (daemon spawn plus
 * history restore) measured ~16s; the old 5s retry window silently
 * dropped the selection (QA v0.3 P1-1).
 */
const ADD_SELECTION_CONNECT_WAIT_MS = 60_000;
const ADD_SELECTION_POLL_MS = 250;
let activeController: ChatController | undefined, activeBrowserDevBridge: BrowserDevBridge | undefined, disposeDaemonSidecar: (() => Promise<void>) | undefined;

/**
 * File-backed cross-window session leases (daemon Phase 3). Guards the
 * shared daemon's uncoordinated replacement operations so two windows
 * never attach the same session.
 */
/**
 * Re-evaluates a worktree feature's daemon dependency on every read.
 * Explicit process mode fails closed instead of advertising a daemon
 * capability.
 */
function withDaemonGate(
  feature: WorktreeSessionsFeature,
  daemonSessionsActive: () => boolean,
): WorktreeSessionsFeature {
  return {
    get enabled() {
      return feature.enabled && daemonSessionsActive();
    },
    store: feature.store,
    isGitWorkspace: (cwd) => feature.isGitWorkspace(cwd),
    resolveBranch: (worktreePath) => feature.resolveBranch(worktreePath),
  };
}

function createSessionLeaseHooks(): SessionLeaseHooks {
  const leaseFile = defaultLeaseFile();
  return {
    acquire: (sessionId) => acquireSessionLease(leaseFile, sessionId),
    release: (sessionId) => {
      releaseSessionLease(leaseFile, sessionId);
    },
  };
}

export function activate(context: vscode.ExtensionContext): void {
  // globalStorage survives Cursor's per-boot log directory cleanup and
  // aggregates all windows into one per-day file set.
  const logDirectory = vscode.Uri.joinPath(
    context.globalStorageUri,
    'logs',
  ).fsPath;
  const diagnostics = new LocalDiagnostics({
    directory: logDirectory,
    output: vscode.window.createOutputChannel('DroidVisX Logs'),
    workspace: () =>
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
  });
  diagnostics.record({
    level: 'info',
    name: 'extension.activated',
    attributes: {
      extensionVersion:
        (context.extension.packageJSON as { version?: string })
          .version ?? 'unknown',
      appName: vscode.env.appName,
      vscodeVersion: vscode.version,
    },
  });
  const persistence: SessionRecoveryPersistence = {
    get: <T>(key: string) => context.workspaceState.get<T>(key),
    update: (key: string, value: unknown) =>
      context.workspaceState.update(key, value),
  };
  // Read once at activation: switching modes requires a window reload.
  // Daemon is strict by default. Process transport is used only when
  // the user explicitly selects it in settings.
  const modeConfiguration = vscode.workspace.getConfiguration('droidvisx');
  const runtimeMode = modeConfiguration.get<'process' | 'daemon'>(
    'runtime.mode',
    'daemon',
  );
  const modeInspection = modeConfiguration.inspect('runtime.mode');
  const modeExplicit =
    modeInspection?.globalValue !== undefined ||
    modeInspection?.workspaceValue !== undefined ||
    modeInspection?.workspaceFolderValue !== undefined;
  diagnostics.record({
    level: 'info',
    name: 'runtime.mode',
    attributes: {
      mode: runtimeMode,
      source: modeExplicit ? 'settings' : 'default',
    },
  });
  // Daemon mode needs the shared detached daemon so sessions survive a
  // window reload (Phase 3); the read-only archive/search sidecar in
  // process mode keeps the parent-pid private daemon (Phase 1).
  const daemonSidecar = createDaemonSidecar(diagnostics, runtimeMode);
  const cancelDaemonWarmup =
    runtimeMode === 'daemon'
      ? warmDaemonSidecar(daemonSidecar, diagnostics)
      : undefined;
  disposeDaemonSidecar = async () => {
    cancelDaemonWarmup?.();
    await daemonSidecar.dispose();
  };
  let subagentTranscripts: SubagentTranscriptService | null = null;
  const getDaemonDroid = async (): Promise<ConnectedDroid> => {
    const droid = await daemonSidecar.droid();
    subagentTranscripts?.bindDaemonDroid(droid);
    return droid;
  };
  const sessionLease = createSessionLeaseHooks();
  const daemonSessions =
    runtimeMode !== 'daemon'
      ? null
      : {
          factory: createDaemonSessionFactory(
            getDaemonDroid,
            sessionLease,
            diagnostics,
          ),
        };
  /** True while this window's sessions actually run over the daemon. */
  const daemonSessionsActive = (): boolean =>
    daemonSessions !== null;
  // Shared with the export command, which reads the same recovery
  // store, catalog, and history loader the controller uses.
  const recoveryStore = createPersistentSessionRecoveryStore(persistence, context.globalStorageUri);
  const sessionCatalog = new FactorySessionCatalog();
  const previewController = new PreviewPanelController(diagnostics);
  // Read-only terminal mirror of execute-command output; takeover is
  // fail-closed by design (native-terminal design slice A).
  const terminalMirror = createTerminalMirror({
    createTerminal: (name, pty) =>
      vscode.window.createTerminal({ name, pty }),
  });
  const turnSnapshots = createTurnSnapshotStore(
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    vscode.Uri.joinPath(context.globalStorageUri, 'turn-objects').fsPath,
    persistence,
    {
      recordDiagnostic: (event) => diagnostics.record(event),
    },
  );
  void turnSnapshots.prune();
  const changeStats = createGitChangeStatsReader(
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    {},
    persistence,
    turnSnapshots,
  );
  const historyLoader = createDaemonFirstHistoryLoader({
    getDroid: daemonSidecar.droid,
    isDaemonActive: () => daemonSessionsActive(),
    fallback: new FactorySessionHistoryLoader({ diagnostics }),
    diagnostics,
  });
  const { attachmentSources, fileDiff, gitWorkflow } =
    createReviewFoundation(changeStats, diagnostics);
  const sessionViewer = new SessionViewerPanelController(
    context.extensionUri,
    historyLoader,
    () => ({
      async isRunning(target) {
        if (target.mode === 'subagent-readonly') {
          return subagentTranscripts?.readViewer(target.sessionId)?.running ??
            null;
        }
        const rows = await (await daemonSidecar.droid()).sessions.listOpened();
        const row = rows.find(({ id }) => id === target.sessionId);
        return row === undefined ? false : String(row.workingState) !== 'idle';
      },
      async stop() {
        return 'failed';
      },
      readTranscript(target) {
        return target.mode === 'subagent-readonly'
          ? (subagentTranscripts?.readViewer(target.sessionId) ?? null)
          : null;
      },
      subscribe(target, listener) {
        return target.mode === 'subagent-readonly'
          ? (subagentTranscripts?.subscribeViewer(
              target.sessionId,
              listener,
            ) ?? (() => undefined))
          : () => undefined;
      },
    }),
    diagnostics,
  );
  let controller: ChatController;
  subagentTranscripts = new SubagentTranscriptService(historyLoader, {
    resolveParentRow: (parentSessionId, toolUseId) => {
      if (controller?.sessionId !== parentSessionId) {
        return null;
      }
      const item = controller.transcript.transcript.find(
        (candidate) =>
          candidate.kind === 'tool' &&
          candidate.toolUseId === toolUseId &&
          candidate.subagent !== undefined,
      );
      const cwd = controller.activeRuntimeCwd;
      return item?.kind === 'tool' &&
        item.subagent !== undefined &&
        cwd !== null
        ? {
            parentSessionId,
            turnId: item.turnId,
            toolUseId,
            type: item.subagent.type,
            description: item.subagent.description,
            cwd,
          }
        : null;
    },
    openViewer: ({ childSessionId, title, cwd }) => {
      sessionViewer.open({
        kind: 'daemon-session',
        mode: 'subagent-readonly',
        sessionId: childSessionId,
        title,
        cwd,
      });
    },
  });
  const planDocuments = new PlanDocumentController((state) => {
    controller.emit(state);
  });
  const reviewCoordinator = createReviewFeature({
    context, snapshots: turnSnapshots, fileDiff, persistence, gitWorkflow,
    diagnostics, getController: () => controller, sessionViewer,
    createSdkSession: createDaemonSessionFactory(
      daemonSidecar.droid,
      sessionLease,
      diagnostics,
    ),
  });
  const missionGateway = new MissionGateway({
    getDroid: getDaemonDroid,
    getAttachedSessionId: () => controller?.sessionId ?? undefined,
    preferences: new MissionPreferenceStore(persistence),
    createRuntime: (session, droid, orchestrator) =>
      createMissionRuntime(
        session,
        droid,
        controller.interactions.createRuntimeHandler(),
        orchestrator,
        sessionLease,
      ),
    openWorkerViewer: ({ sessionId, title }) => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (cwd === undefined) return;
      sessionViewer.open({
        kind: 'daemon-session',
        mode: 'mission-readonly',
        sessionId,
        title,
        cwd,
      });
    },
  });
  controller = new ChatController(
    (interactionHandler) =>
      new FactoryDroidRuntime({
        interactionHandler,
        diagnostics,
        observability: diagnostics.observability,
        ...(runtimeMode === 'process'
          ? {
              onSessionNotification: (parentSessionId, notification) => {
                subagentTranscripts?.observeProcessNotification(
                  parentSessionId,
                  notification,
                );
              },
            }
          : {}),
        ...(daemonSessions === null
          ? {}
          : { createSdkSession: daemonSessions.factory }),
      }),
    () => ({
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      trusted: vscode.workspace.isTrusted,
    }),
    sessionCatalog,
    recoveryStore,
    historyLoader,
    attachmentSources,
    fileDiff,
    changeStats,
    createVscodeExternalUrlOpener(),
    new RecentCommandsStore(persistence),
    diagnostics,
    daemonSidecar.provider,
    createVscodePathOpener(),
    previewController,
    gitWorkflow,
    // Worktree sessions ride the daemon's native create channel; in
    // process mode (including a fallback from the daemon default) the
    // gate reads false and worktree entry points fail closed.
    withDaemonGate(
      createWorktreeSessionsFeature({
        enabled: runtimeMode === 'daemon',
        persistence,
      }),
      daemonSessionsActive,
    ),
    terminalMirror,
    daemonSidecar.plugins,
    // `/btw` side chat: hidden fork over the daemon connection in
    // daemon mode (probe: artifacts/probe-btw-daemon.mjs), over a
    // short-lived private CLI client in explicit process mode.
    (cwd, mainSessionId) =>
      daemonSessionsActive()
        ? createDaemonBtwSidecar({
            mainSessionId,
            getDroid: daemonSidecar.droid,
          })
        : createBtwSidecar({ cwd, mainSessionId }),
    missionGateway,
    turnSnapshots,
    planDocuments,
    reviewCoordinator,
  );
  const missionSetupProjection = createMissionControlSetupProjection(controller);
  const missionControl = new MissionControlPanelController(
    context.extensionUri,
    {
      listCatalog: () => missionGateway.listCatalog(),
      readSetup: missionSetupProjection.read,
      subscribeSetup: missionSetupProjection.subscribe,
      chatController: controller,
      inspectReadiness: (cwd) => missionGateway.inspectReadiness(cwd),
      acknowledgeReadinessWarning: (cwd) =>
        missionGateway.acknowledgeReadinessWarning(cwd),
      openCatalogMission: (catalogId) => {
        const sessionId = missionGateway.sessionIdForCatalogId(catalogId);
        if (
          sessionId === null ||
          controller.sessions.status !== 'ready' ||
          !controller.sessions.items.some((item) => item.id === sessionId)
        ) {
          return null;
        }
        controller.handleMessage({ type: 'session.select', sessionId });
        return sessionId;
      },
      readActiveSession: () => {
        const summary = controller.sessions.items.find(
          (item) => item.id === controller.sessionId,
        );
        return {
          sessionId: controller.sessionId,
          missionRole:
            controller.mission?.role ?? summary?.missionRole ?? null,
        };
      },
      selectSession: (sessionId) => {
        if (
          controller.sessions.status !== 'ready' ||
          !controller.sessions.items.some(
            (item) =>
              item.id === sessionId && item.missionRole === undefined,
          )
        ) {
          return false;
        }
        controller.handleMessage({ type: 'session.select', sessionId });
        return true;
      },
      createSession: () => {
        controller.handleMessage({ type: 'session.new' });
      },
      readWorkspaceCwd: () => controller.workspaceContext.cwd,
      focusChat: () => {
        void vscode.commands.executeCommand(
          `${DroidViewProvider.viewType}.focus`,
        );
      },
    },
    {},
    diagnostics,
  );
  const browserDevBridge = new BrowserDevBridge(controller, missionControl, diagnostics);
  activeBrowserDevBridge = browserDevBridge;
  previewController.setFeedbackHandler((text) => {
    controller.emit({ type: 'canvas.feedbackDraft', text });
  });
  // BYOK custom-model management rides the same lazy daemon sidecar
  // as archive/search; the SDK resource satisfies the gateway shape
  // structurally (byok-add-model-design.md §2.3, probed 2026-08-13).
  controller.daemonCustomModels = async () =>
    (await daemonSidecar.droid()).customModels;
  controller.modelDiscovery = createHttpCustomModelDiscovery();
  controller.providerRegistry = new ProviderRegistry(
    context.globalState,
    context.secrets,
  );
  controller.promptProviderApiKey = () =>
    vscode.window.showInputBox({
      title: 'Save provider API key',
      prompt: 'Stored securely by VS Code and used only by this connection.',
      password: true,
      ignoreFocusOut: true,
    });
  controller.subagentTranscripts = subagentTranscripts;
  const provider = new DroidViewProvider(
    context.extensionUri,
    controller,
    diagnostics,
    (target, task) => {
      if (target === 'catalog') {
        missionControl.open();
      } else {
        missionControl.openMission(task);
      }
    },
    {
      subscribe: (listener) =>
        missionControl.onDidChangeWorkspaceSetup(listener),
      replay: () => missionControl.replayWorkspaceSetup(),
      handleMessage: (message) =>
        missionControl.handleWorkspaceMessage(message),
    },
  );
  activeController = controller;

  context.subscriptions.push(
    controller,
    provider,
    previewController,
    terminalMirror,
    sessionViewer,
    subagentTranscripts,
    missionControl,
    browserDevBridge,
    ...registerBrowserDevCommands(browserDevBridge, () => readBrowserDevSourceRoot(context)),
    diagnostics,
    attachmentSources,
    vscode.window.registerWebviewViewProvider(
      DroidViewProvider.viewType,
      provider,
      // Keep the chat iframe alive across tab switches: without
      // retention every switch-back pays a full webview reboot
      // (boot ~1.1s + re-render ~1.2s measured), which is why the
      // sidebar felt heavy next to instant chat surfaces. The chat
      // state (transcript, composer, scroll) cannot be quickly
      // saved and restored, which is the documented case for
      // retainContextWhenHidden's memory cost.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      controller.handleWorkspaceContextChanged();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      controller.handleWorkspaceContextChanged();
    }),
    vscode.commands.registerCommand(focusViewCommand, async () => {
      await vscode.commands.executeCommand(
        `${DroidViewProvider.viewType}.focus`,
      );
    }),
    vscode.commands.registerCommand(openMissionControlCommand, () => {
      missionControl.open();
    }),
    vscode.commands.registerCommand(addSelectionToChatCommand, async () => {
      // The selection is read once, at invoke time, so however long a
      // cold-starting session takes to connect, the captured text is
      // what gets staged — later edits or lost selections don't
      // matter (QA v0.3 P1-1).
      const capture = await attachmentSources.readActiveSelection();
      await vscode.commands.executeCommand(
        `${DroidViewProvider.viewType}.focus`,
      );
      const startedAt = Date.now();
      let waitNotice: vscode.Disposable | null = null;
      try {
        for (;;) {
          if (controller.stageCapturedEditorSelection(capture)) {
            diagnostics.record({
              level: 'info',
              name: 'attachment.add-selection-command.staged',
              attributes: { waitedMs: Date.now() - startedAt },
            });
            return;
          }
          if (
            Date.now() - startedAt >=
            ADD_SELECTION_CONNECT_WAIT_MS
          ) {
            break;
          }
          // Quiet visible feedback while the session connects;
          // disposed the moment the capture is delivered.
          waitNotice ??= vscode.window.setStatusBarMessage(
            'Selection will be added when Droid connects…',
          );
          await new Promise((resolve) =>
            setTimeout(resolve, ADD_SELECTION_POLL_MS),
          );
        }
      } finally {
        waitNotice?.dispose();
      }
      diagnostics.record({
        level: 'warn',
        name: 'attachment.add-selection-command.dropped',
        attributes: { waitedMs: Date.now() - startedAt },
      });
      void vscode.window.showWarningMessage(
        'DroidVisX could not add the selection: the chat session did not connect within 60 seconds.',
      );
    }),
    vscode.commands.registerCommand(openLogsCommand, () => {
      diagnostics.record({
        level: 'info',
        name: 'diagnostics.opened',
      });
      diagnostics.show();
    }),
    vscode.commands.registerCommand(shutdownDaemonCommand, async () => {
      // The shared daemon has no shutdown RPC and survives reloads on
      // purpose, so this terminates the discovered pid directly and
      // clears the discovery file. Live windows re-spawn on next use.
      const stopped = await shutdownSharedDroidVisxDaemon();
      diagnostics.record({
        level: 'info',
        name: 'daemon.shutdown.requested',
        attributes: { stopped },
      });
      void vscode.window.showInformationMessage(
        stopped
          ? 'DroidVisX daemon stopped. Reload the window to start a fresh one.'
          : 'No running DroidVisX daemon was found.',
      );
    }),
    vscode.commands.registerCommand(exportSessionCommand, () =>
      exportActiveSessionAsMarkdown({
        getActiveSessionId: () =>
          recoveryStore.getSelectedSessionId() ??
          readPersistedSelectedSessionId(
            persistence.get(SESSION_RECOVERY_STORAGE_KEY),
          ),
        getWorkspaceCwd: () =>
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
        loadHistory: (request) => historyLoader.loadHistory(request),
        listSessions: (cwd) => sessionCatalog.listSessions(cwd),
        diagnostics,
      }),
    ),
    vscode.commands.registerCommand(
      exportDiagnosticsCommand,
      async () => {
        diagnostics.record({
          level: 'info',
          name: 'diagnostics.exported',
        });
        await diagnostics.flush();
        try {
          await exportDiagnosticsBundle(context, logDirectory);
        } catch (error) {
          diagnostics.record({
            level: 'error',
            name: 'diagnostics.export-failed',
            detail:
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
          });
          void vscode.window.showErrorMessage(
            'DroidVisX diagnostics export failed. See DroidVisX Logs.',
          );
        }
      },
    ),
  );
}

export async function deactivate(): Promise<void> {
  const controller = activeController, browserDevBridge = activeBrowserDevBridge,
    disposeSidecar = disposeDaemonSidecar;
  activeController = undefined; activeBrowserDevBridge = undefined; disposeDaemonSidecar = undefined;
  browserDevBridge?.dispose(); await browserDevBridge?.stop();
  await controller?.dispose();
  await disposeSidecar?.();
}
