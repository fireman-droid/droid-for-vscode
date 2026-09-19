import { type SessionCatalogState } from '../../../shared/protocol/sessions';
export class SessionDirectoryState {
  sessions: SessionCatalogState = {
    status: 'idle',
    items: [],
  };
  catalogGeneration = 0;
  catalogCwd: string | null = null;
  refreshInProgress = false;
  worktreeCreateAvailable = false;
  worktreeAvailabilityCwd: string | null = null;
  readonly runningSessionIds = new Set<string>();
  backgroundRunningPoll: Promise<void> | null = null;
}
