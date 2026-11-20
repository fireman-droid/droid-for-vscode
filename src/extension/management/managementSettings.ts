import * as vscode from 'vscode';
import { readBusyMessageMode } from '../chat/queue/busyMessageSettings';
import type { CompletionPreferences, ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import {
  COMPLETION_SECTION, clearLegacyFimSwitch, completionNeedsKey, completionSecretKey,
  readCompletionKey, readCompletionSettings, validateCompletionEndpoint,
} from '../autocomplete/settings';
import { readChatStarfieldEnabled, readWebviewBootTheme, readWebviewThemePreference } from '../webview/webviewTheme';
import { readReviewQuestionModel, readReviewQuestionEffort, REVIEW_QUESTION_MODEL_SETTING, REVIEW_QUESTION_EFFORT_SETTING } from '../review/reviewQuestionSettings';
import type { SessionReasoningEffort } from '../../shared/protocol/settings';
import { OperationOutcomeError } from '../diagnostics/operationDiagnostics';

export class ManagementSettingsService {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly version: string,
    private readonly status: () => Pick<ManagementSettings, 'cwd' | 'connection' | 'ide' | 'sessionManagementAvailable'>,
    private readonly questionModels: () => ManagementSettings['reviewQuestion']['models'] | Promise<ManagementSettings['reviewQuestion']['models']>,
    private readonly mainModel: () => string | null = () => null) {}

  async read(): Promise<ManagementSettings> {
    const status = this.status();
    const settings = readCompletionSettings(status.cwd ? vscode.Uri.file(status.cwd) : undefined);
    const { enabled, endpoint, protocol, model, debounceMs, relatedFiles } = settings;
    const hasKey = !validateCompletionEndpoint(endpoint, protocol) && Boolean(await readCompletionKey(this.secrets, endpoint));
    return {
      busyMessageMode: readBusyMessageMode(),
      starfield: readChatStarfieldEnabled(),
      ...status, theme: readWebviewThemePreference(), resolvedTheme: readWebviewBootTheme().resolved, version: this.version,
      completionHasKey: hasKey,
      reviewQuestion: { modelId: readReviewQuestionModel(), reasoningEffort: readReviewQuestionEffort(), inheritedModelId: this.mainModel(), models: await this.questionModels() },
      completion: {
        enabled, endpoint, protocol, model, debounceMs, relatedFiles, autoTrigger: settings.autoTrigger !== false,
        adaptiveDebounce: settings.adaptiveDebounce !== false,
      },
    };
  }

  async saveQuestionModel(modelId: string | null, reasoningEffort: SessionReasoningEffort | null = null): Promise<void> {
    const models = await this.questionModels();
    if (modelId !== null && !models.some(model => model.id === modelId))
      throw new Error('此模型已不可用，请刷新设置后重新选择。');
    const model = models.find(item => item.id === (modelId ?? this.mainModel()));
    if (reasoningEffort !== null && !model?.reasoning?.includes(reasoningEffort))
      throw new Error('此模型不支持所选推理强度，请重新选择。');
    // Clear the previous model's effort before changing models, then apply the validated selection.
    await vscode.workspace.getConfiguration('droidvisx').update(REVIEW_QUESTION_EFFORT_SETTING, '', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('droidvisx').update(REVIEW_QUESTION_MODEL_SETTING, modelId ?? '', vscode.ConfigurationTarget.Global);
    if (reasoningEffort !== null) await vscode.workspace.getConfiguration('droidvisx').update(REVIEW_QUESTION_EFFORT_SETTING, reasoningEffort, vscode.ConfigurationTarget.Global);
  }

  async save(preferences: CompletionPreferences, setApiKey: boolean): Promise<void> {
    const { enabled, protocol } = preferences;
    const endpoint = preferences.endpoint.trim();
    const model = preferences.model.trim();
    const invalid = validateCompletionEndpoint(endpoint, protocol);
    if (invalid) throw new Error(invalid);
    if (enabled && !vscode.workspace.isTrusted) throw new Error('请先信任当前工作区，再启用智能补全。');
    const key = await this.requestKey(endpoint, enabled, setApiKey);
    if (key) await this.secrets.store(completionSecretKey(endpoint), key);
    const cwd = this.status().cwd;
    const uri = cwd ? vscode.Uri.file(cwd) : undefined;
    const config = vscode.workspace.getConfiguration(COMPLETION_SECTION, uri);
    const current = readCompletionSettings(uri);
    const configureProvider = !current.requiresConfiguration || enabled || setApiKey
      || endpoint !== current.endpoint || model !== current.model || protocol !== current.protocol;
    // Reuse the effective setting's scope; service routing is always user-level.
    const update = async (key: keyof CompletionPreferences, value: string | boolean | number) => {
      const global = key === 'endpoint' || key === 'model' || key === 'protocol';
      const inspected = config.inspect(key);
      const target = !global && inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : !global && inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      const current = global ? inspected?.globalValue : config.get(key);
      if (current !== value) await config.update(key, value, target);
    };
    if (!enabled && configureProvider) await update('enabled', false);
    await update('autoTrigger', preferences.autoTrigger);
    await update('relatedFiles', preferences.relatedFiles);
    await update('adaptiveDebounce', preferences.adaptiveDebounce);
    await update('debounceMs', preferences.debounceMs);
    if (configureProvider) {
      await update('model', model);
      await update('endpoint', endpoint);
      await update('protocol', protocol);
      await clearLegacyFimSwitch(config);
    }
    if (enabled) await update('enabled', true);
  }

  private async requestKey(endpoint: string, enabled: boolean, setKey: boolean): Promise<string | undefined> {
    if (!setKey && !enabled) return undefined;
    const existing = await readCompletionKey(this.secrets, endpoint);
    if (setKey) {
      const key = await vscode.window.showInputBox({
        title: 'Droid · 代码续写 API Key', password: true, ignoreFocusOut: true,
        prompt: existing ? '留空保留已保存密钥。' : '密钥保存在编辑器 SecretStorage 中。',
        validateInput: value => value.trim() || existing || !completionNeedsKey(endpoint) ? undefined : '请输入 API Key。',
      });
      if (key === undefined) throw new OperationOutcomeError('已取消，补全设置未保存。', { outcome: 'cancelled', failureKind: 'cancelled' });
      return key.trim() || undefined;
    } else if (enabled && completionNeedsKey(endpoint) && !existing) {
      throw new Error('代码续写尚未配置密钥，请先设置 API Key。');
    }
    return undefined;
  }
}
