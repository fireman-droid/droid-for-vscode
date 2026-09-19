import * as vscode from 'vscode';

import type { OperationDiff, ToolExecutionPhase } from '../../../shared/protocol/operationDiff';
import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { stableTranscriptId } from '../../recovery/hostTranscriptState';
import type { ChatController } from '../ChatController';
import type { ReviewCoordinator } from '../../review/reviewCoordinator';
import type {
  ParentSubagentEvidence,
  SubagentEvidenceNotice,
} from './SubagentTranscriptService';

export interface ReviewChildOperation {
  readonly sequence: number;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly operationDiff: OperationDiff;
  readonly executionPhase?: ToolExecutionPhase;
}

/**
 * Lazily resolves authoritative parent-Task → child-session bindings through
 * the invocation ledger, then exposes child transcript operation evidence to
 * Review. It never starts a runtime or synthesizes attribution from files.
 */
export class SubagentReviewEvidence implements vscode.Disposable {
  private mapping:
    | {
        readonly key: string;
        readonly promise: Promise<void>;
        pending: boolean;
      }
    | null = null;
  private parentSessionId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly reported = new Set<string>();
  private readonly scopeNotices = new Map<string, readonly string[]>();
  private controllerSubscription: vscode.Disposable | null = null;
  private disposed = false;

  constructor(
    private readonly getController: () => ChatController,
    private readonly getReview: () => ReviewCoordinator | null,
  ) {}

  start(): void {
    this.controllerSubscription = this.getController().subscribe((message) => {
      if (message.type === 'tool.activity' && message.subagent !== undefined ||
        message.type === 'subagent.update') this.read(message.sessionId, message.turnId);
    });
  }

  notices(sessionId: string, turnId: string): readonly string[] {
    return this.mapping?.pending ? ['Child operation evidence is still loading.'] :
      this.scopeNotices.get(`${sessionId}\u0000${turnId}`) ?? [];
  }

  isRunning(sessionId: string, turnId: string): boolean {
    return this.getController().subagentState.subagentTranscripts?.isParentRunning(sessionId, turnId) ?? false;
  }

  read(sessionId: string, turnId: string): readonly ReviewChildOperation[] {
    if (this.disposed) return [];
    const controller = this.getController();
    const service = controller.subagentState.subagentTranscripts;
    const cwd = controller.sessionState.activeRuntimeCwd;
    if (
      controller.sessionState.sessionId !== sessionId ||
      service === null ||
      cwd === null
    ) {
      return [];
    }
    this.subscribe(sessionId);
    const transcript = controller.recoveryState.transcript.transcript;
    const key = `${sessionId}\u0000${cwd}\u0000${transcriptMarker(transcript)}`;
    if (this.mapping?.key !== key) {
      const promise = service
        .ensureParentMapping(sessionId, cwd, transcript)
        .then((evidence) => {
          if (
            this.disposed ||
            this.mapping?.promise !== promise ||
            this.getController().sessionState.sessionId !== sessionId
          ) {
            return;
          }
          this.mapping.pending = false;
          this.reportNotices(sessionId, evidence);
          for (const notice of evidence.notices) {
            this.getReview()?.refreshOperationsTurn(sessionId, notice.turnId);
          }
          this.getReview()?.refreshOperationsTurn(sessionId, turnId);
        })
        .catch(() => {
          if (this.disposed || this.mapping?.promise !== promise ||
            this.getController().sessionState.sessionId !== sessionId) return;
          this.mapping.pending = false;
          this.scopeNotices.set(`${sessionId}\u0000${turnId}`, ['Child operation evidence could not be loaded.']);
          this.reportNotice(sessionId, {
            turnId,
            toolUseId: 'subagent-history',
            reason: 'history-unavailable',
            message: 'Child operation evidence could not be loaded.',
          });
        });
      this.mapping = { key, promise, pending: true };
    }
    const evidence = service.readParentOperationEvidence(sessionId, turnId);
    this.scopeNotices.set(`${sessionId}\u0000${turnId}`, evidence.notices.map((notice) => notice.message));
    this.reportNotices(sessionId, evidence);
    const conversationId = controller.sessionState.conversationId;
    if (conversationId !== null && evidence.operations.length > 0) {
      controller.recoveryStore.mergeTurnToolOperations(conversationId, sessionId, turnId, evidence.operations.map((operation) => ({
        toolUseId: stableTranscriptId('tool', 'child-evidence', operation.childSessionId, operation.toolUseId),
        toolName: operation.toolName, operationDiff: operation.operationDiff,
        ...(operation.executionPhase === undefined ? {} : { executionPhase: operation.executionPhase }),
      })));
    }
    return evidence.operations.map((operation) => ({
      sequence: operation.sequence,
      sessionId: operation.childSessionId,
      toolUseId: operation.toolUseId,
      toolName: operation.toolName,
      operationDiff: operation.operationDiff,
      ...(operation.executionPhase === undefined
        ? {}
        : { executionPhase: operation.executionPhase }),
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.parentSessionId = null;
    this.mapping = null;
    this.reported.clear();
    this.scopeNotices.clear();
    this.controllerSubscription?.dispose();
  }

  private subscribe(sessionId: string): void {
    if (this.parentSessionId === sessionId && this.unsubscribe !== null) return;
    this.unsubscribe?.();
    this.scopeNotices.clear();
    this.reported.clear();
    this.mapping = null;
    this.parentSessionId = sessionId;
    const service = this.getController().subagentState.subagentTranscripts;
    this.unsubscribe =
      service?.subscribeParent(sessionId, (turnId) => {
        if (!this.disposed && this.getController().sessionState.sessionId === sessionId) {
          this.read(sessionId, turnId);
          this.getReview()?.refreshOperationsTurn(sessionId, turnId);
        }
      }) ?? null;
  }

  private reportNotices(
    sessionId: string,
    evidence: ParentSubagentEvidence,
  ): void {
    for (const notice of evidence.notices) {
      this.reportNotice(sessionId, notice);
    }
  }

  private reportNotice(
    sessionId: string,
    notice: SubagentEvidenceNotice,
  ): void {
    const key =
      `${sessionId}\u0000${notice.turnId}\u0000${notice.toolUseId}\u0000${notice.reason}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const controller = this.getController();
    if (controller.sessionState.sessionId !== sessionId) return;
    controller.emit({
      type: 'runtime.diagnostic',
      sessionId,
      turnId: notice.turnId,
      severity: 'warning',
      code: `subagent-operation-evidence-${notice.reason}`,
      message: notice.message,
    });
  }
}

function transcriptMarker(
  transcript: readonly SessionTranscriptItem[],
): string {
  const taskRows = transcript.filter(
    (item) => item.kind === 'tool' && item.subagent !== undefined,
  );
  return `${taskRows.length}:${taskRows.at(-1)?.id ?? ''}`;
}
