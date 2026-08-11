import {
  AutonomyLevel,
  ConnectionError,
  ContextStatsAccuracy,
  DroidInteractionMode,
  InvalidSessionCwdError,
  ModelProvider,
  ReasoningEffort,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type AvailableModelConfig,
  type ClientAskUserHandler,
  type ClientPermissionHandler,
  type DroidStreamEvent,
  type DroidObservability,
  type SessionSettings,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import {
  FactoryDroidRuntime,
  createLocalDroidSession,
  type FactoryDroidSession,
  type FactoryDroidSessionFactory,
} from './FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from './runtimeInteractions';

describe('FactoryDroidRuntime', () => {
  it('creates one cwd-scoped session and streams a text turn', async () => {
    const session = createMockSession(async function* () {
      yield textDelta('hello');
      yield {
        type: 'assistant_text_complete',
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield successfulResult();
    });
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);

    const first = await runtime.initialize('C:\\workspace');
    const second = await runtime.initialize('C:\\workspace');
    const events = await collect(runtime.sendTurn('Say hello'));

    expect(first).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
      cliVersion: null,
      authenticationStatus: 'unknown',
    });
    expect(second).toEqual(first);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith({
      target: {
        kind: 'new',
        cwd: 'C:\\workspace',
      },
      interactionHandler: cancellingRuntimeInteractionHandler,
    });
    expect(session.stream).toHaveBeenCalledWith('Say hello', {
      includePartialMessages: true,
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      {
        type: 'turn-complete',
        outcome: 'success',
      },
    ]);
  });

  it('records bounded lifecycle timings without prompt content', async () => {
    const session = createMockSession(async function* () {
      yield textDelta('hello');
      yield successfulResult();
    });
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });

    await runtime.initialize('C:\\workspace');
    await collect(runtime.sendTurn('private prompt content'));

    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.turn.started',
      attributes: { textLength: 22 },
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.turn.finished',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'success',
        projectedEventCount: 2,
        toolStartCount: 0,
        toolProgressCount: 0,
        toolResultCount: 0,
      },
    });
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain(
      'private prompt content',
    );
  });

  it('initializes an explicit resumed session target once', async () => {
    const session = createMockSession(async function* () {});
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);
    const target = {
      kind: 'resume' as const,
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    };

    const first = await runtime.initialize(target);
    const second = await runtime.initialize({ ...target });

    expect(first).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
    });
    expect(second).toEqual(first);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith({
      target,
      interactionHandler: cancellingRuntimeInteractionHandler,
    });
  });

  it('rewinds to a user message and adopts the forked session', async () => {
    const forked = {
      ...createMockSession(async function* () {
        yield textDelta('from fork');
        yield successfulResult();
      }),
      id: 'session-fork',
    };
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        rewind: vi.fn(async () => ({ session: forked })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const result = await runtime.rewind({
      messageId: 'sdk-msg-1',
      forkTitle: 'Edited prompt',
    });

    expect(result).toEqual({ sessionId: 'session-fork' });
    expect(session.rewind).toHaveBeenCalledWith({
      messageId: 'sdk-msg-1',
      filesToRestore: [],
      filesToDelete: [],
      forkTitle: 'Edited prompt',
    });

    const events = await collect(runtime.sendTurn('again'));
    expect(forked.stream).toHaveBeenCalledWith('again', {
      includePartialMessages: true,
    });
    expect(session.stream).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'text-delta', text: 'from fork' },
      { type: 'turn-complete', outcome: 'success' },
    ]);
  });

  it('refuses to rewind without session support or during a turn', async () => {
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.rewind({ messageId: 'sdk-msg-1', forkTitle: 'Edited' }),
    ).rejects.toThrow('does not support rewind');
  });

  it('compacts the session and adopts the continuation session', async () => {
    const continuation = {
      ...createMockSession(async function* () {
        yield textDelta('after compaction');
        yield successfulResult();
      }),
      id: 'session-compacted',
    };
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        compact: vi.fn(async () => ({
          session: continuation,
          removedCount: 12,
        })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const result = await runtime.compact();
    expect(result).toEqual({
      sessionId: 'session-compacted',
      removedCount: 12,
    });

    const events = await collect(runtime.sendTurn('next'));
    expect(continuation.stream).toHaveBeenCalledWith('next', {
      includePartialMessages: true,
    });
    expect(session.stream).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'text-delta', text: 'after compaction' },
      { type: 'turn-complete', outcome: 'success' },
    ]);

    const bare = createRuntime(async () =>
      createMockSession(async function* () {}),
    );
    await bare.initialize('C:\\workspace');
    await expect(bare.compact()).rejects.toThrow(
      'does not support compaction',
    );
  });

  it('projects only safe skill fields and enforces toggle success', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        listSkills: vi.fn(async () => ({
          skills: [
            {
              name: 'code-review',
              description: 'Reviews code changes.',
              location: 'project',
              filePath: 'C:\\secret\\SKILL.md',
              content: 'SECRET BODY',
              enabled: true,
              userInvocable: true,
            },
            {
              name: 'quiet-skill',
              location: 'builtin',
              filePath: 'C:\\secret\\other.md',
              enabled: false,
            },
            { name: 'broken', location: 'mars' },
            { name: '', location: 'project' },
          ],
        })),
        setSkillDisabled: vi.fn(async () => ({ success: false })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const skills = await runtime.listSkills();
    expect(skills).toEqual([
      {
        name: 'code-review',
        description: 'Reviews code changes.',
        location: 'project',
        enabled: true,
        userInvocable: true,
      },
      {
        name: 'quiet-skill',
        description: null,
        location: 'builtin',
        enabled: false,
        userInvocable: false,
      },
    ]);
    expect(JSON.stringify(skills)).not.toContain('secret');
    expect(JSON.stringify(skills)).not.toContain('SECRET BODY');

    await expect(
      runtime.setSkillDisabled('code-review', true),
    ).rejects.toThrow('refused');
    expect(session.setSkillDisabled).toHaveBeenCalledWith({
      skillName: 'code-review',
      disabled: true,
    });

    const bare = createRuntime(async () =>
      createMockSession(async function* () {}),
    );
    await bare.initialize('C:\\workspace');
    await expect(bare.listSkills()).rejects.toThrow(
      'does not support skills',
    );
  });

  it('projects safe MCP servers with grouped tools and enforces toggle success', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        listMcpServers: vi.fn(async () => ({
          servers: [
            {
              name: 'linear',
              status: 'connected',
              toolCount: 2,
              requiresAuth: false,
              error: 'SECRET CONNECTION ERROR',
              authUrl: 'https://secret.example/auth',
            },
            {
              name: 'sentry',
              status: 'disabled',
              requiresAuth: true,
            },
            { name: 'broken', status: 'on-fire' },
            { name: '', status: 'connected' },
            {
              name: 'linear',
              status: 'failed',
            },
          ],
        })),
        listMcpTools: vi.fn(async () => [
          {
            serverName: 'linear',
            name: 'list-issues',
            description: 'Lists issues.',
            isEnabled: true,
            isReadOnly: true,
            inputSchema: { type: 'object' },
          },
          {
            serverName: 'linear',
            name: 'create-issue',
            isEnabled: false,
          },
          // Duplicate tool names collapse to the first occurrence.
          {
            serverName: 'linear',
            name: 'list-issues',
            isEnabled: false,
          },
          { serverName: 'unknown-server', name: 'orphan' },
          { serverName: 'linear', name: '' },
        ]),
        toggleMcpServer: vi.fn(async () => ({ success: false })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const servers = await runtime.listMcpServers();
    expect(servers).toEqual([
      {
        name: 'linear',
        status: 'connected',
        toolCount: 2,
        requiresAuth: false,
        tools: [
          {
            name: 'list-issues',
            description: 'Lists issues.',
            enabled: true,
            readOnly: true,
          },
          {
            name: 'create-issue',
            description: null,
            enabled: false,
            readOnly: false,
          },
        ],
      },
      {
        name: 'sentry',
        status: 'disabled',
        toolCount: null,
        requiresAuth: true,
        tools: [],
      },
    ]);
    expect(JSON.stringify(servers)).not.toContain('SECRET');
    expect(JSON.stringify(servers)).not.toContain('secret.example');

    await expect(
      runtime.setMcpServerEnabled('linear', false),
    ).rejects.toThrow('refused');
    expect(session.toggleMcpServer).toHaveBeenCalledWith({
      serverName: 'linear',
      enabled: false,
      settingsLevel: 'user',
    });

    const bare = createRuntime(async () =>
      createMockSession(async function* () {}),
    );
    await bare.initialize('C:\\workspace');
    await expect(bare.listMcpServers()).rejects.toThrow(
      'does not support MCP',
    );
  });

  it('renames the active session through the SDK', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      { rename: vi.fn(async () => {}) },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await runtime.rename('Fireworks demo');
    expect(session.rename).toHaveBeenCalledWith({
      title: 'Fireworks demo',
    });

    const bare = createMockSession(async function* () {});
    const bareRuntime = createRuntime(async () => bare);
    await bareRuntime.initialize('C:\\workspace');
    await expect(bareRuntime.rename('Nope')).rejects.toThrow(
      'does not support rename',
    );
  });

  it('projects settings and context through runtime-owned DTOs', async () => {
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readSessionSettings()).resolves.toEqual({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
    });
    await expect(runtime.readContextStats()).resolves.toEqual({
      used: 40,
      remaining: 60,
      limit: 100,
      accuracy: 'exact',
    });
    await expect(runtime.readModelCatalog()).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('accepts SDK-valid context values without inventing cross-field constraints', async () => {
    const session = createMockSession(async function* () {});
    session.getContextStats.mockResolvedValue({
      used: 101,
      remaining: 108,
      limit: 100,
      accuracy: ContextStatsAccuracy.Estimated,
      updatedAt: new Date().toISOString(),
    });
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextStats()).resolves.toEqual({
      used: 101,
      remaining: 108,
      limit: 100,
      accuracy: 'estimated',
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.context.finished',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'success',
        accuracy: 'estimated',
        arithmeticDelta: 109,
      },
    });
  });

  it('projects only BYOK models from the real startup catalog', async () => {
    const session = createMockSession(async function* () {});
    session.availableModels = [
      availableModel('model-sol', 'Model Sol', [
        ReasoningEffort.Low,
        ReasoningEffort.Medium,
        ReasoningEffort.High,
      ]),
      availableModel('custom:model-pro', 'Model Pro', [
        ReasoningEffort.None,
      ]),
    ];
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readModelCatalog()).resolves.toEqual({
      status: 'available',
      items: [
        {
          id: 'custom:model-pro',
          displayName: 'Model Pro',
          supportedReasoningEfforts: ['none'],
        },
      ],
    });
  });

  it('fails closed when the captured model catalog is invalid', async () => {
    const session = createMockSession(async function* () {});
    session.availableModels = [
      availableModel('duplicate', 'Model One', [ReasoningEffort.Medium]),
      availableModel('duplicate', 'Model Two', [ReasoningEffort.High]),
    ];
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readModelCatalog()).rejects.toThrow(
      'Droid returned an invalid model catalog.',
    );
  });

  it('updates one setting and rereads authoritative session settings', async () => {
    const session = createMockSession(async function* () {});
    session.updateSettings.mockImplementation(async (params) => {
      expect(params).toEqual({
        interactionMode: DroidInteractionMode.Spec,
      });
      session.settings.interactionMode = DroidInteractionMode.Mission;
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.updateSessionSetting({
        field: 'interactionMode',
        value: 'spec',
      }),
    ).resolves.toMatchObject({ interactionMode: 'mission' });
    expect(session.updateSettings).toHaveBeenCalledOnce();
  });

  it('projects autonomy updates to the Droid SDK session', async () => {
    const session = createMockSession(async function* () {});
    session.updateSettings.mockImplementation(async (params) => {
      expect(params).toEqual({
        autonomyLevel: AutonomyLevel.High,
      });
      session.settings.autonomyLevel = AutonomyLevel.High;
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.updateSessionSetting({
        field: 'autonomyLevel',
        value: 'high',
      }),
    ).resolves.toMatchObject({ autonomyLevel: 'high' });
    expect(session.updateSettings).toHaveBeenCalledOnce();
  });

  it('rejects malformed SDK settings, context, and update values safely', async () => {
    const session = createMockSession(async function* () {});
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });
    await runtime.initialize('C:\\workspace');

    session.settings.interactionMode = DroidInteractionMode.AGI;
    await expect(runtime.readSessionSettings()).rejects.toThrow(
      'Droid returned invalid session settings.',
    );
    session.settings.interactionMode = DroidInteractionMode.Auto;
    session.getContextStats.mockResolvedValue({
      used: -1,
      remaining: 0,
      limit: 100,
      accuracy: ContextStatsAccuracy.Estimated,
      updatedAt: new Date().toISOString(),
    });
    await expect(runtime.readContextStats()).rejects.toThrow(
      'Droid context statistics could not be read.',
    );
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'error',
      name: 'runtime.context.finished',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'invalid-stats',
        reason: 'negative',
      },
    });
    await expect(
      runtime.updateSessionSetting({
        field: 'modelId',
        value: 'x'.repeat(257),
      }),
    ).rejects.toThrow('Invalid session setting update.');
    await expect(
      runtime.updateSessionSetting(
        new Proxy(
          { field: 'autonomyLevel', value: 'high' },
          {
            ownKeys() {
              throw new Error('sensitive hostile trap');
            },
          },
        ) as never,
      ),
    ).rejects.toThrow('Invalid session setting update.');
    expect(session.updateSettings).not.toHaveBeenCalled();
  });

  it('replaces SDK read and update errors with generic runtime failures', async () => {
    const session = createMockSession(async function* () {});
    session.getContextStats.mockRejectedValue(
      new Error('sensitive context failure'),
    );
    session.updateSettings.mockRejectedValue(
      new Error('sensitive settings failure'),
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextStats()).rejects.toThrow(
      'Droid context statistics could not be read.',
    );
    await expect(
      runtime.updateSessionSetting({
        field: 'autonomyLevel',
        value: 'high',
      }),
    ).rejects.toThrow(
      'Droid session settings could not be updated.',
    );
  });

  it('yields only defined semantic events from the SDK stream', async () => {
    const session = createMockSession(async function* () {
      yield {
        type: 'thinking_text_delta',
        messageId: 'message-1',
        blockIndex: 0,
        text: 'Considering',
      };
      yield {
        type: 'session_title_updated',
        title: 'Sensitive title',
      };
      yield {
        type: 'tool_progress',
        toolUseId: 'tool-1',
        toolName: 'Read',
        content: 'sensitive progress',
        update: {
          type: 'message',
          text: 'sensitive update',
        },
      };
    });
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');

    await expect(collect(runtime.sendTurn('Continue'))).resolves.toEqual([
      {
        type: 'thinking-delta',
        text: 'Considering',
      },
      {
        type: 'tool-progress',
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        updateKind: 'message',
      },
    ]);
  });

  it('interrupts only an active turn and keeps the stream terminal event', async () => {
    const interrupted = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('before stop');
      await interrupted.promise;
      yield interruptedResult();
    });
    session.interrupt.mockImplementation(async () => interrupted.resolve());
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    await runtime.interrupt();

    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', text: 'before stop' },
    });

    await runtime.interrupt();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'turn-complete',
        outcome: 'interrupted',
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    expect(session.interrupt).toHaveBeenCalledOnce();
  });

  it('rejects concurrent turns until the active stream is finished', async () => {
    const release = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('first');
      await release.promise;
      yield successfulResult();
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const first = runtime.sendTurn('First turn')[Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'text-delta', text: 'first' },
    });

    await expect(collect(runtime.sendTurn('Second turn'))).rejects.toThrow(
      'Droid runtime already has an active turn.',
    );

    release.resolve();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'turn-complete', outcome: 'success' },
    });
    await expect(first.next()).resolves.toMatchObject({ done: true });
    await expect(collect(runtime.sendTurn('Third turn'))).resolves.toHaveLength(
      2,
    );
  });

  it('updates authoritative session settings during an active stream', async () => {
    const release = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('first');
      await release.promise;
      yield successfulResult();
    });
    session.updateSettings.mockImplementation(async (params) => {
      expect(params).toEqual({ autonomyLevel: AutonomyLevel.High });
      session.settings.autonomyLevel = AutonomyLevel.High;
      return {};
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const turn = runtime.sendTurn('Keep working')[Symbol.asyncIterator]();
    await expect(turn.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'text-delta', text: 'first' },
    });

    await expect(
      runtime.updateSessionSetting({
        field: 'autonomyLevel',
        value: 'high',
      }),
    ).resolves.toMatchObject({ autonomyLevel: 'high' });
    expect(session.updateSettings).toHaveBeenCalledOnce();

    release.resolve();
    await expect(turn.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'turn-complete', outcome: 'success' },
    });
    await expect(turn.next()).resolves.toMatchObject({ done: true });
  });

  it('drops late stream events and disposes an active session once', async () => {
    const lateEvent = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('before disposal');
      await lateEvent.promise;
      yield textDelta('late event');
    });
    session.interrupt.mockImplementation(async () => lateEvent.resolve());
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await iterator.next();

    const firstDisposal = runtime.dispose();
    const secondDisposal = runtime.dispose();

    expect(secondDisposal).toBe(firstDisposal);
    await firstDisposal;
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    expect(() => runtime.initialize('C:\\workspace')).toThrow(
      'Droid runtime is disposed.',
    );
  });

  it('retries a failed close without losing the owned session', async () => {
    const session = createMockSession(async function* () {});
    session.close
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce();
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);
    await runtime.initialize('C:\\workspace');

    const firstDisposal = runtime.dispose();
    expect(runtime.dispose()).toBe(firstDisposal);
    await expect(firstDisposal).rejects.toThrow('close failed');
    expect(() => runtime.initialize('C:\\workspace')).toThrow(
      'Droid runtime is disposed.',
    );
    await expect(collect(runtime.sendTurn('No turn'))).rejects.toThrow(
      'Droid runtime is disposed.',
    );

    await expect(runtime.dispose()).resolves.toBeUndefined();

    expect(session.close).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('closes the owned session even when active-turn interruption fails', async () => {
    const waiting = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('active');
      await waiting.promise;
    });
    session.interrupt.mockRejectedValue(new Error('interrupt failed'));
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await iterator.next();

    await expect(runtime.dispose()).rejects.toThrow('interrupt failed');

    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    waiting.resolve();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('closes a session that arrives after disposal starts', async () => {
    const created = deferred<FactoryDroidSession>();
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(() => created.promise);

    const initialization = runtime.initialize('C:\\workspace');
    const disposal = runtime.dispose();
    created.resolve(session);

    await expect(initialization).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'initialization-failed',
    });
    await disposal;
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('surfaces close failures when disposal races initialization', async () => {
    const created = deferred<FactoryDroidSession>();
    const session = createMockSession(async function* () {});
    session.close
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce();
    const runtime = createRuntime(() => created.promise);

    const initialization = runtime.initialize('C:\\workspace');
    const disposal = runtime.dispose();
    created.resolve(session);

    await expect(initialization).rejects.toThrow('close failed');
    await expect(disposal).rejects.toThrow('close failed');
    expect(session.close).toHaveBeenCalledOnce();

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('reports structured initialization failures without parsing messages', async () => {
    const invalidCwd = createRuntime(async ({ target }) => {
      throw new InvalidSessionCwdError(
        target.cwd,
        'arbitrary SDK message',
      );
    });
    const missingCli = createRuntime(async () => {
      throw new ConnectionError('arbitrary SDK message', {
        error: Object.assign(new Error('arbitrary system message'), {
          code: 'ENOENT',
        }),
      });
    });
    const unknownFailure = createRuntime(async () => {
      throw new Error('sensitive failure details');
    });

    await expect(invalidCwd.initialize('C:\\missing')).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid-cwd',
      authenticationStatus: 'unknown',
    });
    await expect(missingCli.initialize('C:\\workspace')).resolves.toMatchObject(
      {
        status: 'unavailable',
        reason: 'cli-not-found',
        authenticationStatus: 'unknown',
      },
    );
    await expect(
      unknownFailure.initialize('C:\\workspace'),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'initialization-failed',
      message: 'The Droid SDK could not initialize a session.',
      authenticationStatus: 'unknown',
    });
  });
});

