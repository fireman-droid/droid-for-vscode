import { useI18n } from '@droidvisx/chat-ui/i18n';
import type { ConnectionState } from '../../shared/protocol/shell';

export function connectionFailureTitle(connection: ConnectionState): string {
  switch (connection.reason) {
    case 'daemon-not-logged-in': return 'Droid sign-in required';
    case 'daemon-credentials-unreadable':
    case 'daemon-refresh-failed': return 'Droid sign-in could not be verified';
    case 'history-unavailable': return 'Session history could not be loaded';
    case 'catalog-unavailable': return 'Session list could not be loaded';
    case 'daemon-unavailable': return 'Local Droid service could not be reached';
    case 'sdk-protocol-incompatible': return 'Droid versions are incompatible';
    case 'session-in-use': return 'Session is open in another window';
    default: return 'Unable to connect.';
  }
}

/** Connection feedback is separate from saved messages and their copy actions. */
export function ConnectionIssue({ connection, activeTurn = false }: {
  readonly connection: ConnectionState;
  readonly activeTurn?: boolean;
}) {
  const { t } = useI18n();
  const title = connectionFailureTitle(connection);
  return <div role="alert" data-ui-notice="" className="grid max-w-sm select-none gap-1.5 text-xs text-muted-foreground">
    <p className="m-0 font-medium text-foreground">{t(title)}</p>
    {connection.message && connection.message !== title ? <p className="m-0">{t(connection.message)}</p> : null}
    <p className="m-0">{t(activeTurn
      ? 'The task’s final status is not confirmed. Reconnecting does not resend messages.'
      : 'Use Reconnect above to restore the connection. Messages will not be resent.')}</p>
  </div>;
}
