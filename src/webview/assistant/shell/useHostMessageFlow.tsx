import { useEffect, useRef, useState, type Dispatch } from 'react';
import { type ThemePreference } from '../../../shared/protocol/shell';
import type { MissionControlSetupSnapshotMessage } from '../../../shared/protocol/missionControlSetupProtocol';
import {
  announceBooted,
  announceHandshakeTimeout,
  announceReady,
  announceRendered,
} from '../../bridge/vscode';
import type { ChatPort } from './chatIntent';
import { subscribeHostMessages } from './hostMessageSource';
import {
  type AssistantWebviewAction,
  type AssistantWebviewState,
  type StoreHostMessage,
} from '../state/types';
import {
  isTransientNoticeLifecycleMessage,
  reduceTransientDiagnostic,
  type TransientDiagnostic,
} from './transientDiagnostic';

const HANDSHAKE_TIMEOUT_MS = 5_000;

export function useHostMessageFlow(
  vscode: ChatPort,
  state: Pick<AssistantWebviewState, 'sequence' | 'transcript' | 'missionControlResult'>,
  handlers: {
    readonly dispatch: Dispatch<AssistantWebviewAction>;
    readonly observeTransitionMessage: (message: StoreHostMessage) => void;
    readonly applyHostTheme: (
      preference: ThemePreference,
      resolved: 'light' | 'dark',
    ) => void;
    readonly appendCanvasDraft: (text: string) => void;
    readonly settleSend: () => void;
  },
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const canvasSequence = useRef(-1);
  const [transientDiagnostic, setTransientDiagnostic] =
    useState<TransientDiagnostic | null>(null);
  const [missionWorkspaceRoute, setMissionWorkspaceRoute] = useState<
    'new-mission' | 'detail' | null
  >(null);
  const [missionSetup, setMissionSetup] =
    useState<MissionControlSetupSnapshotMessage | null>(null);
  useEffect(() => {
    if (
      state.missionControlResult?.action === 'start' &&
      state.missionControlResult.status === 'accepted'
    ) {
      setMissionWorkspaceRoute('detail');
    }
  }, [state.missionControlResult]);
  useEffect(() => {
    let queue: StoreHostMessage[] = [];
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
      if (queue.length === 0) return;
      const batch = queue;
      queue = [];
      latest.current.settleSend();
      latest.current.dispatch({ type: 'host.batch', messages: batch });
    };
    const unsubscribe = subscribeHostMessages((message) => {
      switch (message.type) {
        case 'missionControl.route':
          setMissionWorkspaceRoute(message.route === 'catalog' ? null : message.route);
          if (message.route === 'catalog') setMissionSetup(null);
          return;
        case 'missionControl.setup.snapshot':
          setMissionSetup(message);
          return;
        case 'missionControl.theme':
        case 'missionControl.catalog.result':
        case 'missionControl.navigationRejected':
          return;
        case 'ui.theme':
          latest.current.applyHostTheme(message.preference, message.resolved);
          return;
        case 'canvas.feedbackDraft':
          if (message.sequence > canvasSequence.current) {
            canvasSequence.current = message.sequence;
            latest.current.appendCanvasDraft(message.text);
          }
          return;
      }
      latest.current.observeTransitionMessage(message);
      if (isTransientNoticeLifecycleMessage(message)) {
        setTransientDiagnostic((current) => reduceTransientDiagnostic(current, message));
      }
      queue.push(message);
      frame ??= requestAnimationFrame(flush);
      timer ??= setTimeout(flush, 50);
    });
    announceBooted(vscode);
    announceReady(vscode);
    const onVisibilityChange = (): void => {
      if (!document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush();
    };
  }, [vscode]);
  const rendered = useRef(false);
  useEffect(() => {
    if (!rendered.current && state.transcript.length > 0) {
      rendered.current = true;
      announceRendered(vscode, state.transcript.length);
    }
  }, [state.transcript.length, vscode]);
  const received = state.sequence >= 0;
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (received) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => {
      setStalled(true);
      announceHandshakeTimeout(vscode, HANDSHAKE_TIMEOUT_MS);
    }, HANDSHAKE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [received, vscode]);
  return {
    missionWorkspaceRoute,
    missionSetup,
    transientDiagnostic,
    showHandshakeNotice: stalled && !received,
  };
}
