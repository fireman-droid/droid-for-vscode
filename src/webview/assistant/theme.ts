import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { ThemePreference } from '../../shared/bridgeMessages';

/** The theme actually painted ('auto' resolved against the editor). */
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  /** Optimistically applies and asks the host to persist. */
  readonly onPreferenceChange: (preference: ThemePreference) => void;
}

/**
 * Theme state provided by App; consumed by the settings popover row.
 * The default keeps harness pages (no provider value changes) on the
 * warm light baseline.
 */
export const ThemeContext = createContext<ThemeContextValue>({
  preference: 'auto',
  resolved: 'light',
  onPreferenceChange: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Preference stamped into the boot HTML by the host
 * (`data-dvx-theme-preference` on <html>), so the shell resolves the
 * correct theme before the first `ui.theme` push arrives. Harness
 * pages carry no attribute and fall back to 'auto'.
 */
export function readBootThemePreference(): ThemePreference {
  const value = document.documentElement.dataset.dvxThemePreference;
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** Host-resolved first-frame theme stamped beside the preference. */
export function readBootResolvedTheme(): ResolvedTheme {
  return document.documentElement.dataset.dvxTheme === 'dark'
    ? 'dark'
    : 'light';
}

/**
 * Whether the editor currently runs a dark theme, read from the
 * classes VS Code maintains on the webview body (vscode-dark /
 * vscode-high-contrast; the light high-contrast variant carries
 * vscode-high-contrast-light alongside). Harness pages have neither
 * class and read as light.
 */
export function isEditorDark(body: Element = document.body): boolean {
  const classes = body.classList;
  return (
    classes.contains('vscode-dark') ||
    (classes.contains('vscode-high-contrast') &&
      !classes.contains('vscode-high-contrast-light'))
  );
}

export function resolveTheme(
  preference: ThemePreference,
  editorDark: boolean,
): ResolvedTheme {
  if (preference === 'auto') {
    return editorDark ? 'dark' : 'light';
  }
  return preference;
}

/**
 * Mirrors the resolved theme onto <html>. The page grounds
 * (html/body/#root) and the portalled overlays (lightbox, slash
 * tooltip) live outside `.dvx-shell`, so their theming is keyed off
 * this attribute (theme design doc §2.1).
 */
export function applyDocumentTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.dvxTheme = theme;
}

/**
 * App-side theme wiring: both preference and resolved appearance boot
 * from host-stamped HTML and then track authoritative `ui.theme`
 * pushes. The Host listens to VS Code's color-theme event, avoiding
 * reliance on webview body-class mutation timing for Auto.
 */
export function useThemeController(
  persistPreference: (preference: ThemePreference) => void,
): {
  readonly context: ThemeContextValue;
  readonly resolved: ResolvedTheme;
  readonly applyHostTheme: (
    preference: ThemePreference,
    resolved: ResolvedTheme,
  ) => void;
} {
  const [preference, setPreference] = useState<ThemePreference>(
    readBootThemePreference,
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(
    readBootResolvedTheme,
  );
  useEffect(() => {
    applyDocumentTheme(resolved);
  }, [resolved]);
  const onPreferenceChange = useCallback(
    (next: ThemePreference): void => {
      // Optimistic: the host persists and echoes back via ui.theme.
      setPreference(next);
      setResolved(resolveTheme(next, isEditorDark()));
      persistPreference(next);
    },
    [persistPreference],
  );
  const applyHostTheme = useCallback(
    (nextPreference: ThemePreference, nextResolved: ResolvedTheme): void => {
      setPreference(nextPreference);
      setResolved(nextResolved);
    },
    [],
  );
  const context = useMemo(
    () => ({ preference, resolved, onPreferenceChange }),
    [onPreferenceChange, preference, resolved],
  );
  return { context, resolved, applyHostTheme };
}
