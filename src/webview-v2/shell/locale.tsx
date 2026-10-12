import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18nProvider, isUiLocale } from '@droidvisx/chat-ui/i18n';
import { isLanguagePreference, parseUiLocale, type UiLocaleMessage, type UiLocaleRead } from '../../shared/protocol/localeProtocol';

const LocaleState = createContext<UiLocaleMessage>({ type: 'ui.locale', preference: 'auto', resolved: 'en' });
export function useWebviewLocale() { return useContext(LocaleState); }

export function WebviewLocaleProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<UiLocaleMessage>(() => {
    const root = document.documentElement;
    return { type: 'ui.locale', preference: isLanguagePreference(root.dataset.dvxLanguage) ? root.dataset.dvxLanguage : 'auto',
      resolved: isUiLocale(root.lang) ? root.lang : 'en' };
  });
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const message = parseUiLocale(event.data);
      if (message) setState(previous => previous.preference === message.preference && previous.resolved === message.resolved ? previous : message);
    };
    window.addEventListener('message', receive);
    (globalThis as { __dvxApi?: { postMessage(message: UiLocaleRead): void } }).__dvxApi?.postMessage({ type: 'ui.locale.read' });
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { document.documentElement.lang = state.resolved; document.documentElement.dataset.dvxLanguage = state.preference; }, [state]);
  return <LocaleState.Provider value={state}><I18nProvider locale={state.resolved}>{children}</I18nProvider></LocaleState.Provider>;
}
