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

export type SubagentEvent =
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
    }
  >();
  const listeners = new Set<(event: SubagentEvent) => void>();
  let unbind: (() => void) | undefined;
  let boundDroid: DaemonApi | null = null;
  let disposed = false;
  const emit = (event: SubagentEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const attach = (sessionId: string): void => {
    // History remains available if this connection cannot attach a live child.
    void boundDroid?.notifications.attachChild(sessionId).catch(() => undefined);
  };
  const observe = ({ sessionId, notification }: Notification): void => {
    if (disposed) return;
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
    for (const message of messages) {
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
          emit({ type: 'user', sessionId, messageId: message.message.id, text });
        }
      }
      const event = normalizeSdkEvent(
        message,
        child.cwd,
        child.collect(message),
        child.collectOperation(message),
      );
      if (event !== undefined) {
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
    subscribe(listener: (event: SubagentEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch(sessionId: string, cwd: string, live: boolean): void {
      if (children.has(sessionId)) return;
      children.set(sessionId, {
        cwd,
        live,
        collect: createToolResultCollector(cwd),
        collectOperation: createOperationDiffCollector(cwd, sessionId),
        phases: new ToolExecutionPhaseBuffer(),
      });
      if (live) attach(sessionId);
    },
    bindDaemon(droid: DaemonApi): boolean {
      if (disposed) return false;
      if (boundDroid === droid) return true;
      unbind?.();
      boundDroid = droid;
      unbind = droid.notifications.subscribe(observe);
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
      unbind = undefined;
      boundDroid = null;
      children.clear();
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
