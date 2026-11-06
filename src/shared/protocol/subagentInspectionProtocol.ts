import { MAX_BRIDGE_ID_LENGTH } from './interactionProtocol';
import {
  MAX_SESSION_VIEWER_REASON_LENGTH,
  MAX_SESSION_VIEWER_TITLE_LENGTH,
  type SessionViewerLifecycle,
} from './sessionViewerProtocol';
import type { SessionTranscriptItem } from './transcript';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export interface SubagentInspectMessage {
  readonly type: 'subagent.inspect';
  readonly sessionId: string;
  readonly turnId: string;
  /** Null releases the current inline inspection. Child session IDs stay on the Host. */
  readonly toolUseId: string | null;
}

export interface SubagentSnapshotMessage {
  readonly type: 'subagent.snapshot';
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly title: string;
  readonly items: readonly SessionTranscriptItem[];
  readonly truncated: boolean;
  readonly running: boolean;
  readonly lifecycle: SessionViewerLifecycle | null;
  readonly reason?: string;
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function parseSubagentInspectMessage(value: unknown): SubagentInspectMessage | undefined {
  if (!isStrictRecord(value) || value.type !== 'subagent.inspect'
    || !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'toolUseId'])
    || !isText(value.sessionId, MAX_BRIDGE_ID_LENGTH) || !isText(value.turnId, MAX_BRIDGE_ID_LENGTH)
    || (value.toolUseId !== null && !isText(value.toolUseId, MAX_BRIDGE_ID_LENGTH))) return undefined;
  return { type: value.type, sessionId: value.sessionId, turnId: value.turnId, toolUseId: value.toolUseId };
}

/** The Webview supplies its existing bounded transcript parser, keeping this contract shared-only. */
export function parseSubagentSnapshotMessage(
  value: unknown,
  parseTranscript: (items: unknown) => readonly SessionTranscriptItem[] | undefined,
): SubagentSnapshotMessage | undefined {
  if (!isStrictRecord(value) || value.type !== 'subagent.snapshot'
    || !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'toolUseId', 'status',
      'title', 'items', 'truncated', 'running', 'lifecycle'], ['reason'])
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || !isText(value.sessionId, MAX_BRIDGE_ID_LENGTH) || !isText(value.turnId, MAX_BRIDGE_ID_LENGTH)
    || !isText(value.toolUseId, MAX_BRIDGE_ID_LENGTH) || !isText(value.title, MAX_SESSION_VIEWER_TITLE_LENGTH)
    || (value.status !== 'loading' && value.status !== 'ready' && value.status !== 'unavailable')
    || typeof value.truncated !== 'boolean' || typeof value.running !== 'boolean'
    || (value.lifecycle !== null && !['starting', 'working', 'completed', 'failed', 'cancelled'].includes(value.lifecycle as string))
    || (value.reason !== undefined && !isText(value.reason, MAX_SESSION_VIEWER_REASON_LENGTH))) return undefined;
  const items = parseTranscript(value.items);
  if (items === undefined) return undefined;
  return { type: value.type, sequence: value.sequence as number, sessionId: value.sessionId,
    turnId: value.turnId, toolUseId: value.toolUseId, status: value.status, title: value.title,
    items, truncated: value.truncated, running: value.running,
    lifecycle: value.lifecycle as SessionViewerLifecycle | null,
    ...(value.reason === undefined ? {} : { reason: value.reason as string }) };
}
