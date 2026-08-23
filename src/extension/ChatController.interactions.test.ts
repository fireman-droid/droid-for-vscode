import { describe, expect, it, vi } from 'vitest';

import {
  connectionMessages,
  createController,
  createMockRuntime,
  deferred,
  interactionRequests,
  type MockRuntime,
  ready,
  retry,
  type RuntimeAskUserResult,
  type RuntimeInteractionHandler,
  type RuntimePermissionResult,
  send,
  stop,
  successfulTurn,
  turnStates,
  waitForConnected,
  waitForInteraction,
} from './controllerTestHarness';

describe('ChatController', () => {
  it('supplies the interaction handler before runtime creation and settles permission and AskUser', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    let permissionResult!: RuntimePermissionResult;
    let askUserResult!: RuntimeAskUserResult;
    const runtime = createMockRuntime(async function* () {
      permissionResult = await interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
          {
            label: 'Edit plan',
            value: 'proceed_edit',
            requiresEditedSpec: true,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Review plan',
            editableSpecContent: '# Plan',
          },
        ],
      });
      askUserResult = await interactionHandler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 3,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes', 'No'],
            multiSelect: false,
          },
        ],
      });
      yield successfulTurn();
    });
    const createRuntime = vi.fn((handler: RuntimeInteractionHandler) => {
      interactionHandler = handler;
      return runtime;
    });
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    expect(createRuntime).toHaveBeenCalledWith(interactionHandler);

    send(controller, 'session-1', 'turn-1', 'Plan');
    const permission = await waitForInteraction(messages, 'permission');
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permission.request.requestId,
      selectedOption: 'proceed_edit',
      editedSpecContent: '# Revised',
    });
    const askUser = await waitForInteraction(messages, 'ask-user');
    controller.handleMessage({
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: askUser.request.requestId,
      cancelled: false,
      answers: [{ index: 3, answer: 'Yes' }],
    });

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(permissionResult).toEqual({
      selectedOption: 'proceed_edit',
      editedSpecContent: '# Revised',
    });
    expect(askUserResult).toEqual({
      answers: [{ index: 3, answer: 'Yes' }],
    });
    expect(
      messages
        .filter((message) => message.type === 'interaction.closed')
        .map(({ requestId }) => requestId),
    ).toEqual([
      permission.request.requestId,
      askUser.request.requestId,
    ]);
    expect(
      messages.filter((message) => message.type === 'interaction.closed').at(-1),
    ).toMatchObject({
      requestId: askUser.request.requestId,
      result: {
        status: 'answered',
        answers: [{ topic: 'Choice', answer: 'Yes' }],
      },
    });
  });

  it('replays every pending interaction after each ready with fresh monotonic sequences', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      void interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      void interactionHandler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController((handler) => {
      interactionHandler = handler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Wait');
    await vi.waitFor(() => {
      expect(interactionRequests(messages)).toHaveLength(2);
    });

    ready(controller);
    ready(controller);
    await vi.waitFor(() => {
      expect(
        interactionRequests(messages).map(
          ({ request }) => `${request.kind}:${request.requestId}`,
        ),
      ).toEqual([
        'permission:interaction-1',
        'ask-user:interaction-2',
        'permission:interaction-1',
        'ask-user:interaction-2',
        'permission:interaction-1',
        'ask-user:interaction-2',
      ]);
    });
    expect(messages.map(({ sequence }) => sequence)).toEqual(
      messages.map((_, index) => index),
    );

    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(
      messages.filter((message) => message.type === 'interaction.closed'),
    ).toHaveLength(2);
  });

  it('cancels pending turn interactions before interrupting on Stop', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    let permission!: Promise<RuntimePermissionResult>;
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      permission = interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      await release.promise;
      yield { ...successfulTurn(), outcome: 'interrupted' };
    });
    runtime.interrupt.mockImplementation(async () => {
      await expect(permission).resolves.toEqual({
        selectedOption: 'cancel',
      });
      release.resolve();
    });
    const { controller, messages } = createController((handler) => {
      interactionHandler = handler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Edit');
    await waitForInteraction(messages, 'permission');

    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });
    expect(runtime.interrupt).toHaveBeenCalledOnce();
    expect(
      messages.filter((message) => message.type === 'interaction.closed'),
    ).toHaveLength(1);
  });

  it('cancels pending interactions on terminal failure and retry replacement', async () => {
    let firstHandler!: RuntimeInteractionHandler;
    let pending!: Promise<RuntimeAskUserResult>;
    const first = createMockRuntime(async function* () {
      pending = firstHandler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      throw new Error('stream failed');
    });
    const replacementRelease = deferred<void>();
    const second = createMockRuntime(async function* () {
      await replacementRelease.promise;
      yield successfulTurn();
    });
    const createRuntime = vi
      .fn<(handler: RuntimeInteractionHandler) => MockRuntime>()
      .mockImplementationOnce((handler) => {
        firstHandler = handler;
        return first;
      })
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Ask');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });
    await expect(pending).resolves.toEqual({
      cancelled: true,
      answers: [],
    });

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(connectionMessages(messages).at(-1)?.connection.status).toBe(
        'connected',
      );
    });
    expect(first.dispose).toHaveBeenCalledOnce();

    send(controller, 'session-1', 'turn-2', 'Replacement');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.turnId).toBe('turn-2');
    });
    const interactionCount = interactionRequests(messages).length;
    await expect(
      firstHandler.askUser({
        toolCallId: 'stale-ask',
        questions: [
          {
            index: 0,
            topic: 'Stale',
            question: 'Wrong runtime?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      }),
    ).resolves.toEqual({ cancelled: true, answers: [] });
    expect(interactionRequests(messages)).toHaveLength(interactionCount);
    replacementRelease.resolve();
  });

  it('settles every pending interaction when the controller is disposed', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    let pending!: Promise<RuntimePermissionResult>;
    const never = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      pending = interactionHandler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      await never.promise;
    });
    const { controller, messages } = createController((handler) => {
      interactionHandler = handler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Edit');
    await waitForInteraction(messages, 'permission');

    await controller.dispose();

    await expect(pending).resolves.toEqual({
      selectedOption: 'cancel',
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
