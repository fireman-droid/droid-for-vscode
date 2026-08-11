import {
  ConnectionError,
  InvalidSessionCwdError,
  ProcessTransport,
  SDK_VERSION,
  createSession,
  resumeSession,
  type AvailableModelConfig,
  type AutonomyLevel,
  type Base64ImageSource,
  type DocumentSource,
  type DroidSessionUpdateSettingsOptions,
  type DroidInteractionMode,
  type DroidObservability,
  type DroidStreamEvent,
  type GetContextStatsResult,
  type ReasoningEffort,
  type SessionSettings,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';

import {
  MAX_RUNTIME_MODEL_CATALOG_ITEMS,
  MAX_RUNTIME_MODEL_DISPLAY_NAME_LENGTH,
  MAX_RUNTIME_MODEL_ID_LENGTH,
  MAX_RUNTIME_MCP_AUTH_URL_LENGTH,
  MAX_RUNTIME_MCP_NAME_LENGTH,
  MAX_RUNTIME_MCP_SERVERS,
  MAX_RUNTIME_MCP_TOOLS_PER_SERVER,
  MAX_RUNTIME_MCP_TOOL_DESCRIPTION_LENGTH,
  MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH,
  MAX_RUNTIME_SKILL_ITEMS,
  MAX_RUNTIME_SKILL_NAME_LENGTH,
  RUNTIME_AUTONOMY_LEVELS,
  RUNTIME_INTERACTION_MODES,
  RUNTIME_MCP_SERVER_STATUSES,
  RUNTIME_REASONING_EFFORTS,
  RUNTIME_SKILL_LOCATIONS,
  MAX_RUNTIME_ATTACHMENTS,
  MAX_RUNTIME_IMAGE_BASE64_LENGTH,
  MAX_RUNTIME_PDF_BASE64_LENGTH,
  MAX_RUNTIME_TEXT_ATTACHMENT_LENGTH,
  type DroidRuntime,
  type RuntimeAttachment,
  type RuntimeCompactResult,
  type RuntimeForkResult,
  type RuntimeRewindInfo,
  type RuntimeRewindParams,
  type RuntimeRewindResult,
  type RuntimeContextAccuracy,
  type RuntimeContextStats,
  type RuntimeModelCatalog,
  type RuntimeModelCatalogItem,
  type RuntimeSessionSettings,
  type RuntimeSessionSettingUpdate,
  type RuntimeSessionTarget,
  type RuntimeMcpAuthOutcome,
  type RuntimeMcpAuthStart,
  type RuntimeMcpServer,
  type RuntimeMcpServerStatus,
  type RuntimeMcpTool,
  type RuntimeSkill,
  type RuntimeSkillLocation,
} from './DroidRuntime';
import { normalizeSdkEvent } from './normalizeSdkEvent';
import { createModelCatalogCaptureTransport } from './modelCatalogCaptureTransport';
import type { RuntimeAvailability, RuntimeEvent } from './runtimeEvents';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from './runtimeInteractions';
import type { RuntimeDiagnosticSink } from './runtimeDiagnostics';

/** How long to wait for the OAuth URL notification after an accepted
 * MCP authentication request. */
const MCP_AUTH_URL_WAIT_MS = 15_000;
/** How long the one-shot MCP auth completion subscription stays alive
 * before it is dropped without an outcome. */
const MCP_AUTH_COMPLETION_SUBSCRIPTION_MS = 10 * 60_000;

export interface FactoryDroidSessionRewindParams {
  readonly messageId: string;
  readonly filesToRestore: Array<{
    filePath: string;
    contentHash: string;
    size: number;
  }>;
  readonly filesToDelete: Array<{ filePath: string }>;
  readonly forkTitle: string;
}

export interface FactoryDroidSessionRewindInfo {
  readonly availableFiles: Array<{
    filePath: string;
    contentHash: string;
    size: number;
  }>;
  readonly createdFiles: Array<{ filePath: string }>;
  readonly evictedFiles: Array<{ filePath: string; reason: string }>;
}

export interface FactoryDroidSession {
  readonly id: string;
  readonly settings: Readonly<SessionSettings>;
  readonly availableModels?: readonly AvailableModelConfig[];
  stream(
    prompt: string,
    options: {
      includePartialMessages: true;
      images?: Base64ImageSource[];
      files?: DocumentSource[];
    },
  ): AsyncIterable<DroidStreamEvent>;
  interrupt(): Promise<void>;
  updateSettings(
    params: DroidSessionUpdateSettingsOptions,
  ): Promise<unknown>;
  getContextStats(): Promise<GetContextStatsResult>;
  rewind?(
    params: FactoryDroidSessionRewindParams,
  ): Promise<{ session: FactoryDroidSession }>;
  getRewindInfo?(params: {
    messageId: string;
  }): Promise<FactoryDroidSessionRewindInfo>;
  compact?(params?: {
    customInstructions?: string;
  }): Promise<{ session: FactoryDroidSession; removedCount: number }>;
  fork?(params?: { title?: string }): Promise<FactoryDroidSession>;
  rename?(params: { title: string }): Promise<void>;
  listSkills?(): Promise<{ skills: unknown[] }>;
  setSkillDisabled?(params: {
    skillName: string;
    disabled: boolean;
  }): Promise<{ success: boolean }>;
  listMcpServers?(): Promise<{ servers: unknown[] }>;
  listMcpTools?(): Promise<unknown[]>;
  toggleMcpServer?(params: {
    serverName: string;
    enabled: boolean;
    settingsLevel: 'user';
  }): Promise<{ success: boolean }>;
  authenticateMcpServer?(params: {
    serverName: string;
  }): Promise<{ success: boolean }>;
  onNotification?(
    callback: (notification: Record<string, unknown>) => void,
    filter?: { type?: string },
  ): () => void;
  close(): Promise<void>;
}

export type FactoryDroidSessionFactory = (options: {
  target: RuntimeSessionTarget;
  interactionHandler: RuntimeInteractionHandler;
}) => Promise<FactoryDroidSession>;

export interface FactoryDroidRuntimeOptions {
  readonly interactionHandler: RuntimeInteractionHandler;
  readonly createSdkSession?: FactoryDroidSessionFactory;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly observability?: DroidObservability;
}

export class FactoryDroidRuntime implements DroidRuntime {
  private readonly createSdkSession: FactoryDroidSessionFactory;
  private readonly interactionHandler: RuntimeInteractionHandler;
  private readonly diagnostics: RuntimeDiagnosticSink | undefined;
  private session: FactoryDroidSession | null = null;
  private sessionTarget: RuntimeSessionTarget | null = null;
  private initialization:
    | {
        target: RuntimeSessionTarget;
        promise: Promise<RuntimeAvailability>;
      }
    | undefined;
  private activeTurn: symbol | null = null;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(options: FactoryDroidRuntimeOptions) {
    this.interactionHandler = options.interactionHandler;
    this.diagnostics = options.diagnostics;
    this.createSdkSession =
      options.createSdkSession ??
      ((sessionOptions) =>
        createLocalDroidSession({
          ...sessionOptions,
          observability: options.observability,
        }));
  }

  initialize(
    requestedTarget: RuntimeSessionTarget | string,
  ): Promise<RuntimeAvailability> {
    this.ensureNotDisposed();
    const target = normalizeSessionTarget(requestedTarget);

    if (this.session) {
      if (!sameSessionTarget(target, this.sessionTarget)) {
        throw new Error(
          'Droid runtime is already initialized for another session target.',
        );
      }

      return Promise.resolve(this.available(this.session));
    }

    if (this.initialization) {
      if (!sameSessionTarget(target, this.initialization.target)) {
        throw new Error(
          'Droid runtime is already initializing for another session target.',
        );
      }

      return this.initialization.promise;
    }

    const promise = this.create(target).finally(() => {
      if (this.initialization?.promise === promise) {
        this.initialization = undefined;
      }
    });

    this.initialization = { target, promise };
    return promise;
  }

  async *sendTurn(
    text: string,
    attachments?: readonly RuntimeAttachment[],
  ): AsyncIterable<RuntimeEvent> {
    this.ensureNotDisposed();

    if (text.trim().length === 0) {
      throw new Error('A Droid turn requires non-empty text.');
    }

    const session = this.session;
    if (!session) {
      throw new Error('Droid runtime is not initialized.');
    }

    if (this.activeTurn) {
      throw new Error('Droid runtime already has an active turn.');
    }

    const turn = Symbol('droid-turn');
    this.activeTurn = turn;
    const startedAt = performance.now();
    let projectedEventCount = 0;
    let toolStartCount = 0;
    let toolProgressCount = 0;
    let toolResultCount = 0;
    let outcome = 'stream-ended';
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.turn.started',
      attributes: {
        textLength: text.length,
        attachmentCount: attachments?.length ?? 0,
      },
    });

    try {
      for await (const sdkEvent of session.stream(text, {
        includePartialMessages: true,
        ...projectStreamAttachments(attachments),
      })) {
        if (this.disposed || this.activeTurn !== turn) {
          outcome = 'stopped';
          return;
        }

        const event = normalizeSdkEvent(
          sdkEvent,
          this.sessionTarget?.cwd,
        );
        if (event) {
          projectedEventCount += 1;
          switch (event.type) {
            case 'tool-start':
              toolStartCount += 1;
              break;
            case 'tool-progress':
              toolProgressCount += 1;
              break;
            case 'tool-result':
              toolResultCount += 1;
              break;
          }
          if (event.type === 'turn-complete') {
            outcome = event.outcome;
          }
          yield event;
        }
      }
    } catch (error) {
      outcome = 'failed';
      throw error;
    } finally {
      this.recordDiagnostic({
        level:
          outcome === 'failed' || outcome.startsWith('error_')
            ? 'error'
            : outcome === 'stream-ended'
              ? 'warn'
              : 'info',
        name: 'runtime.turn.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome,
          projectedEventCount,
          toolStartCount,
          toolProgressCount,
          toolResultCount,
        },
      });
      if (this.activeTurn === turn) {
        this.activeTurn = null;
      }
    }
  }

  async readSessionSettings(): Promise<RuntimeSessionSettings> {
    const session = this.requireSession();
    try {
      return projectSessionSettings(session.settings);
    } catch {
      throw new Error('Droid returned invalid session settings.');
    }
  }

  async readContextStats(): Promise<RuntimeContextStats> {
    const session = this.requireSession();
    const startedAt = performance.now();
    this.recordDiagnostic({
      level: 'debug',
      name: 'runtime.context.started',
    });
    let stats: GetContextStatsResult;
    try {
      stats = await session.getContextStats();
    } catch {
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.context.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'sdk-error',
        },
      });
      throw new Error('Droid context statistics could not be read.');
    }
    try {
      const projected = projectContextStats(stats);
      this.recordDiagnostic({
        level: 'info',
        name: 'runtime.context.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'success',
          accuracy: projected.accuracy,
          arithmeticDelta:
            projected.used + projected.remaining - projected.limit,
        },
      });
      return projected;
    } catch {
      const reason = classifyInvalidContextStats(stats);
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.context.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'invalid-stats',
          reason,
        },
      });
      throw new Error('Droid context statistics could not be read.');
    }
  }

  async readModelCatalog(): Promise<RuntimeModelCatalog> {
    const models = this.requireSession().availableModels;
    if (models === undefined) {
      return { status: 'unavailable' };
    }
    try {
      return {
        status: 'available',
        items: projectModelCatalog(models),
      };
    } catch {
      throw new Error('Droid returned an invalid model catalog.');
    }
  }

  async updateSessionSetting(
    update: RuntimeSessionSettingUpdate,
  ): Promise<RuntimeSessionSettings> {
    const session = this.requireSession();
    let params: DroidSessionUpdateSettingsOptions;
    try {
      params = projectSettingsUpdate(update);
    } catch {
      throw new Error('Invalid session setting update.');
    }
    try {
      await session.updateSettings(params);
      return projectSessionSettings(session.settings);
    } catch {
      throw new Error('Droid session settings could not be updated.');
    }
  }

  async interrupt(): Promise<void> {
    if (this.disposed || !this.session || !this.activeTurn) {
      return;
    }

    await this.session.interrupt();
  }

  async rewind(
    params: RuntimeRewindParams,
  ): Promise<RuntimeRewindResult> {
    const session = this.requireSession();
    if (this.activeTurn) {
      throw new Error(
        'Droid runtime cannot rewind while a turn is active.',
      );
    }
    if (typeof session.rewind !== 'function') {
      throw new Error('The Droid session does not support rewind.');
    }

    const startedAt = performance.now();
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.rewind.started',
    });

    let nextSession: FactoryDroidSession;
    try {
      let filesToRestore: FactoryDroidSessionRewindParams['filesToRestore'] =
        [];
      let filesToDelete: FactoryDroidSessionRewindParams['filesToDelete'] =
        [];
      if (
        params.restoreFiles === true &&
        typeof session.getRewindInfo === 'function'
      ) {
        const info = await session.getRewindInfo({
          messageId: params.messageId,
        });
        filesToRestore = info.availableFiles;
        filesToDelete = info.createdFiles;
      }
      const outcome = await session.rewind({
        messageId: params.messageId,
        filesToRestore,
        filesToDelete,
        forkTitle: params.forkTitle,
      });
      nextSession = outcome.session;
    } catch (error) {
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.rewind.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'sdk-error',
        },
      });
      throw error;
    }

    // The SDK replaces the rewound session in place; re-apply the
    // captured model catalog view so `availableModels` survives the fork.
    const availableModels = session.availableModels;
    this.session =
      availableModels === undefined
        ? nextSession
        : createCatalogSessionView(nextSession, availableModels);
    if (this.sessionTarget) {
      this.sessionTarget = {
        kind: 'resume',
        cwd: this.sessionTarget.cwd,
        sessionId: nextSession.id,
      };
    }

    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.rewind.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'success',
      },
    });
    return { sessionId: nextSession.id };
  }

  async getRewindInfo(messageId: string): Promise<RuntimeRewindInfo> {
    const session = this.requireSession();
    if (typeof session.getRewindInfo !== 'function') {
      throw new Error(
        'The Droid session does not report rewind file info.',
      );
    }
    const info = await session.getRewindInfo({ messageId });
    return {
      restorableCount: info.availableFiles.length,
      createdCount: info.createdFiles.length,
    };
  }

  async compact(): Promise<RuntimeCompactResult> {
    const session = this.requireSession();
    if (this.activeTurn) {
      throw new Error(
        'Droid runtime cannot compact while a turn is active.',
      );
    }
    if (typeof session.compact !== 'function') {
      throw new Error('The Droid session does not support compaction.');
    }

    const startedAt = performance.now();
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.compact.started',
    });

    let nextSession: FactoryDroidSession;
    let removedCount: number;
    try {
      const outcome = await session.compact();
      nextSession = outcome.session;
      removedCount = Number.isSafeInteger(outcome.removedCount)
        ? outcome.removedCount
        : 0;
    } catch (error) {
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.compact.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'sdk-error',
        },
      });
      throw error;
    }

    // Compaction continues in a new session; re-apply the captured
    // model catalog view so `availableModels` survives the swap.
    const availableModels = session.availableModels;
    this.session =
      availableModels === undefined
        ? nextSession
        : createCatalogSessionView(nextSession, availableModels);
    if (this.sessionTarget) {
      this.sessionTarget = {
        kind: 'resume',
        cwd: this.sessionTarget.cwd,
        sessionId: nextSession.id,
      };
    }

    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.compact.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'success',
      },
    });
    return { sessionId: nextSession.id, removedCount };
  }

  async fork(title: string): Promise<RuntimeForkResult> {
    const session = this.requireSession();
    if (this.activeTurn) {
      throw new Error(
        'Droid runtime cannot fork while a turn is active.',
      );
    }
    if (typeof session.fork !== 'function') {
      throw new Error('The Droid session does not support fork.');
    }

    const startedAt = performance.now();
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.fork.started',
    });

    let nextSession: FactoryDroidSession;
    try {
      nextSession = await session.fork({ title });
    } catch (error) {
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.fork.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'sdk-error',
        },
      });
      throw error;
    }

    // Forking replaces the SDK session handle in place; re-apply the
    // captured model catalog view so `availableModels` survives.
    const availableModels = session.availableModels;
    this.session =
      availableModels === undefined
        ? nextSession
        : createCatalogSessionView(nextSession, availableModels);
    if (this.sessionTarget) {
      this.sessionTarget = {
        kind: 'resume',
        cwd: this.sessionTarget.cwd,
        sessionId: nextSession.id,
      };
    }

    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.fork.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'success',
      },
    });
    return { sessionId: nextSession.id };
  }

  async rename(title: string): Promise<void> {
    const session = this.requireSession();
    if (typeof session.rename !== 'function') {
      throw new Error('The Droid session does not support rename.');
    }

    const startedAt = performance.now();
    try {
      await session.rename({ title });
    } catch (error) {
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.rename.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'sdk-error',
        },
      });
      throw error;
    }
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.rename.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'success',
      },
    });
  }

  async listSkills(): Promise<readonly RuntimeSkill[]> {
    const session = this.requireSession();
    if (typeof session.listSkills !== 'function') {
      throw new Error('The Droid session does not support skills.');
    }
    const result = await session.listSkills();
    if (!Array.isArray(result.skills)) {
      throw new Error('Droid returned an invalid skill list.');
    }
    const skills: RuntimeSkill[] = [];
    for (const raw of result.skills.slice(0, MAX_RUNTIME_SKILL_ITEMS)) {
      const skill = projectSkill(raw);
      if (skill !== null) {
        skills.push(skill);
      }
    }
    return skills;
  }

  async setSkillDisabled(
    name: string,
    disabled: boolean,
  ): Promise<void> {
    const session = this.requireSession();
    if (typeof session.setSkillDisabled !== 'function') {
      throw new Error('The Droid session does not support skills.');
    }
    const result = await session.setSkillDisabled({
      skillName: name,
      disabled,
    });
    if (result.success !== true) {
      throw new Error('Droid refused to update the skill.');
    }
  }

  async listMcpServers(): Promise<readonly RuntimeMcpServer[]> {
    const session = this.requireSession();
    if (
      typeof session.listMcpServers !== 'function' ||
      typeof session.listMcpTools !== 'function'
    ) {
      throw new Error('The Droid session does not support MCP.');
    }
    const [serversResult, toolsResult] = await Promise.all([
      session.listMcpServers(),
      session.listMcpTools(),
    ]);
    if (
      !Array.isArray(serversResult.servers) ||
      !Array.isArray(toolsResult)
    ) {
      throw new Error('Droid returned an invalid MCP catalog.');
    }

    const toolsByServer = new Map<string, RuntimeMcpTool[]>();
    const seenToolNames = new Map<string, Set<string>>();
    for (const raw of toolsResult) {
      const projected = projectMcpTool(raw);
      if (projected === null) {
        continue;
      }
      const seen =
        seenToolNames.get(projected.serverName) ?? new Set<string>();
      if (seen.has(projected.tool.name)) {
        continue;
      }
      seen.add(projected.tool.name);
      seenToolNames.set(projected.serverName, seen);
      const bucket = toolsByServer.get(projected.serverName) ?? [];
      if (bucket.length < MAX_RUNTIME_MCP_TOOLS_PER_SERVER) {
        bucket.push(projected.tool);
        toolsByServer.set(projected.serverName, bucket);
      }
    }

    const servers: RuntimeMcpServer[] = [];
    const seenServerNames = new Set<string>();
    for (const raw of serversResult.servers.slice(
      0,
      MAX_RUNTIME_MCP_SERVERS,
    )) {
      const server = projectMcpServer(raw, toolsByServer);
      if (server !== null && !seenServerNames.has(server.name)) {
        seenServerNames.add(server.name);
        servers.push(server);
      }
    }
    return servers;
  }

  async setMcpServerEnabled(
    name: string,
    enabled: boolean,
  ): Promise<void> {
    const session = this.requireSession();
    if (typeof session.toggleMcpServer !== 'function') {
      throw new Error('The Droid session does not support MCP.');
    }
    const result = await session.toggleMcpServer({
      serverName: name,
      enabled,
      settingsLevel: 'user',
    });
    if (result.success !== true) {
      throw new Error('Droid refused to update the MCP server.');
    }
  }

  async authenticateMcpServer(
    name: string,
    onCompleted: (outcome: RuntimeMcpAuthOutcome) => void,
  ): Promise<RuntimeMcpAuthStart> {
    const session = this.requireSession();
    if (
      typeof session.authenticateMcpServer !== 'function' ||
      typeof session.onNotification !== 'function'
    ) {
      throw new Error(
        'The Droid session does not support MCP authentication.',
      );
    }

    let authUrl: string | null = null;
    let resolveUrl: (() => void) | null = null;
    const urlArrived = new Promise<void>((resolve) => {
      resolveUrl = resolve;
    });
    const unsubscribeRequired = session.onNotification(
      (notification) => {
        if (notification['serverName'] !== name) {
          return;
        }
        const url = notification['authUrl'];
        if (
          typeof url === 'string' &&
          url.length > 0 &&
          url.length <= MAX_RUNTIME_MCP_AUTH_URL_LENGTH &&
          /^https?:\/\//.test(url)
        ) {
          authUrl = url;
        }
        resolveUrl?.();
      },
      { type: 'mcp_auth_required' },
    );

    let completionDone = false;
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeCompleted = () => {};
    const finishCompletion = () => {
      if (completionDone) {
        return;
      }
      completionDone = true;
      if (completionTimer !== null) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      unsubscribeCompleted();
    };
    unsubscribeCompleted = session.onNotification(
      (notification) => {
        if (notification['serverName'] !== name || completionDone) {
          return;
        }
        const outcome = notification['outcome'];
        if (
          outcome === 'success' ||
          outcome === 'cancelled' ||
          outcome === 'failed'
        ) {
          finishCompletion();
          onCompleted(outcome);
        }
      },
      { type: 'mcp_auth_completed' },
    );
    // Stop listening eventually so an abandoned browser flow does not
    // leave a subscription behind for the session's whole lifetime.
    completionTimer = setTimeout(
      finishCompletion,
      MCP_AUTH_COMPLETION_SUBSCRIPTION_MS,
    );

    try {
      const result = await session.authenticateMcpServer({
        serverName: name,
      });
      if (result.success !== true) {
        throw new Error('Droid refused to start MCP authentication.');
      }
      // The OAuth URL arrives as a separate notification shortly after
      // the request is accepted; wait briefly for it.
      await Promise.race([
        urlArrived,
        new Promise<void>((resolve) => {
          setTimeout(resolve, MCP_AUTH_URL_WAIT_MS);
        }),
      ]);
      return { authUrl };
    } catch (error) {
      finishCompletion();
      throw error;
    } finally {
      unsubscribeRequired();
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) {
      return this.disposal;
    }

    this.disposed = true;
    const disposal = this.disposeOwnedSession().catch((error) => {
      if (this.disposal === disposal) {
        this.disposal = null;
      }
      throw error;
    });
    this.disposal = disposal;
    return disposal;
  }

  private async create(
    target: RuntimeSessionTarget,
  ): Promise<RuntimeAvailability> {
    const startedAt = performance.now();
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.initialize.started',
      attributes: { targetKind: target.kind },
    });
    let session: FactoryDroidSession;
    try {
      session = await this.createSdkSession({
        target,
        interactionHandler: this.interactionHandler,
      });
    } catch (error) {
      if (error instanceof InvalidSessionCwdError) {
        this.recordInitializationFinished(
          startedAt,
          'invalid-cwd',
          'warn',
        );
        return this.unavailable(
          'invalid-cwd',
          'Droid rejected the requested working directory.',
        );
      }

      if (isMissingCliError(error)) {
        this.recordInitializationFinished(
          startedAt,
          'cli-not-found',
          'warn',
        );
        return this.unavailable(
          'cli-not-found',
          'The Droid CLI executable was not found.',
        );
      }

      this.recordInitializationFinished(
        startedAt,
        'initialization-failed',
        'error',
      );
      return this.unavailable(
        'initialization-failed',
        'The Droid SDK could not initialize a session.',
      );
    }

    if (this.disposed) {
      this.session = session;
      this.sessionTarget = target;
      await session.close();
      if (this.session === session) {
        this.session = null;
        this.sessionTarget = null;
      }
      this.recordInitializationFinished(
        startedAt,
        'disposed',
        'warn',
      );
      return this.unavailable(
        'initialization-failed',
        'Droid runtime was disposed during initialization.',
      );
    }

    this.session = session;
    this.sessionTarget = target;
    this.recordInitializationFinished(startedAt, 'available', 'info');
    return this.available(session);
  }

  private async disposeOwnedSession(): Promise<void> {
    await this.initialization?.promise;

    const session = this.session;
    if (!session) {
      return;
    }

    let interruptError: unknown;
    if (this.activeTurn) {
      try {
        await session.interrupt();
      } catch (error) {
        interruptError = error;
      }
    }

    await session.close();

    if (this.session === session) {
      this.session = null;
      this.sessionTarget = null;
    }

    if (interruptError) {
      throw interruptError;
    }
  }

  private available(session: FactoryDroidSession): RuntimeAvailability {
    return {
      status: 'available',
      sdkVersion: SDK_VERSION,
      cliVersion: null,
      authenticationStatus: 'unknown',
      sessionId: session.id,
    };
  }

  private unavailable(
    reason: Extract<RuntimeAvailability, { status: 'unavailable' }>['reason'],
    message: string,
  ): RuntimeAvailability {
    return {
      status: 'unavailable',
      sdkVersion: SDK_VERSION,
      cliVersion: null,
      authenticationStatus: 'unknown',
      reason,
      message,
    };
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Droid runtime is disposed.');
    }
  }

  private requireSession(): FactoryDroidSession {
    this.ensureNotDisposed();
    if (!this.session) {
      throw new Error('Droid runtime is not initialized.');
    }
    return this.session;
  }

  private recordInitializationFinished(
    startedAt: number,
    outcome: string,
    level: 'info' | 'warn' | 'error',
  ): void {
    this.recordDiagnostic({
      level,
      name: 'runtime.initialize.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome,
      },
    });
  }

  private recordDiagnostic(
    event: Parameters<RuntimeDiagnosticSink['record']>[0],
  ): void {
    try {
      this.diagnostics?.record(event);
    } catch {
      // Diagnostics must never alter Runtime behavior.
    }
  }
}

