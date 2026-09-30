import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isId } from '../validation/guards';

export const MAX_SYSTEM_PROMPT_LENGTH = 32_000;
export type SystemPromptPreference =
  | { readonly mode: 'default' }
  | { readonly mode: 'append' | 'replace'; readonly text: string };
export type SessionSystemPrompt = string | { readonly type: 'preset'; readonly preset: 'droid'; readonly append: string };
export type SystemPromptRequest =
  | { readonly type: 'systemPrompt.read'; readonly requestId: string }
  | { readonly type: 'systemPrompt.save'; readonly requestId: string; readonly preference: SystemPromptPreference };
export interface SystemPromptResponse {
  readonly type: 'systemPrompt.state';
  readonly sequence: number;
  readonly requestId: string;
  readonly preference: SystemPromptPreference;
  readonly error: string | null;
}

export function parseSystemPromptPreference(value: unknown): SystemPromptPreference | undefined {
  if (!isStrictRecord(value)) return undefined;
  if (value.mode === 'default' && hasExactKeys(value, ['mode'])) return { mode: 'default' };
  if ((value.mode === 'append' || value.mode === 'replace') && hasExactKeys(value, ['mode', 'text']) &&
    typeof value.text === 'string' && value.text.trim().length > 0 && value.text.length <= MAX_SYSTEM_PROMPT_LENGTH && !value.text.includes('\0')) {
    return { mode: value.mode, text: value.text };
  }
  return undefined;
}

export function toSessionSystemPrompt(preference: SystemPromptPreference): SessionSystemPrompt | undefined {
  if (preference.mode === 'default') return undefined;
  return preference.mode === 'replace' ? preference.text : { type: 'preset', preset: 'droid', append: preference.text };
}

export function parseSystemPromptRequest(value: unknown): SystemPromptRequest | undefined {
  if (!isStrictRecord(value) || !isId(value.requestId)) return undefined;
  if (value.type === 'systemPrompt.read' && hasExactKeys(value, ['type', 'requestId'])) return { type: value.type, requestId: value.requestId };
  if (value.type === 'systemPrompt.save' && hasExactKeys(value, ['type', 'requestId', 'preference'])) {
    const preference = parseSystemPromptPreference(value.preference);
    if (preference) return { type: value.type, requestId: value.requestId, preference };
  }
  return undefined;
}

export function parseSystemPromptResponse(value: unknown): SystemPromptResponse | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'sequence', 'requestId', 'preference', 'error']) ||
    value.type !== 'systemPrompt.state' || !isId(value.requestId) || !Number.isSafeInteger(value.sequence) ||
    typeof value.sequence !== 'number' || value.sequence < 0 ||
    !(value.error === null || (typeof value.error === 'string' && value.error.length <= 1024))) return undefined;
  const preference = parseSystemPromptPreference(value.preference);
  return preference ? { type: value.type, sequence: value.sequence, requestId: value.requestId, preference, error: value.error } : undefined;
}
