import {
  MAX_RECENT_COMMANDS,
} from '../shared/bridgeMessages';
import { isSafeCommandName } from '../shared/validateMessage';

/**
 * Minimal persistence surface for the recent-command list. Backed by
 * `ExtensionContext.workspaceState` in production; the default
 * transient implementation keeps tests and headless hosts working.
 */
export interface RecentCommandsPersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const STORAGE_KEY = 'droidvisx.recentCommands';

/**
 * Tracks the most recently invoked custom slash commands for the
 * current workspace. Names are validated on read so corrupted or
 * foreign persisted values never reach the bridge.
 */
export class RecentCommandsStore {
  private readonly persistence: RecentCommandsPersistence;

  constructor(persistence?: RecentCommandsPersistence) {
    this.persistence = persistence ?? createTransientPersistence();
  }

  read(): readonly string[] {
    const stored = this.persistence.get<unknown>(STORAGE_KEY);
    if (!Array.isArray(stored)) {
      return [];
    }
    const names: string[] = [];
    const seen = new Set<string>();
    for (const value of stored) {
      if (names.length >= MAX_RECENT_COMMANDS) {
        break;
      }
      if (isSafeCommandName(value) && !seen.has(value)) {
        seen.add(value);
        names.push(value);
      }
    }
    return names;
  }

  /** Moves `name` to the front and persists the capped list. */
  record(name: string): readonly string[] {
    if (!isSafeCommandName(name)) {
      return this.read();
    }
    const next = [
      name,
      ...this.read().filter((existing) => existing !== name),
    ].slice(0, MAX_RECENT_COMMANDS);
    void Promise.resolve(
      this.persistence.update(STORAGE_KEY, next),
    ).then(undefined, () => undefined);
    return next;
  }
}

function createTransientPersistence(): RecentCommandsPersistence {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}
