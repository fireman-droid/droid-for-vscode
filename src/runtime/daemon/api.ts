import type {
  ConnectedDroid,
  ConnectedDroidSession,
  ConnectToDaemonOptions,
  CreateDaemonSessionOptions,
  FactoryDroidEvents,
  ResumeDaemonSessionOptions,
} from '@factory/droid-sdk';

export type DaemonNotification = Parameters<FactoryDroidEvents['sessionNotification']>[0];
export type DaemonTerminalEvent =
  | ({ readonly type: 'data' } & Parameters<FactoryDroidEvents['terminalData']>[0])
  | ({ readonly type: 'exit' } & Parameters<FactoryDroidEvents['terminalExit']>[0])
  | { readonly type: 'disconnected' };
export type DaemonHandlers = Pick<
  ConnectToDaemonOptions,
  'permissionHandler' | 'askUserHandler'
>;
export type DaemonStreamOptions = Omit<
  NonNullable<Parameters<ConnectedDroidSession['stream']>[1]>,
  'includePartialMessages'
> & {
  includePartialMessages?: boolean;
};

export interface DaemonSessionHandle extends ConnectedDroidSession {
  onNotification(listener: (notification: Record<string, unknown>) => void): () => void;
}

/** Only the resources used by this extension, on one Runtime-owned connection. */
export interface DaemonApi {
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
    create(options: CreateDaemonSessionOptions): Promise<DaemonSessionHandle>;
    resume(
      id: string,
      options?: ResumeDaemonSessionOptions,
    ): Promise<DaemonSessionHandle>;
  };
  readonly settings: ConnectedDroid['settings'];
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
    subscribe(listener: (notification: DaemonNotification) => void): () => void;
    subscribeTerminal(listener: (event: DaemonTerminalEvent) => void): () => void;
    attachChild(sessionId: string): Promise<void>;
  };
  disconnect(): void;
}
