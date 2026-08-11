export const MAX_SESSION_CATALOG_ID_LENGTH = 512;
export const MAX_SESSION_CATALOG_TITLE_LENGTH = 200;

export interface SessionCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly modifiedTime: string;
  readonly createdTime: string;
  readonly isFavorite: boolean;
}

export type SessionCatalogResult =
  | {
      readonly status: 'available';
      readonly sessions: readonly SessionCatalogEntry[];
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'catalog-failed';
      readonly message: string;
    };

export interface SessionCatalog {
  listSessions(cwd: string): Promise<SessionCatalogResult>;
  /**
   * Marks or unmarks one session as favorite. Optional because the
   * write path is a CLI private-file contract, not a session RPC.
   * Resolves `false` on any failure instead of throwing.
   */
  writeFavorite?(sessionId: string, favorite: boolean): Promise<boolean>;
}

/**
 * Collapses control characters and whitespace runs, trims, and bounds
 * an externally sourced session title. Falls back to a readable
 * placeholder for empty titles.
 */
export function sanitizeSessionTitle(value: string): string {
  const title = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SESSION_CATALOG_TITLE_LENGTH)
    .trim();

  return title.length > 0 ? title : 'Untitled session';
}

/** Accepts externally sourced session ids without control characters. */
export function isSafeSessionIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_CATALOG_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}
