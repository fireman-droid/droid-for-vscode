import type { HostTranscriptState } from '../../shared/hostTranscriptState';

export const SESSION_HISTORY_UNAVAILABLE_MESSAGE =
  'Saved Droid session history could not be loaded.';

export interface SessionHistoryRequest {
  readonly cwd: string;
  readonly sessionId: string;
}

export type SessionHistoryResult =
  | {
      readonly status: 'available';
      readonly state: HostTranscriptState;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'history-failed';
      readonly message: typeof SESSION_HISTORY_UNAVAILABLE_MESSAGE;
    };

export interface SessionHistoryLoader {
  loadHistory(
    request: SessionHistoryRequest,
  ): Promise<SessionHistoryResult>;
}

export function unavailableSessionHistory(): SessionHistoryResult {
  return {
    status: 'unavailable',
    reason: 'history-failed',
    message: SESSION_HISTORY_UNAVAILABLE_MESSAGE,
  };
}

export function createUnavailableSessionHistoryLoader(): SessionHistoryLoader {
  return {
    async loadHistory() {
      return unavailableSessionHistory();
    },
  };
}
