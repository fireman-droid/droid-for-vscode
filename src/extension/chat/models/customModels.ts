import {
  MAX_CUSTOM_MODEL_MASK_LENGTH,
  MAX_CUSTOM_MODEL_PROVIDER_LENGTH,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  isSafeText as isSafeCustomModelText,
  type CustomModelDeleteMessage,
  type CustomModelDiscoveryState,
  type CustomModelListItem,
  type CustomModelSaveMessage,
  type CustomModelsDiscoverMessage,
  type CustomModelsImportMessage,
  type CustomModelsState,
  type CustomModelsWebviewMessage,
} from '../../../shared/protocol/customModelsProtocol';
import { MAX_MODEL_CATALOG_ITEMS } from '../../../shared/protocol/bounds';
import { sameProviderEndpoint } from '../../../shared/validation/providerEndpoint';
import { isSafeDisplayName, isSafeModelId } from '../../../shared/validation/guards';
import { daemonFailureMessage, formatUnknownError, isTurnActive } from '../internals';
import { ModelDiscoveryError, type CustomModelDiscoveryGateway } from './modelDiscovery';
import type { CustomModelsPort } from './customModelsPort';
import { ProviderRegistry } from './providerRegistry';
export const CUSTOM_MODELS_UNAVAILABLE_MESSAGE =
  'Custom models need the local droid daemon. Sign in with the droid CLI, then retry.';
export const CUSTOM_MODELS_NOT_LOGGED_IN_MESSAGE =
  'Sign in with the droid CLI to manage custom models.';
export const CUSTOM_MODELS_LOAD_FAILED_MESSAGE =
  'Droid did not return the custom model list. Retry from the panel.';
export const CUSTOM_MODELS_SAVE_FAILED_MESSAGE =
  'Droid could not save that model. Check the values and retry.';
export const CUSTOM_MODELS_DELETE_FAILED_MESSAGE =
  'Droid could not delete that model. The list may be stale; refresh it.';
export const CUSTOM_MODELS_CONFLICT_MESSAGE =
  'Custom models changed outside this panel. Review the refreshed list and retry.';
export const CUSTOM_MODELS_BUSY_MESSAGE =
  'Another custom-model operation is still running. Retry in a moment.';
export const CUSTOM_MODELS_DISCOVERY_UNAVAILABLE_MESSAGE =
  'Model discovery is unavailable in this extension host.';
export const CUSTOM_MODELS_IMPORT_FAILED_MESSAGE =
  'Droid could not add every selected model. Review the current group and retry.';
