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
import {
  invocationTranscripts,
  invocationRowKey as rowKey,
  invocationRunning,
  latestInvocationRowKey,
  readInvocationEvidence,
  type SubagentInvocation,
} from './subagentInvocationScope';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type {
  OperationDiff,
  ToolExecutionPhase,
} from '../../../shared/protocol/operationDiff';
import {
  sanitizeSubagentDescription,
  sanitizeSubagentType,
  subagentIdentityKey,
  type SubagentInvocationRecord,
} from '../../../runtime/subagents/subagentSummary';
import { matchSubagentInvocations } from '../../../runtime/subagents/subagentInvocationMatching';
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
  readonly rows: Map<string, SubagentInvocation>;
  activeRowKey: string;
  state: HostTranscriptState;
  activity: TurnActivityState;
  activeTurnId: string | null;
  running: boolean;
  lifecycle: SubagentViewerSnapshot['lifecycle'];
  loading: Promise<void> | null;
  historyPhase: 'loading' | 'ready' | 'unavailable';
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
    readonly parentSessionId: string;
    readonly toolUseId: string;
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
    { readonly entry: ChildEntry; readonly row: SubagentInvocation }
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
    const matches = matchSubagentInvocations(transcript.flatMap((item) =>
      item.kind === 'tool' && item.subagent !== undefined
        ? [{ toolUseId: item.toolUseId, type: item.subagent.type, description: item.subagent.description }] : []), records);
    const legacyIdentities = new Set(records.filter((record) => record.parentToolUseId === undefined)
      .map((record) => subagentIdentityKey(record.summary.type, record.summary.description)));
    const mappedEntries = new Set<ChildEntry>();
    const refreshEntries = new Set<ChildEntry>();
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
      const record = matches.get(item.toolUseId);
      if (record?.parentToolUseId === undefined && this.evidenceRows.has(key)) {
        const binding = this.byRow.get(key);
        if (binding !== undefined) {
          mappedEntries.add(this.register({ ...binding.row, childSessionId: binding.entry.childSessionId, turnId: item.turnId,
            type: item.subagent.type, description: item.subagent.description, cwd }));
        }
        continue;
      }
      if (record === undefined) {
        if (legacyIdentities.has(subagentIdentityKey(item.subagent.type, item.subagent.description))) {
          this.noteIssue({ turnId: item.turnId, toolUseId: item.toolUseId, reason: 'mapping-ambiguous',
            message: 'The Task description does not uniquely identify a child-session invocation.' }, parentSessionId);
          continue;
        }
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
      if (!this.canBind(parentSessionId, item.turnId, item.toolUseId, record.childSessionId,
        record.parentToolUseId === item.toolUseId, record.promptMessageId)) continue;
      this.rowIssues.delete(key);
      if (record.parentToolUseId === item.toolUseId) this.evidenceRows.add(key);
      const known = [...(this.byChild.get(record.childSessionId)?.rows.values() ?? [])]
        .some(row => row.toolUseId === item.toolUseId);
      const entry = this.register({
        parentSessionId,
        turnId: item.turnId,
        toolUseId: item.toolUseId,
        type: item.subagent.type,
        description: item.subagent.description,
        cwd,
        childSessionId: record.childSessionId,
        lifecycle: invocationLifecycle(record.summary.status),
        ...(record.promptMessageId === undefined ? {} : { promptMessageId: record.promptMessageId }),
      });
      mappedEntries.add(entry);
      if (!known && entry.rows.size > 1) refreshEntries.add(entry);
    }
    for (const entry of mappedEntries) {
      this.activate(entry, latestInvocationRowKey(entry, entry.activeRowKey));
      this.options.source.watch(entry.childSessionId, entry.cwd, entry.running);
      this.publish(entry);
      if (refreshEntries.has(entry)) void this.resync(entry);
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
    const records = await load({ cwd, sessionId: parentSessionId,
      parentToolUseIds: transcript.flatMap((item) =>
        item.kind === 'tool' && item.subagent !== undefined ? [item.toolUseId] : []),
    }).catch(() => null);
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
    return readInvocationEvidence(this.byChild.values(), this.evidenceRows, this.rowIssues, parentSessionId, turnId);
  }

  isParentRunning(parentSessionId: string, turnId: string): boolean {
    return [...this.byChild.values()].some((entry) => [...entry.rows.values()].some((row) =>
      row.parentSessionId === parentSessionId && row.turnId === turnId && invocationRunning(row.lifecycle)));
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
      const transcripts = invocationTranscripts(entry);
      for (const [key, row] of entry.rows) {
        if (row.parentSessionId === parentSessionId) {
          listener(row.turnId, row.toolUseId, activitiesOf(transcripts.get(key) ?? []), row.lifecycle);
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
    const binding = this.resolveBinding(parentSessionId, turnId, toolUseId);
    if (binding === undefined) return false;
    this.options.openViewer({
      childSessionId: binding.entry.childSessionId,
      parentSessionId,
      toolUseId,
      title: viewerTitle(binding.row.type, binding.row.description),
      cwd: binding.row.cwd,
    });
    return true;
  }

  resolveSession(parentSessionId: string, turnId: string, toolUseId: string): { sessionId: string; cwd: string } | null {
    const binding = this.resolveBinding(parentSessionId, turnId, toolUseId);
    return binding === undefined ? null : { sessionId: binding.entry.childSessionId, cwd: binding.row.cwd };
  }

  private resolveBinding(parentSessionId: string, turnId: string, toolUseId: string) {
    const key = rowKey(parentSessionId, toolUseId);
    const binding = this.byRow.get(key);
    return binding?.row.turnId === turnId && this.rowIssues.get(key)?.reason !== 'mapping-ambiguous'
      ? binding : undefined;
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
      if (!this.canBind(row.parentSessionId, row.turnId, row.toolUseId, notification.childSessionId, true)) return;
      const key = rowKey(row.parentSessionId, row.toolUseId);
      const known = [...(this.byChild.get(notification.childSessionId)?.rows.values() ?? [])]
        .some(other => other.toolUseId === row.toolUseId);
      this.evidenceRows.add(key);
      this.rowIssues.delete(key);
      const entry = this.register({ ...row, childSessionId: notification.childSessionId, lifecycle: 'working' });
      // Replayed availability for an older Task must not steal live ownership.
      if (!known) this.activate(entry, key);
      else if (entry.rows.get(entry.activeRowKey)?.toolUseId === row.toolUseId) this.activate(entry, entry.activeRowKey);
      this.options.source.watch(entry.childSessionId, entry.cwd, entry.running);
      this.publish(entry);
      if (!known && entry.rows.size > 1) void this.resync(entry);
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
    value: SubagentInvocation & {
      readonly childSessionId: string;
    },
  ): ChildEntry {
    const key = rowKey(value.parentSessionId, value.toolUseId);
    let row: SubagentInvocation = value;
    const existing = this.byChild.get(value.childSessionId);
    if (existing !== undefined) {
      const previous = existing.rows.get(key);
      const aliases = [...existing.rows.values()].filter(other => other.toolUseId === value.toolUseId);
      row = { ...previous, ...value };
      // Replayed dispatch/running metadata must not revive a settled invocation.
      const settled = aliases.find(other => !invocationRunning(other.lifecycle));
      if (settled !== undefined && invocationRunning(value.lifecycle)) row.lifecycle = settled.lifecycle;
      const prompt = row.promptMessageId ?? aliases.find(other => other.promptMessageId !== undefined)?.promptMessageId;
      if (prompt !== undefined) row.promptMessageId = prompt;
      for (const alias of aliases) {
        alias.lifecycle = row.lifecycle;
        if (prompt !== undefined) alias.promptMessageId ??= prompt;
      }
      existing.rows.set(key, row);
      this.byRow.set(key, { entry: existing, row });
      return existing;
    }
    const entry: ChildEntry = {
      childSessionId: value.childSessionId,
      cwd: value.cwd,
      rows: new Map([[key, row]]),
      activeRowKey: key,
      state: createHostTranscriptState('unavailable'),
      activity: createTurnActivityState(),
      activeTurnId: null,
      running: value.lifecycle === 'starting' || value.lifecycle === 'working',
      lifecycle: value.lifecycle,
      loading: null,
      historyPhase: 'loading',
      resyncing: false,
      resyncRequested: false,
      listeners: new Set(),
    };
    this.byChild.set(entry.childSessionId, entry);
    this.byRow.set(key, { entry, row });
    void this.refreshHistory(entry);
    return entry;
  }

  private canBind(
    parentSessionId: string, turnId: string, toolUseId: string, childSessionId: string,
    direct: boolean, promptMessageId?: string,
  ): boolean {
    const key = rowKey(parentSessionId, toolUseId);
    const bound = this.byRow.get(key);
    const child = this.byChild.get(childSessionId);
    const prompt = promptMessageId ?? bound?.row.promptMessageId;
    const conflict = bound !== undefined && (bound.entry.childSessionId !== childSessionId ||
      prompt !== undefined && bound.row.promptMessageId !== undefined && prompt !== bound.row.promptMessageId) ||
      [...(child?.rows.entries() ?? [])].some(([otherKey, other]) => otherKey !== key &&
        (!direct || !this.evidenceRows.has(otherKey) || (other.toolUseId === toolUseId
          ? prompt !== undefined && other.promptMessageId !== undefined && prompt !== other.promptMessageId
          : prompt !== undefined && other.promptMessageId === prompt)));
    if (conflict) this.noteIssue({ turnId, toolUseId, reason: 'mapping-ambiguous',
      message: 'Conflicting Task-to-child records prevent a reliable invocation mapping.' }, parentSessionId);
    return !conflict;
  }

  private activate(entry: ChildEntry, key: string): void {
    const row = entry.rows.get(key)!;
    const changed = entry.activeRowKey !== key;
    const wasRunning = entry.running;
    entry.activeRowKey = key;
    entry.lifecycle = row.lifecycle;
    entry.running = invocationRunning(row.lifecycle);
    if (changed) {
      entry.activeTurnId = null;
      entry.activity = createTurnActivityState();
    }
    if (wasRunning && !entry.running) void this.reconcileTerminal(entry);
  }

  private setLifecycle(entry: ChildEntry, lifecycle: SubagentViewerSnapshot['lifecycle']): void {
    const active = entry.rows.get(entry.activeRowKey)!;
    for (const row of entry.rows.values()) if (row.toolUseId === active.toolUseId) row.lifecycle = lifecycle;
    this.activate(entry, entry.activeRowKey);
  }

  private refreshHistory(entry: ChildEntry): Promise<void> {
    if (entry.loading !== null) return entry.loading;
    const before = entry.state;
    const wasRunning = entry.running;
    const invocationKey = entry.activeRowKey;
    entry.historyPhase = 'loading';
    const pending = this.history.loadHistory({ cwd: entry.cwd, sessionId: entry.childSessionId })
      .then((loaded) => {
        if (this.disposed || this.byChild.get(entry.childSessionId) !== entry) return;
        entry.historyPhase = loaded.status === 'available' ? 'ready' : 'unavailable';
        if (loaded.status === 'available') {
          entry.state = reconcileChildHistory(loaded.state, before, entry.state,
            wasRunning || entry.running || invocationKey !== entry.activeRowKey);
          this.activate(entry, latestInvocationRowKey(entry, entry.activeRowKey));
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
        const activeKey = entry.activeRowKey;
        const row = entry.rows.get(activeKey)!;
        const records = row === undefined ? null : await this.history.loadSubagentInvocations?.({
          cwd: entry.cwd, sessionId: row.parentSessionId,
          parentToolUseIds: [row.toolUseId],
        }).catch(() => null);
        if (this.disposed) return;
        if (entry.activeRowKey !== activeKey) { entry.resyncRequested = true; continue; }
        const matches = records?.filter(item => item.childSessionId === entry.childSessionId &&
          (item.parentToolUseId === row.toolUseId || item.parentToolUseId === undefined && entry.rows.size === 1));
        const record = matches?.length === 1 ? matches[0] : undefined;
        if (record !== undefined) {
          this.register({ ...row, childSessionId: entry.childSessionId,
            lifecycle: invocationLifecycle(record.summary.status),
            ...(record.promptMessageId === undefined ? {} : { promptMessageId: record.promptMessageId }) });
          this.activate(entry, activeKey);
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
        this.setLifecycle(entry, notification.lifecycle);
        this.publish(entry);
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
        if (event.isWorking) this.setLifecycle(entry, 'working');
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
    const transcripts = invocationTranscripts(entry);
    for (const [key, row] of entry.rows) {
      const activities = activitiesOf(transcripts.get(key) ?? []);
      this.parentListeners.get(row.parentSessionId)?.forEach((listener) => {
        listener(row.turnId, row.toolUseId, activities, row.lifecycle);
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

function activitiesOf(items: readonly SessionTranscriptItem[]): readonly SubagentActivityItem[] {
  const activities: SubagentActivityItem[] = [];
  for (
    let index = items.length - 1;
    index >= 0 && activities.length < 4;
    index -= 1
  ) {
    const item = items[index];
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
