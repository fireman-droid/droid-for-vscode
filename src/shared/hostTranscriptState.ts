import {
  MAX_BRIDGE_ID_LENGTH,
  type SessionHistoryStatus,
  type SessionTranscriptItem,
} from './bridgeMessages';

export interface HostTranscriptState {
  readonly transcript: readonly SessionTranscriptItem[];
  readonly historyStatus: SessionHistoryStatus;
  readonly truncated: boolean;
}

export function stableTranscriptId(
  kind: SessionTranscriptItem['kind'],
  ...identity: readonly string[]
): string {
  const source = `${kind}\u0000${identity.join('\u0000')}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const id = `${kind}-${toHex(first)}${toHex(second)}`;
  return id.slice(0, MAX_BRIDGE_ID_LENGTH);
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
