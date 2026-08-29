import type * as vscode from 'vscode';

import type {
  MissionControlCatalogFilter,
  MissionControlCatalogRow,
  MissionControlPanelHostMessage,
} from '../shared/missionControlPanelProtocol';
import type {
  MissionControlSetupAvailability,
  MissionControlSetupReason,
  MissionControlSetupSnapshotMessage,
} from '../shared/missionControlSetupProtocol';
import type { MissionSetupCapabilities } from '../shared/missionProtocol';
import type {
  MissionCatalogResult,
  MissionReadinessResult,
} from './chat/mission/MissionGateway';
import type { ChatController } from './ChatController';

export type MissionControlRoute =
  | 'catalog'
  | 'new-mission'
  | 'detail';

export interface MissionControlCatalogSource {
  listCatalog(): Promise<MissionCatalogResult>;
  readSetup?(): MissionControlSetupAuthority;
  subscribeSetup?(listener: () => void): vscode.Disposable;
  readonly chatController?: ChatController;
  inspectReadiness?(cwd: string): Promise<MissionReadinessResult>;
  acknowledgeReadinessWarning?(cwd: string): Promise<boolean>;
  openCatalogMission?(catalogId: string): string | null;
  readActiveSession?(): {
    readonly sessionId: string | null;
    readonly missionRole: 'orchestrator' | 'worker' | null;
  };
  selectSession?(sessionId: string): boolean;
  createSession?(): void;
  readWorkspaceCwd?(): string | null;
  focusChat?(): void;
}

export interface MissionControlSetupAuthority {
  readonly workspaceAuthorityRevision: number;
  readonly chatOwnerRevision: number;
  readonly availability: MissionControlSetupAvailability;
  readonly reason: MissionControlSetupReason | null;
  readonly capabilities: MissionSetupCapabilities | null;
}

export interface MissionControlPanelControllerOptions {
  readonly deadlineMs?: number;
}

export interface MissionControlCatalogState {
  readonly filter: MissionControlCatalogFilter;
  readonly rows: readonly MissionControlCatalogRow[];
  readonly revision: number;
}

export interface MissionControlCatalogOperation {
  readonly owner: object;
  readonly panelInstance: number;
  readonly routeRevision: number;
  readonly requestId: string;
  readonly filter: MissionControlCatalogFilter;
  readonly revision: number;
}

export interface MissionControlPanelEntry {
  readonly instance: number;
  readonly panel: vscode.WebviewPanel;
  readonly disposables: vscode.Disposable[];
  readonly seenRequestIds: Set<string>;
  ready: boolean;
}

export type MissionWorkspaceHostMessage =
  | MissionControlSetupSnapshotMessage
  | Extract<
      MissionControlPanelHostMessage,
      { type: 'missionControl.route' }
    >;
