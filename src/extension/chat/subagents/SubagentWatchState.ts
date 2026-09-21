import type { SubagentTranscriptService } from './SubagentTranscriptService';
import { type PendingSubagentRow } from '../turns/turnActivityState';
export class SubagentWatchState {
  subagentTranscripts: SubagentTranscriptService | null = null;
  zombieSubagentWatch: {
    readonly sessionId: string;
    rows: readonly PendingSubagentRow[];
    readonly timer: ReturnType<typeof setInterval>;
    /** Serializes ticks so a slow ledger read never overlaps. */
    ticking: boolean;
  } | null = null;
}
