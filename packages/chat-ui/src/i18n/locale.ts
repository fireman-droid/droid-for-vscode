export const UI_LOCALES = ['en', 'zh-CN', 'zh-TW'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export type LanguagePreference = 'auto' | UiLocale;

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);
}

export function resolveUiLocale(preference: LanguagePreference, editorLanguage: string): UiLocale {
  if (preference !== 'auto') return preference;
  const language = editorLanguage.toLowerCase().replaceAll('_', '-');
  if (/^zh(?:-|$)/.test(language)) {
    return /(?:^|-)(?:hant|tw|hk|mo)(?:-|$)/.test(language) ? 'zh-TW' : 'zh-CN';
  }
  return 'en';
}
