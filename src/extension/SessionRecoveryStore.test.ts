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
import { LEGACY_SESSION_RECOVERY_VERSION } from './conversationRecoveryState';
import {
  readRecoverySession,
  selectRecoverySession,
  updateRecoverySession,
  writeRecoverySession,
} from './recoveryStoreTestSupport';

describe('SessionRecoveryStore', () => {
  it('keeps compact successors in one conversation with the same display', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    writeRecoverySession(store,
      'session-root',
      cache([user('user-root', 'Visible before compact')]),
    );
    selectRecoverySession(store, 'session-root');
    const conversationId =
      store.resolveConversationId('session-root')!;

    expect(
      store.adoptSuccessor(
        conversationId,
        'session-root',
        'session-compact',
        'compact',
      ),
    ).toBe(true);
    expect(store.getSelectedConversationId()).toBe(conversationId);
    expect(store.getSelectedSessionId()).toBe('session-compact');
    expect(readRecoverySession(store, 'session-compact')?.transcript).toEqual([
      user('user-root', 'Visible before compact'),
    ]);

    await store.flush();
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.getSelectedConversationId()).toBe(conversationId);
    expect(reloaded.getSelectedSessionId()).toBe('session-compact');
    expect(
      reloaded.readConversation(conversationId)?.nodes,
    ).toMatchObject([
      { sessionId: 'session-root', relation: 'root' },
      {
        sessionId: 'session-compact',
        relation: 'compact',
        parentSessionId: 'session-root',
      },
    ]);
  });

  it('forks a new conversation without mutating the source display', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    writeRecoverySession(store,
      'session-root',
      cache([user('user-root', 'Original')]),
    );
    const sourceConversationId =
      store.resolveConversationId('session-root')!;
    const forkConversationId = store.forkConversation(
      sourceConversationId,
      'session-root',
      'session-fork',
      'fork',
      cache([user('user-root', 'Original')]),
    );

    expect(forkConversationId).toBe('session-fork');
    writeRecoverySession(store,
      'session-fork',
      cache([
        user('user-root', 'Original'),
        user('user-fork', 'Only in fork'),
      ]),
    );
    expect(readRecoverySession(store, 'session-root')?.transcript).toEqual([
      user('user-root', 'Original'),
    ]);
    expect(readRecoverySession(store, 'session-fork')?.transcript).toEqual([
      user('user-root', 'Original'),
      user('user-fork', 'Only in fork'),
    ]);
  });

  it('keeps the latest actual changes after an empty settled turn', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    writeRecoverySession(store, 'session-1', cache([]));
    const conversationId =
      store.resolveConversationId('session-1')!;
    expect(
      store.recordSettledTurn(
        conversationId,
        'session-1',
        'turn-1',
        'First',
        [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
        'completed',
      ),
    ).toBe(true);
    expect(
      store.recordSettledTurn(
        conversationId,
        'session-1',
        'turn-2',
        'Second',
        [],
        'completed',
      ),
    ).toBe(true);

    expect(store.readLatestChanges(conversationId)).toMatchObject({
      turnId: 'turn-1',
      changesSettled: true,
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
    });
    expect(store.readTurn(conversationId, 'turn-2')).toMatchObject({
      changesSettled: true,
      files: [],
    });
  });

  it('round-trips the exact active turn in a V2 display snapshot', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    writeRecoverySession(store,
      'session-1',
      cache([user('user-1', 'Still running')]),
    );
    const conversationId =
      store.resolveConversationId('session-1')!;
    expect(
      store.writeActiveDisplay(
        conversationId,
        'session-1',
        cache([user('user-1', 'Still running')]),
        { turnId: 'turn-live', status: 'streaming' },
      ),
    ).toBe(true);
    await store.flush();

    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(reloaded.readDisplay(conversationId)?.turn).toEqual({
      turnId: 'turn-live',
      status: 'streaming',
    });
  });

  it('persists exact AskUser answer and cancellation records', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    writeRecoverySession(store,
      'session-1',
      cache([
        {
          id: 'ask-result-1',
          kind: 'ask-user-result',
          turnId: 'turn-1',
          status: 'answered',
          answers: [{ topic: 'Library', answer: 'React' }],
        },
        {
          id: 'ask-result-2',
          kind: 'ask-user-result',
          turnId: 'turn-1',
          status: 'cancelled',
        },
      ]),
    );
    await store.flush();

    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(readRecoverySession(reloaded, 'session-1')?.transcript).toEqual([
      {
        id: 'ask-result-1',
        kind: 'ask-user-result',
        turnId: 'turn-1',
        status: 'answered',
        answers: [{ topic: 'Library', answer: 'React' }],
      },
      {
        id: 'ask-result-2',
        kind: 'ask-user-result',
        turnId: 'turn-1',
        status: 'cancelled',
      },
    ]);
  });

  it('loads only exact, versioned safe projections and normalizes restart state', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION,
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
    expect(readRecoverySession(store, 'session-1')).toEqual({
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
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'session-1')).toMatchObject({
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
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'session-1')?.transcript).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'With chips',
        attachments: chips,
      }),
    ]);
    expect(
      readRecoverySession(store, 'session-2')
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

    updateRecoverySession(store, 'session-1', () =>
      cache([user('user-1', 'Take a screenshot'), image]),
    );
    // The live cache keeps the bytes so the webview can render them.
    expect(readRecoverySession(store, 'session-1')?.transcript[1]).toMatchObject({
      kind: 'image',
      data: 'aGVsbG8=',
    });

    await store.flush();
    expect(JSON.stringify(persistence.value)).not.toContain('aGVsbG8=');
    expect(
      storedV2Transcript(persistence.value, 'session-1').transcript,
    ).toEqual([
      expect.objectContaining({ kind: 'user' }),
      expect.objectContaining({
        kind: 'image',
        data: '',
        byteLength: 5,
        mediaType: 'image/png',
      }),
    ]);

    // A persisted placeholder loads back as-is.
    const reloaded = new SessionRecoveryStore(persistence);
    await reloaded.load();
    expect(
      readRecoverySession(reloaded, 'session-1')?.transcript[1],
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
        version: LEGACY_SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        sessions: [storedSession('session-1', 1, [hostile])],
      });
      const store = new SessionRecoveryStore(persistence);
      await store.load();
      expect(readRecoverySession(store, 'session-1')).toBeUndefined();
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
        version: LEGACY_SESSION_RECOVERY_VERSION,
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
      expect(readRecoverySession(store, 'session-1')).toBeUndefined();
    }
  });

  it('round-trips an explicitly empty canonical changes settlement', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION,
      selectedSessionId: 'session-1',
      sessions: [
        storedSession('session-1', 1, [
          {
            id: 'changes-1',
            kind: 'changes',
            turnId: 'turn-1',
            files: [],
          },
        ]),
      ],
    });
    const store = new SessionRecoveryStore(persistence);

    await store.load();

    expect(readRecoverySession(store, 'session-1')?.transcript).toEqual([
      {
        id: 'changes-1',
        kind: 'changes',
        turnId: 'turn-1',
        files: [],
      },
    ]);
  });

  it('does not persist a live writing changes row as canonical settlement', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    writeRecoverySession(store, 'session-1', cache([
      {
        id: 'changes-1',
        kind: 'changes',
        turnId: 'turn-1',
        files: [{ path: 'src/app.ts', additions: null, deletions: null }],
        writing: true,
      },
    ]));

    await store.flush();

    expect(
      storedV2Transcript(persistence.value, 'session-1').transcript,
    ).toEqual([]);
  });

  it('rejects inconsistent persisted tool progress metadata', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'session-1')).toBeUndefined();
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
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'session-1')).toMatchObject({
      transcript: [
        expect.objectContaining({ kind: 'tool', subagent }),
      ],
    });
  });

  it('drops execute output tails when reading persisted tool rows', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION,
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
    const session = readRecoverySession(store, 'session-1');
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
        version: LEGACY_SESSION_RECOVERY_VERSION,
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
      expect(readRecoverySession(store, 'session-1')).toBeUndefined();
    }
  });

  it('round-trips background hints on persisted tool rows', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'session-1')).toMatchObject({
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
        version: LEGACY_SESSION_RECOVERY_VERSION,
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
      expect(readRecoverySession(store, 'session-1')).toBeUndefined();
    }
  });

  it('preserves an exact V2 complete display snapshot after restart', async () => {
    const persistence = memoryPersistence();
    const live = new SessionRecoveryStore(persistence);
    writeRecoverySession(live, 'session-1', cache([]));

    expect(readRecoverySession(live, 'session-1')).toMatchObject({
      historyStatus: 'complete',
      transcript: [],
    });
    await live.flush();

    const restarted = new SessionRecoveryStore(persistence);
    await restarted.load();

    expect(readRecoverySession(restarted, 'session-1')).toMatchObject({
      historyStatus: 'complete',
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
        version: LEGACY_SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        sessions: [],
        extra: true,
      },
      Object.assign(
        {
          version: LEGACY_SESSION_RECOVERY_VERSION,
          selectedSessionId: null,
          sessions: [],
        },
        { [Symbol('hostile')]: 'secret' },
      ),
      {
        version: LEGACY_SESSION_RECOVERY_VERSION,
        selectedSessionId: null,
        get sessions() {
          throw new Error('accessor executed');
        },
      },
      {
        version: LEGACY_SESSION_RECOVERY_VERSION,
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
      expect(readRecoverySession(store, 'session-1')).toBeUndefined();
      expect(persistence.get).toHaveBeenCalledOnce();
    }
  });

  it('drops malformed session entries without exposing raw payloads', async () => {
    const persistence = memoryPersistence({
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'safe')?.transcript).toEqual([
      user('safe-item', 'Visible'),
    ]);
    expect(readRecoverySession(store, 'raw')).toBeUndefined();
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
      version: LEGACY_SESSION_RECOVERY_VERSION,
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

    expect(readRecoverySession(store, 'session-1')).toBeUndefined();
  });

  it('enforces deterministic LRU session limits', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    for (let index = 0; index < MAX_RECOVERY_SESSIONS; index += 1) {
      writeRecoverySession(store,
        `session-${index}`,
        cache([user(`item-${index}`, String(index))]),
      );
    }
    expect(readRecoverySession(store, 'session-0')).toBeDefined();

    writeRecoverySession(store,
      'session-new',
      cache([user('item-new', 'new')]),
    );

    expect(readRecoverySession(store, 'session-0')).toBeDefined();
    expect(readRecoverySession(store, 'session-1')).toBeUndefined();
    expect(readRecoverySession(store, 'session-new')).toBeDefined();
  });

  it('bounds total UTF-16 text and marks affected history partial', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(persistence);
    for (let index = 0; index < 6; index += 1) {
      writeRecoverySession(store,
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
      conversations: Array<{
        display: {
          transcript: {
            historyStatus: string;
            truncated: boolean;
            transcript: SessionTranscriptItem[];
          };
        };
      }>;
    };
    const units = countStringValues(serialized);
    expect(units).toBeLessThanOrEqual(MAX_RECOVERY_TEXT_UNITS);
    expect(
      serialized.conversations.some(
        ({ display }) =>
          display.transcript.historyStatus === 'partial' &&
          display.transcript.truncated,
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
      writeRecoverySession(store,
        'session-1',
        cache([user('item-1', 'one')]),
      );
      selectRecoverySession(store, 'session-1');
      updateRecoverySession(store, 'session-1', (current) => ({
        ...current!,
        transcript: [...current!.transcript, user('item-2', 'two')],
      }));

      await vi.advanceTimersByTimeAsync(249);
      expect(persistence.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(persistence.update).toHaveBeenCalledOnce();
      expect(persistence.value).toMatchObject({
        version: SESSION_RECOVERY_VERSION,
        selectedConversationId: 'session-1',
      });

      selectRecoverySession(store, null);
      await store.flush();
      expect(persistence.update).toHaveBeenCalledTimes(2);
      expect(persistence.value).toMatchObject({
        selectedConversationId: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['synchronous', 'asynchronous'] as const)(
    'rejects %s write failures and retries the latest dirty state',
    async (failureKind) => {
      const failure = new Error('write failure');
      let stored: unknown;
      let fail = false;
      const persistence: SessionRecoveryPersistence = {
        get<T>(): T | undefined {
          return stored as T | undefined;
        },
        update: vi.fn((_key: string, value: unknown) => {
          if (fail) {
            if (failureKind === 'synchronous') {
              throw failure;
            }
            return Promise.reject(failure);
          }
          stored = value;
          return Promise.resolve();
        }),
      };
      const store = new SessionRecoveryStore(persistence);
      writeRecoverySession(store,
        'session-1',
        cache([user('item-0', 'committed')]),
      );
      await store.flush();
      fail = true;
      writeRecoverySession(store,
        'session-1',
        cache([user('item-1', 'first')]),
      );

      await expect(store.flush()).rejects.toBe(failure);
      expect(
        storedV2Transcript(stored, 'session-1').transcript,
      ).toEqual([user('item-0', 'committed')]);

      writeRecoverySession(store,
        'session-1',
        cache([user('item-2', 'latest')]),
      );
      fail = false;
      await expect(store.flush()).resolves.toBeUndefined();

      expect(
        storedV2Transcript(stored, 'session-1').transcript,
      ).toEqual([user('item-2', 'latest')]);
    },
  );

  it.each([
    'pending success',
    'synchronous failure',
    'asynchronous failure',
  ] as const)(
    'makes dispose join the same %s outcome',
    async (outcome) => {
      const failure = new Error('final write failure');
      let stored: unknown;
      let resolvePending!: () => void;
      const persistence: SessionRecoveryPersistence = {
        get<T>(): T | undefined {
          return stored as T | undefined;
        },
        update: vi.fn((_key: string, value: unknown) => {
          if (outcome === 'synchronous failure') {
            throw failure;
          }
          if (outcome === 'asynchronous failure') {
            return Promise.reject(failure);
          }
          return new Promise<void>((resolve) => {
            resolvePending = () => {
              stored = value;
              resolve();
            };
          });
        }),
      };
      const store = new SessionRecoveryStore(persistence);
      writeRecoverySession(store,
        'session-1',
        cache([user('item-1', 'pending')]),
      );

      const first = store.dispose();
      const joiner = store.dispose();
      expect(joiner).toBe(first);

      if (outcome === 'pending success') {
        await Promise.resolve();
        expect(stored).toBeUndefined();
        resolvePending();
        await expect(first).resolves.toBeUndefined();
        await expect(joiner).resolves.toBeUndefined();
        expect(
          storedV2Transcript(stored, 'session-1').transcript,
        ).toEqual([user('item-1', 'pending')]);
        return;
      }

      await expect(first).rejects.toBe(failure);
      await expect(joiner).rejects.toBe(failure);
      expect(persistence.update).toHaveBeenCalledOnce();
    },
  );

  it.each(['synchronous', 'asynchronous'] as const)(
    'contains one %s background failure and leaves state retryable',
    async (failureKind) => {
      const failure = new Error('sensitive write failure');
      let stored: unknown;
      let fail = true;
      const persistence: SessionRecoveryPersistence = {
        get<T>(): T | undefined {
          return stored as T | undefined;
        },
        update: vi.fn((_key: string, value: unknown) => {
          if (fail) {
            if (failureKind === 'synchronous') {
              throw failure;
            }
            return Promise.reject(failure);
          }
          stored = value;
          return Promise.resolve();
        }),
      };
      const store = new SessionRecoveryStore(persistence);
      const reportFailure = vi.fn();
      store.setBackgroundFlushFailureReporter(reportFailure);
      writeRecoverySession(store,
        'session-1',
        cache([user('item-1', 'retry')]),
      );

      store.flushInBackground();
      await vi.waitFor(() => {
        expect(reportFailure).toHaveBeenCalledOnce();
      });
      expect(reportFailure).toHaveBeenCalledWith();
      expect(stored).toBeUndefined();

      fail = false;
      await store.flush();
      expect(
        storedV2Transcript(stored, 'session-1').transcript,
      ).toEqual([user('item-1', 'retry')]);
    },
  );

  it('persists pending changes when disposed before the debounce fires', async () => {
    const persistence = memoryPersistence();
    const store = new SessionRecoveryStore(
      persistence,
      SESSION_RECOVERY_STORAGE_KEY,
      60_000,
    );
    writeRecoverySession(store,
      'session-1',
      cache([user('item-1', 'pending')]),
    );

    await store.dispose();

    expect(persistence.update).toHaveBeenCalledOnce();
    expect(
      storedV2Transcript(persistence.value, 'session-1').transcript,
    ).toEqual([user('item-1', 'pending')]);
  });

  it('does not allow callers to mutate stored projections by reference', () => {
    const store = new SessionRecoveryStore(memoryPersistence());
    const original = cache([user('item-1', 'safe')]);
    writeRecoverySession(store, 'session-1', original);

    (
      original.transcript[0] as { text: string }
    ).text = 'caller mutation';
    const read = readRecoverySession(store, 'session-1')!;
    (read.transcript[0] as { text: string }).text = 'read mutation';

    expect(readRecoverySession(store, 'session-1')?.transcript).toEqual([
      user('item-1', 'safe'),
    ]);
  });
});

function storedV2Transcript(
  value: unknown,
  conversationId: string,
): {
  readonly historyStatus: string;
  readonly truncated: boolean;
  readonly transcript: readonly SessionTranscriptItem[];
} {
  const state = value as {
    readonly conversations?: readonly {
      readonly conversationId?: string;
      readonly display?: {
        readonly transcript?: {
          readonly historyStatus: string;
          readonly truncated: boolean;
          readonly transcript: readonly SessionTranscriptItem[];
        };
      };
    }[];
  };
  const transcript = state.conversations?.find(
    (conversation) =>
      conversation.conversationId === conversationId,
  )?.display?.transcript;
  if (transcript === undefined) {
    throw new Error(`Missing stored conversation ${conversationId}`);
  }
  return transcript;
}

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
