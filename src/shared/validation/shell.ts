import { BRIDGE_PROTOCOL_VERSION } from '../bridgeMessages';
import {
  MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH,
  THEME_PREFERENCES,
  WEBVIEW_DIAGNOSTIC_KINDS,
} from '../protocol/bounds';
import {
  type ThemePreference,
  type UiThemeSetMessage,
  type WebviewReadyMessage,
  type WebviewStateAppliedMessage,
} from '../protocol/shell';
import {
  type WebviewDiagnosticKind,
  type WebviewDiagnosticMessage,
} from '../protocol/transcript';
import { hasExactKeys, isExactArray, type UnknownRecord } from './strictValidation';
import { isId } from './guards';

export function parseWebviewReady(value: UnknownRecord): WebviewReadyMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'protocolVersion'], ['pageId']) ||
    (value.pageId !== undefined && !isId(value.pageId)) ||
    value.protocolVersion !== BRIDGE_PROTOCOL_VERSION
  ) {
    return undefined;
  }

  return {
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    ...(value.pageId === undefined ? {} : { pageId: value.pageId as string }),
  };
}

export function parseWebviewStateApplied(value: UnknownRecord): WebviewStateAppliedMessage | undefined {
  const sequence = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  if (!hasExactKeys(value, ['type', 'pageId', 'sequences', 'snapshotSequence']) ||
      !isId(value.pageId) || !isExactArray(value.sequences, 1, 256) ||
      !value.sequences.every(sequence) ||
      !(value.snapshotSequence === null || (sequence(value.snapshotSequence) && value.sequences.includes(value.snapshotSequence)))) return undefined;
  return { type: 'webview.state-applied', pageId: value.pageId, sequences: value.sequences,
    snapshotSequence: value.snapshotSequence };
}

export function parseWebviewDiagnostic(
  value: UnknownRecord,
): WebviewDiagnosticMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'kind', 'detail']) ||
    typeof value.kind !== 'string' ||
    !(WEBVIEW_DIAGNOSTIC_KINDS as readonly string[]).includes(value.kind) ||
    typeof value.detail !== 'string' ||
    value.detail.length > MAX_WEBVIEW_DIAGNOSTIC_DETAIL_LENGTH
  ) {
    return undefined;
  }

  return {
    type: 'webview.diagnostic',
    kind: value.kind as WebviewDiagnosticKind,
    detail: value.detail,
  };
}

export function parseUiThemeSet(value: UnknownRecord): UiThemeSetMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'preference']) ||
    typeof value.preference !== 'string' ||
    !(THEME_PREFERENCES as readonly string[]).includes(value.preference)
  ) {
    return undefined;
  }

  return {
    type: 'ui.theme.set',
    preference: value.preference as ThemePreference,
  };
}
