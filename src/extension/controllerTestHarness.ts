// Shared test harness for the ChatController topic test files,
// moved verbatim from the tail of the original ChatController.test.ts.
import { expect, vi } from 'vitest';

import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  type HostToWebviewMessage,
} from '../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeSessionTarget,
  RuntimeSessionWorkingState,
} from '../runtime/DroidRuntime';
import type {
  RuntimeAvailability,
  RuntimeEvent,
} from '../runtime/runtimeEvents';
import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import type {
  RuntimeAskUserResult,
  RuntimeInteractionHandler,
  RuntimePermissionResult,
} from '../runtime/runtimeInteractions';
import type {
  SessionCatalog,
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../runtime/SessionCatalog';
import {
  unavailableSessionHistory,
  type SessionHistoryLoader,
} from '../runtime/history/SessionHistory';
import type { TokenUsageBreakdown } from '../shared/tokenUsage';
import { DaemonAvailabilityError } from '../runtime/daemon/daemonConnection';
import type { DaemonPluginCatalog } from '../runtime/daemon/DaemonPluginCatalog';
import type { DaemonSessionCatalog } from '../runtime/daemon/DaemonSessionCatalog';
import type { AttachmentSources } from './attachmentSources';
import type {
  FileDiffOpener,
  FileDiffOutcome,
} from './fileDiffOpener';
import type {
  OpenPathOutcome,
  PathOpener,
} from './pathOpener';
import type {
  PrototypePreviewOpener,
  PrototypePreviewOutcome,
} from './prototypePreview';
import type {
  ChangeStatsReader,
  FileChangeStat,
} from './changeStats';
import type { GitWorkflow } from './gitWorkflow';
import {
  createWorktreeSessionsFeature,
  type GitExec,
  type WorktreeSessionsFeature,
} from './worktreeSessions';
import type { ExternalUrlOpener } from './externalUrlOpener';
import type { TerminalMirror } from './terminalMirror';
import type {
  BtwSidecarFactory,
  BtwSideChatSidecar,
} from './btwSideChat';
import {
  ChatController,
  type ControllerHostMessage,
} from './ChatController';
import {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
import {
  appendAcceptedUserPrompt,
  createHostTranscriptState,
} from './hostTranscriptState';


// Re-exports so topic files import all fixture dependencies from here.
export {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  type HostToWebviewMessage,
} from '../shared/bridgeMessages';
export type {
  DroidRuntime,
  RuntimeSessionTarget,
  RuntimeSessionWorkingState,
} from '../runtime/DroidRuntime';
export type {
  RuntimeAvailability,
  RuntimeEvent,
} from '../runtime/runtimeEvents';
export type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
export type {
  RuntimeAskUserResult,
  RuntimeInteractionHandler,
  RuntimePermissionResult,
} from '../runtime/runtimeInteractions';
export type {
  SessionCatalog,
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../runtime/SessionCatalog';
export {
  unavailableSessionHistory,
  type SessionHistoryLoader,
} from '../runtime/history/SessionHistory';
export type { TokenUsageBreakdown } from '../shared/tokenUsage';
export { DaemonAvailabilityError } from '../runtime/daemon/daemonConnection';
export type { DaemonPluginCatalog } from '../runtime/daemon/DaemonPluginCatalog';
export type { DaemonSessionCatalog } from '../runtime/daemon/DaemonSessionCatalog';
export type { AttachmentSources } from './attachmentSources';
export type {
  FileDiffOpener,
  FileDiffOutcome,
} from './fileDiffOpener';
export type {
  OpenPathOutcome,
  PathOpener,
} from './pathOpener';
export type {
  PrototypePreviewOpener,
  PrototypePreviewOutcome,
} from './prototypePreview';
export type {
  ChangeStatsReader,
  FileChangeStat,
} from './changeStats';
export type { GitWorkflow } from './gitWorkflow';
export {
  createWorktreeSessionsFeature,
  type GitExec,
  type WorktreeSessionsFeature,
} from './worktreeSessions';
export type { ExternalUrlOpener } from './externalUrlOpener';
export type { TerminalMirror } from './terminalMirror';
export type {
  BtwSidecarFactory,
  BtwSideChatSidecar,
} from './btwSideChat';
export { ChatController } from './ChatController';
export {
  SessionRecoveryStore,
  type SessionRecoveryPersistence,
} from './SessionRecoveryStore';
export {
  appendAcceptedUserPrompt,
  createHostTranscriptState,
} from './hostTranscriptState';

export interface MockRuntime extends DroidRuntime {
  initialize: ReturnType<
    typeof vi.fn<
      (
        target: RuntimeSessionTarget | string,
      ) => Promise<RuntimeAvailability>
    >
  >;
  sendTurn: ReturnType<
    typeof vi.fn<(text: string) => AsyncIterable<RuntimeEvent>>
  >;
  readSessionSettings: ReturnType<
    typeof vi.fn<DroidRuntime['readSessionSettings']>
  >;
  readContextWindow: ReturnType<
    typeof vi.fn<DroidRuntime['readContextWindow']>
  >;
  readModelCatalog: ReturnType<
    typeof vi.fn<DroidRuntime['readModelCatalog']>
  >;
  updateSessionSetting: ReturnType<
    typeof vi.fn<DroidRuntime['updateSessionSetting']>
  >;
  interrupt: ReturnType<typeof vi.fn<() => Promise<void>>>;
  dispose: ReturnType<typeof vi.fn<DroidRuntime['dispose']>>;
}

export function createMockRuntime(
  stream: (text: string) => AsyncIterable<RuntimeEvent> = async function* () {
    yield successfulTurn();
  },
): MockRuntime {
  return {
    initialize: vi.fn(async () => available()),
    readSessionSettings: vi.fn(async () => ({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    })),
    readContextWindow: vi.fn(async () => ({
      availability: 'available',
      used: 40,
      remaining: 60,
      limit: 100,
    })),
    readModelCatalog: vi.fn(async () => ({
      status: 'unavailable',
    })),
    updateSessionSetting: vi.fn(async () => ({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    })),
    sendTurn: vi.fn(stream),
    interrupt: vi.fn(async () => {}),
    dispose: vi.fn<DroidRuntime['dispose']>(async () => {}),
  };
}

export function createController(
  createRuntime: (handler: RuntimeInteractionHandler) => DroidRuntime,
  workspace:
    | { cwd: string | null; trusted: boolean }
    | undefined = undefined,
  catalog: SessionCatalog = createCatalog([]),
  recovery?: SessionRecoveryStore,
  history?: SessionHistoryLoader,
  attachments?: AttachmentSources,
  fileDiff?: FileDiffOpener,
  changeStats?: ChangeStatsReader,
  externalUrl?: ExternalUrlOpener,
  daemonSessions?: () => Promise<DaemonSessionCatalog>,
  pathOpener?: PathOpener,
  prototypePreview?: PrototypePreviewOpener,
  gitWorkflow?: GitWorkflow,
  worktreeSessions?: WorktreeSessionsFeature,
  terminalMirror?: TerminalMirror,
  diagnostics?: RuntimeDiagnosticSink,
  daemonPlugins?: () => Promise<DaemonPluginCatalog>,
  btwSidecarFactory?: BtwSidecarFactory,
) {
  const controller = new ChatController(
    createRuntime,
    () =>
      workspace ?? {
        cwd: 'C:\\workspace',
        trusted: true,
      },
    catalog,
    recovery,
    history,
    attachments,
    fileDiff,
    changeStats,
    externalUrl,
    undefined,
    diagnostics,
    daemonSessions,
    pathOpener,
    prototypePreview,
    gitWorkflow,
    worktreeSessions,
    terminalMirror,
    daemonPlugins,
    btwSidecarFactory,
  );
  const messages: ControllerHostMessage[] = [];
  controller.subscribe((message) => {
    messages.push(message);
  });
  return { controller, messages };
}

export function ready(controller: ChatController): void {
  controller.handleMessage({
    type: 'webview.ready',
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
  });
}

export function send(
  controller: ChatController,
  sessionId: string,
  turnId: string,
  text: string,
): void {
  controller.handleMessage({
    type: 'turn.send',
    sessionId,
    turnId,
    text,
  });
}

export function stop(
  controller: ChatController,
  sessionId: string,
  turnId: string,
): void {
  controller.handleMessage({
    type: 'turn.stop',
    sessionId,
    turnId,
  });
}

export function queueAdd(
  controller: ChatController,
  sessionId: string,
  queueId: string,
  text: string,
): void {
  controller.handleMessage({
    type: 'queue.add',
    sessionId,
    queueId,
    text,
  });
}

export function queueStates(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'queue.state' }
    > => message.type === 'queue.state',
  );
}

export function retry(
  controller: ChatController,
  sessionId: string | null,
): void {
  controller.handleMessage({
    type: 'runtime.retry',
    sessionId,
  });
}

export function available(sessionId = 'session-1'): RuntimeAvailability {
  return {
    status: 'available',
    sdkVersion: '0.7.0',
    cliVersion: null,
    authenticationStatus: 'unknown',
    sessionId,
  };
}

export function catalogEntry(id: string): SessionCatalogEntry {
  return {
    id,
    title: `Session ${id}`,
    messageCount: 1,
    modifiedTime: '2026-01-02T03:04:05.000Z',
    createdTime: '2026-01-01T03:04:05.000Z',
    isFavorite: false,
  };
}

export function createCatalog(
  sessions: readonly SessionCatalogEntry[],
): SessionCatalog {
  return createCatalogResult({ status: 'available', sessions });
}

export function createCatalogResult(
  result: SessionCatalogResult,
): SessionCatalog {
  return {
    listSessions: vi.fn(async () => result),
  };
}

export function createBtwSidecarStub(
  deltas: readonly string[] = ['An answer.'],
): {
  sidecar: BtwSideChatSidecar;
  asks: string[];
  dispose: ReturnType<typeof vi.fn>;
} {
  const asks: string[] = [];
  const dispose = vi.fn(async () => {});
  const sidecar: BtwSideChatSidecar = {
    async *ask(text: string) {
      asks.push(text);
      for (const delta of deltas) {
        yield { kind: 'delta' as const, text: delta };
      }
      yield { kind: 'done' as const };
    },
    dispose,
  };
  return { sidecar, asks, dispose };
}

export function worktreeFeature(options: {
  readonly branch: string;
  readonly isGit?: boolean;
}): WorktreeSessionsFeature {
  return createWorktreeSessionsFeature({
    enabled: true,
    persistence: createMemoryPersistence(),
    exec: vi.fn(async (args: readonly string[]) =>
      args[1] === '--is-inside-work-tree'
        ? options.isGit === false
          ? 'false\n'
          : 'true\n'
        : `${options.branch}\n`,
    ) as GitExec,
  });
}

/**
 * Recovery store with a selected session and a cached prompt, as left
 * behind by a window that reloaded mid-turn.
 */
export async function seededRecoveryStore(
  sessionId: string,
): Promise<SessionRecoveryStore> {
  const persistence = createMemoryPersistence();
  const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
  seed.writeSession(
    sessionId,
    appendAcceptedUserPrompt(
      createHostTranscriptState('complete'),
      'saved-turn',
      'Recovered prompt',
    ),
  );
  seed.selectSession(sessionId);
  await seed.flush();
  return new SessionRecoveryStore(persistence, 'recovery', 0);
}

export function createMemoryPersistence(): SessionRecoveryPersistence {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
}

export function successfulTurn(): Extract<
  RuntimeEvent,
  { type: 'turn-complete' }
> {
  return {
    type: 'turn-complete',
    outcome: 'success',
  };
}

export function createMirrorSpy() {
  return {
    open: vi.fn(),
    commandStarted: vi.fn(),
    commandOutput: vi.fn(),
    commandSettled: vi.fn(),
    settleAll: vi.fn(),
    dispose: vi.fn(),
  } satisfies TerminalMirror;
}

/** Live values from artifacts/probe-token-usage.out.json. */
export function usageFixture(
  overrides: Partial<TokenUsageBreakdown> = {},
): TokenUsageBreakdown {
  return {
    inputTokens: 846,
    outputTokens: 5,
    cacheReadTokens: 11776,
    cacheCreationTokens: 0,
    thinkingTokens: 22,
    ...overrides,
  };
}

export function tokenUsageMessages(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'session.tokenUsage' }
    > => message.type === 'session.tokenUsage',
  );
}

