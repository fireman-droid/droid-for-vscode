import * as vscode from 'vscode';

import type { ThemePreference } from '../shared/bridgeMessages';
import type { WebviewBootTheme } from './webviewHtml';

export function readWebviewThemePreference(): ThemePreference {
  const value = vscode.workspace
    .getConfiguration('droidvisx')
    .get<string>('theme', 'auto');
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function readWebviewBootTheme(): WebviewBootTheme {
  const preference = readWebviewThemePreference();
  if (preference !== 'auto') {
    return { preference, resolved: preference };
  }
  const kind = vscode.window.activeColorTheme.kind;
  const resolved =
    kind === vscode.ColorThemeKind.Dark ||
    kind === vscode.ColorThemeKind.HighContrast
      ? 'dark'
      : 'light';
  return { preference, resolved };
}
