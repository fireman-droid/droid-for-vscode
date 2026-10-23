import {
  loadFactoryAccount,
  type FactoryAccountResult,
} from '../../runtime/account/factoryAccount';

/** Short cache so opening the popover twice does not re-hit billing. */
const CACHE_TTL_MS = 20_000;

/**
 * Window-shared owner of the Factory account projection. Identity and
 * limits belong to the CLI sign-in rather than to one conversation, so
 * every chat and the management page read the same cached snapshot
 * instead of fetching billing per surface.
 */
export class FactoryAccountService {
  private current: { readonly at: number; readonly result: FactoryAccountResult } | null =
    null;
  private inFlight: Promise<FactoryAccountResult> | null = null;

  constructor(
    private readonly load: typeof loadFactoryAccount = loadFactoryAccount,
    private readonly now: () => number = Date.now,
  ) {}

  /** Last known projection without any request; null before the first read. */
  peek(): FactoryAccountResult | null {
    return this.current?.result ?? null;
  }

  async read(options: { readonly force?: boolean } = {}): Promise<FactoryAccountResult> {
    const cached = this.current;
    if (
      options.force !== true &&
      cached !== null &&
      this.now() - cached.at < CACHE_TTL_MS
    ) {
      return cached.result;
    }
    if (this.inFlight !== null) {
      return this.inFlight;
    }
    this.inFlight = this.load()
      .then((result) => {
        // Only successful reads stay cached; a missing sign-in must be
        // re-checked so signing in from the CLI is picked up.
        this.current = result.status === 'ok' ? { at: this.now(), result } : null;
        return result;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
