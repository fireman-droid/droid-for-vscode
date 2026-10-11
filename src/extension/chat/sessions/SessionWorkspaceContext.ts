import type { WorkspaceContext, WorkspaceContextProvider } from '../hostTypes';

/** A selected chat can own a different directory from its editor window. */
export class SessionWorkspaceContext {
  private selection: { editor: WorkspaceContext; cwd: string } | null = null;

  constructor(readonly editor: WorkspaceContextProvider) {}

  read = (): WorkspaceContext => {
    const editor = this.editor();
    if (this.selection && (this.selection.editor.cwd !== editor.cwd ||
        this.selection.editor.trusted !== editor.trusted)) this.selection = null;
    return this.selection ? { ...editor, cwd: this.selection.cwd } : editor;
  };

  select(cwd: string): void {
    this.selection = { editor: { ...this.editor() }, cwd };
  }
}
