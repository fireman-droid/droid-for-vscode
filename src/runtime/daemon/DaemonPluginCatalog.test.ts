import type { DaemonApi } from './api';
import { describe, expect, it, vi } from 'vitest';

import { DaemonPluginCatalog } from './DaemonPluginCatalog';

function droidWith(
  listInstalled: (sessionId: string) => Promise<unknown[]>,
  list: (sessionId: string) => Promise<unknown[]>,
): DaemonApi {
  return {
    plugins: { listInstalled },
    marketplaces: { list },
  } as unknown as DaemonApi;
}

/** The probe-recorded row shape of `plugins.listInstalled`. */
function installedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'core@factory-plugins',
    scope: 'user',
    version: 'e3ff29f752fb',
    installPath:
      'C:\\Users\\me\\.factory\\plugins\\cache\\factory-plugins\\core\\e3ff29f752fb',
    installedAt: '2026-08-05T04:17:29.077Z',
    lastUpdated: '2026-08-05T04:17:29.077Z',
    source: 'factory-plugins',
    active: true,
    managed: false,
    reason: 'enabled',
    ...overrides,
  };
}

describe('DaemonPluginCatalog', () => {
  it('runs both list RPCs concurrently with the same session id', async () => {
    let installedStarted = false;
    let marketplacesStartedBeforeInstalledResolved = false;
    let resolveInstalled: (rows: unknown[]) => void = () => {};
    const listInstalled = vi.fn((_sessionId: string) => {
      installedStarted = true;
      return new Promise<unknown[]>((resolve) => {
        resolveInstalled = resolve;
      });
    });
    const list = vi.fn(async (_sessionId: string) => {
      marketplacesStartedBeforeInstalledResolved = installedStarted;
      return [];
    });
    const catalog = new DaemonPluginCatalog(droidWith(listInstalled, list));

    const pending = catalog.snapshot('session-1');
    // Let the marketplaces call start before the plugins call resolves.
    await Promise.resolve();
    resolveInstalled([installedRow()]);
    const snapshot = await pending;

    expect(marketplacesStartedBeforeInstalledResolved).toBe(true);
    expect(listInstalled).toHaveBeenCalledWith('session-1');
    expect(list).toHaveBeenCalledWith('session-1');
    expect(snapshot.marketplaceCount).toBe(0);
  });

  it('projects display fields and drops install paths and timestamps', async () => {
    const catalog = new DaemonPluginCatalog(
      droidWith(
        async () => [
          installedRow(),
          installedRow({
            id: 'linter@acme',
            scope: 'project',
            version: 'abc123',
            active: false,
            reason: 'not enabled',
          }),
        ],
        async () => [{ name: 'factory-plugins' }],
      ),
    );

    const snapshot = await catalog.snapshot('session-1');

    expect(snapshot.plugins).toEqual([
      {
        id: 'core@factory-plugins',
        scope: 'user',
        version: 'e3ff29f752fb',
        active: true,
      },
      { id: 'linter@acme', scope: 'project', version: 'abc123', active: false },
    ]);
    expect(snapshot.marketplaceCount).toBe(1);
  });

  it('treats a missing active flag as inactive and skips empty ids', async () => {
    const catalog = new DaemonPluginCatalog(
      droidWith(
        async () => [installedRow({ active: undefined }), installedRow({ id: '' })],
        async () => [],
      ),
    );

    const snapshot = await catalog.snapshot('session-1');

    expect(snapshot.plugins).toEqual([
      {
        id: 'core@factory-plugins',
        scope: 'user',
        version: 'e3ff29f752fb',
        active: false,
      },
    ]);
  });

  it('rejects the whole snapshot when either RPC fails', async () => {
    const rpcError = new Error('RPC Error: Network error');
    const withFailingMarketplaces = new DaemonPluginCatalog(
      droidWith(
        async () => [installedRow()],
        async () => {
          throw rpcError;
        },
      ),
    );
    await expect(withFailingMarketplaces.snapshot('session-1')).rejects.toBe(rpcError);

    const withFailingPlugins = new DaemonPluginCatalog(
      droidWith(
        async () => {
          throw rpcError;
        },
        async () => [],
      ),
    );
    await expect(withFailingPlugins.snapshot('session-1')).rejects.toBe(rpcError);
  });
});