interface LocalSessionTransport extends StringFramedDroidClientTransport {
  connect(): Promise<void>;
}

interface LocalSessionDependencies {
  createTransport(options: {
    cwd: string;
    observability?: DroidObservability;
  }): LocalSessionTransport;
  createSession(options: {
    cwd: string;
    transport: StringFramedDroidClientTransport;
    observability?: DroidObservability;
    permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
    askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
  }): Promise<FactoryDroidSession>;
  resumeSession(
    sessionId: string,
    options: {
      transport: StringFramedDroidClientTransport;
      observability?: DroidObservability;
      permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
      askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
    },
  ): Promise<FactoryDroidSession>;
}

const localSessionDependencies: LocalSessionDependencies = {
  createTransport: (options) => new ProcessTransport(options),
  createSession,
  resumeSession,
};

export async function createLocalDroidSession(
  {
    target,
    interactionHandler,
    observability,
  }: {
    target: RuntimeSessionTarget;
    interactionHandler: RuntimeInteractionHandler;
    observability?: DroidObservability;
  },
  dependencies: LocalSessionDependencies = localSessionDependencies,
): Promise<FactoryDroidSession> {
  const observabilityOptions =
    observability === undefined ? {} : { observability };
  const transport = dependencies.createTransport({
    cwd: target.cwd,
    ...observabilityOptions,
  });

  try {
    await transport.connect();
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // Preserve the structured connection failure that initialization classifies.
    }
    throw error;
  }

  const interactionCallbacks =
    createRuntimeInteractionCallbacks(interactionHandler);
  const catalogCapture = createModelCatalogCaptureTransport(transport);

  let session: FactoryDroidSession;
  if (target.kind === 'resume') {
    session = await dependencies.resumeSession(target.sessionId, {
      transport: catalogCapture.transport,
      ...observabilityOptions,
      ...interactionCallbacks,
    });
  } else {
    session = await dependencies.createSession({
      cwd: target.cwd,
      transport: catalogCapture.transport,
      ...observabilityOptions,
      ...interactionCallbacks,
    });
  }

  const availableModels = catalogCapture.readAvailableModels();
  return availableModels === undefined
    ? session
    : createCatalogSessionView(session, availableModels);
}

