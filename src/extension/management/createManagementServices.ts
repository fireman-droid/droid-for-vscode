import * as vscode from 'vscode';
import type { DaemonApi } from '../../runtime/daemon/api';
import type { SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { ManagementSessionCatalog } from '../../runtime/catalog/ManagementSessionCatalog';
import type { ChatController } from '../chat/ChatController';
import type { MissionGateway } from '../chat/mission/MissionGateway';
import type { MissionControlPanelController } from '../panels/mission/MissionControlPanelController';
import type { SessionViewerPanelController } from '../panels/sessionViewer/SessionViewerPanelController';
import { exportActiveSessionAsMarkdown } from '../panels/sessionViewer/sessionExporter';
import { ManagementSettingsService } from './managementSettings';
import { ManagementDefaultsService } from './ManagementDefaultsService';
import type { ManagementServices } from './ManagementBinding';
import type { FactoryAccountService } from '../account/FactoryAccountService';

export function createManagementServices(options: {
  context: vscode.ExtensionContext; controller: ChatController; getDroid: () => Promise<DaemonApi>;
  daemon: boolean; history: SessionHistoryLoader; viewer: SessionViewerPanelController;
  mission: MissionControlPanelController; gateway: MissionGateway; diagnostics: RuntimeDiagnosticSink;
  account: FactoryAccountService;
}): ManagementServices {
  const { context, controller, getDroid, history, viewer, mission, gateway, diagnostics } = options;
  const cwd = () => controller.getEditorWorkspaceContext().cwd;
  return {
    defaults: new ManagementDefaultsService(getDroid, options.daemon, controller.modelAvailability),
    settings: new ManagementSettingsService(context.secrets, String(context.extension.packageJSON.version), () => ({
      cwd: cwd(), connection: controller.sessionState.connection.status, ide: controller.readIdeState().status,
      sessionManagementAvailable: options.daemon,
    }), () => controller.metadata.modelCatalog.items.filter(model => !model.disabled).map(model => ({ id: model.id, label: model.displayName,
      reasoning: model.supportedReasoningEfforts, defaultReasoning: model.defaultReasoningEffort, isCustom: model.isCustom })),
    () => controller.metadata.settings.value?.modelId ?? null),
    sessions: new ManagementSessionCatalog(getDroid, cwd, () => controller.sessionState.sessionId),
    sessionsAvailable: options.daemon,
    viewSession: row => viewer.open({ kind: 'daemon-session', mode: 'standard', sessionId: row.id, cwd: row.cwd, title: row.title }),
    exportSession: row => exportActiveSessionAsMarkdown({
      getActiveSessionId: () => row.id, getWorkspaceCwd: () => row.cwd,
      loadHistory: request => history.loadHistory(request), listSessions: directory => controller.sessionCatalog.listSessions(directory), diagnostics,
    }),
    resumeSession: async row => {
      const editor = controller.getEditorWorkspaceContext();
      const generation = controller.sessionState.runtimeGeneration;
      if (row.kind !== 'chat') throw new Error('Exec 记录不能切换到主聊天，请选择“查看记录”。');
      if (row.archived) throw new Error('此会话已归档，请先在菜单中选择“恢复会话”，再继续对话。');
      if (!editor.trusted) throw new Error('请先信任当前窗口，再继续对话。');
      if (controller.sessionState.sessionId === row.id && controller.sessionState.connection.status === 'connected') {
        await vscode.commands.executeCommand('droidvisx.focusView');
        return;
      }
      if (!await controller.sessionCatalog.canResumeSession?.(row.cwd, row.id)) throw new Error('会话或所属文件夹已改变，请刷新后重试。');
      const currentEditor = controller.getEditorWorkspaceContext();
      if (controller.sessionState.disposed || controller.sessionState.runtimeGeneration !== generation ||
          editor.cwd !== currentEditor.cwd || editor.trusted !== currentEditor.trusted) throw new Error('当前聊天或窗口已改变，请重试。');
      if (!controller.effects.canReplaceSession()) throw new Error('当前聊天正在处理操作，暂时不能切换。');
      controller.effects.startReplacement({ kind: 'resume', cwd: row.cwd, sessionId: row.id });
      await vscode.commands.executeCommand('droidvisx.focusView');
    },
    refreshSessions: () => controller.handleMessage({ type: 'sessions.refresh' }),
    missions: () => gateway.listCatalog(),
    openMission: id => { if (!mission.openCatalogEntry(id)) throw new Error('任务暂时不能打开。请确认任务属于当前工作区，并等待当前会话操作完成。'); },
    newMission: () => mission.openNewMission(),
    account: options.account,
  };
}