export function connectionMessages(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'host.connection' | 'host.snapshot' }
    > =>
      message.type === 'host.connection' ||
      message.type === 'host.snapshot',
  );
}

export function snapshots(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'host.snapshot' }
    > => message.type === 'host.snapshot',
  );
}

export function runningStates(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'session.running' }
    > => message.type === 'session.running',
  );
}

export function lastMessage<
  Type extends HostToWebviewMessage['type'],
>(
  messages: readonly HostToWebviewMessage[],
  type: Type,
): Extract<HostToWebviewMessage, { type: Type }> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === type) {
      return message as Extract<
        HostToWebviewMessage,
        { type: Type }
      >;
    }
  }
  return undefined;
}

export function turnStates(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'turn.state' }
    > => message.type === 'turn.state',
  );
}

export function toolActivities(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'tool.activity' }
    > => message.type === 'tool.activity',
  );
}

export function interactionRequests(messages: readonly HostToWebviewMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<
      HostToWebviewMessage,
      { type: 'interaction.request' }
    > => message.type === 'interaction.request',
  );
}

export async function waitForInteraction(
  messages: readonly HostToWebviewMessage[],
  kind: Extract<
    HostToWebviewMessage,
    { type: 'interaction.request' }
  >['request']['kind'],
): Promise<
  Extract<HostToWebviewMessage, { type: 'interaction.request' }>
