import {
  InvalidSessionCwdError,
  SDK_VERSION,
  type AvailableModelConfig,
  type DroidObservability,
} from '@factory/droid-sdk/node';
import { projectGitDiff } from './capabilities/gitBranchDiff';
import {
  addMcpServer,
  authenticateMcpServer,
  listMcpServers,
  listSkills,
  removeMcpServer,
  setMcpServerEnabled,
  setSkillDisabled,
} from './capabilities/sessionCapabilities';
import { loadSessionCommands } from './commands/FactoryCommandCatalog';
import { DaemonAvailabilityError } from './daemon/daemonConnection';
import { recoveredTurnError } from './turnRecovery';
import {
  type DroidRuntime,
  type RuntimeAttachment,
  type RuntimeCommand,
  type RuntimeCompactResult,
  type RuntimeContextWindow,
  type RuntimeDisposeOptions,
  type RuntimeForkResult,
  type RuntimeGitDiff,
  type RuntimeGitDiffOptions,
  type RuntimeMcpAuthOutcome,
  type RuntimeMcpAuthStart,
  type RuntimeMcpServer,
  type RuntimeMcpServerAddParams,
  type RuntimeModelCatalog,
  type RuntimeRewindInfo,
  type RuntimeRewindParams,
  type RuntimeRewindResult,
  type RuntimeSessionSettingUpdate,
  type RuntimeSessionSettings,
  type RuntimeSessionTarget,
  type RuntimeSessionWorkingState,
  type RuntimeSkill,
} from './DroidRuntime';
import { normalizeSdkEvent, normalizeSdkEventImages } from './events/normalizeSdkEvent';
import { type RuntimeInteractionHandler } from './events/runtimeInteractions';
import { ToolExecutionPhaseBuffer } from './events/toolExecutionPhases';
import { createLocalDroidSession } from './process/createLocalDroidSession';
import type { RuntimeDiagnosticSink } from './runtimeDiagnostics';
import type { RuntimeAvailability, RuntimeEvent } from './runtimeEvents';
import { createCapturedSessionView } from './session/capturedSessionView';
import {
  readContextWindow,
  readMissionSettings,
  readModelCatalog,
  readSessionSettings,
  readSessionWorkingState,
  updateSessionSetting,
} from './session/metadata';
import { projectStreamAttachments } from './session/projections';
import {
  compact,
  fork,
  rename,
  rewind,
  type ReplacementContext,
} from './session/replacements';
import { projectRewindInfo } from './session/rewindInfo';
import {
  daemonInitializationFailure,
  describeUnknown,
  isMissingCliError,
  normalizeSessionTarget,
  readSubagentStartedNotification,
  sameSessionTarget,
} from './session/sessionSupport';
import type {
  FactoryDroidSession,
  FactoryDroidSessionFactory,
} from './session/sessionTypes';
import {
  createSpecHandoffWatch,
  type SpecHandoffWatch,
} from './session/specHandoffWatch';
import { createToolResultCollector } from './tools/toolResultPreview';
import { createOperationDiffCollector } from './tools/operationDiff';

export interface FactoryDroidRuntimeOptions {
  readonly interactionHandler: RuntimeInteractionHandler;
  readonly createSdkSession?: FactoryDroidSessionFactory;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly observability?: DroidObservability;
  /**
   * Lists custom slash commands for a session. Injectable for tests;
   * defaults to the short-lived public-client catalog loader.
   */
  readonly loadSessionCommands?: typeof loadSessionCommands;
  readonly onSessionNotification?: (
    parentSessionId: string,
    notification: Record<string, unknown>,
  ) => void;
}

export class FactoryDroidRuntime implements DroidRuntime {
  private readonly createSdkSession: FactoryDroidSessionFactory;
  private readonly interactionHandler: RuntimeInteractionHandler;
  private readonly diagnostics: RuntimeDiagnosticSink | undefined;
  private readonly loadSessionCommands: typeof loadSessionCommands;
  private readonly onSessionNotification?: FactoryDroidRuntimeOptions['onSessionNotification'];
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
  /**
   * Armed after the user approves an ExitSpecMode plan with a
   * `proceed_new_session*` outcome: watches session notifications for
   * the dual handoff signal (an `agent_turn_completed` notification
   * with reason `spec_handoff`, plus a notification envelope scoped to
   * a different session id, which is the SDK's documented proxy for
   * the implementation session).
   */
  private specHandoffWatch: SpecHandoffWatch | null = null;
  /**
   * Session-lifetime watch for `child_session_available` notifications
   * (Task tool delegating to a subagent). Armed once per created
   * session; events surface only while a turn is active because a
   * subagent always spawns under a running parent Task tool.
   */
  private subagentWatchUnsubscribe: (() => void) | null = null;
  /** Runtime events queued for the active turn's stream to yield. */
  private pendingTurnEvents: RuntimeEvent[] = [];
  private readonly toolExecutionPhases = new ToolExecutionPhaseBuffer();
  private activeTurnAbort: AbortController | null = null;

