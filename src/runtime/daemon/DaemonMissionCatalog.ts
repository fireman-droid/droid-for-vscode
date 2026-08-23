import type { ConnectedDroid } from '@factory/droid-sdk';

import type { MissionLifecycle } from '../../shared/missionProtocol';

export const DAEMON_MISSION_CATALOG_PAGE_SIZE = 100;

export interface DaemonMissionCatalogRow {
  readonly sessionId: string;
  readonly updatedAt: number;
  readonly title?: string;
  readonly cwd?: string;
  readonly repoRoot?: string;
  readonly hostId?: string;
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

interface DaemonMissionCatalogRequest {
  readonly limit: number;
  readonly endBefore?: number;
  readonly includeArchived: true;
  readonly includeMissionMetadata: true;
  readonly filter: { readonly missionSessions: true };
}

interface DaemonMissionCatalogTransportPage {
  readonly sessions: readonly DaemonMissionCatalogRow[];
  readonly hasMore: boolean;
  readonly nextCursor?: number;
}

export interface DaemonMissionCatalogTransport {
  listAvailableSessions(
    params: DaemonMissionCatalogRequest,
  ): Promise<DaemonMissionCatalogTransportPage>;
}

export interface DaemonMissionCatalogRuntime {
  listPage(cursor?: number): Promise<DaemonMissionCatalogPage>;
}

/**
 * Typed access to the daemon RPC result that the public `sessions.list()`
 * facade maps to rows, discarding `hasMore` and `nextCursor`.
 */
export class DaemonMissionCatalog implements DaemonMissionCatalogRuntime {
  constructor(private readonly transport: DaemonMissionCatalogTransport) {}

  static fromConnectedDroid(droid: ConnectedDroid): DaemonMissionCatalog {
    const sessions = droid.sessions as unknown as {
      readonly controller?: Partial<DaemonMissionCatalogTransport>;
    };
    const listAvailableSessions =
      sessions.controller?.listAvailableSessions;
    if (typeof listAvailableSessions !== 'function') {
      throw new Error('Mission catalog pagination is unavailable');
    }
    return new DaemonMissionCatalog({
      listAvailableSessions: (params) =>
        listAvailableSessions.call(sessions.controller, params),
    });
  }

  async listPage(cursor?: number): Promise<DaemonMissionCatalogPage> {
    const result = await this.transport.listAvailableSessions({
      limit: DAEMON_MISSION_CATALOG_PAGE_SIZE,
      ...(cursor === undefined ? {} : { endBefore: cursor }),
      includeArchived: true,
      includeMissionMetadata: true,
      filter: { missionSessions: true },
    });
    return {
      rows: result.sessions,
      hasMore: result.hasMore,
      ...(result.nextCursor === undefined
        ? {}
        : { nextCursor: result.nextCursor }),
    };
  }
}
