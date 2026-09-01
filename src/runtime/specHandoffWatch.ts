import type {
  RuntimeInteractionHandler,
} from './runtimeInteractions';

type PermissionRequest = Parameters<
  RuntimeInteractionHandler['requestPermission']
>[0];
type PermissionResult = Awaited<
  ReturnType<RuntimeInteractionHandler['requestPermission']>
>;

interface NotificationSession {
  readonly id: string;
  onNotification?(
    callback: (notification: Record<string, unknown>) => void,
  ): () => void;
}

export interface SpecHandoffWatch {
  resolve(result: PermissionResult): void;
  dispose(): void;
}

export function createSpecHandoffWatch({
  request,
  session,
  onHandoff,
  onClosed,
}: {
  readonly request: PermissionRequest;
  readonly session: NotificationSession | null;
  readonly onHandoff: (
    planningSessionId: string,
    implementationSessionId: string,
  ) => void;
  readonly onClosed: () => void;
}): SpecHandoffWatch | null {
  if (
    session === null ||
    typeof session.onNotification !== 'function' ||
    !request.toolUses.some(
      ({ confirmationKind }) => confirmationKind === 'exit_spec_mode',
    ) ||
    !request.options.some(({ value }) =>
      value.startsWith('proceed_new_session'),
    )
  ) {
    return null;
  }

  const planningSessionId = session.id;
  let approved = false;
  let reasonSeen = false;
  let candidateSessionId: string | null = null;
  let closed = false;
  let unsubscribe = () => {};

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
    onClosed();
  };
  const publishIfReady = (): void => {
    if (
      closed ||
      !approved ||
      !reasonSeen ||
      candidateSessionId === null
    ) {
      return;
    }
    const implementationSessionId = candidateSessionId;
    close();
    onHandoff(planningSessionId, implementationSessionId);
  };

  unsubscribe = session.onNotification((notification) => {
    if (closed) {
      return;
    }
    const envelope = readSessionNotificationEnvelope(notification);
    if (envelope === null) {
      return;
    }
    if (
      envelope.type === 'agent_turn_completed' &&
      envelope.reason === 'spec_handoff'
    ) {
      reasonSeen = true;
    }
    if (
      candidateSessionId === null &&
      envelope.sessionId !== undefined &&
      envelope.sessionId !== planningSessionId &&
      isSafeSessionId(envelope.sessionId)
    ) {
      candidateSessionId = envelope.sessionId;
    }
    publishIfReady();
  });

  return {
    resolve(result) {
      if (
        typeof result?.selectedOption !== 'string' ||
        !result.selectedOption.startsWith('proceed_new_session')
      ) {
        close();
        return;
      }
      approved = true;
      publishIfReady();
    },
    dispose: close,
  };
}

const MAX_SESSION_ID_LENGTH = 256;

function isSafeSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

function readSessionNotificationEnvelope(
  raw: Record<string, unknown>,
): {
  sessionId?: string;
  type?: string;
  reason?: string;
} | null {
  const params = raw['params'];
  if (typeof params !== 'object' || params === null) {
    return null;
  }
  const { sessionId, notification } = params as Record<string, unknown>;
  if (typeof notification !== 'object' || notification === null) {
    return null;
  }
  const { type, reason } = notification as Record<string, unknown>;
  return {
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
    ...(typeof type === 'string' ? { type } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}
