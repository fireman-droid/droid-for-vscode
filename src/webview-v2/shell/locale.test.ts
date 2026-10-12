import { describe, expect, it } from 'vitest';
import { resolveUiLocale, UI_LOCALES } from '@droidvisx/chat-ui/i18n/locale';
import { translate } from '@droidvisx/chat-ui/i18n/translate';
import { messageEntries } from '@droidvisx/chat-ui/i18n/messages';
import { isUiLocaleRead, parseUiLocale } from '../../shared/protocol/localeProtocol';
import { parseManagementRequest } from '../../shared/protocol/managementPageProtocol';

describe('interface language', () => {
  it.each([
    ['en-US', 'en'], ['zh-cn', 'zh-CN'], ['zh-Hans', 'zh-CN'], ['zh', 'zh-CN'],
    ['zh-tw', 'zh-TW'], ['zh-Hant-HK', 'zh-TW'], ['zh_HK', 'zh-TW'], ['zh-MO', 'zh-TW'],
    ['de', 'en'], ['', 'en'],
  ] as const)('follows editor language %s as %s', (editor, expected) => {
    expect(resolveUiLocale('auto', editor)).toBe(expected);
  });

  it('honors explicit preferences and accepts only supported bridge values', () => {
    for (const locale of UI_LOCALES) {
      expect(resolveUiLocale(locale, 'ja')).toBe(locale);
      expect(parseUiLocale({ type: 'ui.locale', preference: locale, resolved: locale })?.resolved).toBe(locale);
      expect(parseManagementRequest({ type: 'management.request', version: 1, requestId: 'language',
        action: { kind: 'language.set', language: locale } })).toBeDefined();
    }
    expect(parseUiLocale({ type: 'ui.locale', preference: 'auto', resolved: 'xx' })).toBeUndefined();
    expect(parseUiLocale({ type: 'ui.locale', preference: 'zh-CN', resolved: 'zh-CN', extra: true })).toBeUndefined();
    expect(parseManagementRequest({ type: 'management.request', version: 1, requestId: 'language',
      action: { kind: 'language.set', language: 'unsupported' } })).toBeUndefined();
    expect(isUiLocaleRead({ type: 'ui.locale.read' })).toBe(true);
    expect(isUiLocaleRead({ type: 'ui.locale.read', language: 'xx' })).toBe(false);
  });

  it('keeps complete translations and matching interpolation parameters in every locale', () => {
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [english, simplified, traditional] of messageEntries) {
      expect(simplified.trim(), english).not.toBe('');
      expect(traditional.trim(), english).not.toBe('');
      expect(parameters(simplified), english).toEqual(parameters(english));
      expect(parameters(traditional), english).toEqual(parameters(english));
      expect(traditional, english).not.toContain('\uFFFD');
    }
    expect(translate('zh-TW', '{count} files changed', { count: 3 })).toBe('已修改 3 個檔案');
    expect(translate('en', 'No catalog entry: model output')).toBe('No catalog entry: model output');
    expect(translate('zh-CN', 'Open diff for {path}', { path: 'src/{value}.ts' })).toBe('打开 src/{value}.ts 的差异');
  });
});
