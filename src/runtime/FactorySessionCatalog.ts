import { listSessions } from '@factory/droid-sdk/node';

import {
  MAX_SESSION_CATALOG_ID_LENGTH,
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

  const messageCount = value.messageCount;
  if (
    !isSafeIdentifier(value.id) ||
    typeof value.title !== 'string' ||
    typeof messageCount !== 'number' ||
    !Number.isSafeInteger(messageCount) ||
    messageCount < 0
  ) {
    return null;
  }

  const title = sanitizeTitle(value.title);
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
  };
}

function sanitizeTitle(value: string): string {
  const title = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SESSION_CATALOG_TITLE_LENGTH)
    .trim();

  return title.length > 0 ? title : 'Untitled session';
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_CATALOG_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
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
