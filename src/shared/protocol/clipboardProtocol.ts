import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const MAX_CLIPBOARD_TEXT_LENGTH = 2_000_000;
export interface ClipboardWrite {
  readonly type: 'clipboard.write';
  readonly requestId: string;
  readonly text: string;
}
export interface ClipboardResult {
  readonly type: 'clipboard.result';
  readonly requestId: string;
  readonly ok: boolean;
}
export function parseClipboardWrite(value: unknown): ClipboardWrite | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'requestId', 'text']) ||
    value.type !== 'clipboard.write' || typeof value.requestId !== 'string' ||
    value.requestId.length === 0 || value.requestId.length > 96 ||
    typeof value.text !== 'string' || value.text.length > MAX_CLIPBOARD_TEXT_LENGTH) return undefined;
  return { type: value.type, requestId: value.requestId, text: value.text };
}
export function parseClipboardResult(value: unknown): ClipboardResult | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'requestId', 'ok']) ||
    value.type !== 'clipboard.result' || typeof value.requestId !== 'string' ||
    typeof value.ok !== 'boolean') return undefined;
  return { type: value.type, requestId: value.requestId, ok: value.ok };
}
