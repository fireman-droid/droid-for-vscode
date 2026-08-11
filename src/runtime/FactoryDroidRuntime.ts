import {
  ConnectionError,
  InvalidSessionCwdError,
  ProcessTransport,
  SDK_VERSION,
  createSession,
  resumeSession,
  type AvailableModelConfig,
  type AutonomyLevel,
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
  RUNTIME_AUTONOMY_LEVELS,
  RUNTIME_INTERACTION_MODES,
  RUNTIME_REASONING_EFFORTS,
  type DroidRuntime,
  type RuntimeContextAccuracy,
  type RuntimeContextStats,
  type RuntimeModelCatalog,
  type RuntimeModelCatalogItem,
  type RuntimeSessionSettings,
  type RuntimeSessionSettingUpdate,
  type RuntimeSessionTarget,
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

export interface FactoryDroidSession {
  readonly id: string;
  readonly settings: Readonly<SessionSettings>;
  readonly availableModels?: readonly AvailableModelConfig[];
  stream(
    prompt: string,
    options: { includePartialMessages: true },
  ): AsyncIterable<DroidStreamEvent>;
  interrupt(): Promise<void>;
  updateSettings(
    params: DroidSessionUpdateSettingsOptions,
  ): Promise<unknown>;
  getContextStats(): Promise<GetContextStatsResult>;
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

  async *sendTurn(text: string): AsyncIterable<RuntimeEvent> {
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
      attributes: { textLength: text.length },
    });

    try {
      for await (const sdkEvent of session.stream(text, {
        includePartialMessages: true,
      })) {
        if (this.disposed || this.activeTurn !== turn) {
          outcome = 'stopped';
          return;
        }

        const event = normalizeSdkEvent(sdkEvent);
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
  return {
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
}
