import * as vscode from 'vscode';
import type { CompletionPreferences, ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import {
  COMPLETION_SECTION, completionNeedsKey, completionSecretKey, mercuryAlternateEndpoint,
  readCompletionKey, readCompletionSettings, validateCompletionEndpoint,
} from '../autocomplete/settings';
import { readWebviewBootTheme, readWebviewThemePreference } from '../webview/webviewTheme';
import { readReviewQuestionModel, readReviewQuestionEffort, REVIEW_QUESTION_MODEL_SETTING, REVIEW_QUESTION_EFFORT_SETTING } from '../review/reviewQuestionSettings';
import type { SessionReasoningEffort } from '../../shared/protocol/settings';

export class ManagementSettingsService {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly version: string,
    private readonly status: () => Pick<ManagementSettings, 'cwd' | 'connection' | 'ide' | 'sessionManagementAvailable'>,
    private readonly questionModels: () => ManagementSettings['reviewQuestion']['models'],
    private readonly mainModel: () => string | null = () => null) {}

  async read(): Promise<ManagementSettings> {
    const status = this.status();
    const settings = readCompletionSettings(status.cwd ? vscode.Uri.file(status.cwd) : undefined);
    let hasKey = false;
    if (!validateCompletionEndpoint(settings.endpoint, settings.protocol)) hasKey = Boolean(await readCompletionKey(this.secrets, settings.endpoint));
    return {
      ...status, theme: readWebviewThemePreference(), resolvedTheme: readWebviewBootTheme().resolved, version: this.version,
      completionHasKey: hasKey,
      reviewQuestion: { modelId: readReviewQuestionModel(), reasoningEffort: readReviewQuestionEffort(), inheritedModelId: this.mainModel(), models: this.questionModels() },
      completion: {
        enabled: settings.enabled, autoTrigger: settings.autoTrigger !== false, relatedFiles: settings.relatedFiles,
        adaptiveDebounce: settings.adaptiveDebounce !== false, debounceMs: settings.debounceMs,
        protocol: settings.protocol, endpoint: settings.endpoint, model: settings.model,
      },
    };
  }

  async saveQuestionModel(modelId: string | null, reasoningEffort: SessionReasoningEffort | null = null): Promise<void> {
    if (modelId !== null && !this.questionModels().some(model => model.id === modelId))
      throw new Error('此模型已不可用，请刷新设置后重新选择。');
    const model = this.questionModels().find(item => item.id === (modelId ?? this.mainModel()));
    if (reasoningEffort !== null && !model?.reasoning?.includes(reasoningEffort))
      throw new Error('此模型不支持所选推理强度，请重新选择。');
    // Clear the previous model's effort before changing models, then apply the validated selection.
    await vscode.workspace.getConfiguration('droidvisx').update(REVIEW_QUESTION_EFFORT_SETTING, '', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('droidvisx').update(REVIEW_QUESTION_MODEL_SETTING, modelId ?? '', vscode.ConfigurationTarget.Global);
    if (reasoningEffort !== null) await vscode.workspace.getConfiguration('droidvisx').update(REVIEW_QUESTION_EFFORT_SETTING, reasoningEffort, vscode.ConfigurationTarget.Global);
  }

  async save(preferences: CompletionPreferences, setApiKey: boolean): Promise<void> {
    const invalid = validateCompletionEndpoint(preferences.endpoint, preferences.protocol);
    if (invalid) throw new Error(invalid);
    if (preferences.enabled && !vscode.workspace.isTrusted) throw new Error('请先信任当前工作区，再启用智能补全。');
    const endpoint = preferences.endpoint.trim();
    const existing = await readCompletionKey(this.secrets, endpoint);
    if (setApiKey) {
      const key = await vscode.window.showInputBox({
        title: 'Droid · 智能补全 API Key', password: true, ignoreFocusOut: true,
        prompt: existing ? '留空保留已保存密钥。' : '密钥保存在编辑器 SecretStorage 中。',
        validateInput: value => value.trim() || existing || !completionNeedsKey(endpoint) ? undefined : '请输入 API Key。',
      });
      if (key === undefined) throw new Error('已取消，补全设置未保存。');
      if (key.trim()) {
        await this.secrets.store(completionSecretKey(endpoint), key.trim());
        const alternate = mercuryAlternateEndpoint(endpoint);
        if (alternate) await this.secrets.store(completionSecretKey(alternate), key.trim());
      }
    } else if (preferences.enabled && completionNeedsKey(endpoint) && !existing) {
      throw new Error('此服务尚未配置密钥，请勾选设置 API Key。');
    }
    const cwd = this.status().cwd;
    const config = vscode.workspace.getConfiguration(COMPLETION_SECTION, cwd ? vscode.Uri.file(cwd) : undefined);
    // Reuse the effective setting's scope; service routing is always user-level.
    for (const key of ['endpoint', 'model', 'protocol', 'autoTrigger', 'relatedFiles', 'adaptiveDebounce', 'debounceMs', 'enabled'] as const) {
      const global = key === 'endpoint' || key === 'model' || key === 'protocol';
      const inspected = config.inspect(key);
      const target = !global && inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : !global && inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      const value = typeof preferences[key] === 'string' ? preferences[key].trim() : preferences[key];
      const current = global ? inspected?.globalValue : config.get(key);
      if (current !== value) await config.update(key, value, target);
    }
  }
}
