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
}
