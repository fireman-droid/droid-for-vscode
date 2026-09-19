export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly modifiedTime: string;
  readonly active: boolean;
  readonly isFavorite: boolean;
  readonly running?: boolean;
  readonly badge?: string;
  readonly worktree?: { readonly path: string; readonly branch: string };
}

interface ListState<T> {
  readonly status: string;
  readonly items: readonly T[];
  readonly message?: string;
}

export interface SessionMenuState {
  readonly sessions: ListState<SessionSummary>;
  readonly archived: ListState<{ readonly id: string; readonly title: string; readonly archivedTime: string }>;
  readonly sessionSearch: (ListState<{ readonly id: string; readonly title: string; readonly snippet: string | null }> & { readonly query: string }) | null;
  readonly worktreeCreateAvailable?: boolean;
}

/** Callbacks are capabilities, never a promise that a CLI supports an operation. */
export interface SessionActions {
  readonly handleSelectSession: (id: string) => void;
  readonly handleRenameSession?: (id: string, title: string) => void;
  readonly handleForkSession?: (id: string) => void;
  readonly handleArchiveSession?: (id: string) => void;
  readonly handleToggleFavorite?: (id: string, favorite: boolean) => void;
  readonly handleRefreshArchived?: () => void;
  readonly handleUnarchiveSession?: (id: string) => void;
  readonly handleSearchContent?: (query: string) => void;
  readonly handleCreateWorktreeSession?: () => void;
}
