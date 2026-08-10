import {
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk/node';
import { describe, expect, it } from 'vitest';

import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  type AskUserRespondMessage,
  type PermissionRespondMessage,
} from '../shared/bridgeMessages';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from '../runtime/runtimeInteractions';
import { readHostMessage } from '../webview/bridge/validateHostMessage';
import {
  MAX_PENDING_INTERACTIONS,
  PendingInteractionCoordinator,
} from './pendingInteractionCoordinator';

describe('PendingInteractionCoordinator', () => {
  it('projects permission options and hoists only editable ExitSpecMode content', async () => {
    const { coordinator, handler, requests, closed } = createCoordinator();
    coordinator.beginTurn('session-1', 'turn-1');

    const result = handler.requestPermission({
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
          detail: 'Plan detail',
          editableSpecContent: '# Editable plan',
        },
        {
          toolUseId: 'tool-2',
          toolName: 'Edit',
          confirmationKind: 'edit',
          title: 'Edit file',
          editableSpecContent: 'must not be projected',
        },
      ],
    });

    expect(requests).toEqual([
      {
        sessionId: 'session-1',
        turnId: 'turn-1',
        request: {
          requestId: 'interaction-1',
          kind: 'permission',
          editableSpecContent: '# Editable plan',
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
          tools: [
            {
              toolUseId: 'tool-1',
              toolName: 'ExitSpecMode',
              confirmationKind: 'exit_spec_mode',
              title: 'Review plan',
              detail: 'Plan detail',
            },
            {
              toolUseId: 'tool-2',
              toolName: 'Edit',
              confirmationKind: 'edit',
              title: 'Edit file',
            },
          ],
        },
      },
    ]);

    expect(
      coordinator.respondPermission(
        permissionResponse('interaction-1', 'proceed_edit'),
      ),
    ).toBe(false);
    expect(
      coordinator.respondPermission({
        ...permissionResponse('interaction-1', 'proceed_edit'),
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH + 1),
      }),
    ).toBe(false);
    expect(
      coordinator.respondPermission({
        ...permissionResponse('interaction-1', 'proceed_edit'),
        editedSpecContent: '# Revised plan',
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({
      selectedOption: 'proceed_edit',
      editedSpecContent: '# Revised plan',
    });
    expect(closed).toEqual([
      {
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'interaction-1',
      },
    ]);
  });

  it('ignores stale, wrong-kind, duplicate, and invalid permission replies', async () => {
    const { coordinator, handler, closed } = createCoordinator();
    coordinator.beginTurn('session-1', 'turn-1');
    const result = handler.requestPermission({
      options: [
        {
          label: 'Proceed',
          value: 'proceed',
          requiresEditedSpec: false,
        },
      ],
      toolUses: [permissionTool()],
    });

    expect(
      coordinator.respondPermission({
        ...permissionResponse('interaction-1', 'proceed'),
        sessionId: 'wrong-session',
      }),
    ).toBe(false);
    expect(
      coordinator.respondAskUser({
        type: 'ask-user.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'interaction-1',
        cancelled: true,
        answers: [],
      }),
    ).toBe(false);
    expect(
      coordinator.respondPermission(
        permissionResponse('interaction-1', 'unknown'),
      ),
    ).toBe(false);
    expect(
      coordinator.respondPermission({
        ...permissionResponse('interaction-1', 'proceed'),
        editedSpecContent: 'unexpected',
      }),
    ).toBe(false);
    expect(
      coordinator.respondPermission(
        permissionResponse('interaction-1', 'proceed'),
      ),
    ).toBe(true);
    expect(
      coordinator.respondPermission(
        permissionResponse('interaction-1', 'proceed'),
      ),
    ).toBe(false);

    await expect(result).resolves.toEqual({ selectedOption: 'proceed' });
    expect(closed).toHaveLength(1);
  });

  it('validates cancellation and exactly one non-empty AskUser answer per index', async () => {
    const { coordinator, handler } = createCoordinator();
    coordinator.beginTurn('session-1', 'turn-1');
    const first = handler.askUser({
      toolCallId: 'ask-1',
      questions: [
        question(2, 'First?'),
        question(7, 'Second?'),
      ],
    });

    expect(
      coordinator.respondAskUser(
        askResponse('interaction-1', true, [{ index: 2, answer: 'No' }]),
      ),
    ).toBe(false);
    expect(
      coordinator.respondAskUser(
        askResponse('interaction-1', false, [
          { index: 2, answer: 'Yes' },
          { index: 8, answer: 'Wrong index' },
        ]),
      ),
    ).toBe(false);
    expect(
      coordinator.respondAskUser(
        askResponse('interaction-1', false, [
          { index: 2, answer: 'Yes' },
          { index: 7, answer: '' },
        ]),
      ),
    ).toBe(false);
    expect(
      coordinator.respondAskUser(
        askResponse('interaction-1', false, [
          {
            index: 2,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH + 1),
          },
          { index: 7, answer: 'Second' },
        ]),
      ),
    ).toBe(false);
    expect(
      coordinator.respondAskUser(
        askResponse('interaction-1', false, [
          { index: 7, answer: 'Second' },
          { index: 2, answer: 'First' },
        ]),
      ),
    ).toBe(true);
    await expect(first).resolves.toEqual({
      answers: [
        { index: 7, answer: 'Second' },
        { index: 2, answer: 'First' },
      ],
    });

    const cancelled = handler.askUser({
      toolCallId: 'ask-2',
      questions: [question(0, 'Continue?')],
    });
    expect(
      coordinator.respondAskUser(
        askResponse('interaction-2', true, []),
      ),
    ).toBe(true);
    await expect(cancelled).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
  });

  it('keeps concurrent promises independent and replays requests in insertion order', async () => {
    const { coordinator, handler, requests, closed } = createCoordinator();
    coordinator.beginTurn('session-1', 'turn-1');
    const permission = handler.requestPermission({
      options: [
        {
          label: 'Proceed',
          value: 'proceed',
          requiresEditedSpec: false,
        },
      ],
      toolUses: [permissionTool()],
    });
    const askUser = handler.askUser({
      toolCallId: 'ask-1',
      questions: [question(0, 'Continue?')],
    });

    expect(coordinator.hasPending()).toBe(true);
    coordinator.replayPending();
    expect(
      requests.map(({ request }) => `${request.kind}:${request.requestId}`),
    ).toEqual([
      'permission:interaction-1',
      'ask-user:interaction-2',
      'permission:interaction-1',
      'ask-user:interaction-2',
    ]);

    coordinator.respondAskUser(
      askResponse('interaction-2', false, [
        { index: 0, answer: 'Yes' },
      ]),
    );
    coordinator.respondPermission(
      permissionResponse('interaction-1', 'proceed'),
    );
    await expect(askUser).resolves.toEqual({
      answers: [{ index: 0, answer: 'Yes' }],
    });
    await expect(permission).resolves.toEqual({
      selectedOption: 'proceed',
    });
    expect(coordinator.hasPending()).toBe(false);
    expect(closed.map(({ requestId }) => requestId)).toEqual([
      'interaction-2',
      'interaction-1',
    ]);
  });

  it('cancels a turn exactly once and fails closed on pending overflow', async () => {
    const { coordinator, handler, requests, closed } = createCoordinator();
    coordinator.beginTurn('session-1', 'turn-1');
    const pending = Array.from(
      { length: MAX_PENDING_INTERACTIONS },
      (_, index) =>
        handler.askUser({
          toolCallId: `ask-${index}`,
          questions: [question(index, 'Continue?')],
        }),
    );

    const overflow = handler.requestPermission({
      options: [
        {
          label: 'Proceed',
          value: 'proceed',
          requiresEditedSpec: false,
        },
      ],
      toolUses: [permissionTool()],
    });
    await expect(overflow).resolves.toEqual({
      selectedOption: 'cancel',
    });
    expect(requests).toHaveLength(MAX_PENDING_INTERACTIONS);

    coordinator.endTurn('session-1', 'turn-1');
    coordinator.endTurn('session-1', 'turn-1');
    await expect(Promise.all(pending)).resolves.toEqual(
      Array.from({ length: MAX_PENDING_INTERACTIONS }, () => ({
        cancelled: true,
        answers: [],
      })),
    );
    expect(closed).toHaveLength(MAX_PENDING_INTERACTIONS);
  });

  it('fails closed when an old runtime handler is used after replacement', async () => {
    const { coordinator, handler: oldHandler, requests } =
      createCoordinator();
    coordinator.beginTurn('session-1', 'turn-1');

    const newHandler = coordinator.createRuntimeHandler();
    coordinator.beginTurn('session-1', 'turn-2');

    await expect(
      oldHandler.askUser({
        toolCallId: 'stale-call',
        questions: [question(0, 'Stale?')],
      }),
    ).resolves.toEqual({ cancelled: true, answers: [] });
    expect(requests).toHaveLength(0);

    const current = newHandler.askUser({
      toolCallId: 'current-call',
      questions: [question(0, 'Current?')],
    });
    expect(requests).toHaveLength(1);
    coordinator.endTurn('session-1', 'turn-2');
    await expect(current).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
  });

  it('emits maximum runtime projections accepted by the host validator and rejects overflows before pending', async () => {
    const { coordinator, handler, requests } = createCoordinator();
    coordinator.beginTurn(
      's'.repeat(MAX_BRIDGE_ID_LENGTH),
      't'.repeat(MAX_BRIDGE_ID_LENGTH),
    );
    const callbacks = createRuntimeInteractionCallbacks(handler);
    const maximum = maximumPermissionRequest();

    const pending = callbacks.permissionHandler(maximum);
    expect(requests).toHaveLength(1);
    expect(
      readHostMessage({
        type: 'interaction.request',
        sequence: 0,
        ...requests[0],
      }),
    ).toBeDefined();

    const projection = requests[0]!;
    expect(
      coordinator.respondPermission({
        type: 'permission.respond',
        sessionId: projection.sessionId,
        turnId: projection.turnId,
        requestId: projection.request.requestId,
        selectedOption: ToolConfirmationOutcome.Cancel,
      }),
    ).toBe(true);
    await expect(pending).resolves.toBe(ToolConfirmationOutcome.Cancel);

    const overTitle = maximumPermissionRequest();
    (
      overTitle.toolUses[0]!.details as {
        title: string;
      }
    ).title = 'x'.repeat(MAX_INTERACTION_TITLE_LENGTH + 1);
    await expect(
      callbacks.permissionHandler(overTitle),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);

    const overCount = maximumPermissionRequest();
    overCount.toolUses.push(overCount.toolUses[0]!);
    await expect(
      callbacks.permissionHandler(overCount),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
    expect(requests).toHaveLength(1);
  });
});

