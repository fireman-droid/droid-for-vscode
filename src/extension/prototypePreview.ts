export type PrototypePreviewOutcome = 'opened' | 'failed';

/**
 * Opens the sandboxed prototype preview panel for a validated
 * workspace-relative `.html`/`.htm` path. Implementations own absolute
 * path resolution, containment checks against the real workspace root,
 * and the panel lifecycle.
 */
export interface PrototypePreviewOpener {
  openPreview(relativePath: string): Promise<PrototypePreviewOutcome>;
  /**
   * Renders bridge-validated inline HTML (an assistant code block) in
   * the same panel. There is no backing file: implementations
   * revalidate the size and keep the source in memory so Reload can
   * re-render the identical content.
   */
  openInlineHtml(html: string): Promise<PrototypePreviewOutcome>;
}

export function createUnavailablePrototypePreviewOpener(): PrototypePreviewOpener {
  return {
    openPreview: () => Promise.resolve('failed'),
    openInlineHtml: () => Promise.resolve('failed'),
  };
}