function normalizeSessionTarget(
  target: RuntimeSessionTarget | string,
): RuntimeSessionTarget {
  return typeof target === 'string'
    ? { kind: 'new', cwd: target }
    : target;
}

function sameSessionTarget(
  left: RuntimeSessionTarget,
  right: RuntimeSessionTarget | null,
): boolean {
  return (
    right !== null &&
    left.kind === right.kind &&
    left.cwd === right.cwd &&
    (left.kind === 'new' ||
      (right.kind === 'resume' && left.sessionId === right.sessionId))
  );
}

function isMissingCliError(error: unknown): boolean {
  if (!(error instanceof ConnectionError)) {
    return false;
  }

  return (
    hasErrorCode(error.cause, 'ENOENT') ||
    hasErrorCode(error.metadata?.error, 'ENOENT')
  );
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === expectedCode
  );
}

function projectSessionSettings(
  settings: Readonly<SessionSettings>,
): RuntimeSessionSettings {
  const interactionMode = projectEnum(
    settings.interactionMode,
    RUNTIME_INTERACTION_MODES,
  );
  const autonomyLevel = projectEnum(
    settings.autonomyLevel,
    RUNTIME_AUTONOMY_LEVELS,
  );
  const reasoningEffort = projectEnum(
    settings.reasoningEffort,
    RUNTIME_REASONING_EFFORTS,
  );
  if (
    interactionMode === undefined ||
    autonomyLevel === undefined ||
    reasoningEffort === undefined ||
    !isSafeModelId(settings.modelId)
  ) {
    throw new Error('Invalid session settings.');
  }

  return {
    interactionMode,
    modelId: settings.modelId,
    reasoningEffort,
    autonomyLevel,
  };
}

