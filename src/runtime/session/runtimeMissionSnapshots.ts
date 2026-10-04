import type { FactoryDroidSession } from './sessionTypes';

/** Follows the retained session across replacements, independently of turn streams. */
export class RuntimeMissionSnapshots {
  private session: FactoryDroidSession | null = null;
  private readonly listeners = new Set<(snapshot: unknown) => void>();
  private unsubscribe: (() => void) | undefined;

  readonly read = (): unknown => this.session?.readMissionSnapshot?.() ?? null;

  readonly refresh = async (): Promise<unknown> => {
    const session = this.session;
    if (session?.refreshMissionSnapshot === undefined)
      throw new Error('The active session cannot refresh Mission state.');
    const snapshot = await session.refreshMissionSnapshot();
    if (this.session !== session)
      throw new Error('The active session changed while refreshing Mission state.');
    return snapshot;
  };

  readonly subscribe = (listener: (snapshot: unknown) => void): (() => void) => {
    this.listeners.add(listener);
    this.bind();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.unbind();
    };
  };

  attach(session: FactoryDroidSession): void {
    this.unbind();
    this.session = session;
    this.bind();
    this.publish(this.read());
  }

  dispose(): void {
    this.unbind();
    this.listeners.clear();
    this.session = null;
  }

  private bind(): void {
    if (this.unsubscribe !== undefined || this.listeners.size === 0) return;
    this.unsubscribe = this.session?.subscribeMissionSnapshot?.((snapshot) => this.publish(snapshot));
  }

  private unbind(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private publish(snapshot: unknown): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}
