import {
  extractToolFilePaths,
  toWorkspaceRelativePath,
} from '../toolFilePath';

export function historyToolFilePaths(
  workspaceRoot: string | undefined,
  toolName: string,
  input: unknown,
): readonly string[] {
  if (workspaceRoot === undefined) {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const rawPath of extractToolFilePaths(toolName, input)) {
    const relativePath = toWorkspaceRelativePath(workspaceRoot, rawPath);
    if (relativePath !== undefined && !seen.has(relativePath)) {
      seen.add(relativePath);
      paths.push(relativePath);
    }
  }
  return paths;
}
