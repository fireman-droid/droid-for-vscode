import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_COMMAND_ARGUMENT_HINT_LENGTH,
  MAX_COMMAND_DESCRIPTION_LENGTH,
  MAX_COMMAND_ITEMS,
  MAX_RECENT_COMMANDS,
} from '../../../shared/protocol/bounds';
import {
  type CommandSummary,
  type SessionCommandsState,
} from '../../../shared/protocol/settings';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import { isSafeCommandName } from '../../../shared/validation/guards';
import {
  MAX_STRING_LENGTH,
  isBoundedString,
  isId,
  isNonEmptyBoundedString,
  isSequence,
  readStringDataProperty,
} from './guards';

export function parseSessionCommandsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.commands' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'commands']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const commands = parseSessionCommands(value.commands);
  return commands === undefined
    ? undefined
    : {
        type: 'session.commands',
        sequence: value.sequence,
        sessionId: value.sessionId,
        commands,
      };
}

export function parseSessionCommands(value: unknown): SessionCommandsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'recent', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isExactArray(value.recent, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      recent: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error'
        ? ['status', 'items', 'recent', 'message']
        : ['status', 'items', 'recent'],
    ) ||
    !isExactArray(value.items, 0, MAX_COMMAND_ITEMS) ||
    !isExactArray(value.recent, 0, MAX_RECENT_COMMANDS) ||
    (status === 'error' && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: CommandSummary[] = [];
  const names = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseCommandSummary(itemValue);
    if (item === undefined || names.has(item.name)) {
      return undefined;
    }
    names.add(item.name);
    items.push(item);
  }
  const recent: string[] = [];
  const recentNames = new Set<string>();
  for (const name of value.recent) {
    if (!isSafeCommandName(name) || recentNames.has(name)) {
      return undefined;
    }
    recentNames.add(name);
    recent.push(name);
  }
  return status === 'error'
    ? { status: 'error', items, recent, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items, recent }
      : { status: 'ready', items, recent };
}

export function parseCommandSummary(value: unknown): CommandSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['name', 'description', 'argumentHint', 'isExecutable']) ||
    !isSafeCommandName(value.name) ||
    (value.description !== null &&
      !isNonEmptyBoundedString(value.description, MAX_COMMAND_DESCRIPTION_LENGTH)) ||
    (value.argumentHint !== null &&
      !isNonEmptyBoundedString(value.argumentHint, MAX_COMMAND_ARGUMENT_HINT_LENGTH)) ||
    typeof value.isExecutable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    argumentHint: value.argumentHint,
    isExecutable: value.isExecutable,
  };
}
