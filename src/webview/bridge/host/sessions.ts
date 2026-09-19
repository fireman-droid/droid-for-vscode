import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_ARCHIVED_SESSION_ITEMS,
  MAX_SESSION_CATALOG_ITEMS,
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  MAX_SESSION_SEARCH_RESULTS,
  MAX_SESSION_SEARCH_SNIPPET_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_WORKTREE_BRANCH_LENGTH,
  MAX_WORKTREE_PATH_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  type ArchivedSessionSummary,
  type SessionArchivedState,
  type SessionCatalogState,
  type SessionMissionSummary,
  type SessionSearchHit,
  type SessionSearchState,
  type SessionSummary,
  type SessionWorktreeInfo,
} from '../../../shared/protocol/sessions';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  MAX_STRING_LENGTH,
  hasControlCharacter,
  isBoundedString,
  isId,
  isIsoDate,
  isMissionSessionRole,
  isMissionState,
  isNonEmptyBoundedString,
  isSequence,
  isSessionCatalogStatus,
  readStringDataProperty,
} from './guards';

export function parseSessionMission(value: unknown): SessionMissionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['state', 'role']) ||
    (value.state !== null && !isMissionState(value.state)) ||
    (value.role !== null && !isMissionSessionRole(value.role)) ||
    // An all-null summary carries no information; the host omits the
    // field instead.
    (value.state === null && value.role === null)
  ) {
    return undefined;
  }
  return { state: value.state, role: value.role };
}

export function parseSessionCatalog(
  value: unknown,
  activeSessionId: string | null,
  allowPendingActive: boolean,
): SessionCatalogState | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['status', 'items'], ['message']) ||
    !isSessionCatalogStatus(value.status) ||
    !isExactArray(value.items, 0, MAX_SESSION_CATALOG_ITEMS) ||
    (value.message !== undefined && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }

  const items: SessionSummary[] = [];
  const ids = new Set<string>();
  let activeItemId: string | null = null;
  for (const itemValue of value.items) {
    const item = parseSessionSummary(itemValue);
    if (
      item === undefined ||
      ids.has(item.id) ||
      (item.active && activeItemId !== null)
    ) {
      return undefined;
    }
    ids.add(item.id);
    if (item.active) {
      activeItemId = item.id;
    }
    items.push(item);
  }

  if (
    activeItemId !== activeSessionId &&
    !(allowPendingActive && activeItemId === null && activeSessionId !== null)
  ) {
    return undefined;
  }

  return value.message === undefined
    ? { status: value.status, items }
    : { status: value.status, items, message: value.message };
}

export function parseSessionSummary(value: unknown): SessionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(
      value,
      ['id', 'title', 'messageCount', 'modifiedTime', 'active'],
      ['isFavorite', 'missionRole', 'worktree', 'running'],
    ) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    !isSequence(value.messageCount) ||
    !isIsoDate(value.modifiedTime) ||
    typeof value.active !== 'boolean' ||
    (value.isFavorite !== undefined && typeof value.isFavorite !== 'boolean') ||
    (value.missionRole !== undefined && !isMissionSessionRole(value.missionRole)) ||
    // Hosts omit the flag instead of sending false.
    (value.running !== undefined && value.running !== true)
  ) {
    return undefined;
  }
  const worktree =
    value.worktree === undefined ? undefined : parseSessionWorktree(value.worktree);
  if (value.worktree !== undefined && worktree === undefined) {
    return undefined;
  }

  return {
    id: value.id,
    title: value.title,
    messageCount: value.messageCount,
    modifiedTime: value.modifiedTime,
    active: value.active,
    isFavorite: value.isFavorite === true,
    ...(value.missionRole === undefined ? {} : { missionRole: value.missionRole }),
    ...(worktree === undefined ? {} : { worktree }),
    ...(value.running === true ? { running: true } : {}),
  };
}