  constructor(options: FactoryDroidRuntimeOptions) {
    const handler = options.interactionHandler;
    this.interactionHandler = {
      requestPermission: async (request) => {
        const handoffWatch = this.beginSpecHandoffWatch(request);
        try {
          const result = await handler.requestPermission(request);
          handoffWatch?.resolve(result);
          return result;
        } catch (error) {
          handoffWatch?.dispose();
          throw error;
        }
      },
      askUser: (request) => handler.askUser(request),
      // Auto-cancelled interactions used to leave zero trace, which
      // made a projection failure look like a user cancel to the CLI.
      onAutoCancelled: ({ interaction, reason }) => {
        this.recordDiagnostic({
          level: 'warn',
          name: 'runtime.permission.auto-cancelled',
          attributes: { interaction, reason },
        });
      },
    };
    this.diagnostics = options.diagnostics;
    this.loadSessionCommands = options.loadSessionCommands ?? loadSessionCommands;
    this.onSessionNotification = options.onSessionNotification;
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

  getSessionCwd(): string | null {
    return this.session?.cwd ?? null;
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
    const cancellation = new AbortController();
    this.activeTurnAbort = cancellation;
    const startedAt = performance.now();
    let projectedEventCount = 0;
    let toolStartCount = 0;
    let toolProgressCount = 0;
    let toolResultCount = 0;
    let outcome = 'stream-ended';
    let failureDetail: string | undefined;
    const startedTools = new Set<string>();
    const collectResult = createToolResultCollector(this.sessionTarget?.cwd);
    const collectOperation = createOperationDiffCollector(
      this.sessionTarget?.cwd,
      session.id,
    );
    this.toolExecutionPhases.reset();
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.turn.started',
      attributes: {
        textLength: text.length,
        attachmentCount: attachments?.length ?? 0,
      },
      detail: text,
    });

