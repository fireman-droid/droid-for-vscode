// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerControls,
  rankNameMatches,
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

describe('rankNameMatches', () => {
  it('matches names only, never descriptions', () => {
    // Regression: searching "figma" used to surface agent-browser
    // because its description mentions Figma.
    const items = [
      { name: 'agent-browser', description: 'Drives Figma via browser.' },
      { name: 'figma-design-extract', description: 'Extracts specs.' },
    ];
    expect(rankNameMatches(items, 'figma', 5).map((item) => item.name)).toEqual(
      ['figma-design-extract'],
    );
  });

  it('ranks prefix hits above substring hits and caps results', () => {
    const items = [
      { name: 'review-figma' },
      { name: 'figma-sync' },
      { name: 'my-figma-tool' },
      { name: 'figma' },
    ];
    expect(rankNameMatches(items, 'figma', 3).map((item) => item.name)).toEqual(
      ['figma-sync', 'figma', 'review-figma'],
    );
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
    expect(screen.getByText('Over model limit')).toBeDefined();
    expect(screen.getByText('125 tokens reported')).toBeDefined();
    expect(
      screen.getByText(/not a trustworthy active-window percentage/),
    ).toBeDefined();
    // Degraded visual: the bar stays, pinned full and labeled as an
    // estimate, instead of vanishing and hollowing out the card.
    const overBar = screen.getByRole('progressbar', {
      name: 'Context used',
    });
    expect(overBar.getAttribute('aria-valuenow')).toBe('100');
    expect(overBar.getAttribute('aria-valuetext')).toContain('Estimated');
    expect(overBar.className).toContain('dvx-context-progress-over');
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
    // Dismissal keeps the popover mounted briefly (inert to pointer
    // events) so its exit animation can play, then unmounts it.
    expect(document.querySelector('[data-popover-closing]')).not.toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Model' })).toBeNull(),
    );
  });

  it('marks view swaps with a direction and closes through an exit state', async () => {
    const user = userEvent.setup();
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
        mcp={{ status: 'idle', items: [] }}
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    // The first mount plays no view animation — the popover itself
    // already animates in.
    expect(
      screen
        .getByRole('dialog', { name: 'Session controls' })
        .querySelector('.dvx-settings-view')
        ?.getAttribute('data-direction'),
    ).toBeNull();

    await user.click(screen.getByText('Skills').closest('button')!);
    expect(
      screen
        .getByRole('dialog', { name: 'Skills' })
        .querySelector('.dvx-settings-view')
        ?.getAttribute('data-direction'),
    ).toBe('forward');

    await user.click(
      screen.getByRole('button', { name: 'Back to session controls' }),
    );
    expect(
      screen
        .getByRole('dialog', { name: 'Session controls' })
        .querySelector('.dvx-settings-view')
        ?.getAttribute('data-direction'),
    ).toBe('back');

    // Toggling the + button closed keeps the popover mounted in the
    // closing state for its exit animation, then unmounts it.
    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    expect(document.querySelector('[data-popover-closing]')).not.toBeNull();
    expect(
      screen.getByRole('dialog', { name: 'Session controls' }),
    ).toBeDefined();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Session controls' }),
      ).toBeNull(),
    );
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Skills').closest('button')!);
    // Once from the row click, once from the visible panel's idle
    // catalog recovery effect.
    expect(onSkillsRefresh).toHaveBeenCalledTimes(2);
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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

  it('recovers the skills panel after a session switch resets the catalog to idle', async () => {
    const user = userEvent.setup();
    const onSkillsRefresh = vi.fn();
    const readySkills = {
      status: 'ready' as const,
      items: [
        {
          name: 'code-review',
          description: null,
          location: 'project',
          enabled: true,
          userInvocable: true,
        },
      ],
    };
    const renderControls = (
      skills: typeof readySkills | { status: 'idle'; items: readonly [] },
    ): React.JSX.Element => (
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
        skills={skills}
        onSkillsRefresh={onSkillsRefresh}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />
    );
    const { rerender } = render(renderControls(readySkills));

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Skills').closest('button')!);
    expect(screen.getByText('code-review')).toBeDefined();
    onSkillsRefresh.mockClear();

    // A session switch resets the store to 'idle' with no re-query;
    // the visible panel must trigger its own refresh and keep the
    // Refresh button usable instead of deadlocking on "Loading…".
    rerender(renderControls({ status: 'idle', items: [] }));
    expect(onSkillsRefresh).toHaveBeenCalledTimes(1);
    const refresh = screen.getByRole('button', {
      name: 'Refresh',
    }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(false);
    await user.click(refresh);
    expect(onSkillsRefresh).toHaveBeenCalledTimes(2);
  });

  it('recovers the MCP panel after a session switch resets the catalog to idle', async () => {
    const user = userEvent.setup();
    const onMcpRefresh = vi.fn();
    const readyMcp = {
      status: 'ready' as const,
      items: [
        {
          name: 'linear',
          status: 'connected' as const,
          toolCount: 0,
          requiresAuth: false,
          tools: [],
        },
      ],
    };
    const renderControls = (
      mcp: typeof readyMcp | { status: 'idle'; items: readonly [] },
    ): React.JSX.Element => (
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
        mcp={mcp}
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={onMcpRefresh}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />
    );
    const { rerender } = render(renderControls(readyMcp));

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('MCP servers').closest('button')!);
    expect(screen.getByText('linear')).toBeDefined();
    onMcpRefresh.mockClear();

    rerender(renderControls({ status: 'idle', items: [] }));
    expect(onMcpRefresh).toHaveBeenCalledTimes(1);
    const refresh = screen.getByRole('button', {
      name: 'Refresh',
    }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(false);
    await user.click(refresh);
    expect(onMcpRefresh).toHaveBeenCalledTimes(2);
  });

  it('shows the read-only plugins panel and recovers from an idle reset', async () => {
    const user = userEvent.setup();
    const onPluginsRefresh = vi.fn();
    const readyPlugins = {
      status: 'ready' as const,
      items: [
        {
          id: 'core@factory-plugins',
          scope: 'user' as const,
          version: 'e3ff29f752fb',
          active: true,
        },
        {
          id: 'docs@factory-plugins',
          scope: 'project' as const,
          version: '0b1d2c3d4e5f',
          active: false,
        },
      ],
      marketplaceCount: 1,
    };
    const renderControls = (
      plugins: typeof readyPlugins | { status: 'idle'; items: readonly [] },
    ): React.JSX.Element => (
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
        plugins={plugins}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={onPluginsRefresh}
      />
    );
    const { rerender } = render(renderControls(readyPlugins));

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    const pluginsRow = screen.getByText('Plugins').closest('button')!;
    expect(pluginsRow.textContent).toContain('2 installed');
    await user.click(pluginsRow);
    // Entering re-reads the catalog like the Skills/MCP links do.
    expect(onPluginsRefresh).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('dialog', { name: 'Plugins' })).toBeDefined();
    expect(screen.getByText('core@factory-plugins')).toBeDefined();
    expect(screen.getByText('user')).toBeDefined();
    expect(screen.getByText('e3ff29f752fb')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('Off')).toBeDefined();
    expect(screen.getByText(/1 marketplace registered/)).toBeDefined();
    // Read-only slice: no toggle, add, or remove affordances.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();

    // A session switch resets the catalog to idle; the visible panel
    // re-requests instead of deadlocking on the loading message.
    onPluginsRefresh.mockClear();
    rerender(renderControls({ status: 'idle', items: [] }));
    expect(onPluginsRefresh).toHaveBeenCalledTimes(1);
  });

  it('surfaces plugin daemon failures as an explicit error state', async () => {
    const user = userEvent.setup();
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
        mcp={{ status: 'idle', items: [] }}
        plugins={{
          status: 'error',
          items: [],
          message: 'The local droid daemon is unavailable.',
        }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Plugins').closest('button')!);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('The local droid daemon is unavailable.');
    expect(screen.queryByText('Loading plugins…')).toBeNull();
  });

  it('returns to the root controls when starting a new session from the skills panel', async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
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
        skills={{
          status: 'ready',
          items: [
            {
              name: 'code-review',
              description: null,
              location: 'project',
              enabled: true,
              userInvocable: true,
            },
          ],
        }}
        onSkillsRefresh={vi.fn()}
        onSkillToggle={vi.fn()}
        mcp={{ status: 'idle', items: [] }}
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
        onNewSession={onNewSession}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('Skills').closest('button')!);
    // The apply-in-new-session hint appears once a toggle changed.
    await user.click(
      screen.getByRole('switch', { name: 'code-review enabled' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Start a new session' }),
    );
    expect(onNewSession).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('dialog', { name: 'Session controls' }),
    ).toBeDefined();
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={onMcpRefresh}
        onMcpServerToggle={onMcpServerToggle}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('MCP servers').closest('button')!);
    // Once from the row click, once from the visible panel's idle
    // catalog recovery effect.
    expect(onMcpRefresh).toHaveBeenCalledTimes(2);
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={onMcpRefresh}
        onMcpServerToggle={onMcpServerToggle}
        mcpAuth={null}
        onMcpServerAuthenticate={onMcpServerAuthenticate}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        onMcpServerAdd={onMcpServerAdd}
        onMcpServerRemove={onMcpServerRemove}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('MCP servers').closest('button')!);

    // The add form collects a name, a type, and a URL for http servers.
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const form = screen.getByRole('form', { name: 'Add MCP server' });
    expect(form).toBeDefined();
    // Nested-form regression: this card sits inside the assistant-ui
    // composer <form>; a real nested <form> makes Chromium drop the
    // submit event before React sees it, and the resulting native
    // submission navigates (and kills) the webview.
    expect(form.tagName).not.toBe('FORM');
    expect(form.querySelector('form')).toBeNull();
    // An incomplete form keeps the submit button disabled; clicking
    // it is inert and posts nothing.
    const addServer = screen.getByRole('button', { name: 'Add server' });
    expect(addServer.hasAttribute('disabled')).toBe(true);
    await user.click(addServer);
    expect(onMcpServerAdd).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: 'Server name' }),
      'remote',
    );
    await user.click(screen.getByRole('radio', { name: 'http' }));
    // A filled but malformed URL keeps the button disabled and shows
    // the one quiet shape hint; Enter is ignored as well.
    const urlField = screen.getByRole('textbox', { name: 'Server URL' });
    await user.type(urlField, 'example.com/mcp');
    expect(addServer.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain(
      'Enter a URL starting with http:// or https://.',
    );
    await user.type(urlField, '{Enter}');
    expect(onMcpServerAdd).not.toHaveBeenCalled();
    await user.clear(urlField);
    await user.type(urlField, 'https://example.com/mcp');
    expect(addServer.hasAttribute('disabled')).toBe(false);
    await user.click(addServer);
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

  it('submits a stdio MCP server from Enter inside the add form', async () => {
    const user = userEvent.setup();
    const onMcpServerAdd = vi.fn();
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
        mcp={{ status: 'ready', items: [] }}
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        onMcpServerAdd={onMcpServerAdd}
        onMcpServerRemove={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Session controls' }));
    await user.click(screen.getByText('MCP servers').closest('button')!);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const commandField = screen.getByRole('textbox', {
      name: 'Launch command',
    });
    // Enter with empty fields is ignored (no message, nothing posted).
    await user.type(commandField, '{Enter}');
    expect(onMcpServerAdd).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: 'Server name' }),
      'local',
    );
    await user.type(commandField, 'npx -y my-mcp-server{Enter}');
    expect(onMcpServerAdd).toHaveBeenCalledWith({
      name: 'local',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    const compacting = screen.getByRole('button', { name: 'Compacting…' });
    expect(compacting.hasAttribute('disabled')).toBe(true);
    expect(compacting.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(compacting);
    expect(onCompact).not.toHaveBeenCalled();
  });

  it('shows the SDK token breakdown for both scopes without inventing cost', async () => {
    const user = userEvent.setup();
    render(
      <ComposerControls
        settings={settings}
        context={context}
        tokenUsage={{
          // Live values from artifacts/probe-token-usage.out.json.
          cumulative: {
            inputTokens: 2565,
            outputTokens: 81,
            cacheReadTokens: 23552,
            cacheCreationTokens: 0,
            thinkingTokens: 62,
          },
          lastTurn: {
            inputTokens: 1719,
            outputTokens: 76,
            cacheReadTokens: 11776,
            cacheCreationTokens: 0,
            thinkingTokens: 40,
            factoryCredits: 0,
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    expect(
      screen.getByRole('columnheader', { name: 'Last turn' }),
    ).toBeDefined();
    expect(
      screen.getByRole('columnheader', { name: 'Session' }),
    ).toBeDefined();
    const input = screen.getByRole('row', { name: /^Input/ });
    expect(input.textContent).toContain('1,719');
    expect(input.textContent).toContain('2,565');
    // Zero credits reported: no Credits row, and never a money amount.
    expect(screen.queryByRole('row', { name: /Credits/ })).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    // Per-turn data exists, so no missing-detail note.
    expect(screen.queryByText(/Per-turn detail/)).toBeNull();
  });

  it('marks history sessions as cumulative-only and surfaces credits', async () => {
    const user = userEvent.setup();
    render(
      <ComposerControls
        settings={settings}
        context={context}
        tokenUsage={{
          cumulative: {
            inputTokens: 2565,
            outputTokens: 81,
            cacheReadTokens: 23552,
            cacheCreationTokens: 0,
            thinkingTokens: 62,
            factoryCredits: 1.25,
          },
          lastTurn: null,
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    expect(
      screen.queryByRole('columnheader', { name: 'Last turn' }),
    ).toBeNull();
    expect(
      screen.getByRole('row', { name: /Credits/ }).textContent,
    ).toContain('1.25');
    expect(
      screen.getByText('Per-turn detail appears after the next completed turn.'),
    ).toBeDefined();
  });

  it('renders no token usage section before the SDK reports any', async () => {
    const user = userEvent.setup();
    render(
      <ComposerControls
        settings={settings}
        context={context}
        tokenUsage={{ cumulative: null, lastTurn: null }}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Context used 25 of 100/));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Token usage')).toBeNull();
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
        plugins={{ status: 'idle', items: [] }}
        onMcpRefresh={vi.fn()}
        onMcpServerToggle={vi.fn()}
        mcpAuth={null}
        onMcpServerAuthenticate={vi.fn()}
        onPluginsRefresh={vi.fn()}
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
