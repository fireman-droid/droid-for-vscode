import {
  MISSION_LIFECYCLES,
  type MissionLifecycle,
} from './missionProtocol';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from './strictValidation';

export const MISSION_CONTROL_PANEL_PROTOCOL_VERSION = 1 as const;
export const MAX_MISSION_CONTROL_CATALOG_ROWS = 10_000;
export const MAX_MISSION_CONTROL_CATALOG_ID_LENGTH = 160;
export const MAX_MISSION_CONTROL_REQUEST_ID_LENGTH = 128;
export const MAX_MISSION_CONTROL_TITLE_LENGTH = 256;
export const MAX_MISSION_CONTROL_LABEL_LENGTH = 128;
export const MAX_MISSION_CONTROL_FEATURE_COUNT = 10_000;
export const MAX_MISSION_CONTROL_ERROR_LENGTH = 256;

export const MISSION_CONTROL_CATALOG_FILTERS = [
  'all',
  'running',
  'paused',
  'completed',
] as const;
export type MissionControlCatalogFilter =
  (typeof MISSION_CONTROL_CATALOG_FILTERS)[number];

export interface MissionControlCatalogRow {
  /** Opaque Host correlation value. It is never presentation text. */
  readonly catalogId: string;
  readonly title: string;
  readonly lifecycle: MissionLifecycle;
  readonly workspaceLabel: string;
  readonly computerLabel: string;
  readonly progress: {
    readonly completed: number;
    readonly total: number;
  } | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly elapsedMs: number | null;
  readonly attached: boolean;
}

export interface MissionControlCatalogRequest {
  readonly type: 'missionControl.catalog.request';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly filter: MissionControlCatalogFilter;
}

export type MissionControlPanelWebviewMessage = MissionControlCatalogRequest;

export interface MissionControlCatalogReadyResult {
  readonly type: 'missionControl.catalog.result';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly requestId: string;
  readonly status: 'ready';
  readonly revision: number;
  readonly filter: MissionControlCatalogFilter;
  readonly rows: readonly MissionControlCatalogRow[];
}

export interface MissionControlCatalogErrorResult {
  readonly type: 'missionControl.catalog.result';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly requestId: string;
  readonly status: 'error';
  readonly revision: number;
  readonly filter: MissionControlCatalogFilter;
  readonly error: {
    readonly code: 'incomplete-list' | 'invalid-data' | 'unavailable';
    readonly message: string;
    readonly retryable: boolean;
  };
}

export type MissionControlPanelHostMessage =
  | MissionControlCatalogReadyResult
  | MissionControlCatalogErrorResult;

const LIFECYCLE_SET = new Set<string>(MISSION_LIFECYCLES);
const FILTER_SET = new Set<string>(MISSION_CONTROL_CATALOG_FILTERS);

export function parseMissionControlPanelWebviewMessage(
  value: unknown,
): MissionControlPanelWebviewMessage | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['type', 'protocolVersion', 'requestId', 'filter']) ||
    value.type !== 'missionControl.catalog.request' ||
    value.protocolVersion !== MISSION_CONTROL_PANEL_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    !isCatalogFilter(value.filter)
  ) {
    return undefined;
  }
  return {
    type: 'missionControl.catalog.request',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId: value.requestId,
    filter: value.filter,
  };
}

export function parseMissionControlPanelHostMessage(
  value: unknown,
): MissionControlPanelHostMessage | undefined {
  if (
    !isStrictRecord(value) ||
    value.type !== 'missionControl.catalog.result' ||
    value.protocolVersion !== MISSION_CONTROL_PANEL_PROTOCOL_VERSION ||
    !isRevision(value.sequence) ||
    !isRequestId(value.requestId) ||
    !isRevision(value.revision) ||
    !isCatalogFilter(value.filter)
  ) {
    return undefined;
  }
  if (value.status === 'ready') {
    return parseReadyResult(value);
  }
  if (value.status === 'error') {
    return parseErrorResult(value);
  }
  return undefined;
}