export function parseSessionWorktree(value: unknown): SessionWorktreeInfo | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['branch', 'path']) ||
    // Branch may be '' (host-side git recovery failed); the path is
    // the worktree identity and must be present.
    !isBoundedString(value.branch, MAX_WORKTREE_BRANCH_LENGTH) ||
    hasControlCharacter(value.branch) ||
    !isNonEmptyBoundedString(value.path, MAX_WORKTREE_PATH_LENGTH) ||
    hasControlCharacter(value.path)
  ) {
    return undefined;
  }
  return { branch: value.branch, path: value.path };
}

export function parseSessionArchivedMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.archived' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'archived']) ||
    !isSequence(value.sequence)
  ) {
    return undefined;
  }
  const archived = parseSessionArchivedState(value.archived);
  return archived === undefined
    ? undefined
    : {
        type: 'session.archived',
        sequence: value.sequence,
        archived,
      };
}

export function parseSessionRunningMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.running' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'running']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    typeof value.running !== 'boolean'
  ) {
    return undefined;
  }
  return {
    type: 'session.running',
    sequence: value.sequence,
    sessionId: value.sessionId,
    running: value.running,
  };
}

export function parseSessionArchivedState(
  value: unknown,
): SessionArchivedState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error' ? ['status', 'items', 'message'] : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_ARCHIVED_SESSION_ITEMS) ||
    (status === 'error' && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: ArchivedSessionSummary[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseArchivedSessionSummary(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : { status: 'ready', items };
}

export function parseArchivedSessionSummary(
  value: unknown,
): ArchivedSessionSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'title', 'modifiedTime', 'archivedTime']) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    !isIsoDate(value.modifiedTime) ||
    !isIsoDate(value.archivedTime)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    modifiedTime: value.modifiedTime,
    archivedTime: value.archivedTime,
  };
}

export function parseSessionSearchMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.searchResults' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'search']) ||
    !isSequence(value.sequence)
  ) {
    return undefined;
  }
  const search = parseSessionSearchState(value.search);
  return search === undefined
    ? undefined
    : {
        type: 'session.searchResults',
        sequence: value.sequence,
        search,
      };
}

export function parseSessionSearchState(value: unknown): SessionSearchState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status !== 'ready' && status !== 'error') {
    return undefined;
  }
  const query = readStringDataProperty(value, 'query');
  if (
    query === undefined ||
    query.length === 0 ||
    query.length > MAX_SESSION_SEARCH_QUERY_LENGTH ||
    hasControlCharacter(query)
  ) {
    return undefined;
  }

  if (status === 'error') {
    if (
      !hasExactKeys(value, ['status', 'query', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'error',
      query,
      items: [],
      message: value.message as string,
    };
  }

  if (
    !hasExactKeys(value, ['status', 'query', 'items']) ||
    !isExactArray(value.items, 0, MAX_SESSION_SEARCH_RESULTS)
  ) {
    return undefined;
  }
  const items: SessionSearchHit[] = [];
  const ids = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseSessionSearchHit(itemValue);
    if (item === undefined || ids.has(item.id)) {
      return undefined;
    }
    ids.add(item.id);
    items.push(item);
  }
  return { status: 'ready', query, items };
}

export function parseSessionSearchHit(value: unknown): SessionSearchHit | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['id', 'title', 'modifiedTime', 'snippet']) ||
    !isId(value.id) ||
    !isBoundedString(value.title, MAX_SESSION_TITLE_LENGTH) ||
    hasControlCharacter(value.title) ||
    (value.modifiedTime !== null && !isIsoDate(value.modifiedTime)) ||
    (value.snippet !== null &&
      (!isNonEmptyBoundedString(value.snippet, MAX_SESSION_SEARCH_SNIPPET_LENGTH) ||
        hasControlCharacter(value.snippet)))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    modifiedTime: value.modifiedTime,
    snippet: value.snippet,
  };
}
