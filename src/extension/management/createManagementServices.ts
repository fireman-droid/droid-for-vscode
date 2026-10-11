import * as vscode from 'vscode';
import type { DaemonApi } from '../../runtime/daemon/api';
import type { SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { ManagementSessionCatalog } from '../../runtime/catalog/ManagementSessionCatalog';
import { belongsToWorkspace } from '../../runtime/daemon/DaemonSessionCatalog';
import type { ChatController } from '../chat/ChatController';
import type { MissionGateway } from '../chat/mission/MissionGateway';
import type { MissionControlPanelController } from '../panels/mission/MissionControlPanelController';
import type { SessionViewerPanelController } from '../panels/sessionViewer/SessionViewerPanelController';
import { exportActiveSessionAsMarkdown } from '../panels/sessionViewer/sessionExporter';
import { ManagementSettingsService } from './managementSettings';
import { ManagementDefaultsService } from './ManagementDefaultsService';
import type { ManagementServices } from './ManagementBinding';

export function createManagementServices(options: {
  context: vscode.ExtensionContext; controller: ChatController; getDroid: () => Promise<DaemonApi>;
  daemon: boolean; history: SessionHistoryLoader; viewer: SessionViewerPanelController;
  mission: MissionControlPanelController; gateway: MissionGateway; diagnostics: RuntimeDiagnosticSink;
}): ManagementServices {
  const { context, controller, getDroid, history, viewer, mission, gateway, diagnostics } = options;
  const cwd = () => controller.getWorkspaceContext().cwd;
  return {
    defaults: new ManagementDefaultsService(getDroid, options.daemon, controller.modelAvailability),
    settings: new ManagementSettingsService(context.secrets, String(context.extension.packageJSON.version), () => ({
      cwd: cwd(), connection: controller.sessionState.connection.status, ide: controller.readIdeState().status,
      sessionManagementAvailable: options.daemon,
    })),
    sessions: new ManagementSessionCatalog(getDroid, cwd, () => controller.sessionState.sessionId),
    sessionsAvailable: options.daemon,
    viewSession: row => viewer.open({ kind: 'daemon-session', mode: 'standard', sessionId: row.id, cwd: row.cwd, title: row.title }),
    exportSession: row => exportActiveSessionAsMarkdown({
      getActiveSessionId: () => row.id, getWorkspaceCwd: () => row.cwd,
      loadHistory: request => history.loadHistory(request), listSessions: directory => controller.sessionCatalog.listSessions(directory), diagnostics,
    }),
    resumeSession: async row => {
      const current = cwd();
      if (row.kind !== 'chat' || row.archived) throw new Error('此记录只能查看；已归档会话需先恢复。');
      if (!current || !belongsToWorkspace(current, row.cwd, undefined)) throw new Error('请先打开这条会话所属的文件夹。');
      if (!await controller.sessionCatalog.canResumeSession?.(current, row.id)) throw new Error('会话已改变或不属于当前文件夹，请刷新。');
      if (!controller.effects.canReplaceSession()) throw new Error('当前聊天正在处理操作，暂时不能切换。');
      controller.effects.startReplacement({ kind: 'resume', cwd: current, sessionId: row.id });
      await vscode.commands.executeCommand('droidvisx.focusView');
    },
    refreshSessions: () => controller.handleMessage({ type: 'sessions.refresh' }),
    missions: () => gateway.listCatalog(),
    openMission: id => { if (!mission.openCatalogEntry(id)) throw new Error('任务暂时不能打开。请确认任务属于当前工作区，并等待当前会话操作完成。'); },
    newMission: () => mission.openNewMission(),
  };
}
