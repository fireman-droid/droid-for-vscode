import { isAbsolute, relative } from 'node:path';

/**
 * Converts open editor tab file paths into the workspace-relative
 * forward-slash form the `@` mention popup lists for an empty query.
 * Tab order is preserved, duplicates (split editors, multiple groups)
 * collapse to one row, and anything outside the workspace root is
 * dropped.
 */
export function toOpenEditorRelativePaths(
  rootFsPath: string,
  tabFsPaths: readonly string[],
  maxResults: number,
): readonly string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const fsPath of tabFsPaths) {
    const relativePath = relative(rootFsPath, fsPath).replaceAll('\\', '/');
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath) ||
      seen.has(relativePath)
    ) {
      continue;
    }
    seen.add(relativePath);
    paths.push(relativePath);
    if (paths.length >= maxResults) {
      break;
    }
  }
  return paths;
}
