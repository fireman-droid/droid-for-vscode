import type {
  SubagentEvent,
  SubagentEventSource,
} from '../../../runtime/daemon/daemonNotificationSource';

import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { type ToolActivityMessage } from '../../../shared/bridgeMessages';
import type { HostTranscriptState } from '../../../shared/transcript/hostTranscriptState';
import type { SubagentActivityItem } from '../../../shared/protocol/subagentProtocol';
import type { SessionHistoryLoader } from '../../../runtime/history/SessionHistory';

import { sessionMessageTurnId } from '../../../shared/transcript/sessionMessageIdentity';
import { reconcileChildHistory, restoreChildTools } from './childHistoryReconciliation';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type {
  OperationDiff,
  ToolExecutionPhase,
} from '../../../shared/protocol/operationDiff';
import {
  sanitizeSubagentDescription,
  sanitizeSubagentType,
  type SubagentInvocationRecord,
} from '../../../runtime/subagents/subagentSummary';
import {
  appendExternalUserMessage,
  createHostTranscriptState,
  projectHostTranscriptMessage,
  stableTranscriptId,
} from '../../recovery/hostTranscriptState';
import {
  createTurnActivityState,
  projectAssistantDelta,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  thinkingSegmentKey,
  type TurnActivityState,
} from '../turns/turnActivityState';

export interface SubagentParentRow {
  readonly parentSessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly type: string;
  readonly description: string;
  readonly cwd: string;
}

export interface SubagentViewerSnapshot {
  readonly items: readonly SessionTranscriptItem[];
  readonly truncated: boolean;
  readonly running: boolean;
  readonly lifecycle: 'starting' | 'working' | 'completed' | 'failed' | 'cancelled';
}

interface ChildEntry {
  readonly childSessionId: string;
  readonly cwd: string;
  readonly rows: Map<string, SubagentParentRow>;
  state: HostTranscriptState;
  activity: TurnActivityState;
  activeTurnId: string | null;
  running: boolean;
  lifecycle: SubagentViewerSnapshot['lifecycle'];
  loading: Promise<void> | null;
  historyPhase: 'loading' | 'ready' | 'unavailable';
  settled: boolean;
  resyncing: boolean;
  resyncRequested: boolean;
  readonly listeners: Set<() => void>;
}

export interface SubagentOperationEvidence {
  readonly sequence: number;
  readonly parentToolUseId: string;
  readonly childSessionId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly operationDiff: OperationDiff;
  readonly executionPhase?: ToolExecutionPhase;
}

export interface SubagentEvidenceNotice {
  readonly turnId: string;
  readonly toolUseId: string;
  readonly reason: 'pending' | 'mapping-missing' | 'mapping-ambiguous' | 'history-unavailable' | 'history-partial';
  readonly message: string;
}

export interface ParentSubagentEvidence {
  readonly operations: readonly SubagentOperationEvidence[];
  readonly notices: readonly SubagentEvidenceNotice[];
}

export interface SubagentTranscriptServiceOptions {
  readonly source: SubagentEventSource;
  readonly resolveParentRow: (
    parentSessionId: string,
    toolUseId: string,
  ) => SubagentParentRow | null;
  readonly openViewer: (entry: {
    readonly childSessionId: string;
    readonly title: string;
    readonly cwd: string;
  }) => void;
}

/**
 * Host-only registry and transcript store for Task child sessions.
 * Child ids never enter the chat Bridge. History seeds/reconciles the
 * store; raw session notifications drive its live projection.
 */
