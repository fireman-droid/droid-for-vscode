import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_MCP_ARG_LENGTH,
  MAX_MCP_ARGS,
  MAX_MCP_COMMAND_LENGTH,
  MAX_MCP_NAME_LENGTH,
  MAX_MCP_URL_LENGTH,
  MCP_SERVER_TYPES,
  MAX_COMMAND_NAME_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MAX_TOOL_FILE_PATH_LENGTH,
  MAX_TURN_TEXT_LENGTH,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
  MAX_FILE_SEARCH_QUERY_LENGTH,
  MAX_IMAGE_PATH_LENGTH,
  MAX_OPEN_PATH_LENGTH,
  MAX_OPEN_PATH_POSITION,
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  IMAGE_MEDIA_TYPES,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_ATTACHMENT_URI_COUNT,
  MAX_ATTACHMENT_URI_LENGTH,
  type AskUserAnswer,
  type AskUserRespondMessage,
  type AttachmentAddEditorMessage,
  type AttachmentAddGitChangesMessage,
  type AttachmentAddTextFileMessage,
  type AttachmentAddUrisMessage,
  type EditStageBeginMessage,
  type EditStageCancelMessage,
  type AttachmentAddPathMessage,
  type AttachmentAddProblemsMessage,
  type AttachmentAddSelectionMessage,
  type AttachmentPickMessage,
  type AttachmentRemoveMessage,
  type FileOpenDiffMessage,
  type FilePreviewMessage,
  type GitCommitRequestMessage,
  type GitRequestStatusMessage,
  PREVIEWABLE_FILE_EXTENSIONS,
  type PreviewInlineHtmlMessage,
  type McpRefreshMessage,
  type McpServerAddMessage,
  type McpServerAuthenticateMessage,
  type McpServerRemoveMessage,
  type McpServerToggleMessage,
  type McpServerType,
  type PermissionRespondMessage,
  type RewindInfoRequestMessage,
  type RuntimeRetryMessage,
  type SessionArchiveMessage,
  type SessionCompactMessage,
  type SessionContextRefreshMessage,
  type SessionFavoriteMessage,
  type SessionSearchMessage,
  type SessionUnarchiveMessage,
  type SessionsArchivedRefreshMessage,
  type SessionForkMessage,
  type SessionNewMessage,
  type WorktreeCreateSessionMessage,
  type SessionRenameMessage,
  type SessionSelectMessage,
  type SessionSettingUpdateMessage,
  type SessionsRefreshMessage,
  type CommandsRefreshMessage,
  type PluginsRefreshMessage,
  type SkillToggleMessage,
  type SkillsRefreshMessage,
  type TerminalOpenMirrorMessage,
  type TurnEditResendMessage,
  type TurnSendMessage,
  type TurnStopMessage,
  MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH,
  THEME_PREFERENCES,
  WEBVIEW_DIAGNOSTIC_KINDS,
  type ThemePreference,
  type UiThemeSetMessage,
  type WebviewDiagnosticKind,
  type WebviewDiagnosticMessage,
  type WebviewReadyMessage,
  type WebviewToHostMessage,
  type WorkspaceOpenPathMessage,
  type WorkspaceReadImageMessage,
  type WorkspaceSearchFilesMessage,
} from './bridgeMessages';
import { parseBtwAskMessage, parseBtwDismissMessage, parseBtwPrepareMessage, parseBtwStopMessage } from './btwProtocol';
import { parseCustomModelsWebviewMessage } from './customModelsProtocol';
import {
  parseCanvasInlinePreviewMessage,
} from './canvasProtocol';
import { parseMissionWebviewMessage } from './missionProtocol';
import { parseSubagentWebviewMessage } from './subagentProtocol';
import { parseReviewWebviewMessage } from './reviewProtocol';
import {
  parseQueueAddMessage,
  parseQueueClearMessage,
  parseQueuePromoteMessage,
  parseQueueRemoveMessage,
  parseQueueResumeMessage,
  parseQueueUpdateMessage,
} from './queueProtocol';
import {
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
  MAX_GIT_COMMIT_PATHS,
} from './gitCommitFlow';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from './strictValidation';
import { parsePlanDocumentOpen } from './parsePlanDocumentOpen';
import { parseAttachmentImageMessage } from './parseAttachmentImageMessage';

