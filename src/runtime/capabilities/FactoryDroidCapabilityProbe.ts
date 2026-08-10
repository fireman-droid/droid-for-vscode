import { execFile } from 'node:child_process';

import {
  ProcessTransport,
  ToolConfirmationOutcome,
  listSessions,
  resumeSession,
  type ClientAskUserHandler,
  type ClientPermissionHandler,
  type RequestPermissionHandlerResult,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';

import {
  DROID_CAPABILITY_DECLARATIONS,
  DROID_CAPABILITY_REPORT_VERSION,
  DROID_CAPABILITY_SCHEMA_VERSION,
  DROID_CAPABILITY_VERSIONS,
  MAX_CAPABILITY_COUNT,
  type DroidCapabilityId,
  type DroidCapabilityProbeState,
} from './capabilityContract';

const CLI_VERSION_TIMEOUT_MS = 5_000;
const CLI_VERSION_MAX_OUTPUT_BYTES = 4_096;
const CLI_VERSION_MAX_LENGTH = 64;
const SESSION_LIST_LIMIT = 1 as const;
const SESSION_ID_MAX_LENGTH = 512;
const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;

const SMOKE_REQUIRED_CAPABILITY_IDS = [
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
] as const satisfies readonly DroidCapabilityId[];

export type CapabilityFailureReason =
  | 'cli-execution-failed'
  | 'cli-timeout'
  | 'cli-output-malformed'
  | 'cli-output-oversized'
  | 'session-list-failed'
  | 'session-list-timeout'
  | 'session-list-response-malformed'
  | 'session-id-malformed'
  | 'session-connect-failed'
  | 'session-connect-timeout'
  | 'session-open-failed'
  | 'session-open-timeout'
  | 'session-open-response-malformed'
  | 'no-saved-session'
  | 'session-unavailable'
  | 'settings-read-failed'
  | 'settings-field-missing'
  | 'cwd-read-failed'
  | 'cwd-response-malformed'
  | 'tools-read-failed'
  | 'tools-read-timeout'
  | 'tools-response-malformed'
  | 'skills-read-failed'
  | 'skills-read-timeout'
  | 'skills-response-malformed'
  | 'mcp-servers-read-failed'
  | 'mcp-servers-read-timeout'
  | 'mcp-servers-response-malformed'
  | 'mcp-tools-read-failed'
  | 'mcp-tools-read-timeout'
  | 'mcp-tools-response-malformed'
  | 'context-read-failed'
  | 'context-read-timeout'
  | 'context-response-malformed'
  | 'cleanup-failed'
  | 'session-close-timeout'
  | 'transport-close-timeout';

export interface CapabilityCliResult {
  readonly state: Exclude<DroidCapabilityProbeState, 'not-probed'>;
  readonly version?: string;
  readonly reason?: CapabilityFailureReason;
}

export interface CapabilityCountResult {
  readonly state: Exclude<DroidCapabilityProbeState, 'not-probed'>;
  readonly count?: number;
  readonly countCapped?: boolean;
  readonly reason?: CapabilityFailureReason;
}

export interface CapabilityPresenceResult {
  readonly state: Exclude<DroidCapabilityProbeState, 'not-probed'>;
  readonly fields?: Readonly<Record<string, boolean>>;
  readonly reason?: CapabilityFailureReason;
}

export interface CapabilityProbeEntry {
  readonly id: DroidCapabilityId;
  readonly state: DroidCapabilityProbeState;
  readonly reason?: CapabilityFailureReason;
}

interface CapabilityObservedState {
  readonly state: Exclude<DroidCapabilityProbeState, 'not-probed'>;
  readonly reason?: CapabilityFailureReason;
}

export interface FactoryDroidCapabilityReport {
  readonly schemaVersion: typeof DROID_CAPABILITY_SCHEMA_VERSION;
  readonly reportVersion: typeof DROID_CAPABILITY_REPORT_VERSION;
  readonly sdkVersion: string;
  readonly protocolVersion: string;
  readonly cli: CapabilityCliResult;
  readonly session: {
    readonly acquisition: 'resumed' | 'unavailable';
    readonly cleanup: 'not-needed' | 'succeeded' | 'failed';
    readonly reason?: CapabilityFailureReason;
  };
  readonly observations: {
    readonly settings: CapabilityPresenceResult;
    readonly cwd: CapabilityPresenceResult;
    readonly tools: CapabilityCountResult;
    readonly skills: CapabilityCountResult;
    readonly mcpServers: CapabilityCountResult;
    readonly mcpTools: CapabilityCountResult;
    readonly context: CapabilityPresenceResult;
  };
  readonly capabilities: readonly CapabilityProbeEntry[];
}

export interface CapabilitySession {
  readonly settings: unknown;
  readonly cwd: unknown;
  close(): Promise<void>;
  listTools(): Promise<unknown>;
  listSkills(): Promise<unknown>;
  listMcpServers(): Promise<unknown>;
  listMcpTools(): Promise<unknown>;
  getContextStats(): Promise<unknown>;
}

export interface CapabilityTransport extends StringFramedDroidClientTransport {
  connect(): Promise<void>;
}

export interface CapabilitySessionFactory {
  createTransport(options: { readonly cwd: string }): CapabilityTransport;
  listSessions(options: {
    readonly cwd: string;
    readonly limit: typeof SESSION_LIST_LIMIT;
  }): Promise<readonly unknown[]>;
  resumeSession(
    sessionId: string,
    options: CapabilitySessionOpenOptions,
  ): Promise<CapabilitySession>;
}

export interface CapabilitySessionOpenOptions {
  readonly transport: StringFramedDroidClientTransport;
  readonly permissionHandler: ClientPermissionHandler;
  readonly askUserHandler: ClientAskUserHandler;
  readonly autoRejectPermissionRequests: true;
  readonly abortSignal: AbortSignal;
}

export interface CliVersionExecution {
  readonly status: 'completed' | 'failed' | 'timeout';
  readonly stdout: string;
  readonly stderr: string;
}

export type CliVersionRunner = () => Promise<CliVersionExecution>;

export interface FactoryDroidCapabilityProbeOptions {
  readonly sessionFactory?: CapabilitySessionFactory;
  readonly runCliVersion?: CliVersionRunner;
  readonly operationTimeoutMs?: number;
}

const cancellingPermissionHandler: ClientPermissionHandler = async () =>
  ToolConfirmationOutcome.Cancel as RequestPermissionHandlerResult;

const cancellingAskUserHandler: ClientAskUserHandler = async () => ({
  cancelled: true,
  answers: [],
});

const sdkSessionFactory: CapabilitySessionFactory = {
  createTransport: ({ cwd }) => new ProcessTransport({ cwd }),
  listSessions,
  resumeSession,
};

export class FactoryDroidCapabilityProbe {
  private readonly sessionFactory: CapabilitySessionFactory;
  private readonly runCliVersion: CliVersionRunner;
  private readonly operationTimeoutMs: number;

  constructor(options: FactoryDroidCapabilityProbeOptions = {}) {
    this.sessionFactory = options.sessionFactory ?? sdkSessionFactory;
    this.runCliVersion = options.runCliVersion ?? runLocalCliVersion;
    this.operationTimeoutMs =
      typeof options.operationTimeoutMs === 'number' &&
      Number.isFinite(options.operationTimeoutMs) &&
      options.operationTimeoutMs > 0
        ? options.operationTimeoutMs
        : DEFAULT_OPERATION_TIMEOUT_MS;
  }

  async probe(cwd: string): Promise<FactoryDroidCapabilityReport> {
    const cli = await probeCliVersion(this.runCliVersion);
    let observations = unavailableObservations('session-unavailable');
    let session: CapabilitySession | undefined;
    let transport: CapabilityTransport | undefined;
    let acquisition: FactoryDroidCapabilityReport['session']['acquisition'] =
      'unavailable';
    let sessionReason: CapabilityFailureReason | undefined;
    let sessionListState: CapabilityObservedState = {
      state: 'unavailable',
      reason: 'session-list-failed',
    };
    let resumeAttempted = false;
    let cleanup: FactoryDroidCapabilityReport['session']['cleanup'] =
      'not-needed';
    let cleanupReason: CapabilityFailureReason | undefined;

    try {
      const listResult = await runBoundedOperation(
        () =>
          this.sessionFactory.listSessions({
            cwd,
            limit: SESSION_LIST_LIMIT,
          }),
        this.operationTimeoutMs,
      );
      if (listResult.status === 'timeout') {
        sessionReason = 'session-list-timeout';
        sessionListState = {
          state: 'unavailable',
          reason: 'session-list-timeout',
        };
      } else if (listResult.status === 'failed') {
        sessionReason = 'session-list-failed';
      } else if (!Array.isArray(listResult.value)) {
        sessionReason = 'session-list-response-malformed';
        sessionListState = {
          state: 'unavailable',
          reason: 'session-list-response-malformed',
        };
      } else {
        const listed = listResult.value;
        sessionListState = { state: 'supported' };
        if (listed.length === 0) {
          sessionReason = 'no-saved-session';
        } else {
          const listedSessionId = readSessionId(listed[0]);
          if (listedSessionId === null) {
            sessionReason = 'session-id-malformed';
          } else {
            try {
              transport = this.sessionFactory.createTransport({ cwd });
              cleanup = 'succeeded';
            } catch {
              sessionReason = 'session-connect-failed';
            }
            if (!sessionReason && transport) {
              const connectResult = await runBoundedOperation(
                () => transport!.connect(),
                this.operationTimeoutMs,
              );
              if (connectResult.status === 'timeout') {
                sessionReason = 'session-connect-timeout';
              } else if (connectResult.status === 'failed') {
                sessionReason = 'session-connect-failed';
              }
            }

            if (!sessionReason && transport) {
              const resumeAbortController = new AbortController();
              const openOptions: CapabilitySessionOpenOptions = {
                transport,
                permissionHandler: cancellingPermissionHandler,
                askUserHandler: cancellingAskUserHandler,
                autoRejectPermissionRequests: true,
                abortSignal: resumeAbortController.signal,
              };
              resumeAttempted = true;
              const resumeResult = await runBoundedOperation(
                () =>
                  this.sessionFactory.resumeSession(
                    listedSessionId,
                    openOptions,
                  ),
                this.operationTimeoutMs,
                {
                  onTimeout: () => resumeAbortController.abort(),
                  onLateValue: (lateSession) => {
                    if (isCapabilitySession(lateSession)) {
                      void runBoundedOperation(
                        () => lateSession.close(),
                        this.operationTimeoutMs,
                      );
                    }
                  },
                },
              );
              if (resumeResult.status === 'completed') {
                if (isCapabilitySession(resumeResult.value)) {
                  session = resumeResult.value;
                  acquisition = 'resumed';
                } else {
                  sessionReason = 'session-open-response-malformed';
                }
              } else if (resumeResult.status === 'timeout') {
                sessionReason = 'session-open-timeout';
              } else {
                sessionReason = 'session-open-failed';
              }
            }
          }
        }
      }

      if (session) {
        const activeSession = session;
        observations.settings = probeSettings(activeSession);
        observations.cwd = probeCwd(activeSession);
        observations.tools = await probeArray(
          () => activeSession.listTools(),
          'tools-read-failed',
          'tools-read-timeout',
          'tools-response-malformed',
          this.operationTimeoutMs,
        );
        observations.skills = await probeNestedArray(
          () => activeSession.listSkills(),
          'skills',
          'skills-read-failed',
          'skills-read-timeout',
          'skills-response-malformed',
          this.operationTimeoutMs,
        );
        observations.mcpServers = await probeNestedArray(
          () => activeSession.listMcpServers(),
          'servers',
          'mcp-servers-read-failed',
          'mcp-servers-read-timeout',
          'mcp-servers-response-malformed',
          this.operationTimeoutMs,
        );
        observations.mcpTools = await probeArray(
          () => activeSession.listMcpTools(),
          'mcp-tools-read-failed',
          'mcp-tools-read-timeout',
          'mcp-tools-response-malformed',
          this.operationTimeoutMs,
        );
        observations.context = await probeContext(
          () => activeSession.getContextStats(),
          this.operationTimeoutMs,
        );
      } else if (sessionReason) {
        observations = unavailableObservations(sessionReason);
      }
    } catch {
      sessionReason = 'session-list-failed';
      observations = unavailableObservations(sessionReason);
    } finally {
      if (session) {
        const closeSessionResult = await runBoundedOperation(
          () => session!.close(),
          this.operationTimeoutMs,
        );
        if (closeSessionResult.status !== 'completed') {
          cleanup = 'failed';
          cleanupReason =
            closeSessionResult.status === 'timeout'
              ? 'session-close-timeout'
              : 'cleanup-failed';
        }
      }
      if (transport) {
        const closeTransportResult = await runBoundedOperation(
          () => transport!.close(),
          this.operationTimeoutMs,
        );
        if (closeTransportResult.status !== 'completed') {
          cleanup = 'failed';
          if (
            closeTransportResult.status === 'timeout' &&
            (cleanupReason === undefined || cleanupReason === 'cleanup-failed')
          ) {
            cleanupReason = 'transport-close-timeout';
          } else {
            cleanupReason ??= 'cleanup-failed';
          }
        }
      }
    }

    if (cleanup === 'failed') {
      sessionReason = cleanupReason ?? 'cleanup-failed';
    }

    const sessionReport = {
      acquisition,
      cleanup,
      ...(sessionReason ? { reason: sessionReason } : {}),
    };

    return {
      schemaVersion: DROID_CAPABILITY_SCHEMA_VERSION,
      reportVersion: DROID_CAPABILITY_REPORT_VERSION,
      sdkVersion: DROID_CAPABILITY_VERSIONS.sdkVersion,
      protocolVersion: DROID_CAPABILITY_VERSIONS.protocolVersion,
      cli,
      session: sessionReport,
      observations,
      capabilities: projectCapabilityStates(
        cli,
        acquisition,
        resumeAttempted,
        sessionListState,
        sessionReason,
        observations,
      ),
    };
  }
}

export function isCapabilitySmokeSuccessful(
  report: FactoryDroidCapabilityReport,
): boolean {
  if (
    report.cli.state !== 'supported' ||
    report.session.acquisition !== 'resumed' ||
    report.session.cleanup !== 'succeeded'
  ) {
    return false;
  }

  const capabilities = new Map(
    report.capabilities.map((entry) => [entry.id, entry.state]),
  );
  return SMOKE_REQUIRED_CAPABILITY_IDS.every(
    (id) => capabilities.get(id) === 'supported',
  );
}

export async function runLocalCliVersion(): Promise<CliVersionExecution> {
  return new Promise((resolve) => {
    execFile(
      'droid',
      ['--version'],
      {
        encoding: 'utf8',
        maxBuffer: CLI_VERSION_MAX_OUTPUT_BYTES,
        shell: false,
        timeout: CLI_VERSION_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            status: 'killed' in error && error.killed ? 'timeout' : 'failed',
            stdout: '',
            stderr: '',
          });
          return;
        }
        resolve({ status: 'completed', stdout, stderr });
      },
    );
  });
}

