import { MAX_BRIDGE_ID_LENGTH, type WebviewToHostMessage } from '../bridgeMessages';
import {
  MAX_COMMAND_NAME_LENGTH,
  MAX_MODEL_DISPLAY_NAME_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_OPEN_PATH_LENGTH,
  MAX_OPEN_PATH_POSITION,
  MAX_TOOL_FILE_PATH_LENGTH,
  PREVIEWABLE_FILE_EXTENSIONS,
} from '../protocol/bounds';
import { type UnknownRecord } from './strictValidation';
import { parseWebviewMessage } from '../validateMessage';

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return parseWebviewMessage(value) !== undefined;
}

/**
 * Accepts bounded absolute (drive-letter or POSIX) and relative paths
 * without control characters or `..` traversal segments. Existence and
 * file-versus-directory checks stay on the host, which resolves the
 * path against the workspace root when it is relative.
 */
export function isSafeOpenPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_OPEN_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value.split(/[\\/]/).every((segment) => segment !== '..');
}

export function isPathPosition(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_OPEN_PATH_POSITION
  );
}

/**
 * Accepts only bounded, forward-slash, workspace-relative paths without
 * traversal segments, drive letters, or control characters.
 */
export function isSafeWorkspaceRelativePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TOOL_FILE_PATH_LENGTH ||
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
  return PREVIEWABLE_FILE_EXTENSIONS.some(
    (extension) => lower.endsWith(extension) && lower.length > extension.length,
  );
}

/**
 * Validates the optional `stage` routing field on attachment
 * messages: absent (composer staging) or the literal 'edit'.
 */
export function hasValidStage(
  value: UnknownRecord,
): value is UnknownRecord & { stage?: 'edit' } {
  return value.stage === undefined || value.stage === 'edit';
}

export function stageOf(value: { stage?: 'edit' }): { stage?: 'edit' } {
  return value.stage === undefined ? {} : { stage: value.stage };
}

export function isId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_BRIDGE_ID_LENGTH
  );
}

export function readStringDataProperty(
  value: UnknownRecord,
  key: string,
): string | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

export function isSafeModelId(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_ID_LENGTH) &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

export function isSafeDisplayName(value: unknown): value is string {
  return (
    isNonEmptyBoundedString(value, MAX_MODEL_DISPLAY_NAME_LENGTH) &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/**
 * Collapses control characters and whitespace runs, trims, and bounds
 * an externally sourced session title. Falls back to a readable
 * placeholder for empty titles. Callers pass their own trust-boundary
 * length limit (catalog 200, Bridge contract 256).
 */
export function sanitizeSessionTitle(value: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return 'Untitled session';
  }
  const title = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return title.length > 0 ? title : 'Untitled session';
}

export function isEnumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

export function isNonEmptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return isBoundedString(value, maximumLength) && value.length > 0;
}

/**
 * True when `value` is a plausible custom command slug: bounded,
 * non-empty, and free of whitespace, separators, and control
 * characters.
 */
export function isSafeCommandName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_COMMAND_NAME_LENGTH &&
    !/[\s@/\u0000-\u001f\u007f]/.test(value)
  );
}
