// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MissionSetupCapabilities } from '../../../shared/missionProtocol';
import { MissionSetup } from './MissionSetup';

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

afterEach(cleanup);

describe('MissionSetup', () => {
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
    await user.click(
      screen.getByRole('button', { name: 'Advanced Mission settings' }),
    );
    expect(
      screen.getByText(
        'The shared Validator profile is used by Scrutiny and User Testing.',
      ),
    ).toBeDefined();

    await user.selectOptions(
      screen.getByLabelText('Worker inheritance'),
      'override',
    );
    await user.selectOptions(screen.getByLabelText('Worker model'), 'worker-b');
    await user.selectOptions(
      screen.getByLabelText('Worker reasoning'),
      'medium',
    );
    await user.selectOptions(
      screen.getByLabelText('Validator inheritance'),
      'override',
    );
    await user.selectOptions(
      screen.getByLabelText('Validator model'),
      'validator-c',
    );
    await user.click(
      screen.getByRole('button', { name: 'Advanced Mission settings' }),
    );
    expect(screen.queryByLabelText('Validator model')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Advanced Mission settings' }),
    );
    expect(
      (screen.getByLabelText('Validator model') as HTMLSelectElement).value,
    ).toBe('validator-c');
    await user.click(screen.getByRole('checkbox', { name: 'Run Scrutiny' }));
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
      await user.click(
        screen.getByRole('button', { name: 'Advanced Mission settings' }),
      );
      if (!scrutinyEnabled) {
        await user.click(
          screen.getByRole('checkbox', { name: 'Run Scrutiny' }),
        );
      }
      if (!userTestingEnabled) {
        await user.click(
          screen.getByRole('checkbox', { name: 'Run User Testing' }),
        );
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
    expect(screen.getByRole('status').textContent).toContain(
      'Enter a Mission task.',
    );
    await user.type(screen.getByLabelText('Mission task'), 'Implement it');
    await user.dblClick(start);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByLabelText('Mission task') as HTMLTextAreaElement).disabled,
    ).toBe(true);
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
    expect(
      (screen.getByLabelText('Mission task') as HTMLTextAreaElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText('Mission task') as HTMLTextAreaElement).value,
    ).toBe('Implement it');
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
    expect(
      (screen.getByLabelText('Mission task') as HTMLTextAreaElement).value,
    ).toBe('Keep exact task!');
  });

  it('blocks task text the Bridge cannot represent', () => {
    render(
      <MissionSetup
        capabilities={capabilities}
        initialTask="Inspect C:\\repo\\secret.ts"
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