function projectContextStats(
  stats: GetContextStatsResult,
): RuntimeContextStats {
  if (
    !isContextNumber(stats.used) ||
    !isContextNumber(stats.remaining) ||
    !isContextNumber(stats.limit) ||
    (stats.accuracy !== 'exact' && stats.accuracy !== 'estimated')
  ) {
    throw new Error('Invalid context statistics.');
  }

  return {
    used: stats.used,
    remaining: stats.remaining,
    limit: stats.limit,
    accuracy: stats.accuracy as RuntimeContextAccuracy,
  };
}

function projectModelCatalog(
  models: readonly AvailableModelConfig[],
): RuntimeModelCatalogItem[] {
  if (
    !Array.isArray(models) ||
    models.length > MAX_RUNTIME_MODEL_CATALOG_ITEMS
  ) {
    throw new Error('Invalid model catalog.');
  }
  const ids = new Set<string>();
  const projected = models.map((model) => {
    if (
      !isSafeModelId(model.id) ||
      ids.has(model.id) ||
      !isSafeModelDisplayName(model.displayName)
    ) {
      throw new Error('Invalid model catalog item.');
    }
    const efforts = model.supportedReasoningEfforts;
    if (
      !Array.isArray(efforts) ||
      efforts.length === 0 ||
      efforts.length > RUNTIME_REASONING_EFFORTS.length
    ) {
      throw new Error('Invalid model reasoning efforts.');
    }
    const projectedEfforts = efforts.map((effort) =>
      projectEnum(effort, RUNTIME_REASONING_EFFORTS),
    );
    if (
      projectedEfforts.some((effort) => effort === undefined) ||
      new Set(projectedEfforts).size !== projectedEfforts.length
    ) {
      throw new Error('Invalid model reasoning efforts.');
    }
    ids.add(model.id);
    return {
      isCustom: model.isCustom,
      item: {
        id: model.id,
        displayName: model.displayName,
        supportedReasoningEfforts:
          projectedEfforts as RuntimeModelCatalogItem['supportedReasoningEfforts'],
      },
    };
  });
  return projected
    .filter(({ isCustom }) => isCustom)
    .map(({ item }) => item);
}

