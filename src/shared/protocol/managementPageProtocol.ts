import { hasExactKeys, isStrictRecord } from '../validation/strictValidation';
import { isSafeModelId } from '../validation/guards';
import { isLanguagePreference, type LanguagePreference } from './localeProtocol';
import { SESSION_REASONING_EFFORTS } from './bounds';
import type { SessionReasoningEffort } from './settings';
import { isBusyMessageMode, type BusyMessageMode } from './queueProtocol';
import type { MissionControlCatalogRow } from './missionControlPanelProtocol';
import { isDefaultsPatch, isManagementDefaults, type DefaultsScope, type DefaultValues, type ManagementDefaults } from './managementDefaultsProtocol';
import { isFactoryAccountState, type FactoryAccountState } from './factoryAccountProtocol';

export const MANAGEMENT_VERSION = 1 as const;
export const MANAGEMENT_PAGES = ['general', 'models', 'completion', 'sessions', 'missions'] as const;
export type ManagementPage = (typeof MANAGEMENT_PAGES)[number];
export function isManagementPage(value: unknown): value is ManagementPage {
  return typeof value === 'string' && (MANAGEMENT_PAGES as readonly string[]).includes(value);
}
export interface ManagementPageOpenMessage { readonly type: 'management.open'; readonly page: ManagementPage }
export function parseManagementPageOpen(value: unknown): ManagementPageOpenMessage | undefined {
  return isStrictRecord(value) && hasExactKeys(value, ['type', 'page']) && value.type === 'management.open' && isManagementPage(value.page)
    ? { type: 'management.open', page: value.page } : undefined;
}

export interface CompletionPreferences {
  readonly enabled: boolean;
  readonly fimEnabled: boolean;
  readonly nextEdit: { readonly enabled: boolean; readonly endpoint: string; readonly model: string };
  readonly autoTrigger: boolean;
  readonly relatedFiles: boolean;
  readonly adaptiveDebounce: boolean;
  readonly debounceMs: number;
  readonly protocol: 'fim' | 'ollama' | 'siliconflow-fim';
  readonly endpoint: string;
  readonly model: string;
}
export interface ManagementSettings {
  readonly busyMessageMode?: BusyMessageMode;
  readonly theme: 'auto' | 'light' | 'dark';
  readonly resolvedTheme: 'light' | 'dark';
  readonly version: string;
  readonly cwd: string | null;
  readonly connection: string;
  readonly ide: string;
  readonly completion: CompletionPreferences;
  readonly completionHasKey: boolean;
  readonly nextEditHasKey: boolean;
  readonly sessionManagementAvailable: boolean;
  readonly reviewQuestion: {
    readonly modelId: string | null;
    readonly reasoningEffort?: SessionReasoningEffort | null;
    readonly inheritedModelId?: string | null;
    readonly models: readonly { readonly id: string; readonly label: string;
      readonly reasoning?: readonly SessionReasoningEffort[]; readonly defaultReasoning?: SessionReasoningEffort; readonly isCustom?: boolean }[];
  };
}
export interface ManagedSession {
  readonly id: string;
  readonly title: string;
  readonly cwd: string;
  readonly kind: 'chat' | 'exec';
  readonly modifiedTime: string;
  readonly messageCount: number;
  readonly favorite: boolean;
  readonly archived: boolean;
  readonly currentFolder: boolean;
  readonly active: boolean;
}
export type ManagementAction =
  | { readonly kind: 'ready' | 'settings.read' | 'defaults.read' | 'missions.list' | 'missions.new' | 'chat.focus' }
  | { readonly kind: 'account.read'; readonly force: boolean }
  | { readonly kind: 'defaults.save'; readonly scope: DefaultsScope; readonly patch: DefaultValues }
  | { readonly kind: 'theme.set'; readonly theme: ManagementSettings['theme'] }
  | { readonly kind: 'chat.busyMessageMode.set'; readonly mode: BusyMessageMode }
  | { readonly kind: 'language.set'; readonly language: LanguagePreference }
  | { readonly kind: 'reviewQuestion.model.set'; readonly modelId: string | null; readonly reasoningEffort?: SessionReasoningEffort | null }
  | { readonly kind: 'completion.save'; readonly preferences: CompletionPreferences; readonly setApiKey: boolean; readonly setNextEditApiKey: boolean }
  | { readonly kind: 'sessions.list'; readonly scope: 'folder' | 'all'; readonly cursor?: number }
  | { readonly kind: 'session.view' | 'session.export' | 'session.folder' | 'session.resume'; readonly id: string }
  | { readonly kind: 'session.favorite'; readonly id: string; readonly value: boolean }
  | { readonly kind: 'session.archive'; readonly id: string; readonly value: boolean }
  | { readonly kind: 'session.rename'; readonly id: string; readonly title: string }
  | { readonly kind: 'missions.open'; readonly id: string };