async function probeCliVersion(
  runner: CliVersionRunner,
): Promise<CapabilityCliResult> {
  let execution: CliVersionExecution;
  try {
    execution = await runner();
  } catch {
    return { state: 'unavailable', reason: 'cli-execution-failed' };
  }

  if (execution.status === 'timeout') {
    return { state: 'unavailable', reason: 'cli-timeout' };
  }
  if (execution.status !== 'completed') {
    return { state: 'unavailable', reason: 'cli-execution-failed' };
  }

  if (
    execution.stdout.length + execution.stderr.length >
    CLI_VERSION_MAX_OUTPUT_BYTES
  ) {
    return { state: 'unavailable', reason: 'cli-output-oversized' };
  }

  const output = `${execution.stdout}\n${execution.stderr}`.trim();
  const matches = output.match(
    /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$)/g,
  );
  if (!matches || matches.length !== 1) {
    return { state: 'unavailable', reason: 'cli-output-malformed' };
  }

  const version = matches[0].trim().replace(/^v/, '');
  if (version.length === 0 || version.length > CLI_VERSION_MAX_LENGTH) {
    return { state: 'unavailable', reason: 'cli-output-malformed' };
  }
  return { state: 'supported', version };
}

function probeSettings(session: CapabilitySession): CapabilityPresenceResult {
  try {
    const settings = session.settings;
    if (!isRecord(settings)) {
      return { state: 'unavailable', reason: 'settings-read-failed' };
    }
    return {
      state: 'supported',
      fields: {
        present: true,
        interactionMode: hasOwn(settings, 'interactionMode'),
        model: hasOwn(settings, 'modelId'),
        reasoning: hasOwn(settings, 'reasoningEffort'),
        autonomy: hasOwn(settings, 'autonomyLevel'),
      },
    };
  } catch {
    return { state: 'unavailable', reason: 'settings-read-failed' };
  }
}

