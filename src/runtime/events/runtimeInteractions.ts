import {
  ToolConfirmationOutcome,
  type AskUserRequestParams,
  type AskUserResult,
  type ClientAskUserHandler,
  type ClientPermissionHandler,
  type RequestPermissionHandlerResult,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk/node';
import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_OPTION_LENGTH,
  MAX_ASK_USER_QUESTIONS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_INTERACTION_DETAIL_LENGTH,
  MAX_INTERACTION_TITLE_LENGTH,
  MAX_PERMISSION_OPTIONS,
  MAX_PERMISSION_OPTION_LABEL_LENGTH,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_PERMISSION_RISK_NOTE_LENGTH,
  MAX_PERMISSION_TOOLS,
  MAX_SPEC_PLAN_LENGTH,
  PERMISSION_CONFIRMATION_KINDS,
  isImplicitMultiSelectQuestion,
  type PermissionConfirmationKind,
} from '../../shared/protocol/interactionProtocol';
import {
  isBoundedString,
  isNonEmptyBoundedString,
  projectPermissionToolUse,
} from './permissionToolProjection';

export const MAX_RUNTIME_PERMISSION_TOOL_USES = MAX_PERMISSION_TOOLS;
export const MAX_RUNTIME_PERMISSION_OPTIONS = MAX_PERMISSION_OPTIONS;
export const MAX_RUNTIME_ASK_USER_QUESTIONS = MAX_ASK_USER_QUESTIONS;
export const MAX_RUNTIME_ASK_USER_OPTIONS = MAX_ASK_USER_OPTIONS;
export const MAX_RUNTIME_IDENTIFIER_LENGTH = MAX_BRIDGE_ID_LENGTH;
export const MAX_RUNTIME_TITLE_LENGTH = MAX_INTERACTION_TITLE_LENGTH;
export const MAX_RUNTIME_DETAIL_LENGTH = MAX_INTERACTION_DETAIL_LENGTH;
export const MAX_RUNTIME_SPEC_PLAN_LENGTH = MAX_SPEC_PLAN_LENGTH;
export const MAX_RUNTIME_RISK_NOTE_LENGTH = MAX_PERMISSION_RISK_NOTE_LENGTH;
export const MAX_RUNTIME_ANSWER_LENGTH = MAX_ASK_USER_ANSWER_LENGTH;
export const RUNTIME_CONFIRMATION_KINDS = PERMISSION_CONFIRMATION_KINDS;

export type RuntimeConfirmationKind = PermissionConfirmationKind;

export interface RuntimePermissionOption {
  readonly label: string;
  readonly value: string;
  readonly requiresEditedSpec: boolean;
}

export interface RuntimePermissionToolSummary {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly confirmationKind: RuntimeConfirmationKind;
  readonly title: string;
  readonly detail?: string;
  readonly riskNote?: string;
  readonly editableSpecContent?: string;
}

export interface RuntimePermissionRequest {
  readonly options: readonly RuntimePermissionOption[];
  readonly toolUses: readonly RuntimePermissionToolSummary[];
}

export interface RuntimePermissionResult {
  readonly selectedOption: string;
  readonly editedSpecContent?: string;
}