function projectSettingsUpdate(
  update: RuntimeSessionSettingUpdate,
): DroidSessionUpdateSettingsOptions {
  if (
    typeof update !== 'object' ||
    update === null ||
    Reflect.ownKeys(update).length !== 2 ||
    !Object.hasOwn(update, 'field') ||
    !Object.hasOwn(update, 'value')
  ) {
    throw new Error('Invalid session setting update.');
  }

  switch (update.field) {
    case 'interactionMode':
      if (!isEnumValue(update.value, RUNTIME_INTERACTION_MODES)) {
        break;
      }
      return {
        interactionMode: update.value as DroidInteractionMode,
      };
    case 'modelId':
      if (!isSafeModelId(update.value)) {
        break;
      }
      return { modelId: update.value };
    case 'reasoningEffort':
      if (!isEnumValue(update.value, RUNTIME_REASONING_EFFORTS)) {
        break;
      }
      return {
        reasoningEffort: update.value as ReasoningEffort,
      };
    case 'autonomyLevel':
      if (!isEnumValue(update.value, RUNTIME_AUTONOMY_LEVELS)) {
        break;
      }
      return {
        autonomyLevel: update.value as AutonomyLevel,
      };
  }

  throw new Error('Invalid session setting update.');
}

function projectEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | undefined {
  return isEnumValue(value, values)
    ? (value as Values[number])
    : undefined;
}

