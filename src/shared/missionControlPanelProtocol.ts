import {
  MISSION_LIFECYCLES,
  type MissionLifecycle,
} from './missionProtocol';
import {
  MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH,
  WEBVIEW_DIAGNOSTIC_KINDS,
  type WebviewDiagnosticMessage,
} from './bridgeMessages';
import { isSafePresentationText } from './presentationSafety';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from './strictValidation';
import {
  parseMissionControlSetupHostMessage,
  parseMissionControlSetupWebviewMessage,
  type MissionControlSetupContinueMessage,
  type MissionControlSetupSnapshotMessage,
  type MissionControlSetupUpdateMessage,
} from './missionControlSetupProtocol';
export { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from './missionControlProtocolVersion';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from './missionControlProtocolVersion';

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

export interface MissionControlReadyMessage {
  readonly type: 'missionControl.ready';
  readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
}

export type MissionControlNavigateMessage =
  | {
      readonly type: 'missionControl.navigate';
      readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
      readonly requestId: string;
      readonly route: 'catalog' | 'new-mission';
    }
  | {
      readonly type: 'missionControl.navigate';
      readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
      readonly requestId: string;
      readonly route: 'detail';
      readonly catalogId: string;
    };

export type MissionControlPanelWebviewMessage =
  | MissionControlReadyMessage
  | MissionControlCatalogRequest
  | MissionControlNavigateMessage
  | MissionControlSetupUpdateMessage
  | MissionControlSetupContinueMessage
  | WebviewDiagnosticMessage;

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
  | MissionControlCatalogErrorResult
  | MissionControlSetupSnapshotMessage
  | {
      readonly type: 'missionControl.theme';
      readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
      readonly preference: 'auto' | 'light' | 'dark';
      readonly resolved: 'light' | 'dark';
    }
  | {
      readonly type: 'missionControl.route';
      readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
      readonly route: 'catalog' | 'new-mission';
    }
  | {
      readonly type: 'missionControl.route';
      readonly protocolVersion: typeof MISSION_CONTROL_PANEL_PROTOCOL_VERSION;
      readonly route: 'detail';
      readonly catalogId: string;
    };

const LIFECYCLE_SET = new Set<string>(MISSION_LIFECYCLES);
const FILTER_SET = new Set<string>(MISSION_CONTROL_CATALOG_FILTERS);

export function parseMissionControlPanelWebviewMessage(
  value: unknown,
): MissionControlPanelWebviewMessage | undefined {
  const setup = parseMissionControlSetupWebviewMessage(value);
  if (setup !== undefined) {
    return setup;
  }
  if (
    isStrictRecord(value) &&
    value.type === 'webview.diagnostic' &&
    hasExactKeys(value, ['type', 'kind', 'detail']) &&
    typeof value.kind === 'string' &&
    (WEBVIEW_DIAGNOSTIC_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.detail === 'string' &&
    value.detail.length <= MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH
  ) {
    return {
      type: 'webview.diagnostic',
      kind: value.kind as WebviewDiagnosticMessage['kind'],
      detail: value.detail,
    };
  }
  if (
    isStrictRecord(value) &&
    value.type === 'missionControl.navigate' &&
    value.protocolVersion === MISSION_CONTROL_PANEL_PROTOCOL_VERSION &&
    isRequestId(value.requestId)
  ) {
    if (
      (value.route === 'catalog' || value.route === 'new-mission') &&
      hasExactKeys(value, ['type', 'protocolVersion', 'requestId', 'route'])
    ) {
      return {
        type: 'missionControl.navigate',
        protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        requestId: value.requestId,
        route: value.route,
      };
    }
    if (
      value.route === 'detail' &&
      hasExactKeys(value, [
        'type',
        'protocolVersion',
        'requestId',
        'route',
        'catalogId',
      ]) &&
      isCatalogId(value.catalogId)
    ) {
      return {
        type: 'missionControl.navigate',
        protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
        requestId: value.requestId,
        route: 'detail',
        catalogId: value.catalogId,
      };
    }
    return undefined;
  }
  if (
    isStrictRecord(value) &&
    hasExactKeys(value, ['type', 'protocolVersion']) &&
    value.type === 'missionControl.ready' &&
    value.protocolVersion === MISSION_CONTROL_PANEL_PROTOCOL_VERSION
  ) {
    return {
      type: 'missionControl.ready',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    };
  }
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
  const setup = parseMissionControlSetupHostMessage(value);
  if (setup !== undefined) {
    return setup;
  }
  if (
    isStrictRecord(value) &&
    hasExactKeys(value, ['type', 'protocolVersion', 'route']) &&
    value.type === 'missionControl.route' &&
    value.protocolVersion === MISSION_CONTROL_PANEL_PROTOCOL_VERSION &&
    (value.route === 'catalog' || value.route === 'new-mission')
  ) {
    return {
      type: 'missionControl.route',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      route: value.route,
    };
  }
  if (
    isStrictRecord(value) &&
    hasExactKeys(value, ['type', 'protocolVersion', 'route', 'catalogId']) &&
    value.type === 'missionControl.route' &&
    value.protocolVersion === MISSION_CONTROL_PANEL_PROTOCOL_VERSION &&
    value.route === 'detail' &&
    isCatalogId(value.catalogId)
  ) {
    return {
      type: 'missionControl.route',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      route: 'detail',
      catalogId: value.catalogId,
    };
  }
  if (
    isStrictRecord(value) &&
    hasExactKeys(value, [
      'type',
      'protocolVersion',
      'preference',
      'resolved',
    ]) &&
    value.type === 'missionControl.theme' &&
    value.protocolVersion === MISSION_CONTROL_PANEL_PROTOCOL_VERSION &&
    (value.preference === 'auto' ||
      value.preference === 'light' ||
      value.preference === 'dark') &&
    (value.resolved === 'light' || value.resolved === 'dark')
  ) {
    return {
      type: 'missionControl.theme',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      preference: value.preference,
      resolved: value.resolved,
    };
  }
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