function createCoordinator() {
  const requests: Parameters<
    ConstructorParameters<typeof PendingInteractionCoordinator>[0]
  >[0][] = [];
  const closed: Parameters<
    ConstructorParameters<typeof PendingInteractionCoordinator>[1]
  >[0][] = [];
  const coordinator = new PendingInteractionCoordinator(
    (request) => requests.push(request),
    (request) => closed.push(request),
  );
  const handler = coordinator.createRuntimeHandler();
  return { coordinator, handler, requests, closed };
}

function permissionTool() {
  return {
    toolUseId: 'tool-1',
    toolName: 'Edit',
    confirmationKind: 'edit' as const,
    title: 'Edit a file',
  };
}

function question(index: number, text: string) {
  return {
    index,
    topic: 'Decision',
    question: text,
    options: ['Yes', 'No'],
    multiSelect: false,
  };
}

function permissionResponse(
  requestId: string,
  selectedOption: string,
): PermissionRespondMessage {
  return {
    type: 'permission.respond',
    sessionId: 'session-1',
    turnId: 'turn-1',
    requestId,
    selectedOption,
  };
}

function askResponse(
  requestId: string,
  cancelled: boolean,
  answers: AskUserRespondMessage['answers'],
): AskUserRespondMessage {
  return {
    type: 'ask-user.respond',
    sessionId: 'session-1',
    turnId: 'turn-1',
    requestId,
    cancelled,
    answers,
  };
}

