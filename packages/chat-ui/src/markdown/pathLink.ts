const MAX_OPEN_PATH_LENGTH = 1024;
const MAX_OPEN_PATH_POSITION = 1_000_000;

/** A file-system path detected in transcript inline code. */
export interface PathLink {
  /** The path without any `:line:col` suffix. */
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

/** Characters Windows forbids in paths (plus backtick noise). */
const INVALID_PATH_CHARS = /[<>"|?*\u0000-\u001f\u007f]/;
/** Trailing `:line` or `:line:col` position suffix. */
const POSITION_SUFFIX = /:(\d{1,7})(?::(\d{1,7}))?$/;
const WINDOWS_ABSOLUTE_PREFIX = /^[A-Za-z]:[\\/]/;
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

/**
 * Decides whether one piece of inline-code text is a path the user
 * can open, and extracts an optional 1-based line/column suffix.
 *
 * Deliberately conservative (a false link on ordinary code is worse
 * than a missed path):
 * - Windows absolute paths (`D:\...`, spaces and CJK allowed).
 * - Workspace-relative paths with a separator and a file extension
 *   (`src/webview/App.tsx`); existence is the host's call.
 * - Bare filenames only when a `:line[:col]` suffix marks them as a
 *   file reference (`foo.ts:12:3`).
 */
export function detectPathLink(text: string): PathLink | null {
  const candidate = text.trim();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_OPEN_PATH_LENGTH ||
    INVALID_PATH_CHARS.test(candidate)
  ) {
    return null;
  }

  const suffix = POSITION_SUFFIX.exec(candidate);
  let path = candidate;
  let line: number | undefined;
  let column: number | undefined;
  if (suffix !== null) {
    const parsedLine = Number(suffix[1]);
    const parsedColumn = suffix[2] === undefined ? undefined : Number(suffix[2]);
    if (
      isValidPosition(parsedLine) &&
      (parsedColumn === undefined || isValidPosition(parsedColumn))
    ) {
      path = candidate.slice(0, suffix.index);
      line = parsedLine;
      column = parsedColumn;
    }
  }

  if (!isWindowsAbsolutePath(path) && !isRelativeFilePath(path, line)) {
    return null;
  }

  return {
    path,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

/**
 * Rebases a detected path link onto the workspace root, mirroring the
 * host's inside-root rebase (ChatController.handleWorkspaceReadImage):
 * relative paths pass through normalized, absolute paths must live
 * under the root, everything else returns null so callers fail closed.
 * Windows drive-letter roots compare case-insensitively (the volume is
 * case-preserving, not case-sensitive); POSIX roots compare exactly.
 */
export function toWorkspaceRelativePath(root: string, path: string): string | null {
  const normalizedRoot = normalizeSeparators(root).replace(/\/+$/, '');
  const normalizedPath = normalizeSeparators(path);
  if (normalizedRoot.length === 0 || normalizedPath.length === 0) {
    return null;
  }
  if (!isAbsoluteNormalizedPath(normalizedPath)) {
    return normalizedPath;
  }
  if (!isAbsoluteNormalizedPath(normalizedRoot)) {
    return null;
  }
  const caseInsensitive = WINDOWS_ABSOLUTE_PREFIX.test(normalizedRoot);
  const rootPrefix = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  const pathPrefix = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
  if (!pathPrefix.startsWith(`${rootPrefix}/`)) {
    return null;
  }
  const remainder = normalizedPath.slice(normalizedRoot.length + 1).replace(/^\/+/, '');
  return remainder.length === 0 ? null : remainder;
}

function normalizeSeparators(value: string): string {
  return value.replaceAll('\\', '/');
}

function isAbsoluteNormalizedPath(value: string): boolean {
  return value.startsWith('/') || WINDOWS_ABSOLUTE_PREFIX.test(value);
}

function isValidPosition(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_OPEN_PATH_POSITION;
}

function isWindowsAbsolutePath(path: string): boolean {
  if (!WINDOWS_ABSOLUTE_PREFIX.test(path)) {
    return false;
  }
  // No colons past the drive letter, no traversal segments, and at
  // least one real name character after the root separator.
  if (path.indexOf(':', 2) !== -1) {
    return false;
  }
  const segments = path.slice(3).split(/[\\/]/);
  return (
    segments.some((segment) => segment.length > 0) &&
    segments.every((segment) => segment !== '..' && segment !== '.')
  );
}

function isRelativeFilePath(path: string, line: number | undefined): boolean {
  if (path.includes(':') || path.includes(' ')) {
    return false;
  }
  const segments = path.split(/[\\/]/);
  if (
    !segments.every(
      (segment) => segment.length > 0 && segment !== '..' && segment !== '.',
    )
  ) {
    return false;
  }
  // A separator-free name is only a path when a :line suffix marked
  // it as a file reference; either way it needs a file extension.
  if (segments.length === 1 && line === undefined) {
    return false;
  }
  return FILE_EXTENSION.test(path);
}