function probeCwd(session: CapabilitySession): CapabilityPresenceResult {
  try {
    return {
      state: 'supported',
      fields: { present: typeof session.cwd === 'string' },
    };
  } catch {
    return { state: 'unavailable', reason: 'cwd-read-failed' };
  }
}

async function probeArray(
  read: () => Promise<unknown>,
  failureReason: CapabilityFailureReason,
  timeoutReason: CapabilityFailureReason,
  malformedReason: CapabilityFailureReason,
  timeoutMs: number,
): Promise<CapabilityCountResult> {
  const result = await runBoundedOperation(read, timeoutMs);
  if (result.status === 'timeout') {
    return { state: 'unavailable', reason: timeoutReason };
  }
  if (result.status === 'failed') {
    return { state: 'unavailable', reason: failureReason };
  }
  return Array.isArray(result.value)
    ? boundedCount(result.value.length)
    : { state: 'unavailable', reason: malformedReason };
}

async function probeNestedArray(
  read: () => Promise<unknown>,
  key: string,
  failureReason: CapabilityFailureReason,
  timeoutReason: CapabilityFailureReason,
  malformedReason: CapabilityFailureReason,
  timeoutMs: number,
): Promise<CapabilityCountResult> {
  const result = await runBoundedOperation(read, timeoutMs);
  if (result.status === 'timeout') {
    return { state: 'unavailable', reason: timeoutReason };
  }
  if (result.status === 'failed') {
    return { state: 'unavailable', reason: failureReason };
  }
  if (!isRecord(result.value)) {
    return { state: 'unavailable', reason: malformedReason };
  }
  const nested = result.value[key];
  return Array.isArray(nested)
    ? boundedCount(nested.length)
    : { state: 'unavailable', reason: malformedReason };
}

