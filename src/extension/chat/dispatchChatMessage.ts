import { type WebviewToHostMessage } from '../../shared/bridgeMessages';
import { handleSystemPrompt } from './capabilities/systemPrompt';
import { emitIdeState, reconnectControllerIde } from './ideIntegration';
import {
  handleAttachmentAddImage,
  handleAttachmentAddPdf,
  handleAttachmentAddRemoteImage,
  handleAttachmentReadImage,
} from './attachments/attachmentImages';
import {
  handleAttachmentAddPath,
  handleAttachmentAddTextFile,
  handleAttachmentAddUris,
  handleAttachmentCapture,
  handleAttachmentPick,
  handleAttachmentRemove,
} from './attachments/attachments';
import {
  handleCommandsRefresh,
  handleContextRefresh,
  handlePluginsRefresh,
  handleSkillsRefresh,
  handleSkillToggle,
} from './capabilities/capabilityPanels';
import {
  handleMcpRefresh,
  handleMcpServerAdd,
  handleMcpServerAuthenticate,
  handleMcpServerRemove,
  handleMcpServerToggle,
} from './capabilities/mcp';
import { handleSettingUpdate } from './capabilities/settings';
import { handleModelCatalogRefresh } from './capabilities/sessionMetadata';
import { handleReviewMessage } from './changes/reviewActions';
import { handleFileReadDiff, handleFileOpenTurnDiff } from './changes/inlineDiffActions';
import type { ChatController } from './ChatController';
import { handleMissionCommand, handleMissionStart } from './mission/controller';
import { dispatchCustomModels } from './models/customModels';
import {
  handleQueueAdd,
  handleQueueClear,
  handleQueuePromote,
  handleQueueRemove,
  handleQueueResume,
  handleQueueUpdate,
} from './queue/queue';
import { ensureActiveRuntimeWorkspaceCurrent } from './sessions/workspaceLifecycle';
import { handleReady } from './sessions/runtimeLifecycle';
import {
  handleArchivedRefresh,
  handleRefresh,
  handleSessionArchive,
  handleSessionFavorite,
  handleSessionFork,
  handleSessionNew,
  handleSessionRename,
  handleSessionSearch,
  handleSessionSelect,
  handleSessionUnarchive,
  handleWorktreeCreateSession,
} from './sessions/sessionDirectory';
import { handleSubagentOpen, handleSubagentPanel } from './subagents/subagentPanel';
import {
  handleEditResend,
  handleEditStageBegin,
  handleEditStageCancel,
  handleRewindInfo,
} from './turns/editResend';
import {
  handlePermissionResponse,
  handlePlanDocumentOpen,
} from './turns/interactionResponses';
import { handleRetry } from './turns/turnRetry';
import { handleSend } from './turns/turnFlow';
import { handleStop } from './turns/turnSettlement';
import { handleSessionCompact } from './turns/compact';
import {
  handleFileOpenDiff,
  handleFilePreview,
  handleGitCommit,
  handleGitRequestBranchDiff,
  handleGitRequestStatus,
  handleInlineHtmlPreview,
  handleTerminalOpenMirror,
  handleWorkspaceOpenPath,
  handleWorkspaceReadImage,
  handleWorkspaceSearchFiles,
} from './workspace/workspaceActions';
export function dispatchChatMessage(
  controller: ChatController,
  message: Exclude<WebviewToHostMessage, { type: 'btw.prepare' | 'btw.ask' }>,
): void {
  switch (message.type) {
    case 'systemPrompt.read':
    case 'systemPrompt.save':
      void handleSystemPrompt(controller, message);
      return;
    case 'ide.refresh':
      if (message.sessionId === controller.sessionState.sessionId) emitIdeState(controller);
      return;
    case 'ide.reconnect':
      void reconnectControllerIde(controller, message.sessionId);
      return;
    case 'capabilities.manage':
      return; // Routed to native management by the Webview owner.
    case 'webview.ready':
      void handleReady(controller);
      return;
    case 'turn.send':
      handleSend(controller, message.sessionId, message.turnId, message.text);
      return;
    case 'mission.start':
      handleMissionStart(controller, message);
      return;
    case 'mission.dismissSetup':
    case 'mission.pause':
    case 'mission.resume':
    case 'mission.stopCurrentFeature':
    case 'mission.refresh':
    case 'mission.disclosure.set':
    case 'mission.viewer.open':
      handleMissionCommand(controller, message);
      return;
    case 'turn.stop':
      handleStop(controller, message.sessionId, message.turnId);
      return;
    case 'turn.editResend':
      handleEditResend(
        controller,
        message.sessionId,
        message.turnId,
        message.messageId,
        message.text,
        message.restoreFiles === true,
      );
      return;
    case 'queue.add':
      handleQueueAdd(controller, message.sessionId, message.queueId, message.text);
      return;
    case 'queue.update':
      handleQueueUpdate(controller, message.sessionId, message.queueId, message.text);
      return;
    case 'queue.remove':
      handleQueueRemove(controller, message.sessionId, message.queueId);
      return;
    case 'queue.promote':
      handleQueuePromote(controller, message.sessionId, message.queueId);
      return;
    case 'queue.resume':
      handleQueueResume(controller, message.sessionId);
      return;
    case 'queue.clear':
      handleQueueClear(controller, message.sessionId);
      return;
    case 'rewind.info':
      handleRewindInfo(controller, message.sessionId, message.messageId);
      return;
    case 'runtime.retry':
      handleRetry(controller, message.sessionId);
      return;
    case 'permission.respond':
      handlePermissionResponse(controller, message);
      return;
    case 'ask-user.respond':
      if (!ensureActiveRuntimeWorkspaceCurrent(controller)) {
        return;
      }
      controller.interactions.respondAskUser(message);
      return;
    case 'plan.document.open':
      handlePlanDocumentOpen(controller, message);
      return;
    case 'sessions.refresh':
      handleRefresh(controller);
      return;
    case 'session.select':
      handleSessionSelect(controller, message.sessionId);
      return;
    case 'session.new':
      handleSessionNew(controller);
      return;
    case 'worktree.createSession':
      handleWorktreeCreateSession(controller);
      return;
    case 'session.rename':
      handleSessionRename(controller, message.sessionId, message.title);
      return;
    case 'session.favorite':
      handleSessionFavorite(controller, message.sessionId, message.favorite);
      return;
    case 'session.archive':
      handleSessionArchive(controller, message.sessionId);
      return;
    case 'session.unarchive':
      handleSessionUnarchive(controller, message.sessionId);
      return;
    case 'sessions.archivedRefresh':
      handleArchivedRefresh(controller);
      return;
    case 'session.search':
      handleSessionSearch(controller, message.query);
      return;
    case 'session.context.refresh':
      handleContextRefresh(controller, message.sessionId);
      return;
    case 'session.model-catalog.refresh':
      handleModelCatalogRefresh(controller, message.sessionId);
      return;
    case 'session.compact':
      handleSessionCompact(controller, message.sessionId);
      return;
    case 'session.fork':
      handleSessionFork(controller, message.sessionId);
      return;
    case 'btw.dismiss':
      controller.btwSideChat?.handleDismiss(message.sessionId);
      return;
    case 'btw.stop':
      controller.btwSideChat?.handleStop(message.sessionId);
      return;
    case 'subagent.panel':
      handleSubagentPanel(controller, message.sessionId, message.open);
      return;
    case 'subagent.open':
      handleSubagentOpen(
        controller,
        message.sessionId,
        message.turnId,
        message.toolUseId,
      );
      return;
    case 'file.openDiff':
      handleFileOpenDiff(controller, message.sessionId, message.turnId, message.path);
      return;
    case 'file.readDiff':
      handleFileReadDiff(controller, message);
      return;
    case 'file.openTurnDiff':
      handleFileOpenTurnDiff(controller, message);
      return;
    case 'review.open':
    case 'review.navigate':
    case 'review.selectFile':
    case 'review.markReviewed':
    case 'review.refresh':
    case 'review.restorePreview':
    case 'review.restoreFile':
    case 'review.restoreTurn':
    case 'review.runAgentReview':
      handleReviewMessage(controller, message);
      return;
    case 'file.preview':
      handleFilePreview(controller, message.sessionId, message.path);
      return;
    case 'preview.inlineHtml':
      handleInlineHtmlPreview(controller, message);
      return;
    case 'workspace.openPath':
      handleWorkspaceOpenPath(
        controller,
        message.sessionId,
        message.path,
        message.line,
        message.column,
      );
      return;
    case 'skills.refresh':
      handleSkillsRefresh(controller, message.sessionId);
      return;
    case 'plugins.refresh':
      handlePluginsRefresh(controller, message.sessionId);
      return;
    case 'commands.refresh':
      handleCommandsRefresh(controller, message.sessionId);
      return;
    case 'skill.toggle':
      handleSkillToggle(controller, message.sessionId, message.name, message.disabled);
      return;
    case 'mcp.refresh':
      handleMcpRefresh(controller, message.sessionId);
      return;
    case 'mcp.server.toggle':
      handleMcpServerToggle(controller, message.sessionId, message.name, message.enabled);
      return;
    case 'mcp.server.add': {
      const { type: _type, sessionId, ...params } = message;
      handleMcpServerAdd(controller, sessionId, params);
      return;
    }
    case 'mcp.server.remove':
      handleMcpServerRemove(controller, message.sessionId, message.name);
      return;
    case 'mcp.server.authenticate':
      handleMcpServerAuthenticate(controller, message.sessionId, message.name);
      return;
    case 'customModels.refresh':
    case 'customModels.save':
    case 'customModels.delete':
    case 'customModels.discover':
    case 'customModels.import':
    case 'providerModels.refresh':
    case 'providerModels.saveProvider':
    case 'providerModels.fetch':
    case 'providerModels.saveModel':
    case 'providerModels.import':
    case 'providerModels.test':
    case 'providerModels.testAll':
      dispatchCustomModels(controller, message);
      return;
    case 'attachment.pick':
      handleAttachmentPick(controller, message.sessionId, message.stage);
      return;
    case 'attachment.addEditor':
      handleAttachmentCapture(controller, message.sessionId, 'editor', message.stage);
      return;
    case 'attachment.addSelection':
      handleAttachmentCapture(controller, message.sessionId, 'selection', message.stage);
      return;
    case 'attachment.addProblems':
      handleAttachmentCapture(controller, message.sessionId, 'problems', message.stage);
      return;
    case 'attachment.addGitChanges':
      handleAttachmentCapture(
        controller,
        message.sessionId,
        'git-changes',
        message.stage,
      );
      return;
    case 'attachment.addPath':
      handleAttachmentAddPath(controller, message.sessionId, message.path, message.stage);
      return;
    case 'attachment.addImage':
      handleAttachmentAddImage(
        controller,
        message.sessionId,
        message.name,
        message.mediaType,
        message.dataBase64,
        message.stage,
        message.replaceAttachmentId,
      );
      return;
    case 'attachment.addPdf':
      handleAttachmentAddPdf(
        controller,
        message.sessionId,
        message.name,
        message.dataBase64,
        message.stage,
      );
      return;
    case 'attachment.addRemoteImage':
      handleAttachmentAddRemoteImage(
        controller,
        message.sessionId,
        message.url,
        message.stage,
      );
      return;
    case 'attachment.readImage':
      handleAttachmentReadImage(
        controller,
        message.sessionId,
        message.attachmentId,
        message.stage,
      );
      return;
    case 'attachment.addUris':
      handleAttachmentAddUris(controller, message.sessionId, message.uris, message.stage);
      return;
    case 'attachment.addTextFile':
      handleAttachmentAddTextFile(
        controller,
        message.sessionId,
        message.name,
        message.text,
        message.truncated,
        message.stage,
      );
      return;
    case 'editStage.begin':
      handleEditStageBegin(controller, message.sessionId, message.messageId);
      return;
    case 'editStage.cancel':
      handleEditStageCancel(controller, message.sessionId);
      return;
    case 'workspace.searchFiles':
      handleWorkspaceSearchFiles(
        controller,
        message.sessionId,
        message.requestId,
        message.query,
      );
      return;
    case 'workspace.readImage':
      handleWorkspaceReadImage(controller, message.sessionId, message.path);
      return;
    case 'attachment.remove':
      handleAttachmentRemove(
        controller,
        message.sessionId,
        message.attachmentId,
        message.stage,
      );
      return;
    case 'session.setting.update':
      handleSettingUpdate(controller, message);
      return;
    case 'git.requestStatus':
      handleGitRequestStatus(controller, message.sessionId, message.turnId);
      return;
    case 'git.requestBranchDiff':
      handleGitRequestBranchDiff(controller, message.sessionId);
      return;
    case 'git.commit':
      handleGitCommit(
        controller,
        message.sessionId,
        message.turnId,
        message.paths,
        message.message,
      );
      return;
    case 'terminal.openMirror':
      handleTerminalOpenMirror(controller, message.sessionId);
      return;
  }
}
