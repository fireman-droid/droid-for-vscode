import type { SessionTranscriptItem } from './transcript';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isId } from '../validation/guards';

export type HistoryDirection = 'older' | 'newer' | 'latest';

/** A bounded reading window, separate from the live transcript tail. */
export interface HistoryWindowState {
  readonly tailAnchor?: string;
  readonly version: string;
  readonly revision: number;
  readonly items: readonly SessionTranscriptItem[];
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
  readonly loading: HistoryDirection | null;
  readonly error: string | null;
  readonly truncated: boolean;
}

export interface HistoryNavigateMessage {
  readonly type: 'history.navigate';
  readonly sessionId: string;
  readonly version: string;
  readonly revision: number;
  readonly direction: HistoryDirection;
}

export interface HistoryWindowMessage {
  readonly type: 'history.window';
  readonly sequence: number;
  readonly sessionId: string;
  readonly history: HistoryWindowState;
}

export function parseHistoryNavigate(value: unknown): HistoryNavigateMessage | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'sessionId', 'version', 'revision', 'direction']) ||
    value.type !== 'history.navigate' || !isId(value.sessionId) || !isId(value.version) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    !isHistoryDirection(value.direction)) return undefined;
  return { type: 'history.navigate', sessionId: value.sessionId, version: value.version,
    revision: value.revision as number, direction: value.direction };
}

export function isHistoryDirection(value: unknown): value is HistoryDirection {
  return value === 'older' || value === 'newer' || value === 'latest';
}
