import type { DaemonApi } from './api';
import {
  convertNotificationToStreamMessage,
  type DroidStreamEvent,
} from '@factory/droid-sdk';
import { sanitizeNonAssistantText } from '../history/projectSessionHistory';
import { normalizeSdkEvent, normalizeSdkEventImages } from '../events/normalizeSdkEvent';
import { createToolResultCollector } from '../tools/toolResultPreview';
import { createOperationDiffCollector } from '../tools/operationDiff';
import type { RuntimeEvent } from '../runtimeEvents';
import { ToolExecutionPhaseBuffer } from '../events/toolExecutionPhases';
import { ParentSessionEvents, type ParentSessionEvent } from './parentSessionEvents';
import { MAX_TOOL_ACTIVITIES_PER_TURN } from '../../shared/protocol/bounds';

export type SubagentEvent =
  | { readonly type: 'resync'; readonly sessionId: string }
  | {
      readonly type: 'child-available';
      readonly sessionId: string;
      readonly childSessionId: string;
      readonly toolUseId: string;
    }
  | {
      readonly type: 'assistant-turn';
      readonly sessionId: string;
      readonly messageId: string;
    }
  | {
      readonly type: 'user';
      readonly sessionId: string;
      readonly messageId: string;
      readonly text: string;
    }
  | { readonly type: 'runtime'; readonly sessionId: string; readonly event: RuntimeEvent }
  | {
      readonly type: 'settled';
      readonly sessionId: string;
      readonly lifecycle: 'completed' | 'failed' | 'cancelled';
    };

export interface SubagentEventSource {
  subscribe(listener: (event: SubagentEvent) => void): () => void;
  watch(sessionId: string, cwd: string, live: boolean): void;
  dispose(): void;
}

