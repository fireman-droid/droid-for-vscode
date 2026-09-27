import { MissionState, type DaemonSessionController } from '@factory/droid-sdk';
import { describe, expect, it, vi } from 'vitest';

import { DaemonMissionCatalog } from './DaemonMissionCatalog';
import type { DaemonApi } from './api';
import { createDaemonResources } from './resources';
import { createRoutedDaemon } from './routedDaemon';
import type { WindowDaemonPool } from './windowDaemonPool';

type CatalogController = Pick<DaemonSessionController, 'listAvailableSessions'>;

function createResources(
  controller: CatalogController,
  waitUntilReady?: () => Promise<void>,
) {
  return createDaemonResources(
    controller as DaemonSessionController,
    () => {},
    waitUntilReady,
  );
}

describe('DaemonMissionCatalog', () => {
  it('reads every page through the production resources with the daemon continuation intact', async () => {
    const first = {
      sessionId: 'mission-session-1',
      updatedAt: 1_777_000_000,
      repoRoot: '/workspace',
      mission: { state: MissionState.Running, completedFeatures: 1, totalFeatures: 2 },
    };
    const archived = {
      sessionId: 'mission-session-2',
      updatedAt: 1_776_999_998,
      archivedAt: '2026-04-22T00:00:00.000Z',
      mission: { state: MissionState.Completed },
    };
    const listAvailableSessions = vi.fn<CatalogController['listAvailableSessions']>()
      .mockResolvedValueOnce({
        sessions: [first],
        hasMore: true,
        nextCursor: 1_776_999_999,
      })
      .mockResolvedValueOnce({ sessions: [archived], hasMore: false });
    const resources = createResources({ listAvailableSessions });
    const catalog = DaemonMissionCatalog.fromConnectedDroid(resources as DaemonApi);

    const firstPage = await catalog.listPage();
    expect(firstPage).toEqual({
      rows: [first],
      hasMore: true,
      nextCursor: 1_776_999_999,
    });
    await expect(catalog.listPage(firstPage.nextCursor)).resolves.toEqual({
      rows: [archived],
      hasMore: false,
    });
    expect(listAvailableSessions.mock.calls).toEqual([
      [{ limit: 100, includeArchived: true, includeMissionMetadata: true,
        filter: { missionSessions: true } }],
      [{ limit: 100, endBefore: 1_776_999_999, includeArchived: true,
        includeMissionMetadata: true, filter: { missionSessions: true } }],
    ]);
  });

  it('waits for Runtime recovery before requesting the catalog', async () => {
    let recover!: () => void;
    const recovered = new Promise<void>((resolve) => { recover = resolve; });
    const listAvailableSessions = vi.fn<CatalogController['listAvailableSessions']>()
      .mockResolvedValue({ sessions: [], hasMore: false });
    const resources = createResources({ listAvailableSessions }, () => recovered);
    const catalog = DaemonMissionCatalog.fromConnectedDroid(resources as DaemonApi);

    const request = catalog.listPage();
    expect(listAvailableSessions).not.toHaveBeenCalled();
    recover();
    await expect(request).resolves.toEqual({ rows: [], hasMore: false });
    expect(listAvailableSessions).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed page instead of returning an empty successful catalog', async () => {
    const failure = new Error('Session listing failed');
    const listAvailableSessions = vi.fn<CatalogController['listAvailableSessions']>()
      .mockRejectedValue(failure);
    const resources = createResources({ listAvailableSessions });
    const catalog = DaemonMissionCatalog.fromConnectedDroid(resources as DaemonApi);

    await expect(catalog.listPage()).rejects.toBe(failure);
  });

  it('reads Mission catalog pages through the metadata route without discovering workers', async () => {
    const page = { sessions: [], hasMore: true, nextCursor: 10 };
    const listAvailableSessions = vi.fn<CatalogController['listAvailableSessions']>()
      .mockResolvedValue(page);
    const resources = createResources({ listAvailableSessions });
    const forSession = vi.fn(async () => { throw new Error('No session owner lookup expected'); });
    const pool = {
      current: vi.fn(async () => ({ connection: { droid: resources } })),
      forSession,
      onConnection: vi.fn(() => () => {}),
    };
    const droid = createRoutedDaemon(pool as unknown as WindowDaemonPool);
    const catalog = DaemonMissionCatalog.fromConnectedDroid(droid);

    await expect(catalog.listPage()).resolves.toEqual({ rows: [], hasMore: true, nextCursor: 10 });
    expect(forSession).not.toHaveBeenCalled();
    expect(listAvailableSessions).toHaveBeenCalledTimes(1);
    droid.disconnect();
  });

  it('keeps the public session list normalization when sharing the paginated resource', async () => {
    const listAvailableSessions = vi.fn<CatalogController['listAvailableSessions']>()
      .mockResolvedValue({
        sessions: [{
          sessionId: 'mission-session-1',
          updatedAt: 1_777_000_000,
          messagesCount: 5,
          callingSessionId: 'parent',
          callingToolUseId: 'tool',
          mission: { state: MissionState.Running },
        }],
        hasMore: true,
        nextCursor: 1_776_999_999,
      });
    const resources = createResources({ listAvailableSessions });

    await expect(resources.sessions.list()).resolves.toEqual([{
      id: 'mission-session-1',
      modifiedTime: new Date(1_777_000_000_000),
      messageCount: 5,
      parentSessionId: 'parent',
      parentToolUseId: 'tool',
      archivedTime: undefined,
      mission: { state: MissionState.Running },
    }]);
    expect(listAvailableSessions).toHaveBeenCalledWith({ limit: 20 });
  });
});
