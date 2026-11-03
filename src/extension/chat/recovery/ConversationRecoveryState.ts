import {
  createHostTranscriptState,
  type HostTranscriptState,
} from '../../recovery/hostTranscriptState';
import type { SessionHistoryWindow } from '../../../runtime/history/SessionHistoryWindow';
import type { HistoryWindowState } from '../../../shared/protocol/historyPaging';
export class ConversationRecoveryState {
  historyWindow: SessionHistoryWindow | null = null;
  historyView: HistoryWindowState | null = null;
  transcript: HostTranscriptState = createHostTranscriptState('unavailable');
  pendingRecoveryCheckpoint: {
    readonly conversationId: string;
    readonly sessionId: string;
  } | null = null;
  recoveryCheckpointTimer: ReturnType<typeof setTimeout> | null = null;
}