type WebviewMessageType = WebviewToHostMessage['type'];
type WebviewMessageParser =
  (value: UnknownRecord) => WebviewToHostMessage | undefined;

const parseReviewMessage: WebviewMessageParser = (value) =>
  parseReviewWebviewMessage(value, isId, isSafeWorkspaceRelativePath);
const parseCustomModelsMessage: WebviewMessageParser = (value) =>
  parseCustomModelsWebviewMessage(value) ?? undefined;
const parseAttachmentImage: WebviewMessageParser = (value) =>
  parseAttachmentImageMessage(value, isId, hasValidStage);
const parseSubagentMessage: WebviewMessageParser = (value) =>
  parseSubagentWebviewMessage(value) ?? undefined;

const WEBVIEW_MESSAGE_PARSERS = {
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

export function parseWebviewMessage(
  value: unknown,
): WebviewToHostMessage | undefined {
  try {
    if (!isStrictRecord(value)) {
      return undefined;
    }
    const type = readStringDataProperty(value, 'type');
    return type !== undefined &&
      Object.hasOwn(WEBVIEW_MESSAGE_PARSERS, type)
      ? WEBVIEW_MESSAGE_PARSERS[type as WebviewMessageType](value)
      : undefined;
  } catch {
    return undefined;
  }
}

export function isWebviewToHostMessage(
  value: unknown,
): value is WebviewToHostMessage {
  return parseWebviewMessage(value) !== undefined;
}

function parseWebviewReady(
  value: UnknownRecord,
): WebviewReadyMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'protocolVersion']) ||
    value.protocolVersion !== BRIDGE_PROTOCOL_VERSION
  ) {
    return undefined;
  }

  return {
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
  };
}

function parseWebviewDiagnostic(
  value: UnknownRecord,
): WebviewDiagnosticMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'kind', 'detail']) ||
    typeof value.kind !== 'string' ||
    !(WEBVIEW_DIAGNOSTIC_KINDS as readonly string[]).includes(
      value.kind,
    ) ||
    typeof value.detail !== 'string' ||
    value.detail.length > MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH
  ) {
    return undefined;
  }

  return {
    type: 'webview.diagnostic',
    kind: value.kind as WebviewDiagnosticKind,
    detail: value.detail,
  };
}

function parseTurnSend(value: UnknownRecord): TurnSendMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'text']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_TURN_TEXT_LENGTH
  ) {
    return undefined;
  }

  return {
    type: 'turn.send',
    sessionId: value.sessionId,
    turnId: value.turnId,
    text: value.text,
  };
}

function parseTurnStop(value: UnknownRecord): TurnStopMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }

  return {
    type: 'turn.stop',
    sessionId: value.sessionId,
    turnId: value.turnId,
  };
}

function parseTurnEditResend(
  value: UnknownRecord,
): TurnEditResendMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'turnId', 'messageId', 'text'],
      ['restoreFiles'],
    ) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.messageId) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_TURN_TEXT_LENGTH ||
    (value.restoreFiles !== undefined &&
      typeof value.restoreFiles !== 'boolean')
  ) {
    return undefined;
  }

  return {
    type: 'turn.editResend',
    sessionId: value.sessionId,
    turnId: value.turnId,
    messageId: value.messageId,
    text: value.text,
    ...(value.restoreFiles === undefined
      ? {}
      : { restoreFiles: value.restoreFiles }),
  };
}

function parseRewindInfoRequest(
  value: UnknownRecord,
): RewindInfoRequestMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'messageId']) ||
    !isId(value.sessionId) ||
    !isId(value.messageId)
  ) {
    return undefined;
  }

  return {
    type: 'rewind.info',
    sessionId: value.sessionId,
    messageId: value.messageId,
  };
}

