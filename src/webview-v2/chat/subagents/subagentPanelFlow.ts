import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import {
  subscribeHostMessages,
  type DecodedHostMessage,
} from '../../host/hostMessageSource';
import type { SubagentSnapshotMessage } from '../../../shared/protocol/subagentInspectionProtocol';
import { type SubagentActivityItem, type SubagentOpenResultMessage } from '../../../shared/protocol/subagentProtocol';

export interface SubagentInspectionState {
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolUseId: string;
  readonly snapshot: SubagentSnapshotMessage | null;
}

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
  readonly inspection: SubagentInspectionState | null;
  readonly inspectSubagent: (turnId: string, toolUseId: string) => void;
  readonly closeInspection: () => void;
} {
  const activityStore = useMemo(createSubagentActivityStore, []);
  const portRef = useRef(vscode);
  portRef.current = vscode;
  const [inspection, setInspection] = useState<SubagentInspectionState | null>(null);
  const activeInspection = useRef<{
    sessionId: string;
    turnId: string;
    toolUseId: string;
    sequence: number;
  } | null>(null);
  useEffect(() => {
    activityStore.reset();
    if (activeInspection.current && activeInspection.current.sessionId !== sessionId) {
      const previous = activeInspection.current;
      activeInspection.current = null;
      setInspection(null);
      portRef.current.postMessage({
        type: 'subagent.inspect',
        sessionId: previous.sessionId,
        turnId: previous.turnId,
        toolUseId: null,
      });
    }
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
      } else if (message.type === 'subagent.snapshot') {
        const current = activeInspection.current;
        if (
          current !== null &&
          message.sessionId === current.sessionId &&
          message.turnId === current.turnId &&
          message.toolUseId === current.toolUseId &&
          message.sequence > current.sequence
        ) {
          current.sequence = message.sequence;
          setInspection({
            sessionId: current.sessionId,
            turnId: current.turnId,
            toolUseId: current.toolUseId,
            snapshot: message,
          });
        }
      } else if (message.type === 'host.snapshot' && message.sessionId !== sessionId) {
        activeInspection.current = null;
        setInspection(null);
      }
    };
    return subscribeHostMessages(handleMessage);
  }, [activityStore, sessionId]);
  useEffect(() => () => {
    const current = activeInspection.current;
    if (current !== null) {
      activeInspection.current = null;
      portRef.current.postMessage({
        type: 'subagent.inspect',
        sessionId: current.sessionId,
        turnId: current.turnId,
        toolUseId: null,
      });
    }
  }, []);
  const onPanelToggle = useCallback(
    (open: boolean): void => {
      if (sessionId !== null) {
        portRef.current.postMessage({ type: 'subagent.panel', sessionId, open });
      }
    },
    [sessionId],
  );
  const openSubagent = useCallback(
    (turnId: string, toolUseId: string): void => {
      if (sessionId !== null) {
        portRef.current.postMessage({
          type: 'subagent.open',
          sessionId,
          turnId,
          toolUseId,
        });
      }
    },
    [sessionId],
  );
  const closeInspection = useCallback((): void => {
    const current = activeInspection.current;
    if (current === null) return;
    activeInspection.current = null;
    setInspection(null);
    portRef.current.postMessage({
      type: 'subagent.inspect',
      sessionId: current.sessionId,
      turnId: current.turnId,
      toolUseId: null,
    });
  }, []);
  const inspectSubagent = useCallback(
    (turnId: string, toolUseId: string): void => {
      if (sessionId === null) return;
      const current = activeInspection.current;
      if (
        current !== null &&
        current.sessionId === sessionId &&
        current.turnId === turnId &&
        current.toolUseId === toolUseId
      ) {
        closeInspection();
        return;
      }
      activeInspection.current = { sessionId, turnId, toolUseId, sequence: -1 };
      setInspection({ sessionId, turnId, toolUseId, snapshot: null });
      portRef.current.postMessage({
        type: 'subagent.inspect',
        sessionId,
        turnId,
        toolUseId,
      });
    },
    [closeInspection, sessionId],
  );
  return useMemo(
    () => ({
      activityStore,
      onPanelToggle,
      openSubagent,
      inspection: inspection?.sessionId === sessionId ? inspection : null,
      inspectSubagent,
      closeInspection,
    }),
    [activityStore, closeInspection, inspectSubagent, inspection, onPanelToggle, openSubagent, sessionId],
  );
}
