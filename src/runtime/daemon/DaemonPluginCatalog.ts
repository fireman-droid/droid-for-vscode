import type { ConnectedDroid } from '@factory/droid-sdk';

/**
 * One installed plugin as reported by the daemon, before the host
 * projects it into the bounded Bridge summary. `scope` stays an open
 * string here (the SDK schema does not constrain it); the host
 * whitelists it against the Bridge enum.
 */
export interface InstalledPluginEntry {
  readonly id: string;
  readonly scope: string;
  readonly version: string;
  readonly active: boolean;
}

/** Joint result of the two read-only plugin RPCs. */
export interface PluginCatalogSnapshot {
  readonly plugins: readonly InstalledPluginEntry[];
  readonly marketplaceCount: number;
}

/**
 * Read-only plugin operations that only exist on the daemon protocol
 * (`plugins.*` / `marketplaces.*` are daemon resources; the session
 * channel has no plugin methods). Probe evidence from
 * artifacts/probe-plugins-daemon.mjs shows both RPCs accept
 * any on-disk session id without a daemon-opened session, so the
 * sidecar daemon alone can serve them in process runtime mode.
 */
export class DaemonPluginCatalog {
  private readonly droid: ConnectedDroid;

  constructor(droid: ConnectedDroid) {
    this.droid = droid;
  }

  /**
   * Reads the installed plugin list and the registered marketplace
   * count in one concurrent round trip. Either RPC failing rejects
   * the whole snapshot: a panel that silently showed plugins with a
   * wrong marketplace line would be worse than an explicit error.
   */
  async snapshot(sessionId: string): Promise<PluginCatalogSnapshot> {
    const [plugins, marketplaces] = await Promise.all([
      this.droid.plugins.listInstalled(sessionId),
      this.droid.marketplaces.list(sessionId),
    ]);
    const entries: InstalledPluginEntry[] = [];
    for (const row of plugins) {
      if (row.id.length === 0) {
        continue;
      }
      entries.push({
        id: row.id,
        scope: row.scope,
        version: row.version,
        active: row.active === true,
      });
    }
    return { plugins: entries, marketplaceCount: marketplaces.length };
  }
}
