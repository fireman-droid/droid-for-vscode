// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyDocumentTheme,
  isEditorDark,
  readBootThemePreference,
  resolveTheme,
} from './theme';

afterEach(() => {
  delete document.documentElement.dataset.dvxTheme;
  delete document.documentElement.dataset.dvxThemePreference;
  document.body.className = '';
});

describe('resolveTheme', () => {
  it('pins explicit preferences and follows the editor on auto', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('auto', true)).toBe('dark');
  });
});

describe('isEditorDark', () => {
  it('maps the VS Code body classes, HC-light included', () => {
    expect(isEditorDark()).toBe(false);
    document.body.className = 'vscode-light';
    expect(isEditorDark()).toBe(false);
    document.body.className = 'vscode-dark';
    expect(isEditorDark()).toBe(true);
    document.body.className = 'vscode-high-contrast';
    expect(isEditorDark()).toBe(true);
    document.body.className =
      'vscode-high-contrast vscode-high-contrast-light';
    expect(isEditorDark()).toBe(false);
  });
});

describe('boot handoff', () => {
  it('reads the host-stamped preference, defaulting to auto', () => {
    expect(readBootThemePreference()).toBe('auto');
    document.documentElement.dataset.dvxThemePreference = 'dark';
    expect(readBootThemePreference()).toBe('dark');
    document.documentElement.dataset.dvxThemePreference = 'weird';
    expect(readBootThemePreference()).toBe('auto');
  });

  it('mirrors the resolved theme onto <html> for page grounds', () => {
    applyDocumentTheme('dark');
    expect(document.documentElement.dataset.dvxTheme).toBe('dark');
    applyDocumentTheme('light');
    expect(document.documentElement.dataset.dvxTheme).toBe('light');
  });
});