function parseReadyResult(
  value: UnknownRecord,
): MissionControlCatalogReadyResult | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'sequence',
      'requestId',
      'status',
      'revision',
      'filter',
      'rows',
    ]) ||
    !isExactArray(value.rows, 0, MAX_MISSION_CONTROL_CATALOG_ROWS)
  ) {
    return undefined;
  }
  const rows: MissionControlCatalogRow[] = [];
  const identities = new Set<string>();
  for (const candidate of value.rows) {
    const row = parseCatalogRow(candidate);
    if (row === undefined || identities.has(row.catalogId)) {
      return undefined;
    }
    identities.add(row.catalogId);
    rows.push(row);
  }
  return {
    type: 'missionControl.catalog.result',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    sequence: value.sequence as number,
    requestId: value.requestId as string,
    status: 'ready',
    revision: value.revision as number,
    filter: value.filter as MissionControlCatalogFilter,
    rows,
  };
}

function parseErrorResult(
  value: UnknownRecord,
): MissionControlCatalogErrorResult | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'sequence',
      'requestId',
      'status',
      'revision',
      'filter',
      'error',
    ]) ||
    !isStrictRecord(value.error) ||
    !hasExactKeys(value.error, ['code', 'message', 'retryable']) ||
    (value.error.code !== 'incomplete-list' &&
      value.error.code !== 'invalid-data' &&
      value.error.code !== 'unavailable') ||
    !isSafePresentationText(
      value.error.message,
      MAX_MISSION_CONTROL_ERROR_LENGTH,
    ) ||
    typeof value.error.retryable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    type: 'missionControl.catalog.result',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    sequence: value.sequence as number,
    requestId: value.requestId as string,
    status: 'error',
    revision: value.revision as number,
    filter: value.filter as MissionControlCatalogFilter,
    error: {
      code: value.error.code,
      message: value.error.message,
      retryable: value.error.retryable,
    },
  };
}

function parseCatalogRow(value: unknown): MissionControlCatalogRow | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'catalogId',
      'title',
      'lifecycle',
      'workspaceLabel',
      'computerLabel',
      'progress',
      'createdAt',
      'updatedAt',
      'elapsedMs',
      'attached',
    ]) ||
    !isCatalogId(value.catalogId) ||
    !isSafePresentationText(value.title, MAX_MISSION_CONTROL_TITLE_LENGTH) ||
    typeof value.lifecycle !== 'string' ||
    !LIFECYCLE_SET.has(value.lifecycle) ||
    !isSafePresentationText(
      value.workspaceLabel,
      MAX_MISSION_CONTROL_LABEL_LENGTH,
    ) ||
    !isSafePresentationText(
      value.computerLabel,
      MAX_MISSION_CONTROL_LABEL_LENGTH,
    ) ||
    !isProgress(value.progress) ||
    !isNullableIsoDate(value.createdAt) ||
    !isNullableIsoDate(value.updatedAt) ||
    !isNullableNonNegativeInteger(value.elapsedMs) ||
    typeof value.attached !== 'boolean'
  ) {
    return undefined;
  }
  return {
    catalogId: value.catalogId,
    title: value.title,
    lifecycle: value.lifecycle as MissionLifecycle,
    workspaceLabel: value.workspaceLabel,
    computerLabel: value.computerLabel,
    progress:
      value.progress === null
        ? null
        : {
            completed: value.progress.completed as number,
            total: value.progress.total as number,
          },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    elapsedMs: value.elapsedMs,
    attached: value.attached,
  };
}

function isProgress(
  value: unknown,
): value is { readonly completed: number; readonly total: number } | null {
  return (
    value === null ||
    (isStrictRecord(value) &&
      hasExactKeys(value, ['completed', 'total']) &&
      isFeatureCount(value.completed) &&
      isFeatureCount(value.total) &&
      value.completed <= value.total)
  );
}

function isFeatureCount(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_MISSION_CONTROL_FEATURE_COUNT
  );
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== 'string' || value.length > 32) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MISSION_CONTROL_REQUEST_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isCatalogId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 'mission-'.length &&
    value.length <= MAX_MISSION_CONTROL_CATALOG_ID_LENGTH &&
    /^mission-[A-Za-z0-9_-]+$/.test(value)
  );
}

function isCatalogFilter(value: unknown): value is MissionControlCatalogFilter {
  return typeof value === 'string' && FILTER_SET.has(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafePresentationText(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value) &&
    !/(?:[A-Za-z]:[\\/]|\\\\|(?:^|\s)~?[\\/]|(?:^|\s)~[\\/])/.test(value) &&
    !/(?:https?|wss?|file):\/\//i.test(value)
  );
}
