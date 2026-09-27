import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  hasSubagentSessionTag,
  listSessions,
  SessionSettingsFileSchema,
  SessionStartEventSchema,
  type SessionTag,
} from '@factory/droid-sdk/node';

import { sanitizeSessionTitle } from '../../shared/validation/guards';
import { locatePersistedSessionFile } from '../history/persistedSessionMessages';
import {
  isSafeSessionIdentifier,
  MAX_SESSION_CATALOG_TITLE_LENGTH,
  type SessionCatalog,
  type SessionCatalogEntry,
  type SessionCatalogResult,
} from './SessionCatalog';
import {
  defaultSessionsDirectory,
  writeFavorite as writeFavoriteFile,
} from './sessionFavorites';

export const FACTORY_SESSION_CATALOG_LIMIT = 50;

export type FactorySessionLister = (options: {
  cwd: string;
  limit: typeof FACTORY_SESSION_CATALOG_LIMIT;
}) => Promise<readonly unknown[]>;

export type FactoryFavoriteWriter = (
  sessionsDirectory: string,
  sessionId: string,
  favorite: boolean,
) => Promise<boolean>;

export type WorkerSessionIdsReader = (options: {
  readonly sessionsDirectory: string;
  readonly cwd: string;
  readonly sessionIds: readonly string[];
}) => Promise<ReadonlySet<string>>;

export interface FactorySessionCatalogOptions {
  readonly listSdkSessions?: FactorySessionLister;
  readonly sessionsDirectory?: string;
  readonly writeFavoriteFile?: FactoryFavoriteWriter;
  readonly readWorkerSessionIds?: WorkerSessionIdsReader;
}

export class FactorySessionCatalog implements SessionCatalog {
  private readonly listSdkSessions: FactorySessionLister;
  private readonly sessionsDirectory: string;
  private readonly writeFavoriteFile: FactoryFavoriteWriter;
  private readonly readWorkerSessionIds: WorkerSessionIdsReader;

  constructor(options: FactorySessionCatalogOptions = {}) {
    this.listSdkSessions = options.listSdkSessions ?? listSessions;
    this.sessionsDirectory = options.sessionsDirectory ?? defaultSessionsDirectory();
    this.writeFavoriteFile = options.writeFavoriteFile ?? writeFavoriteFile;
    this.readWorkerSessionIds = options.readWorkerSessionIds ?? readWorkerSessionIds;
  }

  async writeFavorite(sessionId: string, favorite: boolean): Promise<boolean> {
    try {
      return await this.writeFavoriteFile(this.sessionsDirectory, sessionId, favorite);
    } catch {
      return false;
    }
  }

  async canResumeSession(cwd: string, sessionId: string): Promise<boolean> {
    if (!isSettingsFileSessionId(sessionId)) return false;
    try {
      const file = await locatePersistedSessionFile(this.sessionsDirectory, sessionId);
      if (file === null) return false;
      const handle = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const newline = buffer.subarray(0, bytesRead).indexOf(10);
        if (newline < 0 && bytesRead === buffer.length) return false;
        const result = SessionStartEventSchema.safeParse(JSON.parse(
          buffer.toString('utf8', 0, newline < 0 ? bytesRead : newline),
        ));
        if (!result.success) return false;
        const header = result.data;
        if ((header.id ?? header.sessionId) !== sessionId || !header.cwd ||
            !path.isAbsolute(header.cwd) || header.decompSessionType === 'worker' ||
            typeof header.callingSessionId === 'string' || typeof header.callingToolUseId === 'string') return false;
        const [current, recorded] = await Promise.all([fs.realpath(cwd), fs.realpath(header.cwd)]);
        if (process.platform === 'win32' ? current.toLowerCase() !== recorded.toLowerCase() : current !== recorded) return false;
        const settings = await readBoundedSessionSettings(file.replace(/\.jsonl$/, SESSION_SETTINGS_SUFFIX));
        return settings?.archivedAt === undefined && !hasWorkerTag(settings?.tags);
      } finally { await handle.close(); }
    } catch {
      return false;
    }
  }

  async listSessions(cwd: string): Promise<SessionCatalogResult> {
    try {
      const metadata = await this.listSdkSessions({
        cwd,
        limit: FACTORY_SESSION_CATALOG_LIMIT,
      });
      const sessionIds = metadata.flatMap((item) =>
        isRecord(item) && isSettingsFileSessionId(item.id) ? [item.id] : [],
      );
      // Fail-open: missing or malformed settings metadata must not
      // make an ordinary user session disappear.
      const workerIds = await this.readWorkerSessionIds({
        sessionsDirectory: this.sessionsDirectory,
        cwd,
        sessionIds,
      }).catch(() => new Set<string>());
      const sessions: SessionCatalogEntry[] = [];

      for (const item of metadata) {
        const projected = projectSessionMetadata(item);
        if (projected && !workerIds.has(projected.id)) {
          sessions.push(projected);
          if (sessions.length === FACTORY_SESSION_CATALOG_LIMIT) {
            break;
          }
        }
      }

      return { status: 'available', sessions };
    } catch {
      return {
        status: 'unavailable',
        reason: 'catalog-failed',
        message: 'Saved Droid sessions could not be loaded.',
      };
    }
  }
}

