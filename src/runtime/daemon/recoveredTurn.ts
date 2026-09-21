import {
  SessionNotificationPayloadSchema,
  type DaemonSessionController,
  type DroidResultMessage,
  type StreamStateTracker,
} from '@factory/droid-sdk';
import type { DaemonNotification } from './api';

/** A snapshot handoff still listens for the real completion of that exact submission. */
export class RecoveredDaemonTurn {
  completion: DroidResultMessage | undefined;
  private disposed = false;
  constructor(
    private readonly controller: DaemonSessionController,
    private readonly sessionId: string,
    private readonly turnId: string,
    private readonly tracker: StreamStateTracker,
    completion: DroidResultMessage | undefined,
    private readonly onRelease: () => void,
  ) {
    this.completion = completion;
    if (completion === undefined) controller.on('sessionNotification', this.observe);
  }

  private readonly observe = (event: DaemonNotification): void => {
    if (event.sessionId !== this.sessionId || this.disposed) return;
    const parsed = SessionNotificationPayloadSchema.safeParse(event.notification);
    if (parsed.success && parsed.data.type === 'agent_turn_completed' && parsed.data.turnId === this.turnId) {
      // The tracker's previous usage may predate the gap. Only the matching
      // terminal event can supply this recovered turn's final usage.
      this.completion = { ...this.tracker.completeTurn(parsed.data), tokenUsage: parsed.data.tokenUsage ?? null };
      this.dispose();
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.off('sessionNotification', this.observe);
    this.onRelease();
  }
}
