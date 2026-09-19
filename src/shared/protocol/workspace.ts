import { WORKSPACE_FILES_STATUSES } from './bounds';

/**
 * Asks the host to open a native diff (or the file itself when no
 * comparison base exists) for a workspace-relative file path that a
 * tool activity reported.
 */
export interface FileOpenDiffMessage {
  readonly type: 'file.openDiff';
  readonly sessionId: string;
  readonly turnId: string;
  readonly path: string;
}

/**
 * Asks the host to open the sandboxed prototype preview panel for a
 * workspace-relative `.html`/`.htm` file that a tool activity or turn
 * changes summary reported. The host re-validates containment and the
 * extension whitelist before rendering.
 */
export interface FilePreviewMessage {
  readonly type: 'file.preview';
  readonly sessionId: string;
  readonly path: string;
}

/**
 * Asks the host to reveal the read-only terminal mirror of the
 * active session's execute-command output (native-terminal design
 * slice A), creating the terminal lazily on first use. The mirrored
 * output itself never crosses the bridge: the host feeds the
 * pseudoterminal straight from runtime events, so no H→W reply
 * exists for this message.
 */
export interface TerminalOpenMirrorMessage {
  readonly type: 'terminal.openMirror';
  readonly sessionId: string;
}

/**
 * Asks the host to open a path the user clicked in transcript
 * markdown. Absolute paths outside the workspace are allowed because
 * only an explicit user click produces this message; the host still
 * verifies the path exists before opening it.
 */
export interface WorkspaceOpenPathMessage {
  readonly type: 'workspace.openPath';
  readonly sessionId: string;
  readonly path: string;
  /** 1-based line to reveal when the target opens as text. */
  readonly line?: number;
  /** 1-based column; only accepted together with `line`. */
  readonly column?: number;
}

/**
 * Asks the host to match workspace files against a Composer `@`
 * mention query. Results return via `workspace.files` with the same
 * request id.
 */
export interface WorkspaceSearchFilesMessage {
  readonly type: 'workspace.searchFiles';
  readonly sessionId: string;
  readonly requestId: string;
  readonly query: string;
}

export type WorkspaceFilesStatus = (typeof WORKSPACE_FILES_STATUSES)[number];

/**
 * Workspace files matching one `workspace.searchFiles` request. Paths
 * are workspace-relative with forward slashes. `no-workspace` marks an
 * empty result caused by no folder being open, so the mention popup
 * can say so instead of showing a misleading "no matching files".
 */
export interface WorkspaceFilesMessage {
  readonly type: 'workspace.files';
  readonly sequence: number;
  readonly sessionId: string;
  readonly requestId: string;
  readonly status: WorkspaceFilesStatus;
  readonly files: readonly string[];
}
