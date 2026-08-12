import type {
  SessionMissionSummary,
  ToolSubagentSummary,
} from '../../shared/bridgeMessages';
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
      /**
       * Read-only mission identity from `loadSession()`
       * (`mission.state` + `decompSessionType`); absent when the
       * session is not part of a mission decomposition.
       */
      readonly mission?: SessionMissionSummary;
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
  /**
   * Optional: final subagent invocation summaries for one session,
   * from `loadSession().subagentInvocations`. Used after a turn that
   * delegated to subagents to settle their terminal status. Resolves
   * null on any failure instead of throwing.
   */
  loadSubagentSummaries?(
    request: SessionHistoryRequest,
  ): Promise<readonly ToolSubagentSummary[] | null>;
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
