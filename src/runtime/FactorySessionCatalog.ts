import { listSessions } from '@factory/droid-sdk/node';

import { sanitizeSessionTitle } from '../shared/validateMessage';
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

export interface FactorySessionCatalogOptions {
  readonly listSdkSessions?: FactorySessionLister;
  readonly sessionsDirectory?: string;
  readonly writeFavoriteFile?: FactoryFavoriteWriter;
}

export class FactorySessionCatalog implements SessionCatalog {
  private readonly listSdkSessions: FactorySessionLister;
  private readonly sessionsDirectory: string;
  private readonly writeFavoriteFile: FactoryFavoriteWriter;

  constructor(options: FactorySessionCatalogOptions = {}) {
    this.listSdkSessions = options.listSdkSessions ?? listSessions;
    this.sessionsDirectory =
      options.sessionsDirectory ?? defaultSessionsDirectory();
    this.writeFavoriteFile =
      options.writeFavoriteFile ?? writeFavoriteFile;
  }

  async writeFavorite(
    sessionId: string,
    favorite: boolean,
  ): Promise<boolean> {
    try {
      return await this.writeFavoriteFile(
        this.sessionsDirectory,
        sessionId,
        favorite,
      );
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
      const sessions: SessionCatalogEntry[] = [];

      for (const item of metadata) {
        const projected = projectSessionMetadata(item);
        if (projected) {
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

function projectSessionMetadata(value: unknown): SessionCatalogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  // Subagent child sessions never reach the drawer (playback design
  // §5: their only sanctioned entry is the read-only transcript on
  // the parent's Task row). Child session_start lines carry their
  // caller identity, which the SDK's passthrough metadata preserves.
  if (
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

  const title = sanitizeSessionTitle(
    value.title,
    MAX_SESSION_CATALOG_TITLE_LENGTH,
  );
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
    ...(value.decompSessionType === 'orchestrator' ||
    value.decompSessionType === 'worker'
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
