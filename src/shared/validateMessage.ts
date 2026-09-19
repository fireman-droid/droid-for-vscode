import { type WebviewToHostMessage } from './bridgeMessages';
import { parseIdeRequest } from './protocol/ideProtocol';
import { parseManagementOpen } from './protocol/managementProtocol';
import { parseFileReadDiffMessage, parseFileOpenTurnDiffMessage } from './protocol/inlineDiffProtocol';
import {
  parseBtwAskMessage,
  parseBtwDismissMessage,
  parseBtwPrepareMessage,
  parseBtwStopMessage,
} from './protocol/btwProtocol';
import { parseCustomModelsWebviewMessage } from './protocol/customModelsProtocol';
import { parseMissionWebviewMessage } from './protocol/missionProtocol';
import { parseAttachmentImageMessage } from './validation/parseAttachmentImageMessage';
import { parsePlanDocumentOpen } from './validation/parsePlanDocumentOpen';
import {
  parseQueueAddMessage,
  parseQueueClearMessage,
  parseQueuePromoteMessage,
  parseQueueRemoveMessage,
  parseQueueResumeMessage,
  parseQueueUpdateMessage,
} from './protocol/queueProtocol';
import { parseReviewWebviewMessage } from './protocol/reviewProtocol';
import { parseReviewPanelRequest } from './protocol/reviewPanelProtocol';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from './validation/strictValidation';
import { parseSubagentWebviewMessage } from './protocol/subagentProtocol';
import {
  parseAttachmentAddEditor,
  parseAttachmentAddGitChanges,
  parseAttachmentAddPath,
  parseAttachmentAddProblems,
  parseAttachmentAddSelection,
  parseAttachmentAddTextFile,
  parseAttachmentAddUris,
  parseAttachmentPick,
  parseAttachmentRemove,
  parseEditStageBegin,
  parseEditStageCancel,
} from './validation/attachments';
import {
  hasValidStage,
  isId,
  isSafeWorkspaceRelativePath,
  readStringDataProperty,
} from './validation/guards';
import { parseAskUserRespond, parsePermissionRespond } from './validation/interactions';
import {
  parseSessionArchive,
  parseSessionFavorite,
  parseSessionNew,
  parseSessionRename,
  parseSessionSearch,
  parseSessionSelect,
  parseSessionUnarchive,
  parseSessionsArchivedRefresh,
  parseSessionsRefresh,
  parseWorktreeCreateSession,
} from './validation/sessions';
import {
  parseCommandsRefresh,
  parseMcpRefresh,
  parseMcpServerAdd,
  parseMcpServerAuthenticate,
  parseMcpServerRemove,
  parseMcpServerToggle,
  parsePluginsRefresh,
  parseSessionContextRefresh,
  parseSessionSettingUpdate,
  parseSkillToggle,
  parseSkillsRefresh,
} from './validation/settings';
import {
  parseUiThemeSet,
  parseWebviewDiagnostic,
  parseWebviewReady,
} from './validation/shell';
import {
  parseRewindInfoRequest,
  parseRuntimeRetry,
  parseSessionCompact,
  parseSessionFork,
  parseTurnEditResend,
  parseTurnSend,
  parseTurnStop,
} from './validation/turns';
import {
  parseFileOpenDiff,
  parseFilePreview,
  parseGitCommitRequest,
  parseGitRequestBranchDiff,
  parseGitRequestStatus,
  parsePreviewInlineHtml,
  parseTerminalOpenMirror,
  parseWorkspaceOpenPath,
  parseWorkspaceReadImage,
  parseWorkspaceSearchFiles,
} from './validation/workspace';

type WebviewMessageType = WebviewToHostMessage['type'];

type WebviewMessageParser = (value: UnknownRecord) => WebviewToHostMessage | undefined;

const parseReviewMessage: WebviewMessageParser = (value) =>
  parseReviewWebviewMessage(value, isId, isSafeWorkspaceRelativePath);

