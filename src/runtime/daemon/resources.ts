import type { DaemonSessionController } from '@factory/droid-sdk';
import type { DaemonApi } from './api';

export function createDaemonResources(
  controller: DaemonSessionController,
  assertConnected: () => void,
  waitUntilReady: () => Promise<void> = async () => {},
) {
  const call = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertConnected();
    await waitUntilReady();
    assertConnected();
    return operation();
  };
  const listPage: DaemonApi['sessions']['listPage'] = (options) =>
    call(() => controller.listAvailableSessions({
      ...options,
      limit: options?.limit ?? 20,
    }));
  const sessions: Omit<DaemonApi['sessions'], 'create' | 'resume'> = {
    listPage,
    list: async (options) => {
      const result = await listPage(options);
      return result.sessions.map(
        ({
          sessionId,
          updatedAt,
          messagesCount,
          callingSessionId,
          callingToolUseId,
          archivedAt,
          ...rest
        }) => ({
          ...rest,
          id: sessionId,
          modifiedTime: new Date(updatedAt * 1000),
          messageCount: messagesCount ?? 0,
          parentSessionId: callingSessionId,
          parentToolUseId: callingToolUseId,
          archivedTime: archivedAt === undefined ? undefined : new Date(archivedAt),
          getMessages: (messageOptions) => sessions.getMessages(sessionId, messageOptions),
        }),
      );
    },
    listOpened: (options) =>
      call(async () =>
        (await controller.listOpenedSessions(options)).map(
          ({
            sessionId,
            updatedAt,
            messagesCount,
            callingSessionId,
            callingToolUseId,
            ...rest
          }) => ({
            ...rest,
            id: sessionId,
            modifiedTime: new Date(updatedAt * 1000),
            messageCount: messagesCount ?? 0,
            parentSessionId: callingSessionId,
            parentToolUseId: callingToolUseId,
          }),
        ),
      ),
    getMessages: (sessionId, options) =>
      call(
        async () =>
          (
            await controller.getSessionMessages({
              sessionId,
              ...options,
              limit: options?.limit ?? 20,
            })
          ).messages,
      ),
    search: (params) =>
      call(async () => {
        const result = await controller.searchSessions(params);
        return {
          ...result,
          sessions: result.sessions.map(({ sessionId, updatedAt, ...rest }) => ({
            ...rest,
            id: sessionId,
            modifiedTime: updatedAt === undefined ? undefined : new Date(updatedAt),
          })),
        };
      }),
    archive: (id, options) => call(() => controller.archiveSession(id, options)),
    unarchive: (id) => call(() => controller.unarchiveSession(id)),
    updateSettings: (id, settings) =>
      call(() => controller.updateSessionSettings(id, settings)),
    getContextBreakdown: (id) => call(() => controller.getContextBreakdown(id)),
    getRewindInfo: (id, messageId) => call(() => controller.getRewindInfo(id, messageId)),
    fork: (id, options) => call(() => controller.forkSession(id, options)),
    killWorker: (id, workerId) => call(() => controller.killWorkerSession(id, workerId)),
  };
  const resources: Omit<DaemonApi, 'sessions' | 'notifications' | 'disconnect'> = {
    models: { list: (options) => call(() => controller.listModels(options)) },
    worktrees: {
      list: (params) => call(() => controller.listManagedWorktrees(params)),
      inspectDeletion: (params) => call(() => controller.inspectWorktreeDeletion(params)),
      cleanup: (params) => call(() => controller.cleanupWorktree(params)),
    },
    settings: {
      getDefaults: () => call(() => controller.getDefaultSettings()),
      updateDefaults: (params) => call(() => controller.updateSessionDefaults(params)),
    },
    terminals: {
      create: (id, params) => call(() => controller.createTerminal(id, params)),
      write: (id, params) => call(() => controller.writeTerminalData(id, params)),
      resize: (id, params) => call(() => controller.resizeTerminal(id, params)),
      list: (id, params) => call(async () => (await controller.listTerminals(id, params)).terminals),
      close: (id, params) => call(() => controller.closeTerminal(id, params)),
    },
    updates: { trigger: () => call(() => controller.triggerUpdate()) },
    automations: {
      list: (base) => call(async () => (await controller.listAutomations(base)).automations),
      run: (id, base, computer) => call(() => controller.runAutomation(id, base, computer)),
      pause: (id, base) => call(() => controller.pauseAutomation(id, base)),
      resume: (id, base) => call(() => controller.resumeAutomation(id, base)),
      getHistory: (id, limit, offset, base) => call(() => controller.getAutomationHistory(id, limit, offset, base)),
      getVisual: (id, base, session) => call(() => controller.getAutomationVisual(id, base, session)),
      create: (params) => call(() => controller.createAutomation(params)),
      update: (params) => call(() => controller.updateAutomation(params)),
      updateModel: (params) => call(() => controller.updateAutomationModel(params)),
      updatePrivacy: (params) => call(() => controller.updateAutomationPrivacy(params)),
      updatePrompt: (params) => call(() => controller.updateAutomationPrompt(params)),
      updateSchedule: (params) => call(() => controller.updateAutomationSchedule(params)),
      rename: (params) => call(() => controller.renameAutomation(params)),
      delete: (params) => call(() => controller.deleteAutomation(params)),
      fork: (params) => call(() => controller.forkAutomation(params)),
      applyConfig: (params) => call(() => controller.applyAutomationConfig(params)),
    },
    workspace: {
      changeDirectory: (params) => call(() => controller.changeWorkingDirectory(params)),
      validateDirectory: (cwd) => call(() => controller.validateWorkingDirectory(cwd)),
      checkTrust: (cwd) => call(() => controller.checkFolderTrust(cwd)),
      trust: (cwd) => call(() => controller.trustFolder(cwd)),
      listFiles: (id, hidden) => call(() => controller.listFiles(id, hidden)),
      searchFiles: (id, query, max, hidden) => call(() => controller.searchFiles(id, query, max, hidden)),
      getFileContent: (params) => call(() => controller.getWorkspaceFileContent(params)),
    },
    ssh: { installKey: (key) => call(() => controller.installSshKey(key)) },
    relay: {
      start: () => call(() => controller.startRelay()),
      stop: () => call(() => controller.stopRelay()),
      status: () => call(() => controller.getRelayStatus()),
    },
    feedback: { submitBugReport: (id, comment, logs, source) => call(() => controller.submitBugReport(id, comment, logs, source)) },
    customModels: {
      list: () => call(async () => (await controller.listCustomModels()).models),
      upsert: (params) => call(() => controller.upsertCustomModel(params)),
      delete: (params) => call(() => controller.deleteCustomModel(params)),
    },
    commands: {
      list: (id) => call(async () => (await controller.listCommands(id)).commands),
    },
    skills: {
      list: (id) => call(() => controller.listSkills(id)),
      setDisabled: (params) => call(() => controller.setSkillDisabled(params)),
    },
    mcp: {
      getConfig: () => call(() => controller.getMcpConfig()),
      updateConfig: (params) => call(() => controller.updateMcpConfig(params)),
      listServers: (id) => call(() => controller.listMcpServers(id)),
      listTools: (id) => call(async () => (await controller.listMcpTools(id)).tools),
      toggleServer: (params) => call(() => controller.toggleMcpServer(params)),
      addServer: (params) => call(() => controller.addMcpServer(params)),
      removeServer: (params) => call(() => controller.removeMcpServer(params)),
      authenticateServer: (params) =>
        call(() => controller.authenticateMcpServer(params)),
      cancelAuth: (params) => call(() => controller.cancelMcpAuth(params)),
      clearAuth: (params) => call(() => controller.clearMcpAuth(params)),
      submitAuthCode: (params) => call(() => controller.submitMcpAuthCode(params)),
      submitAuthError: (params) => call(() => controller.submitMcpAuthError(params)),
      listRegistry: (id) => call(async () => (await controller.listMcpRegistry(id)).servers),
      toggleTool: (id, server, tool, enabled) =>
        call(() => controller.toggleMcpTool(id, server, tool, enabled)),
    },
    plugins: {
      listAvailable: (id) => call(async () => (await controller.listAvailablePlugins(id)).plugins),
      listInstalled: (id, scope) =>
        call(async () => (await controller.listInstalledPlugins(id, scope)).plugins),
      install: (id, marketplace, name, scope) => call(() => controller.installPlugin(id, marketplace, name, scope)),
      uninstall: (id, plugin, scope) => call(() => controller.uninstallPlugin(id, plugin, scope)),
      setEnabled: (id, plugin, scope, enabled) => call(() => controller.setPluginEnabled(id, plugin, scope, enabled)),
      update: (id, plugin, scope) => call(() => controller.updatePlugin(id, plugin, scope)),
    },
    marketplaces: {
      list: (id) =>
        call(async () => (await controller.listMarketplaces(id)).marketplaces),
      add: (id, source) => call(() => controller.addMarketplace(id, source)),
      remove: (id, name) => call(() => controller.removeMarketplace(id, name)),
      update: (id, name) => call(() => controller.updateMarketplace(id, name)),
    },
    git: {
      getDiff: (params) => call(() => controller.getGitDiff(params)),
      listBranches: (cwd) => call(() => controller.listGitBranches(cwd)),
      checkoutBranch: (params) => call(() => controller.checkoutGitBranch(params)),
      push: (id) => call(() => controller.gitPush(id)),
      commit: (id, message) => call(() => controller.gitCommit(id, message)),
      createPullRequest: (params) => call(() => controller.createPR(params)),
      resolvePullRequestStatuses: (params) => call(() => controller.resolvePullRequestStatuses(params)),
    },
    unstable: {
      missions: {
        inspectReadiness: (cwd) => call(() => controller.inspectMissionReadiness(cwd)),
        acknowledgeReadinessWarning: (cwd) =>
          call(() => controller.acknowledgeMissionReadinessWarning(cwd)),
      },
    },
  };
  return { sessions, ...resources };
}
