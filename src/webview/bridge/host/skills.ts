import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_ITEMS,
  MAX_SKILL_NAME_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  type SessionSkillsState,
  type SkillSummary,
} from '../../../shared/protocol/settings';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  MAX_STRING_LENGTH,
  isBoundedString,
  isId,
  isNonEmptyBoundedString,
  isSequence,
  isSkillLocation,
  readStringDataProperty,
} from './guards';

export function parseSessionSkillsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.skills' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'skills']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const skills = parseSessionSkills(value.skills);
  return skills === undefined
    ? undefined
    : {
        type: 'session.skills',
        sequence: value.sequence,
        sessionId: value.sessionId,
        skills,
      };
}

export function parseSessionSkills(value: unknown): SessionSkillsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error' ? ['status', 'items', 'message'] : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_SKILL_ITEMS) ||
    (status === 'error' && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: SkillSummary[] = [];
  const names = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseSkillSummary(itemValue);
    if (item === undefined || names.has(item.name)) {
      return undefined;
    }
    names.add(item.name);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : { status: 'ready', items };
}

export function parseSkillSummary(value: unknown): SkillSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'name',
      'description',
      'location',
      'enabled',
      'userInvocable',
    ]) ||
    !isNonEmptyBoundedString(value.name, MAX_SKILL_NAME_LENGTH) ||
    (value.description !== null &&
      !isNonEmptyBoundedString(value.description, MAX_SKILL_DESCRIPTION_LENGTH)) ||
    !isSkillLocation(value.location) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.userInvocable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    location: value.location,
    enabled: value.enabled,
    userInvocable: value.userInvocable,
  };
}
