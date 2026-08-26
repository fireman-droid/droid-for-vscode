import {
  convertNotificationToStreamMessage,
  type ConnectedDroid,
  type DroidStreamEvent,
} from '@factory/droid-sdk';

import type {
  SessionTranscriptItem,
  ToolActivityMessage,
} from '../shared/bridgeMessages';
import type { HostTranscriptState } from '../shared/hostTranscriptState';
import type { SubagentActivityItem } from '../shared/subagentProtocol';
import type { SessionHistoryLoader } from '../runtime/history/SessionHistory';
import {
  normalizeSdkEvent,
  normalizeSdkEventImages,
} from '../runtime/normalizeSdkEvent';
import type { RuntimeEvent } from '../runtime/runtimeEvents';
import {
  sanitizeSubagentDescription,
  sanitizeSubagentType,
  type SubagentInvocationRecord,
} from '../runtime/subagentSummary';
import {
  createHostTranscriptState,
  projectHostTranscriptMessage,
  stableTranscriptId,
} from './hostTranscriptState';
import {
  createTurnActivityState,
  projectAssistantDelta,
  projectThinkingComplete,
  projectThinkingDelta,
  projectToolEvent,
  thinkingSegmentKey,
  type TurnActivityState,
} from './turnActivityState';

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
  readonly lifecycle:
    | 'starting'
    | 'working'
    | 'completed'
    | 'failed'
    | 'cancelled';
}

interface ChildEntry {
  readonly childSessionId: string;
  readonly cwd: string;
  readonly rows: Map<string, SubagentParentRow>;
  state: HostTranscriptState;
  activity: TurnActivityState;
  running: boolean;
  lifecycle: SubagentViewerSnapshot['lifecycle'];
  loading: Promise<void> | null;
  readonly buffered: Record<string, unknown>[];
  readonly listeners: Set<() => void>;
}

interface DaemonNotificationController {
  on(
    event: 'sessionNotification',
    listener: (params: {
      sessionId: string;
      notification: Record<string, unknown>;
    }) => void,
  ): unknown;
  off(
    event: 'sessionNotification',
    listener: (params: {
      sessionId: string;
      notification: Record<string, unknown>;
    }) => void,
  ): unknown;
  ensureChildSessionAttached?(sessionId: string): Promise<void>;
}

export interface SubagentTranscriptServiceOptions {
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
  private readonly daemonDisposables: Array<() => void> = [];
  private readonly boundDroids = new WeakSet<object>();
  private daemonController: DaemonNotificationController | null = null;
  private disposed = false;

  constructor(
    private readonly history: SessionHistoryLoader,
    private readonly options: SubagentTranscriptServiceOptions,
  ) {}

  bindDaemonDroid(droid: ConnectedDroid): boolean {
    if (this.disposed || this.boundDroids.has(droid as object)) {
      return !this.disposed;
    }
    const controller = readNotificationController(droid);
    if (controller === null) {
      return false;
    }
    const listener = (params: {
      sessionId: string;
      notification: Record<string, unknown>;
    }): void => {
      this.observe(params.sessionId, params.notification, controller);
    };
    controller.on('sessionNotification', listener);
    this.daemonController = controller;
    this.boundDroids.add(droid as object);
    this.daemonDisposables.push(() => {
      controller.off('sessionNotification', listener);
    });
    return true;
  }

  observeProcessNotification(
    parentSessionId: string,
    raw: Record<string, unknown>,
  ): void {
    const envelope = readNotificationEnvelope(raw);
    if (envelope !== null) {
      this.observe(
        envelope.sessionId ?? parentSessionId,
        envelope.notification,
        null,
      );
    }
  }

