import {
  type SessionCatalogState,
  type SessionSummary,
} from '../../../shared/protocol/sessions';
import {
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_TITLE_LENGTH,
} from '../../../shared/protocol/bounds';
import type { SessionCatalogEntry } from '../../../runtime/catalog/SessionCatalog';
import { sanitizeSessionTitle } from '../../../shared/validation/guards';
import type { SessionRecoveryStore } from '../../recovery/SessionRecoveryStore';
import { isSafeBridgeId } from '../internals';

export function projectCatalogEntries(
  entries: readonly SessionCatalogEntry[],
): SessionSummary[] {
  const items: SessionSummary[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      items.length >= MAX_SESSION_CATALOG_ITEMS ||
      !isSafeBridgeId(entry.id) ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.messageCount) ||
      entry.messageCount < 0
    ) {
      continue;
    }
    const modified = new Date(entry.modifiedTime);
    if (!Number.isFinite(modified.getTime())) {
      continue;
    }
    ids.add(entry.id);
    items.push({
      id: entry.id,
      title: sanitizeSessionTitle(entry.title, MAX_SESSION_TITLE_LENGTH),
      messageCount: entry.messageCount,
      modifiedTime: modified.toISOString(),
      active: false,
      isFavorite: entry.isFavorite === true,
      ...(entry.missionRole === undefined ? {} : { missionRole: entry.missionRole }),
    });
  }
  return items;
}

export function collapseConversationCatalog(
  items: readonly SessionSummary[],
  resolve: (sessionId: string) =>
    | {
        readonly conversationId: string;
        readonly activeSessionId: string;
      }
    | undefined,
): SessionSummary[] {
  const bySessionId = new Map(items.map((item) => [item.id, item]));
  const seenConversations = new Set<string>();
  const projected: SessionSummary[] = [];
  for (const item of items) {
    const owner = resolve(item.id);
    if (owner === undefined) {
      projected.push(item);
      continue;
    }
    if (seenConversations.has(owner.conversationId)) {
      continue;
    }
    seenConversations.add(owner.conversationId);
    const active = bySessionId.get(owner.activeSessionId) ?? item;
    projected.push({
      ...active,
      id: owner.activeSessionId,
    });
  }
  return projected;
}

export function collapseStoredConversationCatalog(
  sessions: SessionCatalogState,
  store: SessionRecoveryStore,
): SessionCatalogState {
  return {
    ...sessions,
    items: collapseConversationCatalog(sessions.items, (sessionId) => {
      const conversationId = store.resolveConversationId(sessionId);
      if (conversationId === undefined) {
        return undefined;
      }
      const conversation = store.readConversationIdentity(conversationId);
      return conversation === undefined
        ? undefined
        : {
            conversationId,
            activeSessionId: conversation.activeSessionId,
          };
    }),
  };
}
