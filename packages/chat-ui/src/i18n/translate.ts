import { messages } from './messages';
import type { UiLocale } from './locale';

export type TranslationParams = Readonly<Record<string, string | number>>;
export type MessageTranslations = readonly [english: string, simplified: string, traditional: string];

/** Only explicitly marked interface copy is translated; content and code stay verbatim. */
export function translate(locale: UiLocale, message: string, params?: TranslationParams): string {
  const entry: MessageTranslations | undefined = messages[message];
  const text = entry?.[locale === 'zh-CN' ? 1 : locale === 'zh-TW' ? 2 : 0] ?? message;
  return params ? text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match) : text;
}
