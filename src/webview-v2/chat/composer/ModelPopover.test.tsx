// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelCatalogItem, SessionSettingsState } from '../../../shared/protocol/settings';
import { ModelPopover } from './ModelPopover';

afterEach(cleanup);
const settings: SessionSettingsState = { status: 'ready', value: {
  modelId: 'builtin', interactionMode: 'auto', autonomyLevel: 'low', reasoningEffort: 'low',
  specModeModelId: null, specModeReasoningEffort: null,
} };
const builtin: ModelCatalogItem = {
  id: 'builtin', displayName: 'Built-in model', supportedReasoningEfforts: ['low', 'high'],
  defaultReasoningEffort: 'high', isCustom: false, supportsImages: false, supportsImageGeneration: false, disabled: false,
};

describe('model selection capabilities', () => {
  it('shows unavailable reasons and refuses disabled models in main and Spec selection', async () => {
    const user = userEvent.setup(), onUpdate = vi.fn();
    render(<ModelPopover id="models" settings={settings} disabled={false} onUpdate={onUpdate} onManageModels={vi.fn()}
      modelCatalog={{ status: 'ready', items: [builtin, { ...builtin, id: 'retired', displayName: 'Retired model', disabled: true, disabledReason: 'Blocked by account policy' }] }} />);
    expect(screen.getAllByText('Built-in · Text only')).toHaveLength(2);
    expect(screen.getByText('Blocked by account policy')).toBeDefined();
    const disabled = screen.getByRole('button', { name: 'Retired model, retired' });
    expect(disabled.hasAttribute('disabled')).toBe(true);
    await user.click(disabled);
    expect(onUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Spec drafting' }));
    await user.click(screen.getByRole('button', { name: 'Retired model, retired' }));
    expect(onUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Built-in model, builtin' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ field: 'specModeModelId', value: 'builtin' });
  });

  it('shows the official default reasoning level and sends a supported choice', async () => {
    const user = userEvent.setup(), onUpdate = vi.fn();
    render(<ModelPopover id="models" settings={settings} disabled={false} onUpdate={onUpdate} onManageModels={vi.fn()}
      modelCatalog={{ status: 'ready', items: [builtin] }} />);
    await user.click(screen.getByRole('button', { name: 'Edit reasoning for Built-in model' }));
    expect(screen.getByText('High (default)')).toBeDefined();
    await user.click(screen.getByRole('radio', { name: 'High' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ field: 'reasoningEffort', value: 'high' });
  });

  it('preserves the current model and offers a retry after catalog failure', async () => {
    const user = userEvent.setup(), onRefresh = vi.fn();
    render(<ModelPopover id="models" settings={settings} disabled={false} onUpdate={vi.fn()} onManageModels={vi.fn()}
      modelCatalog={{ status: 'error', items: [], message: 'Could not load models. Retry to load the list.' }} onRefresh={onRefresh} />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load models');
    expect(screen.getByText('Builtin')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry models' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
