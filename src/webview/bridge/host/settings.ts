import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_MODEL_CATALOG_ITEMS,
  SESSION_REASONING_EFFORTS,
} from '../../../shared/protocol/bounds';
import {
  type ModelCatalogItem,
  type ModelCatalogState,
  type SessionReasoningEffort,
  type SessionSettingsState,
} from '../../../shared/protocol/settings';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import type {
  SessionTokenUsageState,
  TokenUsageBreakdown,
} from '../../../shared/protocol/tokenUsage';
import { isSafeDisplayName, isSafeModelId } from '../../../shared/validation/guards';
import { parseSessionContext } from '../validateContextState';
import {
  MAX_STRING_LENGTH,
  isBoundedString,
  isId,
  isSequence,
  isSessionAutonomyLevel,
  isSessionInteractionMode,
  isSessionReasoningEffort,
  isTokenCount,
  readStringDataProperty,
} from './guards';

export function parseSessionSettingsMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.settings' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'settings']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const settings = parseSessionSettings(value.settings);
  return settings === undefined
    ? undefined
    : {
        type: 'session.settings',
        sequence: value.sequence,
        sessionId: value.sessionId,
        settings,
      };
}

export function parseSessionContextMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.context' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'context']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const context = parseSessionContext(value.context);
  return context === undefined
    ? undefined
    : {
        type: 'session.context',
        sequence: value.sequence,
        sessionId: value.sessionId,
        context,
      };
}

export function parseSessionTokenUsageMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.tokenUsage' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'tokenUsage']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const tokenUsage = parseSessionTokenUsageState(value.tokenUsage);
  return tokenUsage === undefined
    ? undefined
    : {
        type: 'session.tokenUsage',
        sequence: value.sequence,
        sessionId: value.sessionId,
        tokenUsage,
      };
}

export function parseSessionTokenUsageState(
  value: unknown,
): SessionTokenUsageState | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['cumulative', 'lastTurn'])) {
    return undefined;
  }
  const cumulative =
    value.cumulative === null ? null : parseTokenUsageBreakdown(value.cumulative);
  const lastTurn =
    value.lastTurn === null ? null : parseTokenUsageBreakdown(value.lastTurn);
  if (cumulative === undefined || lastTurn === undefined) {
    return undefined;
  }
  return { cumulative, lastTurn };
}

export function parseTokenUsageBreakdown(
  value: unknown,
): TokenUsageBreakdown | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      [
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'cacheCreationTokens',
        'thinkingTokens',
      ],
      ['factoryCredits'],
    ) ||
    !isTokenCount(value.inputTokens) ||
    !isTokenCount(value.outputTokens) ||
    !isTokenCount(value.cacheReadTokens) ||
    !isTokenCount(value.cacheCreationTokens) ||
    !isTokenCount(value.thinkingTokens) ||
    (value.factoryCredits !== undefined &&
      (typeof value.factoryCredits !== 'number' ||
        !Number.isFinite(value.factoryCredits) ||
        value.factoryCredits < 0))
  ) {
    return undefined;
  }
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheCreationTokens: value.cacheCreationTokens,
    thinkingTokens: value.thinkingTokens,
    ...(value.factoryCredits === undefined
      ? {}
      : { factoryCredits: value.factoryCredits }),
  };
}

export function parseModelCatalogMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.model-catalog' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'modelCatalog']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const modelCatalog = parseModelCatalog(value.modelCatalog);
  return modelCatalog === undefined
    ? undefined
    : {
        type: 'session.model-catalog',
        sequence: value.sequence,
        sessionId: value.sessionId,
        modelCatalog,
      };
}

export function parseSessionSettings(value: unknown): SessionSettingsState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'error') {
    if (
      !hasExactKeys(value, ['status', 'value', 'message']) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    const confirmed = value.value === null ? null : parseConfirmedSettings(value.value);
    return confirmed === undefined
      ? undefined
      : {
          status: 'error',
          value: confirmed,
          message: value.message,
        };
  }

  if (
    (status !== 'loading' && status !== 'ready' && status !== 'updating') ||
    !hasExactKeys(value, ['status', 'value'])
  ) {
    return undefined;
  }
  const confirmed = value.value === null ? null : parseConfirmedSettings(value.value);
  if (
    confirmed === undefined ||
    ((status === 'ready' || status === 'updating') && confirmed === null)
  ) {
    return undefined;
  }
  if (status === 'loading') {
    return { status: 'loading', value: confirmed };
  }
  if (confirmed === null) {
    return undefined;
  }
  return status === 'ready'
    ? { status: 'ready', value: confirmed }
    : { status: 'updating', value: confirmed };
}

export function parseConfirmedSettings(
  value: unknown,
): Exclude<SessionSettingsState['value'], null> | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'interactionMode',
      'modelId',
      'reasoningEffort',
      'autonomyLevel',
      'specModeModelId',
      'specModeReasoningEffort',
    ]) ||
    !isSessionInteractionMode(value.interactionMode) ||
    !isSafeModelId(value.modelId) ||
    !isSessionReasoningEffort(value.reasoningEffort) ||
    !isSessionAutonomyLevel(value.autonomyLevel) ||
    (value.specModeModelId !== null && !isSafeModelId(value.specModeModelId)) ||
    (value.specModeReasoningEffort !== null &&
      !isSessionReasoningEffort(value.specModeReasoningEffort))
  ) {
    return undefined;
  }
  return {
    interactionMode: value.interactionMode,
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
    autonomyLevel: value.autonomyLevel,
    specModeModelId: value.specModeModelId,
    specModeReasoningEffort: value.specModeReasoningEffort,
  };
}

export function parseModelCatalog(value: unknown): ModelCatalogState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'ready') {
    if (
      !hasExactKeys(value, ['status', 'items']) ||
      !isExactArray(value.items, 0, MAX_MODEL_CATALOG_ITEMS)
    ) {
      return undefined;
    }
    const items: ModelCatalogItem[] = [];
    const ids = new Set<string>();
    for (const itemValue of value.items) {
      const item = parseModelCatalogItem(itemValue);
      if (item === undefined || ids.has(item.id)) {
        return undefined;
      }
      ids.add(item.id);
      items.push(item);
    }
    return { status: 'ready', items };
  }

  if (status !== 'loading' && status !== 'error' && status !== 'unsupported') {
    return undefined;
  }
  const expectsMessage = status === 'error' || status === 'unsupported';
  if (
    !hasExactKeys(
      value,
      expectsMessage ? ['status', 'items', 'message'] : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, 0) ||
    (expectsMessage && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  return status === 'loading'
    ? { status: 'loading', items: [] }
    : status === 'error'
      ? { status: 'error', items: [], message: value.message as string }
      : {
          status: 'unsupported',
          items: [],
          message: value.message as string,
        };
}

export function parseModelCatalogItem(value: unknown): ModelCatalogItem | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'displayName', 'supportedReasoningEfforts']) ||
    !isSafeModelId(value.id) ||
    !isSafeDisplayName(value.displayName) ||
    !isExactArray(value.supportedReasoningEfforts, 1, SESSION_REASONING_EFFORTS.length)
  ) {
    return undefined;
  }
  const efforts: SessionReasoningEffort[] = [];
  const seen = new Set<SessionReasoningEffort>();
  for (const effort of value.supportedReasoningEfforts) {
    if (!isSessionReasoningEffort(effort) || seen.has(effort)) {
      return undefined;
    }
    seen.add(effort);
    efforts.push(effort);
  }
  return {
    id: value.id,
    displayName: value.displayName,
    supportedReasoningEfforts: efforts,
  };
}
