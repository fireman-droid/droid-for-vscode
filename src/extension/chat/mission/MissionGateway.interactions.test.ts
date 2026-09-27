import {
  AutonomyLevel,
  DroidInteractionMode,
  ReasoningEffort,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type DaemonSessionController,
  type RequestPermissionRequestParams,
  type SessionSettings,
} from '@factory/droid-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { DaemonApi, DaemonHandlers } from '../../../runtime/daemon/api';
import { RetainedDaemonSession } from '../../../runtime/daemon/sessionHandle';
import { PendingInteractionCoordinator } from '../../interactions/pendingInteractionCoordinator';
import { MissionGateway } from './MissionGateway';
import { MissionPreferenceStore } from './MissionPreferences';
import { createMissionRuntime } from './MissionRuntime';

const pair = { modelId: 'gemini-test', reasoningEffort: 'high' as const };
const input = {
  workspaceId: 'workspace-a',
  cwd: 'C:/mission-test',
  catalog: [{ id: pair.modelId, supportedReasoningEfforts: ['high' as const] }],
  message: {
    type: 'mission.start' as const,
    protocolVersion: 25 as const,
    requestId: 'start-1',
    scope: 'selected-chat' as const,
    task: 'Implement duration formatting',
    orchestrator: pair,
    worker: { ...pair, mode: 'same-as-orchestrator' as const },
    validator: { ...pair, mode: 'same-as-orchestrator' as const },
    scrutinyEnabled: true,
    userTestingEnabled: true,
  },
};

function setup(failAt?: 'create' | 'settings' | 'initialize') {
  const requests: Parameters<ConstructorParameters<typeof PendingInteractionCoordinator>[0]>[0][] = [];
  const coordinator = new PendingInteractionCoordinator(request => requests.push(request), () => {});
  const previousHandler = coordinator.createRuntimeHandler();
  const prepareInteractions = vi.fn(() => coordinator.prepareRuntimeHandler());
  let session: RetainedDaemonSession;
  const settings: SessionSettings = {
    modelId: pair.modelId,
    reasoningEffort: ReasoningEffort.High,
    interactionMode: DroidInteractionMode.Auto,
    autonomyLevel: AutonomyLevel.Medium,
  } as SessionSettings;
  const sessionController = { on: vi.fn(), off: vi.fn() } as unknown as DaemonSessionController;
  const unregister = vi.fn();
  const create = vi.fn(async (options: DaemonHandlers) => {
    if (failAt === 'create') throw new Error('creation failed');
    session = new RetainedDaemonSession(sessionController, 'mission-1', options, unregister);
    session.initialize(settings, input.cwd);
    return session;
  });
  const droid = {
    sessions: {
      create,
      resume: vi.fn(),
      updateSettings: vi.fn(async (_id: string, update: Partial<SessionSettings>) => {
        if (failAt === 'settings') throw new Error('settings failed');
        session.initialize({ ...session.settings, ...update }, input.cwd);
      }),
    },
  } as unknown as DaemonApi;
  const lease = {
    acquire: () => {
      if (failAt === 'initialize') throw new Error('lease failed');
      return { acquired: true } as const;
    },
    release: vi.fn(),
  };
  const gateway = new MissionGateway({
    getDroid: async () => droid,
    preferences: new MissionPreferenceStore({ get: () => undefined, update: async () => {} }),
    prepareInteractions,
    createRuntime: (handle, daemon, orchestrator, interactions) =>
      createMissionRuntime(handle, daemon, interactions, orchestrator, lease),
  });
  return { gateway, coordinator, previousHandler, prepareInteractions, requests, create, unregister,
    session: () => session, droid };
}

