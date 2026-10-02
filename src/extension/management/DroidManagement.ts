import * as vscode from 'vscode';
import type { DaemonApi } from '../../runtime/daemon/api';
import { MANAGEMENT_SECTIONS, type ManagementSection } from '../../shared/protocol/managementProtocol';
import type { ChatController } from '../chat/ChatController';
import { readModelApplyState } from '../models/modelChatApply';
import { ModelAvailabilityError, type ModelAvailability } from '../models/DisabledModelsStore';
import { manageMarketplaces, managePlugins } from './plugins';
import { manageMcp, signInMcp } from './mcp';
import { manageDefaults } from './defaults';
import { manageSkills } from './skills';
import { manageWorktrees } from './worktrees';
import { forceArchiveSession } from './forceArchive';
import { saveHistoryNote } from './historyNote';
import { DaemonTerminalManager } from '../terminal/DaemonTerminalManager';
import { manageTerminals, requestDroidUpdate } from './runtimeMaintenance';
import { choose, ManagementError, type ManagementContext } from './managementUi';

/** Native management keeps credentials and executable-source confirmations out of Webviews. */
export class DroidManagement implements vscode.Disposable {
  private operation: AbortController | null = null;
  private disposed = false;
  private readonly terminals: DaemonTerminalManager;
  constructor(
    private readonly controller: ChatController,
    private readonly getDaemon: () => Promise<DaemonApi>,
    private readonly daemonMode: boolean,
    private readonly modelAvailability?: ModelAvailability,
  ) { this.terminals = new DaemonTerminalManager(controller); }

  async open(section?: ManagementSection, serverName?: string): Promise<void> {
    if (this.disposed) return;
    if (this.operation) {
      await vscode.window.showInformationMessage('Finish or cancel the current Droid management operation first.');
      return;
    }
    const abort = new AbortController();
    this.operation = abort;
    const state = this.controller.sessionState;
    const sessionId = state.sessionId;
    const generation = state.runtimeGeneration;
    const cwd = state.activeRuntimeCwd;
    let refreshSessions = false;
    const assertCurrent = (write = false) => {
      abort.signal.throwIfAborted();
      if (this.disposed || this.controller.sessionState.sessionId !== sessionId ||
        this.controller.sessionState.runtimeGeneration !== generation ||
        this.controller.sessionState.activeRuntimeCwd !== cwd ||
        this.controller.sessionState.connection.status !== 'connected' ||
        !this.controller.ensureWorkspaceCurrent())
        throw new ManagementError('The active chat or workspace changed. Reopen Droid management.');
      if (write && (!vscode.workspace.isTrusted || !readModelApplyState(this.controller).canApply))
        throw new ManagementError('Use a trusted workspace and finish the current task, queue or interaction before changing Droid configuration.');
    };
    const subscription = this.controller.subscribe(() => {
      if (this.controller.sessionState.sessionId !== sessionId ||
        this.controller.sessionState.runtimeGeneration !== generation ||
        this.controller.sessionState.activeRuntimeCwd !== cwd) abort.abort();
    });
    try {
      if (sessionId === null || cwd === null) throw new ManagementError('Connect a chat session before opening Droid management.');
      assertCurrent();
      const target = section ?? (await choose('Manage Droid capabilities', [
        { label: 'Skills', description: 'Inspect definitions, resources and disablement sources; choose user or project scope', section: 'skills' as const },
        { label: 'Plugins', description: 'Install, update, enable, disable and uninstall', section: 'plugins' as const },
        { label: 'Plugin marketplaces', description: 'Add, refresh and remove sources', section: 'marketplaces' as const },
        { label: 'MCP tools and sign-in', description: 'Tool controls, browser sign-in and saved credentials', section: 'mcp' as const },
        { label: 'Droid defaults', description: 'Models, subagents, compaction, worktrees and opt-in cloud sync', section: 'defaults' as const },
        { label: 'Droid session terminals', description: 'Create, open for direct input, or close daemon-owned shells', section: 'terminals' as const },
        { label: 'Managed worktrees', description: 'Inspect paths, changes and session occupancy before cleanup', section: 'worktrees' as const },
        { label: 'Force archive another session…', description: 'Hide a session without stopping its agent', section: 'archive' as const },
        { label: 'Save a history-only note…', description: 'Process mode only; does not send to the model', section: 'history-note' as const },
        { label: 'Update Droid', description: 'Request a shared daemon update, with confirmation', section: 'updates' as const },
      ]))?.section;
      if (!target) return;
      if (target === 'history-note') { await saveHistoryNote(this.controller, assertCurrent); return; }
      refreshSessions = target === 'archive' || target === 'worktrees';
      if ((target === 'skills' || target === 'mcp' || target === 'terminals') && !this.daemonMode)
        throw new ManagementError('These management operations require daemon runtime mode. Existing Process Skills and MCP controls remain available in the chat menu.');
      const context: ManagementContext = {
        droid: await this.getDaemon(), sessionId, cwd, signal: abort.signal, assertCurrent,
        ...(this.modelAvailability === undefined ? {} : { modelAvailability: this.modelAvailability }),
      };
      assertCurrent();
      if (target === 'plugins') await managePlugins(context);
      else if (target === 'skills') await manageSkills(context);
      else if (target === 'marketplaces') await manageMarketplaces(context);
      else if (target === 'defaults') await manageDefaults(context);
      else if (target === 'terminals') await manageTerminals(context, this.terminals);
      else if (target === 'worktrees') await manageWorktrees(context);
      else if (target === 'archive') await forceArchiveSession(context);
      else if (target === 'updates') await requestDroidUpdate(context);
      else if (serverName !== undefined) await signInMcp(context, serverName);
      else await manageMcp(context);
    } catch (error) {
      if (!abort.signal.aborted) await vscode.window.showErrorMessage(error instanceof ManagementError || error instanceof ModelAvailabilityError
        ? error.message : 'Droid could not complete the management operation. Check the service connection, source and organization policy. Changes already confirmed by Droid are not rolled back.');
    } finally {
      abort.abort();
      subscription.dispose();
      if (this.operation === abort) this.operation = null;
      if (!this.disposed && sessionId !== null && this.controller.sessionState.sessionId === sessionId &&
        this.controller.sessionState.runtimeGeneration === generation) {
        this.controller.handleMessage({ type: 'plugins.refresh', sessionId });
        this.controller.handleMessage({ type: 'mcp.refresh', sessionId });
        this.controller.handleMessage({ type: 'skills.refresh', sessionId });
        this.controller.handleMessage({ type: 'commands.refresh', sessionId });
        if (refreshSessions) this.controller.handleMessage({ type: 'sessions.refresh' });
      }
    }
  }

  register(): vscode.Disposable {
    return vscode.commands.registerCommand('droidvisx.manageCapabilities', (section?: unknown) =>
      this.open((MANAGEMENT_SECTIONS as readonly unknown[]).includes(section) ? section as ManagementSection : undefined));
  }

  dispose(): void {
    this.disposed = true;
    this.operation?.abort();
    this.terminals.dispose();
  }
}
