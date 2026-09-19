import {
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
} from '../protocol/bounds';
import {
  type SessionArchiveMessage,
  type SessionFavoriteMessage,
  type SessionNewMessage,
  type SessionRenameMessage,
  type SessionSearchMessage,
  type SessionSelectMessage,
  type SessionUnarchiveMessage,
  type SessionsArchivedRefreshMessage,
  type SessionsRefreshMessage,
  type WorktreeCreateSessionMessage,
} from '../protocol/sessions';
import { hasExactKeys, type UnknownRecord } from './strictValidation';
import { isId, isNonEmptyBoundedString } from './guards';

export function parseSessionsRefresh(
  value: UnknownRecord,
): SessionsRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'sessions.refresh' };
}

export function parseSessionSelect(
  value: UnknownRecord,
): SessionSelectMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.select', sessionId: value.sessionId };
}

export function parseSessionNew(value: UnknownRecord): SessionNewMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'session.new' };
}

export function parseWorktreeCreateSession(
  value: UnknownRecord,
): WorktreeCreateSessionMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'worktree.createSession' };
}

export function parseSessionRename(
  value: UnknownRecord,
): SessionRenameMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'title']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    value.title.trim().length === 0
  ) {
    return undefined;
  }

  return {
    type: 'session.rename',
    sessionId: value.sessionId,
    title: value.title,
  };
}

export function parseSessionFavorite(
  value: UnknownRecord,
): SessionFavoriteMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'favorite']) ||
    !isId(value.sessionId) ||
    typeof value.favorite !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'session.favorite',
    sessionId: value.sessionId,
    favorite: value.favorite,
  };
}

export function parseSessionArchive(
  value: UnknownRecord,
): SessionArchiveMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.archive', sessionId: value.sessionId };
}

export function parseSessionUnarchive(
  value: UnknownRecord,
): SessionUnarchiveMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'session.unarchive', sessionId: value.sessionId };
}

export function parseSessionsArchivedRefresh(
  value: UnknownRecord,
): SessionsArchivedRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type'])) {
    return undefined;
  }

  return { type: 'sessions.archivedRefresh' };
}

export function parseSessionSearch(
  value: UnknownRecord,
): SessionSearchMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'query']) ||
    typeof value.query !== 'string' ||
    value.query.trim().length === 0 ||
    value.query.length > MAX_SESSION_SEARCH_QUERY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.query)
  ) {
    return undefined;
  }

  return { type: 'session.search', query: value.query };
}
