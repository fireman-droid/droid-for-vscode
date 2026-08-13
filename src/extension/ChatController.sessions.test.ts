import { describe, expect, it, vi } from 'vitest';

import {
  available,
  type BtwSidecarFactory,
  catalogEntry,
  createBtwSidecarStub,
  createCatalog,
  createController,
  createMockRuntime,
  DaemonAvailabilityError,
  type DaemonSessionCatalog,
  deferred,
  type MockRuntime,
  ready,
  runningStates,
  send,
  type SessionCatalog,
  type SessionCatalogResult,
  snapshots,
  successfulTurn,
  turnStates,
  waitForConnected,
  worktreeFeature,
} from './controllerTestHarness';

describe('ChatController', () => {
  it('blocks session replacement during an active turn and rejects forged session ids', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    const replacement = createMockRuntime();
    replacement.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(runtime)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Wait');

    controller.handleMessage({ type: 'session.new' });
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'forged-session',
    });

    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.diagnostic',
          code: 'session-operation-blocked',
        }),
      ]),
    );
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'forged-session',
    });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-selection-invalid',
    });
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('detaches a running daemon turn on switch and clears the flag when the daemon reports idle', async () => {
    const release = deferred<void>();
    // Daemon-backed runtime: detached turns keep running server-side.
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        yield { type: 'text-delta', text: 'working' };
        await release.promise;
        yield successfulTurn();
      }),
      { supportsBackgroundTurns: () => true },
    );
    const replacement = createMockRuntime();
    replacement.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(runtime)
      .mockReturnValueOnce(replacement);
    let workingState = 'thinking';
    const daemon = {
      readOpenedWorkingStates: vi.fn(
        async () => new Map([['session-1', workingState]]),
      ),
    };
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Long background work');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    // Switching away no longer blocks: disposal detaches the turn
    // instead of interrupting it.
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });
    await vi.waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalledWith({
        preserveBackendTurn: true,
      });
    });
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessionId).toBe('session-2');
    });
    // The old session's row carries the running flag.
    await vi.waitFor(() => {
      const items = snapshots(messages).at(-1)?.sessions.items ?? [];
      expect(
        items.find((item) => item.id === 'session-1')?.running,
      ).toBe(true);
    });

    // The daemon reports the session idle: the poll clears the flag
    // and the webview stops the row animation at once.
    workingState = 'idle';
    await vi.waitFor(
      () => {
        expect(runningStates(messages).at(-1)).toMatchObject({
          sessionId: 'session-1',
          running: false,
        });
      },
      { timeout: 5000 },
    );
    release.resolve();
  });

  it('preserves a running daemon turn on dispose (reload keeps the turn alive)', async () => {
    const release = deferred<void>();
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        yield { type: 'text-delta', text: 'working' };
        await release.promise;
        yield successfulTurn();
      }),
      { supportsBackgroundTurns: () => true },
    );
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Long background work');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    // Reload/deactivate goes through dispose: the daemon-side turn
    // must be detached, never interrupted.
    await controller.dispose();
    expect(runtime.dispose).toHaveBeenCalledWith({
      preserveBackendTurn: true,
    });
    release.resolve();
  });

  it('still interrupts a running process-mode turn on dispose', async () => {
    const release = deferred<void>();
    // No supportsBackgroundTurns: a process session dies with the
    // extension host, so dispose keeps the interrupt semantics.
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'working' };
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Long process work');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    await controller.dispose();
    expect(runtime.dispose).toHaveBeenCalledWith(undefined);
    release.resolve();
  });

  it('does not preserve an idle daemon session on dispose', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      supportsBackgroundTurns: () => true,
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    // No live turn: nothing to detach, plain close.
    await controller.dispose();
    expect(runtime.dispose).toHaveBeenCalledWith(undefined);
  });

  it('seeds running flags from the daemon opened-session registry on catalog loads', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      supportsBackgroundTurns: () => true,
    });
    let workingState = 'thinking';
    const daemon = {
      readOpenedWorkingStates: vi.fn(
        async () => new Map([['session-2', workingState]]),
      ),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    // A session another window (or the CLI) keeps busy gains the flag
    // without any local turn.
    await vi.waitFor(() => {
      expect(runningStates(messages).at(-1)).toMatchObject({
        sessionId: 'session-2',
        running: true,
      });
    });
    // The daemon advertises daemon-backed switching in the snapshot.
    expect(
      snapshots(messages).at(-1)?.backgroundTurnsAvailable,
    ).toBe(true);

    // The poll clears the flag once the daemon reports it idle.
    workingState = 'idle';
    await vi.waitFor(
      () => {
        expect(runningStates(messages).at(-1)).toMatchObject({
          sessionId: 'session-2',
          running: false,
        });
      },
      { timeout: 5000 },
    );
  });

  it('creates a worktree session through the daemon and annotates the row', async () => {
    const initial = createMockRuntime();
    const replacement = Object.assign(createMockRuntime(), {
      // The daemon runs the session in the worktree, not the
      // requested workspace cwd.
      getSessionCwd: vi.fn(() => 'C:\\workspace-wt-main-wt'),
    });
    replacement.initialize.mockResolvedValue(available('wt-session'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      worktreeFeature({ branch: 'main-wt' }),
    );
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        snapshots(messages).at(-1)?.worktreeCreateAvailable,
      ).toBe(true);
    });

    controller.handleMessage({ type: 'worktree.createSession' });

    await vi.waitFor(() => {
      expect(replacement.initialize).toHaveBeenCalledWith({
        kind: 'new',
        cwd: 'C:\\workspace',
        worktree: true,
      });
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'wt-session',
            active: true,
            worktree: {
              branch: 'main-wt',
              path: 'C:\\workspace-wt-main-wt',
            },
          }),
        ]),
      );
    });
  });

  it('fails worktree creation closed without the daemon feature', async () => {
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);

    // Process mode: no capability advertised, request answered with a
    // diagnostic instead of a silent plain session.
    expect(
      snapshots(messages).at(-1)?.worktreeCreateAvailable,
    ).toBeUndefined();
    controller.handleMessage({ type: 'worktree.createSession' });

    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'worktree-create-unavailable',
    });
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('carries the workspace root on snapshots and omits it rootless', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)?.workspaceRoot).toBe(
      'C:\\workspace',
    );

    // Without a usable workspace, the field is omitted so webview
    // path rebasing fails closed.
    const rootless = createController(() => createMockRuntime(), {
      cwd: null,
      trusted: true,
    });
    ready(rootless.controller);
    await Promise.resolve();
    for (const snapshot of snapshots(rootless.messages)) {
      expect(snapshot.workspaceRoot).toBeUndefined();
    }
  });

  it('withholds the worktree capability in non-git workspaces', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      worktreeFeature({ branch: 'main-wt', isGit: false }),
    );
    ready(controller);
    await waitForConnected(messages);

    expect(
      snapshots(messages).at(-1)?.worktreeCreateAvailable,
    ).toBeUndefined();
    controller.handleMessage({ type: 'worktree.createSession' });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'worktree-create-unavailable',
    });
  });

  it('advertises the btw capability only when a sidecar factory is wired', async () => {
    const withFactory = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => createBtwSidecarStub().sidecar,
    );
    ready(withFactory.controller);
    await waitForConnected(withFactory.messages);
    expect(snapshots(withFactory.messages).at(-1)?.btwAvailable).toBe(
      true,
    );

    // Without a wired factory the flag is omitted (fail closed) and
    // stray asks drop without side effects.
    const without = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(without.controller);
    await waitForConnected(without.messages);
    expect(
      snapshots(without.messages).at(-1)?.btwAvailable,
    ).toBeUndefined();
    without.controller.handleMessage({
      type: 'btw.ask',
      sessionId: 'session-1',
      text: 'Anything?',
    });
    expect(
      without.messages.some((message) => message.type === 'session.btw'),
    ).toBe(false);
  });

  it('streams a side question into session.btw without touching the transcript', async () => {
    const stub = createBtwSidecarStub(['An ', 'answer.']);
    const factory = vi.fn<BtwSidecarFactory>(async () => stub.sidecar);
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      factory,
    );
    ready(controller);
    await waitForConnected(messages);
    const transcriptBefore =
      snapshots(messages).at(-1)?.transcript ?? [];

    controller.handleMessage({
      type: 'btw.ask',
      sessionId: 'session-1',
      text: 'What is a fork?',
    });
    await vi.waitFor(() => {
      const card = messages
        .filter((message) => message.type === 'session.btw')
        .at(-1);
      expect(card?.btw.entries).toMatchObject([
        {
          question: 'What is a fork?',
          answer: 'An answer.',
          state: 'done',
        },
      ]);
    });
    expect(factory).toHaveBeenCalledExactlyOnceWith(
      'C:\\workspace',
      'session-1',
    );

    // Card traffic rides its own channel: the main transcript and the
    // session catalog never see the hidden fork.
    expect(snapshots(messages).at(-1)?.transcript ?? []).toEqual(
      transcriptBefore,
    );

    // Asks for a session other than the bound one are stale and drop.
    controller.handleMessage({
      type: 'btw.ask',
      sessionId: 'other-session',
      text: 'Stale?',
    });
    await Promise.resolve();
    expect(stub.asks).toEqual(['What is a fork?']);

    // Closing the card discards the fork.
    controller.handleMessage({
      type: 'btw.dismiss',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(stub.dispose).toHaveBeenCalled();
    });
  });

  it('discards the btw fork when the session binding changes', async () => {
    const stub = createBtwSidecarStub();
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => stub.sidecar,
    );
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'btw.ask',
      sessionId: 'session-1',
      text: 'Before the switch?',
    });
    await vi.waitFor(() => {
      expect(stub.asks).toEqual(['Before the switch?']);
    });

    controller.handleMessage({ type: 'session.new' });
    await vi.waitFor(() => {
      expect(stub.dispose).toHaveBeenCalled();
    });
  });

  it('lists registered worktree sessions from their worktree cwd', async () => {
    const feature = worktreeFeature({ branch: 'wt-branch' });
    await feature.store.record('C:\\workspace', 'wt-session', {
      branch: 'wt-branch',
      path: 'C:\\workspace-wt',
    });
    // The workspace catalog never returns worktree sessions; they
    // only list under their worktree cwd.
    const catalog: SessionCatalog = {
      listSessions: vi.fn(
        async (cwd: string): Promise<SessionCatalogResult> => ({
          status: 'available',
          sessions:
            cwd === 'C:\\workspace-wt'
              ? [catalogEntry('wt-session')]
              : [catalogEntry('session-1')],
        }),
      ),
    };
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      feature,
    );
    ready(controller);
    await waitForConnected(messages);

    expect(catalog.listSessions).toHaveBeenCalledWith(
      'C:\\workspace-wt',
    );
    expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'session-1' }),
        expect.objectContaining({
          id: 'wt-session',
          worktree: { branch: 'wt-branch', path: 'C:\\workspace-wt' },
        }),
      ]),
    );
  });

  it('renames the active session through the runtime and retitles the catalog', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      rename: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);

    // Wrong session id is ignored.
    controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-other',
      title: 'Ignored',
    });
    expect(runtime.rename).not.toHaveBeenCalled();

    controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-1',
      title: '  Fireworks demo  ',
    });
    expect(runtime.rename).toHaveBeenCalledWith('Fireworks demo');
    await vi.waitFor(() => {
      const snapshot = messages
        .filter(
          (message) => message.type === 'host.snapshot',
        )
        .at(-1);
      expect(snapshot).toMatchObject({
        sessions: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'session-1',
              title: 'Fireworks demo',
              active: true,
            }),
          ]),
        },
      });
    });
  });

  it('reports a safe diagnostic when the runtime cannot rename', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      rename: vi.fn(async () => {
        throw new Error('private SDK failure detail');
      }),
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'New title',
    });
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({
        type: 'runtime.diagnostic',
        code: 'session-rename-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private SDK failure detail',
    );

    // A runtime without rename support reports unsupported.
    const bare = createMockRuntime();
    const second = createController(
      () => bare,
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(second.controller);
    await waitForConnected(second.messages);
    second.controller.handleMessage({
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'New title',
    });
    expect(second.messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-rename-unsupported',
    });
  });

  it('writes a favorite through the catalog and re-lists the sessions', async () => {
    let favored = false;
    const writeFavorite = vi.fn(async (_id: string, favorite: boolean) => {
      favored = favorite;
      return true;
    });
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [
          catalogEntry('session-1'),
          { ...catalogEntry('session-2'), isFavorite: favored },
        ],
      })),
      writeFavorite,
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'session-2',
      favorite: true,
    });
    expect(writeFavorite).toHaveBeenCalledWith('session-2', true);
    await vi.waitFor(() => {
      const snapshot = messages
        .filter((message) => message.type === 'host.snapshot')
        .at(-1);
      expect(snapshot).toMatchObject({
        sessions: {
          status: 'ready',
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'session-2',
              isFavorite: true,
            }),
          ]),
        },
      });
    });
  });

  it('rejects favorite writes for unknown sessions and unsupported catalogs', async () => {
    const writeFavorite = vi.fn(async () => true);
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [catalogEntry('session-1')],
      })),
      writeFavorite,
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'forged-session',
      favorite: true,
    });
    expect(writeFavorite).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-favorite-invalid',
    });

    // A catalog without a favorites writer reports unsupported.
    const second = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
    );
    ready(second.controller);
    await waitForConnected(second.messages);
    second.controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: true,
    });
    expect(second.messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-favorite-unsupported',
    });
  });

  it('reports a safe diagnostic when the favorites file write fails', async () => {
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [catalogEntry('session-1')],
      })),
      writeFavorite: vi.fn(async () => {
        throw new Error('C:\\Users\\person\\.factory\\.favorites');
      }),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: true,
    });
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({
        type: 'runtime.diagnostic',
        code: 'session-favorite-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain('.favorites');
  });

  it('archives a session through the daemon and re-lists both catalogs', async () => {
    let archived = false;
    const daemon = {
      archive: vi.fn(async () => {
        archived = true;
        return true;
      }),
      listArchived: vi.fn(async () =>
        archived
          ? [
              {
                id: 'session-2',
                title: 'Session session-2',
                modifiedTime: '2026-01-02T03:04:05.000Z',
                archivedTime: '2026-01-03T03:04:05.000Z',
              },
            ]
          : [],
      ),
    };
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: archived
          ? [catalogEntry('session-1')]
          : [catalogEntry('session-1'), catalogEntry('session-2')],
      })),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-2',
    });

    await vi.waitFor(() => {
      const archivedState = messages
        .filter((message) => message.type === 'session.archived')
        .at(-1);
      expect(archivedState).toMatchObject({
        archived: {
          status: 'ready',
          items: [expect.objectContaining({ id: 'session-2' })],
        },
      });
    });
    expect(daemon.archive).toHaveBeenCalledWith('session-2');
    const snapshot = messages
      .filter((message) => message.type === 'host.snapshot')
      .at(-1);
    expect(
      snapshot?.sessions.items.some(({ id }) => id === 'session-2'),
    ).toBe(false);
  });

  it('rejects archiving the active or unknown sessions and unsupported runtimes', async () => {
    const daemon = { archive: vi.fn() };
    const catalog = createCatalog([
      catalogEntry('session-1'),
      catalogEntry('session-2'),
    ]);
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-1',
    });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-archive-active',
    });

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'forged-session',
    });
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-archive-invalid',
    });
    expect(daemon.archive).not.toHaveBeenCalled();

    // Without a daemon provider the feature reports unsupported.
    const second = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
    );
    ready(second.controller);
    await waitForConnected(second.messages);
    second.controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-2',
    });
    expect(second.messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'session-archive-unsupported',
    });
  });

  it('maps daemon availability failures to fixed sign-in guidance', async () => {
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new DaemonAvailabilityError(
          'not-logged-in',
          'C:\\Users\\person\\.factory\\auth-detail-must-not-leak',
        );
      },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.archive',
      sessionId: 'session-2',
    });
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({
        type: 'runtime.diagnostic',
        code: 'session-archive-failed',
        message: expect.stringContaining('Sign in'),
      });
    });
    expect(JSON.stringify(messages)).not.toContain('auth-detail');
  });

  it('restores an archived session and refreshes the archived list', async () => {
    let archived = true;
    const daemon = {
      unarchive: vi.fn(async () => {
        archived = false;
        return true;
      }),
      listArchived: vi.fn(async () =>
        archived
          ? [
              {
                id: 'session-9',
                title: 'Session session-9',
                modifiedTime: '2026-01-02T03:04:05.000Z',
                archivedTime: '2026-01-03T03:04:05.000Z',
              },
            ]
          : [],
      ),
    };
    const catalog: SessionCatalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: archived
          ? [catalogEntry('session-1')]
          : [catalogEntry('session-1'), catalogEntry('session-9')],
      })),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.unarchive',
      sessionId: 'session-9',
    });

    await vi.waitFor(() => {
      const archivedState = messages
        .filter((message) => message.type === 'session.archived')
        .at(-1);
      expect(archivedState).toMatchObject({
        archived: { status: 'ready', items: [] },
      });
    });
    expect(daemon.unarchive).toHaveBeenCalledWith('session-9');
    const snapshot = messages
      .filter((message) => message.type === 'host.snapshot')
      .at(-1);
    expect(
      snapshot?.sessions.items.some(({ id }) => id === 'session-9'),
    ).toBe(true);
  });

  it('answers an archived refresh with loading then ready states', async () => {
    const daemon = {
      listArchived: vi.fn(async () => [
        {
          id: 'session-8',
          title: 'Archived eight',
          modifiedTime: '2026-01-02T03:04:05.000Z',
          archivedTime: '2026-01-03T03:04:05.000Z',
        },
      ]),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.archivedRefresh' });

    await vi.waitFor(() => {
      const states = messages
        .filter((message) => message.type === 'session.archived')
        .map((message) => message.archived.status);
      expect(states).toEqual(['loading', 'ready']);
    });
    expect(daemon.listArchived).toHaveBeenCalledWith('C:\\workspace');
  });

  it('answers content searches and keeps daemon errors generic', async () => {
    const daemon = {
      search: vi.fn(async (query: string) => [
        {
          id: 'session-1',
          title: 'Hit one',
          modifiedTime: '2026-01-02T03:04:05.000Z',
          snippet: `matched ${query}`,
        },
      ]),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => daemon as unknown as DaemonSessionCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.search',
      query: 'refactor',
    });
    await vi.waitFor(() => {
      expect(
        messages
          .filter((message) => message.type === 'session.searchResults')
          .at(-1),
      ).toMatchObject({
        search: {
          status: 'ready',
          query: 'refactor',
          items: [expect.objectContaining({ id: 'session-1' })],
        },
      });
    });

    // A failing daemon search returns a fixed message, not SDK detail.
    daemon.search.mockRejectedValueOnce(
      new Error('ws://127.0.0.1:12345 payload-must-not-leak'),
    );
    controller.handleMessage({
      type: 'session.search',
      query: 'second',
    });
    await vi.waitFor(() => {
      expect(
        messages
          .filter((message) => message.type === 'session.searchResults')
          .at(-1),
      ).toMatchObject({
        search: { status: 'error', query: 'second' },
      });
    });
    expect(JSON.stringify(messages)).not.toContain('payload-must-not-leak');
  });
});
