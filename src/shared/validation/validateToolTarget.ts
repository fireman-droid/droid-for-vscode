import { MAX_TOOL_TARGET_LENGTH } from '../protocol/bounds';

const FORBIDDEN_TARGET_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/** Exact optional Bridge field validator for input-derived tool context. */
export function isValidToolTarget(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_TOOL_TARGET_LENGTH &&
      !FORBIDDEN_TARGET_CHARACTERS.test(value))
  );
}
