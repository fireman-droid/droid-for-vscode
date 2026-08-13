import { MAX_BRIDGE_ID_LENGTH } from '../../shared/interactionProtocol';
import { hasExactKeys } from '../../shared/strictValidation';
import {
  MAX_SUBAGENT_SHEET_TITLE_LENGTH,
  SUBAGENT_TRANSCRIPT_STATUSES,
  type SubagentTranscriptMessage,
  type SubagentTranscriptStatus,
} from '../../shared/subagentProtocol';
import { parseSessionTranscript } from './validateHostMessage';

/**
 * Webview-side validation of `subagent.transcript` (the activity
 * message validates fully in subagentProtocol.ts; this one needs the
 * webview's transcript-item parser, so it lives beside it). The
 * exact-key checks double as the childSessionId firewall: a payload
 * smuggling the child id fails key validation and is dropped.
 */
export function parseSubagentTranscript(
  value: Record<string, unknown>,
): SubagentTranscriptMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'toolUseId', 'status', 'title'],
      ['items', 'truncated'],
    ) ||
    value.type !== 'subagent.transcript' ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.toolUseId) ||
    typeof value.status !== 'string' ||
    !(SUBAGENT_TRANSCRIPT_STATUSES as readonly string[]).includes(
      value.status,
    ) ||
    typeof value.title !== 'string' ||
    value.title.length > MAX_SUBAGENT_SHEET_TITLE_LENGTH
  ) {
    return undefined;
  }
  const status = value.status as SubagentTranscriptStatus;
  if (status === 'unavailable') {
    if (value.items !== undefined || value.truncated !== undefined) {
      return undefined;
    }
    return {
      type: 'subagent.transcript',
      sequence: value.sequence,
      sessionId: value.sessionId,
      toolUseId: value.toolUseId,
      status,
      title: value.title,
    };
  }
  if (
    value.truncated !== undefined &&
    typeof value.truncated !== 'boolean'
  ) {
    return undefined;
  }
  const items = parseSessionTranscript(value.items);
  if (items === undefined) {
    return undefined;
  }
  return {
    type: 'subagent.transcript',
    sequence: value.sequence,
    sessionId: value.sessionId,
    toolUseId: value.toolUseId,
    status,
    title: value.title,
    items,
    ...(value.truncated === undefined
      ? {}
      : { truncated: value.truncated }),
  };
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_BRIDGE_ID_LENGTH
  );
}
