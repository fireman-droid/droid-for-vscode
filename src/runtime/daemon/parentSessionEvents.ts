import {
  convertNotificationToStreamMessage,
  SessionNotificationPayloadSchema,
  StreamStateTracker,
  type DroidStreamEvent,
} from '@factory/droid-sdk';
import type { RuntimeEvent } from '../runtimeEvents';
import { normalizeSdkEvent, normalizeSdkEventImages } from '../events/normalizeSdkEvent';
import { ToolExecutionPhaseBuffer } from '../events/toolExecutionPhases';
import { createToolResultCollector } from '../tools/toolResultPreview';
import { createOperationDiffCollector } from '../tools/operationDiff';
import { readSubagentStartedNotification } from '../session/sessionSupport';

/** Passive observation: no prompt submission, session load, or interrupt. */
export type ParentSessionEvent =
  | { readonly type: 'resync' }
  | { readonly type: 'turn-start'; readonly turnId: string; readonly automatic: boolean }
  | { readonly type: 'runtime'; readonly turnId: string; readonly event: RuntimeEvent };

export interface ParentSessionEventSource {
  watchParent(sessionId: string, cwd: string, listener: (event: ParentSessionEvent) => void): () => void;
}

export class ParentSessionEvents {
  private turnId: string | null = null;
  private automatic = false;
  private tracker = new StreamStateTracker();
  private collect: ReturnType<typeof createToolResultCollector>;
  private collectOperation: ReturnType<typeof createOperationDiffCollector>;
  private readonly phases = new ToolExecutionPhaseBuffer();

  constructor(private readonly sessionId: string, private readonly cwd: string,
    private readonly emit: (event: ParentSessionEvent) => void) {
    this.collect = createToolResultCollector(cwd);
    this.collectOperation = createOperationDiffCollector(cwd, sessionId);
  }

  resync(): void { this.emit({ type: 'resync' }); }

  observe(notification: Record<string, unknown>): void {
    // Foreground traffic already has a stream owner. Inspect only message
    // boundaries until an automatic system request starts a passive turn.
    if (!this.automatic) {
      if (notification.type !== 'create_message') return;
      const message = notification.message;
      if (typeof message !== 'object' || message === null ||
          !['user', 'system'].includes(String((message as { role?: unknown }).role))) return;
    }
    const parsed = SessionNotificationPayloadSchema.safeParse(notification);
    if (!parsed.success) return;
    const inner = parsed.data;
    if (inner.type === 'agent_turn_completed') {
      if (this.turnId === null || inner.turnId !== this.turnId) return;
      const event = normalizeSdkEvent(this.tracker.completeTurn(inner), this.cwd);
      if (event) this.emit({ type: 'runtime', turnId: this.turnId, event });
      this.turnId = null;
      this.automatic = false;
      this.tracker = new StreamStateTracker();
      this.collect = createToolResultCollector(this.cwd);
      this.collectOperation = createOperationDiffCollector(this.cwd, this.sessionId);
      this.phases.reset();
      return;
    }
    // Background completions enter as an llm_only system message whose
    // requestId is the daemon turn id; its preceding context user row is empty.
    if (inner.type === 'create_message' && typeof inner.requestId === 'string' &&
        inner.message.role === 'system') this.start(inner.requestId, true);
    if (inner.type === 'create_message' && inner.message.role === 'user' &&
        inner.message.content.some((block) => block.type === 'text')) this.start(inner.message.id, false);
    if (!this.automatic) return;
    const started = readSubagentStartedNotification({ params: { notification } });
    if (started && this.turnId !== null)
      this.emit({ type: 'runtime', turnId: this.turnId, event: { type: 'subagent-started', ...started } });
    const phase = this.phases.observe({ params: { sessionId: this.sessionId, notification } }, this.sessionId);
    if (phase && this.turnId !== null) this.emit({ type: 'runtime', turnId: this.turnId, event: phase });
    const converted = convertNotificationToStreamMessage(inner);
    for (const input of converted === null ? [] : Array.isArray(converted) ? converted : [converted]) {
      if (this.turnId === null) continue;
      const tracked = this.tracker.processMessage(input);
      for (const message of tracked.message === null ? tracked.additional : [tracked.message, ...tracked.additional]) {
        if (message.type === 'structured_output' || message.type === 'tool_use' || message.type === 'create_message' || message.type === 'user') continue;
        this.project(message);
      }
    }
  }

  private start(turnId: string, automatic: boolean): void {
    if (this.turnId === turnId) return;
    this.turnId = turnId;
    this.automatic = automatic;
    if (automatic) {
      this.tracker = new StreamStateTracker({ sessionId: this.sessionId, startedAt: Date.now() });
      this.collect = createToolResultCollector(this.cwd);
      this.collectOperation = createOperationDiffCollector(this.cwd, this.sessionId);
    }
    this.phases.reset();
    this.emit({ type: 'turn-start', turnId, automatic });
  }

  private project(message: DroidStreamEvent): void {
    const turnId = this.turnId!;
    const event = normalizeSdkEvent(message, this.cwd, this.collect(message), this.collectOperation(message));
    if (event) {
      this.emit({ type: 'runtime', turnId, event });
      if (event.type === 'tool-start') {
        for (const phase of this.phases.start(event.toolUseId)) this.emit({ type: 'runtime', turnId, event: phase });
      }
    }
    for (const image of normalizeSdkEventImages(message)) this.emit({ type: 'runtime', turnId, event: image });
  }
}
