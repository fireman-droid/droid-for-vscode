import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';

export const UI_LANGUAGES = ['en', 'zh-CN', 'zh-TW'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export type LanguagePreference = 'auto' | UiLanguage;
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || typeof value === 'string' && (UI_LANGUAGES as readonly string[]).includes(value);
}
export interface UiLocaleMessage {
  readonly type: 'ui.locale';
  readonly preference: LanguagePreference;
  readonly resolved: UiLanguage;
}
export interface UiLocaleRead { readonly type: 'ui.locale.read' }
export function parseUiLocale(value: unknown): UiLocaleMessage | undefined {
  return isStrictRecord(value) && hasExactKeys(value, ['type', 'preference', 'resolved']) && value.type === 'ui.locale'
    && isLanguagePreference(value.preference) && value.resolved !== 'auto' && isLanguagePreference(value.resolved)
    ? value as unknown as UiLocaleMessage : undefined;
}
export function isUiLocaleRead(value: unknown): value is UiLocaleRead {
  return isStrictRecord(value) && value.type === 'ui.locale.read' && hasExactKeys(value, ['type']);
}
