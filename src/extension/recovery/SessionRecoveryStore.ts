import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import { type ChangedFileSummary } from '../../shared/protocol/transcript';
import { type TurnStatus } from '../../shared/protocol/turns';
import { MAX_QUEUED_MESSAGES } from '../../shared/protocol/queueProtocol';
import { transcriptItemTextUnits } from '../../shared/transcript/transcriptLimits';
import {
  MAX_RECOVERY_TEXT_UNITS,
  parseConversationRecoveryState,
} from './conversationRecoveryParser';
import { conversationMetadata, recoveryTurnMetadata, withoutCachedHistory } from './conversationMetadata';
import type { ConversationImageArtifactStore } from './conversationImageArtifacts';
import { mergeToolOperations } from './operationEvidenceState';
import {
  CONVERSATION_RECOVERY_VERSION,
  MAX_RECOVERY_CONVERSATIONS,
  adoptConversationSuccessor,
  cloneConversation,
  cloneTranscriptState,
  createRootConversation,
  forkConversation,
  readLatestConversationChanges,
  recordSettledTurn,
  recordTurnToolEvidence,
  writeConversationDisplay,
  type ConversationDisplaySnapshot,
  type ConversationRecoveryRecord,
  type ConversationTurnRecord,
  type ConversationToolOperation,
} from './conversationRecoveryState';
import {
  createHostTranscriptState,
  type HostTranscriptState,
} from './hostTranscriptState';

export const SESSION_RECOVERY_VERSION = CONVERSATION_RECOVERY_VERSION;
export const SESSION_RECOVERY_STORAGE_KEY = 'droidvisx.sessionRecovery';
export const MAX_RECOVERY_SESSIONS = MAX_RECOVERY_CONVERSATIONS;
export { MAX_RECOVERY_TEXT_UNITS };
export const SESSION_RECOVERY_DEBOUNCE_MS = 250;

export interface SessionRecoveryPersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type SessionRecoveryCache = HostTranscriptState;

