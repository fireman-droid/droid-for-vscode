import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import type { WebviewToHostMessage } from '../../shared/bridgeMessages';
import {
  parseSubagentActivityMessage,
  type SubagentActivityItem,
} from '../../shared/subagentProtocol';

export interface SubagentRowExtras {
  readonly activities: readonly SubagentActivityItem[];
}

export interface SubagentActivityStore {
  readonly get: (
    toolUseId: string,
  ) => SubagentRowExtras | undefined;
  readonly subscribe: (
    toolUseId: string,
    listener: () => void,
  ) => () => void;
}

interface MutableSubagentActivityStore
  extends SubagentActivityStore {
  readonly publish: (
    toolUseId: string,
    extras: SubagentRowExtras,
  ) => void;
  readonly reset: () => void;
}

export const SubagentActivityStoreContext =
  createContext<SubagentActivityStore | null>(null);

interface SubagentPanelPort {
  postMessage(message: WebviewToHostMessage): void;
}

function createSubagentActivityStore(): MutableSubagentActivityStore {
  const values = new Map<string, SubagentRowExtras>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (toolUseId) => values.get(toolUseId),
    subscribe: (toolUseId, listener) => {
      let subscribers = listeners.get(toolUseId);
      if (subscribers === undefined) {
        subscribers = new Set();
        listeners.set(toolUseId, subscribers);
      }
      subscribers.add(listener);
      return () => {
        subscribers?.delete(listener);
        if (subscribers?.size === 0) {
          listeners.delete(toolUseId);
        }
      };
    },
    publish: (toolUseId, extras) => {
      const previous = values.get(toolUseId)?.activities;
      if (
        previous !== undefined &&
        previous.length === extras.activities.length &&
        previous.every((activity, index) => {
          const next = extras.activities[index];
          return (
            next !== undefined &&
            activity.action === next.action &&
            activity.target === next.target
          );
        })
      ) {
        return;
      }
      values.set(toolUseId, extras);
      listeners.get(toolUseId)?.forEach((listener) => listener());
    },
    reset: () => {
      const changedIds = [...values.keys()];
      values.clear();
      changedIds.forEach((toolUseId) => {
        listeners.get(toolUseId)?.forEach((listener) => listener());
      });
    },
  };
}

export function useSubagentActivity(
  toolUseId: string | undefined,
): SubagentRowExtras | undefined {
  const store = useContext(SubagentActivityStoreContext);
  const subscribe = useCallback(
    (listener: () => void) =>
      toolUseId === undefined || store === null
        ? () => undefined
        : store.subscribe(toolUseId, listener),
    [store, toolUseId],
  );
  const getSnapshot = useCallback(
    () =>
      toolUseId === undefined || store === null
        ? undefined
        : store.get(toolUseId),
    [store, toolUseId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Keeps only the live-activity feed used by inline Subagent cards.
 * Transcript sheets, aggregate popups, and Subagent actions are not
 * part of the presentation contract.
 */
export function useSubagentPanelFlow(
  vscode: SubagentPanelPort,
  sessionId: string | null,
): {
  readonly activityStore: SubagentActivityStore;
  readonly onPanelToggle: (open: boolean) => void;
} {
  const activityStore = useMemo(createSubagentActivityStore, []);
  useEffect(() => {
    activityStore.reset();
    if (sessionId === null) {
      return undefined;
    }
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const activity = parseSubagentActivityMessage(event.data);
      if (activity !== null && activity.sessionId === sessionId) {
        activityStore.publish(activity.toolUseId, {
          activities: activity.activities,
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activityStore, sessionId]);
  const onPanelToggle = useCallback(
    (open: boolean): void => {
      if (sessionId !== null) {
        vscode.postMessage({ type: 'subagent.panel', sessionId, open });
      }
    },
    [sessionId, vscode],
  );
  return useMemo(
    () => ({ activityStore, onPanelToggle }),
    [activityStore, onPanelToggle],
  );
}
