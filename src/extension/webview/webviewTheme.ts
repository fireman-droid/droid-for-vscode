import * as vscode from 'vscode';

import {
  normalizeChatBackdrop,
  type ChatBackdropMode,
  type ChatBackdropSetting,
  type ThemePreference,
} from '../../shared/protocol/shell';
import type { WebviewBootTheme } from './webviewHtml';

export function readWebviewThemePreference(): ThemePreference {
  const value = vscode.workspace
    .getConfiguration('droidvisx')
    .get<string>('theme', 'auto');
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export const CHAT_STARFIELD_SETTING = 'chat.starfield';

export function readChatStarfieldEnabled(): ChatBackdropMode {
  const raw = vscode.workspace
    .getConfiguration('droidvisx')
    .get<ChatBackdropSetting>(CHAT_STARFIELD_SETTING, 'starfield');
  return normalizeChatBackdrop(raw);
}

export function readWebviewBootTheme(): WebviewBootTheme {
  const preference = readWebviewThemePreference();
  const starfield = readChatStarfieldEnabled();
  const backdropPatch =
    starfield === 'off'
      ? { starfield: false as const }
      : starfield === 'three-body'
        ? { starfield: 'three-body' as const }
        : {};
  if (preference !== 'auto') {
    return {
      preference,
      resolved: preference,
      ...backdropPatch,
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
    ...backdropPatch,
  };
}
