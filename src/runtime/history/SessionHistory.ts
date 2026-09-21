import { type SessionMissionSummary } from '../../shared/protocol/sessions';
import { type ToolSubagentSummary } from '../../shared/protocol/transcript';
import type { HostTranscriptState } from '../../shared/transcript/hostTranscriptState';
import type { TokenUsageBreakdown } from '../../shared/protocol/tokenUsage';
import type { SubagentInvocationRecord } from '../subagents/subagentSummary';

export const SESSION_HISTORY_UNAVAILABLE_MESSAGE =
  'Saved Droid session history could not be loaded.';

export interface SessionHistoryRequest {
  readonly cwd: string;
  readonly sessionId: string;
}

/** Host-only identity graph. Hidden message content is never retained here. */
export interface HistoryMessageAncestry {
  readonly messageId: string;
  readonly parentId: string | null;
  readonly projectedTurnId: string;
  readonly startsTurn: boolean;
}

export type SessionHistoryResult =
  | {
      readonly status: 'available';
      readonly state: HostTranscriptState;
      readonly messageAncestry?: readonly HistoryMessageAncestry[];
      /**
       * Read-only mission identity from `loadSession()`
       * (`mission.state` + `decompSessionType`); absent when the
       * session is not part of a mission decomposition.
       */
      readonly mission?: SessionMissionSummary;
      /**
       * Cumulative session token totals from the `loadSession()`
       * envelope's top-level `tokenUsage`; absent when the CLI did
       * not persist usage for this session. History carries no
       * per-turn usage (probed 2026-08-12).
       */
      readonly tokenUsage?: TokenUsageBreakdown;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'history-failed';
      readonly message: typeof SESSION_HISTORY_UNAVAILABLE_MESSAGE;
    };

export interface SessionHistoryLoader {
  loadHistory(request: SessionHistoryRequest): Promise<SessionHistoryResult>;
  /**
   * Optional: final subagent invocation summaries for one session,
   * from `loadSession().subagentInvocations`. Used after a turn that
   * delegated to subagents to settle their terminal status. Resolves
   * null on any failure instead of throwing.
   */
  loadSubagentSummaries?(
    request: SessionHistoryRequest,
  ): Promise<readonly ToolSubagentSummary[] | null>;
  /**
   * Optional: the same ledger with each invocation's host-only child
   * session id (待办 B registry source: per-row stop, live activity,
   * transcript replay). The ids never cross the bridge. Resolves
   * null on any failure instead of throwing.
   */
  loadSubagentInvocations?(
    request: SessionHistoryRequest,
  ): Promise<readonly SubagentInvocationRecord[] | null>;
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
