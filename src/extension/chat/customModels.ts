// customModels: BYOK custom-model management through the daemon
// sidecar (docs/product/byok-add-model-design.md; RPC behavior probed
// in artifacts/probe-custom-models-daemon.mjs, 2026-08-13).
//
// Credential red line: the `apiKey` plaintext lives exactly as long as
// one save message -> upsert params handoff. It is never stored on the
// controller, never echoed into any emitted state, and never logged —
// save/delete events record only `{ model, provider, hasApiKey }`.
import {
  MAX_CUSTOM_MODEL_MASK_LENGTH,
  MAX_CUSTOM_MODEL_PROVIDER_LENGTH,
  MAX_CUSTOM_MODEL_URL_LENGTH,
  type CustomModelDeleteMessage,
  type CustomModelListItem,
  type CustomModelSaveMessage,
  type CustomModelsRefreshMessage,
  type CustomModelsState,
} from '../../shared/customModelsProtocol';
import { MAX_MODEL_CATALOG_ITEMS } from '../../shared/bridgeMessages';
import {
  isSafeDisplayName,
  isSafeModelId,
} from '../../shared/validateMessage';
import { startReplacement } from './runtimeLifecycle';
import {
  daemonFailureMessage,
  formatUnknownError,
  isTurnActive,
  type ChatControllerInternals,
} from './internals';

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

/**
 * Copy for the daemon's optimistic-concurrency rejection (probed
 * error: "Custom models changed on disk; refresh and try again").
 */
export const CUSTOM_MODELS_CONFLICT_MESSAGE =
  'Custom models changed outside this panel. Review the refreshed list and retry.';

export const CUSTOM_MODELS_BUSY_MESSAGE =
  'Another custom-model operation is still running. Retry in a moment.';

/**
 * One list row as the daemon returns it (already key-scrubbed:
 * `hasApiKey`/`apiKeyMask` only, never plaintext). Structurally
 * matches the SDK's `DaemonListCustomModelsResult['models'][number]`.
 */
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

/**
 * Daemon custom-models RPC surface; structurally satisfied by the
 * SDK's `ConnectedDroid['customModels']` resource, so extension.ts
 * wires `droid.customModels` straight through.
 */
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

/**
 * The two controller members this module owns: the lazily acquired
 * daemon gateway (wired in extension.ts next to `daemonPlugins`) and
 * the one-at-a-time in-flight flag. Declared as an explicit slot type
 * so the module compiles against the full dependency surface;
 * ChatController carries both members.
 */
export interface CustomModelsHostSlots {
  daemonCustomModels?: () => Promise<CustomModelsGateway>;
  customModelsOp: boolean;
}

export type CustomModelsHost = ChatControllerInternals &
  CustomModelsHostSlots;

/** Single dispatch entry so ChatController grows one case group. */
export function dispatchCustomModels(
  ctl: CustomModelsHost,
  message:
    | CustomModelsRefreshMessage
    | CustomModelSaveMessage
    | CustomModelDeleteMessage,
): void {
  if (message.type === 'customModels.refresh') {
    handleCustomModelsRefresh(ctl, message.sessionId);
  } else if (message.type === 'customModels.save') {
    handleCustomModelSave(ctl, message);
  } else {
    handleCustomModelDelete(ctl, message);
  }
}

export function handleCustomModelsRefresh(
  ctl: CustomModelsHost,
  sessionId: string,
): void {
  const gateway = beginCustomModelsRequest(
    ctl,
    'customModels.refresh',
    sessionId,
  );
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
  const gateway = beginCustomModelsRequest(
    ctl,
    'customModels.save',
    message.sessionId,
  );
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
    // Single handoff: the plaintext key moves from the validated
    // message into the RPC params and nowhere else.
    resource.upsert({
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
      ...(message.apiKey === undefined
        ? {}
        : { apiKey: message.apiKey }),
      maxOutputTokens: message.maxOutputTokens,
      noImageSupport: message.noImageSupport,
    }),
  );
}

export function handleCustomModelDelete(
  ctl: CustomModelsHost,
  message: CustomModelDeleteMessage,
): void {
  const { sessionId, rawIndex, expectedModel } = message;
  const gateway = beginCustomModelsRequest(
    ctl,
    'customModels.delete',
    sessionId,
  );
  if (gateway === null) {
    return;
  }
  ctl.recordHost({
    level: 'info',
    name: 'host.customModels.delete',
    attributes: { model: expectedModel, rawIndex },
  });
  runCustomModelsOperation(ctl, sessionId, 'delete', (resource) =>
    resource.delete({ rawIndex, expectedModel }),
  );
}

