import { useEffect, useState } from 'react';

import type { HostToWebviewMessage } from '../../shared/bridgeMessages';
import { isTransientRuntimeDiagnostic } from '../../shared/transientDiagnostics';
import { Diagnostic } from './thread/transcriptRows';

export const TRANSIENT_NOTICE_TIMEOUT_MS = 4_000;

export type TransientDiagnostic = Extract<
  HostToWebviewMessage,
  { type: 'runtime.diagnostic' }
> & { readonly code: 'file-not-ready' };

export type TransientNoticeLifecycleMessage =
  | TransientDiagnostic
  | Extract<
      HostToWebviewMessage,
      {
        type:
          | 'host.snapshot'
          | 'host.connection'
          | 'turn.error'
          | 'turn.state';
      }
    >;

export function isTransientNoticeLifecycleMessage(
  message: HostToWebviewMessage,
): message is TransientNoticeLifecycleMessage {
  return (
    (message.type === 'runtime.diagnostic' &&
      isTransientRuntimeDiagnostic(message.code)) ||
    message.type === 'host.snapshot' ||
    message.type === 'host.connection' ||
    message.type === 'turn.error' ||
    (message.type === 'turn.state' &&
      (message.status === 'completed' ||
        message.status === 'interrupted' ||
        message.status === 'failed'))
  );
}

export function reduceTransientDiagnostic(
  current: TransientDiagnostic | null,
  message: TransientNoticeLifecycleMessage,
): TransientDiagnostic | null {
  if (message.type === 'runtime.diagnostic') {
    return message;
  }
  if (current === null) {
    return null;
  }
  if (message.type === 'host.snapshot') {
    return message.sessionId === current.sessionId &&
      message.turn?.turnId === current.turnId &&
      (message.turn.status === 'submitting' ||
        message.turn.status === 'streaming' ||
        message.turn.status === 'stopping')
      ? current
      : null;
  }
  if (message.type === 'host.connection') {
    return message.sessionId === current.sessionId &&
      message.connection.status === 'connected'
      ? current
      : null;
  }
  return message.sessionId === current.sessionId &&
    message.turnId === current.turnId
    ? null
    : current;
}

export function selectVisibleNotice(
  diagnostic: TransientDiagnostic | null,
  sessionId: string | null,
  turnId: string | null,
  active: boolean,
): TransientDiagnostic | null {
  return active &&
    diagnostic?.sessionId === sessionId &&
    diagnostic.turnId === turnId
    ? diagnostic
    : null;
}

/** Short-lived interaction feedback that never enters assistant-ui history. */
export function TransientNotice({
  diagnostic,
}: {
  readonly diagnostic: TransientDiagnostic;
}): React.JSX.Element | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(
      () => setVisible(false),
      TRANSIENT_NOTICE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, []);

  return visible ? <Diagnostic data={diagnostic} /> : null;
}
