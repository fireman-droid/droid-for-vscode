import {
  MAX_SESSION_VIEWER_REASON_LENGTH,
  MAX_SESSION_VIEWER_TITLE_LENGTH,
  SESSION_VIEWER_PROTOCOL_VERSION,
  SESSION_VIEWER_TARGET_KINDS,
  type SessionViewerHostMessage,
  type SessionViewerTarget,
} from '../../shared/sessionViewerProtocol';
import { MAX_BRIDGE_ID_LENGTH } from '../../shared/interactionProtocol';
import { hasExactKeys, isStrictRecord } from '../../shared/strictValidation';
import { parseSessionTranscript } from '../bridge/validateHostMessage';

export function parseSessionViewerHostMessage(
  value: unknown,
): SessionViewerHostMessage | null {
  if (!isStrictRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (value.type === 'sessionViewer.theme') {
    if (
      !hasExactKeys(value, ['type', 'preference', 'resolved']) ||
      (value.preference !== 'auto' &&
        value.preference !== 'light' &&
        value.preference !== 'dark') ||
      (value.resolved !== 'light' && value.resolved !== 'dark')
    ) {
      return null;
    }
    return {
      type: value.type,
      preference: value.preference,
      resolved: value.resolved,
    };
  }
  if (
    value.type !== 'sessionViewer.snapshot' ||
    value.protocolVersion !== SESSION_VIEWER_PROTOCOL_VERSION ||
    typeof value.status !== 'string'
  ) {
    return null;
  }
  const target = parseTarget(value.target);
  if (
    target === null ||
    typeof value.running !== 'boolean' ||
    typeof value.stopping !== 'boolean' ||
    typeof value.stopError !== 'boolean'
  ) {
    return null;
  }
  if (value.status === 'unavailable') {
    if (
      !hasExactKeys(value, [
        'type',
        'protocolVersion',
        'status',
        'target',
        'reason',
        'running',
        'stopping',
        'stopError',
      ]) ||
      !isDisplayText(value.reason, MAX_SESSION_VIEWER_REASON_LENGTH)
    ) {
      return null;
    }
    return {
      type: value.type,
      protocolVersion: value.protocolVersion,
      status: value.status,
      target,
      reason: value.reason,
      running: value.running,
      stopping: value.stopping,
      stopError: value.stopError,
    };
  }
  if (
    value.status !== 'ready' ||
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'status',
      'target',
      'items',
      'truncated',
      'running',
      'stopping',
      'stopError',
    ]) ||
    typeof value.truncated !== 'boolean'
  ) {
    return null;
  }
  const items = parseSessionTranscript(value.items);
  if (items === undefined) {
    return null;
  }
  return {
    type: value.type,
    protocolVersion: value.protocolVersion,
    status: value.status,
    target,
    items,
    truncated: value.truncated,
    running: value.running,
    stopping: value.stopping,
    stopError: value.stopError,
  };
}

function parseTarget(value: unknown): SessionViewerTarget | null {
  if (
    !isStrictRecord(value) ||
    typeof value.kind !== 'string' ||
    !(SESSION_VIEWER_TARGET_KINDS as readonly string[]).includes(value.kind) ||
    (value.mode !== 'standard' && value.mode !== 'mission-readonly') ||
    !isDisplayText(value.title, MAX_SESSION_VIEWER_TITLE_LENGTH)
  ) {
    return null;
  }
  if (value.mode === 'mission-readonly') {
    return hasExactKeys(value, ['kind', 'mode', 'title'])
      ? {
          kind: value.kind as SessionViewerTarget['kind'],
          mode: value.mode,
          title: value.title,
        }
      : null;
  }
  return hasExactKeys(value, ['kind', 'mode', 'sessionId', 'title']) &&
    isDisplayText(value.sessionId, MAX_BRIDGE_ID_LENGTH)
    ? {
        kind: value.kind as SessionViewerTarget['kind'],
        mode: value.mode,
        sessionId: value.sessionId,
        title: value.title,
      }
    : null;
}

function isDisplayText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}
