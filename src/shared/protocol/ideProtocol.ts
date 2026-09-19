import { isId } from '../validation/guards';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export interface IdeState {
  readonly status: 'preparing' | 'prepared-unconfirmed' | 'unavailable' | 'reconnect-required' | 'reconnecting' | 'error';
  readonly canReconnect: boolean;
  readonly message: string;
}
export interface IdeReconnectMessage {
  readonly type: 'ide.reconnect';
  readonly sessionId: string;
}
export interface IdeRefreshMessage {
  readonly type: 'ide.refresh';
  readonly sessionId: string | null;
}
export interface HostIdeMessage {
  readonly type: 'host.ide';
  readonly sequence: number;
  readonly conversationId: string | null;
  readonly sessionId: string | null;
  readonly ide: IdeState;
}
export const UNAVAILABLE_IDE: IdeState = {
  status: 'unavailable', canReconnect: false, message: 'Native IDE integration is unavailable.',
};

export function parseIdeState(value: unknown): IdeState | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['status', 'canReconnect', 'message']) ||
      typeof value.status !== 'string' ||
      !['preparing', 'prepared-unconfirmed', 'unavailable', 'reconnect-required', 'reconnecting', 'error'].includes(value.status) ||
      typeof value.canReconnect !== 'boolean' || typeof value.message !== 'string' ||
      value.message.length > 500 || /[\u0000-\u001f\u007f]/u.test(value.message)) return undefined;
  return { status: value.status as IdeState['status'], canReconnect: value.canReconnect, message: value.message };
}

export function parseIdeRequest(value: unknown): IdeReconnectMessage | IdeRefreshMessage | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'sessionId'])) return undefined;
  if (value.type === 'ide.reconnect' && isId(value.sessionId)) return { type: value.type, sessionId: value.sessionId };
  if (value.type === 'ide.refresh' && (value.sessionId === null || isId(value.sessionId))) {
    return { type: value.type, sessionId: value.sessionId };
  }
  return undefined;
}

export function parseHostIde(value: unknown): HostIdeMessage | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'sequence', 'conversationId', 'sessionId', 'ide']) ||
      value.type !== 'host.ide' || typeof value.sequence !== 'number' ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
      (value.conversationId !== null && !isId(value.conversationId)) ||
      (value.sessionId !== null && !isId(value.sessionId)) ||
      (value.conversationId === null) !== (value.sessionId === null)) return undefined;
  const ide = parseIdeState(value.ide);
  return ide ? { type: value.type, sequence: value.sequence, conversationId: value.conversationId, sessionId: value.sessionId, ide } : undefined;
}
