import { MAX_TURN_TEXT_LENGTH } from './bounds';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isId } from '../validation/guards';

/** Counts returned by Droid's native rewind, independent of successor attachment. */
export interface RewindFileResult {
  readonly restoredCount: number;
  readonly deletedCount: number;
  readonly failedRestoreCount: number;
  readonly failedDeleteCount: number;
}

export interface RewindResultMessage {
  readonly type: 'rewind.result';
  readonly sequence: number;
  readonly sessionId: string;
  readonly messageId: string;
  readonly files?: RewindFileResult;
  /** Present when the successor was adopted but automatic resend was stopped. */
  readonly unsentText?: string;
}

const counts = ['restoredCount', 'deletedCount', 'failedRestoreCount', 'failedDeleteCount'] as const;
export function isRewindFileResult(value: unknown): value is RewindFileResult {
  return isStrictRecord(value) && hasExactKeys(value, counts) &&
    counts.every((key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0);
}

export function rewindFilesIncomplete(files: RewindFileResult | undefined): boolean {
  return files === undefined || files.failedRestoreCount > 0 || files.failedDeleteCount > 0;
}

export function rewindResultNotice(files: RewindFileResult | undefined): string {
  return files === undefined ? 'Droid rewound the conversation but did not confirm the file restoration result.' :
    `Droid restored ${files.restoredCount} file(s) and deleted ${files.deletedCount} newly created file(s).` +
    (files.failedRestoreCount + files.failedDeleteCount > 0
      ? ` ${files.failedRestoreCount} restore(s) and ${files.failedDeleteCount} deletion(s) failed.` : '');
}

export function parseRewindResult(value: unknown): RewindResultMessage | undefined {
  if (!isStrictRecord(value) || value.type !== 'rewind.result' ||
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'messageId'], ['files', 'unsentText']) ||
    typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
    !isId(value.sessionId) || !isId(value.messageId) ||
    value.files !== undefined && !isRewindFileResult(value.files) ||
    value.unsentText !== undefined && (typeof value.unsentText !== 'string' || value.unsentText.length > MAX_TURN_TEXT_LENGTH)) return;
  return value as unknown as RewindResultMessage;
}
