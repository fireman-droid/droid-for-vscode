import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MissionControlResultMessage } from '../../../shared/missionProtocol';
import {
  postMissionStartTracked,
  type MissionMessagePoster,
  type MissionSetupSubmission,
  type PendingMissionStart,
} from './missionStart';

export interface MissionSetupEntry {
  readonly id: number;
  readonly task: string;
  readonly sessionId: string;
}

export function useMissionEntry(
  poster: MissionMessagePoster,
  sessionId: string | null,
  result: MissionControlResultMessage | null,
  createRequestId: () => string,
) {
  const entryCounterRef = useRef(0);
  const requestsRef = useRef(new Map<string, PendingMissionStart>());
  const timersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const [setupEntry, setSetupEntry] = useState<MissionSetupEntry | null>(null);

  const openSetup = useCallback(
    (task: string): void => {
      if (sessionId === null) {
        return;
      }
      entryCounterRef.current += 1;
      setSetupEntry({
        id: entryCounterRef.current,
        task,
        sessionId,
      });
    },
    [sessionId],
  );

  useEffect(() => {
    if (setupEntry !== null && setupEntry.sessionId !== sessionId) {
      setSetupEntry(null);
    }
    for (const [requestId, request] of requestsRef.current) {
      if (request.sessionId !== sessionId) {
        requestsRef.current.delete(requestId);
        const timer = timersRef.current.get(requestId);
        if (timer !== undefined) {
          clearTimeout(timer);
          timersRef.current.delete(requestId);
        }
      }
    }
  }, [sessionId, setupEntry]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
      requestsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (result === null || result.action !== 'start') {
      return;
    }
    const request = requestsRef.current.get(result.requestId);
    if (request === undefined) {
      return;
    }
    requestsRef.current.delete(result.requestId);
    const timer = timersRef.current.get(result.requestId);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(result.requestId);
    }
    if (result.status === 'accepted') {
      setSetupEntry(null);
    } else if (!request.fromSetup) {
      openSetup(request.task);
    }
  }, [openSetup, result]);

  const start = useCallback(
    (
      submission: MissionSetupSubmission,
      fromSetup: boolean,
    ): string | null =>
      sessionId === null
        ? null
        : postMissionStartTracked(
            poster,
            submission,
            fromSetup,
            sessionId,
            requestsRef.current,
            timersRef.current,
            openSetup,
            createRequestId,
          ),
    [createRequestId, openSetup, poster, sessionId],
  );
  const startDirect = useCallback(
    (submission: MissionSetupSubmission): string | null =>
      start(submission, false),
    [start],
  );
  const startFromSetup = useCallback(
    (submission: MissionSetupSubmission): string | null =>
      start(submission, true),
    [start],
  );
  const dismissSetup = useCallback((): void => {
    setSetupEntry(null);
  }, []);

  return useMemo(
    () => ({
      setupEntry,
      openSetup,
      startDirect,
      startFromSetup,
      dismissSetup,
    }),
    [dismissSetup, openSetup, setupEntry, startDirect, startFromSetup],
  );
}
