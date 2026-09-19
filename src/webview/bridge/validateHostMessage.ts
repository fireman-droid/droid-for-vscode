import { type HostToWebviewMessage } from '../../shared/bridgeMessages';
import { parseHostIde } from '../../shared/protocol/ideProtocol';
import { parseFileDiffMessage, parseFileDiffInvalidateMessage } from '../../shared/protocol/inlineDiffProtocol';
import {
  parseSessionBtwMessage,
  type SessionBtwMessage,
} from '../../shared/protocol/btwProtocol';
import { parseCanvasFeedbackDraftMessage } from '../../shared/protocol/canvasProtocol';
import { parseCustomModelsHostMessage } from '../../shared/protocol/customModelsProtocol';
import { parseMissionHostMessage } from '../../shared/protocol/missionProtocol';
import { THEME_PREFERENCES } from '../../shared/protocol/bounds';
import { type ThemePreference } from '../../shared/protocol/shell';
import {
  parseQueueStateMessage,
  type QueueStateMessage,
} from '../../shared/protocol/queueProtocol';
import { parseReviewHostMessage } from '../../shared/protocol/reviewProtocol';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../../shared/validation/strictValidation';
import { parseSubagentActivityMessage } from '../../shared/protocol/subagentProtocol';
import {
  parseRewindInfo,
  parseSessionAttachmentsMessage,
  parseSessionEditAttachmentsMessage,
  parseTurnEditResendRejected,
  parseWorkspaceFiles,
} from './host/attachments';
import { parseChangesUpdate, parseGitCommitResult, parseGitStatus } from './host/changes';
import { parseSessionCommandsMessage } from './host/commands';
import { isNullableId, isSequence, readStringDataProperty } from './host/guards';
import { parseTranscriptImage, parseWorkspaceImageData } from './host/images';
import { parseInteractionRequestMessage } from './host/interactions';
import { parseMcpAuth, parseSessionMcpMessage } from './host/mcp';
import { parseSessionPluginsMessage } from './host/plugins';
import {
  parseSessionArchivedMessage,
  parseSessionRunningMessage,
  parseSessionSearchMessage,
} from './host/sessions';
import {
  parseModelCatalogMessage,
  parseSessionContextMessage,
  parseSessionSettingsMessage,
  parseSessionTokenUsageMessage,
} from './host/settings';
import { parseSessionSkillsMessage } from './host/skills';
import { parseConnection, parseHostSnapshot } from './host/snapshot';
import { parseSubagentUpdate, parseToolActivity } from './host/tools';
import {
  parseAssistantDelta,
  parseRuntimeDiagnostic,
  parseThinkingComplete,
  parseThinkingDelta,
  parseTurnError,
  parseTurnState,
  parseUserMessageMeta,
} from './host/turns';
import {
  parseInteractionClosedMessage,
  parsePlanDocumentStateMessage,
} from './interactionHostValidation';
import { parseAttachmentImageData } from './parseAttachmentImageData';
import { parseGitBranchDiff } from './parseGitBranchDiff';

type HostMessageType = HostToWebviewMessage['type'];

type HostMessageParser = (value: UnknownRecord) => HostToWebviewMessage | undefined;

const parseReviewMessage: HostMessageParser = (value) =>
  parseReviewHostMessage(value) ?? undefined;

const parseCustomModelsMessage: HostMessageParser = (value) =>
  parseCustomModelsHostMessage(value) ?? undefined;

