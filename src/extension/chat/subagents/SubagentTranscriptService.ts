import type {
  SubagentEvent,
  SubagentEventSource,
} from '../../../runtime/daemon/daemonNotificationSource';

import { type SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { type ToolActivityMessage } from '../../../shared/bridgeMessages';
import type { HostTranscriptState } from '../../../shared/transcript/hostTranscriptState';
import type { SubagentActivityItem } from '../../../shared/protocol/subagentProtocol';
import type { SessionHistoryLoader } from '../../../runtime/history/SessionHistory';

import { preserveToolResultPreviews } from '../../../shared/transcript/toolResultPreview';
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
  readonly buffered: SubagentEvent[];
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
  readonly reason: 'mapping-missing' | 'mapping-ambiguous' | 'history-unavailable' | 'history-partial';
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
      ) => void
    >
  >();
  private readonly rowIssues = new Map<string, SubagentEvidenceNotice>();
  private readonly evidenceRows = new Set<string>();
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
    const loading: Promise<void>[] = [];
    for (const item of transcript) {
      if (item.kind !== 'tool' || item.subagent === undefined) {
        continue;
      }
      const key = rowKey(parentSessionId, item.toolUseId);
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
          reason: 'mapping-missing',
          message: 'No child-session ledger record could be matched to this Task call.',
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
      const entry = this.register({
        parentSessionId,
        turnId: item.turnId,
        toolUseId: item.toolUseId,
        type: item.subagent.type,
        description: item.subagent.description,
        cwd,
        childSessionId: record.childSessionId,
        lifecycle: invocationLifecycle(record.summary.status),
      });
      if (entry.loading !== null) loading.push(entry.loading);
    }
    await Promise.all(loading);
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
      if (entry.state.historyStatus === 'unavailable') {
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
          listener(row.turnId, row.toolUseId, activitiesOf(entry.state));
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
  }

  private observe(notification: SubagentEvent): void {
    if (this.disposed) return;
    if (notification.type === 'child-available') {
      const row = this.options.resolveParentRow(
        notification.sessionId,
        notification.toolUseId,
      );
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
    if (entry.loading !== null) {
      entry.buffered.push(notification);
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
      existing.lifecycle = value.lifecycle;
      existing.running = value.lifecycle === 'starting' || value.lifecycle === 'working';
      existing.rows.set(key, row);
      this.byRow.set(key, { entry: existing, row });
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
      buffered: [],
      listeners: new Set(),
    };
    this.byChild.set(entry.childSessionId, entry);
    this.byRow.set(key, { entry, row });
    this.options.source.watch(entry.childSessionId, entry.cwd, entry.running);
    entry.loading = this.loadHistory(entry).finally(() => {
      entry.loading = null;
      const buffered = entry.buffered.splice(0);
      buffered.forEach((notification) => {
        this.applyNotification(entry, notification);
      });
      this.publish(entry);
    });
    return entry;
  }

  private async loadHistory(entry: ChildEntry): Promise<void> {
    const loaded = await this.history.loadHistory({
      cwd: entry.cwd,
      sessionId: entry.childSessionId,
    });
    if (
      this.disposed ||
      this.byChild.get(entry.childSessionId) !== entry ||
      loaded.status !== 'available'
    ) {
      return;
    }
    entry.state = {
      ...loaded.state,
      transcript: preserveToolResultPreviews(
        loaded.state.transcript,
        entry.state.transcript,
      ),
    };
  }

  private applyNotification(entry: ChildEntry, notification: SubagentEvent): void {
    switch (notification.type) {
      case 'settled':
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
        const turnId = entry.activeTurnId;
        if (turnId === null) {
          return false;
        }
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
          entry.running = true;
          entry.lifecycle = 'working';
        }
        return true;
      default:
        return false;
    }
  }

  private startAssistantTurn(entry: ChildEntry, messageId: string): void {
    const turnId = stableTranscriptId(
      'assistant',
      'subagent-live',
      entry.childSessionId,
      messageId,
    );
    if (entry.activeTurnId === turnId) {
      return;
    }
    entry.activeTurnId = turnId;
    entry.activity = createTurnActivityState();
  }

  private async reconcileTerminal(entry: ChildEntry): Promise<void> {
    await this.loadHistory(entry);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.loadHistory(entry);
    if (this.byChild.get(entry.childSessionId) === entry) {
      this.publish(entry);
    }
  }

  private publish(entry: ChildEntry): void {
    entry.listeners.forEach((listener) => listener());
    const activities = activitiesOf(entry.state);
    for (const row of entry.rows.values()) {
      this.parentListeners.get(row.parentSessionId)?.forEach((listener) => {
        listener(row.turnId, row.toolUseId, activities);
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