function isEnumValue(
  value: unknown,
  values: readonly string[],
): value is string {
  return typeof value === 'string' && values.includes(value);
}

function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RUNTIME_MODEL_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function isSafeModelDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RUNTIME_MODEL_DISPLAY_NAME_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function isContextNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function classifyInvalidContextStats(
  stats: GetContextStatsResult,
): string {
  if (
    !Number.isSafeInteger(stats.used) ||
    !Number.isSafeInteger(stats.remaining) ||
    !Number.isSafeInteger(stats.limit)
  ) {
    return 'non-integer';
  }
  if (stats.used < 0 || stats.remaining < 0 || stats.limit < 0) {
    return 'negative';
  }
  if (
    stats.accuracy !== 'exact' &&
    stats.accuracy !== 'estimated'
  ) {
    return 'invalid-accuracy';
  }
  return 'projection-error';
}

function createCatalogSessionView(
  session: FactoryDroidSession,
  availableModels: readonly AvailableModelConfig[],
): FactoryDroidSession {
  const view: FactoryDroidSession = {
    get id() {
      return session.id;
    },
    get settings() {
      return session.settings;
    },
    availableModels: [...availableModels],
    stream(prompt, options) {
      return session.stream(prompt, options);
    },
    interrupt() {
      return session.interrupt();
    },
    updateSettings(params) {
      return session.updateSettings(params);
    },
    getContextStats() {
      return session.getContextStats();
    },
    close() {
      return session.close();
    },
  };
  if (typeof session.rewind === 'function') {
    view.rewind = (params) => session.rewind!(params);
  }
  if (typeof session.getRewindInfo === 'function') {
    view.getRewindInfo = (params) => session.getRewindInfo!(params);
  }
  if (typeof session.compact === 'function') {
    view.compact = (params) => session.compact!(params);
  }
  if (typeof session.fork === 'function') {
    view.fork = (params) => session.fork!(params);
  }
  if (typeof session.rename === 'function') {
    view.rename = (params) => session.rename!(params);
  }
  if (typeof session.listSkills === 'function') {
    view.listSkills = () => session.listSkills!();
  }
  if (typeof session.setSkillDisabled === 'function') {
    view.setSkillDisabled = (params) => session.setSkillDisabled!(params);
  }
  if (typeof session.listMcpServers === 'function') {
    view.listMcpServers = () => session.listMcpServers!();
  }
  if (typeof session.listMcpTools === 'function') {
    view.listMcpTools = () => session.listMcpTools!();
  }
  if (typeof session.toggleMcpServer === 'function') {
    view.toggleMcpServer = (params) => session.toggleMcpServer!(params);
  }
  if (typeof session.authenticateMcpServer === 'function') {
    view.authenticateMcpServer = (params) =>
      session.authenticateMcpServer!(params);
  }
  if (typeof session.onNotification === 'function') {
    view.onNotification = (callback, filter) =>
      session.onNotification!(callback, filter);
  }
  return view;
}

