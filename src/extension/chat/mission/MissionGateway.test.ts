import { describe, expect, it, vi } from 'vitest';

import type { ConnectedDroid } from '@factory/droid-sdk';

import {
  MissionGateway,
  type MissionGatewayRuntime,
} from './MissionGateway';
import type {
  DaemonMissionCatalogPage,
  DaemonMissionCatalogRuntime,
} from '../../../runtime/daemon/DaemonMissionCatalog';
import {
  MissionPreferenceStore,
  type MissionPreferencePersistence,
} from './MissionPreferences';

const catalog = [
  {
    id: 'model-orchestrator',
    supportedReasoningEfforts: ['high', 'medium'] as const,
  },
  {
    id: 'model-worker',
    supportedReasoningEfforts: ['medium'] as const,
  },
  {
    id: 'model-validator',
    supportedReasoningEfforts: ['high'] as const,
  },
];

const message = {
  type: 'mission.start' as const,
  protocolVersion: 25 as const,
  requestId: 'mission-start-1',
  scope: 'selected-chat' as const,
  task: 'Implement the feature',
  orchestrator: {
    modelId: 'model-orchestrator',
    reasoningEffort: 'high' as const,
  },
  worker: {
    mode: 'override' as const,
    modelId: 'model-worker',
    reasoningEffort: 'medium' as const,
  },
  validator: {
    mode: 'override' as const,
    modelId: 'model-validator',
    reasoningEffort: 'high' as const,
  },
  scrutinyEnabled: false,
  userTestingEnabled: true,
};

function createPreferences(): MissionPreferenceStore {
  const values = new Map<string, unknown>();
  const persistence: MissionPreferencePersistence = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      values.set(key, value);
    },
  };
  return new MissionPreferenceStore(persistence);
}

function catalogGateway(
  pages: readonly DaemonMissionCatalogPage[],
  options: {
    readonly resolveComputerLabel?: (hostId: string) => string | undefined;
    readonly timeoutMs?: number;
  } = {},
) {
  const listPage = vi.fn(async () => {
    const page = pages[listPage.mock.calls.length - 1];
    if (page === undefined) throw new Error('unexpected page');
    return page;
  });
  const gateway = new MissionGateway({
    getDroid: async () => ({}) as ConnectedDroid,
    preferences: createPreferences(),
    createRuntime: () => ({
      runtime: {} as never,
      initialize: async () => {},
    }),
    catalogRuntime: { listPage } as DaemonMissionCatalogRuntime,
    ...options,
  });
  return { gateway, listPage };
}

