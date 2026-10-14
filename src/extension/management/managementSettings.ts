import * as vscode from 'vscode';
import type { CompletionPreferences, ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import {
  COMPLETION_SECTION, DEFAULT_ENDPOINT, completionNeedsKey, completionSecretKey, mercuryAlternateEndpoint,
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
    const legacyEdit = settings.protocol === 'mercury-edit';
    const endpoint = legacyEdit ? mercuryAlternateEndpoint(settings.endpoint) ?? DEFAULT_ENDPOINT : settings.endpoint;
    const protocol = settings.protocol === 'mercury-edit' ? 'fim' : settings.protocol;
    const nextEdit = settings.nextEdit!;
    let hasKey = false;
    if (!validateCompletionEndpoint(endpoint, protocol)) hasKey = Boolean(await readCompletionKey(this.secrets, endpoint));
    const nextEditHasKey = !validateCompletionEndpoint(nextEdit.endpoint, 'mercury-edit') && Boolean(await readCompletionKey(this.secrets, nextEdit.endpoint));
    return {
      ...status, theme: readWebviewThemePreference(), resolvedTheme: readWebviewBootTheme().resolved, version: this.version,
      completionHasKey: hasKey, nextEditHasKey,
      reviewQuestion: { modelId: readReviewQuestionModel(), reasoningEffort: readReviewQuestionEffort(), inheritedModelId: this.mainModel(), models: this.questionModels() },
      completion: {
        enabled: settings.enabled, autoTrigger: settings.autoTrigger !== false, relatedFiles: settings.relatedFiles,
        adaptiveDebounce: settings.adaptiveDebounce !== false, debounceMs: settings.debounceMs,
        fimEnabled: settings.fimEnabled !== false, nextEdit,
        protocol, endpoint, model: legacyEdit && endpoint === DEFAULT_ENDPOINT ? 'codestral-latest' : settings.model,
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

  async save(preferences: CompletionPreferences, setApiKey: boolean, setNextEditApiKey = false): Promise<void> {
    const invalid = validateCompletionEndpoint(preferences.endpoint, preferences.protocol)
      ?? validateCompletionEndpoint(preferences.nextEdit.endpoint, 'mercury-edit');
    if (invalid) throw new Error(invalid);
    if (preferences.enabled && !vscode.workspace.isTrusted) throw new Error('请先信任当前工作区，再启用智能补全。');
    if (preferences.enabled && !preferences.fimEnabled && !preferences.nextEdit.enabled) throw new Error('请至少启用代码续写或下一步编辑。');
    // Collect both keys before writing: cancelling either prompt leaves configuration intact.
    const services = [
      { endpoint: preferences.endpoint.trim(), enabled: preferences.enabled && preferences.fimEnabled, setKey: setApiKey, label: '代码续写' },
      { endpoint: preferences.nextEdit.endpoint.trim(), enabled: preferences.enabled && preferences.nextEdit.enabled, setKey: setNextEditApiKey, label: 'Next Edit' },
    ];
    const keys: { endpoint: string; value: string }[] = [];
    for (const service of services) {
      const shared = keys.find(key => key.endpoint === service.endpoint || mercuryAlternateEndpoint(key.endpoint) === service.endpoint)?.value;
      const value = await this.requestKey(service, shared);
      if (value) keys.push({ endpoint: service.endpoint, value });
    }
    for (const { endpoint, value } of keys) {
      await this.secrets.store(completionSecretKey(endpoint), value);
      const alternate = mercuryAlternateEndpoint(endpoint);
      if (alternate) await this.secrets.store(completionSecretKey(alternate), value);
    }
    const cwd = this.status().cwd;
    const config = vscode.workspace.getConfiguration(COMPLETION_SECTION, cwd ? vscode.Uri.file(cwd) : undefined);
    // Reuse the effective setting's scope; service routing is always user-level.
    const { nextEdit, ...base } = preferences;
    const values = { ...base, 'nextEdit.endpoint': nextEdit.endpoint.trim(),
      'nextEdit.model': nextEdit.model.trim(), 'nextEdit.enabled': nextEdit.enabled };
    for (const [key, raw] of Object.entries(values)) {
      const global = ['endpoint', 'model', 'protocol', 'fimEnabled'].includes(key) || key.startsWith('nextEdit.');
      const inspected = config.inspect(key);
      const target = !global && inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : !global && inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      const value = typeof raw === 'string' ? raw.trim() : raw;
      const current = global ? inspected?.globalValue : config.get(key);
      if (current !== value) await config.update(key, value, target);
    }
  }

  private async requestKey({ endpoint, enabled, setKey, label }: { endpoint: string; enabled: boolean; setKey: boolean; label: string }, shared?: string): Promise<string | undefined> {
    const existing = shared ?? await readCompletionKey(this.secrets, endpoint);
    if (setKey) {
      const key = await vscode.window.showInputBox({
        title: `Droid · ${label} API Key`, password: true, ignoreFocusOut: true,
        prompt: existing ? '留空保留已保存密钥。' : '密钥保存在编辑器 SecretStorage 中。',
        validateInput: value => value.trim() || existing || !completionNeedsKey(endpoint) ? undefined : '请输入 API Key。',
      });
      if (key === undefined) throw new Error('已取消，补全设置未保存。');
      return key.trim() || undefined;
    } else if (enabled && completionNeedsKey(endpoint) && !existing) {
      throw new Error(`${label}尚未配置密钥，请勾选设置 API Key。`);
    }
    return undefined;
  }
}
