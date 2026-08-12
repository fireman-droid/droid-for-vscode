import {
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type AskUserRequestParams,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_TOOL_NAME_LENGTH,
  MAX_SPEC_PLAN_LENGTH,
} from '../shared/interactionProtocol';
import {
  MAX_RUNTIME_DETAIL_LENGTH,
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
  type RuntimePermissionRequest,
} from './runtimeInteractions';

describe('runtime permission interactions', () => {
  it('projects every SDK confirmation category without exposing raw tool input', async () => {
    let projected: RuntimePermissionRequest | undefined;
    const handler = createHandler({
      requestPermission: async (request) => {
        projected = request;
        return { selectedOption: ToolConfirmationOutcome.Cancel };
      },
    });
    const callbacks = createRuntimeInteractionCallbacks(handler);

    await expect(
      callbacks.permissionHandler(
        permissionRequest([
          details('edit', {
            filePath: 'C:\\workspace\\old.ts',
            fileName: 'old.ts',
            oldContent: 'before',
            newContent: 'after',
          }),
          details('exec', {
            command: 'pnpm',
            fullCommand: 'pnpm test',
            extractedCommands: ['pnpm test'],
            impactLevel: 'medium',
            riskLevelReason: 'Runs project tests',
          }),
          details('create', {
            filePath: 'C:\\workspace\\new.ts',
            fileName: 'new.ts',
            content: 'export {}',
          }),
          details('ask_user', {
            questionnaire: 'Which environment?',
            parsed: {
              questions: [
                {
                  index: 0,
                  topic: 'Environment',
                  question: 'Which environment?',
                  options: ['Staging'],
                },
              ],
            },
          }),
          details('exit_spec_mode', {
            title: 'Implementation plan',
            plan: '1. Make the change',
          }),
          details('propose_mission', {
            title: 'Ship feature',
            proposal: 'Implement and verify the feature.',
          }),
          details('start_mission_run', {
            runningMissionCount: 2,
            runningMissionSessionIds: ['session-a', 'session-b'],
          }),
          details('apply_patch', {
            filePath: 'C:\\workspace\\file.ts',
            fileName: 'file.ts',
            patchContent: '@@ patch',
            oldContent: 'old',
            newContent: 'new',
          }),
          details('mcp_tool', {
            toolName: 'lookup',
            impactLevel: 'low',
            serverName: 'docs',
            actualToolName: 'search_docs',
          }),
          details('sandbox_violation', {
            violatingToolName: 'Write',
            target: 'C:\\outside.txt',
            operationType: 'write',
            violationType: 'outside_workspace',
            reason: 'Target is outside the workspace',
            violationReason: 'outside_workspace',
            isOrgDeny: false,
          }),
          details('droid_shield_violation', {
            command: 'dangerous command',
            reason: 'Command is blocked by Droid Shield',
          }),
        ]),
      ),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);

    expect(projected?.toolUses).toEqual([
      expect.objectContaining({
        confirmationKind: 'edit',
        title: 'Edit old.ts',
        detail: expect.stringContaining('C:\\workspace\\old.ts'),
      }),
      expect.objectContaining({
        confirmationKind: 'exec',
        title: 'Run pnpm',
        detail: expect.stringContaining('pnpm test'),
        riskNote: expect.stringContaining('Runs project tests'),
      }),
      expect.objectContaining({
        confirmationKind: 'create',
        title: 'Create new.ts',
        detail: expect.stringContaining('export {}'),
      }),
      expect.objectContaining({
        confirmationKind: 'ask_user',
        title: 'Ask user',
        detail: expect.stringContaining('Which environment?'),
      }),
      expect.objectContaining({
        confirmationKind: 'exit_spec_mode',
        title: 'Implementation plan',
        detail: '1. Make the change',
        editableSpecContent: '1. Make the change',
      }),
      expect.objectContaining({
        confirmationKind: 'propose_mission',
        title: 'Ship feature',
        detail: 'Implement and verify the feature.',
      }),
      expect.objectContaining({
        confirmationKind: 'start_mission_run',
        title: 'Start mission run',
        detail: expect.stringContaining('session-a'),
      }),
      expect.objectContaining({
        confirmationKind: 'apply_patch',
        title: 'Apply patch to file.ts',
        detail: expect.stringContaining('@@ patch'),
      }),
      expect.objectContaining({
        confirmationKind: 'mcp_tool',
        title: 'Run MCP tool lookup',
        riskNote: 'Impact: low',
      }),
      expect.objectContaining({
        confirmationKind: 'sandbox_violation',
        title: 'Allow sandbox exception for Write',
        detail: expect.stringContaining('C:\\outside.txt'),
        riskNote: expect.stringContaining('outside the workspace'),
      }),
      expect.objectContaining({
        confirmationKind: 'droid_shield_violation',
        title: 'Allow blocked command',
        detail: 'dangerous command',
        riskNote: 'Command is blocked by Droid Shield',
      }),
    ]);
    expect(JSON.stringify(projected)).not.toContain('RAW_INPUT_SECRET');
    expect(
      projected?.toolUses.filter(
        ({ editableSpecContent }) => editableSpecContent !== undefined,
      ),
    ).toHaveLength(1);
  });

  it('returns only an exact SDK-provided non-edit option', async () => {
    const selectedOption =
      ToolConfirmationOutcome.ProceedAlwaysForExactPath;
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({
        requestPermission: async () => ({ selectedOption }),
      }),
    );

    await expect(
      callbacks.permissionHandler(
        permissionRequest(
          [
            details('create', {
              filePath: 'C:\\workspace\\new.ts',
              fileName: 'new.ts',
              content: 'content',
            }),
          ],
          [
            {
              label: 'Trust only this file',
              value: selectedOption,
            },
          ],
        ),
      ),
    ).resolves.toBe(selectedOption);
  });

  it('supports ProceedEdit only for ExitSpecMode with bounded edited content', async () => {
    const handler = createHandler({
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedEdit,
        editedSpecContent: 'Edited plan',
      })),
    });
    const callbacks = createRuntimeInteractionCallbacks(handler);

    await expect(
      callbacks.permissionHandler(
        permissionRequest(
          [details('exit_spec_mode', { plan: 'Original plan' })],
          [
            {
              label: 'Proceed with edits',
              value: ToolConfirmationOutcome.ProceedEdit,
            },
          ],
        ),
      ),
    ).resolves.toEqual({
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
      editedSpecContent: 'Edited plan',
    });

    vi.mocked(handler.requestPermission).mockResolvedValueOnce({
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
    });
    await expect(
      callbacks.permissionHandler(
        permissionRequest(
          [details('exit_spec_mode', { plan: 'Original plan' })],
          [
            {
              label: 'Proceed with edits',
              value: ToolConfirmationOutcome.ProceedEdit,
            },
          ],
        ),
      ),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);

    vi.mocked(handler.requestPermission).mockResolvedValueOnce({
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
      editedSpecContent: 'Edited plan',
    });
    await expect(
      callbacks.permissionHandler(
        permissionRequest(
          [
            details('create', {
              filePath: 'C:\\workspace\\new.ts',
              fileName: 'new.ts',
              content: 'content',
            }),
          ],
          [
            {
              label: 'Proceed with edits',
              value: ToolConfirmationOutcome.ProceedEdit,
            },
          ],
        ),
      ),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
  });

  it('accepts empty and exact-limit edited specs and rejects one character over', async () => {
    const requestPermission = vi
      .fn()
      .mockResolvedValueOnce({
        selectedOption: ToolConfirmationOutcome.ProceedEdit,
        editedSpecContent: '',
      })
      .mockResolvedValueOnce({
        selectedOption: ToolConfirmationOutcome.ProceedEdit,
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH),
      })
      .mockResolvedValueOnce({
        selectedOption: ToolConfirmationOutcome.ProceedEdit,
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH + 1),
      });
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission }),
    );
    const request = permissionRequest(
      [details('exit_spec_mode', { plan: 'Original plan' })],
      [
        {
          label: 'Proceed with edits',
          value: ToolConfirmationOutcome.ProceedEdit,
        },
      ],
    );

    await expect(callbacks.permissionHandler(request)).resolves.toEqual({
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
      editedSpecContent: '',
    });
    await expect(callbacks.permissionHandler(request)).resolves.toEqual({
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
      editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH),
    });
    await expect(callbacks.permissionHandler(request)).resolves.toBe(
      ToolConfirmationOutcome.Cancel,
    );
  });

  it.each([
    {
      name: 'a selection not supplied by the SDK',
      result: { selectedOption: ToolConfirmationOutcome.ProceedAlways },
    },
    {
      name: 'a malformed result',
      result: { selectedOption: 42 },
    },
  ])('fails closed for $name', async ({ result }) => {
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({
        requestPermission: async () => result as never,
      }),
    );

    await expect(
      callbacks.permissionHandler(basicPermissionRequest()),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
  });

  it('fails closed for handler rejection and future confirmation types, reporting each auto-cancel', async () => {
    const rejectedAutoCancels = vi.fn();
    const rejectingHandler = createHandler({
      requestPermission: async () => {
        throw new Error('sensitive host failure');
      },
      onAutoCancelled: rejectedAutoCancels,
    });
    const rejectingCallbacks =
      createRuntimeInteractionCallbacks(rejectingHandler);
    await expect(
      rejectingCallbacks.permissionHandler(basicPermissionRequest()),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
    expect(rejectedAutoCancels).toHaveBeenCalledWith({
      interaction: 'permission',
      reason: 'handler-error',
    });

    const onAutoCancelled = vi.fn();
    const requestPermission = vi.fn(async () => ({
      selectedOption: ToolConfirmationOutcome.Cancel,
    }));
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission, onAutoCancelled }),
    );
    const future = basicPermissionRequest();
    future.toolUses[0]!.confirmationType = 'future_type' as never;
    future.toolUses[0]!.details = { type: 'future_type' } as never;
    await expect(callbacks.permissionHandler(future)).resolves.toBe(
      ToolConfirmationOutcome.Cancel,
    );
    expect(requestPermission).not.toHaveBeenCalled();
    expect(onAutoCancelled).toHaveBeenCalledWith({
      interaction: 'permission',
      reason: 'invalid-request',
    });
  });

  it('projects an oversized ApplyPatch request as a truncated card instead of cancelling', async () => {
    // Regression for the "ApplyPatch Failed 1m26s" incident: a ~35.8K
    // patch detail failed the generic 32K display bound, nulled the
    // whole projection, and auto-cancelled the approval without the
    // permission card ever opening. Display details now truncate.
    let projected: RuntimePermissionRequest | undefined;
    const onAutoCancelled = vi.fn();
    const requestPermission = vi.fn(
      async (request: RuntimePermissionRequest) => {
        projected = request;
        return { selectedOption: ToolConfirmationOutcome.ProceedOnce };
      },
    );
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission, onAutoCancelled }),
    );

    await expect(
      callbacks.permissionHandler(
        permissionRequest([
          details('apply_patch', {
            filePath: 'C:\\workspace\\file.ts',
            fileName: 'file.ts',
            patchContent: '@'.repeat(18_000),
            oldContent: 'o'.repeat(9_000),
            newContent: 'n'.repeat(9_000),
          }),
        ]),
      ),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);

    expect(onAutoCancelled).not.toHaveBeenCalled();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const toolUse = projected?.toolUses[0];
    expect(toolUse).toMatchObject({ confirmationKind: 'apply_patch' });
    expect(toolUse?.detail).toHaveLength(MAX_RUNTIME_DETAIL_LENGTH);
    expect(
      toolUse?.detail?.startsWith('Path: C:\\workspace\\file.ts'),
    ).toBe(true);
    expect(toolUse?.detail?.endsWith('… (truncated)')).toBe(true);
  });

  it('truncates oversized Create content and over-long titles instead of cancelling', async () => {
    let projected: RuntimePermissionRequest | undefined;
    const requestPermission = vi.fn(
      async (request: RuntimePermissionRequest) => {
        projected = request;
        return { selectedOption: ToolConfirmationOutcome.Cancel };
      },
    );
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission }),
    );

    const oversized = basicPermissionRequest();
    oversized.toolUses[0]!.details = {
      ...oversized.toolUses[0]!.details,
      fileName: 'f'.repeat(MAX_INTERACTION_TITLE_LENGTH),
      content: 'x'.repeat(MAX_RUNTIME_DETAIL_LENGTH + 1),
    } as never;
    await expect(callbacks.permissionHandler(oversized)).resolves.toBe(
      ToolConfirmationOutcome.Cancel,
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const toolUse = projected?.toolUses[0];
    expect(toolUse?.title).toHaveLength(MAX_INTERACTION_TITLE_LENGTH);
    expect(toolUse?.title?.endsWith('…')).toBe(true);
    expect(toolUse?.detail).toHaveLength(MAX_RUNTIME_DETAIL_LENGTH);
    expect(toolUse?.detail?.endsWith('… (truncated)')).toBe(true);
  });

  it('awaits an independent handler promise for each permission callback', async () => {
    const first = deferred<{
      selectedOption: ToolConfirmationOutcome;
    }>();
    const second = deferred<{
      selectedOption: ToolConfirmationOutcome;
    }>();
    const requestPermission = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission }),
    );

    const firstCall = callbacks.permissionHandler(basicPermissionRequest());
    const secondCall = callbacks.permissionHandler(basicPermissionRequest());
    second.resolve({ selectedOption: ToolConfirmationOutcome.Cancel });
    await expect(secondCall).resolves.toBe(ToolConfirmationOutcome.Cancel);
    expect(requestPermission).toHaveBeenCalledTimes(2);

    first.resolve({ selectedOption: ToolConfirmationOutcome.ProceedOnce });
    await expect(firstCall).resolves.toBe(
      ToolConfirmationOutcome.ProceedOnce,
    );
  });

  it('accepts exact permission boundaries and rejects one-character or count overflows before the host', async () => {
    const requestPermission = vi.fn(async () => ({
      selectedOption: ToolConfirmationOutcome.Cancel,
    }));
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission }),
    );
    const maximum = permissionRequest(
      [
        details('exit_spec_mode', {
          title: 't'.repeat(MAX_INTERACTION_TITLE_LENGTH),
          plan: 'p'.repeat(MAX_EDITED_SPEC_LENGTH),
        }),
      ],
      [
        {
          label: 'l'.repeat(MAX_PERMISSION_OPTION_LABEL_LENGTH),
          value: 'v'.repeat(MAX_PERMISSION_OPTION_VALUE_LENGTH),
        },
      ] as unknown as RequestPermissionRequestParams['options'],
    );
    maximum.toolUses[0]!.toolUse.id = 'i'.repeat(MAX_BRIDGE_ID_LENGTH);
    maximum.toolUses[0]!.toolUse.name = 'n'.repeat(
      MAX_PERMISSION_TOOL_NAME_LENGTH,
    );

    await expect(
      callbacks.permissionHandler(maximum),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
    expect(requestPermission).toHaveBeenCalledTimes(1);

    const overflowMutations: Array<
      (request: RequestPermissionRequestParams) => void
    > = [
      (request) => {
        request.toolUses[0]!.toolUse.id = 'i'.repeat(
          MAX_BRIDGE_ID_LENGTH + 1,
        );
      },
      (request) => {
        request.toolUses[0]!.toolUse.name = 'n'.repeat(
          MAX_PERMISSION_TOOL_NAME_LENGTH + 1,
        );
      },
      (request) => {
        request.options[0]!.label = 'l'.repeat(
          MAX_PERMISSION_OPTION_LABEL_LENGTH + 1,
        );
      },
      (request) => {
        (request.options[0]! as { value: string }).value =
          'v'.repeat(MAX_PERMISSION_OPTION_VALUE_LENGTH + 1);
      },
      (request) => {
        request.options.push(
          ...Array.from(
            { length: MAX_PERMISSION_OPTIONS },
            (_, index) => ({
              label: `Option ${index}`,
              value: `value-${index}`,
            }),
          ) as unknown as RequestPermissionRequestParams['options'],
        );
      },
    ];

    for (const mutate of overflowMutations) {
      const request = basicPermissionRequest();
      mutate(request);
      await expect(
        callbacks.permissionHandler(request),
      ).resolves.toBe(ToolConfirmationOutcome.Cancel);
    }
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('forwards ExitSpecMode plans beyond the generic detail cap instead of cancelling', async () => {
    // Regression for the 32K silent-cancel bug: a long plan used to fail
    // the generic detail bound and cancel the approval before the host
    // ever saw it. Plans now get a dedicated cap and truncate visibly.
    let projected: RuntimePermissionRequest | undefined;
    const requestPermission = vi.fn(
      async (request: RuntimePermissionRequest) => {
        projected = request;
        return { selectedOption: ToolConfirmationOutcome.Cancel };
      },
    );
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission }),
    );

    const longPlan = 'p'.repeat(MAX_RUNTIME_DETAIL_LENGTH * 2);
    await callbacks.permissionHandler(
      permissionRequest([
        details('exit_spec_mode', {
          title: 'Implementation plan',
          plan: longPlan,
        }),
      ]),
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(projected?.toolUses[0]).toMatchObject({
      confirmationKind: 'exit_spec_mode',
      detail: longPlan,
      editableSpecContent: longPlan,
    });

    const oversized = 'q'.repeat(MAX_SPEC_PLAN_LENGTH + 1024);
    await callbacks.permissionHandler(
      permissionRequest([
        details('exit_spec_mode', {
          title: 'Implementation plan',
          plan: oversized,
        }),
      ]),
    );
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(projected?.toolUses[0]?.detail).toHaveLength(
      MAX_SPEC_PLAN_LENGTH,
    );
    expect(projected?.toolUses[0]?.editableSpecContent).toHaveLength(
      MAX_SPEC_PLAN_LENGTH,
    );
  });

  it('rejects ProceedEdit before the host without editable ExitSpecMode content', async () => {
    const requestPermission = vi.fn();
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ requestPermission }),
    );

    await expect(
      callbacks.permissionHandler(
        permissionRequest(
          [
            details('create', {
              filePath: 'file.ts',
              fileName: 'file.ts',
              content: 'content',
            }),
          ],
          [
            {
              label: 'Edit plan',
              value: ToolConfirmationOutcome.ProceedEdit,
            },
          ],
        ),
      ),
    ).resolves.toBe(ToolConfirmationOutcome.Cancel);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('runtime AskUser interactions', () => {
  it('projects questions and restores exact SDK question strings by index', async () => {
    const askUser = vi.fn(async () => ({
      answers: [
        { index: 7, answer: 'Both' },
        { index: 3, answer: 'TypeScript' },
      ],
    }));
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ askUser }),
    );
    const params: AskUserRequestParams = {
      toolCallId: 'tool-call-1',
      questions: [
        {
          index: 3,
          topic: 'Language',
          question: 'Which language exactly?',
          options: ['TypeScript', 'Rust'],
        },
        {
          index: 7,
          topic: 'Targets',
          question: 'Which targets?',
          options: ['Web', 'Desktop'],
          multiSelect: true,
        },
      ],
    };

    await expect(callbacks.askUserHandler(params)).resolves.toEqual({
      answers: [
        {
          index: 3,
          question: 'Which language exactly?',
          answer: 'TypeScript',
        },
        {
          index: 7,
          question: 'Which targets?',
          answer: 'Both',
        },
      ],
    });
    expect(askUser).toHaveBeenCalledWith({
      toolCallId: 'tool-call-1',
      questions: [
        {
          index: 3,
          topic: 'Language',
          question: 'Which language exactly?',
          options: ['TypeScript', 'Rust'],
          multiSelect: false,
        },
        {
          index: 7,
          topic: 'Targets',
          question: 'Which targets?',
          options: ['Web', 'Desktop'],
          multiSelect: true,
        },
      ],
    });
  });

  it.each([
    {
      name: 'incomplete answers',
      result: { answers: [{ index: 3, answer: 'TypeScript' }] },
    },
    {
      name: 'duplicate answers',
      result: {
        answers: [
          { index: 3, answer: 'TypeScript' },
          { index: 3, answer: 'Rust' },
        ],
      },
    },
    {
      name: 'unknown answer indices',
      result: {
        answers: [
          { index: 3, answer: 'TypeScript' },
          { index: 99, answer: 'Web' },
        ],
      },
    },
    {
      name: 'malformed answers',
      result: {
        answers: [
          { index: 3, answer: 'TypeScript' },
          { index: 7, answer: 42 },
        ],
      },
    },
  ])('fails closed for $name', async ({ result }) => {
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({
        askUser: async () => result as never,
      }),
    );

    await expect(callbacks.askUserHandler(askUserRequest())).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
  });

  it('fails closed for cancellation, handler rejection, and unsafe questions', async () => {
    const cancelled = createRuntimeInteractionCallbacks(
      createHandler({
        askUser: async () => ({ cancelled: true, answers: [] }),
      }),
    );
    await expect(cancelled.askUserHandler(askUserRequest())).resolves.toEqual({
      cancelled: true,
      answers: [],
    });

    const rejected = createRuntimeInteractionCallbacks(
      createHandler({
        askUser: async () => {
          throw new Error('sensitive host failure');
        },
      }),
    );
    await expect(rejected.askUserHandler(askUserRequest())).resolves.toEqual({
      cancelled: true,
      answers: [],
    });

    const askUser = vi.fn();
    const unsafe = createRuntimeInteractionCallbacks(
      createHandler({ askUser }),
    );
    const params = askUserRequest();
    params.questions[0]!.question = 'x'.repeat(
      MAX_RUNTIME_DETAIL_LENGTH + 1,
    );
    await expect(unsafe.askUserHandler(params)).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
    expect(askUser).not.toHaveBeenCalled();
  });

  it('accepts exact AskUser boundaries and rejects response overflow', async () => {
    const askUser = vi
      .fn()
      .mockResolvedValueOnce({
        answers: [
          {
            index: Number.MAX_SAFE_INTEGER,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH),
          },
        ],
      })
      .mockResolvedValueOnce({
        answers: [
          {
            index: Number.MAX_SAFE_INTEGER,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH + 1),
          },
        ],
      });
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ askUser }),
    );
    const maximum: AskUserRequestParams = {
      toolCallId: 'i'.repeat(MAX_BRIDGE_ID_LENGTH),
      questions: [
        {
          index: Number.MAX_SAFE_INTEGER,
          topic: 't'.repeat(MAX_ASK_USER_TOPIC_LENGTH),
          question: 'q'.repeat(MAX_ASK_USER_QUESTION_LENGTH),
          options: Array.from(
            { length: MAX_ASK_USER_OPTIONS },
            () => 'o'.repeat(MAX_RUNTIME_DETAIL_LENGTH),
          ),
        },
      ],
    };

    await expect(callbacks.askUserHandler(maximum)).resolves.toEqual({
      answers: [
        {
          index: Number.MAX_SAFE_INTEGER,
          question: maximum.questions[0]!.question,
          answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH),
        },
      ],
    });
    await expect(callbacks.askUserHandler(maximum)).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
  });

  it('accepts SDK open-response questions without preset options', async () => {
    const askUser = vi.fn(async () => ({
      answers: [{ index: 0, answer: 'A warm vector illustration' }],
    }));
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ askUser }),
    );
    const request: AskUserRequestParams = {
      toolCallId: 'open-response',
      questions: [
        {
          index: 0,
          topic: 'Style',
          question: 'What kind of graphic would you like?',
          options: [],
        },
      ],
    };

    await expect(callbacks.askUserHandler(request)).resolves.toEqual({
      answers: [
        {
          index: 0,
          question: 'What kind of graphic would you like?',
          answer: 'A warm vector illustration',
        },
      ],
    });
    expect(askUser).toHaveBeenCalledWith({
      toolCallId: 'open-response',
      questions: [
        {
          index: 0,
          topic: 'Style',
          question: 'What kind of graphic would you like?',
          options: [],
          multiSelect: false,
        },
      ],
    });
  });

  it('rejects empty, over-count, and invalid-index AskUser projections before the host', async () => {
    const askUser = vi.fn();
    const callbacks = createRuntimeInteractionCallbacks(
      createHandler({ askUser }),
    );
    const invalid = [
      { toolCallId: '', questions: [questionParams(0)] },
      { toolCallId: 'tool-call', questions: [] },
      {
        toolCallId: 'tool-call',
        questions: Array.from(
          { length: MAX_ASK_USER_QUESTIONS + 1 },
          (_, index) => questionParams(index),
        ),
      },
      {
        toolCallId: 'tool-call',
        questions: [{ ...questionParams(0), index: -1 }],
      },
      {
        toolCallId: 'tool-call',
        questions: [{ ...questionParams(0), question: '' }],
      },
      {
        toolCallId: 'tool-call',
        questions: [
          {
            ...questionParams(0),
            options: Array(MAX_ASK_USER_OPTIONS + 1).fill('Option'),
          },
        ],
      },
    ] satisfies AskUserRequestParams[];

    for (const params of invalid) {
      await expect(callbacks.askUserHandler(params)).resolves.toEqual({
        cancelled: true,
        answers: [],
      });
    }
    expect(askUser).not.toHaveBeenCalled();
  });
});

