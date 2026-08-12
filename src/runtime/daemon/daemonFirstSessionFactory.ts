import type { FactoryDroidSessionFactory } from '../FactoryDroidRuntime';

/**
 * Daemon-first session creation with a silent, sticky process
 * fallback. Used when `droidvisx.runtime.mode` is unset (the daemon
 * default): a window whose shared daemon cannot start or be reached
 * keeps working over per-window subprocesses instead of failing the
 * session, and the user never has to pick a mode.
 *
 * The fallback keys off daemon *acquisition* failures only (spawn,
 * connect, credentials — the `daemon.sidecar.start-failed` class).
 * Session-level failures on a healthy daemon (held lease, invalid
 * cwd) propagate unchanged, because falling back would silently
 * change their semantics.
 *
 * Once fallen back, the window stays on process sessions: mode
 * changes require a window reload anyway, and mixing daemon and
 * process sessions in one window would split every downstream
 * capability gate.
 */
export interface DaemonFirstSessionFactory {
  readonly factory: FactoryDroidSessionFactory;
  /** True once a daemon acquisition failure switched this window. */
  didFallBack(): boolean;
}

export function createDaemonFirstSessionFactory(options: {
  /** Acquires (starting if needed) the shared daemon connection. */
  readonly acquireDaemon: () => Promise<unknown>;
  readonly daemonFactory: FactoryDroidSessionFactory;
  readonly processFactory: FactoryDroidSessionFactory;
  /** Fired exactly once, on the failure that triggered the switch. */
  readonly onFallback: (error: unknown) => void;
}): DaemonFirstSessionFactory {
  let fellBack = false;
  return {
    didFallBack: () => fellBack,
    factory: async (sessionOptions) => {
      if (!fellBack) {
        try {
          await options.acquireDaemon();
        } catch (error) {
          fellBack = true;
          try {
            options.onFallback(error);
          } catch {
            // Observability must never break session creation.
          }
          return options.processFactory(sessionOptions);
        }
        return options.daemonFactory(sessionOptions);
      }
      return options.processFactory(sessionOptions);
    },
  };
}