/**
 * Projects an SDK skill record to safe display fields, dropping
 * filesystem paths, raw content, and resources.
 */
/**
 * Maps validated runtime attachments onto the SDK stream options.
 * Oversized or excess attachments are rejected here so the SDK only
 * ever sees bounded payloads.
 */
function projectStreamAttachments(
  attachments: readonly RuntimeAttachment[] | undefined,
): { images?: Base64ImageSource[]; files?: DocumentSource[] } {
  if (attachments === undefined || attachments.length === 0) {
    return {};
  }
  if (attachments.length > MAX_RUNTIME_ATTACHMENTS) {
    throw new Error('Too many attachments for one Droid turn.');
  }
  const images: Base64ImageSource[] = [];
  const files: DocumentSource[] = [];
  for (const attachment of attachments) {
    switch (attachment.kind) {
      case 'image':
        if (attachment.data.length > MAX_RUNTIME_IMAGE_BASE64_LENGTH) {
          throw new Error('Image attachment is too large.');
        }
        images.push({
          type: 'base64',
          data: attachment.data,
          mediaType: attachment.mediaType,
        });
        break;
      case 'pdf':
        if (attachment.data.length > MAX_RUNTIME_PDF_BASE64_LENGTH) {
          throw new Error('PDF attachment is too large.');
        }
        files.push({
          type: 'base64',
          mediaType: 'application/pdf',
          data: attachment.data,
          name: attachment.name,
        });
        break;
      case 'text':
        if (
          attachment.data.length > MAX_RUNTIME_TEXT_ATTACHMENT_LENGTH
        ) {
          throw new Error('Text attachment is too large.');
        }
        files.push({
          type: 'text',
          mediaType: 'text/plain',
          data: attachment.data,
          name: attachment.name,
        });
        break;
    }
  }
  return {
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

function projectSkill(raw: unknown): RuntimeSkill | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = record.name;
  const location = record.location;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_RUNTIME_SKILL_NAME_LENGTH ||
    !isRuntimeSkillLocation(location)
  ) {
    return null;
  }
  const description =
    typeof record.description === 'string' &&
    record.description.length > 0
      ? record.description.slice(0, MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH)
      : null;
  return {
    name,
    description,
    location,
    enabled: record.enabled !== false,
    userInvocable: record.userInvocable === true,
  };
}