function parseRuntimeRetry(
  value: UnknownRecord,
): RuntimeRetryMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    (value.sessionId !== null && !isId(value.sessionId))
  ) {
    return undefined;
  }

  return {
    type: 'runtime.retry',
    sessionId: value.sessionId,
  };
}

function parsePermissionRespond(
  value: UnknownRecord,
): PermissionRespondMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'turnId', 'requestId', 'selectedOption'],
      ['editedSpecContent'],
    ) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId) ||
    !isNonEmptyBoundedString(
      value.selectedOption,
      MAX_PERMISSION_OPTION_VALUE_LENGTH,
    ) ||
    (value.editedSpecContent !== undefined &&
      !isBoundedString(
        value.editedSpecContent,
        MAX_EDITED_SPEC_LENGTH,
      ))
  ) {
    return undefined;
  }

  return value.editedSpecContent === undefined
    ? {
        type: 'permission.respond',
        sessionId: value.sessionId,
        turnId: value.turnId,
        requestId: value.requestId,
        selectedOption: value.selectedOption,
      }
    : {
        type: 'permission.respond',
        sessionId: value.sessionId,
        turnId: value.turnId,
        requestId: value.requestId,
        selectedOption: value.selectedOption,
        editedSpecContent: value.editedSpecContent,
      };
}

function parseAskUserRespond(
  value: UnknownRecord,
): AskUserRespondMessage | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sessionId',
      'turnId',
      'requestId',
      'cancelled',
      'answers',
    ]) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.requestId) ||
    typeof value.cancelled !== 'boolean' ||
    !isExactArray(value.answers, 0, MAX_ASK_USER_ANSWERS) ||
    (value.cancelled
      ? value.answers.length !== 0
      : value.answers.length === 0)
  ) {
    return undefined;
  }

  const answers: AskUserAnswer[] = [];
  const indices = new Set<number>();
  for (const answerValue of value.answers) {
    const answer = parseAskUserAnswer(answerValue);
    if (answer === undefined || indices.has(answer.index)) {
      return undefined;
    }
    indices.add(answer.index);
    answers.push(answer);
  }

  return {
    type: 'ask-user.respond',
    sessionId: value.sessionId,
    turnId: value.turnId,
    requestId: value.requestId,
    cancelled: value.cancelled,
    answers,
  };
}

function parseAskUserAnswer(value: unknown): AskUserAnswer | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['index', 'answer']) ||
    !isIndex(value.index) ||
    !isNonEmptyBoundedString(value.answer, MAX_ASK_USER_ANSWER_LENGTH)
  ) {
    return undefined;
  }

  return { index: value.index, answer: value.answer };
}

function parseSessionsRefresh(
  value: UnknownRecord,
): SessionsRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'sessions.refresh' };
}

function parseSessionSelect(
  value: UnknownRecord,
): SessionSelectMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.select', sessionId: value.sessionId };
}

function parseSessionNew(
  value: UnknownRecord,
): SessionNewMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'session.new' };
}

function parseUiThemeSet(
  value: UnknownRecord,
): UiThemeSetMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'preference']) ||
    typeof value.preference !== 'string' ||
    !(THEME_PREFERENCES as readonly string[]).includes(value.preference)
  ) {
    return undefined;
  }

  return {
    type: 'ui.theme.set',
    preference: value.preference as ThemePreference,
  };
}

function parseWorktreeCreateSession(
  value: UnknownRecord,
): WorktreeCreateSessionMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'worktree.createSession' };
}

function parseSessionRename(
  value: UnknownRecord,
): SessionRenameMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'title']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    value.title.trim().length === 0
  ) {
    return undefined;
  }

  return {
    type: 'session.rename',
    sessionId: value.sessionId,
    title: value.title,
  };
}