/**
 * Reads worker identity from the authoritative per-session settings
 * sidecars. `listSessions()` consumes these files but does not return
 * their tags, while the sibling global index is incomplete. Reads
 * are bounded to the already bounded catalog ids and file size.
 */
export async function readWorkerSessionIds({
  sessionsDirectory,
  cwd,
  sessionIds,
}: {
  readonly sessionsDirectory: string;
  readonly cwd: string;
  readonly sessionIds: readonly string[];
}): Promise<ReadonlySet<string>> {
  const candidateIds = Array.from(
    new Set(
      sessionIds.slice(0, FACTORY_SESSION_CATALOG_LIMIT).filter(isSettingsFileSessionId),
    ),
  );
  if (candidateIds.length === 0) {
    return new Set();
  }
  const workspaceDirectory = await workspaceSessionsDirectory(sessionsDirectory, cwd);
  const directories =
    workspaceDirectory === sessionsDirectory
      ? [sessionsDirectory]
      : [workspaceDirectory, sessionsDirectory];
  const workerIds = new Set<string>();

  await Promise.all(
    candidateIds.map(async (sessionId) => {
      const fileName = `${sessionId}${SESSION_SETTINGS_SUFFIX}`;
      for (const directory of directories) {
        const settings = await readBoundedSessionSettings(path.join(directory, fileName));
        if (settings && hasWorkerTag(settings.tags)) {
          workerIds.add(sessionId);
          return;
        }
      }
    }),
  );
  return workerIds;
}

const SESSION_SETTINGS_SUFFIX = '.settings.json';
const MAX_SESSION_SETTINGS_BYTES = 64 * 1024;

export async function readBoundedSessionSettings(file: string) {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.allocUnsafe(MAX_SESSION_SETTINGS_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (bytesRead === 0) {
          break;
        }
        length += bytesRead;
      }
      if (length > MAX_SESSION_SETTINGS_BYTES) {
        return null;
      }
      const parsed: unknown = JSON.parse(buffer.toString('utf8', 0, length));
      const result = SessionSettingsFileSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function hasWorkerTag(tags: readonly SessionTag[] | undefined): boolean {
  return (
    hasSubagentSessionTag(tags) ||
    // Independent `droid exec` automation sessions belong in the
    // read-only Agent activity page. Resuming one from the main drawer
    // could double-write against its external CLI process.
    tags?.some((tag) => tag.name === 'exec') === true ||
    tags?.some(
      (tag) => tag.name === 'decompSessionType' && tag.metadata?.value === 'worker',
    ) === true
  );
}

export async function workspaceSessionsDirectory(
  sessionsDirectory: string,
  cwd: string,
): Promise<string> {
  let expandedPath = cwd;
  if (cwd.startsWith('~/') || cwd === '~') {
    expandedPath = path.join(os.homedir(), cwd.slice(1));
  }
  const absolutePath = path.resolve(expandedPath);
  const canonicalPath = await fs.realpath(absolutePath).catch(() => absolutePath);
  const normalized = canonicalPath.replace(/[\\/]+$/, '');
  const directoryName =
    process.platform === 'win32'
      ? `-${normalized.replace(/^([A-Z]):/i, '$1').replace(/[\\/]+/g, '-')}`
      : `-${normalized.replace(/^\/+/, '').replace(/\/+/g, '-')}`;
  return path.join(sessionsDirectory, directoryName);
}

function isSettingsFileSessionId(value: unknown): value is string {
  return isSafeSessionIdentifier(value) && !/[\\/]/.test(value);
}

function projectSessionMetadata(value: unknown): SessionCatalogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  // Subagent child sessions never reach the drawer (playback design
  // §5: their only sanctioned entry is the read-only transcript on
  // the parent's Task row). Child session_start lines carry their
  // caller identity, which the SDK's passthrough metadata preserves.
  if (
    value.decompSessionType === 'worker' ||
    typeof value.callingSessionId === 'string' ||
    typeof value.callingToolUseId === 'string'
  ) {
    return null;
  }

  const messageCount = value.messageCount;
  if (
    !isSafeSessionIdentifier(value.id) ||
    typeof value.title !== 'string' ||
    typeof messageCount !== 'number' ||
    !Number.isSafeInteger(messageCount) ||
    messageCount < 0
  ) {
    return null;
  }

  const title = sanitizeSessionTitle(value.title, MAX_SESSION_CATALOG_TITLE_LENGTH);
  const modifiedTime = projectDate(value.modifiedTime);
  const createdTime = projectDate(value.createdTime);
  if (!modifiedTime || !createdTime) {
    return null;
  }

  return {
    id: value.id,
    title,
    messageCount,
    modifiedTime,
    createdTime,
    isFavorite: value.isFavorite === true,
    ...(value.decompSessionType === 'orchestrator'
      ? { missionRole: value.decompSessionType }
      : {}),
  };
}

function projectDate(value: unknown): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return null;
  }

  return value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
