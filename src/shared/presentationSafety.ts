const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ABSOLUTE_DRIVE_PATH_PATTERN = /[A-Za-z]:[\\/]/u;
const UNC_PATH_PATTERN = /\\\\[^\\/\s]+[\\/][^\\/\s]+/u;
const HOME_PATH_PATTERN = /~[\\/][^\s()[\]{}]+/u;
const POSIX_PATH_PATTERN =
  /(?:^|[^\p{L}\p{N}_])\/(?:[^/\\\s()[\]{}]+\/)+[^/\\\s()[\]{}]+/u;
const COMMON_POSIX_ROOT_PATTERN =
  /(?:^|[^\p{L}\p{N}_])\/(?:Users|home|var|tmp|etc|usr|opt|srv|root|mnt|media|private|Volumes)(?:[\\/]|(?=$|[^\p{L}\p{N}_]))/u;
const URL_PATTERN = /(?:https?|wss?|file):\/\//iu;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /(?:api[-_]?(?:key|token)|secret|token|passwd|password|credential|authorization|access[-_]?(?:key|token)|client[-_]?secret)["']?\s*[:=]\s*"?[^\s"'`,;&]+/iu;

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
    !POSIX_PATH_PATTERN.test(value) &&
    !COMMON_POSIX_ROOT_PATTERN.test(value) &&
    !URL_PATTERN.test(value) &&
    !CREDENTIAL_ASSIGNMENT_PATTERN.test(value)
  );
}
