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
} from '../protocol/shell';
import {
  type WebviewDiagnosticKind,
  type WebviewDiagnosticMessage,
} from '../protocol/transcript';
import { hasExactKeys, type UnknownRecord } from './strictValidation';

export function parseWebviewReady(value: UnknownRecord): WebviewReadyMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'protocolVersion']) ||
    value.protocolVersion !== BRIDGE_PROTOCOL_VERSION
  ) {
    return undefined;
  }

  return {
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
  };
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