    try {
      for await (const sdkEvent of session.stream(text, {
        includePartialMessages: true,
        abortSignal: cancellation.signal,
        ...projectStreamAttachments(attachments),
      })) {
        if (this.disposed || this.activeTurn !== turn) {
          outcome = 'stopped';
          return;
        }

        // Out-of-band runtime events (spec handoff) surface ahead of
        // the current stream event so they always precede turn-complete.
        while (this.pendingTurnEvents.length > 0) {
          const pending = this.pendingTurnEvents.shift()!;
          projectedEventCount += 1;
          yield pending;
        }
        const event = normalizeSdkEvent(
          sdkEvent,
          this.sessionTarget?.cwd,
          collectResult(sdkEvent),
          collectOperation(sdkEvent),
        );
        if (event) {
          projectedEventCount += 1;
          switch (event.type) {
            case 'tool-start':
              toolStartCount += 1;
              // tool_call_delta re-emits tool-start for the same tool;
              // log only the first sighting per toolUseId so the log
              // reads one line per real tool invocation.
              if (!startedTools.has(event.toolUseId)) {
                startedTools.add(event.toolUseId);
                this.recordDiagnostic({
                  level: 'debug',
                  name: 'runtime.tool.started',
                  attributes: {
                    tool: event.toolName,
                    toolUseId: event.toolUseId,
                    action: event.action,
                    ...(event.filePath === undefined ? {} : { filePath: event.filePath }),
                  },
                  ...(event.detail === undefined ? {} : { detail: event.detail }),
                });
              }
              break;
            case 'tool-progress':
              toolProgressCount += 1;
              break;
            case 'tool-result':
              toolResultCount += 1;
              this.recordDiagnostic({
                level: event.isError ? 'warn' : 'debug',
                name: 'runtime.tool.finished',
                attributes: {
                  tool: event.toolName,
                  toolUseId: event.toolUseId,
                  isError: event.isError,
                },
              });
              break;
            case 'error':
              this.recordDiagnostic({
                level: 'error',
                name: 'runtime.stream.error',
                detail: describeUnknown(sdkEvent),
              });
              break;
          }
          if (event.type === 'turn-complete') {
            outcome = event.outcome;
          }
          yield event;
          if (event.type === 'tool-start') {
            for (const phase of this.toolExecutionPhases.start(event.toolUseId)) {
              projectedEventCount += 1;
              yield phase;
            }
          }
        }

        // Image blocks travel on events whose main projection is a
        // lifecycle update (tool_result) or a duplicate of streamed
        // text (assistant), so they surface as separate events.
        for (const imageEvent of normalizeSdkEventImages(sdkEvent)) {
          projectedEventCount += 1;
          yield imageEvent;
        }
      }
      while (this.pendingTurnEvents.length > 0 && outcome === 'stream-ended') {
        projectedEventCount += 1;
        yield this.pendingTurnEvents.shift()!;
      }
    } catch (error) {
      const recovered = recoveredTurnError(error, this.sessionTarget?.cwd);
      if (recovered && !cancellation.signal.aborted) { outcome = 'transport-recovered'; throw recovered; }
      recovered?.dispose();
      outcome = cancellation.signal.aborted ? 'interrupted' : 'failed';
      failureDetail = cancellation.signal.aborted ? undefined : describeUnknown(error);
      if (cancellation.signal.aborted) throw new DOMException('Droid turn interrupted.', 'AbortError');
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
          toolUniqueCount: startedTools.size,
          toolProgressCount,
          toolResultCount,
        },
        ...(failureDetail === undefined ? {} : { detail: failureDetail }),
      });
      this.disarmSpecHandoffWatch();
      this.pendingTurnEvents = [];
      this.toolExecutionPhases.reset();
      if (this.activeTurn === turn) {
        this.activeTurn = null;
        this.activeTurnAbort = null;
      }
    }
  }

  readSessionSettings(): Promise<RuntimeSessionSettings> {
    return readSessionSettings({
      session: this.requireSession(),
      recordDiagnostic: (event) => this.recordDiagnostic(event),
    });
  }

  readMissionSettings(): import('./DroidRuntime').RuntimeMissionSettings | null {
    return readMissionSettings({
      session: this.requireSession(),
      recordDiagnostic: (event) => this.recordDiagnostic(event),
    });
  }

  readContextWindow(): Promise<RuntimeContextWindow> {
    return readContextWindow({
      session: this.requireSession(),
      recordDiagnostic: (event) => this.recordDiagnostic(event),
    });
  }

  readModelCatalog(): Promise<RuntimeModelCatalog> {
    return readModelCatalog({
      session: this.requireSession(),
      recordDiagnostic: (event) => this.recordDiagnostic(event),
    });
  }

  updateSessionSetting(
    update: RuntimeSessionSettingUpdate,
  ): Promise<RuntimeSessionSettings> {
    return updateSessionSetting(
      {
        session: this.requireSession(),
        recordDiagnostic: (event) => this.recordDiagnostic(event),
      },
      update,
    );
  }

  async interrupt(): Promise<void> {
    if (this.disposed || !this.session || !this.activeTurn) {
      return;
    }

    const cancellation = this.activeTurnAbort;
    await this.session.interrupt();
    cancellation?.abort();
  }

  async interruptSession(): Promise<void> {
    if (this.disposed || !this.session) {
      return;
    }

    const cancellation = this.activeTurnAbort;
    await this.session.interrupt();
    cancellation?.abort();
  }

  readSessionWorkingState(): Promise<RuntimeSessionWorkingState> {
    return readSessionWorkingState({
      session: this.requireSession(),
      recordDiagnostic: (event) => this.recordDiagnostic(event),
    });
  }

  supportsBackgroundTurns(): boolean {
    return (
      !this.disposed &&
      this.session !== null &&
      typeof this.session.readWorkingState === 'function'
    );
  }

  rewind(params: RuntimeRewindParams): Promise<RuntimeRewindResult> {
    return rewind(this.replacementContext(), params);
  }

  async getRewindInfo(messageId: string): Promise<RuntimeRewindInfo> {
    const session = this.requireSession();
    if (typeof session.getRewindInfo !== 'function') {
      throw new Error('The Droid session does not report rewind file info.');
    }
    const info = await session.getRewindInfo({ messageId });
    return projectRewindInfo(info, this.sessionTarget?.cwd ?? null);
  }

  supportsGitDiff(): boolean {
    return !this.disposed && typeof this.session?.getGitDiff === 'function';
  }

  async readGitDiff(options?: RuntimeGitDiffOptions): Promise<RuntimeGitDiff> {
    const session = this.requireSession();
    if (typeof session.getGitDiff !== 'function') {
      throw new Error('The Droid session does not report a git diff.');
    }
    return projectGitDiff(await session.getGitDiff(options), this.getSessionCwd() ?? this.sessionTarget?.cwd ?? null);
  }

  compact(): Promise<RuntimeCompactResult> {
    return compact(this.replacementContext());
  }

  fork(title: string): Promise<RuntimeForkResult> {
    return fork(this.replacementContext(), title);
  }

  rename(title: string): Promise<void> {
    return rename(this.replacementContext(), title);
  }

  listSkills(): Promise<readonly RuntimeSkill[]> {
    return listSkills(this.requireSession());
  }

  setSkillDisabled(name: string, disabled: boolean): Promise<void> {
    return setSkillDisabled(this.requireSession(), name, disabled);
  }

  async listCommands(): Promise<readonly RuntimeCommand[]> {
    const session = this.requireSession();
    const target = this.sessionTarget;
    if (target === null) {
      throw new Error('Droid runtime is not initialized.');
    }

    const startedAt = performance.now();
    let commands: readonly RuntimeCommand[];
    try {
      commands = await (session.listCommands?.() ??
        this.loadSessionCommands({
          cwd: target.cwd,
          sessionId: session.id,
        }));
    } catch (error) {
      this.recordDiagnostic({
        level: 'error',
        name: 'runtime.commands.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'sdk-error',
        },
      });
      throw error;
    }
    this.recordDiagnostic({
      level: 'info',
      name: 'runtime.commands.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'success',
        commandCount: commands.length,
      },
    });
    return commands;
  }

  listMcpServers(): Promise<readonly RuntimeMcpServer[]> {
    return listMcpServers(this.requireSession());
  }

  setMcpServerEnabled(name: string, enabled: boolean): Promise<void> {
    return setMcpServerEnabled(this.requireSession(), name, enabled);
  }

  addMcpServer(params: RuntimeMcpServerAddParams): Promise<void> {
    return addMcpServer(this.requireSession(), params);
  }

  removeMcpServer(name: string): Promise<void> {
    return removeMcpServer(this.requireSession(), name);
  }

  authenticateMcpServer(
    name: string,
    onCompleted: (outcome: RuntimeMcpAuthOutcome) => void,
  ): Promise<RuntimeMcpAuthStart> {
    return authenticateMcpServer(this.requireSession(), name, onCompleted);
  }

  private beginSpecHandoffWatch(
    request: Parameters<RuntimeInteractionHandler['requestPermission']>[0],
  ): SpecHandoffWatch | null {
    if (this.disposed || this.specHandoffWatch !== null) {
      return null;
    }
    let watch: SpecHandoffWatch | null = null;
    watch = createSpecHandoffWatch({
      request,
      session: this.session,
      onClosed: () => {
        if (this.specHandoffWatch === watch) {
          this.specHandoffWatch = null;
        }
      },
      onHandoff: (planningSessionId, implementationSessionId) => {
        this.pendingTurnEvents.push({
          type: 'spec-handoff',
          implementationSessionId,
        });
        this.recordDiagnostic({
          level: 'info',
          name: 'runtime.spec.handoff',
          attributes: {
            planningSessionId,
            implementationSessionId,
          },
        });
      },
    });
    this.specHandoffWatch = watch;
    return watch;
  }

  private disarmSpecHandoffWatch(): void {
    const watch = this.specHandoffWatch;
    if (watch === null) {
      return;
    }
    this.specHandoffWatch = null;
    watch.dispose();
  }

  private adoptSession(
    nextSession: FactoryDroidSession,
    availableModels?: readonly AvailableModelConfig[],
  ): void {
    this.disarmSubagentWatch();
    this.session = createCapturedSessionView(nextSession, availableModels);
    if (this.sessionTarget !== null) {
      this.sessionTarget = {
        kind: 'resume',
        cwd: this.sessionTarget.cwd,
        sessionId: nextSession.id,
      };
    }
    this.armSubagentWatch();
  }

  private armSubagentWatch(): void {
    const session = this.session;
    if (
      this.disposed ||
      this.subagentWatchUnsubscribe !== null ||
      session === null ||
      typeof session.onNotification !== 'function'
    ) {
      return;
    }
    this.subagentWatchUnsubscribe = session.onNotification((notification) => {
      this.onSessionNotification?.(session.id, notification);
      const phase =
        this.activeTurn === null
          ? undefined
          : this.toolExecutionPhases.observe(notification, session.id);
      if (phase !== undefined) this.pendingTurnEvents.push(phase);
      const started = readSubagentStartedNotification(notification);
      if (started === null) {
        return;
      }
      // A notification outside an active turn has no parent Task row to attach to.
      if (this.activeTurn === null) {
        return;
      }
      this.pendingTurnEvents.push({
        type: 'subagent-started',
        toolUseId: started.toolUseId,
        subagentType: started.subagentType,
        description: started.description,
        ...(started.startedAt === undefined ? {} : { startedAt: started.startedAt }),
      });
      this.recordDiagnostic({
        level: 'info',
        name: 'runtime.subagent.started',
        attributes: {
          subagentType: started.subagentType,
          hasToolUseId: started.toolUseId !== null,
        },
      });
    });
  }

  private disarmSubagentWatch(): void {
    const unsubscribe = this.subagentWatchUnsubscribe;
    if (unsubscribe === null) {
      return;
    }
    this.subagentWatchUnsubscribe = null;
    unsubscribe();
  }

  dispose(options?: RuntimeDisposeOptions): Promise<void> {
    if (this.disposal) {
      return this.disposal;
    }

    this.disposed = true;
    this.disarmSpecHandoffWatch();
    this.disarmSubagentWatch();
    const disposal = this.disposeOwnedSession(
      options?.preserveBackendTurn === true,
    ).catch((error) => {
      if (this.disposal === disposal) {
        this.disposal = null;
      }
      throw error;
    });
    this.disposal = disposal;
    return disposal;
  }

  private async create(target: RuntimeSessionTarget): Promise<RuntimeAvailability> {
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
      if (error instanceof DaemonAvailabilityError) {
        const [reason, message] = daemonInitializationFailure(error.reason);
        this.recordInitializationFinished(startedAt, reason, 'error', error);
        return this.unavailable(reason, message);
      }
      if (error instanceof InvalidSessionCwdError) {
        this.recordInitializationFinished(startedAt, 'invalid-cwd', 'warn');
        return this.unavailable(
          'invalid-cwd',
          'Droid rejected the requested working directory.',
        );
      }

      if (isMissingCliError(error)) {
        this.recordInitializationFinished(startedAt, 'cli-not-found', 'warn');
        return this.unavailable(
          'cli-not-found',
          'The Droid CLI executable was not found.',
        );
      }

      this.recordInitializationFinished(
        startedAt,
        'initialization-failed',
        'error',
        error,
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
      this.recordInitializationFinished(startedAt, 'disposed', 'warn');
      return this.unavailable(
        'initialization-failed',
        'Droid runtime was disposed during initialization.',
      );
    }

    this.session = session;
    this.sessionTarget = target;
    this.armSubagentWatch();
    this.recordInitializationFinished(startedAt, 'available', 'info');
    return this.available(session);
  }

  private async disposeOwnedSession(preserveBackendTurn = false): Promise<void> {
    await this.initialization?.promise;

    const session = this.session;
    if (!session) {
      return;
    }

    // Detached continuation: a daemon-backed session keeps its turn
    // running after close() (which only detaches), so skip the
    // interrupt when the caller asked to preserve it. Process
    // sessions cannot continue detached; they interrupt as before.
    const preserve =
      preserveBackendTurn && typeof session.readWorkingState === 'function';
    let interruptError: unknown;
    if (this.activeTurn && !preserve) {
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
    error?: unknown,
  ): void {
    // The failure reason rides along (bounded): a bare outcome made
    // the 2026-08-13 "session could not be opened" hunt needlessly
    // blind.
    const reason = error instanceof Error ? error.message : undefined;
    this.recordDiagnostic({
      level,
      name: 'runtime.initialize.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome,
        ...(reason === undefined ? {} : { reason: reason.slice(0, 300) }),
      },
    });
  }

  private recordDiagnostic(event: Parameters<RuntimeDiagnosticSink['record']>[0]): void {
    try {
      this.diagnostics?.record(event);
    } catch {
      // Diagnostics must never alter Runtime behavior.
    }
  }
  private replacementContext(): ReplacementContext {
    return {
      session: this.requireSession(),
      active: this.activeTurn !== null,
      recordDiagnostic: (event) => this.recordDiagnostic(event),
      adoptSession: (session, models) => this.adoptSession(session, models),
    };
  }
}

export { createLocalDroidSession } from './process/createLocalDroidSession';
export type {
  FactoryDroidSessionGitDiff,
  FactoryDroidSessionRewindInfo,
  FactoryDroidSessionRewindParams,
} from './session/replacementTypes';
export type {
  FactoryDroidSession,
  FactoryDroidSessionFactory,
} from './session/sessionTypes';
