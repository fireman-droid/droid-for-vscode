import * as vscode from 'vscode';
import path from 'node:path';
import { configureParserAssets } from './kilo/continuedev/core/util/treeSitter';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { AutocompleteProvider } from './AutocompleteProvider';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, configureCompletion, mercuryAlternateEndpoint, removeCompletionKey, switchMercuryMode,
  readCompletionSettings, setCompletionEnabled, setRelatedFilesEnabled, setAutoTriggerEnabled, setCompletionSnooze,
} from './settings';

export function registerAutocomplete(context: vscode.ExtensionContext, diagnostics?: RuntimeDiagnosticSink): void {
  if (context.extensionPath) configureParserAssets(path.join(context.extensionPath, 'dist/extension/autocomplete'));
  const provider = new AutocompleteProvider(context.secrets, diagnostics);
  const status = vscode.window.createStatusBarItem(
    'droidvisx.autocomplete', vscode.StatusBarAlignment.Right, 10,
  );
  status.name = 'Droid Autocomplete';
  status.command = 'droidvisx.autocomplete.menu';
  const providerNotice = () => {
    if (/cursor/i.test(vscode.env.appName)) return 'Cursor Tab may also provide suggestions. Choose the provider you want in its settings.';
    const document = vscode.window.activeTextEditor?.document;
    const enabled = vscode.workspace.getConfiguration('github.copilot', document?.uri).get<Record<string, boolean>>('enable');
    if (vscode.extensions.getExtension('GitHub.copilot')?.isActive &&
        enabled?.[document?.languageId ?? ''] !== false && enabled?.['*'] !== false) {
      return 'GitHub Copilot is active. Another provider may take priority over Droid suggestions.';
    }
    return undefined;
  };
  let snoozeTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    const document = vscode.window.activeTextEditor?.document;
    const settings = readCompletionSettings(document?.uri);
    provider.warmNextEdit();
    if (snoozeTimer) clearTimeout(snoozeTimer);
    const snoozed = settings.enabled && (settings.snoozeUntil ?? 0) > Date.now();
    if (snoozed) snoozeTimer = setTimeout(refresh, Math.min(2_147_483_647, settings.snoozeUntil! - Date.now() + 1));
    if (!document) {
      status.hide();
      return;
    }
    const blocked = completionDocumentBlockReason(document, settings);
    status.text = !settings.enabled || snoozed || settings.autoTrigger === false ? '$(debug-pause) Droid Tab' : provider.isLoading ? '$(loading~spin) Droid Tab'
      : provider.lastMessage ? '$(warning) Droid Tab'
        : blocked ? '$(circle-slash) Droid Tab' : '$(sparkle) Droid Tab';
    status.tooltip = !settings.enabled ? 'Droid autocomplete is off. Click to enable or configure.'
      : snoozed ? 'Automatic suggestions paused until ' + new Date(settings.snoozeUntil!).toLocaleTimeString() + '. Manual requests remain available.'
        : settings.autoTrigger === false ? 'Automatic suggestions are off. Use Droid: Request Code Completion to request one.'
          : provider.lastMessage ?? blocked ??
      (settings.protocol === 'mercury-edit' ? 'Droid Next Edit · ' : 'Droid autocomplete · ') + settings.model + '\n' +
      (settings.relatedFiles ? provider.lastContextFileCount + ' related files found' : 'Current file only') +
      (provider.lastLatencyMs === undefined ? '' : ' · ' + provider.lastLatencyMs + ' ms') +
      '\nTab accepts a suggestion. Click for options.' + (providerNotice() ? '\n' + providerNotice() : '');
    status.show();
  };
  const configure = async () => {
    if (!await configureCompletion(context.secrets)) return;
    provider.reset();
    const enabled = await vscode.window.showInformationMessage(
      'Autocomplete is configured. Enable it to send cursor context and relevant workspace snippets to ' +
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
        'Enable Droid autocomplete? Cursor context and relevant workspace snippets will be sent to your configured provider.',
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
  const removeKey = async () => {
    const answer = await vscode.window.showWarningMessage(
      'Remove the saved autocomplete API key? For Inception this clears both Code Completion and Next Edit.', { modal: true }, 'Remove API key',
    );
    if (answer === 'Remove API key') {
      await removeCompletionKey(context.secrets, readCompletionSettings().endpoint);
    }
  };
  const menu = async () => {
    const settings = readCompletionSettings(vscode.window.activeTextEditor?.document.uri);
    const selection = await vscode.window.showQuickPick([
      { label: '$(gear) Configure model and API key', id: 'configure' },
      ...(mercuryAlternateEndpoint(settings.endpoint) && settings.model.toLowerCase().includes('mercury')
        ? [{ label: settings.protocol === 'mercury-edit'
          ? '$(code) Switch to Mercury Code Completion' : '$(edit) Switch to Mercury Next Edit', id: 'mode' }] : []),
      { label: readCompletionSettings(vscode.window.activeTextEditor?.document.uri).enabled
        ? '$(debug-pause) Pause autocomplete' : '$(play) Enable autocomplete', id: 'toggle' },
      { label: settings.autoTrigger === false ? '$(play) Turn automatic suggestions on' : '$(hand) Use manual suggestions only', id: 'automatic' },
      ...((settings.snoozeUntil ?? 0) > Date.now()
        ? [{ label: '$(play) Resume automatic suggestions', id: 'resume' }]
        : [{ label: '$(clock) Snooze automatic suggestions', id: 'snooze' }]),
      { label: '$(refresh) Request suggestion / retry', id: 'trigger' },
      { label: readCompletionSettings(vscode.window.activeTextEditor?.document.uri).relatedFiles
        ? '$(check) Related workspace files: on' : 'Related workspace files: off', id: 'context' },
      { label: '$(settings-gear) Open autocomplete settings', id: 'settings' },
      { label: '$(key) Remove saved API key', id: 'removeKey' },
    ], {
      title: 'Droid autocomplete',
      placeHolder: provider.lastMessage ?? providerNotice() ?? 'Tab accepts a suggestion; Esc dismisses it.',
    });
    if (selection?.id === 'configure') await configure();
    if (selection?.id === 'mode') { await switchMercuryMode(); provider.reset(); refresh(); }
    if (selection?.id === 'toggle') await toggle();
    if (selection?.id === 'automatic') await setAutoTriggerEnabled(settings.autoTrigger === false);
    if (selection?.id === 'resume') { await setCompletionSnooze(0); refresh(); }
    if (selection?.id === 'snooze') {
      const duration = await vscode.window.showQuickPick([5, 15, 60].map(minutes => ({ label: minutes + ' minutes', minutes })),
        { title: 'Pause automatic suggestions', placeHolder: 'Suggestions resume automatically. Manual requests still work.' });
      if (duration) { await setCompletionSnooze(duration.minutes); refresh(); }
    }
    if (selection?.id === 'trigger') await trigger();
    if (selection?.id === 'removeKey') await removeKey();
    if (selection?.id === 'context') {
      await setRelatedFilesEnabled(!readCompletionSettings(vscode.window.activeTextEditor?.document.uri).relatedFiles);
    }
    if (selection?.id === 'settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', COMPLETION_SECTION);
    }
  };
  context.subscriptions.push(
    provider, status, { dispose: () => { if (snoozeTimer) clearTimeout(snoozeTimer); } },
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-notebook-cell' }], provider,
    ),
    provider.onDidChangeState(refresh),
    provider.onDidInvalidateSuggestion(() => { void invalidateDisplayedSuggestion(); }),
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
    vscode.commands.registerCommand('droidvisx.autocomplete.nextEdit.acceptOrJump', guarded(() => provider.acceptOrJumpNextEdit())),
    vscode.commands.registerCommand('droidvisx.autocomplete.nextEdit.dismiss', () => provider.dismissNextEdit()),
    vscode.commands.registerCommand('droidvisx.autocomplete.nextEdit.accepted', () => {
      diagnostics?.record({ level: 'debug', name: 'autocomplete.next-edit.accepted', attributes: {} });
      provider.nextEditAccepted();
    }),
    vscode.commands.registerCommand('droidvisx.autocomplete.accepted', () => {
      diagnostics?.record({ level: 'debug', name: 'autocomplete.accepted', attributes: {} });
    }),
  );
  refresh();
}
