import { isAbsolute, relative, resolve } from 'node:path';

import {
  MAX_CHANGED_FILES_PER_TURN,
  MAX_TOOL_FILE_PATH_LENGTH,
} from '../../shared/protocol/bounds';
import { toolNameCandidates } from '../../shared/transcript/toolActivity';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';

/** Tools whose input names a file they create or modify. */
const FILE_MODIFYING_TOOLS = new Set(['applypatch', 'create', 'edit', 'write']);

const PATH_INPUT_KEYS = ['file_path', 'filePath', 'path'] as const;

/** File headers of the CLI's ApplyPatch `input` patch text. */
const PATCH_FILE_HEADER = /^\*{3} (?:Add|Update|Delete) File: (.+)$/gm;

/**
 * Reads every target file path out of a file-modifying tool's raw
 * input, deduplicated in patch order and bounded to the changed-files
 * display cap. Returns an empty list for other tools and for inputs
 * without a usable bounded string path. ApplyPatch carries a single
 * `input` key holding the whole patch text, so its paths come from
 * the `*** Add/Update File:` headers instead of a path key.
 */
export function extractToolFilePaths(
  toolName: string,
  input: unknown,
): readonly string[] {
  const normalized = toolNameCandidates(toolName).find((candidate) =>
    FILE_MODIFYING_TOOLS.has(candidate),
  );
  if (normalized === undefined) {
    return [];
  }
  if (normalized === 'applypatch' && typeof input === 'string') return extractPatchFilePaths(input);
  if (typeof input !== 'object' || input === null) {
    return [];
  }
  for (const key of PATH_INPUT_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      isUsablePathValue(value)
    ) {
      return [value.trim()];
    }
  }
  if (normalized === 'applypatch') {
    return extractPatchFilePaths((input as Record<string, unknown>).input);
  }
  return [];
}

export function hasCompleteToolFilePaths(toolName: string, input: unknown): boolean {
  const normalized = toolNameCandidates(toolName).find((candidate) =>
    FILE_MODIFYING_TOOLS.has(candidate),
  );
  if (normalized === undefined) return false;
  if (normalized !== 'applypatch') {
    return extractToolFilePaths(toolName, input).length > 0;
  }
  const patchText =
    typeof input === 'string' ? input : typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)['input']
      : undefined;
  return (
    typeof patchText === 'string' && /(?:^|\r?\n)\*\*\* End Patch\s*$/.test(patchText)
  );
}

function extractPatchFilePaths(patchText: unknown): readonly string[] {
  if (typeof patchText !== 'string') {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of patchText.matchAll(PATCH_FILE_HEADER)) {
    // `.` excludes `\n` but not `\r`; trim strips CRLF remainders.
    const value = match[1]?.trim();
    if (value === undefined || !isUsablePathValue(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    paths.push(value);
    if (paths.length >= MAX_CHANGED_FILES_PER_TURN) {
      break;
    }
  }
  return paths;
}

function isUsablePathValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_TOOL_FILE_PATH_LENGTH * 4 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
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
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(workspaceRoot, rawPath);
  const relativePath = relative(workspaceRoot, absolute);
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    return undefined;
  }
  const normalized = relativePath.replaceAll('\\', '/');
  return isSafeWorkspaceRelativePath(normalized) ? normalized : undefined;
}
