import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_PLUGIN_ID_LENGTH,
  MAX_PLUGIN_ITEMS,
  MAX_PLUGIN_MARKETPLACE_COUNT,
  MAX_PLUGIN_VERSION_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  type PluginSummary,
  type SessionPluginsState,
} from '../../../shared/protocol/settings';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  MAX_STRING_LENGTH,
  hasControlCharacter,
  isBoundedString,
  isCount,
  isId,
  isNonEmptyBoundedString,
  isPluginScope,
  isSequence,
  readStringDataProperty,
} from './guards';

export function parseSessionPluginsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.plugins' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'plugins']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const plugins = parseSessionPlugins(value.plugins);
  return plugins === undefined
    ? undefined
    : {
        type: 'session.plugins',
        sequence: value.sequence,
        sessionId: value.sessionId,
        plugins,
      };
}

export function parseSessionPlugins(value: unknown): SessionPluginsState | undefined {
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
      status === 'error'
        ? ['status', 'items', 'message']
        : status === 'ready'
          ? ['status', 'items', 'marketplaceCount']
          : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_PLUGIN_ITEMS) ||
    (status === 'error' && !isBoundedString(value.message, MAX_STRING_LENGTH)) ||
    (status === 'ready' &&
      (!isCount(value.marketplaceCount) ||
        (value.marketplaceCount as number) > MAX_PLUGIN_MARKETPLACE_COUNT))
  ) {
    return undefined;
  }
  const items: PluginSummary[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.items) {
    const item = parsePluginSummary(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : {
          status: 'ready',
          items,
          marketplaceCount: value.marketplaceCount as number,
        };
}

export function parsePluginSummary(value: unknown): PluginSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'scope', 'version', 'active']) ||
    !isNonEmptyBoundedString(value.id, MAX_PLUGIN_ID_LENGTH) ||
    hasControlCharacter(value.id) ||
    !isPluginScope(value.scope) ||
    !isBoundedString(value.version, MAX_PLUGIN_VERSION_LENGTH) ||
    hasControlCharacter(value.version) ||
    typeof value.active !== 'boolean'
  ) {
    return undefined;
  }
  return {
    id: value.id,
    scope: value.scope,
    version: value.version as string,
    active: value.active,
  };
}