> {
  let request:
    | Extract<
        HostToWebviewMessage,
        { type: 'interaction.request' }
      >
    | undefined;
  await vi.waitFor(() => {
    request = interactionRequests(messages).find(
      (message) => message.request.kind === kind,
    );
    expect(request).toBeDefined();
  });
  return request!;
}

export function attachmentsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.attachments' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.attachments' }
    > => message.type === 'session.attachments',
  );
}

export function skillsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.skills' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.skills' }
    > => message.type === 'session.skills',
  );
}

export function pluginsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.plugins' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.plugins' }
    > => message.type === 'session.plugins',
  );
}

export function commandsMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.commands' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.commands' }
    > => message.type === 'session.commands',
  );
}

export function mcpMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'session.mcp' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'session.mcp' }
    > => message.type === 'session.mcp',
  );
}

export function mcpAuthMessages(
  messages: readonly HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'mcp.auth' }>[] {
  return messages.filter(
    (message): message is Extract<
      HostToWebviewMessage,
      { type: 'mcp.auth' }
    > => message.type === 'mcp.auth',
  );
}

export async function waitForConnected(
  messages: readonly HostToWebviewMessage[],
): Promise<void> {
  await vi.waitFor(() => {
    expect(connectionMessages(messages).at(-1)?.connection.status).toBe(
      'connected',
    );
  });
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
