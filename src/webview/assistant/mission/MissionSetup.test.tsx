// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MissionSetupCapabilities } from '../../../shared/protocol/missionProtocol';
import { MissionSetup as V1MissionSetup } from './MissionSetup';
import { MissionSetup as V2MissionSetup } from '../../../webview-v2/mission/MissionSetup';

const capabilities: MissionSetupCapabilities = {
  currentChat: {
    modelId: 'orchestrator-a',
    reasoningEffort: 'high',
  },
  catalogStatus: 'ready',
  catalog: [
    {
      id: 'orchestrator-a',
      displayName: 'Orchestrator A',
      supportedReasoningEfforts: ['medium', 'high'],
    },
    {
      id: 'worker-b',
      displayName: 'Worker B',
      supportedReasoningEfforts: ['low', 'medium'],
    },
    {
      id: 'validator-c',
      displayName: 'Validator C',
      supportedReasoningEfforts: ['high'],
    },
  ],
  preferences: {
    worker: {
      mode: 'same-as-orchestrator',
      modelId: 'orchestrator-a',
      reasoningEffort: 'high',
    },
    validator: {
      mode: 'same-as-orchestrator',
      modelId: 'orchestrator-a',
      reasoningEffort: 'high',
    },
    scrutinyEnabled: true,
    userTestingEnabled: true,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each([['V1', V1MissionSetup], ['V2', V2MissionSetup]] as const)('%s MissionSetup', (version, MissionSetup) => {
  it.runIf(version === 'V1')('opens a compact picker above controls near the viewport edge', async () => {
    const user = userEvent.setup();
    render(
      <MissionSetup
        capabilities={capabilities}
        initialTask="Ship this"
        onStart={vi.fn(() => 'request-1')}
        onDismiss={vi.fn()}
      />,
    );

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(320);
    const trigger = screen.getByRole('combobox', {
      name: 'Orchestrator model',
    });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 286,
      height: 38,
      left: 20,
      right: 420,
      top: 248,
      width: 400,
      x: 20,
      y: 248,
      toJSON: () => ({}),
    });

    await user.click(trigger);

    expect(trigger.parentElement?.dataset.placement).toBe('top');
    expect(
      screen.getByRole('listbox', { name: 'Orchestrator model options' }),
    ).toBeDefined();
  });

  it('selects worker and validator independently with shared semantics', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(() => 'request-1');
    render(
      <MissionSetup
        capabilities={capabilities}
        initialTask="Ship this"
        onStart={onStart}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Worker model')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Advanced Mission settings' }));
    expect(
      screen.getByText('Both checks use the shared Validator profile configured above.'),
    ).toBeDefined();

    expect(screen.getByRole('combobox', { name: 'Orchestrator reasoning' }).tagName).toBe(
      'BUTTON',
    );
    await user.click(screen.getByRole('combobox', { name: 'Worker inheritance' }));
    await user.click(screen.getByRole('option', { name: 'Choose independently' }));
    await user.click(screen.getByRole('combobox', { name: 'Worker model' }));
    expect(screen.getByRole('listbox', { name: 'Worker model options' })).toBeDefined();
    if (version === 'V1') expect(screen.getByRole('option', { name: 'Worker B' }).tabIndex).toBe(-1);
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('combobox', { name: 'Worker reasoning' }));
    await user.click(screen.getByRole('option', { name: 'Medium' }));
    await user.click(screen.getByRole('combobox', { name: 'Validator inheritance' }));
    await user.click(screen.getByRole('option', { name: 'Choose independently' }));
    await user.click(screen.getByRole('combobox', { name: 'Validator model' }));
    await user.click(screen.getByRole('option', { name: 'Validator C' }));
    await user.click(screen.getByRole('button', { name: 'Advanced Mission settings' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('Validator model')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: 'Advanced Mission settings' }));
    expect(
      screen.getByRole('combobox', { name: 'Validator model' }).textContent,
    ).toContain('Validator C');
    await user.click(screen.getByRole(version === 'V1' ? 'checkbox' : 'switch', { name: 'Run Scrutiny' }));
    await user.click(screen.getByRole('button', { name: 'Start Mission' }));

    expect(onStart).toHaveBeenCalledWith({
      task: 'Ship this',
      orchestrator: {
        modelId: 'orchestrator-a',
        reasoningEffort: 'high',
      },
      worker: {
        mode: 'override',
        modelId: 'worker-b',
        reasoningEffort: 'medium',
      },
      validator: {
        mode: 'override',
        modelId: 'validator-c',
        reasoningEffort: 'high',
      },
      scrutinyEnabled: false,
      userTestingEnabled: true,
    });
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    'submits independent validator toggles (%s, %s)',
    async (scrutinyEnabled, userTestingEnabled) => {
      const user = userEvent.setup();
      const onStart = vi.fn(() => 'request-1');
      render(
        <MissionSetup
          capabilities={capabilities}
          initialTask="Validate toggles"
          onStart={onStart}
          onDismiss={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Advanced Mission settings' }));
      if (!scrutinyEnabled) {
        await user.click(screen.getByRole(version === 'V1' ? 'checkbox' : 'switch', { name: 'Run Scrutiny' }));
      }
      if (!userTestingEnabled) {
        await user.click(screen.getByRole(version === 'V1' ? 'checkbox' : 'switch', { name: 'Run User Testing' }));
      }
      await user.click(screen.getByRole('button', { name: 'Start Mission' }));

      expect(onStart).toHaveBeenCalledWith(
        expect.objectContaining({
          scrutinyEnabled,
          userTestingEnabled,
          validator: {
            mode: 'same-as-orchestrator',
            modelId: 'orchestrator-a',
            reasoningEffort: 'high',
          },
        }),
      );
    },
  );

  it('keeps setup accessible and single flight', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(() => 'request-1');
    const { rerender } = render(
      <MissionSetup
        capabilities={capabilities}
        initialTask=""
        onStart={onStart}
        onDismiss={vi.fn()}
      />,
    );

    const start = screen.getByRole('button', { name: 'Start Mission' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    const task = screen.getByLabelText('Mission task');
    expect(document.activeElement).toBe(task);
    expect(screen.getByRole('status').textContent).toBe('');
    await user.type(task, 'Implement it');
    await user.dblClick(start);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Mission task') as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Dismiss Mission setup',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(
      <MissionSetup
        capabilities={capabilities}
        initialTask=""
        onStart={onStart}
        onDismiss={vi.fn()}
        result={{
          requestId: 'request-1',
          status: 'rejected',
        }}
      />,
    );
    expect((screen.getByLabelText('Mission task') as HTMLTextAreaElement).disabled).toBe(
      false,
    );
    expect((screen.getByLabelText('Mission task') as HTMLTextAreaElement).value).toBe(
      'Implement it',
    );
  });

  it('reports every stale pair without fallback', () => {
    render(
      <MissionSetup
        capabilities={{
          ...capabilities,
          currentChat: {
            modelId: 'removed-orchestrator',
            reasoningEffort: 'max',
          },
          preferences: {
            ...capabilities.preferences,
            worker: {
              mode: 'override',
              modelId: 'removed-worker',
              reasoningEffort: 'xhigh',
            },
            validator: {
              mode: 'override',
              modelId: 'validator-c',
              reasoningEffort: 'low',
            },
          },
        }}
        initialTask="Keep exact task!"
        onStart={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole('button', {
          name: 'Start Mission',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole('status').textContent).toContain(
      'The Orchestrator model is unavailable.',
    );
    expect(screen.getByRole('status').textContent).toContain(
      'The Worker model is unavailable.',
    );
    expect(screen.getByRole('status').textContent).toContain(
      'The Validator reasoning is unavailable for this model.',
    );
    expect((screen.getByLabelText('Mission task') as HTMLTextAreaElement).value).toBe(
      'Keep exact task!',
    );
  });

  it('blocks task text the Bridge cannot represent', () => {
    render(
      <MissionSetup
        capabilities={capabilities}
        initialTask={'Inspect\u0000unsupported'}
        onStart={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('status', { name: 'Mission setup status' }).textContent,
    ).toContain('contains unsupported control characters or a filesystem path');
    expect(
      (
        screen.getByRole('button', {
          name: 'Start Mission',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