export class SubagentTranscriptService {
  private readonly byChild = new Map<string, ChildEntry>();
  private readonly byRow = new Map<
    string,
    { readonly entry: ChildEntry; readonly row: SubagentParentRow }
  >();
  private readonly parentListeners = new Map<
    string,
    Set<
      (
        turnId: string,
        toolUseId: string,
        activities: readonly SubagentActivityItem[],
        lifecycle?: SubagentViewerSnapshot['lifecycle'],
      ) => void
    >
  >();
  private readonly rowIssues = new Map<string, SubagentEvidenceNotice>();
  private readonly evidenceRows = new Set<string>();
  private readonly pendingChildren = new Map<string, Extract<SubagentEvent, { type: 'child-available' }>>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    private readonly history: SessionHistoryLoader,
    private readonly options: SubagentTranscriptServiceOptions,
  ) {
    this.unsubscribe = options.source.subscribe((event) => this.observe(event));
  }

  async syncParent(
    parentSessionId: string,
    cwd: string,
    transcript: readonly SessionTranscriptItem[],
    records: readonly SubagentInvocationRecord[],
  ): Promise<void> {
    const direct = new Map<string, SubagentInvocationRecord>();
    const ambiguousDirect = new Set<string>();
    for (const record of records) {
      if (record.parentToolUseId === undefined) continue;
      if (direct.has(record.parentToolUseId)) {
        ambiguousDirect.add(record.parentToolUseId);
      } else {
        direct.set(record.parentToolUseId, record);
      }
    }
    const queues = invocationQueues(
      records.filter((record) => record.parentToolUseId === undefined),
    );
    for (const item of transcript) {
      if (item.kind !== 'tool' || item.subagent === undefined) {
        continue;
      }
      const key = rowKey(parentSessionId, item.toolUseId);
      const pending = this.pendingChildren.get(key);
      if (pending !== undefined) this.observe(pending);
      if (ambiguousDirect.has(item.toolUseId)) {
        this.noteIssue({
          turnId: item.turnId,
          toolUseId: item.toolUseId,
          reason: 'mapping-ambiguous',
          message: 'Multiple child-session ledger records reference this Task call.',
        }, parentSessionId);
        continue;
      }
      const record =
        direct.get(item.toolUseId) ??
        queues.get(identityKey(item.subagent.type, item.subagent.description))?.shift();
      if (record?.parentToolUseId === undefined && this.evidenceRows.has(key)) continue;
      if (record === undefined) {
        this.noteIssue({
          turnId: item.turnId,
          toolUseId: item.toolUseId,
          reason: item.status === 'running' || item.subagent.status === undefined || item.subagent.status === 'running'
            ? 'pending' : 'mapping-missing',
          message: item.status === 'running' || item.subagent.status === undefined || item.subagent.status === 'running'
            ? 'Waiting for the child session to be registered.'
            : 'No child-session ledger record could be matched to this Task call.',
        }, parentSessionId);
        continue;
      }
      if (record.childSessionId === null) {
        this.noteIssue({
          turnId: item.turnId,
          toolUseId: item.toolUseId,
          reason: 'mapping-missing',
          message: 'The Task ledger record does not contain a child session id.',
        }, parentSessionId);
        continue;
      }
      const existing = this.byChild.get(record.childSessionId);
      if (existing !== undefined && !existing.rows.has(key) && existing.rows.size > 0) {
        this.noteIssue({
          turnId: item.turnId,
          toolUseId: item.toolUseId,
          reason: 'mapping-ambiguous',
          message: 'The child session is already bound to a different parent Task call.',
        }, parentSessionId);
        continue;
      }
      this.rowIssues.delete(key);
      if (record.parentToolUseId === item.toolUseId) this.evidenceRows.add(key);
      this.register({
        parentSessionId,
        turnId: item.turnId,
        toolUseId: item.toolUseId,
        type: item.subagent.type,
        description: item.subagent.description,
        cwd,
        childSessionId: record.childSessionId,
        lifecycle: invocationLifecycle(record.summary.status),
      });
    }
  }

  async ensureParentMapping(
    parentSessionId: string,
    cwd: string,
    transcript: readonly SessionTranscriptItem[],
  ): Promise<ParentSubagentEvidence> {
    const load = this.history.loadSubagentInvocations?.bind(this.history);
    if (load === undefined) {
      this.noteUnmappedRows(parentSessionId, transcript, 'history-unavailable',
        'Child-session ledger history is unavailable.');
      return this.readParentOperationEvidence(parentSessionId);
    }
    const records = await load({ cwd, sessionId: parentSessionId }).catch(() => null);
    if (this.disposed) return { operations: [], notices: [] };
    if (records === null) {
      this.noteUnmappedRows(parentSessionId, transcript, 'history-unavailable',
        'Child-session ledger history could not be loaded.');
      return this.readParentOperationEvidence(parentSessionId);
    }
    await this.syncParent(parentSessionId, cwd, transcript, records);
    return this.readParentOperationEvidence(parentSessionId);
  }

  readParentOperationEvidence(
    parentSessionId: string,
    turnId?: string,
  ): ParentSubagentEvidence {
    const operations: SubagentOperationEvidence[] = [];
    const notices = [...this.rowIssues.entries()]
      .filter(([key, notice]) =>
        key.startsWith(`${parentSessionId}\u0000`) &&
        (turnId === undefined || notice.turnId === turnId))
      .map(([, notice]) => notice);
    const dedupe = new Set<string>();
    let sequence = 0;
    for (const entry of this.byChild.values()) {
      const rows = [...entry.rows.values()].filter((row) =>
        row.parentSessionId === parentSessionId &&
        (turnId === undefined || row.turnId === turnId));
      if (rows.length !== 1) continue;
      const row = rows[0]!;
      if (!this.evidenceRows.has(rowKey(parentSessionId, row.toolUseId)) ||
        this.rowIssues.get(rowKey(parentSessionId, row.toolUseId))?.reason === 'mapping-ambiguous') {
        notices.push({ turnId: row.turnId, toolUseId: row.toolUseId, reason: 'mapping-ambiguous',
          message: 'Child history is matched only by description. Its parent operation cannot be confirmed.' });
        continue;
      }
      if (entry.historyPhase === 'loading') {
        notices.push({ turnId: row.turnId, toolUseId: row.toolUseId, reason: 'pending',
          message: 'Child operation evidence is still loading.' });
      } else if (entry.historyPhase === 'unavailable') {
        notices.push({
          turnId: row.turnId,
          toolUseId: row.toolUseId,
          reason: 'history-unavailable',
          message: 'The mapped child transcript is unavailable.',
        });
      } else if (entry.state.historyStatus === 'partial' || entry.state.truncated) {
        notices.push({
          turnId: row.turnId,
          toolUseId: row.toolUseId,
          reason: 'history-partial',
          message: 'The mapped child transcript is partial; operation coverage may be incomplete.',
        });
      }
      for (const item of entry.state.transcript) {
        if (item.kind !== 'tool' || item.operationDiff === undefined) continue;
        const diff = item.operationDiff.status === 'ready'
          ? { ...item.operationDiff, sourceSessionId: entry.childSessionId }
          : item.operationDiff;
        const identity =
          diff.status === 'ready' && diff.callId !== undefined
            ? `${entry.childSessionId}\u0000${diff.callId}`
            : `${entry.childSessionId}\u0000${item.toolUseId}`;
        if (dedupe.has(identity)) continue;
        dedupe.add(identity);
        operations.push({
          sequence: sequence++,
          parentToolUseId: row.toolUseId,
          childSessionId: entry.childSessionId,
          toolUseId: item.toolUseId,
          toolName: item.toolName,
          operationDiff: diff,
          ...(item.executionPhase === undefined
            ? {}
            : { executionPhase: item.executionPhase }),
        });
      }
    }
    return { operations, notices: dedupeNotices(notices) };
  }

  isParentRunning(parentSessionId: string, turnId: string): boolean {
    return [...this.byChild.values()].some((entry) => entry.running &&
      [...entry.rows.values()].some((row) => row.parentSessionId === parentSessionId && row.turnId === turnId));
  }

  subscribeParent(
    parentSessionId: string,
    listener: (
      turnId: string,
      toolUseId: string,
      activities: readonly SubagentActivityItem[],
      lifecycle?: SubagentViewerSnapshot['lifecycle'],
    ) => void,
  ): () => void {
    let listeners = this.parentListeners.get(parentSessionId);
    if (listeners === undefined) {
      listeners = new Set();
      this.parentListeners.set(parentSessionId, listeners);
    }
    listeners.add(listener);
    for (const entry of this.byChild.values()) {
      for (const row of entry.rows.values()) {
        if (row.parentSessionId === parentSessionId) {
          listener(row.turnId, row.toolUseId, activitiesOf(entry.state), entry.lifecycle);
        }
      }
    }
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.parentListeners.delete(parentSessionId);
      }
    };
  }

  open(parentSessionId: string, turnId: string, toolUseId: string): boolean {
    const binding = this.byRow.get(rowKey(parentSessionId, toolUseId));
    if (binding === undefined || binding.row.turnId !== turnId) {
      return false;
    }
    this.options.openViewer({
      childSessionId: binding.entry.childSessionId,
      title: viewerTitle(binding.row.type, binding.row.description),
      cwd: binding.row.cwd,
    });
    return true;
  }

  readViewer(childSessionId: string): SubagentViewerSnapshot | null {
    const entry = this.byChild.get(childSessionId);
    return entry === undefined
      ? null
      : {
          items: entry.state.transcript,
          truncated: entry.state.truncated,
          running: entry.running,
          lifecycle: entry.lifecycle,
        };
  }

  subscribeViewer(childSessionId: string, listener: () => void): () => void {
    const entry = this.byChild.get(childSessionId);
    if (entry === undefined) {
      return () => undefined;
    }
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribe();
    this.options.source.dispose();
    this.byChild.clear();
    this.byRow.clear();
    this.parentListeners.clear();
    this.rowIssues.clear();
    this.evidenceRows.clear();
    this.pendingChildren.clear();
  }

  private observe(notification: SubagentEvent): void {
    if (this.disposed) return;
    if (notification.type === 'child-available') {
      const row = this.options.resolveParentRow(
        notification.sessionId,
        notification.toolUseId,
      );
      const pendingKey = rowKey(notification.sessionId, notification.toolUseId);
      if (row === null) {
        this.pendingChildren.set(pendingKey, notification);
        if (this.pendingChildren.size > 256) this.pendingChildren.delete(this.pendingChildren.keys().next().value!);
        return;
      }
      this.pendingChildren.delete(pendingKey);
      const existing = this.byChild.get(notification.childSessionId);
      if (
        row !== null &&
        existing !== undefined &&
        !existing.rows.has(rowKey(row.parentSessionId, row.toolUseId)) &&
        existing.rows.size > 0
      ) {
        this.noteIssue({
          turnId: row.turnId,
          toolUseId: row.toolUseId,
          reason: 'mapping-ambiguous',
          message: 'The child session is already bound to a different parent Task call.',
        }, row.parentSessionId);
      } else if (row !== null) {
        const key = rowKey(row.parentSessionId, row.toolUseId);
        this.evidenceRows.add(key);
        this.rowIssues.delete(key);
        this.register({
          ...row,
          childSessionId: notification.childSessionId,
          lifecycle: 'working',
        });
      }
      return;
    }

    const entry = this.byChild.get(notification.sessionId);
    if (entry === undefined) {
      return;
    }
    if (notification.type === 'resync') {
      void this.resync(entry);
      return;
    }
    this.applyNotification(entry, notification);
  }

  private register(
    value: SubagentParentRow & {
      readonly childSessionId: string;
      readonly lifecycle: SubagentViewerSnapshot['lifecycle'];
    },
  ): ChildEntry {
    const key = rowKey(value.parentSessionId, value.toolUseId);
    const row: SubagentParentRow = value;
    const existing = this.byChild.get(value.childSessionId);
    if (existing !== undefined) {
      const wasRunning = existing.running;
      if (!existing.settled) {
        existing.lifecycle = value.lifecycle;
        existing.running = value.lifecycle === 'starting' || value.lifecycle === 'working';
        existing.settled = !existing.running;
      }
      existing.rows.set(key, row);
      this.byRow.set(key, { entry: existing, row });
      this.options.source.watch(existing.childSessionId, existing.cwd, existing.running);
      if (wasRunning && !existing.running) void this.reconcileTerminal(existing);
      this.publish(existing);
      return existing;
    }
    const entry: ChildEntry = {
      childSessionId: value.childSessionId,
      cwd: value.cwd,
      rows: new Map([[key, row]]),
      state: createHostTranscriptState('unavailable'),
      activity: createTurnActivityState(),
      activeTurnId: null,
      running: value.lifecycle === 'starting' || value.lifecycle === 'working',
      lifecycle: value.lifecycle,
      loading: null,
      historyPhase: 'loading',
      settled: value.lifecycle !== 'starting' && value.lifecycle !== 'working',
      resyncing: false,
      resyncRequested: false,
      listeners: new Set(),
    };
    this.byChild.set(entry.childSessionId, entry);
    this.byRow.set(key, { entry, row });
    this.options.source.watch(entry.childSessionId, entry.cwd, entry.running);
    void this.refreshHistory(entry);
    this.publish(entry);
    return entry;
  }

  private refreshHistory(entry: ChildEntry): Promise<void> {
    if (entry.loading !== null) return entry.loading;
    const before = entry.state;
    const wasRunning = entry.running;
    entry.historyPhase = 'loading';
    const pending = this.history.loadHistory({ cwd: entry.cwd, sessionId: entry.childSessionId })
      .then((loaded) => {
        if (this.disposed || this.byChild.get(entry.childSessionId) !== entry) return;
        entry.historyPhase = loaded.status === 'available' ? 'ready' : 'unavailable';
        if (loaded.status === 'available') {
          entry.state = reconcileChildHistory(loaded.state, before, entry.state, wasRunning || entry.running);
          if (entry.activeTurnId !== null)
            entry.activity = restoreChildTools(entry.state, entry.activeTurnId, entry.activity);
        }
      }).catch(() => { entry.historyPhase = 'unavailable'; }).finally(() => {
        entry.loading = null;
        if (!this.disposed) this.publish(entry);
      });
    entry.loading = pending;
    return pending;
  }

  private async resync(entry: ChildEntry): Promise<void> {
    entry.resyncRequested = true;
    if (entry.resyncing) return;
    entry.resyncing = true;
    try {
      do {
        entry.resyncRequested = false;
        // A pre-attachment read cannot satisfy a post-attachment reconciliation.
        if (entry.loading !== null) await entry.loading;
        if (this.disposed) return;
        await this.refreshHistory(entry);
        const row = entry.rows.values().next().value;
        const records = row === undefined ? null : await this.history.loadSubagentInvocations?.({
          cwd: entry.cwd, sessionId: row.parentSessionId,
        }).catch(() => null);
        if (this.disposed) return;
        const record = records?.find((item) => item.childSessionId === entry.childSessionId);
        if (record !== undefined && record.summary.status !== 'running') {
          entry.lifecycle = invocationLifecycle(record.summary.status);
          entry.running = entry.lifecycle === 'starting';
          entry.settled = !entry.running;
          this.options.source.watch(entry.childSessionId, entry.cwd, entry.running);
          if (!entry.running) await this.refreshHistory(entry);
          this.publish(entry);
        }
      } while (entry.resyncRequested);
    } finally { entry.resyncing = false; }
  }

  private applyNotification(entry: ChildEntry, notification: SubagentEvent): void {
    switch (notification.type) {
      case 'settled':
        entry.settled = true;
        entry.running = false;
        entry.lifecycle = notification.lifecycle;
        this.publish(entry);
        void this.reconcileTerminal(entry);
        break;
      case 'assistant-turn':
        this.startAssistantTurn(entry, notification.messageId);
        break;
      case 'user':
        entry.activeTurnId = null;
        entry.activity = createTurnActivityState();
        entry.state = appendExternalUserMessage(
          entry.state,
          stableTranscriptId(
            'user',
            'subagent-live',
            entry.childSessionId,
            notification.messageId,
          ),
          notification.text,
          notification.messageId,
          Date.now(),
        );
        this.publish(entry);
        break;
      case 'runtime':
        if (this.applyRuntimeEvent(entry, notification.event)) this.publish(entry);
        break;
    }
  }

  private applyRuntimeEvent(entry: ChildEntry, event: RuntimeEvent): boolean {
    switch (event.type) {
      case 'text-delta': {
        const turnId = entry.activeTurnId;
        if (turnId === null) {
          return false;
        }
        const projected = projectAssistantDelta(entry.activity, event.text);
        entry.activity = projected.state;
        if (projected.projection === null) {
          return false;
        }
        entry.state = projectHostTranscriptMessage(entry.state, {
          type: 'assistant.delta',
          sequence: 0,
          sessionId: entry.childSessionId,
          turnId,
          delta: projected.projection.delta,
          timestamp: Date.now(),
        });
        return true;
      }
      case 'thinking-delta': {
        const turnId = entry.activeTurnId;
        if (turnId === null) {
          return false;
        }
        const projected = projectThinkingDelta(
          entry.activity,
          event.text,
          thinkingSegmentKey(event),
        );
        entry.activity = projected.state;
        if (projected.projection === null) {
          return false;
        }
        entry.state = projectHostTranscriptMessage(entry.state, {
          type: 'thinking.delta',
          sequence: 0,
          sessionId: entry.childSessionId,
          turnId,
          delta: projected.projection.delta,
          truncated: projected.projection.truncated,
          segmentIndex: projected.projection.segmentIndex,
        });
        return true;
      }
      case 'thinking-complete': {
        const turnId = entry.activeTurnId;
        if (turnId === null) {
          return false;
        }
        const projected = projectThinkingComplete(
          entry.activity,
          thinkingSegmentKey(event),
        );
        if (projected === null) {
          return false;
        }
        entry.state = projectHostTranscriptMessage(entry.state, {
          type: 'thinking.complete',
          sequence: 0,
          sessionId: entry.childSessionId,
          turnId,
          durationMs: event.durationMs,
          segmentIndex: projected.segmentIndex,
        });
        return true;
      }
      case 'tool-start':
      case 'tool-progress':
      case 'tool-result':
      case 'tool-execution-phase': {
        // A reattached child may already be inside a tool and never replay its
        // assistant-start notification. Its raw tool id identifies the saved turn.
        const saved = entry.state.transcript.find((item) => item.kind === 'tool' && item.toolUseId === event.toolUseId);
        const turnId = saved?.kind === 'tool' ? saved.turnId : entry.activeTurnId;
        if (turnId === null) {
          return false;
        }
        entry.activity = restoreChildTools(entry.state, turnId, entry.activity);
        const existing = entry.activity.tools.get(event.toolUseId);
        if (
          event.type !== 'tool-start' &&
          event.type !== 'tool-execution-phase' &&
          existing === undefined
        ) {
          return false;
        }
        const projected = projectToolEvent(
          entry.activity,
          event.type === 'tool-result' && existing !== undefined
            ? {
                ...event,
                toolName: existing.toolName,
                action: existing.action,
              }
            : event,
        );
        entry.activity = projected.state;
        if (projected.projection === null) {
          return false;
        }
        entry.state = projectHostTranscriptMessage(
          entry.state,
          toolMessage(entry.childSessionId, turnId, projected.projection),
        );
        return true;
      }
      case 'image-block': {
        const turnId = entry.activeTurnId;
        if (turnId === null) {
          return false;
        }
        entry.state = projectHostTranscriptMessage(entry.state, {
          type: 'transcript.image',
          sequence: 0,
          sessionId: entry.childSessionId,
          turnId,
          item: {
            id: stableTranscriptId(
              'image',
              turnId,
              event.sourceId,
              String(event.blockIndex),
            ),
            kind: 'image',
            turnId,
            origin: event.origin,
            mediaType: event.mediaType,
            data: event.data,
            generated: event.generated,
            byteLength: event.byteLength,
          },
        });
        return true;
      }
      case 'working-state':
        if (event.isWorking) {
          entry.settled = false;
          entry.running = true;
          entry.lifecycle = 'working';
        }
        return true;
      default:
        return false;
    }
  }

  private startAssistantTurn(entry: ChildEntry, messageId: string): void {
    const turnId = sessionMessageTurnId(entry.childSessionId, messageId);
    if (entry.activeTurnId === turnId) {
      return;
    }
    entry.activeTurnId = turnId;
    entry.activity = restoreChildTools(entry.state, turnId, createTurnActivityState());
  }

  private async reconcileTerminal(entry: ChildEntry): Promise<void> {
    await this.refreshHistory(entry);
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (this.disposed) return;
    await this.refreshHistory(entry);
    if (this.byChild.get(entry.childSessionId) === entry) {
      this.publish(entry);
    }
  }

  private publish(entry: ChildEntry): void {
    entry.listeners.forEach((listener) => listener());
    const activities = activitiesOf(entry.state);
    for (const row of entry.rows.values()) {
      this.parentListeners.get(row.parentSessionId)?.forEach((listener) => {
        listener(row.turnId, row.toolUseId, activities, entry.lifecycle);
      });
    }
  }

  private noteUnmappedRows(
    parentSessionId: string,
    transcript: readonly SessionTranscriptItem[],
    reason: SubagentEvidenceNotice['reason'],
    message: string,
  ): void {
    for (const item of transcript) {
      if (item.kind === 'tool' && item.subagent !== undefined) {
        this.noteIssue({
          turnId: item.turnId,
          toolUseId: item.toolUseId,
          reason,
          message,
        }, parentSessionId);
      }
    }
  }

  private noteIssue(
    notice: SubagentEvidenceNotice,
    parentSessionId: string,
  ): void {
    this.rowIssues.set(rowKey(parentSessionId, notice.toolUseId), notice);
  }
}

