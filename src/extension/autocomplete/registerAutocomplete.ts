import * as vscode from 'vscode';
import { AutocompleteProvider } from './AutocompleteProvider';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, configureCompletion,
  readCompletionSettings, setCompletionEnabled,
} from './settings';

export function registerAutocomplete(context: vscode.ExtensionContext): void {
  const provider = new AutocompleteProvider(context.secrets);
  const status = vscode.window.createStatusBarItem(
    'droidvisx.autocomplete', vscode.StatusBarAlignment.Right, 10,
  );
  status.name = 'Droid Autocomplete';
  status.command = 'droidvisx.autocomplete.menu';
  const refresh = () => {
    const document = vscode.window.activeTextEditor?.document;
    const settings = readCompletionSettings(document?.uri);
    if (!document || !settings.enabled) {
      status.hide();
      return;
    }
    const blocked = completionDocumentBlockReason(document, settings);
    status.text = provider.isLoading ? '$(loading~spin) Droid Tab'
      : provider.lastMessage ? '$(warning) Droid Tab'
        : blocked ? '$(circle-slash) Droid Tab' : '$(sparkle) Droid Tab';
    status.tooltip = provider.lastMessage ?? blocked ??
      'Droid autocomplete · ' + settings.model + '\nTab accepts a suggestion. Click for options.';
    status.show();
  };
  const configure = async () => {
    if (!await configureCompletion(context.secrets)) return;
    provider.reset();
    const enabled = await vscode.window.showInformationMessage(
      'Autocomplete is configured. Enable it to send the active file’s cursor context to ' +
        new URL(readCompletionSettings().endpoint).host + '?',
      'Enable autocomplete',
    );
    if (enabled) await setCompletionEnabled(true);
    refresh();
  };
  const toggle = async () => {
    const settings = readCompletionSettings(vscode.window.activeTextEditor?.document.uri);
    if (settings.enabled) {
      await setCompletionEnabled(false);
    } else {
      const answer = await vscode.window.showInformationMessage(
        'Enable Droid autocomplete? Cursor context will be sent to your configured FIM provider.',
        'Enable autocomplete', 'Configure first',
      );
      if (answer === 'Configure first') await configure();
      if (answer === 'Enable autocomplete') await setCompletionEnabled(true);
    }
    refresh();
  };
  const trigger = async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) return;
    const settings = readCompletionSettings(document.uri);
    const blocked = !settings.enabled ? 'Enable Droid autocomplete first.'
      : completionDocumentBlockReason(document, settings);
    if (blocked) {
      await vscode.window.showInformationMessage(blocked);
      return;
    }
    provider.reset();
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  };
  // Report errors at the UI boundary without printing secrets or provider response bodies.
  const guarded = (action: () => Promise<unknown>) => async () => {
    try { await action(); }
    catch {
      await vscode.window.showErrorMessage(
        'Droid autocomplete could not complete this action. Check editor settings and SecretStorage access.',
      );
    }
  };
  const invalidateDisplayedSuggestion = guarded(async () => {
    // Internal cancellation cannot retract an item already owned by the editor.
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
    refresh();
  });
  const menu = async () => {
    const selection = await vscode.window.showQuickPick([
      { label: '$(gear) Configure model and API key', id: 'configure' },
      { label: readCompletionSettings(vscode.window.activeTextEditor?.document.uri).enabled
        ? '$(debug-pause) Pause autocomplete' : '$(play) Enable autocomplete', id: 'toggle' },
      { label: '$(refresh) Request suggestion / retry', id: 'trigger' },
      { label: '$(settings-gear) Open autocomplete settings', id: 'settings' },
    ], {
      title: 'Droid autocomplete',
      placeHolder: provider.lastMessage ?? 'Tab accepts a suggestion; Esc dismisses it.',
    });
    if (selection?.id === 'configure') await configure();
    if (selection?.id === 'toggle') await toggle();
    if (selection?.id === 'trigger') await trigger();
    if (selection?.id === 'settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', COMPLETION_SECTION);
    }
  };
  context.subscriptions.push(
    provider, status,
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }], provider,
    ),
    provider.onDidChangeState(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(COMPLETION_SECTION) ||
          event.affectsConfiguration('editor.inlineSuggest.enabled')) {
        void invalidateDisplayedSuggestion();
      }
    }),
    context.secrets.onDidChange((event) => {
      if (event.key.startsWith('droidvisx.autocomplete.')) void invalidateDisplayedSuggestion();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(refresh),
    vscode.commands.registerCommand('droidvisx.autocomplete.configure', guarded(configure)),
    vscode.commands.registerCommand('droidvisx.autocomplete.toggle', guarded(toggle)),
    vscode.commands.registerCommand('droidvisx.autocomplete.trigger', guarded(trigger)),
    vscode.commands.registerCommand('droidvisx.autocomplete.menu', guarded(menu)),
  );
  refresh();
}
