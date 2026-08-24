const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ABSOLUTE_DRIVE_PATH_PATTERN = /[A-Za-z]:[\\/]/u;
const UNC_PATH_PATTERN = /\\\\[^\\/\s]+[\\/][^\\/\s]+/u;
const HOME_PATH_PATTERN = /~[\\/][^\s()[\]{}]+/u;
const IDENTIFIER_CONTINUE_PATTERN = /\p{ID_Continue}/u;
const URL_PATTERN = /(?:https?|wss?|file):\/\//iu;
const CREDENTIAL_KEY_SOURCE =
  '(?:api[-_]?(?:key|token)|secret|token|passwd|password|credential|authorization|access[-_]?(?:key|token)|client[-_]?secret|openai_api_key)';
const CREDENTIAL_KEY_PATTERN = new RegExp(
  `^${CREDENTIAL_KEY_SOURCE}$`,
  'iu',
);
const CREDENTIAL_ASSIGNMENT_SOURCE =
  `(^|[^\\p{L}\\p{N}_-])(${CREDENTIAL_KEY_SOURCE}["']?\\s*[:=]\\s*)(?:"((?:\\\\[^\\r\\n]|[^"\\\\\\r\\n])*)(?:"|(?=[\\r\\n]|$))|'((?:\\\\[^\\r\\n]|[^'\\\\\\r\\n])*)(?:'|(?=[\\r\\n]|$))|([^\\s"'\\x60,;&]+))`;
const CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
  CREDENTIAL_ASSIGNMENT_SOURCE,
  'iu',
);
const CREDENTIAL_ASSIGNMENT_GLOBAL_PATTERN = new RegExp(
  CREDENTIAL_ASSIGNMENT_SOURCE,
  'giu',
);

export function isCredentialKey(value: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(value);
}

export function containsCredentialAssignment(value: string): boolean {
  return CREDENTIAL_ASSIGNMENT_PATTERN.test(value);
}

export function scrubCredentialAssignments(value: string): string {
  return value.replace(
    CREDENTIAL_ASSIGNMENT_GLOBAL_PATTERN,
    (
      _match,
      boundary: string,
      assignment: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
    ) =>
      `${boundary}${assignment}${
        doubleQuoted !== undefined
          ? '"[REDACTED]"'
          : singleQuoted !== undefined
            ? "'[REDACTED]'"
            : '[REDACTED]'
      }`,
  );
}

export function containsRepeatedBoundarySlashRun(value: string): boolean {
  for (let index = 0; index < value.length - 1; index += 1) {
    if (
      value[index] === '/' &&
      value[index + 1] === '/' &&
      (index === 0 ||
        !isIdentifierContinueBefore(value, index))
    ) {
      return true;
    }
  }
  return false;
}

function containsUnsafePosixPath(value: string): boolean {
  if (containsRepeatedBoundarySlashRun(value)) {
    return true;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '/' || value[index - 1] === '/') {
      continue;
    }
    const previous = value[index - 1];
    if (
      previous !== undefined &&
      isIdentifierContinueBefore(value, index)
    ) {
      continue;
    }

    let slashRunEnd = index + 1;
    while (value[slashRunEnd] === '/') {
      slashRunEnd += 1;
    }
    const isExactMissionCommand =
      slashRunEnd === index + 1 &&
      (index === 0 || /\s/u.test(previous ?? '')) &&
      value.startsWith('mission', slashRunEnd) &&
      (value[slashRunEnd + 'mission'.length] === undefined ||
        /\s/u.test(value[slashRunEnd + 'mission'.length] ?? ''));
    if (!isExactMissionCommand) {
      return true;
    }
    index = slashRunEnd + 'mission'.length - 1;
  }
  return false;
}

function isIdentifierContinueBefore(
  value: string,
  index: number,
): boolean {
  if (index <= 0) {
    return false;
  }
  const trailingUnit = value.charCodeAt(index - 1);
  const codePointStart =
    trailingUnit >= 0xdc00 &&
    trailingUnit <= 0xdfff &&
    index >= 2 &&
    value.charCodeAt(index - 2) >= 0xd800 &&
    value.charCodeAt(index - 2) <= 0xdbff
      ? index - 2
      : index - 1;
  return IDENTIFIER_CONTINUE_PATTERN.test(
    value.slice(codePointStart, index),
  );
}

export function isSafePresentationText(
  value: unknown,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    !ABSOLUTE_DRIVE_PATH_PATTERN.test(value) &&
    !UNC_PATH_PATTERN.test(value) &&
    !HOME_PATH_PATTERN.test(value) &&
    !containsUnsafePosixPath(value) &&
    !URL_PATTERN.test(value) &&
    !containsCredentialAssignment(value)
  );
}
