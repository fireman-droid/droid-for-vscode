import type { DaemonPluginCatalog } from '../../../runtime/daemon/DaemonPluginCatalog';
import type { ModelAvailability } from '../../models/DisabledModelsStore';
import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { RuntimeDiagnosticEvent } from '../../../runtime/runtimeDiagnostics';
import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import type { ExternalUrlOpener } from '../../workspace/externalUrlOpener';
import type { RecentCommandsStore } from './RecentCommandsStore';
import type { SessionMetadataState } from './sessionMetadataState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';

type WithoutSequence<T> = T extends unknown ? Omit<T, 'sequence'> : never;
type Emit<K extends HostToWebviewMessage['type']> = (
  message: WithoutSequence<Extract<HostToWebviewMessage, { type: K }>>,
) => void;

interface SessionPort {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'sessionId'
      | 'activeRuntimeCwd'
      | 'runtimeGeneration'
      | 'connection'
      | 'sessionOperationInProgress'
    >
  >;
  ensureWorkspaceCurrent(): boolean;
  isCurrentSessionOperation(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): boolean;
}

interface PanelPort extends SessionPort {
  sessionRequestDropReason(sessionId: string): string | null;
  recordDroppedPanelRequest(op: string, reason: string): void;
  recordPanelFailure(code: string, detail: string): void;
  recordHost(event: RuntimeDiagnosticEvent): void;
}

export interface SettingsHostPort extends SessionPort {
  readonly modelAvailability?: ModelAvailability;
  readonly metadata: Pick<SessionMetadataState, 'settings' | 'settingsUpdate'> &
    Readonly<Pick<SessionMetadataState, 'modelCatalog'>>;
  hasPendingInteractions(): boolean;
  metadataChanged(): void;
  emitSessionDiagnostic(code: string, message: string): void;
  emit: Emit<'session.settings'>;
}

export interface CapabilitiesHostPort extends PanelPort {
  readonly metadata: Pick<
    SessionMetadataState,
    | 'context'
    | 'contextGeneration'
    | 'tokenUsage'
    | 'modelCatalog'
    | 'commandsCache'
    | 'commandsRefreshGeneration'
  >;
  readonly recentCommands: Pick<RecentCommandsStore, 'read' | 'record'>;
  readonly daemonPlugins?: () => Promise<DaemonPluginCatalog>;
  metadataChanged(): void;
  emit: Emit<
    | 'session.context'
    | 'session.tokenUsage'
    | 'session.model-catalog'
    | 'session.skills'
    | 'session.plugins'
    | 'session.commands'
  >;
}

export interface McpHostPort extends PanelPort {
  readonly metadata: Pick<
    SessionMetadataState,
    'mcpAuthServerName' | 'mcpAuthTimer' | 'finishMcpAuth'
  >;
  readonly externalUrl: Pick<ExternalUrlOpener, 'openExternal'>;
  emit: Emit<'session.mcp' | 'mcp.auth'>;
}