function isRuntimeSkillLocation(
  value: unknown,
): value is RuntimeSkillLocation {
  return (
    typeof value === 'string' &&
    (RUNTIME_SKILL_LOCATIONS as readonly string[]).includes(value)
  );
}

/**
 * Projects an SDK MCP server record to safe display fields, dropping
 * connection errors, auth URLs, and configuration sources.
 */
function projectMcpServer(
  raw: unknown,
  toolsByServer: ReadonlyMap<string, readonly RuntimeMcpTool[]>,
): RuntimeMcpServer | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = record.name;
  const status = record.status;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_RUNTIME_MCP_NAME_LENGTH ||
    !isRuntimeMcpServerStatus(status)
  ) {
    return null;
  }
  const toolCount =
    Number.isSafeInteger(record.toolCount) &&
    (record.toolCount as number) >= 0
      ? (record.toolCount as number)
      : null;
  return {
    name,
    status,
    toolCount,
    requiresAuth: record.requiresAuth === true,
    tools: toolsByServer.get(name) ?? [],
  };
}

function projectMcpTool(
  raw: unknown,
): { serverName: string; tool: RuntimeMcpTool } | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const serverName = record.serverName;
  const name = record.name;
  if (
    typeof serverName !== 'string' ||
    serverName.length === 0 ||
    serverName.length > MAX_RUNTIME_MCP_NAME_LENGTH ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_RUNTIME_MCP_NAME_LENGTH
  ) {
    return null;
  }
  const description =
    typeof record.description === 'string' &&
    record.description.length > 0
      ? record.description.slice(
          0,
          MAX_RUNTIME_MCP_TOOL_DESCRIPTION_LENGTH,
        )
      : null;
  return {
    serverName,
    tool: {
      name,
      description,
      enabled: record.isEnabled !== false,
      readOnly: record.isReadOnly === true,
    },
  };
}

function isRuntimeMcpServerStatus(
  value: unknown,
): value is RuntimeMcpServerStatus {
  return (
    typeof value === 'string' &&
    (RUNTIME_MCP_SERVER_STATUSES as readonly string[]).includes(value)
  );
}