export interface RuntimeAskUserQuestion {
  readonly index: number;
  readonly topic: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

export interface RuntimeAskUserRequest {
  readonly toolCallId: string;
  readonly questions: readonly RuntimeAskUserQuestion[];
  /** Withdraw the local form when the daemon resolves or removes its request. */
  readonly signal?: AbortSignal;
}

export interface RuntimeAskUserAnswer {
  readonly index: number;
  readonly answer: string;
}

export interface RuntimeAskUserResult {
  readonly cancelled?: boolean;
  readonly answers: readonly RuntimeAskUserAnswer[];
}

/**
 * Fired when a permission or AskUser request is auto-answered with a
 * cancel instead of reaching the user. These fallbacks used to be
 * silent, which made a cancelled ApplyPatch approval indistinguishable
 * from a user action in the logs.
 */
export interface RuntimeInteractionAutoCancel {
  readonly interaction: 'permission' | 'ask_user';
  readonly reason:
    | 'projection-error'
    | 'invalid-request'
    | 'invalid-result'
    | 'handler-error';
}

export interface RuntimeInteractionHandler {
  requestPermission(request: RuntimePermissionRequest): Promise<RuntimePermissionResult>;
  askUser(request: RuntimeAskUserRequest): Promise<RuntimeAskUserResult>;
  /** Optional observer for auto-cancelled interactions (logging only). */
  onAutoCancelled?(event: RuntimeInteractionAutoCancel): void;
}

export type RuntimeAskUserHandler = (
  params: AskUserRequestParams,
  signal?: AbortSignal,
) => ReturnType<ClientAskUserHandler>;

export interface RuntimeInteractionCallbacks {
  readonly permissionHandler: ClientPermissionHandler;
  readonly askUserHandler: RuntimeAskUserHandler;
}

export const cancellingRuntimeInteractionHandler: RuntimeInteractionHandler = {
  async requestPermission() {
    return { selectedOption: ToolConfirmationOutcome.Cancel };
  },
  async askUser() {
    return { cancelled: true, answers: [] };
  },
};

export function createRuntimeInteractionCallbacks(
  handler: RuntimeInteractionHandler,
): RuntimeInteractionCallbacks {
  return {
    permissionHandler: async (params) => handlePermissionRequest(handler, params),
    askUserHandler: async (params, signal) => handleAskUserRequest(handler, params, signal),
  };
}

export function permissionOptionRequiresEditedSpec(value: string): boolean {
  return value === ToolConfirmationOutcome.ProceedEdit;
}

function reportAutoCancel(
  handler: RuntimeInteractionHandler,
  interaction: RuntimeInteractionAutoCancel['interaction'],
  reason: RuntimeInteractionAutoCancel['reason'],
): void {
  try {
    handler.onAutoCancelled?.({ interaction, reason });
  } catch {
    // Observability must never alter interaction behavior.
  }
}

async function handlePermissionRequest(
  handler: RuntimeInteractionHandler,
  params: RequestPermissionRequestParams,
): Promise<RequestPermissionHandlerResult> {
  const cancel = (
    reason: RuntimeInteractionAutoCancel['reason'],
  ): RequestPermissionHandlerResult => {
    reportAutoCancel(handler, 'permission', reason);
    return ToolConfirmationOutcome.Cancel;
  };

  let request: RuntimePermissionRequest | null;
  try {
    request = projectPermissionRequest(params);
  } catch {
    return cancel('projection-error');
  }
  if (!request) {
    return cancel('invalid-request');
  }

  const suppliedOptions = new Map(
    request.options.map((option) => [option.value, option]),
  );

  try {
    const result = await handler.requestPermission(request);
    if (
      !isRecord(result) ||
      typeof result.selectedOption !== 'string' ||
      !suppliedOptions.has(result.selectedOption)
    ) {
      return cancel('invalid-result');
    }

    const selectedOption = suppliedOptions.get(result.selectedOption);
    if (!selectedOption?.requiresEditedSpec) {
      return result.selectedOption as RequestPermissionHandlerResult;
    }

    if (!isBoundedString(result.editedSpecContent, MAX_EDITED_SPEC_LENGTH)) {
      return cancel('invalid-result');
    }

    return {
      selectedOption: ToolConfirmationOutcome.ProceedEdit,
      editedSpecContent: result.editedSpecContent,
    };
  } catch {
    return cancel('handler-error');
  }
}

async function handleAskUserRequest(
  handler: RuntimeInteractionHandler,
  params: AskUserRequestParams,
  signal?: AbortSignal,
): Promise<AskUserResult> {
  let request: RuntimeAskUserRequest | null;
  try {
    request = projectAskUserRequest(params);
  } catch {
    reportAutoCancel(handler, 'ask_user', 'projection-error');
    return cancelledAskUserResult();
  }
  if (!request) {
    reportAutoCancel(handler, 'ask_user', 'invalid-request');
    return cancelledAskUserResult();
  }

  try {
    const result = await handler.askUser({ ...request, ...(signal ? { signal } : {}) });
    if (
      !isRecord(result) ||
      (result.cancelled !== undefined && typeof result.cancelled !== 'boolean') ||
      result.cancelled === true ||
      !Array.isArray(result.answers)
    ) {
      return cancelledAskUserResult();
    }

    const answersByIndex = new Map<number, string>();
    for (const answer of result.answers) {
      if (
        !isRecord(answer) ||
        typeof answer.index !== 'number' ||
        !Number.isSafeInteger(answer.index) ||
        answer.index < 0 ||
        !isNonEmptyBoundedString(answer.answer, MAX_RUNTIME_ANSWER_LENGTH) ||
        answersByIndex.has(answer.index)
      ) {
        return cancelledAskUserResult();
      }
      answersByIndex.set(answer.index, answer.answer);
    }

    if (answersByIndex.size !== params.questions.length) {
      return cancelledAskUserResult();
    }

    const answers: AskUserResult['answers'] = [];
    for (const { index, question } of params.questions) {
      const answer = answersByIndex.get(index);
      if (answer === undefined) {
        return cancelledAskUserResult();
      }
      answers.push({ index, question, answer });
    }

    return { answers };
  } catch {
    return cancelledAskUserResult();
  }
}

function projectPermissionRequest(
  params: RequestPermissionRequestParams,
): RuntimePermissionRequest | null {
  if (
    params.toolUses.length === 0 ||
    params.toolUses.length > MAX_RUNTIME_PERMISSION_TOOL_USES ||
    params.options.length === 0 ||
    params.options.length > MAX_RUNTIME_PERMISSION_OPTIONS
  ) {
    return null;
  }

  const options: RuntimePermissionOption[] = [];
  for (const option of params.options) {
    if (
      !isNonEmptyBoundedString(option.label, MAX_PERMISSION_OPTION_LABEL_LENGTH) ||
      !isNonEmptyBoundedString(option.value, MAX_PERMISSION_OPTION_VALUE_LENGTH)
    ) {
      return null;
    }
    options.push({
      label: option.label,
      value: option.value,
      requiresEditedSpec: permissionOptionRequiresEditedSpec(option.value),
    });
  }

  const toolUses: RuntimePermissionToolSummary[] = [];
  for (const toolUse of params.toolUses) {
    const projected = projectPermissionToolUse(toolUse);
    if (!projected) {
      return null;
    }
    toolUses.push(...projected);
  }

  if (
    options.some(({ requiresEditedSpec }) => requiresEditedSpec) &&
    !toolUses.some(
      ({ confirmationKind, editableSpecContent }) =>
        confirmationKind === 'exit_spec_mode' && editableSpecContent !== undefined,
    )
  ) {
    return null;
  }

  return { options, toolUses };
}

function projectAskUserRequest(
  params: AskUserRequestParams,
): RuntimeAskUserRequest | null {
  if (
    !isNonEmptyBoundedString(params.toolCallId, MAX_BRIDGE_ID_LENGTH) ||
    params.questions.length === 0 ||
    params.questions.length > MAX_RUNTIME_ASK_USER_QUESTIONS
  ) {
    return null;
  }

  const seenIndices = new Set<number>();
  const questions: RuntimeAskUserQuestion[] = [];

  for (const question of params.questions) {
    if (
      !Number.isSafeInteger(question.index) ||
      question.index < 0 ||
      seenIndices.has(question.index) ||
      !isBoundedString(question.topic, MAX_ASK_USER_TOPIC_LENGTH) ||
      !isNonEmptyBoundedString(question.question, MAX_ASK_USER_QUESTION_LENGTH) ||
      question.options.length > MAX_RUNTIME_ASK_USER_OPTIONS ||
      !question.options.every((option) =>
        isNonEmptyBoundedString(option, MAX_ASK_USER_OPTION_LENGTH),
      ) ||
      (question.multiSelect !== undefined && typeof question.multiSelect !== 'boolean')
    ) {
      return null;
    }

    seenIndices.add(question.index);
    questions.push({
      index: question.index,
      topic: question.topic,
      question: question.question,
      options: [...question.options],
      multiSelect:
        Boolean(question.multiSelect) ||
        isImplicitMultiSelectQuestion(question.question, question.topic),
    });
  }

  return { toolCallId: params.toolCallId, questions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cancelledAskUserResult(): AskUserResult {
  return { cancelled: true, answers: [] };
}
