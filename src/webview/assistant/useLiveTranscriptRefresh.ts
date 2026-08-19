import { useEffect, useRef } from 'react';

/**
 * Polls a batch-oriented transcript while its source is live, then
 * requests one final snapshot when it settles. Changing ids resets
 * the settle edge so one transcript can never refresh another.
 */
export function useLiveTranscriptRefresh(
  id: string | null,
  live: boolean,
  refresh: (id: string) => void,
  intervalMs: number,
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (id === null || !live) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      refreshRef.current(id);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [id, intervalMs, live]);

  const wasLiveRef = useRef(live);
  const previousIdRef = useRef(id);
  useEffect(() => {
    const idChanged = previousIdRef.current !== id;
    if (
      !idChanged &&
      id !== null &&
      wasLiveRef.current &&
      !live
    ) {
      refreshRef.current(id);
    }
    previousIdRef.current = id;
    wasLiveRef.current = live;
  }, [id, live]);
}
