import * as vscode from 'vscode';

export interface DiffSelectionIdentity {
  readonly path: string;
  readonly side: 'before' | 'current';
  readonly label: string;
  readonly sessionId: string;
  readonly reviewScopeId: string;
}

/**
 * Restores workspace identity for selections made in virtual Diff
 * documents. Entries are bounded to the most recently opened Diffs.
 */
export class DiffSelectionRegistry {
  private readonly entries = new Map<string, DiffSelectionIdentity>();

  register(uri: vscode.Uri, identity: DiffSelectionIdentity): void {
    const key = uri.toString();
    this.entries.delete(key);
    this.entries.set(key, identity);
    while (this.entries.size > 16) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  resolve(uri: vscode.Uri): DiffSelectionIdentity | undefined {
    return this.entries.get(uri.toString());
  }

  clear(): void {
    this.entries.clear();
  }
}
