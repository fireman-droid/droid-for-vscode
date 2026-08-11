import { describe, expect, it } from 'vitest';

import {
  RecentCommandsStore,
  type RecentCommandsPersistence,
} from './RecentCommandsStore';

function createPersistence(
  initial: Record<string, unknown> = {},
): RecentCommandsPersistence & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('RecentCommandsStore', () => {
  it('records commands most-recent-first without duplicates', () => {
    const store = new RecentCommandsStore(createPersistence());

    expect(store.read()).toEqual([]);
    expect(store.record('deploy')).toEqual(['deploy']);
    expect(store.record('triage')).toEqual(['triage', 'deploy']);
    expect(store.record('deploy')).toEqual(['deploy', 'triage']);
    expect(store.read()).toEqual(['deploy', 'triage']);
  });

  it('caps the persisted list at the recent-command limit', () => {
    const store = new RecentCommandsStore(createPersistence());
    for (let index = 0; index < 12; index += 1) {
      store.record(`command-${index}`);
    }

    const recent = store.read();
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('command-11');
  });

  it('ignores unsafe names on record and filters them on read', () => {
    const persistence = createPersistence({
      'droidvisx.recentCommands': [
        'ok',
        'bad name',
        'has/slash',
        '',
        42,
        'ok',
      ],
    });
    const store = new RecentCommandsStore(persistence);

    expect(store.read()).toEqual(['ok']);
    expect(store.record('bad name')).toEqual(['ok']);
  });

  it('tolerates corrupted persisted values', () => {
    const store = new RecentCommandsStore(
      createPersistence({ 'droidvisx.recentCommands': 'nonsense' }),
    );
    expect(store.read()).toEqual([]);
  });
});
