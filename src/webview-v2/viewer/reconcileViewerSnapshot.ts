import { shallow } from 'zustand/shallow';
import type { SessionViewerSnapshotMessage } from '../../shared/protocol/sessionViewerProtocol';

// The bridge parser has already reduced these values to bounded records,
// arrays and primitives. Compare every field without serializing large text
// or image payloads, or treating an unchanged item ID as unchanged content.
function sameValue(before: unknown, after: unknown): boolean {
  if (before === after) return true;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return false;
  if (Array.isArray(before) || Array.isArray(after)) {
    return Array.isArray(before) && Array.isArray(after) && before.length === after.length &&
      before.every((value, index) => sameValue(value, after[index]));
  }
  const previous = before as Record<string, unknown>, next = after as Record<string, unknown>;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length && keys.every((key) =>
    Object.hasOwn(next, key) && sameValue(previous[key], next[key]));
}

/** Retain only the current viewer's last snapshot; target changes start fresh. */
export function reconcileViewerSnapshot(
  previous: SessionViewerSnapshotMessage | null,
  next: SessionViewerSnapshotMessage,
): SessionViewerSnapshotMessage {
  if (previous === null || !shallow(previous.target, next.target) || previous.status !== next.status) return next;
  if (previous.status === 'ready' && next.status === 'ready') {
    const byId = new Map(previous.items.map((item) => [item.id, item]));
    const items = next.items.map((item) => {
      const cached = byId.get(item.id);
      return cached !== undefined && sameValue(cached, item) ? cached : item;
    });
    const unchanged = items.length === previous.items.length && items.every((item, index) => item === previous.items[index]);
    const retained = { ...next, target: previous.target, items: unchanged ? previous.items : items };
    return shallow(previous, retained) ? previous : retained;
  }
  const retained = { ...next, target: previous.target };
  return shallow(previous, retained) ? previous : retained;
}
