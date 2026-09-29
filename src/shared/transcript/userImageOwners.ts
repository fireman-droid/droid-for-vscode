import type { SessionTranscriptItem, UserTranscriptItem } from '../protocol/transcript';

/** One ownership rule for question rendering, historical edits and rewinds. */
export function userImageOwners(transcript: readonly SessionTranscriptItem[]): ReadonlyMap<string, string> {
  const users = new Map<string, string>();
  for (const item of transcript) {
    if (item.kind === 'user' && item.messageId !== undefined && !users.has(item.messageId)) {
      users.set(item.messageId, item.id);
    }
  }
  const owners = new Map<string, string>();
  let adjacentUser: UserTranscriptItem | undefined;
  let pending: string[] = [];
  for (const item of transcript) {
    if (item.kind === 'changes') continue;
    if (item.kind === 'user') {
      for (const id of pending) owners.set(id, item.id);
      pending = [];
      adjacentUser = item;
    } else if (item.kind === 'image' && item.origin === 'user') {
      if (item.userMessageId !== undefined) {
        const owner = users.get(item.userMessageId);
        // An explicitly owned image must never fall back to a neighbouring message.
        if (owner !== undefined) owners.set(item.id, owner);
      } else if (adjacentUser !== undefined) {
        // Live echoes follow the accepted prompt; older snapshots may lack SDK ownership.
        owners.set(item.id, adjacentUser.id);
      } else {
        pending.push(item.id);
      }
    } else {
      adjacentUser = undefined;
      pending = [];
    }
  }
  return owners;
}
