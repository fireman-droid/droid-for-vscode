import { ToolConfirmationOutcome } from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import {
  DROID_CAPABILITY_DECLARATIONS,
  DROID_CAPABILITY_REPORT_VERSION,
  DROID_CAPABILITY_SCHEMA_VERSION,
  DROID_CAPABILITY_VERSIONS,
  MAX_CAPABILITY_COUNT,
} from './capabilityContract';
import {
  FactoryDroidCapabilityProbe,
  isCapabilitySmokeSuccessful,
  type CapabilitySession,
  type CapabilitySessionFactory,
  type CapabilityTransport,
  type CliVersionExecution,
} from './FactoryDroidCapabilityProbe';

describe('FactoryDroidCapabilityProbe', () => {
  it('returns an exact sanitized structural report', async () => {
    const { factory } = createFactory({
      listedSessions: [{ id: 'private-session-id' }],
    });
    const probe = new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli(
        'Droid CLI v1.2.3\nC:\\private\\must-not-escape',
      ),
    });

    const report = await probe.probe('C:\\private\\workspace');

    expect(report).toEqual({
      schemaVersion: DROID_CAPABILITY_SCHEMA_VERSION,
      reportVersion: DROID_CAPABILITY_REPORT_VERSION,
      sdkVersion: DROID_CAPABILITY_VERSIONS.sdkVersion,
      protocolVersion: DROID_CAPABILITY_VERSIONS.protocolVersion,
      cli: { state: 'supported', version: '1.2.3' },
      session: { acquisition: 'resumed', cleanup: 'succeeded' },
      observations: {
        settings: {
          state: 'supported',
          fields: {
            present: true,
            interactionMode: true,
            model: true,
            reasoning: true,
            autonomy: true,
          },
        },
        cwd: { state: 'supported', fields: { present: true } },
        tools: { state: 'supported', count: 2, countCapped: false },
        skills: { state: 'supported', count: 1, countCapped: false },
        mcpServers: {
          state: 'supported',
          count: 1,
          countCapped: false,
        },
        mcpTools: { state: 'supported', count: 1, countCapped: false },
        context: {
          state: 'supported',
          fields: {
            used: true,
            remaining: true,
            limit: true,
            accuracy: true,
          },
        },
      },
      capabilities: expect.any(Array),
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-session-id');
    expect(serialized).not.toContain('C:\\\\private\\\\workspace');
    expect(serialized).not.toContain('must-not-escape');
    expect(serialized).not.toContain('model-secret');
    expect(serialized).not.toContain('tool-secret');
    expect(serialized).not.toContain('skill-secret');
    expect(serialized).not.toContain('server-secret');
  });

  it('prefers resume and exposes only cancelling interaction handlers', async () => {
    const forbidden = {
      stream: vi.fn(),
      updateSettings: vi.fn(),
      rename: vi.fn(),
      fork: vi.fn(),
      compact: vi.fn(),
      rewind: vi.fn(),
      authenticateMcpServer: vi.fn(),
      setSkillDisabled: vi.fn(),
    };
    const { factory, resumeSession } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      sessionOverrides: forbidden,
    });
    const probe = new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    });

    const report = await probe.probe('C:\\workspace');

    expect(report.session.acquisition).toBe('resumed');
    expect(resumeSession).toHaveBeenCalledOnce();
    expect(factory).not.toHaveProperty('createSession');
    const options = resumeSession.mock.calls[0]?.[1];
    expect(options?.autoRejectPermissionRequests).toBe(true);
    await expect(options?.permissionHandler({} as never)).resolves.toBe(
      ToolConfirmationOutcome.Cancel,
    );
    await expect(options?.askUserHandler({} as never)).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
    for (const mutation of Object.values(forbidden)) {
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it('does not create or connect when no saved session exists', async () => {
    const { factory, createTransport, resumeSession, session } = createFactory({
      listedSessions: [],
    });
    const probe = new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    });

    const report = await probe.probe('C:\\workspace');

    expect(factory).not.toHaveProperty('createSession');
    expect(createTransport).not.toHaveBeenCalled();
    expect(resumeSession).not.toHaveBeenCalled();
    for (const read of [
      session.listTools,
      session.listSkills,
      session.listMcpServers,
      session.listMcpTools,
      session.getContextStats,
    ]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(report.session).toEqual({
      acquisition: 'unavailable',
      cleanup: 'not-needed',
      reason: 'no-saved-session',
    });
    expect(report.cli).toEqual({ state: 'supported', version: '1.2.3' });
    expect(report.observations).toEqual({
      settings: { state: 'unavailable', reason: 'no-saved-session' },
      cwd: { state: 'unavailable', reason: 'no-saved-session' },
      tools: { state: 'unavailable', reason: 'no-saved-session' },
      skills: { state: 'unavailable', reason: 'no-saved-session' },
      mcpServers: { state: 'unavailable', reason: 'no-saved-session' },
      mcpTools: { state: 'unavailable', reason: 'no-saved-session' },
      context: { state: 'unavailable', reason: 'no-saved-session' },
    });
    expect(capability(report, 'sessions.list')).toEqual({
      id: 'sessions.list',
      state: 'supported',
    });
    expect(capability(report, 'settings.live')).toEqual({
      id: 'settings.live',
      state: 'unavailable',
      reason: 'no-saved-session',
    });
    expect(capability(report, 'sessions.resume')).toEqual({
      id: 'sessions.resume',
      state: 'not-probed',
    });
    expect(JSON.stringify(report)).not.toContain('C:\\\\workspace');
  });

  it('isolates every read failure and continues later probes', async () => {
    const methods = {
      listTools: vi.fn(async () => {
        throw new Error('C:\\secret\\tools');
      }),
      listSkills: vi.fn(async () => ({ malformed: [] })),
      listMcpServers: vi.fn(async () => {
        throw new Error('server-secret');
      }),
      listMcpTools: vi.fn(async () => ({ malformed: [] })),
      getContextStats: vi.fn(async () => {
        throw new Error('context-secret');
      }),
    };
    const { factory } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      sessionOverrides: methods,
    });
    const probe = new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    });

    const report = await probe.probe('C:\\workspace');

    expect(report.observations.tools).toEqual({
      state: 'unavailable',
      reason: 'tools-read-failed',
    });
    expect(report.observations.skills).toEqual({
      state: 'unavailable',
      reason: 'skills-response-malformed',
    });
    expect(report.observations.mcpServers).toEqual({
      state: 'unavailable',
      reason: 'mcp-servers-read-failed',
    });
    expect(report.observations.mcpTools).toEqual({
      state: 'unavailable',
      reason: 'mcp-tools-response-malformed',
    });
    expect(report.observations.context).toEqual({
      state: 'unavailable',
      reason: 'context-read-failed',
    });
    for (const method of Object.values(methods)) {
      expect(method).toHaveBeenCalledOnce();
    }
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('fails closed for missing settings, cwd, and context fields', async () => {
    const { factory } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      sessionOverrides: {
        settings: {},
        cwd: undefined,
        getContextStats: async () => ({ used: 1, remaining: 2 }),
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(capability(report, 'settings.live')).toEqual({
      id: 'settings.live',
      state: 'supported',
    });
    for (const id of [
      'settings.mode',
      'settings.model',
      'settings.reasoning',
      'settings.autonomy',
    ] as const) {
      expect(capability(report, id)).toEqual({
        id,
        state: 'unavailable',
        reason: 'settings-field-missing',
      });
    }
    expect(capability(report, 'workspace.cwd')).toEqual({
      id: 'workspace.cwd',
      state: 'unavailable',
      reason: 'cwd-response-malformed',
    });
    expect(capability(report, 'settings.context')).toEqual({
      id: 'settings.context',
      state: 'unavailable',
      reason: 'context-response-malformed',
    });
  });

  it('requires each individual settings and context presence projection', async () => {
    const { factory } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      sessionOverrides: {
        settings: {
          interactionMode: 'mode',
          modelId: 'model',
          autonomyLevel: 'autonomy',
        },
        getContextStats: async () => ({
          used: 1,
          remaining: 2,
          limit: 3,
        }),
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(capability(report, 'settings.mode')?.state).toBe('supported');
    expect(capability(report, 'settings.model')?.state).toBe('supported');
    expect(capability(report, 'settings.autonomy')?.state).toBe('supported');
    expect(capability(report, 'settings.reasoning')).toEqual({
      id: 'settings.reasoning',
      state: 'unavailable',
      reason: 'settings-field-missing',
    });
    expect(capability(report, 'settings.context')).toEqual({
      id: 'settings.context',
      state: 'unavailable',
      reason: 'context-response-malformed',
    });
  });

  it.each([
    {
      name: 'rejects malformed output',
      execution: completedCli('Droid development build'),
      reason: 'cli-output-malformed',
    },
    {
      name: 'rejects ambiguous output',
      execution: completedCli('Droid 1.2.3 protocol 4.5.6'),
      reason: 'cli-output-malformed',
    },
    {
      name: 'rejects oversized output',
      execution: completedCli(`Droid 1.2.3 ${'x'.repeat(4_100)}`),
      reason: 'cli-output-oversized',
    },
    {
      name: 'maps timeouts',
      execution: { status: 'timeout', stdout: '', stderr: '' } as const,
      reason: 'cli-timeout',
    },
  ])('$name without returning CLI output', async ({ execution, reason }) => {
    const { factory } = createFactory({ listedSessions: [] });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => execution,
    }).probe('C:\\workspace');

    expect(report.cli).toEqual({ state: 'unavailable', reason });
    expect(JSON.stringify(report)).not.toContain('development');
    expect(JSON.stringify(report)).not.toContain('xxxxx');
  });

  it('closes the SDK session and transport after successful probes', async () => {
    const { factory, closeSession, closeTransport } = createFactory({
      listedSessions: [{ id: 'session-1' }],
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(closeSession).toHaveBeenCalledOnce();
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(report.session.cleanup).toBe('succeeded');
  });

  it('still closes the transport and sanitizes a session cleanup failure', async () => {
    const { factory, closeTransport } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      closeSession: async () => {
        throw new Error('C:\\private\\cleanup');
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(closeTransport).toHaveBeenCalledOnce();
    expect(report.session).toEqual({
      acquisition: 'resumed',
      cleanup: 'failed',
      reason: 'cleanup-failed',
    });
    expect(JSON.stringify(report)).not.toContain('private');
  });

  it('closes a transport whose connection fails', async () => {
    const { factory, closeTransport, resumeSession } =
      createFactory({
        listedSessions: [{ id: 'session-1' }],
        connectTransport: async () => {
          throw new Error('spawn failed');
        },
      });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(closeTransport).toHaveBeenCalledOnce();
    expect(resumeSession).not.toHaveBeenCalled();
    expect(report.session).toEqual({
      acquisition: 'unavailable',
      cleanup: 'succeeded',
      reason: 'session-connect-failed',
    });
  });

  it('reports a rejected resume and propagates its reason to session reads', async () => {
    const { factory } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      resumeSession: async () => {
        throw new Error('private resume failure');
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(capability(report, 'sessions.resume')).toEqual({
      id: 'sessions.resume',
      state: 'unavailable',
      reason: 'session-open-failed',
    });
    expect(report.observations.tools).toEqual({
      state: 'unavailable',
      reason: 'session-open-failed',
    });
    expect(capability(report, 'settings.live')).toEqual({
      id: 'settings.live',
      state: 'unavailable',
      reason: 'session-open-failed',
    });
    expect(JSON.stringify(report)).not.toContain('private');
  });

  it('fails closed for a malformed resumed session handle', async () => {
    const { factory, closeTransport } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      resumeSession: async () => undefined as never,
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(closeTransport).toHaveBeenCalledOnce();
    expect(report.session).toEqual({
      acquisition: 'unavailable',
      cleanup: 'succeeded',
      reason: 'session-open-response-malformed',
    });
    expect(capability(report, 'sessions.resume')).toEqual({
      id: 'sessions.resume',
      state: 'unavailable',
      reason: 'session-open-response-malformed',
    });
    expect(report.observations.settings).toEqual({
      state: 'unavailable',
      reason: 'session-open-response-malformed',
    });
  });

  it.each([
    { listedSessions: [null], reason: 'session-id-malformed' },
    { listedSessions: [{ id: '' }], reason: 'session-id-malformed' },
    { listedSessions: {} as never, reason: 'session-list-response-malformed' },
  ])(
    'fails closed for malformed session discovery: $reason',
    async ({ listedSessions, reason }) => {
      const { factory, createTransport } = createFactory({ listedSessions });
      const report = await new FactoryDroidCapabilityProbe({
        sessionFactory: factory,
        runCliVersion: async () => completedCli('1.2.3'),
      }).probe('C:\\workspace');

      expect(createTransport).not.toHaveBeenCalled();
      expect(report.session.reason).toBe(reason);
      expect(report.observations.context).toEqual({
        state: 'unavailable',
        reason,
      });
    },
  );

  it('bounds a structural read and still cleans up session and transport', async () => {
    const { factory, closeSession, closeTransport } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      sessionOverrides: {
        listTools: () => new Promise<never>(() => undefined),
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
      operationTimeoutMs: 10,
    }).probe('C:\\workspace');

    expect(report.observations.tools).toEqual({
      state: 'unavailable',
      reason: 'tools-read-timeout',
    });
    expect(closeSession).toHaveBeenCalledOnce();
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(report.session.cleanup).toBe('succeeded');
  });

  it('bounds transport connection and still attempts transport cleanup', async () => {
    const { factory, closeTransport, resumeSession } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      connectTransport: () => new Promise<never>(() => undefined),
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
      operationTimeoutMs: 10,
    }).probe('C:\\workspace');

    expect(resumeSession).not.toHaveBeenCalled();
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(report.session).toEqual({
      acquisition: 'unavailable',
      cleanup: 'succeeded',
      reason: 'session-connect-timeout',
    });
    expect(report.observations.settings.reason).toBe(
      'session-connect-timeout',
    );
  });

  it('aborts a timed-out resume and reports the attempted capability', async () => {
    let resumeSignal: AbortSignal | undefined;
    const { factory, closeTransport } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      resumeSession: (_sessionId, options) => {
        resumeSignal = options.abortSignal;
        return new Promise<never>(() => undefined);
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
      operationTimeoutMs: 10,
    }).probe('C:\\workspace');

    expect(resumeSignal?.aborted).toBe(true);
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(capability(report, 'sessions.resume')).toEqual({
      id: 'sessions.resume',
      state: 'unavailable',
      reason: 'session-open-timeout',
    });
    expect(report.observations.skills.reason).toBe('session-open-timeout');
  });

  it('bounds cleanup and returns a fixed timeout reason without hanging', async () => {
    const { factory, closeTransport } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      closeSession: () => new Promise<never>(() => undefined),
    });
    const startedAt = Date.now();
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
      operationTimeoutMs: 10,
    }).probe('C:\\workspace');

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(report.session).toEqual({
      acquisition: 'resumed',
      cleanup: 'failed',
      reason: 'session-close-timeout',
    });
  });

  it('caps structural counts and reports every declared capability once', async () => {
    const oversized = Array.from(
      { length: MAX_CAPABILITY_COUNT + 5 },
      () => null,
    );
    const { factory } = createFactory({
      listedSessions: [{ id: 'session-1' }],
      sessionOverrides: {
        listTools: async () => oversized,
        listSkills: async () => ({ skills: oversized }),
      },
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');

    expect(report.observations.tools).toEqual({
      state: 'supported',
      count: MAX_CAPABILITY_COUNT,
      countCapped: true,
    });
    expect(report.observations.skills).toEqual({
      state: 'supported',
      count: MAX_CAPABILITY_COUNT,
      countCapped: true,
    });
    expect(report.capabilities.map(({ id }) => id)).toEqual(
      DROID_CAPABILITY_DECLARATIONS.map(({ id }) => id),
    );
    expect(new Set(report.capabilities.map(({ id }) => id)).size).toBe(
      DROID_CAPABILITY_DECLARATIONS.length,
    );
    expect(
      report.capabilities.some(({ state }) => state === 'not-probed'),
    ).toBe(true);
  });

  it('requires CLI, resumed cleanup, and every smoke capability projection', async () => {
    const { factory } = createFactory({
      listedSessions: [{ id: 'session-1' }],
    });
    const report = await new FactoryDroidCapabilityProbe({
      sessionFactory: factory,
      runCliVersion: async () => completedCli('1.2.3'),
    }).probe('C:\\workspace');
    expect(isCapabilitySmokeSuccessful(report)).toBe(true);

    expect(
      isCapabilitySmokeSuccessful({
        ...report,
        cli: { state: 'unavailable', reason: 'cli-execution-failed' },
      }),
    ).toBe(false);

    const requiredIds = [
      'runtime.cli-version',
      'sessions.list',
      'sessions.resume',
      'settings.live',
      'settings.mode',
      'settings.model',
      'settings.reasoning',
      'settings.autonomy',
      'settings.context',
      'workspace.cwd',
      'tools.execution',
      'skills.list',
      'mcp.servers',
      'mcp.tools',
    ] as const;
    for (const id of requiredIds) {
      expect(
        isCapabilitySmokeSuccessful({
          ...report,
          capabilities: report.capabilities.map((entry) =>
            entry.id === id
              ? { ...entry, state: 'unavailable' as const }
              : entry,
          ),
        }),
        id,
      ).toBe(false);
    }
  });
});

