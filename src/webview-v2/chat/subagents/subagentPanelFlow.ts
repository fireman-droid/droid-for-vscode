import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import {
  subscribeHostMessages,
  type DecodedHostMessage,
} from '../../host/hostMessageSource';
import { type SubagentActivityItem, type SubagentOpenResultMessage } from '../../../shared/protocol/subagentProtocol';

export interface SubagentRowExtras {
  readonly activities: readonly SubagentActivityItem[];
  readonly openStatus?: SubagentOpenResultMessage['status'];
}

export interface SubagentActivityStore {
  readonly get: (toolUseId: string) => SubagentRowExtras | undefined;
  readonly subscribe: (toolUseId: string, listener: () => void) => () => void;
}

interface MutableSubagentActivityStore extends SubagentActivityStore {
  readonly publish: (toolUseId: string, extras: SubagentRowExtras) => void;
  readonly reset: () => void;
}

export const SubagentActivityStoreContext = createContext<SubagentActivityStore | null>(
  null,
);
export const SubagentOpenContext = createContext<
  ((turnId: string, toolUseId: string) => void) | null
>(null);

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
      const current = values.get(toolUseId);
      const previous = current?.activities;
      if (
        previous !== undefined &&
        current?.openStatus === extras.openStatus &&
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
    () => (toolUseId === undefined || store === null ? undefined : store.get(toolUseId)),
    [store, toolUseId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useOpenSubagent(): (turnId: string, toolUseId: string) => void {
  return useContext(SubagentOpenContext) ?? (() => undefined);
}

/**
 * Keeps session-scoped activity and opening feedback for inline cards.
 */
export function useSubagentPanelFlow(
  vscode: SubagentPanelPort,
  sessionId: string | null,
): {
  readonly activityStore: SubagentActivityStore;
  readonly onPanelToggle: (open: boolean) => void;
  readonly openSubagent: (turnId: string, toolUseId: string) => void;
} {
  const activityStore = useMemo(createSubagentActivityStore, []);
  useEffect(() => {
    activityStore.reset();
    if (sessionId === null) {
      return undefined;
    }
    const handleMessage = (message: DecodedHostMessage): void => {
      if (message.type === 'subagent.activity' && message.sessionId === sessionId) {
        activityStore.publish(message.toolUseId, {
          ...activityStore.get(message.toolUseId),
          activities: message.activities,
        });
      } else if (message.type === 'subagent.open.result' && message.sessionId === sessionId) {
        activityStore.publish(message.toolUseId, {
          activities: activityStore.get(message.toolUseId)?.activities ?? [],
          openStatus: message.status,
        });
      }
    };
    return subscribeHostMessages(handleMessage);
  }, [activityStore, sessionId]);
  const onPanelToggle = useCallback(
    (open: boolean): void => {
      if (sessionId !== null) {
        vscode.postMessage({ type: 'subagent.panel', sessionId, open });
      }
    },
    [sessionId, vscode],
  );
  const openSubagent = useCallback(
    (turnId: string, toolUseId: string): void => {
      if (sessionId !== null) {
        vscode.postMessage({
          type: 'subagent.open',
          sessionId,
          turnId,
          toolUseId,
        });
      }
    },
    [sessionId, vscode],
  );
  return useMemo(
    () => ({ activityStore, onPanelToggle, openSubagent }),
    [activityStore, onPanelToggle, openSubagent],
  );
}