export interface DaemonCustomModelRow {
  readonly rawIndex: number;
  readonly model: string;
  readonly displayName?: string;
  readonly provider: string;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
  readonly apiKeyMask?: string;
  readonly maxOutputTokens?: number;
  readonly noImageSupport?: boolean;
  readonly hasBedrockConfig: boolean;
  readonly isValid: boolean;
}
export interface CustomModelsGateway {
  list(): Promise<DaemonCustomModelRow[]>;
  upsert(params: {
    rawIndex?: number;
    expectedModel?: string;
    model: string;
    displayName?: string;
    provider: string;
    baseUrl?: string;
    apiKey?: string;
    maxOutputTokens?: number | null;
    noImageSupport?: boolean | null;
  }): Promise<{ success: boolean; models: DaemonCustomModelRow[] }>;
  delete(params: {
    rawIndex: number;
    expectedModel: string;
  }): Promise<{ success: boolean; models: DaemonCustomModelRow[] }>;
}
export interface CustomModelsHostSlots {
  daemonCustomModels?: () => Promise<CustomModelsGateway>;
  modelDiscovery?: CustomModelDiscoveryGateway;
  providerRegistry?: ProviderRegistry;
  promptProviderApiKey?: () => Thenable<string | undefined>;
}
export type CustomModelsHost = CustomModelsPort & CustomModelsHostSlots;
export function dispatchCustomModels(
  ctl: CustomModelsHost,
  message: CustomModelsWebviewMessage,
): void {
  if (message.type === 'customModels.refresh') {
    handleCustomModelsRefresh(ctl, message.sessionId);
  } else if (message.type === 'customModels.save') {
    handleCustomModelSave(ctl, message);
  } else if (message.type === 'customModels.delete') {
    handleCustomModelDelete(ctl, message);
  } else if (message.type === 'customModels.discover') {
    handleCustomModelsDiscover(ctl, message);
  } else if (
    message.type === 'providerModels.refresh' ||
    message.type === 'providerModels.saveProvider' ||
    message.type === 'providerModels.fetch' ||
    message.type === 'providerModels.saveModel' ||
    message.type === 'providerModels.import' ||
    message.type === 'providerModels.test' ||
    message.type === 'providerModels.testAll'
  ) {
    ctl.effects.handleProviderModels(message);
  } else {
    handleCustomModelsImport(ctl, message);
  }
}
export function handleCustomModelsRefresh(
  ctl: CustomModelsHost,
  sessionId: string,
): void {
  const gateway = beginCustomModelsRequest(ctl, 'customModels.refresh', sessionId);
  if (gateway === null) {
    return;
  }
  runCustomModelsOperation(ctl, sessionId, 'refresh', (resource) =>
    resource.list().then((models) => ({ models })),
  );
}
export function handleCustomModelSave(
  ctl: CustomModelsHost,
  message: CustomModelSaveMessage,
): void {
  const gateway = beginCustomModelsRequest(ctl, 'customModels.save', message.sessionId);
  if (gateway === null) {
    return;
  }
  ctl.recordHost({
    level: 'info',
    name: 'host.customModels.save',
    attributes: {
      model: message.model,
      provider: message.provider,
      hasApiKey: message.apiKey !== undefined,
      edit: message.rawIndex !== undefined,
    },
  });
  runCustomModelsOperation(ctl, message.sessionId, 'save', (resource) =>
    resource
      .upsert({
        ...(message.rawIndex === undefined
          ? {}
          : {
              rawIndex: message.rawIndex,
              expectedModel: message.expectedModel,
            }),
        model: message.model,
        ...(message.displayName === undefined
          ? {}
          : { displayName: message.displayName }),
        provider: message.provider,
        baseUrl: message.baseUrl,
        ...(message.apiKey === undefined ? {} : { apiKey: message.apiKey }),
        maxOutputTokens: message.maxOutputTokens,
        noImageSupport: message.noImageSupport,
      })
      .then(requireMutationSuccess),
  );
}
export function handleCustomModelDelete(
  ctl: CustomModelsHost,
  message: CustomModelDeleteMessage,
): void {
  const { sessionId, rawIndex, expectedModel } = message;
  const gateway = beginCustomModelsRequest(ctl, 'customModels.delete', sessionId);
  if (gateway === null) {
    return;
  }
  ctl.recordHost({
    level: 'info',
    name: 'host.customModels.delete',
    attributes: { model: expectedModel, rawIndex },
  });
  runCustomModelsOperation(ctl, sessionId, 'delete', (resource) =>
    resource.delete({ rawIndex, expectedModel }).then(requireMutationSuccess),
  );
}
export function handleCustomModelsDiscover(
  ctl: CustomModelsHost,
  message: CustomModelsDiscoverMessage,
): void {
  const dropReason = ctl.sessionRequestDropReason(message.sessionId);
  if (dropReason !== null) {
    ctl.recordDroppedPanelRequest('customModels.discover', dropReason);
    return;
  }
  if (ctl.customModelState.customModelsOp) {
    ctl.recordDroppedPanelRequest('customModels.discover', 'operation-in-flight');
    emitCustomModelDiscovery(ctl, message.sessionId, {
      status: 'error',
      message: CUSTOM_MODELS_BUSY_MESSAGE,
    });
    return;
  }
  if (ctl.modelDiscovery === undefined) {
    emitCustomModelDiscovery(ctl, message.sessionId, {
      status: 'error',
      message: CUSTOM_MODELS_DISCOVERY_UNAVAILABLE_MESSAGE,
    });
    return;
  }
  const runtime = ctl.sessionState.runtime!;
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  const abort = new AbortController();
  ctl.customModelState.customModelsDiscoveryAbort = abort;
  ctl.customModelState.customModelsOp = true;
  emitCustomModelDiscovery(ctl, message.sessionId, { status: 'loading' });
  void ctl.modelDiscovery
    .discover(
      {
        provider: message.provider,
        baseUrl: message.baseUrl,
        ...(message.apiKey === undefined ? {} : { apiKey: message.apiKey }),
      },
      abort.signal,
    )
    .then(
      (items) => {
        if (!finishCustomModelDiscovery(ctl, abort)) {
          return;
        }
        if (ctl.isCurrentSessionOperation(runtime, generation, message.sessionId, cwd)) {
          emitCustomModelDiscovery(ctl, message.sessionId, {
            status: 'ready',
            items,
          });
        }
      },
      (error: unknown) => {
        if (
          !finishCustomModelDiscovery(ctl, abort) ||
          (error instanceof ModelDiscoveryError && error.kind === 'aborted')
        ) {
          return;
        }
        ctl.recordPanelFailure(
          'custom-models-discovery-failed',
          discoveryFailureClass(error),
        );
        if (ctl.isCurrentSessionOperation(runtime, generation, message.sessionId, cwd)) {
          emitCustomModelDiscovery(ctl, message.sessionId, {
            status: 'error',
            message: discoveryFailureMessage(error),
          });
        }
      },
    );
}
function finishCustomModelDiscovery(
  ctl: CustomModelsHost,
  abort: AbortController,
): boolean {
  if (ctl.customModelState.customModelsDiscoveryAbort !== abort) {
    return false;
  }
  ctl.customModelState.customModelsDiscoveryAbort = null;
  ctl.customModelState.customModelsOp = false;
  return true;
}
export function handleCustomModelsImport(
  ctl: CustomModelsHost,
  message: CustomModelsImportMessage,
): void {
  const gateway = beginCustomModelsRequest(ctl, 'customModels.import', message.sessionId);
  if (gateway === null) {
    return;
  }
  ctl.recordHost({
    level: 'info',
    name: 'host.customModels.import',
    attributes: {
      provider: message.provider,
      count: message.models.length,
      hasApiKey: message.apiKey !== undefined,
    },
  });
  runCustomModelsOperation(ctl, message.sessionId, 'import', async (resource) => {
    let models = await resource.list();
    const existing = new Set(
      models
        .filter((item) => isSameCustomModelGroup(item, message))
        .map((item) => item.model),
    );
    for (const item of message.models) {
      if (existing.has(item.model)) {
        continue;
      }
      try {
        const result = await resource.upsert({
          model: item.model,
          ...(item.displayName === undefined ? {} : { displayName: item.displayName }),
          provider: message.provider,
          baseUrl: message.baseUrl,
          ...(message.apiKey === undefined ? {} : { apiKey: message.apiKey }),
          maxOutputTokens: message.maxOutputTokens,
          noImageSupport: message.noImageSupport,
        });
        models = requireMutationSuccess(result).models;
        existing.add(item.model);
      } catch (error) {
        throw new CustomModelImportFailure(models, isConflictError(error));
      }
    }
    return { models };
  });
}
function beginCustomModelsRequest(
  ctl: CustomModelsHost,
  op: string,
  sessionId: string,
): (() => Promise<CustomModelsGateway>) | null {
  const dropReason = ctl.sessionRequestDropReason(sessionId);
  if (dropReason !== null) {
    ctl.recordDroppedPanelRequest(op, dropReason);
    return null;
  }
  const gateway = ctl.daemonCustomModels;
  if (gateway === undefined) {
    emitCustomModels(ctl, sessionId, {
      status: 'unavailable',
      items: [],
      message: CUSTOM_MODELS_UNAVAILABLE_MESSAGE,
    });
    return null;
  }
  if (ctl.customModelState.customModelsOp) {
    ctl.recordDroppedPanelRequest(op, 'operation-in-flight');
    if (op !== 'customModels.refresh') {
      emitCustomModels(ctl, sessionId, {
        status: 'error',
        items: [],
        message: CUSTOM_MODELS_BUSY_MESSAGE,
      });
    }
    return null;
  }
  return gateway;
}
function runCustomModelsOperation(
  ctl: CustomModelsHost,
  sessionId: string,
  op: 'refresh' | 'save' | 'delete' | 'import',
  operation: (
    resource: CustomModelsGateway,
  ) => Promise<{ models: DaemonCustomModelRow[] }>,
): void {
  const runtime = ctl.sessionState.runtime!;
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  ctl.customModelState.customModelsOp = true;
  emitCustomModels(ctl, sessionId, { status: 'loading', items: [] });
  void ctl.daemonCustomModels!()
    .then((resource) => operation(resource))
    .then(
      (result) => {
        ctl.customModelState.customModelsOp = false;
        if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
          return;
        }
        emitCustomModels(ctl, sessionId, {
          status: 'ready',
          items: projectCustomModelItems(result.models),
        });
        if (op !== 'refresh') {
          reloadSessionCatalogWhenIdle(ctl, sessionId, cwd);
        }
      },
      (error: unknown) => {
        ctl.customModelState.customModelsOp = false;
        recordCustomModelsFailure(ctl, op, error);
        if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
          return;
        }
        emitCustomModels(ctl, sessionId, {
          status: 'error',
          items:
            error instanceof CustomModelImportFailure
              ? projectCustomModelItems(error.models)
              : [],
          message: customModelsFailureMessage(op, error),
        });
        if (op !== 'refresh' && isConflictError(error)) {
          handleCustomModelsRefresh(ctl, sessionId);
        } else if (error instanceof CustomModelImportFailure && error.models.length > 0) {
          reloadSessionCatalogWhenIdle(ctl, sessionId, cwd);
        }
      },
    );
}
function reloadSessionCatalogWhenIdle(
  ctl: CustomModelsHost,
  sessionId: string,
  cwd: string,
): void {
  if (
    ctl.sessionState.sessionId !== sessionId ||
    ctl.sessionState.connection.status !== 'connected' ||
    isTurnActive(ctl.turnState.turn) ||
    ctl.interactions.hasPending() ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.catalogState.refreshInProgress ||
    ctl.metadata.settingsUpdate !== null ||
    ctl.queueState.queuedPrompts.items.length > 0
  ) {
    ctl.recordHost({
      level: 'info',
      name: 'host.customModels.reload-skipped',
      attributes: { sessionId },
    });
    return;
  }
  ctl.recordHost({
    level: 'info',
    name: 'host.customModels.reload',
    attributes: { sessionId },
  });
  ctl.effects.startReplacement({ kind: 'resume', cwd, sessionId });
}
function recordCustomModelsFailure(
  ctl: CustomModelsHost,
  op: string,
  error: unknown,
): void {
  ctl.recordPanelFailure(
    `custom-models-${op}-failed`,
    op === 'refresh'
      ? formatUnknownError(error)
      : isConflictError(error)
        ? 'conflict: changed on disk'
        : error instanceof Error
          ? `rpc-error: ${error.name}`
          : 'rpc-error',
  );
}
function customModelsFailureMessage(
  op: 'refresh' | 'save' | 'delete' | 'import',
  error: unknown,
): string {
  if (isConflictError(error)) {
    return CUSTOM_MODELS_CONFLICT_MESSAGE;
  }
  return daemonFailureMessage(
    error,
    op === 'refresh'
      ? CUSTOM_MODELS_LOAD_FAILED_MESSAGE
      : op === 'import'
        ? CUSTOM_MODELS_IMPORT_FAILED_MESSAGE
        : op === 'save'
          ? CUSTOM_MODELS_SAVE_FAILED_MESSAGE
          : CUSTOM_MODELS_DELETE_FAILED_MESSAGE,
    CUSTOM_MODELS_NOT_LOGGED_IN_MESSAGE,
  );
}
function isConflictError(error: unknown): boolean {
  return (
    (error instanceof CustomModelImportFailure && error.conflict) ||
    (error instanceof Error && error.message.includes('changed on disk'))
  );
}
class CustomModelImportFailure extends Error {
  constructor(
    readonly models: readonly DaemonCustomModelRow[],
    readonly conflict: boolean,
  ) {
    super('custom-model-import-failed');
  }
}
function requireMutationSuccess<
  T extends {
    readonly success: boolean;
    readonly models: DaemonCustomModelRow[];
  },