export interface ManagementRequest {
  readonly type: 'management.request';
  readonly version: typeof MANAGEMENT_VERSION;
  readonly requestId: string;
  readonly action: ManagementAction;
}
export interface ManagementResult {
  readonly type: 'management.result';
  readonly version: typeof MANAGEMENT_VERSION;
  readonly requestId: string;
  readonly ok: boolean;
  readonly message?: string;
  readonly settings?: ManagementSettings;
  readonly defaults?: ManagementDefaults;
  readonly sessions?: readonly ManagedSession[];
  readonly nextCursor?: number | null;
  readonly missions?: readonly MissionControlCatalogRow[];
  readonly account?: FactoryAccountState;
}
export type ManagementHostMessage = ManagementResult
  | { readonly type: 'management.navigate'; readonly version: typeof MANAGEMENT_VERSION; readonly page: ManagementPage }
  | { readonly type: 'management.settings'; readonly version: typeof MANAGEMENT_VERSION; readonly settings: ManagementSettings };

function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
export function isCompletionPreferences(value: unknown): value is CompletionPreferences {
  return isStrictRecord(value) && hasExactKeys(value, ['enabled', 'fimEnabled', 'nextEdit', 'autoTrigger', 'relatedFiles', 'adaptiveDebounce', 'debounceMs', 'protocol', 'endpoint', 'model'])
    && ['enabled', 'fimEnabled', 'autoTrigger', 'relatedFiles', 'adaptiveDebounce'].every(key => typeof value[key] === 'boolean')
    && isStrictRecord(value.nextEdit) && hasExactKeys(value.nextEdit, ['enabled', 'endpoint', 'model'])
    && typeof value.nextEdit.enabled === 'boolean' && text(value.nextEdit.endpoint, 2048) && text(value.nextEdit.model, 256)
    && typeof value.debounceMs === 'number' && Number.isInteger(value.debounceMs) && value.debounceMs >= 100 && value.debounceMs <= 2000
    && ['fim', 'ollama', 'siliconflow-fim'].includes(String(value.protocol))
    && text(value.endpoint, 2048) && text(value.model, 256);
}
export function parseManagementRequest(value: unknown): ManagementRequest | undefined {
  if (!isStrictRecord(value) || !hasExactKeys(value, ['type', 'version', 'requestId', 'action']) || value.type !== 'management.request'
    || value.version !== MANAGEMENT_VERSION || !text(value.requestId, 128) || !isStrictRecord(value.action)) return undefined;
  const a = value.action;
  let valid = false;
  if (['ready', 'settings.read', 'defaults.read', 'missions.list', 'missions.new', 'chat.focus'].includes(String(a.kind))) valid = hasExactKeys(a, ['kind']);
  else if (a.kind === 'defaults.save') valid = hasExactKeys(a, ['kind', 'scope', 'patch']) && isDefaultsPatch(a.patch, a.scope);
  else if (a.kind === 'account.read') valid = hasExactKeys(a, ['kind', 'force']) && typeof a.force === 'boolean';
  else if (a.kind === 'theme.set') valid = hasExactKeys(a, ['kind', 'theme']) && ['auto', 'light', 'dark'].includes(String(a.theme));
  else if (a.kind === 'chat.busyMessageMode.set') valid = hasExactKeys(a, ['kind', 'mode']) && isBusyMessageMode(a.mode);
  else if (a.kind === 'language.set') valid = hasExactKeys(a, ['kind', 'language']) && isLanguagePreference(a.language);
  else if (a.kind === 'reviewQuestion.model.set') valid = hasExactKeys(a, ['kind', 'modelId'], ['reasoningEffort']) && (a.modelId === null || isSafeModelId(a.modelId))
    && (a.reasoningEffort === undefined || a.reasoningEffort === null || SESSION_REASONING_EFFORTS.some(e => e === a.reasoningEffort));
  else if (a.kind === 'completion.save') valid = hasExactKeys(a, ['kind', 'preferences', 'setApiKey', 'setNextEditApiKey']) && isCompletionPreferences(a.preferences) && typeof a.setApiKey === 'boolean' && typeof a.setNextEditApiKey === 'boolean';
  else if (a.kind === 'sessions.list') valid = hasExactKeys(a, ['kind', 'scope'], ['cursor']) && (a.scope === 'all' || a.scope === 'folder')
    && (a.cursor === undefined || typeof a.cursor === 'number' && Number.isFinite(a.cursor) && a.cursor >= 0);
  else if (['session.view', 'session.export', 'session.folder', 'session.resume', 'missions.open'].includes(String(a.kind))) valid = hasExactKeys(a, ['kind', 'id']) && text(a.id);
  else if (a.kind === 'session.favorite' || a.kind === 'session.archive') valid = hasExactKeys(a, ['kind', 'id', 'value']) && text(a.id) && typeof a.value === 'boolean';
  else if (a.kind === 'session.rename') valid = hasExactKeys(a, ['kind', 'id', 'title']) && text(a.id) && text(a.title, 200);
  return valid ? value as unknown as ManagementRequest : undefined;
}

