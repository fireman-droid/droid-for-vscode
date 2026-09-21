import { DaemonPluginCatalog } from '../../runtime/daemon/DaemonPluginCatalog';
import { DaemonSessionCatalog } from '../../runtime/daemon/DaemonSessionCatalog';
import { createRoutedDaemon } from '../../runtime/daemon/routedDaemon';
import { WindowDaemonPool, type WindowDaemonBinding } from '../../runtime/daemon/windowDaemonPool';
import type { DaemonSidecarController, DiagnosticsSink } from './DaemonSidecar';

export interface WindowDaemonSidecar extends DaemonSidecarController {
  readonly pool: WindowDaemonPool;
}

export function createWindowDaemonSidecar(
  diagnostics: DiagnosticsSink,
  prepare: () => Promise<WindowDaemonBinding>,
): WindowDaemonSidecar {
  const pool = new WindowDaemonPool({ prepare, record: (event) => diagnostics.record(event) });
  const droid = createRoutedDaemon(pool);
  return {
    pool,
    async droid() { return droid; },
    async warmup() { await pool.current(); },
    provider: async () => new DaemonSessionCatalog(droid),
    plugins: async () => new DaemonPluginCatalog(droid),
    async dispose() {
      await pool.dispose();
      droid.disconnect();
    },
  };
}
