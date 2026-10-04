import type { RuntimeGitDiff } from '../../runtime/DroidRuntime';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ReviewHostMessage } from '../../shared/protocol/reviewProtocol';
import type { ChangeStatsPersistence, CommittedFileStat } from '../changes/changeStats';
import type { FileDiffOpener } from '../changes/fileDiffOpener';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ReviewGitScope } from './reviewGitComparison';
import type { ReviewAgentRunner } from './reviewAgent';
import type { RecordedOperation } from './reviewOperationScope';
type Unsequenced<T> = T extends { readonly sequence: number } ? Omit<T, 'sequence'> : never;

type CanonicalTurnFiles = (
  sessionId: string,
  turnId: string,
) => readonly CommittedFileStat[] | undefined;
export interface ReviewCoordinatorOptions {
  readonly readOperationBody?: import('./reviewContent').ReviewContentSource['readOperationBody'];
  readonly readPriorFileOperations?: import('./reviewContent').ReviewContentSource['readPriorFileOperations'];
  readonly isTurnWriting?: (sessionId: string, turnId: string) => boolean;
  readonly isOperationWriting?: (sessionId: string, turnId: string) => boolean;
  readonly readTurnOperations?: (
    sessionId: string,
    turnId: string,
  ) => readonly RecordedOperation[];
  readonly readTurnOperationNotices?: (sessionId: string, turnId: string) => readonly string[];
  readonly isSessionCurrent?: (sessionId: string) => boolean;
  readonly openSelectionInEditor?: boolean;
  readonly readBranches?: () => Promise<{ refs: readonly string[]; defaultBranch?: string }>;
  readonly readGitScope?: (kind: 'workspace' | 'branch' | 'staged' | 'unstaged', baseBranch?: string) => Promise<ReviewGitScope>;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly snapshots: TurnSnapshotStore;
  readonly fileDiff: FileDiffOpener;
  readonly persistence: ChangeStatsPersistence;
  readonly storageDir: string;
  readonly publish: (message: Unsequenced<ReviewHostMessage>) => void;
  readonly readCanonicalTurnFiles: CanonicalTurnFiles;
  readonly resolveCanonicalTurnSessionId?: (
    sessionId: string,
    turnId: string,
  ) => string | undefined;
  readonly readWorkspaceFiles: () => Promise<
    { readonly baseline: string; readonly files: readonly CommittedFileStat[] } | undefined
  >;
  readonly readBranchDiff: () => Promise<
    | {
        readonly baseline: string;
        readonly diff: RuntimeGitDiff;
      }
    | undefined
  >;
  readonly runAgentReview?: ReviewAgentRunner;
  readonly diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>;
}