interface FactoryFixtureOptions {
  readonly listedSessions: readonly unknown[];
  readonly sessionOverrides?: Partial<CapabilitySession> &
    Readonly<Record<string, unknown>>;
  readonly closeSession?: () => Promise<void>;
  readonly closeTransport?: () => Promise<void>;
  readonly connectTransport?: () => Promise<void>;
  readonly listSessions?: CapabilitySessionFactory['listSessions'];
  readonly resumeSession?: CapabilitySessionFactory['resumeSession'];
}

function createFactory(options: FactoryFixtureOptions) {
  const closeSession = vi.fn(options.closeSession ?? (async () => undefined));
  const closeTransport = vi.fn(
    options.closeTransport ?? (async () => undefined),
  );
  const connectTransport = vi.fn(
    options.connectTransport ?? (async () => undefined),
  );
  const transport: CapabilityTransport = {
    connect: connectTransport,
    close: closeTransport,
    send: vi.fn(async () => undefined),
    onMessage: vi.fn(),
    onError: vi.fn(),
    get isConnected() {
      return true;
    },
  };
  const session: CapabilitySession = {
    settings: {
      interactionMode: 'private-mode',
      modelId: 'model-secret',
      reasoningEffort: 'private-reasoning',
      autonomyLevel: 'private-autonomy',
    },
    cwd: 'C:\\private\\workspace',
    close: closeSession,
    listTools: vi.fn(async () => [
      { name: 'tool-secret' },
      { name: 'tool-secret-2' },
    ]),
    listSkills: vi.fn(async () => ({
      skills: [{ name: 'skill-secret', content: 'private-content' }],
    })),
    listMcpServers: vi.fn(async () => ({
      servers: [{ name: 'server-secret', pendingAuthUrl: 'private-url' }],
    })),
    listMcpTools: vi.fn(async () => [{ name: 'mcp-tool-secret' }]),
    getContextStats: vi.fn(async () => ({
      used: 100,
      remaining: 200,
      limit: 300,
      accuracy: 'exact',
      updatedAt: 'private-value',
    })),
    ...options.sessionOverrides,
  };
  const resumeSession = vi.fn<CapabilitySessionFactory['resumeSession']>(
    options.resumeSession ?? (async () => session),
  );
  const createTransport = vi.fn(() => transport);
  const factory: CapabilitySessionFactory = {
    createTransport,
    listSessions: vi.fn(
      options.listSessions ?? (async () => options.listedSessions),
    ),
    resumeSession,
  };

  return {
    factory,
    createTransport,
    resumeSession,
    session,
    closeSession,
    closeTransport,
  };
}

function capability(
  report: Awaited<ReturnType<FactoryDroidCapabilityProbe['probe']>>,
  id: (typeof DROID_CAPABILITY_DECLARATIONS)[number]['id'],
) {
  return report.capabilities.find((entry) => entry.id === id);
}

function completedCli(stdout: string): CliVersionExecution {
  return { status: 'completed', stdout, stderr: '' };
}
