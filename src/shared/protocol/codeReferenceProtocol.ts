import { readCodeReference, type CodeReference, CODE_REFERENCE_LIMIT } from '@droidvisx/chat-ui/chat/codeReferences';
import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export type CodeReferenceRequest =
  { readonly type: 'codeReference.resolve'; readonly requestId: string; readonly markers: readonly string[]; readonly text: string } |
  { readonly type: 'codeReference.open'; readonly reference: CodeReference };
export interface CodeReferenceResult { readonly type: 'codeReference.result'; readonly requestId: string; readonly reference: CodeReference | null }

export function parseCodeReferenceRequest(value: unknown): CodeReferenceRequest | null {
  if (!isStrictRecord(value)) return null;
  if (value.type === 'codeReference.open' && hasExactKeys(value, ['type', 'reference'])) {
    const reference = readCodeReference(value.reference);
    return reference ? { type: value.type, reference } : null;
  }
  return value.type === 'codeReference.resolve' && hasExactKeys(value, ['type', 'requestId', 'markers', 'text']) &&
    typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 96 &&
    typeof value.text === 'string' && value.text.length <= CODE_REFERENCE_LIMIT &&
    Array.isArray(value.markers) && value.markers.length > 0 && value.markers.length <= 8 &&
    value.markers.every(marker => typeof marker === 'string' && /^application\/vnd\.droid\.copy\.[a-f0-9-]{36}$/.test(marker))
    ? value as unknown as CodeReferenceRequest : null;
}
export function parseCodeReferenceResult(value: unknown): CodeReferenceResult | null {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'requestId', 'reference']) || value.type !== 'codeReference.result' || typeof value.requestId !== 'string') return null;
  const reference = value.reference === null ? null : readCodeReference(value.reference);
  return reference || value.reference === null ? { type: value.type, requestId: value.requestId, reference } : null;
}
