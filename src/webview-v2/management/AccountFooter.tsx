import { useI18n } from '@droidvisx/chat-ui/i18n';
import type { FactoryAccountState } from '../../shared/protocol/factoryAccountProtocol';
import { Tooltip } from '../ui/overlays';

/**
 * Signed-in Factory identity at the bottom of the management sidebar.
 * The avatar falls back to initials because the webview CSP allows no
 * remote images; the full email stays available as the tooltip and the
 * aria label when the sidebar is collapsed.
 */
export function AccountFooter({
  account,
  collapsed,
}: {
  readonly account: FactoryAccountState | null;
  readonly collapsed: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (account === null) return null;
  if (account.status !== 'ready') {
    return (
      <p className="management-account management-account-muted" data-ui-notice="" role="status">
        {account.status === 'loading' ? t('Reading account…') : account.message}
      </p>
    );
  }
  const identity = account.identity;
  if (identity === null) return null;
  const name = identity.displayName ?? identity.email;
  const initials = (identity.displayName ?? identity.email)
    .split(/[\s@._-]+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  const avatar = (
    <span className="management-account-avatar" aria-hidden="true">{initials || 'D'}</span>
  );
  if (collapsed) {
    return (
      <Tooltip content={`${name}\n${identity.email}`}>
        <span className="management-account management-account-collapsed" aria-label={t('Signed in as {email}', { email: identity.email })}>
          {avatar}
        </span>
      </Tooltip>
    );
  }
  return (
    <div className="management-account" data-ui-notice="">
      {avatar}
      <span className="management-account-copy">
        <span className="management-account-name">{name}</span>
        {identity.displayName === null ? null : (
          <span className="management-account-email">{identity.email}</span>
        )}
      </span>
    </div>
  );
}
