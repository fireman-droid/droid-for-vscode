// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerControls,
  shouldOpenPopoverDown,
} from './ComposerControls';

afterEach(cleanup);

const settings = {
  status: 'ready' as const,
  value: {
    interactionMode: 'auto' as const,
    modelId: 'model-sol',
    reasoningEffort: 'medium' as const,
    autonomyLevel: 'low' as const,
    specModeModelId: null,
    specModeReasoningEffort: null,
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

describe('shouldOpenPopoverDown', () => {
  it('keeps the upward default for the bottom composer', () => {
    // Bottom composer: plenty of space above, little below.
    expect(shouldOpenPopoverDown(600, 60)).toBe(false);
  });

  it('flips downward when pinned near the viewport top', () => {
    expect(shouldOpenPopoverDown(40, 500)).toBe(true);
  });

  it('stays upward when below is even tighter than above', () => {
    expect(shouldOpenPopoverDown(200, 100)).toBe(false);
  });
});

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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
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
        onCompact={vi.fn()}
        onSettingUpdate={onSettingUpdate}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    expect(screen.getByRole('dialog', { name: 'Session controls' })).toBeDefined();
    expect(screen.getByRole('searchbox', { name: 'Search actions' })).toBeDefined();
    expect(screen.getByText('Skills').closest('button')).not.toBeNull();
    expect(screen.getByText('MCP servers').closest('button')).not.toBeNull();
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
        onCompact={vi.fn()}
        onSettingUpdate={onSettingUpdate}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
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

  it('offers spec drafting overrides only while the session is in Spec mode', async () => {
    const user = userEvent.setup();
    const onSettingUpdate = vi.fn();
    const catalog = {
      status: 'ready' as const,
      items: [
        {
          id: 'model-sol',
          displayName: 'Sol',
          supportedReasoningEfforts: [
            'low' as const,
            'medium' as const,
            'high' as const,
          ],
        },
        {
          id: 'model-pro',
          displayName: 'Pro',
          supportedReasoningEfforts: ['none' as const],
        },
      ],
    };
    const renderControls = (
      value: NonNullable<typeof settings.value>,
    ): React.JSX.Element => (
      <ComposerControls
        settings={{ status: 'ready', value }}
        context={context}
        modelCatalog={catalog}
        disabled={false}
        settingUpdatesDisabled={false}
        onContextRefresh={vi.fn()}
        onCompact={vi.fn()}
        onSettingUpdate={onSettingUpdate}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />
    );
    const { rerender } = render(renderControls(settings.value));

    // Outside Spec mode the model popover has no scope toggle.
    await user.click(
      screen.getByRole('button', { name: 'Model: model-sol' }),
    );
    expect(
      screen.queryByRole('radiogroup', { name: 'Model scope' }),
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    const specValue = {
      ...settings.value,
      interactionMode: 'spec' as const,
    };
    rerender(renderControls(specValue));
    expect(
      screen.getByRole('button', { name: 'Mode: Spec' }).className,
    ).toContain('dvx-mode-trigger-spec');

    // Selecting a model in the Spec drafting scope posts the spec field.
    await user.click(
      screen.getByRole('button', { name: 'Model: model-sol' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Spec drafting' }));
    expect(
      screen.getByRole('button', {
        name: 'Drafting with the session model',
      }),
    ).toBeDefined();
    await user.click(
      screen.getByRole('button', { name: 'Pro, model-pro' }),
    );
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'specModeModelId',
      value: 'model-pro',
    });

    // With an override set, the drafting model can be reset to the
    // session model and its reasoning to the model default.
    rerender(
      renderControls({ ...specValue, specModeModelId: 'model-pro' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Model: model-sol' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Spec drafting' }));
    expect(screen.getByText('Default')).toBeDefined();
    await user.click(
      screen.getByRole('button', { name: 'Edit reasoning for model-pro' }),
    );
    const defaultOption = screen.getByRole('radio', {
      name: 'Model default',
    });
    expect(defaultOption.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'None' }));
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'specModeReasoningEffort',
      value: 'none',
    });

    await user.click(
      screen.getByRole('button', { name: 'Model: model-sol' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Spec drafting' }));
    await user.click(
      screen.getByRole('button', { name: 'Use session model' }),
    );
    expect(onSettingUpdate).toHaveBeenCalledWith({
      field: 'specModeModelId',
      value: null,
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Mode update failed',
    );
  });

  it('browses skills and toggles them from the settings popover', async () => {
    const user = userEvent.setup();
    const onSkillsRefresh = vi.fn();
    const onSkillToggle = vi.fn();
    const { rerender } = render(
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={onSkillsRefresh}
        onSkillToggle={onSkillToggle}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Skills').closest('button')!);
    expect(onSkillsRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'Skills' })).toBeDefined();
    expect(screen.getByText('Loading skills…')).toBeDefined();

    rerender(
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{
          status: 'ready',
          items: [
            {
              name: 'code-review',
              description: 'Reviews code changes.',
              location: 'project',
              enabled: true,
              userInvocable: true,
            },
            {
              name: 'docs-writer',
              description: null,
              location: 'personal',
              enabled: false,
              userInvocable: false,
            },
          ],
        }}
        onSkillsRefresh={onSkillsRefresh}
        onSkillToggle={onSkillToggle}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    expect(screen.getByText('code-review')).toBeDefined();
    expect(screen.getByText('Reviews code changes.')).toBeDefined();
    expect(screen.getByText('project')).toBeDefined();
    const enabledSwitch = screen.getByRole('switch', {
      name: 'code-review enabled',
    });
    expect(enabledSwitch.getAttribute('aria-checked')).toBe('true');
    await user.click(enabledSwitch);
    expect(onSkillToggle).toHaveBeenCalledWith('code-review', true);
    const disabledSwitch = screen.getByRole('switch', {
      name: 'docs-writer enabled',
    });
    expect(disabledSwitch.getAttribute('aria-checked')).toBe('false');
    await user.click(disabledSwitch);
    expect(onSkillToggle).toHaveBeenCalledWith('docs-writer', false);

    // Back returns to the root controls without collapsing the popover.
    await user.click(
      screen.getByRole('button', { name: 'Back to session controls' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Session controls' }),
    ).toBeDefined();
    expect(screen.getByText('1/2 on')).toBeDefined();
  });

  it('browses MCP servers, expands tools, and toggles servers', async () => {
    const user = userEvent.setup();
    const onMcpRefresh = vi.fn();
    const onMcpServerToggle = vi.fn();
    const onMcpServerAuthenticate = vi.fn();
    const { rerender } = render(
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={onMcpRefresh}
        onMcpServerToggle={onMcpServerToggle}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('MCP servers').closest('button')!);
    expect(onMcpRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'MCP servers' })).toBeDefined();
    expect(screen.getByText('Loading MCP servers…')).toBeDefined();

    rerender(
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{
          status: 'ready',
          items: [
            {
              name: 'linear',
              status: 'connected',
              toolCount: 2,
              requiresAuth: false,
              tools: [
                {
                  name: 'list-issues',
                  description: 'Lists issues.',
                  enabled: true,
                  readOnly: true,
                },
                {
                  name: 'create-issue',
                  description: null,
                  enabled: false,
                  readOnly: false,
                },
              ],
            },
            {
              name: 'sentry',
              status: 'disabled',
              toolCount: null,
              requiresAuth: true,
              tools: [],
            },
          ],
        }}
        onMcpRefresh={onMcpRefresh}
        onMcpServerToggle={onMcpServerToggle}
        mcpAuth={null}
        onMcpServerAuthenticate={onMcpServerAuthenticate}
      />,
    );

    expect(screen.getByText('linear')).toBeDefined();
    expect(screen.getByText('needs auth')).toBeDefined();

    // Only servers that need auth offer the browser sign-in button.
    const authButton = screen.getByRole('button', {
      name: 'Authenticate in browser',
    });
    await user.click(authButton);
    expect(onMcpServerAuthenticate).toHaveBeenCalledWith('sentry');

    // Tools stay collapsed until expanded, then show read-only and off badges.
    expect(screen.queryByText('list-issues')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show 2 tools' }));
    expect(screen.getByText('list-issues')).toBeDefined();
    expect(screen.getByText('Lists issues.')).toBeDefined();
    expect(screen.getByText('read-only')).toBeDefined();
    expect(screen.getByText('off')).toBeDefined();

    const connectedSwitch = screen.getByRole('switch', {
      name: 'linear enabled',
    });
    expect(connectedSwitch.getAttribute('aria-checked')).toBe('true');
    await user.click(connectedSwitch);
    expect(onMcpServerToggle).toHaveBeenCalledWith('linear', false);
    const disabledSwitch = screen.getByRole('switch', {
      name: 'sentry enabled',
    });
    expect(disabledSwitch.getAttribute('aria-checked')).toBe('false');
    await user.click(disabledSwitch);
    expect(onMcpServerToggle).toHaveBeenCalledWith('sentry', true);

    await user.click(
      screen.getByRole('button', { name: 'Back to session controls' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Session controls' }),
    ).toBeDefined();
    expect(screen.getByText('1/2 on')).toBeDefined();
  });

  it('adds and removes MCP servers from the MCP panel', async () => {
    const user = userEvent.setup();
    const onMcpServerAdd = vi.fn();
    const onMcpServerRemove = vi.fn();
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
        onContextRefresh={vi.fn()}
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{
          status: 'ready',
          items: [
            {
              name: 'linear',
              status: 'connected',
              toolCount: 0,
              requiresAuth: false,
              tools: [],
            },
          ],
        }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        onMcpServerAdd={onMcpServerAdd}
        onMcpServerRemove={onMcpServerRemove}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('MCP servers').closest('button')!);

    // The add form collects a name, a type, and a URL for http servers.
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const form = screen.getByRole('form', { name: 'Add MCP server' });
    expect(form).toBeDefined();
    const submit = screen.getByRole('button', { name: 'Add server' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      screen.getByRole('textbox', { name: 'Server name' }),
      'remote',
    );
    await user.click(screen.getByRole('radio', { name: 'http' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Server URL' }),
      'https://example.com/mcp',
    );
    await user.click(screen.getByRole('button', { name: 'Add server' }));
    expect(onMcpServerAdd).toHaveBeenCalledWith({
      name: 'remote',
      serverType: 'http',
      url: 'https://example.com/mcp',
    });

    // Removal requires a second confirming click.
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onMcpServerRemove).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Confirm remove' }),
    );
    expect(onMcpServerRemove).toHaveBeenCalledWith('linear');
  });

  it('offers compaction from the context popover', async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
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
        onContextRefresh={vi.fn()}
        onCompact={onCompact}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    const compactButton = screen.getByRole('button', {
      name: 'Compact conversation',
    });
    await user.click(compactButton);
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it('shows an in-progress compact state and ignores clicks', async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
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
        compactPending
        onContextRefresh={vi.fn()}
        onCompact={onCompact}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    const compacting = screen.getByRole('button', { name: 'Compacting…' });
    expect(compacting.hasAttribute('disabled')).toBe(true);
    expect(compacting.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(compacting);
    expect(onCompact).not.toHaveBeenCalled();
  });

  it('omits the context ring entirely when showContext is off', () => {
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
        showContext={false}
        onContextRefresh={vi.fn()}
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/Context used/)).toBeNull();
    expect(document.querySelector('.dvx-context-ring')).toBeNull();
    // The rest of the control row survives.
    expect(
      screen.getByRole('button', { name: 'Session controls' }),
    ).toBeDefined();
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
        onCompact={vi.fn()}
        onSettingUpdate={vi.fn()}
        skills={{ status: 'idle', items: [] }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
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