async function probeContext(
  read: () => Promise<unknown>,
  timeoutMs: number,
): Promise<CapabilityPresenceResult> {
  const result = await runBoundedOperation(read, timeoutMs);
  if (result.status === 'timeout') {
    return { state: 'unavailable', reason: 'context-read-timeout' };
  }
  if (result.status === 'failed') {
    return { state: 'unavailable', reason: 'context-read-failed' };
  }
  if (!isRecord(result.value)) {
    return { state: 'unavailable', reason: 'context-response-malformed' };
  }
  return {
    state: 'supported',
    fields: {
      used: hasOwn(result.value, 'used'),
      remaining: hasOwn(result.value, 'remaining'),
      limit: hasOwn(result.value, 'limit'),
      accuracy: hasOwn(result.value, 'accuracy'),
    },
  };
}

function boundedCount(count: number): CapabilityCountResult {
  return {
    state: 'supported',
    count: Math.min(count, MAX_CAPABILITY_COUNT),
    countCapped: count > MAX_CAPABILITY_COUNT,
  };
}

function unavailableObservations(
  reason: CapabilityFailureReason,
): {
  settings: CapabilityPresenceResult;
  cwd: CapabilityPresenceResult;
  tools: CapabilityCountResult;
  skills: CapabilityCountResult;
  mcpServers: CapabilityCountResult;
  mcpTools: CapabilityCountResult;
  context: CapabilityPresenceResult;
} {
  return {
    settings: { state: 'unavailable', reason },
    cwd: { state: 'unavailable', reason },
    tools: { state: 'unavailable', reason },
    skills: { state: 'unavailable', reason },
    mcpServers: { state: 'unavailable', reason },
    mcpTools: { state: 'unavailable', reason },
    context: { state: 'unavailable', reason },
  };
}

