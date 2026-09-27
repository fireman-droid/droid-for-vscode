import type { RuntimeAvailability } from '../../../runtime/runtimeEvents';

export const SESSION_CLOSE_FAILED_MESSAGE = 'The current Droid session could not be closed.';
export const SESSION_RESUME_FAILED_MESSAGE = 'The selected Droid session could not be opened.';
export const WORKSPACE_CHANGED_MESSAGE = 'The workspace changed before the Droid session could be opened.';

export function unavailableMessage(
  reason: Extract<RuntimeAvailability, { status: 'unavailable' }>['reason'],
): string {
  switch (reason) {
    case 'cli-not-found':
      return 'Install the Droid CLI and sign in before using Droid.';
    case 'invalid-cwd':
      return 'Droid could not use the selected workspace folder.';
    case 'daemon-not-logged-in':
      return 'Sign in with the droid CLI, then Retry the daemon connection.';
    case 'daemon-credentials-unreadable':
      return 'Droid could not read the current Droid CLI sign-in.';
    case 'daemon-refresh-failed':
      return 'The Droid CLI sign-in could not authenticate the local daemon. Sign in again, then Retry.';
    case 'daemon-unavailable':
      return 'The local droid daemon could not be reached. Retry the connection.';
    case 'initialization-failed':
      return 'The local Droid runtime could not be initialized.';
  }
}
