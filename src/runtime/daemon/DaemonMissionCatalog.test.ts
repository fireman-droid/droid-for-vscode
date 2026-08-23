import { describe, expect, it, vi } from 'vitest';

import {
  DaemonMissionCatalog,
  type DaemonMissionCatalogTransport,
} from './DaemonMissionCatalog';

describe('DaemonMissionCatalog', () => {
  it('preserves the authoritative continuation from the daemon response', async () => {
    const listAvailableSessions = vi.fn(async () => ({
      sessions: [
        {
          sessionId: 'mission-session-1',
          updatedAt: 1_777_000_000,
          mission: { state: 'running' as const },
        },
      ],
      hasMore: true,
      nextCursor: 1_776_999_999,
    }));
    const catalog = new DaemonMissionCatalog({ listAvailableSessions });

    await expect(catalog.listPage(1_777_000_001)).resolves.toEqual({
      rows: [
        {
          sessionId: 'mission-session-1',
          updatedAt: 1_777_000_000,
          mission: { state: 'running' },
        },
      ],
      hasMore: true,
      nextCursor: 1_776_999_999,
    });
    expect(listAvailableSessions).toHaveBeenCalledWith({
      limit: 100,
      endBefore: 1_777_000_001,
      includeArchived: true,
      includeMissionMetadata: true,
      filter: { missionSessions: true },
    });
  });

  it('uses the connected daemon session controller instead of the lossy facade list', async () => {
    const list = vi.fn();
    const listAvailableSessions = vi.fn(async () => ({
      sessions: [],
      hasMore: false,
    }));
    const droid = {
      sessions: {
        list,
        controller: { listAvailableSessions },
      },
    };

    const catalog = DaemonMissionCatalog.fromConnectedDroid(droid as never);
    await expect(catalog.listPage()).resolves.toEqual({
      rows: [],
      hasMore: false,
    });
    expect(listAvailableSessions).toHaveBeenCalledWith({
      limit: 100,
      includeArchived: true,
      includeMissionMetadata: true,
      filter: { missionSessions: true },
    });
    expect(list).not.toHaveBeenCalled();
  });

  it('fails closed when the typed daemon controller seam is unavailable', () => {
    const droid = { sessions: { list: vi.fn() } };

    expect(() =>
      DaemonMissionCatalog.fromConnectedDroid(droid as never),
    ).toThrow('Mission catalog pagination is unavailable');
  });

  it('retains a transport type that returns pagination rather than rows alone', () => {
    const transport: DaemonMissionCatalogTransport = {
      listAvailableSessions: async () => ({
        sessions: [],
        hasMore: false,
      }),
    };
    expect(new DaemonMissionCatalog(transport)).toBeDefined();
  });
});
