import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from '../validation/strictValidation';

/**
 * Inline Subagent-card activity contract. The child session id never
 * crosses the bridge; the webview addresses rows only by the parent
 * Task's opaque toolUseId.
 */
export const MAX_SUBAGENT_ACTIVITY_LENGTH = 64;
export const MAX_SUBAGENT_ACTIVITY_TARGET_LENGTH = 160;
export const MAX_SUBAGENT_ACTIVITIES = 4;

export interface SubagentActivityItem {
  readonly action: string;
  readonly target: string | null;
}

export interface SubagentPanelMessage {
  readonly type: 'subagent.panel';
  readonly sessionId: string;
  readonly open: boolean;
}

export interface SubagentOpenMessage {
  readonly type: 'subagent.open';
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
}

export interface SubagentOpenResultMessage extends Omit<SubagentOpenMessage, 'type'> {
  readonly type: 'subagent.open.result';
  readonly sequence: number;
  readonly status: 'opening' | 'opened' | 'unavailable' | 'failed';
}

export function parseSubagentOpenResultMessage(value: unknown): SubagentOpenResultMessage | null {
  if (!isRecord(value) || value.type !== 'subagent.open.result' ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'toolUseId', 'status']) ||
    !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
    !isId(value.sessionId) || !isId(value.turnId) || !isId(value.toolUseId) ||
    !['opening', 'opened', 'unavailable', 'failed'].includes(value.status as string)) return null;
  return value as unknown as SubagentOpenResultMessage;
}

export interface SubagentActivityMessage {
  readonly type: 'subagent.activity';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly activities: readonly SubagentActivityItem[];
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function isActivityItem(value: unknown): value is SubagentActivityItem {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['action', 'target']) &&
    isBoundedText(value.action, MAX_SUBAGENT_ACTIVITY_LENGTH) &&
    (value.target === null ||
      isBoundedText(value.target, MAX_SUBAGENT_ACTIVITY_TARGET_LENGTH))
  );
}

export function parseSubagentWebviewMessage(
  value: unknown,
): SubagentPanelMessage | SubagentOpenMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === 'subagent.panel') {
    return hasExactKeys(value, ['type', 'sessionId', 'open']) &&
      isId(value.sessionId) &&
      typeof value.open === 'boolean'
      ? {
          type: value.type,
          sessionId: value.sessionId,
          open: value.open,
        }
      : null;
  }
  if (value.type === 'subagent.open') {
    return hasExactKeys(value, ['type', 'sessionId', 'turnId', 'toolUseId']) &&
      isId(value.sessionId) &&
      isId(value.turnId) &&
      isId(value.toolUseId)
      ? {
          type: value.type,
          sessionId: value.sessionId,
          turnId: value.turnId,
          toolUseId: value.toolUseId,
        }
      : null;
  }
  return null;
}

export function parseSubagentActivityMessage(
  value: unknown,
): SubagentActivityMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'subagent.activity' ||
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'turnId',
      'toolUseId',
      'activities',
    ]) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId) ||
    !Array.isArray(value.activities) ||
    value.activities.length > MAX_SUBAGENT_ACTIVITIES ||
    !value.activities.every(isActivityItem)
  ) {
    return null;
  }
  return {
    type: value.type,
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    activities: value.activities,
  };
}