function projectCapabilityStates(
  cli: CapabilityCliResult,
  acquisition: FactoryDroidCapabilityReport['session']['acquisition'],
  resumeAttempted: boolean,
  sessionListState: CapabilityObservedState,
  sessionReason: CapabilityFailureReason | undefined,
  observations: FactoryDroidCapabilityReport['observations'],
): CapabilityProbeEntry[] {
  const states = new Map<DroidCapabilityId, CapabilityProbeEntry>();
  setState(states, 'runtime.cli-version', cli);

  const sessionState = sessionReason
    ? {
        state: 'unavailable' as const,
        reason: sessionReason,
      }
    : acquisition === 'unavailable'
      ? {
          state: 'unavailable' as const,
          reason: 'session-unavailable' as const,
        }
      : { state: 'supported' as const };
  const cleanupFailed =
    sessionReason !== undefined && isCleanupFailureReason(sessionReason);
  setState(
    states,
    'sessions.list',
    cleanupFailed ? sessionState : sessionListState,
  );
  if (resumeAttempted) {
    setState(states, 'sessions.resume', sessionState);
  }

  const sessionProbeFailure = cleanupFailed ? sessionState : undefined;
  setState(
    states,
    'settings.live',
    sessionProbeFailure ?? observations.settings,
  );
  setState(
    states,
    'settings.mode',
    sessionProbeFailure ??
      requirePresence(
        observations.settings,
        'interactionMode',
        'settings-field-missing',
      ),
  );
  setState(
    states,
    'settings.model',
    sessionProbeFailure ??
      requirePresence(observations.settings, 'model', 'settings-field-missing'),
  );
  setState(
    states,
    'settings.reasoning',
    sessionProbeFailure ??
      requirePresence(observations.settings, 'reasoning', 'settings-field-missing'),
  );
  setState(
    states,
    'settings.autonomy',
    sessionProbeFailure ??
      requirePresence(observations.settings, 'autonomy', 'settings-field-missing'),
  );
  setState(
    states,
    'workspace.cwd',
    sessionProbeFailure ??
      requirePresence(observations.cwd, 'present', 'cwd-response-malformed'),
  );
  setState(
    states,
    'tools.execution',
    sessionProbeFailure ?? observations.tools,
  );
  setState(
    states,
    'skills.list',
    sessionProbeFailure ?? observations.skills,
  );
  setState(
    states,
    'mcp.servers',
    sessionProbeFailure ?? observations.mcpServers,
  );
  setState(
    states,
    'mcp.tools',
    sessionProbeFailure ?? observations.mcpTools,
  );
  setState(
    states,
    'settings.context',
    sessionProbeFailure ??
      requireAllPresence(
        observations.context,
        ['used', 'remaining', 'limit', 'accuracy'],
        'context-response-malformed',
      ),
  );

  return DROID_CAPABILITY_DECLARATIONS.map(
    ({ id }): CapabilityProbeEntry =>
      states.get(id) ?? { id, state: 'not-probed' },
  );
}

