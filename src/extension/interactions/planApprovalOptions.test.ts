import { ToolConfirmationOutcome as Outcome, ToolConfirmationType, type RequestPermissionRequestParams } from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeInteractionCallbacks } from '../../runtime/events/runtimeInteractions';
import type { RuntimeAutonomyLevel } from '../../runtime/DroidRuntime';
import { PendingInteractionCoordinator } from './pendingInteractionCoordinator';

const sameSession = [Outcome.ProceedOnce, Outcome.ProceedAutoRunLow, Outcome.ProceedAutoRunMedium, Outcome.ProceedAutoRunHigh];
const newSession = [Outcome.ProceedNewSession, Outcome.ProceedNewSessionLow, Outcome.ProceedNewSessionMedium, Outcome.ProceedNewSessionHigh];

describe('plan approval autonomy', () => {
  it.each([
    ['off', false, Outcome.ProceedOnce],
    ['low', false, Outcome.ProceedAutoRunLow],
    ['medium', false, Outcome.ProceedAutoRunMedium],
    ['high', false, Outcome.ProceedAutoRunHigh],
    ['off', true, Outcome.ProceedNewSession],
    ['low', true, Outcome.ProceedNewSessionLow],
    ['medium', true, Outcome.ProceedNewSessionMedium],
    ['high', true, Outcome.ProceedNewSessionHigh],
  ] as const)('defaults to %s autonomy (new session: %s) and returns the supplied SDK outcome', async (autonomy, fresh, expected) => {
    // Include both destinations to catch accidentally moving a same-session approval to a new session.
    const values = fresh ? [...newSession, ...sameSession] : [...sameSession, ...newSession];
    const { coordinator, result, published, readAutonomy } = requestPlan(autonomy, values);
    const pending = coordinator.snapshotPending()[0]!;
    if (pending.request.kind !== 'permission') throw new Error('Expected permission');
    expect(readAutonomy).toHaveBeenCalledWith('session');
    const primary = pending.request.options.find((option) =>
      !option.requiresEditedSpec && option.value !== Outcome.Cancel);
    expect(primary?.value).toBe(expected);
    expect(new Set(pending.request.options.map((option) => option.value))).toEqual(new Set([
      ...values, Outcome.Cancel, Outcome.ProceedEdit,
    ]));
    coordinator.replayPending();
    expect(published.mock.calls.at(-1)?.[0]).toEqual(pending);
    coordinator.respondPermission({
      type: 'permission.respond', sessionId: 'session', turnId: 'turn',
      requestId: pending.request.requestId, selectedOption: expected,
    });
    await expect(result).resolves.toBe(expected);
  });

  it.each([Outcome.ProceedOnce, Outcome.ProceedNewSessionLow, Outcome.Cancel])(
    'keeps an explicit alternate choice %s despite high autonomy', async (selectedOption) => {
      const { coordinator, result } = requestPlan('high', [...sameSession, ...newSession]);
      coordinator.respondPermission({
        type: 'permission.respond', sessionId: 'session', turnId: 'turn',
        requestId: coordinator.snapshotPending()[0]!.request.requestId, selectedOption,
      });
      await expect(result).resolves.toBe(selectedOption);
    },
  );

  it.each([
    [undefined, sameSession],
    ['high', [Outcome.ProceedOnce, Outcome.ProceedAutoRunLow]],
    ['off', [Outcome.ProceedAutoRunHigh, Outcome.ProceedOnce]],
  ] as const)('does not invent options when autonomy is %s', async (autonomy, values) => {
    const { coordinator, result } = requestPlan(autonomy, [...values]);
    const pending = coordinator.snapshotPending()[0]!;
    if (pending.request.kind !== 'permission') throw new Error('Expected permission');
    const positive = pending.request.options.filter((option) =>
      option.value !== Outcome.Cancel && !option.requiresEditedSpec);
    expect(positive[0]?.value).toBe(autonomy === 'off' ? Outcome.ProceedOnce : values[0]);
    expect(positive).toHaveLength(values.length);
    coordinator.cancelAll();
    await expect(result).resolves.toBe(Outcome.Cancel);
  });

  it('leaves ordinary tool permissions in their supplied order', async () => {
    const coordinator = new PendingInteractionCoordinator(() => {}, () => {}, () => 'high');
    const handler = coordinator.createRuntimeHandler();
    coordinator.beginTurn('session', 'turn');
    const options = sameSession.map((value) => ({ label: value, value, requiresEditedSpec: false }));
    const result = handler.requestPermission({ options, toolUses: [{
      toolUseId: 'edit', toolName: 'Edit', confirmationKind: 'edit', title: 'Edit app.ts',
    }] });
    expect(coordinator.snapshotPending()[0]?.request).toMatchObject({ options });
    coordinator.cancelAll();
    await expect(result).resolves.toEqual({ selectedOption: Outcome.Cancel });
  });
});

function requestPlan(autonomy: RuntimeAutonomyLevel | undefined, values: Outcome[]) {
  const published = vi.fn();
  const readAutonomy = vi.fn(() => autonomy);
  const coordinator = new PendingInteractionCoordinator(published, () => {}, readAutonomy);
  const callbacks = createRuntimeInteractionCallbacks(coordinator.createRuntimeHandler());
  coordinator.beginTurn('session', 'turn');
  const result = callbacks.permissionHandler({
    toolUses: [{
      toolUse: {
        type: 'tool_use' as RequestPermissionRequestParams['toolUses'][number]['toolUse']['type'],
        id: 'plan', name: 'ExitSpecMode', input: {},
      },
      confirmationType: ToolConfirmationType.ExitSpecMode,
      details: { type: ToolConfirmationType.ExitSpecMode, title: 'Plan', plan: '# Plan' },
    }],
    options: [Outcome.Cancel, Outcome.ProceedEdit, ...values].map((value) => ({ label: value, value })),
  });
  return { coordinator, result, published, readAutonomy };
}
