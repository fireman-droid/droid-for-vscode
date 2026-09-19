import {
  SESSION_VIEWER_PROTOCOL_VERSION,
  type SessionViewerWebviewMessage,
} from '../../../shared/protocol/sessionViewerProtocol';
import { isStrictRecord } from '../../../shared/validation/strictValidation';

const MAX_DIAGNOSTIC_DETAIL = 2_048;
const MAX_DIAGNOSTIC_KIND = 64;

export function parseSessionViewerWebviewMessage(
  value: unknown,
): SessionViewerWebviewMessage | null {
  if (!isStrictRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (
    (value.type === 'sessionViewer.ready' || value.type === 'sessionViewer.stop') &&
    Object.keys(value).length === 2 &&
    value.protocolVersion === SESSION_VIEWER_PROTOCOL_VERSION
  ) {
    return {
      type: value.type,
      protocolVersion: value.protocolVersion,
    };
  }
  if (
    value.type === 'webview.diagnostic' &&
    Object.keys(value).length === 3 &&
    typeof value.kind === 'string' &&
    value.kind.length > 0 &&
    value.kind.length <= MAX_DIAGNOSTIC_KIND &&
    typeof value.detail === 'string' &&
    value.detail.length <= MAX_DIAGNOSTIC_DETAIL
  ) {
    return {
      type: value.type,
      kind: value.kind,
      detail: value.detail,
    };
  }
  return null;
}
