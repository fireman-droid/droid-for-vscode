import { isAbsolute, relative, resolve } from 'node:path';

import { MAX_TOOL_FILE_PATH_LENGTH } from '../shared/bridgeMessages';
import { isSafeWorkspaceRelativePath } from '../shared/validateMessage';

/** Tools whose input names a file they create or modify. */
const FILE_MODIFYING_TOOLS = new Set([
  'applypatch',
  'create',
  'edit',
  'write',
]);

const PATH_INPUT_KEYS = ['file_path', 'filePath', 'path'] as const;

/**
 * Reads the target file path out of a file-modifying tool's raw input.
 * Returns undefined for other tools and for inputs without a usable
 * bounded string path.
 */
export function extractToolFilePath(
  toolName: string,
  input: unknown,
): string | undefined {
  const normalized = toolName
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase();
  if (!FILE_MODIFYING_TOOLS.has(normalized)) {
    return undefined;
  }
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  for (const key of PATH_INPUT_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= MAX_TOOL_FILE_PATH_LENGTH * 4 &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Converts a raw tool path into a bounded forward-slash path relative
 * to the workspace root. Returns undefined when the path escapes the
 * workspace or cannot be represented safely.
 */
export function toWorkspaceRelativePath(
  workspaceRoot: string,
  rawPath: string,
): string | undefined {
  const absolute = isAbsolute(rawPath)
    ? rawPath
    : resolve(workspaceRoot, rawPath);
  const relativePath = relative(workspaceRoot, absolute);
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    return undefined;
  }
  const normalized = relativePath.replaceAll('\\', '/');
  return isSafeWorkspaceRelativePath(normalized)
    ? normalized
    : undefined;
}
