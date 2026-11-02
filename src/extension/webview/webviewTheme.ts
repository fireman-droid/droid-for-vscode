import * as vscode from 'vscode';

import { type ThemePreference } from '../../shared/protocol/shell';
import type { WebviewBootTheme } from './webviewHtml';

export function readWebviewThemePreference(): ThemePreference {
  const value = vscode.workspace
    .getConfiguration('droidvisx')
    .get<string>('theme', 'auto');
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export const CHAT_STARFIELD_SETTING = 'chat.starfield';

export function readChatStarfieldEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration('droidvisx')
      .get<boolean>(CHAT_STARFIELD_SETTING, true) !== false
  );
}

export function readWebviewBootTheme(): WebviewBootTheme {
  const preference = readWebviewThemePreference();
  const starfield = readChatStarfieldEnabled();
  if (preference !== 'auto') {
    return {
      preference,
      resolved: preference,
      ...(starfield ? {} : { starfield: false }),
    };
  }
  const kind = vscode.window.activeColorTheme.kind;
  const resolved =
    kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
      ? 'dark'
      : 'light';
  return {
    preference,
    resolved,
    ...(starfield ? {} : { starfield: false }),
  };
}