function toolMessage(
  sessionId: string,
  turnId: string,
  projection: Omit<ToolActivityMessage, 'type' | 'sequence' | 'sessionId' | 'turnId'>,
): ToolActivityMessage {
  return {
    type: 'tool.activity',
    sequence: 0,
    sessionId,
    turnId,
    ...projection,
  };
}

function activitiesOf(state: HostTranscriptState): readonly SubagentActivityItem[] {
  const activities: SubagentActivityItem[] = [];
  for (
    let index = state.transcript.length - 1;
    index >= 0 && activities.length < 4;
    index -= 1
  ) {
    const item = state.transcript[index];
    if (item?.kind !== 'tool') {
      continue;
    }
    activities.push({
      action: item.action,
      target: item.target ?? item.filePath ?? null,
    });
  }
  return activities;
}

function invocationQueues(
  records: readonly SubagentInvocationRecord[],
): Map<string, SubagentInvocationRecord[]> {
  const queues = new Map<string, SubagentInvocationRecord[]>();
  for (const record of records) {
    const key = identityKey(record.summary.type, record.summary.description);
    const queue = queues.get(key);
    if (queue === undefined) {
      queues.set(key, [record]);
    } else {
      queue.push(record);
    }
  }
  return queues;
}

function identityKey(type: string, description: string): string {
  return `${type}\u0000${description}`;
}

function rowKey(parentSessionId: string, toolUseId: string): string {
  return `${parentSessionId}\u0000${toolUseId}`;
}

function viewerTitle(type: string, description: string): string {
  const safeType = sanitizeSubagentType(type);
  const safeDescription = sanitizeSubagentDescription(description);
  const title = `${safeType} subagent · ${safeDescription}`;
  return title.length <= 512 ? title : `${title.slice(0, 511)}…`;
}

function invocationLifecycle(
  status: string | undefined,
): SubagentViewerSnapshot['lifecycle'] {
  switch (status) {
    case 'running':
      return 'working';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return 'completed';
    default:
      return 'starting';
  }
}

function dedupeNotices(
  notices: readonly SubagentEvidenceNotice[],
): readonly SubagentEvidenceNotice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    const key = `${notice.turnId}\u0000${notice.toolUseId}\u0000${notice.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