function parseSessionFavorite(
  value: UnknownRecord,
): SessionFavoriteMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'favorite']) ||
    !isId(value.sessionId) ||
    typeof value.favorite !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'session.favorite',
    sessionId: value.sessionId,
    favorite: value.favorite,
  };
}

function parseSessionArchive(
  value: UnknownRecord,
): SessionArchiveMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'session.archive', sessionId: value.sessionId };
}

function parseSessionUnarchive(
  value: UnknownRecord,
): SessionUnarchiveMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'session.unarchive', sessionId: value.sessionId };
}

function parseSessionsArchivedRefresh(
  value: UnknownRecord,
): SessionsArchivedRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'sessions.archivedRefresh' };
}

function parseSessionSearch(
  value: UnknownRecord,
): SessionSearchMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'query']) ||
    typeof value.query !== 'string' ||
    value.query.trim().length === 0 ||
    value.query.length > MAX_SESSION_SEARCH_QUERY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.query)
  ) {
    return undefined;
  }

  return { type: 'session.search', query: value.query };
}

function parseSessionContextRefresh(
  value: UnknownRecord,
): SessionContextRefreshMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return {
    type: 'session.context.refresh',
    sessionId: value.sessionId,
  };
}

function parseSessionCompact(
  value: UnknownRecord,
): SessionCompactMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'session.compact', sessionId: value.sessionId };
}

function parseSessionFork(
  value: UnknownRecord,
): SessionForkMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'session.fork', sessionId: value.sessionId };
}

function parseFileOpenDiff(
  value: UnknownRecord,
): FileOpenDiffMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'path']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isSafeWorkspaceRelativePath(value.path)
  ) {
    return undefined;
  }

  return {
    type: 'file.openDiff',
    sessionId: value.sessionId,
    turnId: value.turnId,
    path: value.path,
  };
}

function parseWorkspaceOpenPath(
  value: UnknownRecord,
): WorkspaceOpenPathMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'path'],
      ['line', 'column'],
    ) ||
    !isId(value.sessionId) ||
    !isSafeOpenPath(value.path) ||
    (value.line !== undefined && !isPathPosition(value.line)) ||
    (value.column !== undefined &&
      (value.line === undefined || !isPathPosition(value.column)))
  ) {
    return undefined;
  }

  return {
    type: 'workspace.openPath',
    sessionId: value.sessionId,
    path: value.path,
    ...(value.line === undefined ? {} : { line: value.line }),
    ...(value.column === undefined ? {} : { column: value.column }),
  };
}

/**
 * Accepts bounded absolute (drive-letter or POSIX) and relative paths
 * without control characters or `..` traversal segments. Existence and
 * file-versus-directory checks stay on the host, which resolves the
 * path against the workspace root when it is relative.
 */
export function isSafeOpenPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_OPEN_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value
    .split(/[\\/]/)
    .every((segment) => segment !== '..');
}

function isPathPosition(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_OPEN_PATH_POSITION
  );
}

/**
 * Accepts only bounded, forward-slash, workspace-relative paths without
 * traversal segments, drive letters, or control characters.
 */
export function isSafeWorkspaceRelativePath(
  value: unknown,
): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TOOL_FILE_PATH_LENGTH ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  return value
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '..');
}

/**
 * True when a workspace-relative path names a file the sandboxed
 * prototype preview can render. Both sides use this one predicate: the
 * webview to decide whether a Preview chip appears, the bridge parser
 * and the host to reject `file.preview` requests for anything else.
 */
export function isPreviewableFilePath(value: string): boolean {
  const lower = value.toLowerCase();
  return PREVIEWABLE_FILE_EXTENSIONS.some(
    (extension) =>
      lower.endsWith(extension) && lower.length > extension.length,
  );
}

function parseFilePreview(
  value: UnknownRecord,
): FilePreviewMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path']) ||
    !isId(value.sessionId) ||
    !isSafeWorkspaceRelativePath(value.path) ||
    !isPreviewableFilePath(value.path)
  ) {
    return undefined;
  }

  return {
    type: 'file.preview',
    sessionId: value.sessionId,
    path: value.path,
  };
}

