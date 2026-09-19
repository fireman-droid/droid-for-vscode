import {
  type CommandSummary,
  type ModelCatalogState,
  type SessionContextState,
  type SessionSettingsState,
} from '../../../shared/protocol/settings';
import {
  EMPTY_SESSION_TOKEN_USAGE,
  type SessionTokenUsageState,
} from '../../../shared/protocol/tokenUsage';

/** One owner for session metadata and its in-flight operations. Never stores turn or queue state. */
export class SessionMetadataState {
  settings: SessionSettingsState = { status: 'loading', value: null };
  settingsUpdate: symbol | null = null;
  context: SessionContextState = { status: 'loading', value: null };
  contextGeneration = 0;
  modelCatalog: ModelCatalogState = { status: 'loading', items: [] };
  tokenUsage: SessionTokenUsageState = EMPTY_SESSION_TOKEN_USAGE;
  commandsCache: {
    readonly sessionId: string;
    readonly items: readonly CommandSummary[];
  } | null = null;
  commandsRefreshGeneration: number | null = null;
  mcpAuthServerName: string | null = null;
  mcpAuthTimer: ReturnType<typeof setTimeout> | null = null;

  finishMcpAuth(): void {
    if (this.mcpAuthTimer !== null) clearTimeout(this.mcpAuthTimer);
    this.mcpAuthTimer = null;
    this.mcpAuthServerName = null;
  }

  reset(): void {
    this.contextGeneration++;
    this.settingsUpdate = null;
    this.settings = { status: 'loading', value: null };
    this.context = { status: 'loading', value: null };
    this.modelCatalog = { status: 'loading', items: [] };
    this.commandsCache = null;
    this.commandsRefreshGeneration = null;
    this.finishMcpAuth();
  }

  dispose(): void {
    this.contextGeneration++;
    this.settingsUpdate = null;
    this.finishMcpAuth();
  }
}
