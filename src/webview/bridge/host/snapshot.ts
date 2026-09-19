import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import { parseIdeState } from '../../../shared/protocol/ideProtocol';
import {
  MAX_OPEN_PATH_LENGTH,
  MAX_TURN_TEXT_LENGTH,
} from '../../../shared/protocol/bounds';
import { type ConnectionState } from '../../../shared/protocol/shell';
import { type TurnStatus } from '../../../shared/protocol/turns';
import {
  parseSessionQueueState,
  type SessionQueueState,
} from '../../../shared/protocol/queueProtocol';
import {
  hasExactKeys,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import { parseSessionContext } from '../validateContextState';
import { parseChangedFiles } from './changes';
import {
  MAX_STRING_LENGTH,
  isBoundedString,
  isConnectionStatus,
  isId,
  isNonEmptyBoundedString,
  isNullableId,
  isSequence,
  isSessionHistoryStatus,
  isTurnStatus,
} from './guards';
import { parseSessionCatalog, parseSessionMission } from './sessions';
import {
  parseModelCatalog,
  parseSessionSettings,
  parseSessionTokenUsageState,
} from './settings';
import { parseSessionTranscript } from './transcript';

export function parseHostSnapshot(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'host.snapshot' }> | undefined {
  if (
    !hasExactKeys(
      value,
      [
        'type',
        'sequence',
        'conversationId',
        'sessionId',
        'connection',
        'turn',
        'sessions',
        'settings',
        'context',
        'modelCatalog',
        'transcript',
        'historyStatus',
        'truncated',
      ],
      [
        'mission',
        'ide',
        'worktreeCreateAvailable',
        'btwAvailable',
        'backgroundTurnsAvailable',
        'tokenUsage',
        'workspaceRoot',
        'queue',
        'latestChanges',
      ],
    ) ||
    !isSequence(value.sequence) ||
    !isNullableId(value.conversationId) ||
    !isNullableId(value.sessionId) ||
    (value.conversationId === null) !== (value.sessionId === null) ||
    !isSessionHistoryStatus(value.historyStatus) ||
    typeof value.truncated !== 'boolean' ||
    // Hosts omit the flag when unavailable instead of sending false.
    (value.worktreeCreateAvailable !== undefined &&
      value.worktreeCreateAvailable !== true) ||
    // Same omit-when-unavailable contract as worktreeCreateAvailable.
    (value.btwAvailable !== undefined && value.btwAvailable !== true) ||
    // Same omit-when-unavailable contract (daemon-backed switching).
    (value.backgroundTurnsAvailable !== undefined &&
      value.backgroundTurnsAvailable !== true) ||
    // Hosts omit the root when no usable workspace exists.
    (value.workspaceRoot !== undefined &&
      (!isNonEmptyBoundedString(value.workspaceRoot, MAX_OPEN_PATH_LENGTH) ||
        /[\u0000-\u001f\u007f]/.test(value.workspaceRoot)))
  ) {
    return undefined;
  }
  const ide = value.ide === undefined ? undefined : parseIdeState(value.ide);
  if (value.ide !== undefined && ide === undefined) return undefined;
  const mission =
    value.mission === undefined ? undefined : parseSessionMission(value.mission);
  if (value.mission !== undefined && mission === undefined) {
    return undefined;
  }
  // A mission summary describes the active session only.
  if (mission !== undefined && value.sessionId === null) {
    return undefined;
  }
  const tokenUsage =
    value.tokenUsage === undefined
      ? undefined
      : parseSessionTokenUsageState(value.tokenUsage);
  if (
    (value.tokenUsage !== undefined && tokenUsage === undefined) ||
    // Usage describes the active session only.
    (tokenUsage !== undefined && value.sessionId === null)
  ) {
    return undefined;
  }
  const queue: SessionQueueState | undefined =
    value.queue === undefined
      ? undefined
      : (parseSessionQueueState(value.queue) ?? undefined);
  if (
    (value.queue !== undefined && queue === undefined) ||
    // A queue describes the active session only.
    (queue !== undefined && value.sessionId === null)
  ) {
    return undefined;
  }
  const latestChanges =
    value.latestChanges === undefined
      ? undefined
      : parseLatestConversationChanges(value.latestChanges);
  if (
    (value.latestChanges !== undefined && latestChanges === undefined) ||
    (latestChanges !== undefined && value.sessionId === null)
  ) {
    return undefined;
  }

  const connection = parseConnection(value.connection);
  if (connection === undefined) {
    return undefined;
  }
  const turn = parseSnapshotTurn(value.turn);
  const sessions = parseSessionCatalog(
    value.sessions,
    value.sessionId,
    // The host marks a catalog row active only once a runtime owns the
    // session. Early recovery snapshots ('connecting') and failed
    // activations ('unavailable') legitimately carry a sessionId with
    // no active row yet; rejecting them silently killed recovery
    // speed-up (the whole snapshot was dropped).
    connection.status !== 'connected',
  );
  const settings = parseSessionSettings(value.settings);
  const context = parseSessionContext(value.context);
  const modelCatalog = parseModelCatalog(value.modelCatalog);
  const transcript = parseSessionTranscript(value.transcript);
  if (
    turn === undefined ||
    sessions === undefined ||
    settings === undefined ||
    context === undefined ||
    modelCatalog === undefined ||
    transcript === undefined ||
    (value.sessionId === null &&
      (turn !== null ||
        transcript.length > 0 ||
        value.historyStatus !== 'unavailable')) ||
    (value.historyStatus === 'unavailable' && (transcript.length > 0 || value.truncated))
  ) {
    return undefined;
  }

  return {
    type: 'host.snapshot',
    sequence: value.sequence,
    conversationId: value.conversationId,
    sessionId: value.sessionId,
    connection,
    ...(ide === undefined ? {} : { ide }),
    turn,
    sessions,
    settings,
    context,
    modelCatalog,
    transcript,
    historyStatus: value.historyStatus,
    truncated: value.truncated,
    ...(mission === undefined ? {} : { mission }),
    ...(value.worktreeCreateAvailable === undefined
      ? {}
      : { worktreeCreateAvailable: true }),
    ...(value.btwAvailable === undefined ? {} : { btwAvailable: true }),
    ...(value.backgroundTurnsAvailable === undefined
      ? {}
      : { backgroundTurnsAvailable: true }),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(queue === undefined ? {} : { queue }),
    ...(latestChanges === undefined ? {} : { latestChanges }),
    ...(value.workspaceRoot === undefined ? {} : { workspaceRoot: value.workspaceRoot }),
  };
}

export function parseLatestConversationChanges(
  value: unknown,
): Extract<HostToWebviewMessage, { type: 'host.snapshot' }>['latestChanges'] {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['turnId', 'prompt', 'files']) ||
    !isId(value.turnId) ||
    (value.prompt !== null && !isBoundedString(value.prompt, MAX_TURN_TEXT_LENGTH))
  ) {
    return undefined;
  }
  const files = parseChangedFiles(value.files, 0);
  return files === undefined
    ? undefined
    : { turnId: value.turnId, prompt: value.prompt, files };
}

export function parseConnection(value: unknown): ConnectionState | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['status'], ['message']) ||
    !isConnectionStatus(value.status) ||
    (value.message !== undefined && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }

  return value.message === undefined
    ? { status: value.status }
    : { status: value.status, message: value.message };
}

export function parseSnapshotTurn(value: unknown):
  | {
      readonly turnId: string;
      readonly status: TurnStatus;
      readonly compacting?: boolean;
      readonly error?: string;
    }
  | null
  | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['turnId', 'status'], ['error', 'compacting']) ||
    !isId(value.turnId) ||
    !isTurnStatus(value.status) ||
    (value.compacting !== undefined && typeof value.compacting !== 'boolean') ||
    (value.error !== undefined && !isBoundedString(value.error, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }

  return {
    turnId: value.turnId, status: value.status,
    ...(value.error === undefined ? {} : { error: value.error as string }),
    ...(value.compacting === undefined ? {} : { compacting: value.compacting as boolean }),
  };
}