function parsePreviewInlineHtml(
  value: UnknownRecord,
): PreviewInlineHtmlMessage | undefined {
  return parseCanvasInlinePreviewMessage(value, isId);
}

function parseGitRequestStatus(value: UnknownRecord): GitRequestStatusMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }

  return { type: 'git.requestStatus', sessionId: value.sessionId, turnId: value.turnId };
}

function parseTerminalOpenMirror(
  value: UnknownRecord,
): TerminalOpenMirrorMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'terminal.openMirror', sessionId: value.sessionId };
}

function parseGitCommitRequest(value: UnknownRecord): GitCommitRequestMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'paths', 'message']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isExactArray(value.paths, 1, MAX_GIT_COMMIT_PATHS) ||
    typeof value.message !== 'string' ||
    value.message.trim().length === 0 ||
    value.message.length > MAX_GIT_COMMIT_MESSAGE_LENGTH
  ) {
    return undefined;
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const pathValue of value.paths) {
    if (
      !isSafeWorkspaceRelativePath(pathValue) ||
      seen.has(pathValue)
    ) {
      return undefined;
    }
    seen.add(pathValue);
    paths.push(pathValue);
  }

  return { type: 'git.commit', sessionId: value.sessionId, turnId: value.turnId, paths, message: value.message };
}

function parseSkillsRefresh(
  value: UnknownRecord,
): SkillsRefreshMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'skills.refresh', sessionId: value.sessionId };
}

function parsePluginsRefresh(
  value: UnknownRecord,
): PluginsRefreshMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'plugins.refresh', sessionId: value.sessionId };
}

function parseSkillToggle(
  value: UnknownRecord,
): SkillToggleMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name', 'disabled']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_SKILL_NAME_LENGTH) ||
    typeof value.disabled !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'skill.toggle',
    sessionId: value.sessionId,
    name: value.name,
    disabled: value.disabled,
  };
}

function parseGitRequestBranchDiff(
  value: UnknownRecord,
): Extract<WebviewToHostMessage, { type: 'git.requestBranchDiff' }> | undefined {
  return hasExactKeys(value, ['type', 'sessionId']) &&
    isId(value.sessionId)
    ? { type: 'git.requestBranchDiff', sessionId: value.sessionId }
    : undefined;
}

function parseCommandsRefresh(
  value: UnknownRecord,
): CommandsRefreshMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'commands.refresh', sessionId: value.sessionId };
}

function parseMcpRefresh(
  value: UnknownRecord,
): McpRefreshMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'mcp.refresh', sessionId: value.sessionId };
}

function parseMcpServerToggle(
  value: UnknownRecord,
): McpServerToggleMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name', 'enabled']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    typeof value.enabled !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'mcp.server.toggle',
    sessionId: value.sessionId,
    name: value.name,
    enabled: value.enabled,
  };
}

function parseMcpServerAdd(
  value: UnknownRecord,
): McpServerAddMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'name', 'serverType'],
      ['command', 'args', 'url'],
    ) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    !MCP_SERVER_TYPES.includes(value.serverType as McpServerType)
  ) {
    return undefined;
  }
  const serverType = value.serverType as McpServerType;

  if (serverType === 'stdio') {
    if (
      value.url !== undefined ||
      !isNonEmptyBoundedString(value.command, MAX_MCP_COMMAND_LENGTH)
    ) {
      return undefined;
    }
    let args: readonly string[] | undefined;
    if (value.args !== undefined) {
      if (
        !Array.isArray(value.args) ||
        value.args.length > MAX_MCP_ARGS ||
        !value.args.every((arg) =>
          isNonEmptyBoundedString(arg, MAX_MCP_ARG_LENGTH),
        )
      ) {
        return undefined;
      }
      args = value.args as readonly string[];
    }
    return {
      type: 'mcp.server.add',
      sessionId: value.sessionId,
      name: value.name,
      serverType,
      command: value.command,
      ...(args === undefined ? {} : { args }),
    };
  }

  if (
    value.command !== undefined ||
    value.args !== undefined ||
    !isNonEmptyBoundedString(value.url, MAX_MCP_URL_LENGTH) ||
    !/^https?:\/\//.test(value.url)
  ) {
    return undefined;
  }
  return {
    type: 'mcp.server.add',
    sessionId: value.sessionId,
    name: value.name,
    serverType,
    url: value.url,
  };
}

