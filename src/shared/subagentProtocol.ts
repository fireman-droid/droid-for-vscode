import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import { hasExactKeys } from './strictValidation';

/**
 * Inline Subagent-card activity contract. The child session id never
 * crosses the bridge; the webview addresses rows only by the parent
 * Task's opaque toolUseId.
 */
export const MAX_SUBAGENT_ACTIVITY_LENGTH = 64;

export interface SubagentPanelMessage {
  readonly type: 'subagent.panel';
  readonly sessionId: string;
  readonly open: boolean;
}

export interface SubagentActivityMessage {
  readonly type: 'subagent.activity';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly action: string | null;
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

export function parseSubagentWebviewMessage(
  value: unknown,
): SubagentPanelMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'subagent.panel' ||
    !hasExactKeys(value, ['type', 'sessionId', 'open']) ||
    !isId(value.sessionId) ||
    typeof value.open !== 'boolean'
  ) {
    return null;
  }
  return {
    type: value.type,
    sessionId: value.sessionId,
    open: value.open,
  };
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
      'action',
    ]) ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isId(value.toolUseId) ||
    (value.action !== null &&
      (typeof value.action !== 'string' ||
        value.action.length === 0 ||
        value.action.length > MAX_SUBAGENT_ACTIVITY_LENGTH ||
        value.action.trim() !== value.action ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(value.action)))
  ) {
    return null;
  }
  return {
    type: value.type,
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    toolUseId: value.toolUseId,
    action: value.action,
  };
}
