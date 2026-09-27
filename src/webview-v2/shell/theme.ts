import { useEffect } from 'react';
import type { ThemePreference } from '../../shared/protocol/shell';
import { useThemeController } from './themeController';

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
  // Keep the Host boot attributes in sync with the shared UI theme attributes.
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
