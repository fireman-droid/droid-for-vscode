import type { HistoryWindowMessage, HistoryWindowState } from '../../../shared/protocol/historyPaging';
import { isHistoryDirection } from '../../../shared/protocol/historyPaging';
import { hasExactKeys, isStrictRecord, type UnknownRecord } from '../../../shared/validation/strictValidation';
import { isId, isSequence } from './guards';
import { parseSessionTranscript } from './transcript';

export function parseHistoryWindow(value: unknown): HistoryWindowState | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value,
    ['version', 'revision', 'items', 'hasOlder', 'hasNewer', 'loading', 'error', 'truncated'], ['tailAnchor']) ||
    (value.tailAnchor !== undefined && !isId(value.tailAnchor)) ||
    !isId(value.version) || !isSequence(value.revision) || typeof value.hasOlder !== 'boolean' ||
    typeof value.hasNewer !== 'boolean' || typeof value.truncated !== 'boolean' ||
    (value.loading !== null && !isHistoryDirection(value.loading)) ||
    (value.error !== null && (typeof value.error !== 'string' || value.error.length > 512))) return undefined;
  const items = parseSessionTranscript(value.items);
  if (items === undefined) return undefined;
  return { version: value.version, revision: value.revision, items,
    ...(value.tailAnchor === undefined ? {} : { tailAnchor: value.tailAnchor as string }),
    hasOlder: value.hasOlder, hasNewer: value.hasNewer, loading: value.loading,
    error: value.error, truncated: value.truncated };
}

export function parseHistoryWindowMessage(value: UnknownRecord): HistoryWindowMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sequence', 'sessionId', 'history']) ||
    !isSequence(value.sequence) || !isId(value.sessionId)) return undefined;
  const history = parseHistoryWindow(value.history);
  return history ? { type: 'history.window', sequence: value.sequence, sessionId: value.sessionId, history } : undefined;
}
