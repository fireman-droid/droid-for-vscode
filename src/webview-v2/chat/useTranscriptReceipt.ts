import { useEffect, useRef } from 'react';
import type { AssistantWebviewState } from '../state/types';
import type { ChatPort } from '../host/chatIntent';

/** Record committed row/lifecycle boundaries, never streamed text or tool payloads. */
export function useTranscriptReceipt(state: AssistantWebviewState, port: ChatPort) {
  const previous = useRef('');
  useEffect(() => {
    const tail = state.transcript.at(-1);
    const boundary = {
      sessionId: state.sessionId,
      turnId: state.turn?.turnId ?? null,
      status: state.turn?.status ?? null,
      items: state.transcript.length,
      pendingInteractions: state.interactions.length,
      tailId: tail?.id ?? null,
      tailKind: tail?.kind ?? null,
      tailStatus: tail?.kind === 'tool' || tail?.kind === 'thinking' ? tail.status : null,
    };
    const key = JSON.stringify(boundary);
    if (key === previous.current || state.sequence < 0) return;
    previous.current = key;
    port.postMessage({ type: 'webview.diagnostic', kind: 'perf-batch', detail: JSON.stringify({
      source: 'transcript.commit', sequence: state.sequence, ...boundary,
      tailTextLength: tail?.kind === 'assistant' || tail?.kind === 'thinking' ? tail.text.length : null,
    }) });
  }, [state, port]);
}
