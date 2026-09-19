import {
  createHostTranscriptState,
  type HostTranscriptState,
} from '../../recovery/hostTranscriptState';
export class ConversationRecoveryState {
  transcript: HostTranscriptState = createHostTranscriptState('unavailable');
  pendingRecoveryCheckpoint: {
    readonly conversationId: string;
    readonly sessionId: string;
  } | null = null;
  recoveryCheckpointTimer: ReturnType<typeof setTimeout> | null = null;
}