const parseCustomModelsMessage: WebviewMessageParser = (value) =>
  parseCustomModelsWebviewMessage(value) ?? undefined;

const parseAttachmentImage: WebviewMessageParser = (value) =>
  parseAttachmentImageMessage(value, isId, hasValidStage);

const parseSubagentMessage: WebviewMessageParser = (value) =>
  parseSubagentWebviewMessage(value) ?? undefined;

const WEBVIEW_MESSAGE_PARSERS = {
  'ide.reconnect': parseIdeRequest,
  'ide.refresh': parseIdeRequest,
  'capabilities.manage': parseManagementOpen,
  'review.panel.open': (value) => {
    const parsed = parseReviewPanelRequest(value);
    return parsed?.type === 'review.panel.open' ? parsed : undefined;
  },
  'models.open': (value) =>
    hasExactKeys(value, ['type']) ? { type: 'models.open' } : undefined,
  'webview.ready': parseWebviewReady,
  'webview.diagnostic': parseWebviewDiagnostic,
  'turn.send': parseTurnSend,
  'turn.stop': parseTurnStop,
  'turn.editResend': parseTurnEditResend,
  'rewind.info': parseRewindInfoRequest,
  'runtime.retry': parseRuntimeRetry,
  'permission.respond': parsePermissionRespond,
  'ask-user.respond': parseAskUserRespond,
  'plan.document.open': parsePlanDocumentOpen,
  'sessions.refresh': parseSessionsRefresh,
  'session.select': parseSessionSelect,
  'session.new': parseSessionNew,
  'ui.theme.set': parseUiThemeSet,
  'worktree.createSession': parseWorktreeCreateSession,
  'session.rename': parseSessionRename,
  'session.favorite': parseSessionFavorite,
  'session.archive': parseSessionArchive,
  'session.unarchive': parseSessionUnarchive,
  'sessions.archivedRefresh': parseSessionsArchivedRefresh,
  'session.search': parseSessionSearch,
  'session.context.refresh': parseSessionContextRefresh,
  'session.compact': parseSessionCompact,
  'session.fork': parseSessionFork,
  'file.openDiff': parseFileOpenDiff,
  'file.readDiff': parseFileReadDiffMessage,
  'file.openTurnDiff': parseFileOpenTurnDiffMessage,
  'review.open': parseReviewMessage,
  'review.navigate': parseReviewMessage,
  'review.selectFile': parseReviewMessage,
  'review.markReviewed': parseReviewMessage,
  'review.refresh': parseReviewMessage,
  'review.restorePreview': parseReviewMessage,
  'review.restoreFile': parseReviewMessage,
  'review.restoreTurn': parseReviewMessage,
  'review.runAgentReview': parseReviewMessage,
  'file.preview': parseFilePreview,
  'preview.inlineHtml': parsePreviewInlineHtml,
  'git.requestStatus': parseGitRequestStatus,
  'git.requestBranchDiff': parseGitRequestBranchDiff,
  'git.commit': parseGitCommitRequest,
  'terminal.openMirror': parseTerminalOpenMirror,
  'workspace.openPath': parseWorkspaceOpenPath,
  'skills.refresh': parseSkillsRefresh,
  'skill.toggle': parseSkillToggle,
  'plugins.refresh': parsePluginsRefresh,
  'commands.refresh': parseCommandsRefresh,
  'mcp.refresh': parseMcpRefresh,
  'mcp.server.toggle': parseMcpServerToggle,
  'mcp.server.add': parseMcpServerAdd,
  'mcp.server.remove': parseMcpServerRemove,
  'mcp.server.authenticate': parseMcpServerAuthenticate,
  'customModels.refresh': parseCustomModelsMessage,
  'customModels.save': parseCustomModelsMessage,
  'customModels.delete': parseCustomModelsMessage,
  'customModels.discover': parseCustomModelsMessage,
  'customModels.import': parseCustomModelsMessage,
  'providerModels.refresh': parseCustomModelsMessage,
  'providerModels.saveProvider': parseCustomModelsMessage,
  'providerModels.fetch': parseCustomModelsMessage,
  'providerModels.saveModel': parseCustomModelsMessage,
  'providerModels.import': parseCustomModelsMessage,
  'providerModels.test': parseCustomModelsMessage,
  'providerModels.testAll': parseCustomModelsMessage,
  'attachment.pick': parseAttachmentPick,
  'attachment.addEditor': parseAttachmentAddEditor,
  'attachment.addSelection': parseAttachmentAddSelection,
  'attachment.addProblems': parseAttachmentAddProblems,
  'attachment.addGitChanges': parseAttachmentAddGitChanges,
  'attachment.addImage': parseAttachmentImage,
  'attachment.addPdf': parseAttachmentImage,
  'attachment.addRemoteImage': parseAttachmentImage,
  'attachment.readImage': parseAttachmentImage,
  'attachment.addUris': parseAttachmentAddUris,
  'attachment.addTextFile': parseAttachmentAddTextFile,
  'attachment.remove': parseAttachmentRemove,
  'attachment.addPath': parseAttachmentAddPath,
  'editStage.begin': parseEditStageBegin,
  'editStage.cancel': parseEditStageCancel,
  'workspace.searchFiles': parseWorkspaceSearchFiles,
  'workspace.readImage': parseWorkspaceReadImage,
  'session.setting.update': parseSessionSettingUpdate,
  'btw.prepare': (value) => parseBtwPrepareMessage(value) ?? undefined,
  'btw.ask': (value) => parseBtwAskMessage(value) ?? undefined,
  'btw.dismiss': (value) => parseBtwDismissMessage(value) ?? undefined,
  'btw.stop': (value) => parseBtwStopMessage(value) ?? undefined,
  'subagent.panel': parseSubagentMessage,
  'subagent.open': parseSubagentMessage,
  'queue.add': (value) => parseQueueAddMessage(value) ?? undefined,
  'queue.update': (value) => parseQueueUpdateMessage(value) ?? undefined,
  'queue.remove': (value) => parseQueueRemoveMessage(value) ?? undefined,
  'queue.promote': (value) => parseQueuePromoteMessage(value) ?? undefined,
  'queue.resume': (value) => parseQueueResumeMessage(value) ?? undefined,
  'queue.clear': (value) => parseQueueClearMessage(value) ?? undefined,
  'mission.start': parseMissionWebviewMessage,
  'mission.dismissSetup': parseMissionWebviewMessage,
  'mission.pause': parseMissionWebviewMessage,
  'mission.resume': parseMissionWebviewMessage,
  'mission.stopCurrentFeature': parseMissionWebviewMessage,
  'mission.refresh': parseMissionWebviewMessage,
  'mission.disclosure.set': parseMissionWebviewMessage,
  'mission.viewer.open': parseMissionWebviewMessage,
  'mission.panel.open': parseMissionWebviewMessage,
} satisfies Record<WebviewMessageType, WebviewMessageParser>;

export function parseWebviewMessage(value: unknown): WebviewToHostMessage | undefined {
  try {
    if (!isStrictRecord(value)) {
      return undefined;
    }
    const type = readStringDataProperty(value, 'type');
    return type !== undefined && Object.hasOwn(WEBVIEW_MESSAGE_PARSERS, type)
      ? WEBVIEW_MESSAGE_PARSERS[type as WebviewMessageType](value)
      : undefined;
  } catch {
    return undefined;
  }
}

export {
  isPreviewableFilePath,
  isSafeCommandName,
  isSafeDisplayName,
  isSafeModelId,
  isSafeOpenPath,
  isSafeWorkspaceRelativePath,
  isWebviewToHostMessage,
  sanitizeSessionTitle,
} from './validation/guards';
