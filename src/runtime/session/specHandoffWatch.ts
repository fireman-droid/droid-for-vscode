import { SessionNotificationPayloadSchema } from '@factory/droid-sdk';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import type { RuntimeInteractionHandler } from '../events/runtimeInteractions';

type PermissionRequest = Parameters<RuntimeInteractionHandler['requestPermission']>[0];
type PermissionResult = Awaited<
  ReturnType<RuntimeInteractionHandler['requestPermission']>
>;

interface NotificationSession {
  readonly id: string;
  onNotification?(callback: (notification: Record<string, unknown>) => void): () => void;
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
    !request.options.some(({ value }) => value.startsWith('proceed_new_session'))
  ) {
    return null;
  }

  const planningSessionId = session.id;
  let approved = false;
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
    if (closed || !approved || candidateSessionId === null) {
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
    const params = notification.params;
    if (!isStrictRecord(params) || params.sessionId !== planningSessionId) return;
    const parsed = SessionNotificationPayloadSchema.safeParse(params.notification);
    if (!parsed.success || parsed.data.type !== 'spec_handoff_session_created' ||
        parsed.data.newSessionId === planningSessionId ||
        !isSafeSessionId(parsed.data.newSessionId)) return;
    candidateSessionId ??= parsed.data.newSessionId;
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
