import type { DaemonSessionCatalog } from '../../runtime/daemon/DaemonSessionCatalog';
import type { DroidRuntime } from '../../runtime/DroidRuntime';
import { type SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import type {
  RuntimeDiagnosticEvent,
  RuntimeDiagnosticSink,
} from '../../runtime/runtimeDiagnostics';
import type { SessionCatalog } from '../../runtime/catalog/SessionCatalog';
import { type WebviewToHostMessage } from '../../shared/bridgeMessages';
import { type AttachmentSources } from '../attachments/attachmentSources';
import { BtwSideChat } from '../btw/btwSideChat';
import { type ChangeStatsReader } from '../changes/changeStats';
import { type FileDiffOpener } from '../changes/fileDiffOpener';
import { type GitWorkflow } from '../workspace/gitWorkflow';
import { type PathOpener } from '../workspace/pathOpener';
import { PendingInteractionCoordinator } from '../interactions/pendingInteractionCoordinator';
import { type PlanDocumentGateway } from '../interactions/planDocumentGateway';
import { type PrototypePreviewOpener } from '../panels/preview/prototypePreview';
import type { ReviewCoordinator } from '../review/reviewCoordinator';
import { SessionRecoveryStore } from '../recovery/SessionRecoveryStore';
import type { TerminalMirror } from '../terminal/terminalMirror';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { type WorktreeSessionsFeature } from '../workspace/worktreeSessions';
import { type CustomModelsGateway } from './models/customModels';
import type {
  ChatControllerListener,
  DroidRuntimeFactory,
  UnsequencedHostMessage,
  WorkspaceContextProvider,
} from './hostTypes';
import { type DisposableSubscription } from './internals';
import type { MissionGateway } from './mission/MissionGateway';
import type { CustomModelDiscoveryGateway } from './models/modelDiscovery';
import { type UserPanelRequestDropReason } from './operationEligibility';
import { SessionMetadataState } from './capabilities/sessionMetadataState';
export interface HostOperations {
  readonly metadata: SessionMetadataState;
  readonly recoveryStore: SessionRecoveryStore;
  readonly getWorkspaceContext: WorkspaceContextProvider;
  recordHost(event: RuntimeDiagnosticEvent): void;
  readonly sessionHistory: SessionHistoryLoader;
  emitSessionDiagnostic(code: string, message: string, turnId?: string | null): void;
  readonly attachmentSources: AttachmentSources;
  emit(message: UnsequencedHostMessage): void;
  handleMessage(message: WebviewToHostMessage): void;
  emitTo(listener: ChatControllerListener, message: UnsequencedHostMessage): void;
  readonly reviewCoordinator?: ReviewCoordinator;
  readonly interactions: PendingInteractionCoordinator;
  readonly planDocuments: PlanDocumentGateway;
  sessionRequestDropReason(sessionId: string): UserPanelRequestDropReason | null;
  recordDroppedPanelRequest(op: string, reason: string): void;
  readonly modelDiscovery?: CustomModelDiscoveryGateway;
  isCurrentSessionOperation(
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): boolean;
  recordPanelFailure(code: string, detail: string): void;
  readonly daemonCustomModels?: () => Promise<CustomModelsGateway>;
  emitSnapshot(): void;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly btwSideChat: BtwSideChat | null;
  readonly turnSnapshots?: TurnSnapshotStore;
  readonly changeStats: ChangeStatsReader;
  readonly missionGateway?: MissionGateway;
  subscribe(listener: ChatControllerListener): DisposableSubscription;
  readonly createRuntime: DroidRuntimeFactory;
  readonly worktreeSessions?: WorktreeSessionsFeature;
  handleWorkspaceContextChanged(): void;
  readonly sessionCatalog: SessionCatalog;
  readonly daemonSessions?: () => Promise<DaemonSessionCatalog>;
  readonly terminalMirror?: TerminalMirror;
  readonly fileDiff: FileDiffOpener;
  readonly prototypePreview: PrototypePreviewOpener;
  readonly gitWorkflow: GitWorkflow;
  readonly pathOpener: PathOpener;
}
