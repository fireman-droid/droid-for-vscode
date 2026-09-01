import {
  MAX_TURN_TEXT_LENGTH,
  type ChangedFileSummary,
  type TurnStatus,
} from '../shared/bridgeMessages';
import { MAX_QUEUED_MESSAGES } from '../shared/queueProtocol';
import { transcriptItemTextUnits } from '../shared/transcriptLimits';
import {
  MAX_RECOVERY_TEXT_UNITS,
  parseConversationRecoveryState,
  parseRecoveryTranscript,
} from './conversationRecoveryParser';
import type { ConversationImageArtifactStore } from './conversationImageArtifacts';
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
  writeConversationDisplay,
  type ConversationDisplaySnapshot,
  type ConversationRecoveryRecord,
  type ConversationTurnRecord,
} from './conversationRecoveryState';
import {
  createHostTranscriptState,
  type HostTranscriptState,
} from './hostTranscriptState';

export const SESSION_RECOVERY_VERSION =
  CONVERSATION_RECOVERY_VERSION;
export const SESSION_RECOVERY_STORAGE_KEY =
  'droidvisx.sessionRecovery';
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
  private readonly conversations = new Map<
    string,
    ConversationRecoveryRecord
  >();
  private readonly sessionOwners = new Map<string, string>();
  private accessSequence = 0;
  private revision = 0;
  private persistedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeInFlight: Promise<void> | null = null;
  private disposeOutcome: Promise<void> | null = null;
  private backgroundFailureReported = false;
  private onBackgroundFlushFailure: (() => void) | null = null;
  private readonly pendingArtifactDeletes = new Set<string>();
  private disposed = false;

  constructor(
    private readonly persistence: SessionRecoveryPersistence,
    private readonly storageKey = SESSION_RECOVERY_STORAGE_KEY,
    private readonly debounceMs = SESSION_RECOVERY_DEBOUNCE_MS,
    private readonly imageArtifacts: ConversationImageArtifactStore | null =
      null,
  ) {}

  async load(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const parsed = parseConversationRecoveryState(
      this.persistence.get<unknown>(this.storageKey),
    );
    this.conversations.clear();
    this.sessionOwners.clear();
    this.selectedConversationId =
      parsed?.selectedConversationId ?? null;
    this.accessSequence = 0;
    const hydrated =
      this.imageArtifacts === null
        ? { conversations: parsed?.conversations ?? [], missing: 0 }
        : await this.imageArtifacts.hydrate(
            parsed?.conversations ?? [],
          );
    for (const conversation of hydrated.conversations) {
      const cloned = cloneConversation(conversation);
      this.conversations.set(cloned.conversationId, cloned);
      this.indexConversation(cloned);
      this.accessSequence = Math.max(
        this.accessSequence,
        cloned.lastAccess,
      );
    }
    await this.imageArtifacts?.prune([
      ...this.conversations.values(),
    ]);
    this.revision = 0;
    this.persistedRevision = 0;
  }

  getSelectedConversationId(): string | null {
    return this.selectedConversationId;
  }

  getSelectedSessionId(): string | null {
    if (this.selectedConversationId === null) {
      return null;
    }
    return (
      this.conversations.get(this.selectedConversationId)
        ?.activeSessionId ?? null
    );
  }

  resolveConversationId(sessionId: string): string | undefined {
    return this.sessionOwners.get(sessionId);
  }

  selectConversation(conversationId: string | null): void {
    if (
      this.disposed ||
      (conversationId !== null &&
        !this.conversations.has(conversationId)) ||
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

  readConversation(
    conversationId: string,
  ): ConversationRecoveryRecord | undefined {
    if (this.disposed || !isRecoveryId(conversationId)) {
      return undefined;
    }
    const conversation = this.conversations.get(conversationId);
    if (conversation === undefined) {
      return undefined;
    }
    this.touch(conversationId);
    this.changed();
    return cloneConversation(conversation);
  }

  readDisplay(
    conversationId: string,
  ): ConversationDisplaySnapshot | undefined {
    const conversation = this.readConversation(conversationId);
    return conversation?.display;
  }

  writeActiveDisplay(
    conversationId: string,
    sessionId: string,
    cache: SessionRecoveryCache,
    turn: ConversationDisplaySnapshot['turn'],
  ): boolean {
    if (
      this.disposed ||
      !isRecoveryId(conversationId) ||
      !isRecoveryId(sessionId)
    ) {
      return false;
    }
    const safeCache = parseRecoveryTranscript(cache);
    const conversation = this.conversations.get(conversationId);
    if (safeCache === undefined || conversation === undefined) {
      return false;
    }
    const next = writeConversationDisplay(
      conversation,
      sessionId,
      safeCache,
      this.nextAccess(),
      turn,
    );
    if (next === undefined) {
      return false;
    }
    this.storeConversation(next);
    this.enforceLimits();
    this.changed();
    return true;
  }

  createConversation(
    sessionId: string,
    cache: SessionRecoveryCache,
  ): string | undefined {
    if (
      this.disposed ||
      !isRecoveryId(sessionId) ||
      this.sessionOwners.has(sessionId)
    ) {
      return undefined;
    }
    const safeCache = parseRecoveryTranscript(cache);
    if (safeCache === undefined) {
      return undefined;
    }
    const conversation = createRootConversation(
      sessionId,
      safeCache,
      this.nextAccess(),
    );
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
    const safeCache = parseRecoveryTranscript(cache);
    if (
      source === undefined ||
      safeCache === undefined ||
      !source.nodes.some((node) => node.sessionId === sourceSessionId)
    ) {
      return undefined;
    }
    const forked = forkConversation(
      source,
      sourceSessionId,
      successorSessionId,
      relation,
      safeCache,
      this.nextAccess(),
      anchorTurnId,
    );
    this.storeConversation(forked);
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
    if (
      conversation === undefined ||
      conversation.activeSessionId !== sourceSessionId
    ) {
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
    prompt: string | null,
    files: readonly ChangedFileSummary[],
    status: TurnStatus,
    messageId?: string,
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
      prompt,
      files,
      status,
      this.nextAccess(),
      messageId,
    );
    if (next === undefined) {
      return false;
    }
    this.storeConversation(next);
    this.enforceLimits();
    this.changed();
    return true;
  }

  readTurn(
    conversationId: string,
    turnId: string,
  ): ConversationTurnRecord | undefined {
    return this.readConversation(conversationId)?.turns.find(
      (turn) => turn.turnId === turnId,
    );
  }

  readLatestChanges(
    conversationId: string,
  ): ConversationTurnRecord | undefined {
    const conversation = this.readConversation(conversationId);
    return conversation === undefined
      ? undefined
      : readLatestConversationChanges(conversation);
  }

  restoreConversation(
    conversation: ConversationRecoveryRecord,
  ): void {
    if (this.disposed) {
      return;
    }
    this.storeConversation(conversation);
    this.enforceLimits();
    this.changed();
  }

  discardConversation(conversationId: string): void {
    if (
      this.disposed ||
      !this.conversations.has(conversationId)
    ) {
      return;
    }
    this.deleteConversation(conversationId);
    this.changed();
  }

  readConversationQueuedTexts(conversationId: string): readonly string[] {
    const conversation = this.conversations.get(conversationId);
    return conversation === undefined
      ? []
      : [...conversation.queuedTexts];
  }

  writeConversationQueuedTexts(
    conversationId: string,
    texts: readonly string[],
  ): void {
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
      safe.every(
        (text, index) => text === conversation.queuedTexts[index],
      )
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

  setBackgroundFlushFailureReporter(
    reporter: (() => void) | null,
  ): void {
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
    while (this.persistedRevision < this.revision) {
      if (this.writeInFlight !== null) {
        await this.writeInFlight;
        continue;
      }
      const revision = this.revision;
      const conversations = this.sortedConversations();
      if (this.imageArtifacts !== null) {
        await this.imageArtifacts.persist(conversations);
      }
      const snapshot = this.serialize();
      const artifactDeletes = [...this.pendingArtifactDeletes];
      const write = Promise.resolve()
        .then(() =>
          this.persistence.update(this.storageKey, snapshot),
        )
        .then(() => {
          this.persistedRevision = Math.max(
            this.persistedRevision,
            revision,
          );
          this.backgroundFailureReported = false;
          return this.imageArtifacts?.remove(artifactDeletes);
        })
        .then(() => {
          artifactDeletes.forEach((artifactId) =>
            this.pendingArtifactDeletes.delete(artifactId),
          );
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

  private findBySession(
    sessionId: string,
  ): ConversationRecoveryRecord | undefined {
    if (!isRecoveryId(sessionId)) {
      return undefined;
    }
    const owner = this.sessionOwners.get(sessionId);
    return owner === undefined
      ? undefined
      : this.conversations.get(owner);
  }

  private storeConversation(
    conversation: ConversationRecoveryRecord,
  ): void {
    const previous = this.conversations.get(
      conversation.conversationId,
    );
    if (previous !== undefined) {
      const nextArtifactIds = new Set(
        conversation.display.images.map(
          (artifact) => artifact.artifactId,
        ),
      );
      previous.display.images.forEach((artifact) => {
        if (!nextArtifactIds.has(artifact.artifactId)) {
          this.pendingArtifactDeletes.add(artifact.artifactId);
        }
      });
      for (const node of previous.nodes) {
        if (
          this.sessionOwners.get(node.sessionId) ===
          previous.conversationId
        ) {
          this.sessionOwners.delete(node.sessionId);
        }
      }
    }
    const cloned = cloneConversation(conversation);
    this.conversations.set(cloned.conversationId, cloned);
    this.indexConversation(cloned);
  }

  private indexConversation(
    conversation: ConversationRecoveryRecord,
  ): void {
    for (const node of conversation.nodes) {
      this.sessionOwners.set(
        node.sessionId,
        conversation.conversationId,
      );
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
    while (
      this.conversations.size > MAX_RECOVERY_CONVERSATIONS
    ) {
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
    conversation.display.images.forEach((artifact) =>
      this.pendingArtifactDeletes.add(artifact.artifactId),
    );
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
      conversations: this.sortedConversations().map((conversation) => ({
        ...cloneConversation(conversation),
        display: {
          ...conversation.display,
          transcript: {
            ...conversation.display.transcript,
            transcript:
              conversation.display.transcript.transcript.flatMap(
                (item) =>
                  item.kind === 'changes' && item.writing === true
                    ? []
                    : item.kind === 'image' && item.data.length > 0
                      ? [{ ...item, data: '' }]
                      : [{ ...item }],
              ),
          },
        },
      })),
    };
  }
}

function sanitizeQueuedTexts(
  texts: readonly unknown[],
): readonly string[] {
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

function conversationTextUnits(
  conversation: ConversationRecoveryRecord,
): number {
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
  }
  return (
    total +
    conversation.queuedTexts.reduce(
      (sum, text) => sum + text.length,
      0,
    )
  );
}

function isRecoveryId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}