  async syncParent(
    parentSessionId: string,
    cwd: string,
    transcript: readonly SessionTranscriptItem[],
    records: readonly SubagentInvocationRecord[],
  ): Promise<void> {
    const direct = new Map(
      records.flatMap((record) =>
        record.parentToolUseId === undefined
          ? []
          : [[record.parentToolUseId, record] as const],
      ),
    );
    const queues = invocationQueues(
      records.filter((record) => record.parentToolUseId === undefined),
    );
    for (const item of transcript) {
      if (item.kind !== 'tool' || item.subagent === undefined) {
        continue;
      }
      const record =
        direct.get(item.toolUseId) ??
        queues
          .get(identityKey(item.subagent.type, item.subagent.description))
          ?.shift();
      if (record === undefined) {
        continue;
      }
      if (record.childSessionId === null) {
        continue;
      }
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
          listener(
            row.turnId,
            row.toolUseId,
            activitiesOf(entry.state),
          );
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

  open(
    parentSessionId: string,
    turnId: string,
    toolUseId: string,
  ): boolean {
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

  subscribeViewer(
    childSessionId: string,
    listener: () => void,
  ): () => void {
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
    this.daemonDisposables.splice(0).forEach((dispose) => dispose());
    this.byChild.clear();
    this.byRow.clear();
    this.parentListeners.clear();
    this.daemonController = null;
  }

  private observe(
    sessionId: string,
    notification: Record<string, unknown>,
    controller: DaemonNotificationController | null,
  ): void {
    if (this.disposed) {
      return;
    }
    if (notification['type'] === 'child_session_available') {
      const childSessionId = safeId(notification['childSessionId']);
      const toolUseId = safeId(notification['toolUseId']);
      if (childSessionId === null || toolUseId === null) {
        return;
      }
      const row = this.options.resolveParentRow(sessionId, toolUseId);
      if (row === null) {
        return;
      }
      this.register({
        ...row,
        childSessionId,
        lifecycle: 'working',
      });
      void controller?.ensureChildSessionAttached?.(childSessionId);
      return;
    }

    const entry = this.byChild.get(sessionId);
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
      existing.running =
        value.lifecycle === 'starting' || value.lifecycle === 'working';
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
      running:
        value.lifecycle === 'starting' || value.lifecycle === 'working',
      lifecycle: value.lifecycle,
      loading: null,
      buffered: [],
      listeners: new Set(),
    };
    this.byChild.set(entry.childSessionId, entry);
    this.byRow.set(key, { entry, row });
    if (entry.running) {
      void this.daemonController?.ensureChildSessionAttached?.(
        entry.childSessionId,
      );
    }
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
    entry.state = loaded.state;
  }

  private applyNotification(
    entry: ChildEntry,
    notification: Record<string, unknown>,
  ): void {
    const type = notification['type'];
    if (type === 'agent_turn_completed') {
      entry.running = false;
      entry.lifecycle = terminalLifecycle(notification['reason']);
      this.publish(entry);
      void this.reconcileTerminal(entry);
      return;
    }
    const converted = convertNotificationToStreamMessage(notification);
    const messages =
      converted === null
        ? []
        : Array.isArray(converted)
          ? converted
          : [converted];
    let changed = false;
    for (const message of messages) {
      const sdkEvent = message as DroidStreamEvent;
      const event = normalizeSdkEvent(sdkEvent, entry.cwd);
      if (event !== undefined) {
        changed = this.applyRuntimeEvent(entry, event) || changed;
      }
      for (const image of normalizeSdkEventImages(sdkEvent)) {
        changed = this.applyRuntimeEvent(entry, image) || changed;
      }
    }
    if (changed) {
      this.publish(entry);
    }
  }

  private applyRuntimeEvent(
    entry: ChildEntry,
    event: RuntimeEvent,
  ): boolean {
    const turnId = stableTranscriptId(
      'assistant',
      'subagent-live',
      entry.childSessionId,
    );
    switch (event.type) {
      case 'text-delta': {
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
      case 'tool-result': {
        const existing = entry.activity.tools.get(event.toolUseId);
        if (event.type !== 'tool-start' && existing === undefined) {
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
          toolMessage(
            entry.childSessionId,
            turnId,
            projected.projection,
          ),
        );
        return true;
      }
      case 'image-block':
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
      this.parentListeners
        .get(row.parentSessionId)
        ?.forEach((listener) => {
          listener(row.turnId, row.toolUseId, activities);
        });
    }
  }
}

function toolMessage(
  sessionId: string,
  turnId: string,
  projection: Omit<
    ToolActivityMessage,
    'type' | 'sequence' | 'sessionId' | 'turnId'
  >,
): ToolActivityMessage {
  return {
    type: 'tool.activity',
    sequence: 0,
    sessionId,
    turnId,
    ...projection,
  };
}

function activitiesOf(
  state: HostTranscriptState,
): readonly SubagentActivityItem[] {
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

function readNotificationController(
  droid: ConnectedDroid,
): DaemonNotificationController | null {
  const controller = (
    droid.sessions as unknown as {
      readonly controller?: Partial<DaemonNotificationController>;
    }
  ).controller;
  return controller !== undefined &&
    typeof controller.on === 'function' &&
    typeof controller.off === 'function'
    ? (controller as DaemonNotificationController)
    : null;
}

function readNotificationEnvelope(
  raw: Record<string, unknown>,
): {
  readonly sessionId?: string;
  readonly notification: Record<string, unknown>;
} | null {
  const params = raw['params'];
  if (typeof params !== 'object' || params === null) {
    return null;
  }
  const record = params as Record<string, unknown>;
  const notification = record['notification'];
  if (typeof notification !== 'object' || notification === null) {
    return null;
  }
  return {
    ...(typeof record['sessionId'] === 'string'
      ? { sessionId: record['sessionId'] }
      : {}),
    notification: notification as Record<string, unknown>,
  };
}

function invocationQueues(
  records: readonly SubagentInvocationRecord[],
): Map<string, SubagentInvocationRecord[]> {
  const queues = new Map<string, SubagentInvocationRecord[]>();
  for (const record of records) {
    const key = identityKey(
      record.summary.type,
      record.summary.description,
    );
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

function safeId(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : null;
}

function viewerTitle(type: string, description: string): string {
  const safeType = sanitizeSubagentType(type);
  const safeDescription = sanitizeSubagentDescription(description);
  const title = `${safeType} subagent · ${safeDescription}`;
  return title.length <= 512 ? title : `${title.slice(0, 511)}…`;
}

function terminalLifecycle(
  reason: unknown,
): Exclude<SubagentViewerSnapshot['lifecycle'], 'starting' | 'working'> {
  if (reason === 'completed') {
    return 'completed';
  }
  return reason === 'cancelled' || reason === 'permission_rejected'
    ? 'cancelled'
    : 'failed';
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
