import { isAbsolute } from 'node:path';
import { hasSubagentSessionTag } from '@factory/droid-sdk';
import type { DaemonApi } from '../../runtime/daemon/api';
import { isEditorAssistanceSession } from '../../runtime/editorAssistance/sessionIdentity';
import { isAutomationSessionId, type AutomationSessionPage } from '../../shared/protocol/automationProtocol';
import type { ManagedSession } from '../../shared/protocol/managementPageProtocol';

type Entry = Awaited<ReturnType<DaemonApi['sessions']['listPage']>>['sessions'][number];
interface LinkedSession extends ManagedSession { readonly pendingPermissions: number | null; readonly pendingQuestions: number | null }
export interface AutomationSessionAccess {
  readonly activeId: () => string | null;
  readonly view: (row: ManagedSession) => void;
  readonly resume: (row: ManagedSession) => Promise<void>;
  readonly chooseDirectory: () => Promise<string | null>;
}
function supported(row: Entry): boolean {
  return isAutomationSessionId(row.sessionId) && !!row.cwd && isAbsolute(row.cwd) && !row.cwd.includes('\0')
    && !row.callingSessionId && !row.callingToolUseId && !hasSubagentSessionTag(row.tags)
    && !isEditorAssistanceSession(row.tags) && !row.mission && !row.tags?.some(t => t.name === 'decompSessionType');
}
export async function automationSessionPage(api: DaemonApi, cursor: number | null, activeId: string | null): Promise<AutomationSessionPage> {
  const page = await api.sessions.listPage({ limit: 100, includeArchived: false,
    filter: { missionSessions: false }, ...(cursor === null ? {} : { endBefore: cursor }) });
  if (page.hasMore && (page.nextCursor === undefined || cursor !== null && page.nextCursor >= cursor)) {
    throw new Error('The session cursor did not advance. Refresh the session list.');
  }
  return {
    sessions: page.sessions.filter(row => supported(row) && !row.archivedAt && !row.tags?.some(t => t.name === 'exec'))
      .map(row => ({ id: row.sessionId, title: row.title?.trim() || 'Untitled', cwd: row.cwd!, current: row.sessionId === activeId })),
    nextCursor: page.hasMore ? page.nextCursor! : null,
  };
}
export async function findAutomationSession(api: DaemonApi, id: string, forDelivery: boolean, activeId: string | null): Promise<LinkedSession> {
  if (!isAutomationSessionId(id)) throw new Error('The linked session is unavailable on this machine.');
  let cursor: number | undefined;
  do {
    const page = await api.sessions.listPage({ limit: 100, includeArchived: true,
      ...(cursor === undefined ? {} : { endBefore: cursor }) });
    const row = page.sessions.find(item => item.sessionId === id);
    if (row) {
      const exec = row.tags?.some(t => t.name === 'exec') ?? false;
      if (!supported(row) || forDelivery && (row.archivedAt !== undefined || exec)) {
        throw new Error('The target must be an available, unarchived local chat session.');
      }
      return {
        id, title: row.title?.trim() || 'Untitled', cwd: row.cwd!, kind: exec ? 'exec' : 'chat',
        modifiedTime: new Date(row.updatedAt * 1000).toISOString(), messageCount: row.messagesCount ?? 0,
        favorite: false, archived: row.archivedAt !== undefined, currentFolder: false, active: id === activeId,
        pendingPermissions: row.pendingPermissionRequestCount ?? null, pendingQuestions: row.pendingAskUserRequestCount ?? null,
      };
    }
    if (!page.hasMore) break;
    if (page.nextCursor === undefined || cursor !== undefined && page.nextCursor >= cursor) {
      throw new Error('The session cursor did not advance. Refresh the session list.');
    }
    cursor = page.nextCursor;
  } while (true);
  throw new Error('The linked session is unavailable on this machine.');
}
