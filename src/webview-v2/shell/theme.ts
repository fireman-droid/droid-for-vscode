import { useEffect } from 'react';
import type { ThemePreference } from '../../shared/protocol/shell';
import { useThemeController } from '../../webview/assistant/shell/theme';

export function useWebviewTheme(persistPreference: (preference: ThemePreference) => void) {
  const controller = useThemeController(persistPreference);
  useEffect(() => {
    applyTheme(controller.context.preference, controller.resolved);
  }, [controller.context.preference, controller.resolved]);
  return controller;
}

export function applyTheme(preference: ThemePreference, resolved: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  // Host boot markup still uses this contract during the parallel migration.
  root.dataset.dvxTheme = resolved;
  root.dataset.dvxThemePreference = preference;
}

export function applyBootTheme(): void {
  const root = document.documentElement;
  const preference = root.dataset.dvxThemePreference;
  applyTheme(
    preference === 'light' || preference === 'dark' ? preference : 'auto',
    root.dataset.dvxTheme === 'light' ? 'light' : 'dark',
  );
}
