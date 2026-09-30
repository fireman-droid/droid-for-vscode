import { describe, expect, it } from 'vitest';
import { ModelProvider, ReasoningEffort, type ModelInfo } from '@factory/droid-sdk';
import { projectModelCatalog } from './projections';

describe('official model catalog projection', () => {
  it('projects builtin, custom, disabled and image capabilities from the official catalog', () => {
    const models: ModelInfo[] = [
      { ...availableModel('model-sol', 'Model Sol', [ReasoningEffort.Low, ReasoningEffort.High]), noImageSupport: true },
      { ...availableModel('custom:model-pro', 'Model Pro', [ReasoningEffort.None]), supportsImageGeneration: true },
      { ...availableModel('retired', 'Retired', []), disabled: true, disabledReason: 'Account policy' },
    ];
    expect(projectModelCatalog(models)).toEqual([
        { id: 'model-sol', displayName: 'Model Sol', supportedReasoningEfforts: ['low', 'high'],
          defaultReasoningEffort: 'low', isCustom: false, supportsImages: false, supportsImageGeneration: false, disabled: false },
        { id: 'custom:model-pro', displayName: 'Model Pro', supportedReasoningEfforts: ['none'],
          defaultReasoningEffort: 'none', isCustom: true, supportsImages: true, supportsImageGeneration: true, disabled: false },
        { id: 'retired', displayName: 'Retired', supportedReasoningEfforts: [], defaultReasoningEffort: 'medium',
          isCustom: false, supportsImages: true, supportsImageGeneration: false, disabled: true, disabledReason: 'Account policy' },
      ],
    );
  });

});

function availableModel(id: string, displayName: string, efforts: ReasoningEffort[]): ModelInfo {
  return { id, displayName, shortDisplayName: displayName, modelProvider: ModelProvider.FACTORY,
    supportedReasoningEfforts: efforts, defaultReasoningEffort: efforts[0] ?? ReasoningEffort.Medium,
    isCustom: id.startsWith('custom:') };
}