function isCleanupFailureReason(reason: CapabilityFailureReason): boolean {
  return (
    reason === 'cleanup-failed' ||
    reason === 'session-close-timeout' ||
    reason === 'transport-close-timeout'
  );
}

function requirePresence(
  result: CapabilityPresenceResult,
  field: string,
  missingReason: CapabilityFailureReason,
): CapabilityObservedState {
  if (result.state !== 'supported') {
    return result;
  }
  return result.fields?.[field] === true
    ? { state: 'supported' }
    : { state: 'unavailable', reason: missingReason };
}

function requireAllPresence(
  result: CapabilityPresenceResult,
  fields: readonly string[],
  missingReason: CapabilityFailureReason,
): CapabilityObservedState {
  if (result.state !== 'supported') {
    return result;
  }
  return fields.every((field) => result.fields?.[field] === true)
    ? { state: 'supported' }
    : { state: 'unavailable', reason: missingReason };
}

type BoundedOperationResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'failed' }
  | { readonly status: 'timeout' };

interface BoundedOperationOptions<T> {
  readonly onTimeout?: () => void;
  readonly onLateValue?: (value: T) => void;
}

async function runBoundedOperation<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  options: BoundedOperationOptions<T> = {},
): Promise<BoundedOperationResult<T>> {
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const operationResult = Promise.resolve()
    .then(operation)
    .then<BoundedOperationResult<T>, BoundedOperationResult<T>>(
      (value) => {
        if (timedOut) {
          options.onLateValue?.(value);
        }
        return { status: 'completed', value };
      },
      () => ({ status: 'failed' }),
    );
  const timeoutResult = new Promise<BoundedOperationResult<T>>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      options.onTimeout?.();
      resolve({ status: 'timeout' });
    }, timeoutMs);
  });

  const result = await Promise.race([operationResult, timeoutResult]);
  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }
  return result;
}

function setState(
  states: Map<DroidCapabilityId, CapabilityProbeEntry>,
  id: DroidCapabilityId,
  result: CapabilityObservedState,
): void {
  states.set(id, {
    id,
    state: result.state,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}

function readSessionId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value.id;
  return typeof id === 'string' &&
    id.length > 0 &&
    id.length <= SESSION_ID_MAX_LENGTH
    ? id
    : null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCapabilitySession(value: unknown): value is CapabilitySession {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return (
      typeof value.close === 'function' &&
      typeof value.listTools === 'function' &&
      typeof value.listSkills === 'function' &&
      typeof value.listMcpServers === 'function' &&
      typeof value.listMcpTools === 'function' &&
      typeof value.getContextStats === 'function'
    );
  } catch {
    return false;
  }
}