export function parseManagementHostMessage(value: unknown): ManagementHostMessage | undefined {
  if (!isStrictRecord(value) || value.version !== MANAGEMENT_VERSION) return undefined;
  if (value.type === 'management.navigate' && isManagementPage(value.page)) return value as unknown as ManagementHostMessage;
  const settings = (v: unknown): v is ManagementSettings => isStrictRecord(v) && isCompletionPreferences(v.completion)
    && (v.busyMessageMode === undefined || isBusyMessageMode(v.busyMessageMode))
    && ['auto', 'light', 'dark'].includes(String(v.theme)) && ['light', 'dark'].includes(String(v.resolvedTheme))
    && typeof v.version === 'string' && (v.cwd === null || typeof v.cwd === 'string')
    && typeof v.connection === 'string' && typeof v.ide === 'string' && typeof v.completionHasKey === 'boolean' && typeof v.nextEditHasKey === 'boolean' && typeof v.sessionManagementAvailable === 'boolean'
    && isStrictRecord(v.reviewQuestion) && (v.reviewQuestion.modelId === null || isSafeModelId(v.reviewQuestion.modelId))
    && (v.reviewQuestion.reasoningEffort === undefined || v.reviewQuestion.reasoningEffort === null || (SESSION_REASONING_EFFORTS as readonly unknown[]).includes(v.reviewQuestion.reasoningEffort))
    && (v.reviewQuestion.inheritedModelId === undefined || v.reviewQuestion.inheritedModelId === null || isSafeModelId(v.reviewQuestion.inheritedModelId))
    && Array.isArray(v.reviewQuestion.models) && v.reviewQuestion.models.every(model => isStrictRecord(model) && isSafeModelId(model.id) && text(model.label)
      && (model.reasoning === undefined || Array.isArray(model.reasoning) && model.reasoning.every(e => SESSION_REASONING_EFFORTS.includes(e)))
      && (model.defaultReasoning === undefined || SESSION_REASONING_EFFORTS.some(e => e === model.defaultReasoning))
      && (model.isCustom === undefined || typeof model.isCustom === 'boolean'));
  if (value.type === 'management.settings' && settings(value.settings)) return value as unknown as ManagementHostMessage;
  if (value.type !== 'management.result' || !text(value.requestId, 128) || typeof value.ok !== 'boolean') return undefined;
  if (value.settings !== undefined && !settings(value.settings)) return undefined;
  if (value.defaults !== undefined && !isManagementDefaults(value.defaults)) return undefined;
  if (value.message !== undefined && typeof value.message !== 'string') return undefined;
  if (value.nextCursor !== undefined && value.nextCursor !== null && (typeof value.nextCursor !== 'number' || !Number.isFinite(value.nextCursor))) return undefined;
  if (value.account !== undefined && !isFactoryAccountState(value.account)) return undefined;
  if (value.sessions !== undefined && (!Array.isArray(value.sessions) || !value.sessions.every(s => isStrictRecord(s)
    && text(s.id) && typeof s.title === 'string' && typeof s.cwd === 'string' && ['chat', 'exec'].includes(String(s.kind))
    && typeof s.modifiedTime === 'string' && typeof s.messageCount === 'number'
    && ['favorite', 'archived', 'currentFolder', 'active'].every(k => typeof s[k] === 'boolean')))) return undefined;
  if (value.missions !== undefined && (!Array.isArray(value.missions) || !value.missions.every(m => isStrictRecord(m)
    && typeof m.catalogId === 'string' && typeof m.title === 'string' && typeof m.lifecycle === 'string'
    && typeof m.workspaceLabel === 'string' && (m.progress === null || isStrictRecord(m.progress)
      && typeof m.progress.completed === 'number' && typeof m.progress.total === 'number')))) return undefined;
  return value as unknown as ManagementResult;
}
