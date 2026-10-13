import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { ChatController } from '../chat/ChatController';
import type { ModelCatalogItem, ConfirmedSessionSettings } from '../../shared/protocol/settings';
import { ManagementSettingsService } from '../management/managementSettings';
import { ReviewQuestionHost } from './ReviewQuestionHost';
import { resolveReviewQuestionSelection } from './reviewQuestionSettings';

const mock = vi.hoisted(() => ({ values: new Map<string, unknown>(), ask: vi.fn(), dispose: vi.fn() }));
vi.mock('vscode', () => ({ ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => ({
  get: (key: string, fallback: unknown) => mock.values.get(key) ?? fallback,
  update: async (key: string, value: unknown) => { mock.values.set(key, value); },
}) } }));
vi.mock('../../runtime/btw/BtwSidecar', () => ({ createBtwSidecar: async () => ({ ask: mock.ask, dispose: mock.dispose }) }));

const alpha: ModelCatalogItem = { id: 'alpha', displayName: 'Alpha', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low',
  isCustom: false, supportsImages: false, supportsImageGeneration: false, disabled: false };
const beta: ModelCatalogItem = { ...alpha, id: 'beta', displayName: 'Beta', supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' };
const main: ConfirmedSessionSettings = { modelId: 'alpha', reasoningEffort: 'high', interactionMode: 'auto', autonomyLevel: 'low', specModeModelId: null, specModeReasoningEffort: null };
const models = [alpha, beta];
function service() {
  return new ManagementSettingsService({} as vscode.SecretStorage, 'test', () => ({ cwd: null, connection: 'connected', ide: 'connected', sessionManagementAvailable: true }),
    () => models.map(model => ({ id: model.id, label: model.displayName, reasoning: model.supportedReasoningEfforts, defaultReasoning: model.defaultReasoningEffort })), () => main.modelId);
}
beforeEach(() => {
  mock.values.clear(); mock.ask.mockReset(); mock.dispose.mockReset().mockResolvedValue(undefined);
  mock.ask.mockImplementation(async function* () { yield { kind: 'done' }; });
});

describe('review question model and reasoning selection', () => {
  it('saves the SDK-supported effort and passes it to the sidecar request without changing the main chat', async () => {
    await service().saveQuestionModel('alpha', 'high');
    const controller = { metadata: { modelCatalog: { status: 'ready', items: models }, settings: { value: main } }, modelAvailability: { assertEnabled: vi.fn().mockResolvedValue(undefined) } } as unknown as ChatController;
    const host = new ReviewQuestionHost(controller, vi.fn());
    expect(host.handle({ type: 'reviewQuestion.ask', sessionId: 'session-1', questionId: 'question-1', text: 'Explain this code',
      selection: { path: 'src/app.ts', side: 'after', startLine: 1, endLine: 1, text: 'return 1;', context: '+ return 1;' } }, { sessionId: 'session-1', root: '/repo' })).toBe(true);
    await vi.waitFor(() => expect(mock.ask).toHaveBeenCalledWith(expect.stringContaining('Explain this code'), { modelId: 'alpha', reasoningEffort: 'high' }));
    expect(main.reasoningEffort).toBe('high');
    host.reset();
  });
  it('clears the previous effort on model changes and uses the next model SDK default', async () => {
    await service().saveQuestionModel('alpha', 'high');
    await service().saveQuestionModel('beta');
    expect(resolveReviewQuestionSelection(models, main)).toEqual({ modelId: 'beta', reasoningEffort: 'medium' });
    expect(mock.values.get('reviewQuestion.reasoningEffort')).toBe('');
  });
  it('rejects unsupported levels before saving and rejects a level removed from the SDK catalog before sending', async () => {
    await service().saveQuestionModel('alpha', 'high');
    await expect(service().saveQuestionModel('beta', 'high')).rejects.toThrow('不支持');
    expect(mock.values.get('reviewQuestion.modelId')).toBe('alpha');
    expect(() => resolveReviewQuestionSelection([{ ...alpha, supportedReasoningEfforts: ['low'] }], main)).toThrow('reasoning level is unavailable');
  });
  it('keeps following the main chat when no separate model or effort is configured', async () => {
    await service().saveQuestionModel(null);
    expect(resolveReviewQuestionSelection(models, main)).toEqual({ modelId: 'alpha', reasoningEffort: 'high' });
  });
});