function permissionRequest(kind: 'propose' | 'start'): RequestPermissionRequestParams {
  const details = kind === 'propose'
    ? { type: ToolConfirmationType.ProposeMission, title: 'Duration library', proposal: 'Build and verify a duration library.' }
    : { type: ToolConfirmationType.StartMissionRun, runningMissionCount: 0, runningMissionSessionIds: [] };
  return {
    options: [
      { label: 'Approve', value: ToolConfirmationOutcome.ProceedOnce },
      { label: 'Cancel', value: ToolConfirmationOutcome.Cancel },
    ],
    toolUses: [{
      toolUse: { type: 'tool_use', id: `${kind}-1`, name: kind === 'propose' ? 'propose_mission' : 'start_mission_run', input: {} },
      confirmationType: details.type,
      details,
    }],
  } as RequestPermissionRequestParams;
}

describe('Mission attachment interaction ownership', () => {
  it('keeps plan approval, run approval and AskUser pending for the selected Mission until the user responds', async () => {
    const mock = setup();
    const result = await mock.gateway.start(input);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Mission did not start');
    result.activateInteractions();
    mock.coordinator.beginTurn(result.sessionId, 'turn-1');

    for (const kind of ['propose', 'start'] as const) {
      let settled = false;
      const answer = Promise.resolve(mock.session().handlers.permissionHandler!(permissionRequest(kind)))
        .then(value => { settled = true; return value; });
      await Promise.resolve();
      expect(settled).toBe(false);
      const projection = mock.requests.at(-1)!;
      expect(projection).toMatchObject({
        sessionId: 'mission-1', turnId: 'turn-1',
        request: { kind: 'permission', tools: [{ confirmationKind: kind === 'propose' ? 'propose_mission' : 'start_mission_run' }] },
      });
      expect(mock.coordinator.respondPermission({
        type: 'permission.respond', sessionId: 'mission-1', turnId: 'turn-1',
        requestId: projection.request.requestId, selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })).toBe(true);
      await expect(answer).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    }

    const answer = mock.session().handlers.askUserHandler!({
      toolCallId: 'question-1',
      questions: [{ index: 0, topic: 'Formatting', question: 'Pad minutes?', options: ['Yes', 'No'] }],
    });
    const question = mock.requests.at(-1)!;
    expect(question.request.kind).toBe('ask-user');
    expect(mock.coordinator.respondAskUser({
      type: 'ask-user.respond', sessionId: 'mission-1', turnId: 'turn-1',
      requestId: question.request.requestId, cancelled: false, answers: [{ index: 0, answer: 'Yes' }],
    })).toBe(true);
    await expect(answer).resolves.toEqual({ answers: [{ index: 0, question: 'Pad minutes?', answer: 'Yes' }] });
    expect(mock.prepareInteractions).toHaveBeenCalledOnce();
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.droid.sessions.resume).not.toHaveBeenCalled();
    await result.runtime.runtime.dispose();
  });

  it.each(['create', 'settings', 'initialize'] as const)('retains the previous chat permission owner after %s fails', async failAt => {
    const mock = setup(failAt);
    await expect(mock.gateway.start(input)).resolves.toEqual({ status: 'rejected', code: 'daemon-unavailable' });
    mock.coordinator.beginTurn('previous-chat', 'previous-turn');
    const answer = mock.previousHandler.requestPermission({
      options: [{ label: 'Approve', value: ToolConfirmationOutcome.ProceedOnce, requiresEditedSpec: false }],
      toolUses: [{ toolUseId: 'edit-1', toolName: 'Edit', confirmationKind: 'edit', title: 'Edit duration.js' }],
    });
    const request = mock.requests.at(-1)!;
    expect(request).toMatchObject({ sessionId: 'previous-chat', turnId: 'previous-turn' });
    expect(mock.coordinator.respondPermission({
      type: 'permission.respond', sessionId: 'previous-chat', turnId: 'previous-turn',
      requestId: request.request.requestId, selectedOption: ToolConfirmationOutcome.ProceedOnce,
    })).toBe(true);
    await expect(answer).resolves.toEqual({ selectedOption: ToolConfirmationOutcome.ProceedOnce });
    expect(mock.unregister).toHaveBeenCalledTimes(failAt === 'create' ? 0 : 1);
  });
});