function parseMcpServerRemove(
  value: UnknownRecord,
): McpServerRemoveMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH)
  ) {
    return undefined;
  }

  return {
    type: 'mcp.server.remove',
    sessionId: value.sessionId,
    name: value.name,
  };
}

function parseMcpServerAuthenticate(
  value: UnknownRecord,
): McpServerAuthenticateMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH)
  ) {
    return undefined;
  }

  return {
    type: 'mcp.server.authenticate',
    sessionId: value.sessionId,
    name: value.name,
  };
}

/**
 * Validates the optional `stage` routing field on attachment
 * messages: absent (composer staging) or the literal 'edit'.
 */
function hasValidStage(
  value: UnknownRecord,
): value is UnknownRecord & { stage?: 'edit' } {
  return value.stage === undefined || value.stage === 'edit';
}

function stageOf(value: { stage?: 'edit' }): { stage?: 'edit' } {
  return value.stage === undefined ? {} : { stage: value.stage };
}

function parseAttachmentPick(
  value: UnknownRecord,
): AttachmentPickMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.pick',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

function parseAttachmentAddEditor(
  value: UnknownRecord,
): AttachmentAddEditorMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addEditor',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

function parseAttachmentAddSelection(
  value: UnknownRecord,
): AttachmentAddSelectionMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addSelection',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

function parseAttachmentAddProblems(
  value: UnknownRecord,
): AttachmentAddProblemsMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addProblems',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

function parseAttachmentAddGitChanges(
  value: UnknownRecord,
): AttachmentAddGitChangesMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addGitChanges',
    sessionId: value.sessionId,
    ...stageOf(value),
  };
}

function parseAttachmentAddUris(
  value: UnknownRecord,
): AttachmentAddUrisMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'uris'], ['stage']) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    !Array.isArray(value.uris) ||
    value.uris.length === 0 ||
    value.uris.length > MAX_ATTACHMENT_URI_COUNT ||
    !value.uris.every(
      (uri) =>
        typeof uri === 'string' &&
        uri.startsWith('file://') &&
        uri.length <= MAX_ATTACHMENT_URI_LENGTH &&
        !/[\u0000-\u001f\u007f]/.test(uri),
    )
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addUris',
    sessionId: value.sessionId,
    uris: [...(value.uris as readonly string[])],
    ...stageOf(value),
  };
}

function parseAttachmentAddTextFile(
  value: UnknownRecord,
): AttachmentAddTextFileMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'name', 'text', 'truncated'],
      ['stage'],
    ) ||
    !isId(value.sessionId) ||
    !hasValidStage(value) ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > MAX_ATTACHMENT_NAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.name) ||
    typeof value.text !== 'string' ||
    value.text.length === 0 ||
    value.text.length > MAX_ATTACHMENT_TEXT_FILE_CHARS ||
    value.text.includes('\u0000') ||
    typeof value.truncated !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addTextFile',
    sessionId: value.sessionId,
    name: value.name,
    text: value.text,
    truncated: value.truncated,
    ...stageOf(value),
  };
}

function parseAttachmentRemove(
  value: UnknownRecord,
): AttachmentRemoveMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'attachmentId'], ['stage']) ||
    !isId(value.sessionId) ||
    !isId(value.attachmentId) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.remove',
    sessionId: value.sessionId,
    attachmentId: value.attachmentId,
    ...stageOf(value),
  };
}

