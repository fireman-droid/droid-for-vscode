import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type TranslationParams } from './translate';
import type { UiLocale } from './locale';

export type Translate = (message: string, params?: TranslationParams) => string;
const defaultValue = { locale: 'en' as UiLocale, t: ((message, params) => translate('en', message, params)) as Translate };
const I18nContext = createContext(defaultValue);

/** Locale changes update consumers without remounting editors or clearing drafts. */
export function I18nProvider({ locale, children }: { readonly locale: UiLocale; readonly children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: ((message, params) => translate(locale, message, params)) as Translate }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
export { translate } from './translate';
export { UI_LOCALES, isUiLocale, resolveUiLocale, type UiLocale, type LanguagePreference } from './locale';
