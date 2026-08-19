import { describe, expect, it, vi } from 'vitest';

import {
  MAX_TURN_TEXT_LENGTH,
  type SessionTranscriptItem,
} from '../shared/bridgeMessages';
import {
  MAX_RECOVERY_SESSIONS,
  MAX_RECOVERY_TEXT_UNITS,
  SESSION_RECOVERY_STORAGE_KEY,
  SESSION_RECOVERY_VERSION,
  SessionRecoveryStore,
  type SessionRecoveryCache,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';

describe('SessionRecoveryStore', () => {
  it('loads only exact, versioned safe projections and normalizes restart state', async () => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 7, [
          {
            id: 'thinking-1',
            kind: 'thinking',
            turnId: 'turn-1',
            text: 'Plan',
            status: 'active',
            truncated: false,
          },
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-1',
            toolName: 'Read',
            status: 'running',
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.getSelectedSessionId()).toBe('session-1');
    expect(store.readSession('session-1')).toEqual({
      historyStatus: 'partial',
      truncated: false,
      transcript: [
        expect.objectContaining({
          kind: 'thinking',
          status: 'stopped',
        }),
        expect.objectContaining({
          kind: 'tool',
          status: 'stopped',
          action: 'Read workspace files',
          progressCount: 0,
          latestUpdateKind: null,
        }),
      ],
    });
  });

  it('round-trips tool file paths and per-turn changes summaries', async () => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 3, [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-1',
            toolName: 'Edit',
            action: 'Updated workspace files',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: null,
            filePath: 'src/app.ts',
            additionalFileCount: 2,
            target: 'src/app.ts',
          },
          {
            id: 'changes-1',
            kind: 'changes',
            turnId: 'turn-1',
            files: [
              { path: 'src/app.ts', additions: 3, deletions: 1 },
              { path: 'docs/new.md', additions: null, deletions: null },
            ],
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('session-1')).toMatchObject({
      transcript: [
        expect.objectContaining({
          kind: 'tool',
          filePath: 'src/app.ts',
          additionalFileCount: 2,
          target: 'src/app.ts',
        }),
        expect.objectContaining({
          kind: 'changes',
          files: [
            { path: 'src/app.ts', additions: 3, deletions: 1 },
            { path: 'docs/new.md', additions: null, deletions: null },
          ],
        }),
      ],
    });
  });

  it('round-trips sent-attachment chip metadata and rejects hostile shapes', async () => {
    const chips = [
      { kind: 'text', name: 'notes.md', sizeBytes: 120 },
      { kind: 'pdf', name: 'spec.pdf', sizeBytes: 2048 },
    ];
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 3, [
          {
            id: 'user-1',
            kind: 'user',
            text: 'With chips',
            messageId: 'sdk-msg-1',
            attachments: chips,
          },
        ]),
        // Hostile entries: unknown kind, payload smuggled next to the
        // metadata, and an empty array all reject the whole item.
        storedSession('session-2', 2, [
          {
            id: 'user-1',
            kind: 'user',
            text: 'Bad kind',
            attachments: [
              { kind: 'archive', name: 'a.zip', sizeBytes: 1 },
            ],
          },
          {
            id: 'user-2',
            kind: 'user',
            text: 'Payload smuggle',
            attachments: [
              { kind: 'text', name: 'a.md', sizeBytes: 1, data: 'raw' },
            ],
          },
          {
            id: 'user-3',
            kind: 'user',
            text: 'Empty list',
            attachments: [],
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('session-1')?.transcript).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'With chips',
        attachments: chips,
      }),
    ]);
    expect(
      store
        .readSession('session-2')
        ?.transcript.filter((item) => item.kind === 'user') ?? [],
    ).toHaveLength(0);
  });

  it('keeps live image bytes in memory but persists only placeholders', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    await store.load();
    const image = {
      id: 'image-1',
      kind: 'image',
      turnId: 'turn-1',
      origin: 'tool-result',
      mediaType: 'image/png',
      data: 'aGVsbG8=',
      generated: false,
      byteLength: 5,
    } as const;

    store.updateSession('session-1', () =>
      cache([user('user-1', 'Take a screenshot'), image]),
    );
    // The live cache keeps the bytes so the webview can render them.
    expect(store.readSession('session-1')?.transcript[1]).toMatchObject({
      kind: 'image',
      data: 'aGVsbG8=',
    });

    await store.flush();
    expect(JSON.stringify(persistence.value)).not.toContain('aGVsbG8=');
    expect(persistence.value).toMatchObject({
      sessions: [
        expect.objectContaining({
          transcript: [
            expect.objectContaining({ kind: 'user' }),
            expect.objectContaining({
              kind: 'image',
              data: '',
              byteLength: 5,
              mediaType: 'image/png',
            }),
          ],
        }),
      ],
    });

    // A persisted placeholder loads back as-is.
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(
      reloaded.readSession('session-1')?.transcript[1],
    ).toMatchObject({ kind: 'image', data: '', byteLength: 5 });
  });

  it('rejects hostile persisted image items', async () => {
    const image = {
      id: 'image-1',
      kind: 'image',
      turnId: 'turn-1',
      origin: 'tool-result',
      mediaType: 'image/png',
      data: '',
      generated: false,
      byteLength: 5,
    };
    for (const hostile of [
      { ...image, mediaType: 'text/html' },
      { ...image, origin: 'system' },
      { ...image, data: 'not base64!!' },
      { ...image, byteLength: -1 },
      { ...image, extra: true },
    ]) {
      const persistence = memoryPersistence({
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        sessions: [storedSession('session-1', 1, [hostile])],
      });
      const store = new SessionRecoveryStore(persistence);
      await store.load();
      expect(store.readSession('session-1')).toBeUndefined();
    }
  });

  it('rejects unsafe persisted file paths and change summaries', async () => {
    for (const items of [
      [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'use-1',
          toolName: 'Edit',
          action: 'Updated workspace files',
          status: 'completed',
          progressCount: 0,
          latestUpdateKind: null,
          filePath: '../outside.ts',
        },
      ],
      [
        {
          id: 'tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'use-1',
          toolName: 'Grep',
          action: 'Searched workspace content',
          status: 'completed',
          progressCount: 0,
          latestUpdateKind: null,
          target: 'line one\nline two',
        },
      ],
      [
        {
          id: 'changes-1',
          kind: 'changes',
          turnId: 'turn-1',
          files: [],
        },
      ],
      [
        {
          id: 'changes-1',
          kind: 'changes',
          turnId: 'turn-1',
          files: [
            { path: 'C:/absolute.ts', additions: 1, deletions: 0 },
          ],
        },
      ],
      [
        {
          id: 'changes-1',
          kind: 'changes',
          turnId: 'turn-1',
          files: [
            {
              path: 'src/app.ts',
              additions: 1,
              deletions: 0,
              patch: 'raw diff must not persist',
            },
          ],
        },
      ],
    ]) {
      const persistence = memoryPersistence({
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: 'session-1',
        sessions: [
          storedSession(
            'session-1',
            1,
            items as unknown as SessionTranscriptItem[],
          ),
        ],
      });
      const store = new SessionRecoveryStore(persistence);
      await store.load();
      expect(store.readSession('session-1')).toBeUndefined();
    }
  });

  it('rejects inconsistent persisted tool progress metadata', async () => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 1, [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-1',
            toolName: 'Read',
            action: 'Read workspace files',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: 'tool-result',
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('session-1')).toBeUndefined();
  });

  it('round-trips subagent summaries on persisted tool rows', async () => {
    const subagent = {
      type: 'explore',
      description: 'Survey the auth module',
      status: 'completed',
      toolUseCount: 7,
      durationMs: 4_200,
    } as const;
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 1, [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-1',
            toolName: 'Task',
            action: 'Delegated to a subagent',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: null,
            subagent,
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('session-1')).toMatchObject({
      transcript: [
        expect.objectContaining({ kind: 'tool', subagent }),
      ],
    });
  });

  it('drops execute output tails when reading persisted tool rows', async () => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 1, [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-1',
            toolName: 'Execute',
            action: 'Ran a local command',
            status: 'completed',
            progressCount: 3,
            latestUpdateKind: 'status',
            outputTail: 'stale command output',
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    // The row survives, but its command output never replays.
    const session = store.readSession('session-1');
    expect(session?.transcript).toEqual([
      expect.objectContaining({ kind: 'tool', status: 'completed' }),
    ]);
    expect(session?.transcript[0]).not.toHaveProperty('outputTail');
  });

  it('rejects malformed persisted subagent summaries', async () => {
    for (const subagent of [
      { type: '', description: 'Empty type' },
      { type: 'explore', description: 'Bad status', status: 'busy' },
      {
        type: 'explore',
        description: 'Ledger leak',
        childSessionId: 'child-1',
      },
      { type: 'explore', description: 'Bad count', toolUseCount: -1 },
      { type: 'explore', description: 'Control\u0000char' },
      'not-a-record',
    ]) {
      const persistence = memoryPersistence({
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: 'session-1',
        sessions: [
          storedSession('session-1', 1, [
            {
              id: 'tool-1',
              kind: 'tool',
              turnId: 'turn-1',
              toolUseId: 'use-1',
              toolName: 'Task',
              action: 'Delegated to a subagent',
              status: 'completed',
              progressCount: 0,
              latestUpdateKind: null,
              subagent,
            } as unknown as SessionTranscriptItem,
          ]),
        ],
      });
      const store = new SessionRecoveryStore(persistence);
      await store.load();
      expect(store.readSession('session-1')).toBeUndefined();
    }
  });

  it('round-trips background hints on persisted tool rows', async () => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 1, [
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'use-1',
            toolName: 'Execute',
            action: 'Ran a local command',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: null,
            backgroundHint: { fireAndForget: true },
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('session-1')).toMatchObject({
      transcript: [
        expect.objectContaining({
          kind: 'tool',
          backgroundHint: { fireAndForget: true },
        }),
      ],
    });
  });

  it('rejects malformed persisted background hints', async () => {
    for (const backgroundHint of [
      {},
      { fireAndForget: 'true' },
      { fireAndForget: true, pid: 12468 },
      'fireAndForget',
      42,
    ]) {
      const persistence = memoryPersistence({
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: 'session-1',
        sessions: [
          storedSession('session-1', 1, [
            {
              id: 'tool-1',
              kind: 'tool',
              turnId: 'turn-1',
              toolUseId: 'use-1',
              toolName: 'Execute',
              action: 'Ran a local command',
              status: 'completed',
              progressCount: 0,
              latestUpdateKind: null,
              backgroundHint,
            } as unknown as SessionTranscriptItem,
          ]),
        ],
      });
      const store = new SessionRecoveryStore(persistence);
      await store.load();
      expect(store.readSession('session-1')).toBeUndefined();
    }
  });

  it('keeps live complete caches and downgrades empty complete caches only after restart', async () => {
    const persistence = memoryPersistence();
    const live = new SessionRecoveryStore(persistence);
    live.writeSession('session-1', cache([]));

    expect(live.readSession('session-1')).toMatchObject({
      historyStatus: 'complete',
      transcript: [],
    });
    await live.flush();

    const restarted = new SessionRecoveryStore(persistence);
    await restarted.load();

    expect(restarted.readSession('session-1')).toMatchObject({
      historyStatus: 'unavailable',
      transcript: [],
    });
  });

  it('rejects future, oversized, extra-key, symbol, and accessor state', async () => {
    const hostileValues: unknown[] = [
      {
        version: SESSION_RECOVERY_VERSION + 1,
        selectedSessionId: null,
        sessions: [],
      },
      {
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        sessions: [],
        extra: true,
      },
      Object.assign(
        {
          version: SESSION_RECOVERY_VERSION,
          selectedSessionId: null,
          sessions: [],
        },
        { [Symbol('hostile')]: 'secret' },
      ),
      {
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        get sessions() {
          throw new Error('accessor executed');
        },
      },
      {
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        sessions: Array.from(
          { length: MAX_RECOVERY_SESSIONS + 1 },
          (_, index) => storedSession(`session-${index}`, index, []),
        ),
      },
    ];

    for (const value of hostileValues) {
      const persistence = memoryPersistence(value);
      const store = new SessionRecoveryStore(persistence);
      await expect(store.load()).resolves.toBeUndefined();
      expect(store.getSelectedSessionId()).toBeNull();
      expect(store.readSession('session-1')).toBeUndefined();
      expect(persistence.get).toHaveBeenCalledOnce();
    }
  });

  it('drops malformed session entries without exposing raw payloads', async () => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'safe',
      sessions: [
        storedSession('safe', 1, [user('safe-item', 'Visible')]),
        storedSession('raw', 2, [
          {
            ...user('raw-item', 'Do not retain'),
            input: { secret: 'raw-input' },
            result: 'raw-result',
            progress: 'raw-progress',
            error: 'raw-error',
            attachments: ['raw-attachment'],
            interaction: 'raw-interaction',
            sdkEvent: 'raw-sdk-event',
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('safe')?.transcript).toEqual([
      user('safe-item', 'Visible'),
    ]);
    expect(store.readSession('raw')).toBeUndefined();
    await store.flush();
    expect(JSON.stringify(persistence.value)).not.toContain('raw-');
  });

  it.each([
    {
      name: 'unavailable history with cached transcript',
      transcript: [user('item-1', 'Must not survive')],
      truncated: false,
    },
    {
      name: 'unavailable history marked truncated',
      transcript: [],
      truncated: true,
    },
  ])('drops history-incoherent persistence: $name', async ({
    transcript,
    truncated,
  }) => {
    const persistence = memoryPersistence({
      version: SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        {
          ...storedSession('session-1', 1, transcript),
          historyStatus: 'unavailable',
          truncated,
        },
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(store.readSession('session-1')).toBeUndefined();
  });

  it('enforces deterministic LRU session limits', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    for (let index = 0; index < MAX_RECOVERY_SESSIONS; index += 1) {
      store.writeSession(
        `session-${index}`,
        cache([user(`item-${index}`, String(index))]),
      );
    }
    expect(store.readSession('session-0')).toBeDefined();

    store.writeSession(
      'session-new',
      cache([user('item-new', 'new')]),
    );

    expect(store.readSession('session-0')).toBeDefined();
    expect(store.readSession('session-1')).toBeUndefined();
    expect(store.readSession('session-new')).toBeDefined();
  });

  it('bounds total UTF-16 text and marks affected history partial', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    for (let index = 0; index < 6; index += 1) {
      store.writeSession(
        `session-${index}`,
        cache([
          user(
            `item-${index}`,
            String(index).repeat(MAX_TURN_TEXT_LENGTH),
          ),
        ]),
      );
    }

    await store.flush();

    const serialized = persistence.value as {
      sessions: Array<{
        historyStatus: string;
        truncated: boolean;
        transcript: SessionTranscriptItem[];
      }>;
    };
    const units = countStringValues(serialized);
    expect(units).toBeLessThanOrEqual(MAX_RECOVERY_TEXT_UNITS);
    expect(
      serialized.sessions.some(
        (session) =>
          session.historyStatus === 'partial' && session.truncated,
      ),
    ).toBe(true);
  });

  it('debounces writes, flushes immediately, and persists selection', async () => {
    vi.useFakeTimers();
    try {
      const persistence = memoryPersistence();
      const store = new SessionRecoveryStore(
        persistence,
        SESSION_RECOVERY_STORAGE_KEY,
        250,
      );
      store.writeSession(
        'session-1',
        cache([user('item-1', 'one')]),
      );
      store.selectSession('session-1');
      store.updateSession('session-1', (current) => ({
        ...current!,
        transcript: [...current!.transcript, user('item-2', 'two')],
      }));

      await vi.advanceTimersByTimeAsync(249);
      expect(persistence.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(persistence.update).toHaveBeenCalledOnce();
      expect(persistence.value).toMatchObject({
        version: SESSION_RECOVERY_VERSION,
        selectedSessionId: 'session-1',
      });

      store.selectSession(null);
      await store.flush();
      expect(persistence.update).toHaveBeenCalledTimes(2);
      expect(persistence.value).toMatchObject({
        selectedSessionId: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('contains asynchronous and synchronous persistence failures', async () => {
    const asynchronous: SessionRecoveryPersistence = {
      get: vi.fn(() => undefined),
      update: vi.fn(async () => {
        throw new Error('disk details');
      }),
    };
    const synchronous: SessionRecoveryPersistence = {
      get: vi.fn(() => {
        throw new Error('read details');
      }),
      update: vi.fn(() => {
        throw new Error('write details');
      }),
    };
    const asyncStore = new SessionRecoveryStore(asynchronous);
    const syncStore = new SessionRecoveryStore(synchronous);
    asyncStore.writeSession('session-1', cache([]));
    syncStore.writeSession('session-1', cache([]));

    await expect(asyncStore.flush()).resolves.toBeUndefined();
    await expect(syncStore.load()).resolves.toBeUndefined();
    syncStore.writeSession('session-1', cache([]));
    await expect(syncStore.dispose()).resolves.toBeUndefined();
  });

  it('persists pending changes when disposed before the debounce fires', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(
      persistence,
      SESSION_RECOVERY_STORAGE_KEY,
      60_000,
    );
    store.writeSession(
      'session-1',
      cache([user('item-1', 'pending')]),
    );

    await store.dispose();

    expect(persistence.update).toHaveBeenCalledOnce();
    expect(persistence.value).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: 'session-1',
          transcript: [user('item-1', 'pending')],
        }),
      ],
    });
  });

  it('does not allow callers to mutate stored projections by reference', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    const original = cache([user('item-1', 'safe')]);
    store.writeSession('session-1', original);

    (
      original.transcript[0] as { text: string }
    ).text = 'caller mutation';
    const read = store.readSession('session-1')!;
    (read.transcript[0] as { text: string }).text = 'read mutation';

    expect(store.readSession('session-1')?.transcript).toEqual([
      user('item-1', 'safe'),
    ]);
  });
});

function memoryPersistence(initial?: unknown) {
  const persistence = {
    value: initial as unknown,
  };
  const get = vi.fn((_key: string) => persistence.value) as unknown as
    SessionRecoveryPersistence['get'] & ReturnType<typeof vi.fn>;
  const update = vi.fn(async (_key: string, value: unknown) => {
    persistence.value = value;
  });
  return Object.assign(persistence, { get, update });
}

function cache(
  transcript: readonly SessionTranscriptItem[],
): SessionRecoveryCache {
  return {
    transcript,
    historyStatus: 'complete',
    truncated: false,
  };
}

function storedSession(
  sessionId: string,
  lastAccess: number,
  transcript: readonly unknown[],
) {
  return {
    sessionId,
    lastAccess,
    transcript,
    historyStatus: 'complete',
    truncated: false,
  };
}

function user(
  id: string,
  text: string,
): Extract<SessionTranscriptItem, { kind: 'user' }> {
  return { id, kind: 'user', text };
}

function countStringValues(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + countStringValues(item),
      0,
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).reduce<number>(
      (total, item) => total + countStringValues(item),
      0,
    );
  }
  return 0;
}
