import type {
  ConnectedDroid,
  ConnectedDroidSession,
  ConnectToDaemonOptions,
  CreateDaemonSessionOptions,
  DaemonSessionController,
  FactoryDroidEvents,
  ResumeDaemonSessionOptions,
} from '@factory/droid-sdk';
import type { RuntimeTurnOutcome } from '../turnOutcome';

export type DaemonNotification = Parameters<FactoryDroidEvents['sessionNotification']>[0];
export type DaemonTerminalEvent =
  | ({ readonly type: 'data'; readonly sessionId: string } & Pick<
      Extract<DaemonNotification['notification'], { type: 'daemon.terminal_data' }>, 'terminalId' | 'data'>)
  | ({ readonly type: 'exit' } & Parameters<FactoryDroidEvents['terminalExit']>[0])
  | { readonly type: 'disconnected' };
export type DaemonHandlers = Pick<
  ConnectToDaemonOptions,
  'permissionHandler' | 'askUserHandler'
>;
/** Mission profiles are supplied at initialization and confirmed before planning. */
export type DaemonCreateSessionOptions = CreateDaemonSessionOptions & Pick<
  Parameters<DaemonSessionController['initializeSession']>[0], 'missionSettings'
>;
export type DaemonStreamOptions = Omit<
  NonNullable<Parameters<ConnectedDroidSession['stream']>[1]>,
  'includePartialMessages'
> & {
  includePartialMessages?: boolean;
  backendTurnId?: string;
};

export interface DaemonSessionHandle extends ConnectedDroidSession {
  close(options?: Parameters<DaemonSessionController['closeSession']>[1]): Promise<void>;
  ensureLoaded(signal?: AbortSignal): Promise<void>;
  onNotification(listener: (notification: Record<string, unknown>) => void): () => void;
  readMissionSnapshot(): unknown;
  subscribeMissionSnapshot(listener: (snapshot: unknown) => void): () => void;
  readTurnOutcome?(backendTurnId: string): Promise<RuntimeTurnOutcome | null>;
}

/** Only the resources used by this extension, on one Runtime-owned connection. */
export interface DaemonApi {
  waitUntilReady?(signal?: AbortSignal): Promise<void>;
  readonly sessions: Pick<
    ConnectedDroid['sessions'],
    | 'list'
    | 'listOpened'
    | 'getMessages'
    | 'search'
    | 'archive'
    | 'unarchive'
    | 'updateSettings'
    | 'getContextBreakdown'
    | 'getRewindInfo'
    | 'fork'
    | 'killWorker'
  > & {
    listPage(
      options?: Parameters<ConnectedDroid['sessions']['list']>[0],
    ): ReturnType<DaemonSessionController['listAvailableSessions']>;
    create(options: DaemonCreateSessionOptions): Promise<DaemonSessionHandle>;
    resume(
      id: string,
      options?: ResumeDaemonSessionOptions,
    ): Promise<DaemonSessionHandle>;
    /** Attach a worker on the same daemon; retain its parent and source metadata. */
    attachChild?(id: string, handlers: DaemonHandlers): Promise<DaemonSessionHandle>;
    /** A committed rewind must be adopted before waiting for IDE readiness. */
    resumeReplacement?(
      id: string,
      options?: ResumeDaemonSessionOptions,
    ): Promise<DaemonSessionHandle>;
  };
  readonly settings: ConnectedDroid['settings'];
  readonly models: ConnectedDroid['models'];
  readonly worktrees: {
    list: DaemonSessionController['listManagedWorktrees'];
    inspectDeletion: DaemonSessionController['inspectWorktreeDeletion'];
    cleanup: DaemonSessionController['cleanupWorktree'];
  };
  readonly terminals: ConnectedDroid['terminals'];
  readonly updates: ConnectedDroid['updates'];
  readonly automations: ConnectedDroid['automations'];
  readonly workspace: ConnectedDroid['workspace'];
  readonly ssh: ConnectedDroid['ssh'];
  readonly relay: ConnectedDroid['relay'];
  readonly feedback: ConnectedDroid['feedback'];
  readonly customModels: ConnectedDroid['customModels'];
  readonly commands: ConnectedDroid['commands'];
  readonly skills: ConnectedDroid['skills'];
  readonly mcp: Pick<
    ConnectedDroid['mcp'],
    | 'listServers'
    | 'listTools'
    | 'toggleServer'
    | 'addServer'
    | 'removeServer'
    | 'authenticateServer'
    | 'cancelAuth'
    | 'clearAuth'
    | 'submitAuthCode'
    | 'submitAuthError'
    | 'listRegistry'
    | 'toggleTool'
    | 'getConfig'
    | 'updateConfig'
  >;
  readonly plugins: ConnectedDroid['plugins'];
  readonly marketplaces: ConnectedDroid['marketplaces'];
  readonly git: ConnectedDroid['git'];
  readonly unstable: Pick<ConnectedDroid['unstable'], 'missions'>;
  readonly notifications: {
    subscribeRecovery?(listener: () => void): () => void;
    subscribe(listener: (notification: DaemonNotification) => void): () => void;
    subscribeTerminal(listener: (event: DaemonTerminalEvent) => void): () => void;
    attachChild(sessionId: string): Promise<void>;
  };
  disconnect(): void;
}
