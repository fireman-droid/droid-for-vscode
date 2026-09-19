import { MAX_TOOL_ACTIVITIES_PER_TURN } from '../../shared/protocol/bounds';
import type { RuntimeEvent } from '../runtimeEvents';
import { readToolExecutionPhaseNotification } from '../session/sessionSupport';

type PhaseEvent = Extract<RuntimeEvent, { type: 'tool-execution-phase' }>;
const MAX_PHASES_PER_TOOL = 6;

export class ToolExecutionPhaseBuffer {
  private readonly started = new Set<string>();
  private readonly pending = new Map<string, PhaseEvent[]>();

  observe(
    notification: Record<string, unknown>,
    sourceSessionId: string,
  ): PhaseEvent | undefined {
    const phase = readToolExecutionPhaseNotification(
      notification,
      sourceSessionId,
    );
    if (phase === null) return undefined;
    const event: PhaseEvent = { type: 'tool-execution-phase', ...phase };
    if (this.started.has(phase.toolUseId)) return event;
    const existing = this.pending.get(phase.toolUseId);
    if (existing !== undefined) {
      if (existing.length < MAX_PHASES_PER_TOOL) existing.push(event);
    } else if (this.pending.size < MAX_TOOL_ACTIVITIES_PER_TURN) {
      this.pending.set(phase.toolUseId, [event]);
    }
    return undefined;
  }

  start(toolUseId: string): readonly PhaseEvent[] {
    this.started.add(toolUseId);
    const phases = this.pending.get(toolUseId) ?? [];
    this.pending.delete(toolUseId);
    return phases;
  }

  reset(): void {
    this.started.clear();
    this.pending.clear();
  }
}