describe('createLocalDroidSession', () => {
  it('connects a cwd-scoped transport before creating the SDK session', async () => {
    const calls: string[] = [];
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    transport.connect.mockImplementation(async () => {
      calls.push('connect');
    });
    const createSession = vi.fn(async (options) => {
      calls.push('createSession');
      expect(options).toMatchObject({
        cwd: 'C:\\workspace',
        transport: {
          send: expect.any(Function),
          onMessage: expect.any(Function),
          onError: expect.any(Function),
          close: expect.any(Function),
        },
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      });
      expect(options.transport).not.toBe(transport);
      expect(options).not.toHaveProperty('apiKey');
      return session;
    });
    const createTransport = vi.fn(() => transport);

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).resolves.toBe(session);

    expect(createTransport).toHaveBeenCalledWith({ cwd: 'C:\\workspace' });
    expect(calls).toEqual(['connect', 'createSession']);
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('injects one observability bundle into transport and session', async () => {
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    const observability: DroidObservability = {
      logger: { log: vi.fn() },
      metrics: { record: vi.fn() },
    };
    const createTransport = vi.fn(() => transport);
    const createSession = vi.fn(async () => session);

    await createLocalDroidSession(
      {
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler: cancellingRuntimeInteractionHandler,
        observability,
      },
      {
        createTransport,
        createSession,
        resumeSession: vi.fn(),
      },
    );

    expect(createTransport).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      observability,
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ observability }),
    );
  });

  it('wires the runtime interaction handler into SDK session callbacks', async () => {
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    let permissionHandler: ClientPermissionHandler | undefined;
    let askUserHandler: ClientAskUserHandler | undefined;
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };

    await createLocalDroidSession(
      {
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler,
      },
      {
        createTransport: () => transport,
        createSession: async (options) => {
          permissionHandler = options.permissionHandler;
          askUserHandler = options.askUserHandler;
          return session;
        },
        resumeSession: vi.fn(),
      },
    );

    await expect(
      permissionHandler?.({
        options: [
          {
            label: 'Allow once',
            value: ToolConfirmationOutcome.ProceedOnce,
          },
        ],
        toolUses: [
          {
            toolUse: {
              type: 'tool_use' as never,
              id: 'tool-1',
              name: 'Create',
              input: { secret: 'must not escape' },
            },
            confirmationType: ToolConfirmationType.Create,
            details: {
              type: ToolConfirmationType.Create,
              filePath: 'C:\\workspace\\file.ts',
              fileName: 'file.ts',
              content: 'content',
            },
          },
        ],
      }),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    await expect(
      askUserHandler?.({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 4,
            topic: 'Language',
            question: 'Which language?',
            options: ['TypeScript'],
          },
        ],
      }),
    ).resolves.toEqual({
      answers: [
        {
          index: 4,
          question: 'Which language?',
          answer: 'TypeScript',
        },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('resumes through the connected cwd transport without passing cwd to the SDK', async () => {
    const calls: string[] = [];
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    transport.connect.mockImplementation(async () => {
      calls.push('connect');
    });
    const createSession = vi.fn();
    let permissionHandler: ClientPermissionHandler | undefined;
    let askUserHandler: ClientAskUserHandler | undefined;
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };
    const resumeSession = vi.fn(async (sessionId, options) => {
      calls.push('resumeSession');
      expect(sessionId).toBe('saved-session');
      expect(options).toMatchObject({
        transport: {
          send: expect.any(Function),
          onMessage: expect.any(Function),
          onError: expect.any(Function),
          close: expect.any(Function),
        },
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      });
      expect(options.transport).not.toBe(transport);
      expect(options).not.toHaveProperty('cwd');
      permissionHandler = options.permissionHandler;
      askUserHandler = options.askUserHandler;
      return session;
    });
    const createTransport = vi.fn(() => transport);

    await expect(
      createLocalDroidSession(
        {
          target: {
            kind: 'resume',
            cwd: 'C:\\workspace',
            sessionId: 'saved-session',
          },
          interactionHandler,
        },
        { createTransport, createSession, resumeSession },
      ),
    ).resolves.toBe(session);

    expect(createTransport).toHaveBeenCalledWith({ cwd: 'C:\\workspace' });
    expect(createSession).not.toHaveBeenCalled();
    expect(calls).toEqual(['connect', 'resumeSession']);
    expect(transport.close).not.toHaveBeenCalled();

    await expect(
      permissionHandler?.({
        options: [
          {
            label: 'Allow once',
            value: ToolConfirmationOutcome.ProceedOnce,
          },
        ],
        toolUses: [
          {
            toolUse: {
              type: 'tool_use' as never,
              id: 'tool-1',
              name: 'Create',
              input: { secret: 'must not escape' },
            },
            confirmationType: ToolConfirmationType.Create,
            details: {
              type: ToolConfirmationType.Create,
              filePath: 'C:\\workspace\\file.ts',
              fileName: 'file.ts',
              content: 'content',
            },
          },
        ],
      }),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    await expect(
      askUserHandler?.({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 4,
            topic: 'Language',
            question: 'Which language?',
            options: ['TypeScript'],
          },
        ],
      }),
    ).resolves.toEqual({
      answers: [
        {
          index: 4,
          question: 'Which language?',
          answer: 'TypeScript',
        },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('closes the transport when connecting fails', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    transport.connect.mockRejectedValue(failure);
    transport.close.mockRejectedValue(new Error('arbitrary cleanup failure'));
    const createSession = vi.fn();

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).rejects.toBe(failure);

    expect(createSession).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('does not double-close transport cleanup owned by a failed SDK creation', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    const createSession = vi.fn(async () => {
      await transport.close();
      throw failure;
    });

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).rejects.toBe(failure);

    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('does not double-close transport cleanup owned by a failed SDK resume', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    const resumeSession = vi.fn(async () => {
      await transport.close();
      throw failure;
    });

    await expect(
      createLocalDroidSession(
        {
          target: {
            kind: 'resume',
            cwd: 'C:\\workspace',
            sessionId: 'saved-session',
          },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession: vi.fn(),
          resumeSession,
        },
      ),
    ).rejects.toBe(failure);

    expect(resumeSession).toHaveBeenCalledWith(
      'saved-session',
      expect.objectContaining({
        transport: expect.objectContaining({
          send: expect.any(Function),
        }),
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      }),
    );
    expect(transport.close).toHaveBeenCalledOnce();
  });
});

function createRuntime(createSdkSession: FactoryDroidSessionFactory) {
  return new FactoryDroidRuntime({
    interactionHandler: cancellingRuntimeInteractionHandler,
    createSdkSession,
  });
}

function createMockSession(
  streamImplementation: (
    prompt: string,
    options: { includePartialMessages: true },
  ) => AsyncGenerator<DroidStreamEvent>,
) {
  return {
    id: 'session-1',
    availableModels: undefined as readonly AvailableModelConfig[] | undefined,
    settings: {
      modelId: 'model-1',
      reasoningEffort: ReasoningEffort.High,
      interactionMode: DroidInteractionMode.Auto,
      autonomyLevel: AutonomyLevel.Medium,
    } as SessionSettings,
    stream: vi.fn(streamImplementation),
    interrupt: vi.fn(async () => {}),
    updateSettings: vi.fn<FactoryDroidSession['updateSettings']>(
      async () => ({}),
    ),
    getContextStats: vi.fn<FactoryDroidSession['getContextStats']>(
      async () => ({
        used: 40,
        remaining: 60,
        limit: 100,
        accuracy: ContextStatsAccuracy.Exact,
        updatedAt: new Date().toISOString(),
      }),
    ),
    close: vi.fn(async () => {}),
  };
}

function availableModel(
  id: string,
  displayName: string,
  supportedReasoningEfforts: readonly ReasoningEffort[],
): AvailableModelConfig {
  return {
    id,
    displayName,
    shortDisplayName: displayName,
    modelProvider: ModelProvider.FACTORY,
    supportedReasoningEfforts: [...supportedReasoningEfforts],
    defaultReasoningEffort:
      supportedReasoningEfforts[0] ?? ReasoningEffort.Medium,
    isCustom: id.startsWith('custom:'),
  };
}

function createMockTransport() {
  return {
    isConnected: false,
    connect: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    onMessage: vi.fn(),
    onError: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

function textDelta(text: string): DroidStreamEvent {
  return {
    type: 'assistant_text_delta',
    messageId: 'message-1',
    blockIndex: 0,
    text,
  };
}

function successfulResult(): Extract<
  DroidStreamEvent,
  { type: 'result'; subtype: 'success' }
> {
  return {
    type: 'result',
    subtype: 'success',
    sessionId: 'session-1',
    durationMs: 10,
    tokenUsage: null,
    messages: [],
    text: '',
    turnCount: 1,
    success: true,
    interrupted: false,
    error: null,
  };
}

function interruptedResult(): Extract<
  DroidStreamEvent,
  { type: 'result'; subtype: 'interrupted' }
> {
  return {
    type: 'result',
    subtype: 'interrupted',
    sessionId: 'session-1',
    durationMs: 10,
    tokenUsage: null,
    messages: [],
    text: '',
    turnCount: 1,
    success: false,
    interrupted: true,
    error: null,
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) {
    result.push(value);
  }
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}
