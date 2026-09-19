export function isSafeWorkspaceRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((segment) => segment.length > 0 && segment !== '..');
}

/**
 * True when a workspace-relative path names a file the sandboxed
 * prototype preview can render. Both sides use this one predicate: the
 * webview to decide whether a Preview chip appears, the bridge parser
 * and the host to reject `file.preview` requests for anything else.
 */
export function isPreviewableFilePath(value: string): boolean {
  const lower = value.toLowerCase();
  return ['.html', '.htm'].some(
    (extension) => lower.endsWith(extension) && lower.length > extension.length,
  );
}