>(result: T): T {
  if (!result.success) {
    throw new Error('custom-model-operation-unsuccessful');
  }
  return result;
}
function isSameCustomModelGroup(
  row: DaemonCustomModelRow,
  message: CustomModelsImportMessage,
): boolean {
  const incomingKey = message.apiKey;
  const credentialMatches =
    incomingKey === undefined
      ? !row.hasApiKey
      : row.hasApiKey &&
        row.apiKeyMask !== undefined &&
        incomingKey.length >= 4 &&
        row.apiKeyMask.endsWith(incomingKey.slice(-4));
  return (
    row.provider === message.provider &&
    sameProviderEndpoint(row.baseUrl, message.baseUrl) &&
    (row.maxOutputTokens ?? null) === message.maxOutputTokens &&
    (row.noImageSupport === true) === message.noImageSupport &&
    credentialMatches
  );
}
function emitCustomModels(
  ctl: CustomModelsHost,
  sessionId: string,
  customModels: CustomModelsState,
): void {
  ctl.emit({
    type: 'customModels.state',
    sessionId,
    customModels,
  });
}
function emitCustomModelDiscovery(
  ctl: CustomModelsHost,
  sessionId: string,
  discovery: CustomModelDiscoveryState,
): void {
  ctl.emit({ type: 'customModels.discovery', sessionId, discovery });
}
function discoveryFailureClass(error: unknown): string {
  return error instanceof ModelDiscoveryError
    ? error.status === undefined
      ? error.kind
      : `${error.kind}:${error.status}`
    : 'request-failed';
}
function discoveryFailureMessage(error: unknown): string {
  if (error instanceof ModelDiscoveryError) {
    if (error.kind === 'http' && (error.status === 401 || error.status === 403)) {
      return 'The provider rejected this key. Check the site, base URL, and key.';
    }
    if (error.kind === 'http' && error.status === 404) {
      return 'No model catalog was found at this base URL.';
    }
    if (error.kind === 'timed-out') {
      return 'The provider took too long to return its model catalog.';
    }
    if (error.kind === 'invalid-response' || error.kind === 'response-too-large') {
      return 'The provider returned an unsupported model catalog.';
    }
  }
  return 'Could not fetch models from this provider. Check the site and retry.';
}
export function projectCustomModelItems(
  rows: readonly DaemonCustomModelRow[],
): CustomModelListItem[] {
  const items: CustomModelListItem[] = [];
  const rawIndices = new Set<number>();
  for (const row of rows) {
    if (
      items.length >= MAX_MODEL_CATALOG_ITEMS ||
      !Number.isSafeInteger(row.rawIndex) ||
      row.rawIndex < 0 ||
      row.rawIndex >= MAX_MODEL_CATALOG_ITEMS ||
      rawIndices.has(row.rawIndex) ||
      !isSafeModelId(row.model) ||
      !isSafeCustomModelText(row.provider, MAX_CUSTOM_MODEL_PROVIDER_LENGTH) ||
      (row.displayName !== undefined && !isSafeDisplayName(row.displayName)) ||
      (row.baseUrl !== undefined &&
        !isSafeCustomModelText(row.baseUrl, MAX_CUSTOM_MODEL_URL_LENGTH)) ||
      (row.apiKeyMask !== undefined &&
        !isSafeCustomModelText(row.apiKeyMask, MAX_CUSTOM_MODEL_MASK_LENGTH)) ||
      (row.maxOutputTokens !== undefined &&
        !(Number.isSafeInteger(row.maxOutputTokens) && row.maxOutputTokens >= 0))
    ) {
      continue;
    }
    rawIndices.add(row.rawIndex);
    items.push({
      rawIndex: row.rawIndex,
      model: row.model,
      ...(row.displayName === undefined ? {} : { displayName: row.displayName }),
      provider: row.provider,
      ...(row.baseUrl === undefined ? {} : { baseUrl: row.baseUrl }),
      hasApiKey: row.hasApiKey === true,
      ...(row.apiKeyMask === undefined ? {} : { apiKeyMask: row.apiKeyMask }),
      ...(row.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: row.maxOutputTokens }),
      ...(row.noImageSupport === undefined
        ? {}
        : { noImageSupport: row.noImageSupport === true }),
      hasBedrockConfig: row.hasBedrockConfig === true,
      isValid: row.isValid === true,
    });
  }
  return items;
}
