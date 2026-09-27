import type { DaemonApi } from './api';

import type { MissionLifecycle } from '../../shared/protocol/missionProtocol';

export const DAEMON_MISSION_CATALOG_PAGE_SIZE = 100;

export interface DaemonMissionCatalogRow {
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly title?: string;
  readonly cwd?: string;
  readonly repoRoot?: string;
  readonly hostId?: string;
  readonly messagesCount?: number;
  readonly tags?: readonly {
    readonly name: string;
    readonly metadata?: Readonly<Record<string, string>>;
  }[];
  readonly archivedAt?: string;
  readonly mission?: {
    readonly state: MissionLifecycle;
    readonly title?: string;
    readonly workingDirectory?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly elapsedMs?: number;
    readonly completedFeatures?: number;
    readonly totalFeatures?: number;
  };
}

export interface DaemonMissionCatalogPage {
  readonly rows: readonly DaemonMissionCatalogRow[];
  readonly hasMore: boolean;
  readonly nextCursor?: number;
}

export type DaemonMissionCatalogTransport = Pick<DaemonApi['sessions'], 'listPage'>;

export interface DaemonMissionCatalogRuntime {
  listPage(cursor?: number): Promise<DaemonMissionCatalogPage>;
}

/**
 * Mission catalog access through the Runtime's explicit paginated session resource.
 */
export class DaemonMissionCatalog implements DaemonMissionCatalogRuntime {
  constructor(private readonly transport: DaemonMissionCatalogTransport) {}

  static fromConnectedDroid(droid: DaemonApi): DaemonMissionCatalog {
    return new DaemonMissionCatalog(droid.sessions);
  }

  async listPage(cursor?: number): Promise<DaemonMissionCatalogPage> {
    const result = await this.transport.listPage({
      limit: DAEMON_MISSION_CATALOG_PAGE_SIZE,
      ...(cursor === undefined ? {} : { endBefore: cursor }),
      includeArchived: true,
      includeMissionMetadata: true,
      filter: { missionSessions: true },
    });
    return {
      rows: result.sessions,
      hasMore: result.hasMore,
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
    };
  }
}