function createHandler(
  overrides: Partial<RuntimeInteractionHandler> = {},
): RuntimeInteractionHandler {
  return {
    requestPermission: async () => ({
      selectedOption: ToolConfirmationOutcome.Cancel,
    }),
    askUser: async () => ({ cancelled: true, answers: [] }),
    ...overrides,
  };
}

function basicPermissionRequest(): RequestPermissionRequestParams {
  return permissionRequest([
    details('create', {
      filePath: 'C:\\workspace\\new.ts',
      fileName: 'new.ts',
      content: 'content',
    }),
  ]);
}

function permissionRequest(
  toolDetails: Array<Record<string, unknown> & { type: string }>,
  options: RequestPermissionRequestParams['options'] = [
    {
      label: 'Allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
    },
    {
      label: 'Cancel',
      value: ToolConfirmationOutcome.Cancel,
    },
  ],
): RequestPermissionRequestParams {
  return {
    options,
    toolUses: toolDetails.map((toolDetail, index) => ({
      toolUse: {
        type: 'tool_use',
        id: `tool-${index}`,
        name: `Tool${index}`,
        input: {
          secret: 'RAW_INPUT_SECRET',
          nested: { mustNeverEscape: true },
        },
      },
      confirmationType: toolDetail.type as ToolConfirmationType,
      details: toolDetail,
    })) as unknown as RequestPermissionRequestParams['toolUses'],
  };
}

function details<T extends string>(
  type: T,
  value: Record<string, unknown>,
): Record<string, unknown> & { type: T } {
  return { type, ...value };
}

function askUserRequest(): AskUserRequestParams {
  return {
    toolCallId: 'tool-call-1',
    questions: [
      {
        index: 3,
        topic: 'Language',
        question: 'Which language?',
        options: ['TypeScript', 'Rust'],
      },
      {
        index: 7,
        topic: 'Target',
        question: 'Which target?',
        options: ['Web', 'Desktop'],
      },
    ],
  };
}

function questionParams(
  index: number,
): AskUserRequestParams['questions'][number] {
  return {
    index,
    topic: 'Topic',
    question: 'Question?',
    options: ['Option'],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