describe('MissionGateway', () => {
  it('paginates every Mission with the authoritative cursor and excludes ordinary sessions', async () => {
    const firstRows = Array.from({ length: 100 }, (_, index) => ({
      sessionId: `ordinary-${index}`,
      updatedAt: 1_777_000_000 - index,
    }));
    firstRows[99] = {
      sessionId: 'mission-earlier-page',
      updatedAt: 1_776_999_901,
      mission: {
        state: 'completed',
        title: 'Archived Mission',
        createdAt: '2026-08-20T10:00:00.000Z',
      },
    } as never;
    const { gateway, listPage } = catalogGateway([
      {
        rows: firstRows,
        hasMore: true,
        nextCursor: 1_776_999_900,
      },
      {
        rows: [
          {
            sessionId: 'mission-later-page',
            updatedAt: 1_776_999_800,
            mission: {
              state: 'running',
              title: 'Later page Mission',
              createdAt: '2026-08-21T10:00:00.000Z',
            },
          },
        ],
        hasMore: false,
      },
    ]);

    const result = await gateway.listCatalog();

    expect(result).toMatchObject({
      status: 'ready',
      rows: [
        { title: 'Later page Mission', lifecycle: 'running' },
        { title: 'Archived Mission', lifecycle: 'completed' },
      ],
    });
    expect(listPage.mock.calls).toEqual([[], [1_776_999_900]]);
  });

  it('projects optional fallbacks, approved labels, and valid progress without raw identity or paths', async () => {
    const { gateway } = catalogGateway(
      [
        {
          rows: [
            {
              sessionId: 'raw-daemon-session-id',
              hostId: 'opaque-host-id',
              repoRoot: 'D:\\work\\safe-repository',
              cwd: 'D:\\Users\\secret\\working-copy',
              updatedAt: 1_777_000_000,
              mission: {
                state: 'planning',
                workingDirectory: 'D:\\Users\\secret\\mission-copy',
                elapsedMs: 0,
                completedFeatures: 0,
                totalFeatures: 0,
              },
            },
          ],
          hasMore: false,
        },
      ],
      {
        resolveComputerLabel: (hostId) =>
          hostId === 'opaque-host-id' ? 'Local workstation' : undefined,
      },
    );

    await expect(gateway.listCatalog()).resolves.toEqual({
      status: 'ready',
      rows: [
        {
          catalogId: expect.stringMatching(/^mission-[A-Za-z0-9_-]+$/),
          title: 'Untitled Mission',
          lifecycle: 'planning',
          workspaceLabel: 'safe-repository',
          computerLabel: 'Local workstation',
          progress: { completed: 0, total: 0 },
          createdAt: null,
          updatedAt: null,
          elapsedMs: 0,
          attached: false,
        },
      ],
    });
    const serialized = JSON.stringify(await gateway.listCatalog());
    expect(serialized).not.toContain('raw-daemon-session-id');
    expect(serialized).not.toContain('opaque-host-id');
    expect(serialized).not.toContain('D:\\');
  });

  it.each([
    { completedFeatures: undefined, totalFeatures: undefined },
    { completedFeatures: 2, totalFeatures: undefined },
    { completedFeatures: undefined, totalFeatures: 5 },
    { completedFeatures: -1, totalFeatures: undefined },
    {
      completedFeatures: undefined,
      totalFeatures: Number.POSITIVE_INFINITY,
    },
  ])(
    'projects unavailable progress for optional counts %#',
    async (progress) => {
      const { gateway } = catalogGateway([
        {
          rows: [
            {
              sessionId: 'optional-progress',
              updatedAt: 1_777_000_000,
              mission: {
                state: 'running',
                ...progress,
              },
            },
          ],
          hasMore: false,
        },
      ]);

      await expect(gateway.listCatalog()).resolves.toMatchObject({
        status: 'ready',
        rows: [{ progress: null }],
      });
    },
  );

  it.each([
    { completedFeatures: 0, totalFeatures: 0 },
    { completedFeatures: 0, totalFeatures: 4 },
    { completedFeatures: 2, totalFeatures: 4 },
    { completedFeatures: 4, totalFeatures: 4 },
  ])('preserves fully declared valid progress %#', async (progress) => {
    const { gateway } = catalogGateway([
      {
        rows: [
          {
            sessionId: 'valid-progress',
            updatedAt: 1_777_000_000,
            mission: {
              state: 'running',
              ...progress,
            },
          },
        ],
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'ready',
      rows: [
        {
          progress: {
            completed: progress.completedFeatures,
            total: progress.totalFeatures,
          },
        },
      ],
    });
  });

  it.each([
    { completedFeatures: -1, totalFeatures: 4 },
    { completedFeatures: Number.NaN, totalFeatures: 4 },
    { completedFeatures: 1, totalFeatures: Number.POSITIVE_INFINITY },
    { completedFeatures: 10_001, totalFeatures: 10_001 },
    { completedFeatures: 3, totalFeatures: 2 },
  ])('rejects fully declared invalid progress %#', async (progress) => {
    const { gateway } = catalogGateway([
      {
        rows: [
          {
            sessionId: 'invalid-progress',
            updatedAt: 1_777_000_000,
            mission: {
              state: 'running',
              ...progress,
            },
          },
        ],
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'error',
      code: 'invalid-data',
    });
  });

  it.each([
    'Investigate(C:\\Users\\alice\\secret.txt)',
    'Investigate(\\\\server\\share\\secret.txt)',
    'Investigate(/Users/alice/.ssh/id_rsa)',
    'Investigate</tmp>',
    'Investigate(~/secrets/key)',
    'api_key=super-secret-value',
    'OPENAI_API_KEY=super-secret-value',
  ])('rejects unsafe title presentation text %s', async (title) => {
    const { gateway } = catalogGateway([
      {
        rows: [
          {
            sessionId: 'unsafe-title',
            updatedAt: 1_777_000_000,
            mission: { state: 'running', title },
          },
        ],
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'error',
      code: 'invalid-data',
    });
  });

  it.each([
    '/Users/alice/api_key=super-secret-value',
    'D:\\work\\token=super-secret-value',
  ])('replaces unsafe workspace presentation text %s', async (repoRoot) => {
    const { gateway } = catalogGateway([
      {
        rows: [
          {
            sessionId: 'unsafe-workspace',
            repoRoot,
            updatedAt: 1_777_000_000,
            mission: { state: 'running' },
          },
        ],
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'ready',
      rows: [{ workspaceLabel: '—' }],
    });
  });

  it.each([
    'Workstation(/Users/alice/.ssh/id_rsa)',
    'token=super-secret-value',
  ])('replaces unsafe computer presentation text %s', async (label) => {
    const { gateway } = catalogGateway(
      [
        {
          rows: [
            {
              sessionId: 'unsafe-computer',
              hostId: 'opaque-host-id',
              updatedAt: 1_777_000_000,
              mission: { state: 'running' },
            },
          ],
          hasMore: false,
        },
      ],
      { resolveComputerLabel: () => label },
    );

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'ready',
      rows: [{ computerLabel: '—' }],
    });
  });

  it('preserves legitimate bounded punctuation and slash text', async () => {
    const title = 'Investigate /mission and input/output (release 1.2)';
    const { gateway } = catalogGateway([
      {
        rows: [
          {
            sessionId: 'legitimate-punctuation',
            updatedAt: 1_777_000_000,
            mission: { state: 'running', title },
          },
        ],
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'ready',
      rows: [{ title }],
    });
  });

  it('deduplicates by newest Mission update then daemon update and sorts deterministically', async () => {
    const candidates = [
      {
        sessionId: 'duplicate',
        updatedAt: 1_777_000_000,
        mission: {
          state: 'running',
          title: 'Old duplicate',
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T11:00:00.000Z',
        },
      },
      {
        sessionId: 'duplicate',
        updatedAt: 1_776_000_000,
        mission: {
          state: 'paused',
          title: 'New duplicate',
          createdAt: '2026-08-21T10:00:00.000Z',
          updatedAt: '2026-08-21T12:00:00.000Z',
        },
      },
      {
        sessionId: 'missing-created',
        updatedAt: 1_778_000_000,
        mission: { state: 'completed', title: 'Missing created' },
      },
      {
        sessionId: 'newest',
        updatedAt: 1_775_000_000,
        mission: {
          state: 'completed',
          title: 'Newest created',
          createdAt: '2026-08-22T10:00:00.000Z',
        },
      },
    ] as const;
    const first = catalogGateway([
      { rows: candidates, hasMore: false },
    ]).gateway;
    const second = catalogGateway([
      { rows: [...candidates].reverse(), hasMore: false },
    ]).gateway;

    const firstResult = await first.listCatalog();
    const secondResult = await second.listCatalog();

    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toMatchObject({
      status: 'ready',
      rows: [
        { title: 'Newest created' },
        { title: 'New duplicate', lifecycle: 'paused' },
        { title: 'Missing created' },
      ],
    });
  });

  it('uses daemon modified time when duplicate Mission update times are equal', async () => {
    const mission = {
      state: 'running' as const,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T11:00:00.000Z',
    };
    const { gateway } = catalogGateway([
      {
        rows: [
          {
            sessionId: 'same-mission',
            updatedAt: 1_777_000_000,
            mission: { ...mission, title: 'Newer daemon row' },
          },
          {
            sessionId: 'same-mission',
            updatedAt: 1_776_000_000,
            mission: { ...mission, title: 'Older daemon row' },
          },
        ],
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'ready',
      rows: [{ title: 'Newer daemon row' }],
    });
  });

  it('uses safe catalog identity as the final total-order tie-breaker', async () => {
    const rows = ['gamma', 'alpha', 'beta'].map((sessionId) => ({
      sessionId,
      updatedAt: 1_777_000_000,
      mission: { state: 'running' as const, title: sessionId },
    }));
    const { gateway } = catalogGateway([{ rows, hasMore: false }]);

    const result = await gateway.listCatalog();
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      const identities = result.rows.map(({ catalogId }) => catalogId);
      expect(identities).toEqual([...identities].sort());
    }
  });

  it.each([
    {
      name: 'missing continuation',
      page: { rows: [], hasMore: true },
    },
    {
      name: 'repeated continuation',
      page: { rows: [], hasMore: true, nextCursor: 50 },
    },
  ])('fails the whole catalog on $name', async ({ page }) => {
    const pages =
      page.nextCursor === 50
        ? [
            { rows: [], hasMore: true, nextCursor: 50 },
            page,
          ]
        : [page];
    const { gateway } = catalogGateway(pages);

    await expect(gateway.listCatalog()).resolves.toEqual({
      status: 'error',
      code: 'incomplete-list',
      message: 'The complete Mission catalog could not be loaded.',
    });
  });

  it('fails the whole catalog when the page safety cap is reached', async () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({
      rows: [],
      hasMore: true,
      nextCursor: 1_000 - index,
    }));
    const { gateway } = catalogGateway(pages);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'error',
      code: 'incomplete-list',
    });
  });

  it('fails the whole catalog when one daemon page exceeds 100 rows', async () => {
    const { gateway } = catalogGateway([
      {
        rows: Array.from({ length: 101 }, (_, index) => ({
          sessionId: `mission-${index}`,
          updatedAt: 1_777_000_000 - index,
          mission: { state: 'running' as const },
        })),
        hasMore: false,
      },
    ]);

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'error',
      code: 'incomplete-list',
    });
  });

  it('does not present a resolver result that merely repeats opaque host identity', async () => {
    const { gateway } = catalogGateway(
      [
        {
          rows: [
            {
              sessionId: 'mission-host',
              hostId: 'opaque-host-id',
              updatedAt: 1_777_000_000,
              mission: { state: 'running' },
            },
          ],
          hasMore: false,
        },
      ],
      { resolveComputerLabel: (hostId) => hostId },
    );

    await expect(gateway.listCatalog()).resolves.toMatchObject({
      status: 'ready',
      rows: [{ computerLabel: '—' }],
    });
  });

  it('times out an incomplete read without returning partial rows', async () => {
    vi.useFakeTimers();
    const listPage = vi.fn(
      () => new Promise<DaemonMissionCatalogPage>(() => undefined),
    );
    const gateway = new MissionGateway({
      getDroid: async () => ({}) as ConnectedDroid,
      preferences: createPreferences(),
      createRuntime: () => ({
        runtime: {} as never,
        initialize: async () => {},
      }),
      catalogRuntime: { listPage } as DaemonMissionCatalogRuntime,
      timeoutMs: 1_000,
    });

    const pending = gateway.listCatalog();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({
      status: 'error',
      code: 'incomplete-list',
      message: 'The complete Mission catalog could not be loaded.',
    });
    vi.useRealTimers();
  });

  it('projects current chat, catalog, and advisory workspace preferences', async () => {
    const preferences = createPreferences();
    await preferences.save('workspace-a', {
      worker: {
        mode: 'override',
        modelId: 'model-worker',
        reasoningEffort: 'medium',
      },
      validator: {
        mode: 'same-as-orchestrator',
        modelId: 'old-orchestrator',
        reasoningEffort: 'medium',
      },
      scrutinyEnabled: false,
      userTestingEnabled: true,
    });
    const gateway = new MissionGateway({
      getDroid: async () => ({}) as ConnectedDroid,
      preferences,
      createRuntime: () => ({
        runtime: {} as never,
        initialize: async () => {},
      }),
    });

    expect(
      gateway.setupCapabilitiesFor(
        'workspace-a',
        {
          modelId: 'model-orchestrator',
          reasoningEffort: 'high',
        },
        {
          status: 'ready',
          items: catalog.map((item) => ({
            ...item,
            displayName: item.id,
          })),
        },
      ),
    ).toEqual({
      currentChat: {
        modelId: 'model-orchestrator',
        reasoningEffort: 'high',
      },
      catalogStatus: 'ready',
      catalog: catalog.map((item) => ({
        ...item,
        displayName: item.id,
      })),
      preferences: {
        worker: {
          mode: 'override',
          modelId: 'model-worker',
          reasoningEffort: 'medium',
        },
        validator: {
          mode: 'same-as-orchestrator',
          modelId: 'model-orchestrator',
          reasoningEffort: 'high',
        },
        scrutinyEnabled: false,
        userTestingEnabled: true,
      },
    });
  });

  it('applies and verifies official Mission settings', async () => {
    const calls: string[] = [];
    const requestedSettings = {
      workerModel: 'model-worker',
      workerReasoningEffort: 'medium',
      validationWorkerModel: 'model-validator',
      validationWorkerReasoningEffort: 'high',
      skipScrutiny: true,
      skipUserTesting: false,
    };
    const session = {
      id: 'orchestrator-1',
      settings: { missionSettings: requestedSettings },
    };
    const create = vi.fn(async () => {
      calls.push('create');
      return session;
    });
    const updateSettings = vi.fn(async () => {
      calls.push('updateSettings');
      return {};
    });
    const runtime: MissionGatewayRuntime = {
      runtime: {} as never,
      initialize: vi.fn(async () => {
        calls.push('initialize');
      }),
    };
    const createRuntime = vi.fn(() => runtime);
    const gateway = new MissionGateway({
      getDroid: async () =>
        ({
          sessions: { create, updateSettings },
        }) as unknown as ConnectedDroid,
      preferences: createPreferences(),
      createRuntime,
    });

    const result = await gateway.start({
      workspaceId: 'workspace-a',
      cwd: 'C:\\workspace-a',
      message,
      catalog,
    });

    expect(result).toMatchObject({
      status: 'ready',
      sessionId: 'orchestrator-1',
      runtime,
    });
    expect(calls).toEqual(['create', 'updateSettings', 'initialize']);
    expect(updateSettings).toHaveBeenCalledWith('orchestrator-1', {
      missionSettings: requestedSettings,
    });
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'orchestrator-1' }),
      expect.anything(),
      message.orchestrator,
    );
  });

  it('rejects each stale settings value before creating a Session', async () => {
    const create = vi.fn();
    const gateway = new MissionGateway({
      getDroid: async () =>
        ({ sessions: { create } }) as unknown as ConnectedDroid,
      preferences: createPreferences(),
      createRuntime: () => ({
        runtime: {} as never,
        initialize: async () => {},
      }),
    });

    const result = await gateway.start({
      workspaceId: 'workspace-a',
      cwd: 'C:\\workspace-a',
      message: {
        ...message,
        worker: {
          mode: 'override',
          modelId: 'missing-worker',
          reasoningEffort: 'medium',
        },
      },
      catalog,
    });

    expect(result).toEqual({
      status: 'rejected',
      code: 'unavailable-model',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    'workerModel',
    'workerReasoningEffort',
    'validationWorkerModel',
    'validationWorkerReasoningEffort',
    'skipScrutiny',
    'skipUserTesting',
  ] as const)(
    'blocks the task when durable settings differ by %s',
    async (property) => {
      const expected = {
        workerModel: 'model-worker',
        workerReasoningEffort: 'medium',
        validationWorkerModel: 'model-validator',
        validationWorkerReasoningEffort: 'high',
        skipScrutiny: true,
        skipUserTesting: false,
      };
      const session = {
        id: 'orchestrator-1',
        detach: vi.fn(async () => {}),
        settings: {
          missionSettings: {
            ...expected,
            [property]:
              property === 'skipScrutiny' || property === 'skipUserTesting'
                ? !expected[property]
                : 'mismatch',
          },
        },
      };
      const create = vi.fn(async () => session);
      const initialize = vi.fn(async () => {});
      const gateway = new MissionGateway({
        getDroid: async () =>
          ({
            sessions: {
              create,
              updateSettings: vi.fn(async () => ({})),
            },
          }) as unknown as ConnectedDroid,
        preferences: createPreferences(),
        createRuntime: () => ({ runtime: {} as never, initialize }),
      });

      await expect(
        gateway.start({
          workspaceId: 'workspace-a',
          cwd: 'C:\\workspace-a',
          message,
          catalog,
        }),
      ).resolves.toEqual({
        status: 'rejected',
        code: 'settings-mismatch',
      });
      expect(initialize).not.toHaveBeenCalled();
    },
  );
});