function parseAttachmentAddPath(
  value: UnknownRecord,
): AttachmentAddPathMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path'], ['stage']) ||
    !isId(value.sessionId) ||
    !isSafeWorkspaceRelativePath(value.path) ||
    !hasValidStage(value)
  ) {
    return undefined;
  }

  return {
    type: 'attachment.addPath',
    sessionId: value.sessionId,
    path: value.path,
    ...stageOf(value),
  };
}

function parseEditStageBegin(
  value: UnknownRecord,
): EditStageBeginMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'messageId']) ||
    !isId(value.sessionId) ||
    !isId(value.messageId)
  ) {
    return undefined;
  }

  return {
    type: 'editStage.begin',
    sessionId: value.sessionId,
    messageId: value.messageId,
  };
}

function parseEditStageCancel(
  value: UnknownRecord,
): EditStageCancelMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  return { type: 'editStage.cancel', sessionId: value.sessionId };
}

function parseWorkspaceSearchFiles(
  value: UnknownRecord,
): WorkspaceSearchFilesMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'requestId', 'query']) ||
    !isId(value.sessionId) ||
    !isId(value.requestId) ||
    typeof value.query !== 'string' ||
    value.query.length > MAX_FILE_SEARCH_QUERY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.query)
  ) {
    return undefined;
  }

  return {
    type: 'workspace.searchFiles',
    sessionId: value.sessionId,
    requestId: value.requestId,
    query: value.query,
  };
}

function parseWorkspaceReadImage(
  value: UnknownRecord,
): WorkspaceReadImageMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path']) ||
    !isId(value.sessionId) ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.length > MAX_IMAGE_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.path)
  ) {
    return undefined;
  }

  return {
    type: 'workspace.readImage',
    sessionId: value.sessionId,
    path: value.path,
  };
}

function parseSessionSettingUpdate(
  value: UnknownRecord,
): SessionSettingUpdateMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'field', 'value']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  switch (value.field) {
    case 'interactionMode':
      return isEnumValue(value.value, SESSION_INTERACTION_MODES)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'interactionMode',
            value: value.value,
          }
        : undefined;
    case 'modelId':
      return isSafeModelId(value.value)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'modelId',
            value: value.value,
          }
        : undefined;
    case 'reasoningEffort':
      return isEnumValue(value.value, SESSION_REASONING_EFFORTS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'reasoningEffort',
            value: value.value,
          }
        : undefined;
    case 'autonomyLevel':
      return isEnumValue(value.value, SESSION_AUTONOMY_LEVELS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'autonomyLevel',
            value: value.value,
          }
        : undefined;
    case 'specModeModelId':
      return value.value === null || isSafeModelId(value.value)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'specModeModelId',
            value: value.value,
          }
        : undefined;
    case 'specModeReasoningEffort':
      return value.value === null ||
        isEnumValue(value.value, SESSION_REASONING_EFFORTS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'specModeReasoningEffort',
            value: value.value,
          }
        : undefined;
    default:
      return undefined;
  }
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

function readStringDataProperty(
  value: UnknownRecord,
  key: string,
): string | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

export function isSafeModelId(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_ID_LENGTH) &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

export function isSafeDisplayName(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_DISPLAY_NAME_LENGTH) &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/**
 * Collapses control characters and whitespace runs, trims, and bounds
 * an externally sourced session title. Falls back to a readable
 * placeholder for empty titles. Callers pass their own trust-boundary
 * length limit (catalog 200, Bridge contract 256).
 */
export function sanitizeSessionTitle(value: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return 'Untitled session';
  }
  const title = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return title.length > 0 ? title : 'Untitled session';
}

function isEnumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}

function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

/**
 * True when `value` is a plausible custom command slug: bounded,
 * non-empty, and free of whitespace, separators, and control
 * characters.
 */
export function isSafeCommandName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_COMMAND_NAME_LENGTH &&
    !/[\s@/\u0000-\u001f\u007f]/.test(value)
  );
}