export class SessionRecoveryStore {
  private selectedConversationId: string | null = null;
  private readonly conversations = new Map<string, ConversationRecoveryRecord>();
  private readonly sessionOwners = new Map<string, string>();
  private accessSequence = 0;
  private revision = 0;
  private persistedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeInFlight: Promise<void> | null = null;
  private disposeOutcome: Promise<void> | null = null;
  private backgroundFailureReported = false;
  private onBackgroundFlushFailure: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly persistence: SessionRecoveryPersistence,
    private readonly storageKey = SESSION_RECOVERY_STORAGE_KEY,
    private readonly debounceMs = SESSION_RECOVERY_DEBOUNCE_MS,
    _imageArtifacts: ConversationImageArtifactStore | null = null,
  ) {}

  async load(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const parsed = parseConversationRecoveryState(
      withoutCachedHistory(this.persistence.get<unknown>(this.storageKey)),
    );
    this.conversations.clear();
    this.sessionOwners.clear();
    this.selectedConversationId = parsed?.selectedConversationId ?? null;
    this.accessSequence = 0;
    for (const conversation of parsed?.conversations ?? []) {
      const cloned = conversationMetadata(conversation);
      this.conversations.set(cloned.conversationId, cloned);
      this.indexConversation(cloned);
      this.accessSequence = Math.max(this.accessSequence, cloned.lastAccess);
    }
    // Rewrite old display caches as metadata on the next durable flush.
    this.revision = parsed === undefined ? 0 : 1;
    this.persistedRevision = 0;
  }

  getSelectedConversationId(): string | null {
    return this.selectedConversationId;
  }

  getSelectedSessionId(): string | null {
    if (this.selectedConversationId === null) {
      return null;
    }
    return this.conversations.get(this.selectedConversationId)?.activeSessionId ?? null;
  }

  resolveConversationId(sessionId: string): string | undefined {
    return this.sessionOwners.get(sessionId);
  }

  selectConversation(conversationId: string | null): void {
    if (
      this.disposed ||
      (conversationId !== null && !this.conversations.has(conversationId)) ||
      this.selectedConversationId === conversationId
    ) {
      return;
    }
    this.selectedConversationId = conversationId;
    if (conversationId !== null) {
      this.touch(conversationId);
    }
    this.enforceLimits();
    this.changed();
  }

  readConversation(conversationId: string): ConversationRecoveryRecord | undefined {
    if (this.disposed || !isRecoveryId(conversationId)) {
      return undefined;
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      return undefined;
    }
    return cloneConversation(conversation);
  }

  readDisplay(conversationId: string): ConversationDisplaySnapshot | undefined {
    const conversation = this.readConversation(conversationId);
    return conversation?.display;
  }

  writeActiveDisplay(
    conversationId: string,
    sessionId: string,
    cache: SessionRecoveryCache,
    turn: ConversationDisplaySnapshot['turn'],
  ): boolean {
    if (this.disposed || !isRecoveryId(conversationId) || !isRecoveryId(sessionId)) {
      return false;
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      return false;
    }
    const activeTurn = turn;
    turn = recoveryTurnMetadata(turn);
    const previousTurn = conversation.display.turn;
    const toolOperations =
      activeTurn === null
        ? []
        : cache.transcript.flatMap((item) =>
            item.kind === 'tool' &&
            item.turnId === activeTurn.turnId &&
            item.operationDiff !== undefined
              ? [{
                  toolUseId: item.toolUseId,
                  toolName: item.toolName,
                  operationDiff: item.operationDiff,
                  ...(item.executionPhase === undefined
                    ? {}
                    : { executionPhase: item.executionPhase }),
                }]
              : [],
          );
    const existingOperations =
      activeTurn === null
        ? []
        : conversation.turns.find(({ turnId }) => turnId === activeTurn.turnId)
            ?.toolOperations ?? [];
    if (
      conversation.activeSessionId === sessionId &&
      previousTurn?.turnId === turn?.turnId &&
      previousTurn?.status === turn?.status &&
      previousTurn?.error === turn?.error &&
      JSON.stringify(existingOperations) === JSON.stringify(mergeToolOperations(existingOperations, toolOperations))
    ) return true;
    let next = writeConversationDisplay(
      conversation,
      sessionId,
      createHostTranscriptState('complete'),
      this.nextAccess(),
      turn,
    );
    if (next === undefined) {
      return false;
    }
    if (activeTurn !== null && toolOperations.length > 0) {
      next = recordTurnToolEvidence(
        next,
        sessionId,
        activeTurn.turnId,
        activeTurn.status,
        toolOperations,
      );
    }
    this.storeConversation(next);
    this.enforceLimits();
    this.changed();
    return true;
  }

  createConversation(sessionId: string, _cache: SessionRecoveryCache): string | undefined {
    if (this.disposed || !isRecoveryId(sessionId) || this.sessionOwners.has(sessionId)) {
      return undefined;
    }
    const conversation = createRootConversation(sessionId, createHostTranscriptState('complete'), this.nextAccess());
    this.storeConversation(conversation);
    this.enforceLimits();
    this.changed();
    return conversation.conversationId;
  }

  forkConversation(
    sourceConversationId: string,
    sourceSessionId: string,
    successorSessionId: string,
    relation: 'fork' | 'rewind',
    cache: SessionRecoveryCache,
    anchorTurnId?: string,
  ): string | undefined {
    if (
      this.disposed ||
      this.sessionOwners.has(successorSessionId) ||
      !isRecoveryId(successorSessionId)
    ) {
      return undefined;
    }
    const source = this.conversations.get(sourceConversationId);
    if (
      source === undefined ||
      !source.nodes.some((node) => node.sessionId === sourceSessionId)
    ) {
      return undefined;
    }
    const forked = forkConversation(
      source,
      sourceSessionId,
      successorSessionId,
      relation,
      createHostTranscriptState('complete'),
      this.nextAccess(),
      anchorTurnId,
    );
    const visibleTurns = new Set(cache.transcript.flatMap((item) => item.kind === 'user' ? [] : [item.turnId]));
    this.storeConversation({
      ...forked,
      turns: source.turns.filter((turn) => visibleTurns.has(turn.turnId)),
    });
    this.enforceLimits();
    this.changed();
    return forked.conversationId;
  }

  adoptSuccessor(
    conversationId: string,
    sourceSessionId: string,
    successorSessionId: string,
    relation: 'compact' | 'handoff',
    anchorTurnId?: string,
  ): boolean {
    if (
      this.disposed ||
      !isRecoveryId(successorSessionId) ||
      this.sessionOwners.has(successorSessionId)
    ) {
      return false;
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined || conversation.activeSessionId !== sourceSessionId) {
      return false;
    }
    this.storeConversation(
      adoptConversationSuccessor(
        conversation,
        sourceSessionId,
        successorSessionId,
        relation,
        this.nextAccess(),
        anchorTurnId,
      ),
    );
    this.enforceLimits();
    this.changed();
    return true;
  }

  recordSettledTurn(
    conversationId: string,
    sessionId: string,
    turnId: string,
    _prompt: string | null,
    files: readonly ChangedFileSummary[],
    status: TurnStatus,
    messageId?: string,
    toolOperations: readonly ConversationToolOperation[] = [],
  ): boolean {
    if (this.disposed) {
      return false;
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      return false;
    }
    const next = recordSettledTurn(
      conversation,
      sessionId,
      turnId,
      null,
      files,
      status,
      this.nextAccess(),
      messageId,
      toolOperations,
    );
    if (next === undefined) {
      return false;
    }
    this.storeConversation(next);
    this.enforceLimits();
    this.changed();
    return true;
  }

  readTurn(conversationId: string, turnId: string): ConversationTurnRecord | undefined {
    return this.readConversation(conversationId)?.turns.find(
      (turn) => turn.turnId === turnId,
    );
  }

  readLatestChanges(conversationId: string): ConversationTurnRecord | undefined {
    const conversation = this.readConversation(conversationId);
    return conversation === undefined
      ? undefined
      : readLatestConversationChanges(conversation);
  }

  readLatestOperations(conversationId: string): ConversationTurnRecord | undefined {
    const conversation = this.readConversation(conversationId);
    if (conversation === undefined) return undefined;
    for (let index = conversation.turns.length - 1; index >= 0; index -= 1) {
      const turn = conversation.turns[index];
      if (turn !== undefined && (turn.toolOperations?.length ?? 0) > 0) {
        return turn;
      }
    }
    return undefined;
  }

  mergeTurnToolOperations(
    conversationId: string, sessionId: string, turnId: string,
    operations: readonly ConversationToolOperation[],
  ): boolean {
    if (this.disposed || operations.length === 0) return false;
    const conversation = this.conversations.get(conversationId);
    const turn = conversation?.turns.find((entry) => entry.turnId === turnId);
    if (!conversation || !turn || turn.sessionId !== sessionId) return false;
    const merged = mergeToolOperations(turn.toolOperations ?? [], operations);
    if (JSON.stringify(merged) === JSON.stringify(turn.toolOperations ?? [])) return true;
    this.storeConversation(recordTurnToolEvidence(conversation, sessionId, turnId, turn.status, merged));
    this.enforceLimits();
    this.changed();
    return true;
  }

  restoreConversation(conversation: ConversationRecoveryRecord): void {
    if (this.disposed) {
      return;
    }
    this.storeConversation(conversation);
    this.enforceLimits();
    this.changed();
  }

  discardConversation(conversationId: string): void {
    if (this.disposed || !this.conversations.has(conversationId)) {
      return;
    }
    this.deleteConversation(conversationId);
    this.changed();
  }

  readConversationQueuedTexts(conversationId: string): readonly string[] {
    const conversation = this.conversations.get(conversationId);
    return conversation === undefined ? [] : [...conversation.queuedTexts];
  }

  writeConversationQueuedTexts(conversationId: string, texts: readonly string[]): void {
    if (this.disposed) {
      return;
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      return;
    }
    const safe = sanitizeQueuedTexts(texts);
    if (
      safe.length === conversation.queuedTexts.length &&
      safe.every((text, index) => text === conversation.queuedTexts[index])
    ) {
      return;
    }
    this.storeConversation({
      ...conversation,
      lastAccess: this.nextAccess(),
      queuedTexts: safe,
    });
    this.changed();
  }

  flush(): Promise<void> {
    if (this.disposed) {
      return this.disposeOutcome ?? Promise.resolve();
    }
    return this.flushPending();
  }

  flushInBackground(): void {
    void this.flush().catch(() => {
      if (this.backgroundFailureReported) {
        return;
      }
      this.backgroundFailureReported = true;
      try {
        this.onBackgroundFlushFailure?.();
      } catch {
        // Diagnostic reporting must not create an unhandled rejection.
      }
    });
  }

  setBackgroundFlushFailureReporter(reporter: (() => void) | null): void {
    this.onBackgroundFlushFailure = reporter;
  }

  dispose(): Promise<void> {
    if (this.disposeOutcome !== null) {
      return this.disposeOutcome;
    }
    this.disposed = true;
    this.clearTimer();
    this.disposeOutcome = this.flushPending();
    return this.disposeOutcome;
  }

  private async flushPending(): Promise<void> {
    this.clearTimer();
    while (this.persistedRevision < this.revision) {
      if (this.writeInFlight !== null) {
        await this.writeInFlight;
        continue;
      }
      const revision = this.revision;
      const snapshot = this.serialize();
      const write = Promise.resolve()
        .then(() => this.persistence.update(this.storageKey, snapshot))
        .then(() => {
          this.persistedRevision = Math.max(this.persistedRevision, revision);
          this.backgroundFailureReported = false;
        })
        .finally(() => {
          if (this.writeInFlight === write) {
            this.writeInFlight = null;
          }
        });
      this.writeInFlight = write;
      await write;
    }
  }

  private findBySession(sessionId: string): ConversationRecoveryRecord | undefined {
    if (!isRecoveryId(sessionId)) {
      return undefined;
    }
    const owner = this.sessionOwners.get(sessionId);
    return owner === undefined ? undefined : this.conversations.get(owner);
  }

  private storeConversation(conversation: ConversationRecoveryRecord): void {
    const previous = this.conversations.get(conversation.conversationId);
    if (previous !== undefined) {
      for (const node of previous.nodes) {
        if (this.sessionOwners.get(node.sessionId) === previous.conversationId) {
          this.sessionOwners.delete(node.sessionId);
        }
      }
    }
    const cloned = conversationMetadata(conversation);
    this.conversations.set(cloned.conversationId, cloned);
    this.indexConversation(cloned);
  }

  private indexConversation(conversation: ConversationRecoveryRecord): void {
    for (const node of conversation.nodes) {
      this.sessionOwners.set(node.sessionId, conversation.conversationId);
    }
  }

  private touch(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation !== undefined) {
      this.conversations.set(conversationId, {
        ...conversation,
        lastAccess: this.nextAccess(),
      });
    }
  }

  private nextAccess(): number {
    if (this.accessSequence >= Number.MAX_SAFE_INTEGER) {
      const ordered = this.sortedConversations();
      ordered.forEach((conversation, index) => {
        this.conversations.set(conversation.conversationId, {
          ...conversation,
          lastAccess: index + 1,
        });
      });
      this.accessSequence = ordered.length;
    }
    this.accessSequence += 1;
    return this.accessSequence;
  }

  private enforceLimits(): void {
    while (this.conversations.size > MAX_RECOVERY_CONVERSATIONS) {
      this.evictLeastRecentlyUsed();
    }
    while (this.totalTextUnits() > MAX_RECOVERY_TEXT_UNITS) {
      const leastRecent = this.sortedConversations()[0];
      if (leastRecent === undefined) {
        break;
      }
      const transcript = leastRecent.display.transcript.transcript;
      if (transcript.length === 0) {
        this.deleteConversation(leastRecent.conversationId);
        continue;
      }
      const next = writeConversationDisplay(
        leastRecent,
        leastRecent.activeSessionId,
        {
          transcript: transcript.slice(1),
          historyStatus: 'partial',
          truncated: true,
        },
        leastRecent.lastAccess,
      );
      if (next === undefined) {
        this.deleteConversation(leastRecent.conversationId);
      } else {
        this.storeConversation(next);
      }
    }
  }

  private totalTextUnits(): number {
    let total = this.selectedConversationId?.length ?? 0;
    for (const conversation of this.conversations.values()) {
      total += conversationTextUnits(conversation);
    }
    return total;
  }

  private evictLeastRecentlyUsed(): void {
    const leastRecent = this.sortedConversations()[0];
    if (leastRecent !== undefined) {
      this.deleteConversation(leastRecent.conversationId);
    }
  }

  private deleteConversation(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      return;
    }
    this.conversations.delete(conversationId);
    for (const node of conversation.nodes) {
      if (this.sessionOwners.get(node.sessionId) === conversationId) {
        this.sessionOwners.delete(node.sessionId);
      }
    }
    if (this.selectedConversationId === conversationId) {
      this.selectedConversationId = null;
    }
  }

  private sortedConversations(): ConversationRecoveryRecord[] {
    return [...this.conversations.values()].sort(
      (left, right) =>
        left.lastAccess - right.lastAccess ||
        left.conversationId.localeCompare(right.conversationId),
    );
  }

  private changed(): void {
    this.revision += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushInBackground();
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private serialize(): unknown {
    return {
      version: SESSION_RECOVERY_VERSION,
      selectedConversationId: this.selectedConversationId,
      conversations: this.sortedConversations().map(conversationMetadata),
    };
  }
}