type Notification = { sessionId: string; notification: Record<string, unknown> };
/** Converts Runtime-owned notifications into the Host's typed child events. */
export function createSubagentEventSource() {
  const children = new Map<
    string,
    {
      cwd: string;
      live: boolean;
      collect: ReturnType<typeof createToolResultCollector>;
      collectOperation: ReturnType<typeof createOperationDiffCollector>;
      phases: ToolExecutionPhaseBuffer;
      toolNames: Map<string, string>;
    }
  >();
  const parents = new Map<string, Set<ParentSessionEvents>>();
  const listeners = new Set<(event: SubagentEvent) => void>();
  let unbind: (() => void) | undefined;
  let unbindRecovery: (() => void) | undefined;
  let boundDroid: DaemonApi | null = null;
  let disposed = false;
  const emit = (event: SubagentEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const attach = (sessionId: string): void => {
    const droid = boundDroid;
    if (droid === null) return;
    // Subscribe before reading the snapshot; live events continue while it loads.
    void droid.notifications.attachChild(sessionId).then(() => {
      if (!disposed && boundDroid === droid && children.has(sessionId))
        emit({ type: 'resync', sessionId });
    }).catch(() => {
      // A failed attachment still needs an authoritative history reconciliation.
      if (!disposed && boundDroid === droid && children.has(sessionId))
        emit({ type: 'resync', sessionId });
    });
  };
  const observe = ({ sessionId, notification }: Notification): void => {
    if (disposed) return;
    for (const parent of parents.get(sessionId) ?? []) parent.observe(notification);
    if (notification.type === 'child_session_available') {
      const childSessionId = safeId(notification.childSessionId);
      const toolUseId = safeId(notification.toolUseId);
      if (childSessionId !== null && toolUseId !== null)
        emit({ type: 'child-available', sessionId, childSessionId, toolUseId });
      return;
    }
    const child = children.get(sessionId);
    if (child === undefined) return;
    const phase = child.live
      ? child.phases.observe(
          { params: { sessionId, notification } },
          sessionId,
        )
      : undefined;
    if (phase !== undefined) {
      emit({ type: 'runtime', sessionId, event: phase });
      return;
    }
    if (notification.type === 'tool_execution_phase_changed') return;
    if (notification.type === 'agent_turn_completed') {
      child.live = false;
      child.phases.reset();
      emit({
        type: 'settled',
        sessionId,
        lifecycle:
          notification.reason === 'completed'
            ? 'completed'
            : notification.reason === 'cancelled' ||
                notification.reason === 'permission_rejected'
              ? 'cancelled'
              : 'failed',
      });
      return;
    }
    const converted = convertNotificationToStreamMessage(notification);
    // 0.7.0 types also include internal tool blocks; the normalizers ignore unsupported variants.
    const messages = (
      converted === null ? [] : Array.isArray(converted) ? converted : [converted]
    ) as DroidStreamEvent[];
    const firstAssistant = messages.map(assistantId).find((id) => id !== null);
    if (firstAssistant !== undefined)
      emit({ type: 'assistant-turn', sessionId, messageId: firstAssistant });
    for (let message of messages) {
      const messageId = assistantId(message);
      if (messageId !== null) emit({ type: 'assistant-turn', sessionId, messageId });
      if (message.type === 'user' && safeId(message.message.id) !== null) {
        const text = sanitizeNonAssistantText(
          message.message.content
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join(''),
        );
        if (text !== null && text.length > 0) {
          child.collect = createToolResultCollector(child.cwd);
          child.collectOperation = createOperationDiffCollector(child.cwd, sessionId);
          child.phases.reset();
          child.toolNames.clear();
          emit({ type: 'user', sessionId, messageId: message.message.id, text });
        }
      }
      if (message.type === 'tool_call' || message.type === 'tool_call_delta') {
        const id = message.type === 'tool_call' ? message.toolUseId : message.toolUse.id;
        const name = message.type === 'tool_call' ? message.name : message.toolUse.name;
        if (child.toolNames.has(id) || child.toolNames.size < MAX_TOOL_ACTIVITIES_PER_TURN)
          child.toolNames.set(id, name);
      } else if (message.type === 'tool_result' && message.toolName.length === 0) {
        message = { ...message, toolName: child.toolNames.get(message.toolUseId) ?? '' };
      }
      const event = normalizeSdkEvent(
        message,
        child.cwd,
        child.collect(message),
        child.collectOperation(message),
      );
      if (event !== undefined) {
        if (event.type === 'working-state' && event.isWorking) child.live = true;
        emit({ type: 'runtime', sessionId, event });
        if (event.type === 'tool-start') {
          for (const buffered of child.phases.start(event.toolUseId)) {
            emit({ type: 'runtime', sessionId, event: buffered });
          }
        }
      }
      for (const image of normalizeSdkEventImages(message))
        emit({ type: 'runtime', sessionId, event: image });
    }
  };
  return {
    watchParent(sessionId: string, cwd: string, listener: (event: ParentSessionEvent) => void): () => void {
      const parent = new ParentSessionEvents(sessionId, cwd, listener);
      const observers = parents.get(sessionId) ?? new Set<ParentSessionEvents>();
      observers.add(parent);
      parents.set(sessionId, observers);
      return () => {
        observers.delete(parent);
        if (observers.size === 0) parents.delete(sessionId);
      };
    },
    subscribe(listener: (event: SubagentEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch(sessionId: string, cwd: string, live: boolean): void {
      const existing = children.get(sessionId);
      if (existing !== undefined) {
        const attachNeeded = live && !existing.live;
        existing.live = live;
        if (attachNeeded) attach(sessionId);
        return;
      }
      children.set(sessionId, {
        cwd,
        live,
        collect: createToolResultCollector(cwd),
        collectOperation: createOperationDiffCollector(cwd, sessionId),
        phases: new ToolExecutionPhaseBuffer(),
        toolNames: new Map(),
      });
      if (live) attach(sessionId);
    },
    bindDaemon(droid: DaemonApi): boolean {
      if (disposed) return false;
      if (boundDroid === droid) return true;
      unbind?.();
      unbindRecovery?.();
      boundDroid = droid;
      unbind = droid.notifications.subscribe(observe);
      unbindRecovery = droid.notifications.subscribeRecovery?.(() => {
        for (const [sessionId, child] of children) if (child.live) attach(sessionId);
        for (const observers of parents.values()) for (const parent of observers) parent.resync();
      });
      for (const [sessionId, child] of children) if (child.live) attach(sessionId);
      return true;
    },
    observeProcessNotification(
      parentSessionId: string,
      raw: Record<string, unknown>,
    ): void {
      const params = raw.params;
      if (typeof params !== 'object' || params === null) return;
      const record = params as Record<string, unknown>;
      if (typeof record.notification !== 'object' || record.notification === null) return;
      observe({
        sessionId:
          typeof record.sessionId === 'string' ? record.sessionId : parentSessionId,
        notification: record.notification as Record<string, unknown>,
      });
    },
    dispose(): void {
      disposed = true;
      unbind?.();
      unbindRecovery?.();
      unbind = undefined;
      unbindRecovery = undefined;
      boundDroid = null;
      children.clear();
      parents.clear();
      listeners.clear();
    },
  };
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

function assistantId(event: DroidStreamEvent): string | null {
  switch (event.type) {
    case 'assistant':
      return safeId(event.message.id);
    case 'assistant_text_delta':
    case 'thinking_text_delta':
    case 'thinking_text_complete':
      return safeId(event.messageId);
    default:
      return null;
  }
}
