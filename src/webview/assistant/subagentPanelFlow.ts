import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  SessionTranscriptItem,
  WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import { parseSubagentActivityMessage } from '../../shared/subagentProtocol';
import { parseSubagentTranscript } from '../bridge/validateSubagentMessage';
import { isStrictRecord } from '../../shared/strictValidation';

/** Live per-row extras for the working popup, keyed by toolUseId. */
export interface SubagentRowExtras {
  readonly action: string | null;
  readonly stoppable: boolean;
}

/** The read-only child transcript sheet. */
export interface SubagentSheetState {
  readonly toolUseId: string;
  readonly title: string;
  readonly status: 'loading' | 'available' | 'unavailable';
  readonly items: readonly SessionTranscriptItem[];
  readonly truncated: boolean;
}

/**
 * Stable action callbacks (identity changes only on session switch),
 * kept apart from the polled data so the memoized transcript sub-rows
 * consuming them never re-render on activity ticks.
 */
export interface SubagentPanelActions {
  readonly onOpenTranscript: (toolUseId: string, title: string) => void;
  /**
   * Re-requests an open sheet's transcript without resetting it to
   * `loading`, so a live refresh swaps content in place. The host
   * single-flights transcript loads per row, so overlapping
   * re-requests are simply dropped there.
   */
  readonly onRefreshTranscript: (toolUseId: string) => void;
  readonly onCloseSheet: () => void;
  readonly onStop: (turnId: string, toolUseId: string) => void;
  readonly onPanelToggle: (open: boolean) => void;
}

export interface SubagentPanelFlowValue {
  readonly activities: ReadonlyMap<string, SubagentRowExtras>;
  readonly sheet: SubagentSheetState | null;
  readonly actions: SubagentPanelActions;
}

/** Full flow (working popup): polled data plus the actions. */
export const SubagentPanelContext =
  createContext<SubagentPanelFlowValue | null>(null);

/** Actions only (transcript sub-rows): stable across polling. */
export const SubagentActionsContext =
  createContext<SubagentPanelActions | null>(null);

interface SubagentPanelPort {
  postMessage(message: WebviewToHostMessage): void;
}

const EMPTY_ACTIVITIES: ReadonlyMap<string, SubagentRowExtras> =
  new Map();

/**
 * App-level flow state for the subagent panel (待办 B). Both host
 * pushes bypass the session store (the `customModels.state` pattern):
 * live activity and the transcript sheet are panel-scoped, validated
 * here with the same parsers the bridge validator delegates to, and
 * reset on session switches. The webview never sees a child session
 * id — every request addresses the delegation by its toolUseId.
 */
export function useSubagentPanelFlow(
  vscode: SubagentPanelPort,
  sessionId: string | null,
): SubagentPanelFlowValue {
  const [activities, setActivities] = useState(EMPTY_ACTIVITIES);
  const [sheet, setSheet] = useState<SubagentSheetState | null>(null);
  const pendingStopsRef = useRef(new Set<string>());
  useEffect(() => {
    setActivities(EMPTY_ACTIVITIES);
    setSheet(null);
    pendingStopsRef.current.clear();
    if (sessionId === null) {
      return;
    }
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const activity = parseSubagentActivityMessage(event.data);
      if (activity !== null && activity.sessionId === sessionId) {
        const stopPending = pendingStopsRef.current.has(
          activity.toolUseId,
        );
        if (stopPending && activity.stoppable) {
          // A sample emitted before the click can arrive after it.
          // Keep the optimistic hidden state until the Host's
          // immediate `stoppable:false` acknowledgement lands.
          return;
        }
        if (stopPending) {
          pendingStopsRef.current.delete(activity.toolUseId);
        }
        setActivities((previous) => {
          const next = new Map(previous);
          next.set(activity.toolUseId, {
            action: activity.action,
            stoppable: activity.stoppable,
          });
          return next;
        });
        return;
      }
      if (
        !isStrictRecord(event.data) ||
        event.data.type !== 'subagent.transcript'
      ) {
        return;
      }
      const transcript = parseSubagentTranscript(event.data);
      if (transcript === undefined || transcript.sessionId !== sessionId) {
        return;
      }
      setSheet((previous) =>
        previous === null || previous.toolUseId !== transcript.toolUseId
          ? previous
          : {
              toolUseId: transcript.toolUseId,
              title:
                transcript.title.length > 0
                  ? transcript.title
                  : previous.title,
              status: transcript.status,
              items: transcript.items ?? [],
              truncated: transcript.truncated ?? false,
            },
      );
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId]);
  const actions = useMemo<SubagentPanelActions>(
    () => ({
      onOpenTranscript: (toolUseId, title) => {
        if (sessionId === null) {
          return;
        }
        setSheet({
          toolUseId,
          title,
          status: 'loading',
          items: [],
          truncated: false,
        });
        vscode.postMessage({
          type: 'subagent.openTranscript',
          sessionId,
          toolUseId,
        });
      },
      onRefreshTranscript: (toolUseId) => {
        if (sessionId !== null) {
          vscode.postMessage({
            type: 'subagent.openTranscript',
            sessionId,
            toolUseId,
          });
        }
      },
      onCloseSheet: () => setSheet(null),
      onStop: (turnId, toolUseId) => {
        if (
          sessionId === null ||
          pendingStopsRef.current.has(toolUseId)
        ) {
          return;
        }
        pendingStopsRef.current.add(toolUseId);
        setActivities((previous) => {
          const current = previous.get(toolUseId);
          if (current === undefined || !current.stoppable) {
            return previous;
          }
          const next = new Map(previous);
          next.set(toolUseId, { ...current, stoppable: false });
          return next;
        });
        vscode.postMessage({
          type: 'subagent.stop',
          sessionId,
          turnId,
          toolUseId,
        });
      },
      onPanelToggle: (open) => {
        if (sessionId !== null) {
          vscode.postMessage({ type: 'subagent.panel', sessionId, open });
        }
      },
    }),
    [sessionId, vscode],
  );
  return useMemo(
    () => ({ activities, sheet, actions }),
    [activities, sheet, actions],
  );
}