function maximumPermissionRequest(): RequestPermissionRequestParams {
  const tools = Array.from({ length: MAX_PERMISSION_TOOLS }, (_, index) => ({
    toolUse: {
      type: 'tool_use',
      id:
        index === 0
          ? 'i'.repeat(MAX_BRIDGE_ID_LENGTH)
          : `tool-${index}`,
      name: 'n'.repeat(MAX_PERMISSION_TOOL_NAME_LENGTH),
      input: {},
    },
    confirmationType: ToolConfirmationType.ExitSpecMode,
    details: {
      type: ToolConfirmationType.ExitSpecMode,
      title: 't'.repeat(MAX_INTERACTION_TITLE_LENGTH),
      plan: 'p'.repeat(MAX_EDITED_SPEC_LENGTH),
    },
  }));
  const options = Array.from(
    { length: MAX_PERMISSION_OPTIONS },
    (_, index) => ({
      label: 'l'.repeat(MAX_PERMISSION_OPTION_LABEL_LENGTH),
      value:
        index === 0
          ? ToolConfirmationOutcome.Cancel
          : `${index}`.padEnd(MAX_PERMISSION_OPTION_VALUE_LENGTH, 'v'),
    }),
  );

  return { toolUses: tools, options } as RequestPermissionRequestParams;
}