function sanitizeQueuedTexts(texts: readonly unknown[]): readonly string[] {
  const safe: string[] = [];
  for (const text of texts) {
    if (safe.length >= MAX_QUEUED_MESSAGES) {
      break;
    }
    if (
      typeof text !== 'string' ||
      text.length === 0 ||
      text.length > MAX_TURN_TEXT_LENGTH
    ) {
      continue;
    }
    safe.push(text);
  }
  return safe;
}

function conversationTextUnits(conversation: ConversationRecoveryRecord): number {
  let total =
    conversation.conversationId.length +
    conversation.activeSessionId.length +
    conversation.display.transcript.historyStatus.length;
  for (const item of conversation.display.transcript.transcript) {
    total += transcriptItemTextUnits(item);
  }
  for (const node of conversation.nodes) {
    total +=
      node.sessionId.length +
      (node.parentConversationId?.length ?? 0) +
      (node.parentSessionId?.length ?? 0) +
      (node.anchorTurnId?.length ?? 0);
  }
  for (const turn of conversation.turns) {
    total +=
      turn.turnId.length +
      turn.sessionId.length +
      (turn.prompt?.length ?? 0) +
      (turn.messageId?.length ?? 0);
    for (const file of turn.files) {
      total += file.path.length;
    }
    for (const operation of turn.toolOperations ?? []) {
      total += operation.toolUseId.length + operation.toolName.length;
      if (operation.operationDiff.status === 'ready') {
        total +=
          (operation.operationDiff.callId?.length ?? 0) +
          (operation.operationDiff.sourceSessionId?.length ?? 0);
        for (const file of operation.operationDiff.files) {
          total +=
            file.path.length +
            (file.previousPath?.length ?? 0) +
            file.patch.length +
            (file.message?.length ?? 0);
        }
      }
    }
  }
  return total + conversation.queuedTexts.reduce((sum, text) => sum + text.length, 0);
}

function isRecoveryId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}