/**
 * Shared guard chain for the three panel requests. Returns the
 * gateway provider when the request may proceed, null after emitting
 * the appropriate drop/unavailable/busy signal — a dropped save or
 * delete must never look like a success.
 */
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
  if (ctl.customModelsOp) {
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

/**
 * Runs one daemon round-trip and broadcasts the resulting masked
 * list. Every RPC (list/upsert/delete) answers with the fresh models
 * array, so success paths never need a second read. Raw daemon errors
 * stay host-side; the Bridge carries fixed copy only.
 */
function runCustomModelsOperation(
  ctl: CustomModelsHost,
  sessionId: string,
  op: 'refresh' | 'save' | 'delete',
  operation: (
    resource: CustomModelsGateway,
  ) => Promise<{ models: DaemonCustomModelRow[] }>,
): void {
  const runtime = ctl.runtime!;
  const generation = ctl.runtimeGeneration;
  const cwd = ctl.activeRuntimeCwd!;
  ctl.customModelsOp = true;
  emitCustomModels(ctl, sessionId, { status: 'loading', items: [] });
  void ctl
    .daemonCustomModels!()
    .then((resource) => operation(resource))
    .then(
      (result) => {
        ctl.customModelsOp = false;
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
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
        ctl.customModelsOp = false;
        recordCustomModelsFailure(ctl, op, error);
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        emitCustomModels(ctl, sessionId, {
          status: 'error',
          items: [],
          message: customModelsFailureMessage(op, error),
        });
        // The concurrency guard fired because the file changed under
        // us; converge the panel on the daemon's current truth.
        if (op !== 'refresh' && isConflictError(error)) {
          handleCustomModelsRefresh(ctl, sessionId);
        }
      },
    );
}

/**
 * Makes a saved or deleted model immediately selectable: the model
 * catalog is captured per session load (initialize/load_session), so
 * reload the active session in place when nothing would be lost.
 * Busy sessions skip quietly — the panel copy explains that models
 * appear with the next session (re)load.
 */
function reloadSessionCatalogWhenIdle(
  ctl: CustomModelsHost,
  sessionId: string,
  cwd: string,
): void {
  if (
    ctl.sessionId !== sessionId ||
    ctl.connection.status !== 'connected' ||
    isTurnActive(ctl.turn) ||
    ctl.interactions.hasPending() ||
    ctl.sessionOperationInProgress ||
    ctl.refreshInProgress ||
    ctl.settingsUpdate !== null ||
    ctl.queuedPrompts.items.length > 0
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
  startReplacement(ctl, { kind: 'resume', cwd, sessionId });
}

/**
 * Failure logging honoring the credential red line: list failures may
 * carry the raw error (no key was in flight and LocalDiagnostics
 * scrubs assignments anyway); save/delete failures log a fixed
 * classification only, because upstream validation errors could echo
 * request params.
 */
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
  op: 'refresh' | 'save' | 'delete',
  error: unknown,
): string {
  if (isConflictError(error)) {
    return CUSTOM_MODELS_CONFLICT_MESSAGE;
  }
  return daemonFailureMessage(
    error,
    op === 'refresh'
      ? CUSTOM_MODELS_LOAD_FAILED_MESSAGE
      : op === 'save'
        ? CUSTOM_MODELS_SAVE_FAILED_MESSAGE
        : CUSTOM_MODELS_DELETE_FAILED_MESSAGE,
    CUSTOM_MODELS_NOT_LOGGED_IN_MESSAGE,
  );
}

/** Matches the daemon's optimistic-concurrency rejection (probed). */
function isConflictError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('changed on disk')
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

/**
 * Projects daemon rows into bounded Bridge items. Rows violating the
 * contract (unsafe strings, duplicate rawIndex) are dropped, never
 * displayed with invented values (fail closed); the cap mirrors the
 * model catalog bound.
 */
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
      !isSafeBoundedText(
        row.provider,
        MAX_CUSTOM_MODEL_PROVIDER_LENGTH,
      ) ||
      (row.displayName !== undefined &&
        !isSafeDisplayName(row.displayName)) ||
      (row.baseUrl !== undefined &&
        !isSafeBoundedText(row.baseUrl, MAX_CUSTOM_MODEL_URL_LENGTH)) ||
      (row.apiKeyMask !== undefined &&
        !isSafeBoundedText(
          row.apiKeyMask,
          MAX_CUSTOM_MODEL_MASK_LENGTH,
        )) ||
      (row.maxOutputTokens !== undefined &&
        !(
          Number.isSafeInteger(row.maxOutputTokens) &&
          row.maxOutputTokens >= 0
        ))
    ) {
      continue;
    }
    rawIndices.add(row.rawIndex);
    items.push({
      rawIndex: row.rawIndex,
      model: row.model,
      ...(row.displayName === undefined
        ? {}
        : { displayName: row.displayName }),
      provider: row.provider,
      ...(row.baseUrl === undefined ? {} : { baseUrl: row.baseUrl }),
      hasApiKey: row.hasApiKey === true,
      ...(row.apiKeyMask === undefined
        ? {}
        : { apiKeyMask: row.apiKeyMask }),
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

function isSafeBoundedText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}
