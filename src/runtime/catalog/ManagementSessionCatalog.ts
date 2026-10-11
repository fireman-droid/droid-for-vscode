import path from 'node:path';
import { hasSubagentSessionTag } from '@factory/droid-sdk';
import type { DaemonApi } from '../daemon/api';
import { belongsToWorkspace } from '../daemon/DaemonSessionCatalog';
import { isEditorAssistanceSession } from '../editorAssistance/sessionIdentity';
import { isSafeSessionIdentifier } from './SessionCatalog';
import { defaultSessionsDirectory, readFavorites, writeFavorite } from './sessionFavorites';
import type { ManagedSession } from '../../shared/protocol/managementPageProtocol';

/** The management catalog retains the SDK's owning directory and pagination. */
export class ManagementSessionCatalog {
  private readonly rows = new Map<string, ManagedSession>();
  constructor(private readonly getDroid: () => Promise<DaemonApi>, private readonly cwd: () => string | null,
    private readonly activeId: () => string | null) {}

  async list(scope: 'folder' | 'all', cursor?: number): Promise<{ sessions: ManagedSession[]; nextCursor: number | null }> {
    const cwd = this.cwd();
    if (scope === 'folder' && !cwd) throw new Error('请先打开工作文件夹。');
    const [droid, favorites] = await Promise.all([this.getDroid(), readFavorites(defaultSessionsDirectory())]);
    const page = await droid.sessions.listPage({ limit: 100, includeArchived: true, ...(cursor === undefined ? {} : { endBefore: cursor }) });
    if (cursor === undefined) this.rows.clear();
    const sessions: ManagedSession[] = [];
    for (const row of page.sessions) {
      if (!isSafeSessionIdentifier(row.sessionId) || !row.cwd || !path.isAbsolute(row.cwd) || row.cwd.includes('\0')
        || row.callingSessionId || row.callingToolUseId || hasSubagentSessionTag(row.tags) || isEditorAssistanceSession(row.tags)
        || row.mission || row.tags?.some(t => t.name === 'decompSessionType')) continue;
      const currentFolder = cwd !== null && belongsToWorkspace(cwd, row.cwd, undefined);
      if (scope === 'folder' && !currentFolder) continue;
      const modified = new Date(row.updatedAt * 1000);
      if (!Number.isFinite(modified.getTime())) continue;
      const item: ManagedSession = {
        id: row.sessionId, title: row.title?.trim() || 'Untitled', cwd: row.cwd,
        kind: row.tags?.some(t => t.name === 'exec') ? 'exec' : 'chat',
        modifiedTime: modified.toISOString(), messageCount: row.messagesCount ?? 0,
        favorite: favorites.has(row.sessionId), archived: row.archivedAt !== undefined,
        currentFolder, active: row.sessionId === this.activeId(),
      };
      this.rows.set(item.id, item);
      sessions.push(item);
    }
    if (page.hasMore && (page.nextCursor === undefined || page.nextCursor === cursor)) throw new Error('会话目录未返回有效的下一页，请刷新。');
    return { sessions, nextCursor: page.hasMore ? page.nextCursor! : null };
  }

  target(id: string): ManagedSession {
    const row = this.rows.get(id);
    if (!row) throw new Error('会话不在当前已加载目录中，请刷新。');
    return row;
  }
  async favorite(id: string, value: boolean): Promise<void> {
    const row = this.target(id);
    if (!await writeFavorite(defaultSessionsDirectory(), id, value)) throw new Error('收藏状态未保存。');
    this.rows.set(id, { ...row, favorite: value });
  }
  async rename(id: string, title: string): Promise<void> {
    const row = this.target(id);
    const droid = await this.getDroid();
    if (!droid.sessions.rename) throw new Error('当前运行时不支持重命名。');
    if (!(await droid.sessions.rename(id, title.trim())).success) throw new Error('运行时未确认重命名。');
    this.rows.set(id, { ...row, title: title.trim() });
  }
  async archive(id: string, value: boolean): Promise<void> {
    const row = this.target(id);
    if (id === this.activeId()) throw new Error('请先切换到其他会话，再归档当前会话。');
    const droid = await this.getDroid();
    const opened = await droid.sessions.listOpened();
    if (opened.some(row => row.id === id && String(row.workingState) !== 'idle')) throw new Error('会话仍在运行，暂时不能改变归档状态。');
    const result = await (value ? droid.sessions.archive(id) : droid.sessions.unarchive(id));
    if (!result.success) throw new Error('运行时未确认归档状态变更。');
    this.rows.set(id, { ...row, archived: value });
  }
}
