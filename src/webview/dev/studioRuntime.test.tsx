// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_PROTOCOL_VERSION } from '../../shared/bridgeMessages';
import { readHostMessage } from '../bridge/validateHostMessage';
import {
  STUDIO_SCENARIO_IDS,
  STUDIO_SCENARIOS,
  getStudioScenario,
} from './scenarios';
import { StudioControls } from './StudioControls';
import {
  createStudioRuntime,
  parseStudioConfig,
} from './studioRuntime';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Scenario Studio registry', () => {
  it('builds every required scenario from validator-accepted messages', () => {
    expect(STUDIO_SCENARIO_IDS).toEqual([
      'full-workflow',
      'conversation',
      'streaming',
      'plan',
      'ask-user',
      'review',
      'subagent',
      'permission',
      'queued-attachments',
      'long-history',
      'failure',
      'empty',
    ]);
    for (const scenario of STUDIO_SCENARIOS) {
      let sequence = 0;
      const messages = scenario.build(() => sequence++);
      expect(messages[0]?.type, scenario.id).toBe('host.snapshot');
      for (const message of messages) {
        expect(readHostMessage(message), `${scenario.id}: ${message.type}`)
          .toEqual(message);
      }
    }
  });

  it('contains the key visual state for each specialized scenario', () => {
    const messageTypes = (id: (typeof STUDIO_SCENARIO_IDS)[number]) => {
      let sequence = 0;
      return getStudioScenario(id)
        .build(() => sequence++)
        .map((message) => message.type);
    };
    expect(messageTypes('streaming')).toEqual(
      expect.arrayContaining([
        'thinking.delta',
        'tool.activity',
        'assistant.delta',
      ]),
    );
    expect(messageTypes('plan')).toContain('interaction.request');
    expect(messageTypes('ask-user')).toContain('interaction.request');
    expect(messageTypes('subagent')).toContain('subagent.activity');
    expect(messageTypes('failure')).toEqual(
      expect.arrayContaining([
        'tool.activity',
        'turn.error',
        'host.connection',
      ]),
    );
  });

  it('provides dense workflow, permission, queue, and attachment acceptance data', () => {
    let sequence = 0;
    const workflow = getStudioScenario('full-workflow').build(
      () => sequence++,
    );
    const workflowSnapshot = workflow[0];
    expect(workflowSnapshot?.type).toBe('host.snapshot');
    if (workflowSnapshot?.type !== 'host.snapshot') {
      throw new Error('Expected full-workflow snapshot');
    }
    expect(workflowSnapshot.transcript.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        'user',
        'thinking',
        'tool',
        'assistant',
        'changes',
      ]),
    );
    expect(workflowSnapshot.queue?.items).toHaveLength(2);
    expect(workflow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'subagent.activity' }),
      ]),
    );

    sequence = 0;
    const permission = getStudioScenario('permission').build(
      () => sequence++,
    );
    expect(permission).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'interaction.request',
          request: expect.objectContaining({
            kind: 'permission',
            tools: expect.arrayContaining([
              expect.objectContaining({ confirmationKind: 'apply_patch' }),
              expect.objectContaining({ confirmationKind: 'exec' }),
            ]),
          }),
        }),
      ]),
    );

    sequence = 0;
    const queue = getStudioScenario('queued-attachments').build(
      () => sequence++,
    );
    expect(queue[0]).toMatchObject({
      type: 'host.snapshot',
      queue: { paused: 'turn-failed', items: expect.any(Array) },
    });
    expect(queue[1]).toMatchObject({
      type: 'session.attachments',
      attachments: expect.any(Array),
    });
  });
});

describe('Scenario Studio configuration and runtime', () => {
  it('parses URL configuration and keeps the legacy longHistory link', () => {
    expect(
      parseStudioConfig('?scenario=ask-user&theme=light&width=320'),
    ).toEqual({
      scenario: 'ask-user',
      theme: 'light',
      width: 320,
    });
    expect(parseStudioConfig('?longHistory')).toMatchObject({
      scenario: 'long-history',
    });
    expect(
      parseStudioConfig('?scenario=unknown&theme=purple&width=999'),
    ).toEqual({
      scenario: 'full-workflow',
      theme: 'auto',
      width: 480,
    });
  });

  it('resets persisted state and message sequence when scenarios change', () => {
    vi.useFakeTimers();
    const received: unknown[] = [];
    const listener = (event: MessageEvent<unknown>) => {
      received.push(event.data);
    };
    window.addEventListener('message', listener);
    try {
      const runtime = createStudioRuntime({
        scenario: 'conversation',
        theme: 'dark',
        width: 480,
      });
      runtime.setState({ draft: 'stale draft' });
      runtime.postMessage({
        type: 'webview.ready',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      });
      vi.runAllTimers();
      expect(
        received.find((message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'host.snapshot'
        ),
      ).toMatchObject({ sequence: 0 });

      received.length = 0;
      runtime.configure(
        { scenario: 'streaming', theme: 'light', width: 320 },
        true,
      );
      runtime.postMessage({
        type: 'webview.ready',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      });
      vi.runAllTimers();
      expect(runtime.getState()).toEqual({});
      expect(runtime.getConfig()).toEqual({
        scenario: 'streaming',
        theme: 'light',
        width: 320,
      });
      const sequenced = received.filter(
        (
          message,
        ): message is { readonly type: string; readonly sequence: number } =>
          typeof message === 'object' &&
          message !== null &&
          'sequence' in message,
      );
      expect(sequenced[0]).toMatchObject({
        type: 'host.snapshot',
        sequence: 0,
      });
      expect(sequenced.map((message) => message.sequence)).toEqual(
        sequenced.map((_, index) => index),
      );
    } finally {
      window.removeEventListener('message', listener);
    }
  });
});

describe('Scenario Studio controls', () => {
  it('routes scenario, theme, viewport, and reset selections', () => {
    const onScenarioChange = vi.fn();
    const onThemeChange = vi.fn();
    const onWidthChange = vi.fn();
    const onReset = vi.fn();
    render(
      <StudioControls
        config={{ scenario: 'conversation', theme: 'auto', width: 480 }}
        onScenarioChange={onScenarioChange}
        onThemeChange={onThemeChange}
        onWidthChange={onWidthChange}
        onReset={onReset}
      />,
    );

    fireEvent.change(screen.getByLabelText('Scenario'), {
      target: { value: 'review' },
    });
    fireEvent.change(screen.getByLabelText('Theme'), {
      target: { value: 'light' },
    });
    fireEvent.change(screen.getByLabelText('Viewport'), {
      target: { value: '320' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onScenarioChange).toHaveBeenCalledWith('review');
    expect(onThemeChange).toHaveBeenCalledWith('light');
    expect(onWidthChange).toHaveBeenCalledWith(320);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
