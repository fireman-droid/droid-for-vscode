import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  configurationListener: undefined as ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined,
  secretListener: undefined as ((event: { key: string }) => void) | undefined,
  invalidationListener: undefined as (() => void) | undefined,
  commands: new Map<string, () => Promise<void>>(),
  executeCommand: vi.fn(),
  updateConfiguration: vi.fn(),
  status: { hide: vi.fn(), show: vi.fn(), dispose: vi.fn() },
}));

vi.mock('vscode', () => ({
  env: { appName: 'Visual Studio Code' },
  extensions: { getExtension: () => undefined },
  StatusBarAlignment: { Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: {
    activeTextEditor: { document: { uri: { scheme: 'file' } } },
    createStatusBarItem: () => mocks.status,
    onDidChangeActiveTextEditor: () => ({ dispose: vi.fn() }),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  workspace: {
    isTrusted: true,
    onDidChangeConfiguration: (listener: typeof mocks.configurationListener) => {
      mocks.configurationListener = listener;
      return { dispose: vi.fn() };
    },
    onDidGrantWorkspaceTrust: () => ({ dispose: vi.fn() }),
    getConfiguration: (section: string) => ({
      get: (key: string, fallback: unknown) => section === 'editor' ? true : mocks.config[key] ?? fallback,
      inspect: (key: string) => ({ globalValue: mocks.config[key] }),
      update: mocks.updateConfiguration,
    }),
  },
  languages: {
    match: () => 0,
    registerInlineCompletionItemProvider: () => ({ dispose: vi.fn() }),
  },
  commands: {
    executeCommand: mocks.executeCommand,
    registerCommand: (name: string, action: () => Promise<void>) => {
      mocks.commands.set(name, action);
      return { dispose: vi.fn() };
    },
  },
}));

vi.mock('./AutocompleteProvider', () => ({
  AutocompleteProvider: class {
    isLoading = false;
    lastMessage = undefined;
    onDidChangeState() { return { dispose: vi.fn() }; }
    onDidInvalidateSuggestion(listener: () => void) {
      mocks.invalidationListener = listener;
      return { dispose: vi.fn() };
    }
    warmNextEdit() {}
    reset() {}
    dispose() {}
  },
}));

import { registerAutocomplete } from './registerAutocomplete';

function emitConfigurationChange(changed: string) {
  mocks.configurationListener?.({
    affectsConfiguration: (section) => changed === section || changed.startsWith(section + '.'),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commands.clear();
  mocks.configurationListener = undefined;
  mocks.secretListener = undefined;
  mocks.invalidationListener = undefined;
  mocks.config = { enabled: true, excludePatterns: [] };
  mocks.executeCommand.mockResolvedValue(undefined);
  // VS Code emits the configuration event after the persisted value changes.
  mocks.updateConfiguration.mockImplementation(async (key: string, value: unknown) => {
    mocks.config[key] = value;
    emitConfigurationChange('droidvisx.autocomplete.' + key);
  });
  registerAutocomplete({
    subscriptions: [],
    secrets: {
      onDidChange: (listener: typeof mocks.secretListener) => {
        mocks.secretListener = listener;
        return { dispose: vi.fn() };
      },
    },
  } as unknown as vscode.ExtensionContext);
});

describe('registered autocomplete suggestion invalidation', () => {
  it('retracts an editor-owned suggestion when the user pauses autocomplete', async () => {
    await mocks.commands.get('droidvisx.autocomplete.toggle')?.();
    expect(mocks.updateConfiguration).toHaveBeenCalledWith('enabled', false, 1);
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('editor.action.inlineSuggest.hide');
    expect(mocks.status.show).toHaveBeenCalled();
  });

  it.each([
    'droidvisx.autocomplete.endpoint',
    'droidvisx.autocomplete.model',
    'droidvisx.autocomplete.excludePatterns',
    'editor.inlineSuggest.enabled',
  ])('retracts a displayed suggestion after changing %s', async (setting) => {
    emitConfigurationChange(setting);
    await Promise.resolve();
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('editor.action.inlineSuggest.hide');
  });

  it('retracts a displayed suggestion when its completion credential changes', async () => {
    mocks.secretListener?.({ key: 'droidvisx.autocomplete.key.synthetic' });
    await Promise.resolve();
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('editor.action.inlineSuggest.hide');
  });

  it('does not interrupt a suggestion for unrelated settings or credentials', async () => {
    emitConfigurationChange('editor.fontSize');
    emitConfigurationChange('droidvisx.runtime.mode');
    mocks.secretListener?.({ key: 'droidvisx.customModelProvider.synthetic' });
    await Promise.resolve();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('hides the native editor-owned suggestion after provider context invalidation', async () => {
    expect(mocks.invalidationListener).toBeTypeOf('function');
    mocks.invalidationListener?.();
    await Promise.resolve();
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('editor.action.inlineSuggest.hide');
  });
});
