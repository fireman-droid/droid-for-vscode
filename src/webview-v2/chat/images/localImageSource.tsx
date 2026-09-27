import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
import { subscribeHostMessages } from '../../host/hostMessageSource';
import { type LocalImageEntry } from '../../state/types';

export function createLocalImageRequests(send: (path: string) => void) {
  const pending = new Set<string>();
  return {
    request(path: string, entries: Readonly<Record<string, LocalImageEntry>>): void {
      if (entries[path] !== undefined || pending.has(path)) return;
      pending.add(path);
      send(path);
    },
    settle(path: string): void {
      pending.delete(path);
    },
  };
}

export function useLocalImageSource(
  port: { postMessage(message: WebviewToHostMessage): void },
  sessionId: string | null,
  connectionStatus: string,
  entries: Readonly<Record<string, LocalImageEntry>>,
) {
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const requests = useMemo(
    () =>
      createLocalImageRequests((path) => {
        if (sessionId !== null)
          port.postMessage({ type: 'workspace.readImage', sessionId, path });
      }),
    [port, sessionId],
  );
  useEffect(
    () =>
      subscribeHostMessages((message) => {
        if (message.type === 'workspace.imageData' && message.sessionId === sessionId)
          requests.settle(message.path);
      }),
    [requests, sessionId],
  );
  const request = useMemo(
    () =>
      (path: string): void => {
        if (sessionId !== null && connectionStatus === 'connected')
          requests.request(path, entriesRef.current);
      },
    [requests, sessionId, connectionStatus],
  );
  return useMemo(() => ({ entries, request }), [entries, request]);
}

export { useLocalImageVisit } from '@droidvisx/chat-ui/content/useLocalImageVisit';
