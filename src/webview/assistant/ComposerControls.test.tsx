// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerControls } from './ComposerControls';

afterEach(cleanup);

const settings = {
  status: 'ready' as const,
  value: {
    interactionMode: 'auto' as const,
    modelId: 'model-sol',
    reasoningEffort: 'medium' as const,
    autonomyLevel: 'low' as const,
  },
};
const context = {
  status: 'ready' as const,
  value: {
    used: 25,
    remaining: 75,
    limit: 100,
    accuracy: 'estimated' as const,
  },
};

describe('ComposerControls', () => {
  it('shows unsupported runtime model IDs verbatim without inventing catalog data', () => {
    render(
      <ComposerControls
        settings={{
          ...settings,
          value: {
            ...settings.value,
            modelId: 'custom:gpt-5.6-sol-o',
          },
        }}
        context={context}
        modelCatalog={{
          status: 'unsupported',
          items: [],
          message: 'Catalog unsupported on this runtime.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Model: gpt-5.6-sol-o',
    });
    expect(trigger.textContent).toBe('gpt-5.6-sol-o');
    expect(trigger.getAttribute('title')).toBe('custom:gpt-5.6-sol-o');
  });

  it('keeps the closed footer compact and free of expanded settings', () => {
    const { container } = render(
      <ComposerControls
        settings={settings}
        context={context}
        modelCatalog={{
          status: 'unsupported',
          items: [],
          message: 'Catalog unsupported on this runtime.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Session controls' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Model: model-sol' }).textContent,
    ).toBe('model-sol');
    expect(screen.queryByText('Mode')).toBeNull();
    expect(screen.queryByText('Autonomy')).toBeNull();
    expect(screen.queryByText('Medium')).toBeNull();
    const ring = container.querySelector('.dvx-context-ring');
    const arc = container.querySelector('.dvx-context-ring-value');
    expect(ring?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(arc?.getAttribute('stroke-dasharray')).toBe('25 100');
  });

  it('does not present incoherent SDK totals as active-window usage', () => {
    const { container } = render(
      <ComposerControls
        settings={settings}
        context={{
          status: 'ready',
          value: {
            used: 125,
            remaining: 175,
            limit: 100,
            accuracy: 'estimated',
          },
        }}
        modelCatalog={{
          status: 'unsupported',
          items: [],
          message: 'Catalog unsupported on this runtime.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={vi.fn()}
      />,
    );

    expect(
      container
        .querySelector('.dvx-context-ring-value')
        ?.getAttribute('stroke-dasharray'),
    ).toBe('0 100');
    fireEvent.click(
      screen.getByLabelText(
        'Current context window unavailable; Droid reported 125 tokens against a 100 model limit',
      ),
    );
    expect(screen.getByText('Current window unavailable')).toBeDefined();
    expect(screen.getByText('125 tokens reported')).toBeDefined();
    expect(
      screen.getByText(/not a trustworthy active-window percentage/),
    ).toBeDefined();
    expect(
      screen.queryByRole('progressbar', { name: 'Context used' }),
    ).toBeNull();
    expect(screen.getByText('Model limit')).toBeDefined();
    expect(screen.getByText('100')).toBeDefined();
  });

  it('opens only real controls and emits exact selected values', async () => {
    const user = userEvent.setup();
    const onSettingUpdate = vi.fn();
    const onContextRefresh = vi.fn();
    render(
      <ComposerControls
        settings={settings}
        context={context}
        modelCatalog={{
          status: 'unsupported',
          items: [],
          message: 'Catalog unsupported on this runtime.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={onContextRefresh}
        onSettingUpdate={onSettingUpdate}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    expect(screen.getByRole('dialog', { name: 'Session controls' })).toBeDefined();
    expect(screen.getByRole('searchbox', { name: 'Search actions' })).toBeDefined();
    expect(screen.getByLabelText('Skills: None')).toBeDefined();
    expect(screen.getByLabelText('MCP servers: None')).toBeDefined();
    expect(screen.getByText('Skills').closest('button')).toBeNull();
    expect(screen.getByText('MCP servers').closest('button')).toBeNull();
    const modeButton = screen.getByText('Mode').closest('button')!;
    expect(modeButton.getAttribute('aria-expanded')).toBe('false');
    await user.click(modeButton);
    expect(modeButton.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('radiogroup', { name: 'Mode options' }),
    ).toBeDefined();
    await user.click(screen.getByRole('radio', { name: /Mission/ }));
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'interactionMode',
      value: 'mission',
    });
    expect(screen.getByRole('dialog', { name: 'Session controls' })).toBeDefined();
    expect(modeButton.getAttribute('aria-expanded')).toBe('false');
    const autonomyButton = screen.getByText('Autonomy').closest('button')!;
    await user.click(autonomyButton);
    expect(autonomyButton.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('radiogroup', { name: 'Autonomy options' }),
    ).toBeDefined();
    await user.click(screen.getByRole('radio', { name: 'High' }));
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'autonomyLevel',
      value: 'high',
    });
    expect(autonomyButton.getAttribute('aria-expanded')).toBe('false');

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    expect(screen.getByText('25% used')).toBeDefined();
    expect(
      screen
        .getByRole('progressbar', { name: 'Context used' })
        .getAttribute('aria-valuenow'),
    ).toBe('25');
    expect(screen.getByText('Remaining')).toBeDefined();
    expect(screen.getByText('75')).toBeDefined();
    expect(screen.getByText('Estimated')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onContextRefresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Model: model-sol' }));
    expect(screen.getByText('Current model')).toBeDefined();
    expect(screen.getByText('Model Sol')).toBeDefined();
    expect(screen.getByText('Medium')).toBeDefined();
    expect(screen.getByText('Catalog unsupported on this runtime.')).toBeDefined();
    expect(
      screen.queryByRole('list', { name: 'BYOK models' }),
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Model' })).toBeNull();
  });

  it('uses only dynamic catalog rows and selected-model reasoning options', async () => {
    const user = userEvent.setup();
    const onSettingUpdate = vi.fn();
    render(
      <ComposerControls
        settings={settings}
        context={context}
        modelCatalog={{
          status: 'ready',
          items: [
            {
              id: 'model-sol',
              displayName: 'Sol',
              supportedReasoningEfforts: [
                'low',
                'medium',
                'high',
                'xhigh',
                'max',
              ],
            },
            {
              id: 'model-pro',
              displayName: 'Pro',
              supportedReasoningEfforts: ['none'],
            },
          ],
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={onSettingUpdate}
      />,
    );

    expect(screen.getByRole('button', { name: 'Model: model-sol' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Model: model-sol' }));
    expect(screen.getByRole('dialog', { name: 'Model' })).toBeDefined();
    expect(screen.getByText('Medium')).toBeDefined();
    await user.type(
      screen.getByRole('searchbox', { name: 'Search BYOK models' }),
      'pro',
    );
    expect(screen.getByText('model-pro')).toBeDefined();
    expect(screen.queryByRole('listitem', { name: /Sol/ })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Pro, model-pro' }),
    );
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'modelId',
      value: 'model-pro',
    });

    await user.click(screen.getByRole('button', { name: 'Model: model-sol' }));
    await user.click(
      screen.getByRole('button', { name: 'Edit reasoning for model-sol' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Options', level: 3 }),
    ).toBeDefined();
    expect(
      screen.queryByRole('button', { name: 'Options' }),
    ).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Extra High' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Max' })).toBeDefined();
    await user.click(screen.getByRole('radio', { name: 'Max' }));
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'reasoningEffort',
      value: 'max',
    });
  });

  it('preserves confirmed controls while reporting updating and error states', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ComposerControls
        settings={{ status: 'updating', value: settings.value }}
        context={context}
        modelCatalog={{
          status: 'error',
          items: [],
          message: 'Catalog failed.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    expect(screen.getByRole('status').textContent).toContain(
      'Applying setting',
    );
    rerender(
      <ComposerControls
        settings={{
          status: 'error',
          value: null,
          message: 'Mode update failed.',
        }}
        context={context}
        modelCatalog={{
          status: 'error',
          items: [],
          message: 'Catalog failed.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Mode update failed',
    );
  });

  it('reports a Context error once', async () => {
    const user = userEvent.setup();
    render(
      <ComposerControls
        settings={settings}
        context={{
          status: 'error',
          value: null,
          message: 'Context usage is unavailable.',
        }}
        modelCatalog={{
          status: 'unsupported',
          items: [],
          message: 'Catalog unsupported on this runtime.',
        }}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onSettingUpdate={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Context usage unavailable',
      }),
    );
    expect(screen.getAllByText('Context usage is unavailable.')).toHaveLength(
      1,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Context usage is unavailable.',
    );
  });
});
