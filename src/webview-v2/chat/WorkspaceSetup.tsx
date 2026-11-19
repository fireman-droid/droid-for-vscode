import { useI18n } from '@droidvisx/chat-ui/i18n';
import type { ConnectionState } from '../../shared/protocol/shell';
import type { ChatPort } from '../host/chatIntent';
import { Button } from '../ui/button';

const requirements = {
  'workspace-required': {
    label: 'Workspace required', message: 'Open a workspace folder to use Droid.', openFolder: true,
  },
  'workspace-untrusted': {
    label: 'Workspace trust required', message: 'Trust this workspace to start the local Droid runtime.', openFolder: false,
  },
} as const;

export function getWorkspaceSetup(connection: ConnectionState) {
  return connection.status === 'unavailable' && connection.reason ? requirements[connection.reason] : undefined;
}

export function WorkspaceSetup({ setup, port }: {
  readonly setup: NonNullable<ReturnType<typeof getWorkspaceSetup>>;
  readonly port: ChatPort;
}) {
  const { t } = useI18n();
  return <div role="status" data-ui-notice="" className="pointer-events-auto absolute inset-0 grid select-none place-content-center gap-3 px-6 text-center text-xs text-muted-foreground">
    <p>{t(setup.message)}</p>
    {setup.openFolder ? <Button variant="outline" size="sm" className="justify-self-center"
      onClick={() => port.postMessage({ type: 'workspace.openFolder' })}>{t('Open folder')}</Button> : null}
  </div>;
}
