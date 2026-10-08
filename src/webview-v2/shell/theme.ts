import { useEffect } from 'react';
import type { ThemePreference } from '../../shared/protocol/shell';
import { useThemeController } from './themeController';

let themeRevision = 0;

export function useWebviewTheme(persistPreference: (preference: ThemePreference) => void) {
  const controller = useThemeController(persistPreference);
  useEffect(() => {
    applyTheme(controller.context.preference, controller.resolved);
  }, [controller.context.preference, controller.resolved]);
  return controller;
}

export function applyTheme(preference: ThemePreference, resolved: 'light' | 'dark'): void {
  const root = document.documentElement;
  const revision = ++themeRevision;
  const changed = root.dataset.theme !== resolved || root.dataset.themePreference !== preference;
  const update = (): void => {
    // A newer selection can arrive before the browser has captured the old frame.
    if (revision !== themeRevision) return;
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    // Keep the Host boot attributes in sync with the shared UI theme attributes.
    root.dataset.dvxTheme = resolved;
    root.dataset.dvxThemePreference = preference;
  };
  if (root.dataset.theme && changed && !document.hidden && document.startViewTransition
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const transition = document.startViewTransition(update);
    // The browser may skip the animation while still applying the DOM update.
    void transition.ready.catch(() => undefined);
    // Both reject on a failed update; handle both and report that failure once.
    void Promise.all([transition.updateCallbackDone, transition.finished]).catch((error: unknown) => {
      console.error('Failed to apply the webview theme.', error);
    });
  } else {
    update();
  }
}

export function applyBootTheme(): void {
  const root = document.documentElement;
  const preference = root.dataset.dvxThemePreference;
  applyTheme(
    preference === 'light' || preference === 'dark' ? preference : 'auto',
    root.dataset.dvxTheme === 'light' ? 'light' : 'dark',
  );
}