const HOST_MESSAGE_PARSERS = {
  'host.ide': parseHostIde,
  'host.snapshot': parseHostSnapshot,
  'host.connection': parseHostConnection,
  'session.settings': parseSessionSettingsMessage,
  'session.context': parseSessionContextMessage,
  'session.tokenUsage': parseSessionTokenUsageMessage,
  'session.model-catalog': parseModelCatalogMessage,
  'session.skills': parseSessionSkillsMessage,
  'session.plugins': parseSessionPluginsMessage,
  'session.mcp': parseSessionMcpMessage,
  'session.commands': parseSessionCommandsMessage,
  'mcp.auth': parseMcpAuth,
  'session.archived': parseSessionArchivedMessage,
  'session.running': parseSessionRunningMessage,
  'session.searchResults': parseSessionSearchMessage,
  'session.attachments': parseSessionAttachmentsMessage,
  'session.attachmentImageData': parseAttachmentImageData,
  'session.editAttachments': parseSessionEditAttachmentsMessage,
  'turn.editResendRejected': parseTurnEditResendRejected,
  'workspace.files': parseWorkspaceFiles,
  'workspace.imageData': parseWorkspaceImageData,
  'rewind.info': parseRewindInfo,
  'assistant.delta': parseAssistantDelta,
  'thinking.delta': parseThinkingDelta,
  'thinking.complete': parseThinkingComplete,
  'tool.activity': parseToolActivity,
  'subagent.update': parseSubagentUpdate,
  'subagent.activity': (value) => parseSubagentActivityMessage(value) ?? undefined,
  'transcript.image': parseTranscriptImage,
  'changes.update': parseChangesUpdate,
  'file.diff': parseFileDiffMessage,
  'file.diff.invalidate': parseFileDiffInvalidateMessage,
  'git.status': parseGitStatus,
  'git.branchDiff': parseGitBranchDiff,
  'git.commitResult': parseGitCommitResult,
  'review.state': parseReviewMessage,
  'review.restorePreview': parseReviewMessage,
  'review.operationResult': parseReviewMessage,
  'review.agentReviewState': parseReviewMessage,
  'runtime.diagnostic': parseRuntimeDiagnostic,
  'turn.state': parseTurnState,
  'user.message-meta': parseUserMessageMeta,
  'turn.error': parseTurnError,
  'interaction.request': parseInteractionRequestMessage,
  'interaction.closed': parseInteractionClosedMessage,
  'plan.document.state': parsePlanDocumentStateMessage,
  'session.btw': parseSessionBtw,
  'queue.state': parseQueueState,
  'ui.theme': parseUiTheme,
  'customModels.state': parseCustomModelsMessage,
  'customModels.discovery': parseCustomModelsMessage,
  'providerModels.state': parseCustomModelsMessage,
  'canvas.feedbackDraft': parseCanvasFeedbackDraftMessage,
  'mission.snapshot': parseMissionHostMessage,
  'mission.controlResult': parseMissionHostMessage,
} satisfies Record<HostMessageType, HostMessageParser>;

export function readHostMessage(value: unknown): HostToWebviewMessage | undefined {
  try {
    if (!isStrictRecord(value)) {
      return undefined;
    }
    const type = readStringDataProperty(value, 'type');
    if (type === undefined) {
      return undefined;
    }
    return Object.hasOwn(HOST_MESSAGE_PARSERS, type)
      ? HOST_MESSAGE_PARSERS[type as HostMessageType](value)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseHostConnection(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'host.connection' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'conversationId',
      'sessionId',
      'connection',
    ]) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.conversationId) ||
    !isNullableId(value.sessionId) ||
    (value.conversationId === null) !== (value.sessionId === null)
  ) {
    return undefined;
  }

  const connection = parseConnection(value.connection);
  if (connection === undefined) {
    return undefined;
  }

  return {
    type: 'host.connection',
    sequence: value.sequence,
    conversationId: value.conversationId,
    sessionId: value.sessionId,
    connection,
  };
}

function parseSessionBtw(value: UnknownRecord): SessionBtwMessage | undefined {
  // The shared parser owns the shape and content bounds; the
  // non-negative safe-integer sequence contract is this module's.
  const message = parseSessionBtwMessage(value);
  return message !== null && isSequence(message.sequence) ? message : undefined;
}

function parseQueueState(value: UnknownRecord): QueueStateMessage | undefined {
  // The shared parser owns the shape and content bounds; the
  // non-negative safe-integer sequence contract is this module's.
  const message = parseQueueStateMessage(value);
  return message !== null && isSequence(message.sequence) ? message : undefined;
}

/** Sequence-free view theme push, applied outside the session store. */
function parseUiTheme(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'ui.theme' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'preference', 'resolved']) ||
    typeof value.preference !== 'string' ||
    !(THEME_PREFERENCES as readonly string[]).includes(value.preference) ||
    (value.resolved !== 'light' && value.resolved !== 'dark')
  ) {
    return undefined;
  }
  return {
    type: 'ui.theme',
    preference: value.preference as ThemePreference,
    resolved: value.resolved,
  };
}

export { parseSessionTranscript } from './host/transcript';
