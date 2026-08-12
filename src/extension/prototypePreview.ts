export type PrototypePreviewOutcome = 'opened' | 'failed';

/**
 * Opens the sandboxed prototype preview panel for a validated
 * workspace-relative `.html`/`.htm` path. Implementations own absolute
 * path resolution, containment checks against the real workspace root,
 * and the panel lifecycle.
 */
export interface PrototypePreviewOpener {
  openPreview(relativePath: string): Promise<PrototypePreviewOutcome>;
}

export function createUnavailablePrototypePreviewOpener(): PrototypePreviewOpener {
  return {
    openPreview: () => Promise.resolve('failed'),
  };
}
